import { Router } from 'express';

import { config } from '../config.js';
import { pool } from '../db.js';
import { ALL_PERMISSION_KEYS } from '../lib/permissions.js';
import { dummyHash, hashPassword, verifyPassword } from '../lib/passwords.js';
import {
  checkLocked,
  clearFailures,
  createRateLimiter,
  rateLimitMiddleware,
  recordFailure,
} from '../lib/rate-limiter.js';
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../lib/refresh-tokens.js';
import { issueToken } from '../lib/tokens.js';
import { isEmail, isPhone, passwordIssue } from '../lib/validation.js';
import { logAudit } from '../lib/audit.js';

export const authRouter = Router();

/**
 * Shared shape for both directions of the refresh cookie. The cookie's
 * `expires` comes from the token's own `expiresAt` rather than being
 * re-derived from config, so the cookie and the DB row it backs can never
 * disagree about when this session actually dies.
 */
function setRefreshCookie(res, raw, expiresAt) {
  res.cookie(config.refreshCookie.name, raw, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: config.refreshCookie.path,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(config.refreshCookie.name, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: config.refreshCookie.path,
  });
}

/**
 * Per-IP ceilings for the unauthenticated auth routes below — there's no
 * account (or, for /refresh, no still-valid access token) to key a lockout
 * to the way /login's `attempts` map does, so these key on `req.ip` instead.
 * Generous enough not to trip on a real user retrying a typo or a page full
 * of reloads; tight enough to blunt scripted signup spam, reset-email
 * bombing, and refresh-token guessing.
 */
const signupLimiter = rateLimitMiddleware(
  createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }),
  (req) => req.ip,
);
const passwordResetLimiter = rateLimitMiddleware(
  createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 }),
  (req) => req.ip,
);
const refreshLimiter = rateLimitMiddleware(
  createRateLimiter({ windowMs: 5 * 60 * 1000, max: 30 }),
  (req) => req.ip,
);

/* -------------------------------------------------------------------------- */
/* POST /api/auth/login                                                       */
/* -------------------------------------------------------------------------- */

const USER_WITH_ROLE_SQL = `
  SELECT
    u.id, u.org_id, u.name, u.email, u.password_hash, u.status, u.is_super_admin,
    r.name AS role_name, r.permissions AS role_permissions, r.is_default AS role_is_default,
    o.status AS org_status
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower($1)
  LIMIT 1
`;

