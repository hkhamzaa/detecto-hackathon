import { timingSafeEqual } from 'node:crypto';

import { config } from '../config.js';
import { pool } from '../db.js';
import { verifyBoxCredential } from '../lib/box-credentials.js';
import { verifyToken } from '../lib/tokens.js';

/**
 * Verifies the bearer JWT and attaches its claims to the request. Every
 * downstream check — org scope, permissions — reads from `req.claims`,
 * never from anything the client passed directly. That's the whole point:
 * a client-supplied org_id or role is not a thing this API trusts anywhere.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  try {
    req.claims = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * Blocks any request whose token has no org — platform staff
 * (`role: 'super_admin'`, `orgId: null`).
 *
 * This is not a permission check. `can()` below returns true for a super
 * admin on any permission string, so without this a platform account could
 * pass every `requirePermission()` on these routes. lib/tenants/api.ts's own
 * header is explicit that a super admin "does not get to watch the
 * customer's cameras" and that impersonation "is not here and is not
 * coming" — this is that boundary, enforced independently of role.
 */
export function requireOrgScope(req, res, next) {
  if (!req.claims?.orgId) return res.status(403).json({ error: 'forbidden' });
  next();
}

/**
 * Rejects a request whose org has been suspended by platform staff (see
 * routes/admin-tenants.js), even though the presenting access token is
 * still cryptographically valid — a JWT is stateless and can outlive a
 * suspension by up to its own lifetime (a day, or 30 with "remember me")
 * unless something checks live state on every request. This is that check.
 *
 * Deliberately a separate middleware from requireOrgScope rather than
 * folded into it: requireOrgScope is a pure, zero-I/O check over the
 * claims already on `req` (see its own comment — "not a permission check"),
 * and this is the opposite kind of thing, a DB-dependent liveness check.
 * Keeping them apart means a route that ever legitimately needs "org-scoped
 * but suspension-tolerant" (there isn't one today) can compose
 * requireOrgScope alone instead of needing to be carved out of a merged
 * check later.
 *
 * Always runs after requireOrgScope, so `req.claims.orgId` is already
 * known non-null here — a super admin's request never reaches this far.
 */
export async function requireActiveOrg(req, res, next) {
  const { rows } = await pool.query('SELECT status FROM organizations WHERE id = $1', [
    req.claims.orgId,
  ]);
  if (rows[0]?.status === 'suspended') {
    return res.status(403).json({ error: 'org_suspended' });
  }
  next();
}

/**
 * The mirror image of requireOrgScope: rejects everyone EXCEPT platform
 * staff (`role: 'super_admin'`, `orgId: null`). Every /api/admin/* route
 * uses this instead of the requireOrgScope→requirePermission chain — an
 * org-scoped route rejects a super admin outright (see requireOrgScope's
 * own comment); this is the same boundary held from the other side.
 *
 * Never chained with requireOrgScope (they're mutually exclusive by
 * definition) or wrapped in requirePermission: the frontend's `admin:*`
 * strings (admin:tenants, admin:billing, ...) aren't real grants — no role
 * anywhere ever holds them, and `can()` already returns true for a super
 * admin on any permission string. Routing an admin route through
 * requirePermission('admin:whatever') would pass unconditionally and imply
 * a finer-grained check that doesn't exist. This is the one real check:
 * are you platform staff at all.
 */
export function requireSuperAdmin(req, res, next) {
  if (req.claims?.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

/** Ported from lib/auth/claims.ts's can() verbatim — same rule, same order. */
export function can(claims, permission) {
  if (!claims) return false;
  if (claims.role === 'super_admin') return true;
  return claims.permissions.includes(permission);
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!can(req.claims, permission)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/**
 * Gate for the one remaining shared-secret caller: detecto-backend/server,
 * the dev-only Python alert pipeline, on `POST /api/alerts`. Not a person's
 * session: there are no claims to attach, so a route behind this must never
 * read `req.claims` and must derive whatever org it's scoped to some other
 * way (see the create-alert route, which derives it from the camera being
 * posted to).
 *
 * This USED to also gate the box-facing endpoints (`/:id/heartbeat`,
 * `/:id/cameras`) — both now use `requireBoxCredential` below instead, a
 * real per-box secret rather than one shared key any caller could present
 * to act as any box. `requireInternalKey` stays for `/api/alerts` alone,
 * deliberately: that endpoint's caller is this project's own dev-only test
 * harness standing in for a box, not a box itself, and stays that way until
 * a real box exists to replace it — see server/README.md.
 *
 * `timingSafeEqual` requires equal-length buffers; a length mismatch is
 * itself conclusive (the real key is a fixed, known length), so it's checked
 * first rather than padded to force a comparison that would tell an attacker
 * nothing a length check doesn't already.
 */
export function requireInternalKey(req, res, next) {
  const provided = req.headers['x-internal-api-key'];
  if (typeof provided !== 'string') return res.status(401).json({ error: 'unauthorized' });

  const expected = Buffer.from(config.internalApiKey);
  const given = Buffer.from(provided);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * Gate for the box-facing endpoints — a real per-box credential (see
 * lib/box-credentials.js), checked against the specific box named by the
 * route's own `:id` param, not a fleet-wide shared secret. Attaches
 * `req.box` (`{id, orgId}`) so the route handler never needs its own
 * separate "does this box exist" query — this middleware already ran one.
 *
 * 404 for a box id that doesn't exist at all (boxes aren't secret the way
 * an email address is — see the login-enumeration rule elsewhere in this
 * file, which does NOT apply here); 401 for a real box with a missing,
 * wrong, or revoked secret. Those are genuinely different failures, unlike
 * requireInternalKey's single shared secret where there's nothing else to
 * distinguish.
 */
export async function requireBoxCredential(req, res, next) {
  const boxId = req.params.id;
  const provided = req.headers['x-box-secret'];
  if (typeof provided !== 'string' || !provided) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { rows } = await pool.query('SELECT id, org_id FROM boxes WHERE id = $1', [boxId]);
  const box = rows[0];
  if (!box) return res.status(404).json({ error: 'not_found' });

  const ok = await verifyBoxCredential(boxId, provided);
  if (!ok) return res.status(401).json({ error: 'unauthorized' });

  req.box = { id: box.id, orgId: box.org_id };
  next();
}
