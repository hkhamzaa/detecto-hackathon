import jwt from 'jsonwebtoken';

import { config } from '../config.js';

/**
 * The coarse role the frontend's claims carry (lib/auth/claims.ts) has no
 * literal column in the schema — roles are custom per org by design. This
 * derives it at token-issue time instead:
 *
 *   - a platform user (users.is_super_admin) is always 'super_admin'
 *   - a user holding their org's un-deletable default role (roles.is_default,
 *     the one every new org is seeded with — see db/seed.js) is 'org_admin'
 *   - anyone else — a custom role, or no role at all — is 'member'
 *
 * `permissions` comes straight from the held role; a super admin's is left
 * empty because lib/auth/claims.ts's `can()` short-circuits true for that
 * role regardless of what the array holds.
 */
export function claimsFor(user) {
  const role = user.is_super_admin
    ? 'super_admin'
    : user.role_is_default
      ? 'org_admin'
      : 'member';

  return {
    sub: user.id,
    email: user.email,
    role,
    permissions: role === 'super_admin' ? [] : (user.role_permissions ?? []),
    orgId: user.is_super_admin ? null : user.org_id,
  };
}

export function issueToken(user, { remember }) {
  const claims = claimsFor(user);
  const expiresIn = remember ? config.sessionExpiry.remembered : config.sessionExpiry.default;
  return jwt.sign(claims, config.jwtSecret, { algorithm: 'HS256', expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}