authRouter.post('/login', async (req, res) => {
  const { email, password, remember } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Checked before touching the database, matching the mock's own order
  // (lib/auth/api.ts mockLogin) — a locked-out email doesn't cost a query.
  const retryAfterSeconds = checkLocked(email);
  if (retryAfterSeconds !== null) {
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: 'rate_limited', retryAfterSeconds });
  }

  const { rows } = await pool.query(USER_WITH_ROLE_SQL, [email]);
  const user = rows[0] ?? null;

  // Same 401, same body, whether the email doesn't exist or the password is
  // wrong — the frontend's own comment on this: "the backend must not
  // distinguish them, and neither does anything downstream of here."
  //
  // Verifying against a precomputed dummy hash when there's no user keeps
  // this branch costing roughly what the real one does, so the difference
  // isn't visible in response timing either — see lib/passwords.js.
  const passwordOk = user
    ? await verifyPassword(user.password_hash, password)
    : await verifyPassword(dummyHash, password).catch(() => false);

  // A non-active account (invited, never accepted; deactivated) fails the
  // same generic way. There's no distinct error code for it in the
  // discovered contract, and inventing one would itself leak account state
  // to whoever is attempting the login.
  //
  // A suspended org's users fail the same generic way too — deliberately,
  // matching the existing "the backend must not distinguish" rule rather
  // than inventing a new information-disclosure surface for it. This is
  // half of what suspend.tsx documents suspension as doing ("everyone on
  // the account is signed out, and cannot sign back in"); the other half —
  // an already-issued access token continuing to work mid-session — is
  // requireActiveOrg's job, not this route's.
  if (!user || !passwordOk || user.status !== 'active' || user.org_status === 'suspended') {
    recordFailure(email);
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  clearFailures(email);
  const accessToken = issueToken(user, { remember: remember === true });
  const refreshToken = await issueRefreshToken(user.id, { remember: remember === true });
  setRefreshCookie(res, refreshToken.raw, refreshToken.expiresAt);

  // audit_log.org_id is not-null — it's an org-level record, and a super
  // admin (users.is_super_admin) belongs to no org, so there's nowhere for
  // that sign-in to be logged to here. Not a gap in this table: platform
  // staff activity was never this log's subject.
  if (user.org_id) {
    await logAudit(pool, {
      orgId: user.org_id,
      actor: { id: user.id, name: user.name, roleName: user.role_name },
      action: 'auth.logged_in',
      summary: 'Signed in',
      detail: remember === true ? ['Chose to stay signed in on this device.'] : [],
    });
  }

  return res.status(200).json({ accessToken });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/signup                                                      */
/* -------------------------------------------------------------------------- */

const ORG_TYPES = ['Office', 'Retail', 'Warehouse', 'School', 'Other'];
const ACCOUNT_TYPES = ['home', 'org'];

function signupErrors(body) {
  const errors = {};

  if (!body.name || !String(body.name).trim()) {
    errors.name = 'Enter the name this account belongs to.';
  }
  if (!body.email || !String(body.email).trim()) {
    errors.email = 'Enter an email address.';
  } else if (!isEmail(body.email)) {
    errors.email = 'This needs an @ and a domain, like name@company.com.';
  }
  if (body.phone && !isPhone(body.phone)) {
    errors.phone = 'This needs at least 7 digits.';
  }
  const passwordError = passwordIssue(body.password);
  if (passwordError) errors.password = passwordError;

  if (!ACCOUNT_TYPES.includes(body.accountType)) {
    errors.accountType = "accountType must be 'home' or 'org'.";
  } else if (body.accountType === 'org' && !String(body.orgName ?? '').trim()) {
    errors.orgName = 'Enter the name your organization operates under.';
  }

  return errors;
}

async function resolvePlanId(client, accountType, requestedPlanId) {
  if (requestedPlanId) {
    const { rows } = await client.query(
      'SELECT id FROM plans WHERE id = $1 AND audience = $2',
      [requestedPlanId, accountType],
    );
    if (rows[0]) return rows[0].id;
  }
  // No plan requested, or it didn't match this account's audience: fall
  // back to the smallest plan for that audience, same as recommendPlan()
  // in lib/plans.ts would for the smallest estimate.
  const { rows } = await client.query(
    'SELECT id FROM plans WHERE audience = $1 ORDER BY monthly ASC LIMIT 1',
    [accountType],
  );
  return rows[0]?.id ?? null;
}

authRouter.post('/signup', signupLimiter, async (req, res) => {
  const body = req.body ?? {};
  const errors = signupErrors(body);
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const email = String(body.email).trim();
  const name = String(body.name).trim();
  const accountType = body.accountType;

  // Unlike login, this reveals the collision — see the report: it's the
  // applicant's own submitted email, not a third party probing for one.
  const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'email_taken' });
  }

  const orgType = ORG_TYPES.includes(body.orgType) ? body.orgType : null;
  const orgName =
    accountType === 'org' ? String(body.orgName).trim() : (body.orgName?.trim() || `${name}'s home`);
  const phone = body.phone ? String(body.phone).trim() : null;
  const passwordHash = await hashPassword(body.password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const planId = await resolvePlanId(client, accountType, body.planId);

    const org = await client.query(
      `INSERT INTO organizations (name, org_type, contact_email, contact_phone, account_type, plan_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [orgName, orgType, email, phone, accountType, planId],
    );
    const orgId = org.rows[0].id;

    // Every new org gets one role: the admin access the person signing up
    // already has. Matches lib/roles/api.ts's own seed() exactly — no
    // "Manager"/"Viewer" ladder invented here either.
    const role = await client.query(
      `INSERT INTO roles (org_id, name, permissions, zones, is_default)
       VALUES ($1, 'Admin', $2, NULL, true)
       RETURNING id`,
      [orgId, ALL_PERMISSION_KEYS],
    );
    const roleId = role.rows[0].id;

    const user = await client.query(
      `INSERT INTO users (org_id, name, email, password_hash, role_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, org_id, email, is_super_admin`,
      [orgId, name, email, passwordHash, roleId],
    );

    await client.query('COMMIT');

    const remember = body.remember === true;
    const accessToken = issueToken(
      { ...user.rows[0], role_permissions: ALL_PERMISSION_KEYS, role_is_default: true },
      { remember },
    );
    const refreshToken = await issueRefreshToken(user.rows[0].id, { remember });
    setRefreshCookie(res, refreshToken.raw, refreshToken.expiresAt);
    return res.status(201).json({ accessToken });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/logout                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ends the session the frontend's comment on `logout()` (lib/auth/api.ts)
 * expects this to end: revokes the refresh token so it can't mint another
 * access token, then clears the cookie. Only the one session presenting
 * this cookie is revoked — signing out on this device doesn't sign out
 * every other device, same as most products' "log out" (as opposed to a
 * separate "log out everywhere").
 *
 * Always 200, even with no cookie or an already-invalid one: the client
 * drops its in-memory token regardless (hooks/use-logout.ts), and there
 * is no failure state here a person signing out could act on — matching the
 * frontend's `Promise<void>` that never rejects.
 */
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[config.refreshCookie.name];
  if (token) {
    const userId = await revokeRefreshToken(token);
    // Only a token that actually revoked a live row ended a real session —
    // an already-expired/unknown/reused cookie shouldn't produce a
    // "signed out" entry for something that didn't happen.
    if (userId) {
      const { rows } = await pool.query(
        `SELECT u.org_id, u.name, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
        [userId],
      );
      const user = rows[0];
      // See the matching comment on /login: no org, nowhere to log this to.
      if (user?.org_id) {
        await logAudit(pool, {
          orgId: user.org_id,
          actor: { id: userId, name: user.name, roleName: user.role_name },
          action: 'auth.logged_out',
          summary: 'Signed out',
        });
      }
    }
  }
  clearRefreshCookie(res);
  res.status(200).json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/refresh                                                     */
