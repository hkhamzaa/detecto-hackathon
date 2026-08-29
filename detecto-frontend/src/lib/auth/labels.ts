import type { Claims, Role } from '@/lib/auth/claims'

/** How claims read to a person. Display only — nothing decides anything here. */

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  org_admin: 'Org admin',
  member: 'Member',
}

export function roleLabel(role: Role) {
  return ROLE_LABEL[role]
}

/**
 * Which organisation is on screen. The name is derived from the org id as a
 * stand-in until the session carries the real one — a made-up-looking name is
 * still better than a blank space where the tenant should be, and a super admin
 * holds no org at all.
 */
export function scopeLabel(claims: Claims) {
  if (!claims.orgId) return 'All tenants'

  const words = claims.orgId
    .replace(/^org[_-]/, '')
    .split(/[_-]+/)
    .filter(Boolean)
  if (words.length === 0) return claims.orgId

  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
}
