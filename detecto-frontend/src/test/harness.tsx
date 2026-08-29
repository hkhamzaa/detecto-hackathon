import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import type { Claims, Role } from '@/lib/auth/claims'
import { useAuthStore } from '@/store/auth-store'

/**
 * What a page needs around it to render: a session, a query cache, and a route.
 *
 * Pages are rendered rather than their inner sections wherever possible,
 * because the parts worth protecting — the permission gate, the loading and
 * error branches, the choice between a chart and a "not enough data" panel —
 * live in the page, not in the section it eventually calls.
 *
 * The query cache is seeded rather than fetched. Every transport mock under
 * `lib` sleeps for a few hundred milliseconds on purpose, and a suite that
 * waited for that would spend most of its time asleep to prove nothing extra.
 * The mocks are exercised directly in the `lib` suites instead.
 */

function claimsFor(role: Role, permissions: string[]): Claims {
  return {
    sub: `usr_${role}`,
    email: `${role}@detecto.test`,
    role,
    permissions,
    orgId: role === 'super_admin' ? null : 'org_northgate',
    exp: Math.floor(Date.now() / 1000) + 900,
  }
}

/** Holds every grant implicitly — see `can()` in `lib/auth/claims.ts`. */
export const SUPER_ADMIN = claimsFor('super_admin', [])

/** Signed in, granted nothing. The permission-gate branch of every page. */
export const NO_GRANTS = claimsFor('member', [])

export function signIn(claims: Claims | null) {
  useAuthStore.setState({
    accessToken: claims ? 'test-token-not-verified' : null,
    claims,
  })
}

export function signOut() {
  useAuthStore.setState({ accessToken: null, claims: null })
}

export function renderPage(
  element: ReactElement,
  {
    path = '/',
    route = '/',
    seed,
  }: {
    /** The entry to render at, including any query string. */
    path?: string
    /** The route pattern, when the page reads params — e.g. `/tenants/:id`. */
    route?: string
    /** Put data in the cache so the page renders its success state. */
    seed?: (client: QueryClient) => void
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  seed?.(client)

  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return {
    ...view,
    client,
    /** Read as a function, so it reflects the DOM after an interaction. */
    html: () => view.container.innerHTML,
    /** Rendered text with runs of whitespace collapsed, for copy assertions. */
    text: () => (view.container.textContent ?? '').replace(/\s+/g, ' '),
  }
}
