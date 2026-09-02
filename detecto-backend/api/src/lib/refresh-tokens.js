import { createHash, randomBytes } from 'node:crypto';

import { config } from '../config.js';
import { pool } from '../db.js';

/**
 * A reused-but-already-rotated token is only treated as a theft signal
 * (mass revoke) once it's older than this. Inside the window it's treated
 * as an ordinary miss — most likely two tabs (or a tab plus this same
 * request retried by the fetch layer) racing to rotate the same token a
 * few milliseconds apart, not an attacker replaying a stolen cookie. The
 * loser of that race still gets a plain 401 either way; this only decides
 * whether it *also* nukes every other session for the account.
 */
const REUSE_GRACE_MS = 10_000;

function rawToken() {
  return randomBytes(32).toString('hex');
}

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function expiryFor(remember) {
  const ms = remember ? config.refreshExpiryMs.remembered : config.refreshExpiryMs.default;
  return new Date(Date.now() + ms);
}

/**
 * Issues a brand-new refresh token for a just-authenticated user (login,
 * signup). Returns the raw token — the only time it ever exists outside the
 * hash — for the route to hand back as a cookie.
 */
export async function issueRefreshToken(userId, { remember }) {
  const raw = rawToken();
  const expiresAt = expiryFor(remember);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, remember, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(raw), remember === true, expiresAt],
  );
  return { raw, expiresAt };
}

/**
 * Validates a presented refresh token and, if it's genuinely still active,
 * rotates it: the presented token is revoked and a new one takes its place
 * in one transaction, so a raw token is good for exactly one refresh call
 * ever.
 *
 * Rotation (rather than reissuing the same token with a pushed-out expiry)
 * is the safer pattern here: it bounds how long a *stolen* refresh token
 * stays useful to one rotation window instead of its full 30-day lifetime,
 * and it's what makes reuse detection below possible at all — a stateless,
 * reissuable token gives an attacker and the legitimate user no way to
 * tell each other apart.
 *
 * Returns one of three outcomes — see the route: these are NOT the same
 * failure and must not be handled the same way.
 *   - `{ ok: true, userId, remember, raw, expiresAt }` — rotated.
 *   - `{ ok: false, reason: 'benign-race' }` — a sibling request for this
 *     same account rotated this exact token a moment ago (two tabs, or two
 *     overlapping page loads, presenting the same not-yet-superseded
 *     cookie). Not theft: the account has a live session right now — the
 *     sibling's own — so the caller must not clear the client's cookie or
 *     touch anyone else's session over this.
 *   - `{ ok: false, reason: 'invalid' }` — missing, unknown, expired, or a
 *     genuine reuse outside the grace window (which this also mass-revokes
 *     every other session for). The caller should clear the cookie and
 *     401, exactly as before.
 */
export async function rotateRefreshToken(presentedRaw) {
  const hash = hashToken(presentedRaw);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Row-locked by the UPDATE itself: two concurrent calls presenting the
    // same token can't both win this — Postgres serializes them, and the
    // loser's WHERE clause stops matching once the winner's revoked_at
    // commits, so the loser reliably falls into the 0-rows branch below.
    const { rows } = await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING id, user_id, remember`,
      [hash],
    );

    if (rows.length === 0) {
      const outcome = await handlePresentedButNotRotated(client, hash);
      await client.query('COMMIT');
      return outcome;
    }

    const { user_id: userId, remember } = rows[0];
    const raw = rawToken();
    const expiresAt = expiryFor(remember);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, remember, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, hashToken(raw), remember, expiresAt],
    );

    await client.query('COMMIT');
    return { ok: true, userId, remember, raw, expiresAt };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The UPDATE above matched nothing. Figure out why — and, critically,
 * whether "revoked a moment ago" actually means "a legitimate sibling
 * rotation already replaced this" rather than "this account has nothing
 * valid right now" (a logout, a suspension, or an already-fired mass
 * revoke). Those look identical by timestamp alone, so timestamp alone is
 * not enough: only the first is safe to wave through as a benign race.
 * `expires_at > now()` in the check below matches rotateRefreshToken's own
 * UPDATE, so a genuinely valid sibling and a merely-not-yet-cleaned-up
 * expired row can't be confused for each other.
 */
async function handlePresentedButNotRotated(client, hash) {
  const { rows } = await client.query(
    `SELECT user_id, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
    [hash],
  );
  const row = rows[0];
  // Unknown token (never issued, or long since deleted) — genuinely invalid.
  if (!row || !row.revoked_at) return { ok: false, reason: 'invalid' };

  const revokedMsAgo = Date.now() - new Date(row.revoked_at).getTime();
  if (revokedMsAgo < REUSE_GRACE_MS) {
    const { rows: liveRows } = await client.query(
      `SELECT 1 FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [row.user_id],
    );
    // A live session exists for this account right now — the sibling that
    // won this race. Nothing to punish, nothing to clear.
    if (liveRows.length > 0) return { ok: false, reason: 'benign-race' };
    // Recently revoked, but nothing valid is standing behind it (a logout
    // or a suspension raced this instead of a sibling rotation) — this is
    // not a race to retry, it's a session that has actually ended. Falls
    // through to the ordinary invalid handling below rather than telling
    // the client to quietly try again against an account with nothing to
    // refresh into.
  }

  // Outside the grace window (or within it with no live session behind
  // it): treat as genuine reuse and burn every other active session for
  // the account. A no-op UPDATE when nothing is left active — e.g. the
  // logout/suspension case just above already cleared everything.
  await client.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [row.user_id],
  );
  return { ok: false, reason: 'invalid' };
}

/**
 * Revokes exactly the session presenting this token — logout, not a global
 * sign-out. Returns the userId it revoked, or null if the token was already
 * revoked/unknown/expired — the caller (the logout route, for its audit
 * entry) needs to tell "a real session just ended" from "there was nothing
 * to end" so it doesn't log a sign-out that didn't happen.
 */
export async function revokeRefreshToken(presentedRaw) {
  const { rows } = await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id`,
    [hashToken(presentedRaw)],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Revokes every active refresh token for every user in one org — the
 * "everyone on the account... cannot sign back in" half of what suspending
 * a tenant does (see routes/admin-tenants.js). `client` is whatever the
 * caller is already using for the suspension write itself, so this commits
 * or rolls back atomically with it, same as logAudit's own client param.
 *
 * This alone doesn't end an already-issued *access* token mid-session — a
 * JWT is stateless and stays cryptographically valid until it expires
 * regardless of what happens to the refresh tokens behind it. That's
 * requireActiveOrg's job, not this function's.
 */
export async function revokeAllForOrg(client, orgId) {
  await client.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE org_id = $1)`,
    [orgId],
  );
}
