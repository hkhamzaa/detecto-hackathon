import type { ComponentType } from 'react'
import { createBrowserRouter, Link, Navigate, type RouteObject } from 'react-router-dom'

import { AppShell } from '@/components/app-shell/app-shell'
import { landingPathFor } from '@/lib/auth/redirect'
import { Guarded, RequireSession } from '@/routes/guard'
import * as pages from '@/routes/lazy'
import { useAuthStore } from '@/store/auth-store'

/**
 * Public routes at the top, then one shell that everything signed-in hangs off.
 *
 * Route groups are split by role area — `/admin`, `/org`, and the
 * permission-scoped member surfaces — and each area is one lazy chunk. The
 * `<Guarded>` wrapper decides before the chunk is requested, so a lower-
 * permission account never downloads a higher-permission area's code. See
 * `routes/lazy.ts` for why that needs `React.lazy` rather than route `lazy`.
 *
 * Which routes a person may reach is not restated here: `canVisit` in
 * `lib/auth/nav.ts` answers it, and the sidebar is built from the same call.
 */

/**
 * One route, gated on the same grant that decides whether it appears in nav.
 *
 * `gate` is for a route that has no nav item of its own — a flow that lives
 * under one, like the camera wizard. It is admitted by the item it sits beneath
 * rather than by a rule written twice.
 */
function guarded(path: string, Page: ComponentType, gate = path): RouteObject {
  return {
    path,
    element: (
      <Guarded path={gate}>
        <Page />
      </Guarded>
    ),
  }
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    path: '/style-guide',
    lazy: async () => {
      const { default: Component } = await import('@/pages/style-guide')
      return { Component }
    },
  },
  // Public: reachable before a session exists.
  {
    path: '/signup',
    lazy: async () => {
      const { default: Component } = await import('@/pages/signup')
      return { Component }
    },
  },
  {
    path: '/login',
    lazy: async () => {
      const { default: Component } = await import('@/pages/login')
      return { Component }
    },
  },
  {
    path: '/forgot-password',
    lazy: async () => {
      const { default: Component } = await import('@/pages/forgot-password')
      return { Component }
    },
  },

  // Everything below is inside the signed-in shell.
  {
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      // Super admin — the platform itself.
      guarded('/admin/overview', pages.AdminOverview),
      guarded('/admin/tenants', pages.AdminTenants),
      guarded('/admin/tenants/:id', pages.AdminTenantDetail, '/admin/tenants'),
      guarded('/admin/billing', pages.AdminBilling),
      guarded('/admin/module-flags', pages.AdminModuleFlags),
      guarded('/admin/system-health', pages.AdminSystemHealth),
      guarded('/admin/analytics', pages.AdminAnalytics),
      guarded('/admin/support', pages.AdminSupport),

      // Org admin — one tenant, everything in it.
      guarded('/org/overview', pages.OrgOverview),
      guarded('/org/cameras', pages.OrgCameras),
      guarded('/org/cameras/connect', pages.OrgCamerasConnect, '/org/cameras'),
      guarded('/org/cameras/:id/live', pages.OrgCameraLive, '/org/cameras'),
      guarded('/org/modules', pages.OrgModules),
      guarded('/org/alerts', pages.OrgAlerts),
      guarded('/org/alerts/:id', pages.OrgAlertDetail, '/org/alerts'),
      guarded('/org/history', pages.OrgHistory),
      guarded('/org/users', pages.OrgUsers),
      guarded('/org/users/roles/new', pages.OrgRoleBuilder, '/org/users'),
      guarded('/org/users/roles/:id', pages.OrgRoleBuilder, '/org/users'),
      guarded('/org/analytics', pages.OrgAnalytics),
      guarded('/org/billing', pages.OrgBilling),
      guarded('/org/settings', pages.OrgSettings),
      guarded('/org/settings/notifications', pages.OrgNotifications, '/org/settings'),
      guarded('/org/settings/profile', pages.OrgProfile, '/org/settings'),
      guarded('/org/settings/security', pages.OrgSecurity, '/org/settings'),
      guarded('/org/settings/zones', pages.OrgZones, '/org/settings'),
      guarded('/org/audit-log', pages.OrgAuditLog),

      // Members — reached by grant, not by role.
      guarded('/alerts', pages.AlertQueue),
      guarded('/alerts/:id', pages.AlertDetail, '/alerts'),
      guarded('/cameras', pages.Cameras),

      // Signed in, granted nothing. Ungated on purpose: this is where the
      // guards send people, so it can never be one of the things they refuse.
      { path: '/no-access', element: <pages.NoAccess /> },

      /*
       * Your own account. Ungated for a different reason: `Guarded` asks
       * `canVisit`, which answers from the person's navigation area, and this
       * page belongs to none of them — everybody signed in has an account,
       * including somebody holding no grants at all. Gating it would make the
       * one page that is unarguably theirs the one they could not open.
       *
       * Reached from the header rather than a sidebar, since there is no area
       * whose sidebar it would belong in.
       */
      { path: '/account', element: <pages.Account /> },
    ],
  },

  {
    path: '*',
    element: <NotFound />,
  },
])

/** `/` is not a page. It asks the same function login asks, and defers. */
function RootRedirect() {
  const claims = useAuthStore((s) => s.claims)
  return <Navigate to={landingPathFor(claims)} replace />
}

function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-6 text-center">
      <div>
        <p className="label-micro text-neutral-500">404</p>
        <h1 className="mt-3 font-display text-display-md font-medium text-paper">
          No such route
        </h1>
        <Link
          to="/"
          className="mt-5 inline-block text-meta text-neutral-400 underline underline-offset-4 hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to Detecto
        </Link>
      </div>
    </main>
  )
}
