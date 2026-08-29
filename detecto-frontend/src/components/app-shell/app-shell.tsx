import { Suspense, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { AppHeader } from '@/components/app-shell/app-header'
import { NavDrawer } from '@/components/app-shell/nav-drawer'
import { SidebarNav } from '@/components/app-shell/sidebar-nav'
import { navFor } from '@/lib/auth/nav'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { useUiStore } from '@/store/ui-store'

/**
 * The signed-in shell: Ink chrome around a Paper content surface, the same
 * split the style guide establishes. Chrome regions carry `dark` so shadcn
 * primitives invert in place rather than needing chrome-specific variants.
 *
 * The sidebar is built from `navFor(claims)`, which returns only routes this
 * person holds a grant for. Someone with no area at all — see `/no-access` —
 * gets header and content only; there is no empty sidebar to explain.
 */
export function AppShell() {
  const claims = useAuthStore((s) => s.claims)
  const closeNav = useUiStore((s) => s.closeNav)
  const location = useLocation()

  const area = navFor(claims)
  const hasNav = area !== null && area.items.length > 0

  const contentRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  // A route change puts focus at the top of the new page rather than leaving
  // keyboard and screen-reader users where the last page ended. Same pattern as
  // the signup and login step containers.
  useEffect(() => {
    closeNav()
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    contentRef.current?.focus()
    window.scrollTo({ top: 0 })
  }, [location.pathname, closeNav])

  // `RequireSession` has already redirected a missing session away from here.
  // This is the same statement at the type level, and is not reached.
  if (!claims) return null

  return (
    <div className="min-h-dvh bg-ink">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2 focus:text-meta focus:text-ink"
      >
        Skip to content
      </a>

      <AppHeader claims={claims} area={area} />

      <div className={cn('lg:grid', hasNav && 'lg:grid-cols-[15rem_1fr]')}>
        {hasNav && (
          <aside className="dark sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r border-ink-hairline bg-ink px-3 py-6 lg:block">
            <SidebarNav area={area} />
          </aside>
        )}

        <main
          id="content"
          className="min-h-[calc(100dvh-3.5rem)] min-w-0 bg-paper text-ink"
        >
          <div
            ref={contentRef}
            tabIndex={-1}
            className="mx-auto max-w-4xl px-5 py-10 outline-none sm:px-8 sm:py-14 lg:px-12"
          >
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      {hasNav && <NavDrawer area={area} claims={claims} />}
    </div>
  )
}

/** Shown only while an area's chunk is in flight. Deliberately unremarkable. */
function RouteFallback() {
  return (
    <div role="status" aria-live="polite" className="py-6">
      <p className="label-micro text-neutral-500">Loading…</p>
    </div>
  )
}
