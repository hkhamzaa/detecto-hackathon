import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refresh } from '@/lib/auth/api'
import { bootstrapSession, installSessionRefresh } from '@/lib/auth/session'
import { useAuthStore } from '@/store/auth-store'

vi.mock('@/lib/auth/api', () => ({ refresh: vi.fn() }))

/**
 * No `resetModules` here on purpose: `session.ts`'s only cross-test state is
 * `refreshInFlight`, which is a module-level `let` that already resets
 * itself to `null` (via `.finally()`) the moment any in-flight refresh
 * settles — every test below awaits that before it ends. The "already
 * wrapped" marker `installSessionRefresh` checks lives on whatever function
 * `window.fetch` currently points at, and every test replaces that with a
 * fresh `vi.fn()` before calling it, so there's nothing stale to reset
 * there either. Reloading the module (as most `lib` suites do) would only
 * add a second, disconnected instance of the mocked `refresh` — the
 * fresh-import `session.ts` picks up wouldn't be the one `vi.mocked(refresh)`
 * below configures.
 */

function tokenFor(exp: number) {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      sub: 'usr_1',
      email: 'a@b.com',
      role: 'member',
      permissions: [],
      orgId: 'org_1',
      exp,
    }),
  )
  return `${header}.${payload}.sig`
}

const OLD_TOKEN = tokenFor(0)
const NEW_TOKEN = tokenFor(9_999_999_999)

let originalFetch: typeof fetch

beforeEach(() => {
  originalFetch = window.fetch
  useAuthStore.setState({ accessToken: null, claims: null })
  vi.mocked(refresh).mockReset()
})

afterEach(() => {
  window.fetch = originalFetch
})

describe('the fetch interceptor', () => {
  it('refreshes once and retries a 401 from an ordinary /api call', async () => {
    useAuthStore.setState({ accessToken: OLD_TOKEN, claims: null })
    vi.mocked(refresh).mockResolvedValue({ ok: true, accessToken: NEW_TOKEN })

    const calls: Array<{ url: string; auth: string | null }> = []
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : String(input)
      const auth = new Headers(init?.headers).get('Authorization')
      calls.push({ url, auth })
      const status = auth === `Bearer ${NEW_TOKEN}` ? 200 : 401
      return new Response(status === 200 ? '{"ok":true}' : '{}', { status })
    })

    installSessionRefresh()

    const response = await fetch('/api/alerts', {
      headers: { Authorization: `Bearer ${OLD_TOKEN}` },
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([
      { url: '/api/alerts', auth: `Bearer ${OLD_TOKEN}` },
      { url: '/api/alerts', auth: `Bearer ${NEW_TOKEN}` },
    ])
    // The retry carries the token the store now holds — refresh() ran, and
    // its result was signed in before the retry was built.
    expect(useAuthStore.getState().accessToken).toBe(NEW_TOKEN)
  })

  it('never refreshes a 401 from /api/auth/* itself, to avoid looping on a bad login', async () => {
    useAuthStore.setState({ accessToken: OLD_TOKEN, claims: null })
    vi.mocked(refresh).mockResolvedValue({ ok: true, accessToken: NEW_TOKEN })

    const fetchMock = vi.fn(async () => new Response('{"error":"invalid_credentials"}', { status: 401 }))
    window.fetch = fetchMock

    installSessionRefresh()

    const response = await fetch('/api/auth/login', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves an anonymous 401 alone — nothing in memory means nothing to refresh', async () => {
    // accessToken stays null: e.g. a call made before boot's own refresh
    // resolved, or a route that never required a session.
    window.fetch = vi.fn(async () => new Response('{}', { status: 401 }))

    installSessionRefresh()

    const response = await fetch('/api/alerts')

    expect(response.status).toBe(401)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('collapses concurrent 401s into a single refresh call', async () => {
    useAuthStore.setState({ accessToken: OLD_TOKEN, claims: null })

    let resolveRefresh: (v: Awaited<ReturnType<typeof refresh>>) => void
    vi.mocked(refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      }),
    )

    window.fetch = vi.fn(async (_input, init) => {
      const auth = new Headers(init?.headers).get('Authorization')
      const status = auth === `Bearer ${NEW_TOKEN}` ? 200 : 401
      return new Response('{}', { status })
    })

    installSessionRefresh()

    const first = fetch('/api/alerts', { headers: { Authorization: `Bearer ${OLD_TOKEN}` } })
    const second = fetch('/api/cameras', { headers: { Authorization: `Bearer ${OLD_TOKEN}` } })

    // Let both calls' initial 401 round trip (and their call into refreshOnce)
    // fully drain before the shared refresh resolves — a macrotask tick
    // guarantees every microtask queued by either call has already run,
    // however many ticks that actually takes.
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolveRefresh!({ ok: true, accessToken: NEW_TOKEN })

    const [firstResponse, secondResponse] = await Promise.all([first, second])

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('bootstrapSession', () => {
  it('signs in when the httpOnly cookie still resolves to a session', async () => {
    vi.mocked(refresh).mockResolvedValue({ ok: true, accessToken: NEW_TOKEN })

    const ok = await bootstrapSession()

    expect(ok).toBe(true)
    expect(useAuthStore.getState().accessToken).toBe(NEW_TOKEN)
    expect(useAuthStore.getState().claims).not.toBeNull()
  })

  it('signs out (harmlessly) when there is no session to resume', async () => {
    vi.mocked(refresh).mockResolvedValue({ ok: false })

    const ok = await bootstrapSession()

    expect(ok).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})
