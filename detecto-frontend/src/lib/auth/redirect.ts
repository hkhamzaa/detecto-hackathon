import { can, type Claims } from '@/lib/auth/claims'

/**
 * The single place that decides where a signed-in person lands.
 *
 * There is deliberately no role-specific login form: one form authenticates,
 * and this function reads the claims that come back and picks the route. Adding
 * a role or a permission-gated surface means editing this list and nothing
 * else. Lazy route groups keyed on these paths are what keep a lower-permission
 * account from ever downloading higher-permission code.
 */
export function landingPathFor(claims: Claims | null): string {
  if (!claims) return '/login'

  if (claims.role === 'super_admin') return '/admin/overview'
  if (claims.role === 'org_admin') return '/org/overview'

  // Custom permission-based roles: land on the first surface they can use.
  if (can(claims, 'alerts:confirm')) return '/alerts'
  if (can(claims, 'alerts:view')) return '/alerts'
  if (can(claims, 'cameras:view')) return '/cameras'

  /*
   * The compliance officer: reads the record, changes nothing, and watches no
   * cameras. `audit:view` has always been its own grant and the role builder
   * has always offered it, but until this line somebody holding only that grant
   * landed on `/no-access` and could not reach the page it exists for — a
   * permission that led nowhere, which is the checkbox-shaped lie
   * `lib/roles/permissions.ts` refuses to tell.
   *
   * Last, so anybody who also watches alerts still lands on their queue. This
   * is the only file that decides where a person goes, and the sidebar is built
   * from the same call.
   */
  if (can(claims, 'audit:view')) return '/org/audit-log'

  // Authenticated, but granted nothing yet.
  return '/no-access'
}