/* -------------------------------------------------------------------------- */

const USER_BY_ID_SQL = `
  SELECT
    u.id, u.org_id, u.email, u.status, u.is_super_admin,
    r.permissions AS role_permissions, r.is_default AS role_is_default,
    o.status AS org_status
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN organizations o ON o.id = u.org_id
  WHERE u.id = $1
  LIMIT 1
`;

/**
 * The silent-refresh endpoint `store/auth-store.ts`'s boot-seam comment
 * describes: reads the httpOnly cookie (never a header — the whole point is
 * that JS never touches this token), rotates it, and mints a new access
 * token so a reload or an expired access token doesn't force a real login.
 *
 * Re-reads the user rather than trusting anything cached at the old
 * token's issue time, so a deactivated account or a role change since login
 * takes effect on the very next refresh instead of surviving until the
 * access token's own expiry.
 */
authRouter.post('/refresh', refreshLimiter, async (req, res) => {
  const presented = req.cookies?.[config.refreshCookie.name];
  if (!presented) return res.status(401).json({ error: 'unauthorized' });

  const rotated = await rotateRefreshToken(presented);
  if (!rotated.ok) {
    if (rotated.reason === 'benign-race') {
      // A sibling request for this same account — another tab, or an
      // overlapping page load — already rotated this exact token a moment
      // ago and the account has a live session right now because of it.
      // This is not a failed session; it is one request that lost an
      // ordinary race. Deliberately NOT calling clearRefreshCookie here:
      // the sibling's own response already carries (or is about to carry)
      // the valid replacement, and clearing the cookie from this response
      // could destroy that valid session purely because of which response
      // the browser happens to process last. 409 rather than 401 so the
      // frontend can tell "retry, something else already succeeded" apart
      // from "give up, sign out" — see lib/auth/session.ts.
      return res.status(409).json({ error: 'rotation_race' });
    }
    // Genuinely stale, unknown, or reused outside the grace window (which
    // rotateRefreshToken has already mass-revoked in that last case).
    // Clear the cookie so the browser stops sending one that can never
    // succeed again.
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { rows } = await pool.query(USER_BY_ID_SQL, [rotated.userId]);
  const user = rows[0];
  if (!user || user.status !== 'active' || user.org_status === 'suspended') {
    // The account was deactivated (or deleted), or the org was suspended,
    // since this token was issued. The rotation above already burned the
    // presented token; nothing more to revoke, just refuse to hand out a
    // new access token for it. Belt-and-suspenders alongside the bulk
    // refresh-token revocation suspension already does — that revocation
    // alone should already make `rotateRefreshToken` return `{ ok: false,
    // reason: 'invalid' }` above for every session on a suspended org (no
    // live row left behind for the 'benign-race' branch to find), but this
    // is cheap to check twice on a boundary this sensitive.
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'unauthorized' });
  }

  const accessToken = issueToken(user, { remember: rotated.remember });
  setRefreshCookie(res, rotated.raw, rotated.expiresAt);
  return res.status(200).json({ accessToken });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/password-reset                                              */
/*                                                                             */
/* Path matches what the frontend actually calls (lib/auth/api.ts realReset)  */
/* — the task text said /api/auth/forgot-password, but that endpoint has no  */
/* caller anywhere in the frontend today.                                    */
/* -------------------------------------------------------------------------- */

authRouter.post('/password-reset', passwordResetLimiter, async (req, res) => {
  const email = req.body?.email;

  // A malformed address is a problem with the input, not a claim about an
  // account — safe to say so without touching the enumeration boundary.
  if (typeof email !== 'string' || !isEmail(email)) {
    return res.status(422).json({ error: 'invalid_email' });
  }

  const { rows } = await pool.query('SELECT id, name FROM users WHERE lower(email) = lower($1)', [
    email.trim(),
  ]);
  const user = rows[0] ?? null;

  // Stubbed: no email sender is wired up, and no persisted, single-use
  // reset token either — nothing in this pass consumes one (a
  // POST /api/auth/reset-password endpoint wasn't requested). A real send
  // needs both before this does anything but log.
  //
  // The token itself is never logged — a token good for taking over the
  // account has no business sitting in plaintext log storage — and neither
  // is the email, which the identical response below already keeps off the
  // enumeration boundary; leaking it into logs would reopen exactly what
  // that response is designed to hide. Logged only when the account exists,
  // as a bare event with no identifying detail.
  if (user) {
    console.log('[password-reset] reset requested for an existing account');
  }

  // Identical response whether or not the account exists — the frontend
  // already treats any completed response as success and never branches on
  // status code here, but the backend holds the same line independently.
  return res.status(200).json({ ok: true });
});
