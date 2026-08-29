import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { isExpired } from '@/lib/auth/claims'
import { canVisit, redirectAfterDenial } from '@/lib/auth/nav'
import { useAuthStore } from '@/store/auth-store'

/**
 * No session, no shell. The access token lives in memory only, so a reload
 * lands here — until the refresh call described in `auth-store.ts` exists, that
 * is a trip back to /login rather than a resumed session.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const claims = useAuthStore((s) => s.claims)
  if (!claims || isExpired(claims)) return <Navigate to="/login" replace />
  return <>{children}</>
}

/**
 * The gate on a single route, asked of the same function that builds the
 * sidebar — so what a person cannot click, they also cannot type.
 *
 * `children` is an element, not a rendered component: when this refuses, the
 * page's `lazy()` factory is never called and the area's chunk is never
 * requested. That is what keeps a member's bundle free of admin code, rather
 * than downloading it and then declining to show it.
 */
export function Guarded({ path, children }: { path: string; children: ReactNode }) {
  const claims = useAuthStore((s) => s.claims)
  if (!canVisit(claims, path)) {
    return <Navigate to={redirectAfterDenial(claims)} replace />
  }
  return <>{children}</>
}
