import { refresh } from '@/lib/auth/api'
import { useAuthStore } from '@/store/auth-store'

const API_PREFIX = '/api/'
const AUTH_PREFIX = '/api/auth/'

let refreshInFlight: Promise<boolean> | null = null

/**
 * Runs the refresh call at most once at a time, no matter how many callers
 * ask concurrently. A burst of 401s from several requests in flight at once
 * (or the fetch interceptor below racing `bootstrapSession` on first load)
 * must not fire a burst of rotations against a token that's only ever good
 * for one — see `rotateRefreshToken` in the backend for why a second use
 * of the same token is treated as a problem, not a no-op.
 */
function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = attemptRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function attemptRefresh(): Promise<boolean> {
  const result = await refresh()
  if (!result.ok) {
    useAuthStore.getState().signOut()
    return false
  }
  useAuthStore.getState().signIn(result.accessToken)
  return true
}

/**
 * Called once, before the router ever renders — see `main.tsx`. This is
 * the "boot seam" `store/auth-store.ts` describes: a reload has nothing in
 * memory, so the only way to resume a real session is to ask the backend,
 * via the httpOnly cookie, before `RequireSession` gets a chance to decide
 * there's no one signed in.
 */
export function bootstrapSession(): Promise<boolean> {
  return refreshOnce()
}

function apiPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  try {
    const { pathname } = new URL(raw, window.location.origin)
    return pathname.startsWith(API_PREFIX) ? pathname : null
  } catch {
    return null
  }
}

function withFreshAuthorization(init: RequestInit | undefined): RequestInit | undefined {
  const token = useAuthStore.getState().accessToken
  if (!token) return init
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

type WrappedFetch = typeof fetch & { __detectoSessionRefresh?: true }

/**
 * Installs a one-time global `fetch` interceptor: on a 401 from any
 * `/api/...` call (other than `/api/auth/*` itself, which would loop), it
 * attempts one silent refresh and retries the original request once with
 * the new access token. On refresh failure, it signs out and lets the 401
 * fall through to whatever that call site already does with a failed
 * response — every `api.ts` module under `lib/` already has a "not ok" branch,
 * and `RequireSession` (routes/guard.tsx) picks up the resulting
 * `signOut()` the same way it would from a real session ever expiring.
 *
 * This wraps the platform's `fetch` rather than introducing a shared HTTP
 * client: every existing `api.ts` module under `lib/` builds and calls
 * `fetch` directly, each with its own URL, method, and body (see e.g.
 * `alerts/api.ts`). Routing all of them through a new client would be a far
 * larger change than intercepting the one thing they already all share —
 * and it leaves the access-token contract (memory-only, attached per call
 * via each module's own `authHeaders()`) completely untouched.
 */
export function installSessionRefresh() {
  if ((window.fetch as WrappedFetch).__detectoSessionRefresh) return
  const originalFetch = window.fetch.bind(window)

  const wrapped: WrappedFetch = async (input, init) => {
    const response = await originalFetch(input, init)

    const path = apiPath(input)
    if (!path || path.startsWith(AUTH_PREFIX) || response.status !== 401) {
      return response
    }
    // No token in memory means this 401 was never about an expired
    // session — an anonymous call, or one that raced ahead of boot's own
    // refresh — and retrying it can't change that.
    if (!useAuthStore.getState().accessToken) return response

    const refreshed = await refreshOnce()
    if (!refreshed) return response

    return originalFetch(input, withFreshAuthorization(init))
  }
  wrapped.__detectoSessionRefresh = true

  window.fetch = wrapped
}
