import {
  Activity,
  Bell,
  Boxes,
  Building2,
  Cctv,
  ChartLine,
  CreditCard,
  Gauge,
  History,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  Settings,
  ToggleRight,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { can, type Claims } from '@/lib/auth/claims'
import { landingPathFor } from '@/lib/auth/redirect'
import { DEMO_MODE } from '@/lib/config/demo'

/**
 * The navigation model, and the only gate on it.
 *
 * Two rules hold this together, and nothing else decides what a person sees:
 *
 *   1. Which area someone belongs to is read straight off `landingPathFor` —
 *      whichever area owns the path they land on after signing in. That keeps
 *      the login redirect and the sidebar from ever drifting apart, and means
 *      adding a role still touches exactly one file (`redirect.ts`).
 *   2. Which items inside that area are visible is `can()`, item by item.
 *
 * `canVisit` is what the route guard calls, so a route a person cannot reach by
 * clicking is the same route they cannot reach by typing. There is no second
 * list to keep in sync, and no permission logic re-implemented here.
 *
 * None of this is security. The backend authorises every request; this decides
 * what to draw. See the note in `claims.ts`.
 */

export type AreaId = 'admin' | 'org' | 'scoped'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** A grant, or several — holding any one of them shows the item. */
  permission: string | string[]
  /** Hidden (not deleted) when the hackathon demo flag is on. */
  hiddenInDemo?: boolean
}

export type NavArea = {
  id: AreaId
  /** Sidebar heading, and the scope shown in the header. */
  title: string
  items: NavItem[]
}

/**
 * Areas are mutually exclusive by design: a person is in exactly one. Super
 * admins hold every grant implicitly, so nothing but this separation stops the
 * platform area and a tenant's area appearing at once — and a tenant's surfaces
 * belong to the tenant, not to whoever is looking at the platform.
 */
const AREAS: NavArea[] = [
  {
    id: 'admin',
    title: 'Platform',
    items: [
      { to: '/admin/overview', label: 'Overview', icon: Gauge, permission: 'admin:overview' },
      { to: '/admin/tenants', label: 'Tenants', icon: Building2, permission: 'admin:tenants' },
      { to: '/admin/billing', label: 'Billing', icon: CreditCard, permission: 'admin:billing' },
      { to: '/admin/module-flags', label: 'Module flags', icon: ToggleRight, permission: 'admin:modules' },
      { to: '/admin/system-health', label: 'System health', icon: Activity, permission: 'admin:health', hiddenInDemo: true },
      { to: '/admin/analytics', label: 'Analytics', icon: ChartLine, permission: 'admin:analytics' },
      { to: '/admin/support', label: 'Support', icon: LifeBuoy, permission: 'admin:support' },
    ],
  },
  {
    id: 'org',
    title: 'Organisation',
    items: [
      { to: '/org/overview', label: 'Overview', icon: LayoutDashboard, permission: 'org:overview' },
      { to: '/org/cameras', label: 'Cameras', icon: Cctv, permission: 'cameras:view' },
      { to: '/org/modules', label: 'Detection modules', icon: Boxes, permission: 'modules:manage' },
      { to: '/org/alerts', label: 'Alerts', icon: Bell, permission: 'alerts:view' },
      { to: '/org/history', label: 'History', icon: History, permission: 'history:view' },
      { to: '/org/users', label: 'People', icon: Users, permission: 'users:manage' },
      { to: '/org/analytics', label: 'Analytics', icon: ChartLine, permission: 'analytics:view' },
      { to: '/org/billing', label: 'Billing', icon: CreditCard, permission: 'billing:manage' },
      { to: '/org/settings', label: 'Settings', icon: Settings, permission: 'org:settings' },
      { to: '/org/audit-log', label: 'Audit log', icon: ScrollText, permission: 'audit:view' },
    ],
  },
  {
    id: 'scoped',
    // Control-room word, and the honest one: these people are on watch.
    title: 'Watch',
    items: [
      {
        to: '/alerts',
        label: 'Alert queue',
        icon: Bell,
        // Confirming implies seeing. Either grant reaches the queue.
        permission: ['alerts:confirm', 'alerts:view'],
      },
      { to: '/cameras', label: 'Cameras', icon: Cctv, permission: 'cameras:view' },
    ],
  },
]

/** `can()`, quantified. The item's grants are alternatives, not requirements. */
function permits(claims: Claims | null, permission: NavItem['permission']) {
  return Array.isArray(permission)
    ? permission.some((p) => can(claims, p))
    : can(claims, permission)
}

/**
 * The person's area, with only the items they hold a grant for. `null` when
 * their claims place them in no area at all — see `/no-access`.
 */
export function navFor(claims: Claims | null): NavArea | null {
  if (!claims) return null

  const landing = landingPathFor(claims)
  const area = AREAS.find((a) => a.items.some((item) => item.to === landing))
  if (!area) return null

  return {
    ...area,
    items: area.items.filter(
      (item) => permits(claims, item.permission) && !(DEMO_MODE && item.hiddenInDemo),
    ),
  }
}

/** True only for routes that would also appear in this person's sidebar. */
export function canVisit(claims: Claims | null, path: string): boolean {
  return navFor(claims)?.items.some((item) => item.to === path) ?? false
}

/**
 * Where a refused visit goes. Never back to the page just refused, and never to
 * a landing path the person cannot reach either — both are redirect loops.
 */
export function redirectAfterDenial(claims: Claims | null): string {
  if (!claims) return '/login'
  const landing = landingPathFor(claims)
  return canVisit(claims, landing) ? landing : '/no-access'
}
