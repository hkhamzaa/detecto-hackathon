import type { Role } from '@/lib/auth/claims'
import { USE_MOCKS } from '@/lib/config/mocks'

export type LoginRequest = {
  email: string
  password: string
  /** Asks the backend for a longer-lived refresh cookie. Never stored here. */
  remember: boolean
}

export type LoginResult =
  | { ok: true; accessToken: string }
  | { ok: false; code: 'invalid_credentials' }
  | { ok: false; code: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; code: 'mfa_required'; challengeId: string }
  | { ok: false; code: 'unavailable' }

export type ResetResult = { ok: true } | { ok: false; code: 'unavailable' }

export type RefreshResult = { ok: true; accessToken: string } | { ok: false }

const DEFAULT_LOCKOUT_SECONDS = 900

export function login(body: LoginRequest): Promise<LoginResult> {
  return USE_MOCKS ? mockLogin(body) : realLogin(body)
}

/**
 * Silent refresh: exchanges the httpOnly refresh cookie for a new access
 * token, no credentials involved. Called on app boot (a reload has nothing
 * in memory) and by the fetch interceptor in `lib/auth/http.ts` on a 401
 * from any other endpoint.
 *
 * Never surfaces *why* it failed (expired, revoked, missing cookie, network
 * down) — every caller's response is the same either way: there is no
 * session, fall back to whatever a signed-out visitor sees.
 */
export function refresh(): Promise<RefreshResult> {
  return USE_MOCKS ? mockRefresh() : realRefresh()
}

export function requestPasswordReset(email: string): Promise<ResetResult> {
  return USE_MOCKS ? mockReset() : realReset(email)
}

/**
 * Ends the session on the server. Deliberately returns nothing and never
 * rejects: the caller drops the in-memory token either way, so there is no
 * outcome here a person signing out could act on. Only the backend can revoke
 * the session and clear the httpOnly refresh cookie, which is why the call is
 * made at all rather than skipped.
 */
export function logout(): Promise<void> {
  return USE_MOCKS ? mockLogout() : realLogout()
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

async function realLogin(body: LoginRequest): Promise<LoginResult> {
  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Required so the backend can set the httpOnly refresh cookie. The
      // refresh token must never appear in the response body.
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 429) {
    return {
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: retryAfterFrom(response),
    }
  }
  // 401 covers unknown email and wrong password alike — the backend must not
  // distinguish them, and neither does anything downstream of here.
  if (response.status === 401) return { ok: false, code: 'invalid_credentials' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null) {
    return { ok: false, code: 'unavailable' }
  }

  const payload = data as Record<string, unknown>
  if (payload.mfaRequired === true && typeof payload.challengeId === 'string') {
    return { ok: false, code: 'mfa_required', challengeId: payload.challengeId }
  }
  if (typeof payload.accessToken !== 'string') {
    return { ok: false, code: 'unavailable' }
  }
  return { ok: true, accessToken: payload.accessToken }
}

/**
 * One refresh attempt. `'race'` is a third outcome, distinct from
 * `{ ok: false }`, but it never leaves this file — see `realRefresh()`.
 */
async function attemptRealRefresh(): Promise<RefreshResult | 'race'> {
  let response: Response
  try {
    response = await fetch('/api/auth/refresh', {
      method: 'POST',
      // The only thing this request carries is the httpOnly cookie —
      // nothing readable by this code decides whether it succeeds.
      credentials: 'include',
    })
  } catch {
    return { ok: false }
  }

  // The backend's way of saying "a sibling request for this account —
  // another tab, or an overlapping page load — already rotated this exact
  // cookie a moment ago, and the account has a live session right now
  // because of it" (routes/auth.js's 'rotation_race'). Not a failed
  // session: the sibling's own response already carries the valid
  // replacement cookie. See `realRefresh()` for the retry this triggers.
  if (response.status === 409) return 'race'

  if (!response.ok) return { ok: false }

  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null) return { ok: false }
  const payload = data as Record<string, unknown>
  if (typeof payload.accessToken !== 'string') return { ok: false }
  return { ok: true, accessToken: payload.accessToken }
}

/**
 * Retries exactly once on a benign rotation race, entirely internally —
 * `refresh()`'s contract to every caller (`attemptRefresh` in
 * `lib/auth/session.ts`, and indirectly the fetch interceptor there) stays
 * "never surfaces why it failed." A short pause first, so the browser has
 * a moment to have actually applied the sibling's Set-Cookie response
 * before this presents whatever cookie is currently in the jar; without
 * it, a retry fired before that lands could re-present the very cookie
 * that just lost, and see the same race again. One retry, not a loop: if
 * the second attempt is also a race, this gives up rather than spin —
 * whatever a signed-out visitor sees is the honest state at that point.
 */
