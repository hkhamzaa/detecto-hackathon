export type Role = 'super_admin' | 'org_admin' | 'member'

const ROLES: string[] = ['super_admin', 'org_admin', 'member']

export type Claims = {
  sub: string
  email: string
  role: Role
  /** Fine-grained grants, e.g. `alerts:confirm`. Drives custom roles. */
  permissions: string[]
  orgId: string | null
  /** Expiry, seconds since epoch. */
  exp: number
}

function base64UrlDecode(input: string) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bytes = Uint8Array.from(atob(b64 + padding), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function isClaims(value: unknown): value is Claims {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.sub === 'string' &&
    typeof c.email === 'string' &&
    typeof c.role === 'string' &&
    ROLES.includes(c.role) &&
    Array.isArray(c.permissions) &&
    c.permissions.every((p) => typeof p === 'string') &&
    (typeof c.orgId === 'string' || c.orgId === null) &&
    typeof c.exp === 'number'
  )
}

/**
 * Reads the payload of an access token.
 *
 * This DECODES; it does not VERIFY. The browser has no signing key and never
 * will. Claims read here decide only what to render and where to route — every
 * real authorisation decision belongs to the backend, on every request. Someone
 * who forges a token gets a nicer-looking menu and a 403 on the first call it
 * makes.
 */
export function decodeClaims(token: string): Claims | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(payload))
    return isClaims(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Super admins hold every grant implicitly; everyone else is explicit. */
export function can(claims: Claims | null, permission: string): boolean {
  if (!claims) return false
  if (claims.role === 'super_admin') return true
  return claims.permissions.includes(permission)
}

export function isExpired(claims: Claims | null, now = Date.now()): boolean {
  if (!claims) return true
  return claims.exp * 1000 <= now
}