async function realRefresh(): Promise<RefreshResult> {
  const first = await attemptRealRefresh()
  if (first !== 'race') return first

  await new Promise((resolve) => setTimeout(resolve, 100))
  const retried = await attemptRealRefresh()
  return retried === 'race' ? { ok: false } : retried
}

async function realReset(email: string): Promise<ResetResult> {
  try {
    // Any completed response is treated the same. The screen must not reveal
    // whether an account exists, so only a transport failure is reported.
    await fetch('/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return { ok: true }
  } catch {
    return { ok: false, code: 'unavailable' }
  }
}

async function realLogout(): Promise<void> {
  try {
    // Same cookie requirement as login, for the opposite reason: the backend
    // needs the refresh cookie in order to revoke it and send it back expired.
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    // Nothing to recover. The local session ends regardless; a server-side
    // session that outlives it dies at the access token's expiry.
  }
}

function retryAfterFrom(response: Response) {
  const header = Number(response.headers.get('Retry-After'))
  return Number.isFinite(header) && header > 0 ? header : DEFAULT_LOCKOUT_SECONDS
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/auth is live                                   */
/* -------------------------------------------------------------------------- */

/** Any email works. The role is taken from the part before the @. */
const MOCK_ATTEMPT_LIMIT = 5

/**
 * The password the mock accepts, as session state rather than a constant.
 *
 * Mutable, and exported through the two seams below, so that changing your
 * password on the account page actually changes what signing in accepts for the
 * rest of the session. A constant here would mean the account page reporting
 * success while login carried on taking the old one — two mocks disagreeing
 * about the same fact, which is the failure `MOCK_CATALOGUE` exists to prevent
 * between the module pages.
 *
 * Both are dev mocks; they are deleted together when `/api/auth` is live.
 */
let mockPassword = 'detecto-demo'

export function mockCurrentPassword() {
  return mockPassword
}

export function mockSetPassword(next: string) {
  mockPassword = next
}

let mockFailures = 0

async function mockLogin(body: LoginRequest): Promise<LoginResult> {
  await new Promise((resolve) => setTimeout(resolve, 450))

  if (mockFailures >= MOCK_ATTEMPT_LIMIT) {
    return {
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: DEFAULT_LOCKOUT_SECONDS,
    }
  }
  if (body.password !== mockPassword) {
    mockFailures += 1
    return { ok: false, code: 'invalid_credentials' }
  }

  mockFailures = 0
  return { ok: true, accessToken: mockToken(body.email) }
}

async function mockReset(): Promise<ResetResult> {
  await new Promise((resolve) => setTimeout(resolve, 450))
  return { ok: true }
}

/**
 * There is no mock backend and no cookie jar behind this dev transport —
 * every mock's state is a plain JS module variable, which a reload wipes
 * just as thoroughly as it wipes the access token in `auth-store.ts`. So
 * unlike the real refresh cookie, a mock "session" simply doesn't survive a
 * reload: this always fails, same as it would on a first, never-logged-in
 * visit. Mock mode's login form still works exactly as before; only the
 * hard-reload-stays-signed-in behavior needs the real backend to observe.
 */
async function mockRefresh(): Promise<RefreshResult> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  return { ok: false }
}

async function mockLogout(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200))
  // The lockout counter is server state in the real thing, so it goes with the
  // session rather than surviving into the next sign-in on this tab.
  mockFailures = 0
}

function mockToken(email: string) {
  const local = email.split('@')[0]?.toLowerCase() ?? ''

  let role: Role = 'member'
  let permissions = ['alerts:view', 'alerts:confirm', 'cameras:view']
  if (local.startsWith('super')) {
    role = 'super_admin'
    permissions = []
  } else if (local.startsWith('admin')) {
    role = 'org_admin'
    // The full org grant set. Kept in step with the org area in `nav.ts` by
    // hand, because the real backend — not this file — will issue it.
    permissions = [
      'org:overview',
      'cameras:view',
      'modules:manage',
      'alerts:view',
      'alerts:confirm',
      'history:view',
      'users:manage',
      'analytics:view',
      'billing:manage',
      'org:settings',
      'audit:view',
    ]
  } else if (local.startsWith('viewer')) {
    permissions = ['cameras:view']
  } else if (local.startsWith('nobody')) {
    permissions = []
  }

  const payload = {
    sub: `usr_${local || 'anon'}`,
    email,
    role,
    permissions,
    orgId: role === 'super_admin' ? null : 'org_northgate',
    exp: Math.floor(Date.now() / 1000) + 900,
  }

  return [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url(payload),
    'mock-signature-not-verified',
  ].join('.')
}

function base64Url(value: object) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
