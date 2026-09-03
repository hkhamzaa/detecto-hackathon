import { lazy } from 'react'

/**
 * Every page in the app, behind `React.lazy`.
 *
 * `React.lazy` rather than React Router's route-level `lazy` on purpose: a
 * route's `lazy()` runs while the router resolves the match, before any element
 * renders, so the chunk would be fetched and only then refused. These fire on
 * render instead, which puts them behind `<Guarded>` — refuse, and the request
 * is never made.
 *
 * Three area modules, three chunks. Adding a page means adding it to its area's
 * barrel and here; it does not add a chunk.
 */
const admin = () => import('@/routes/areas/admin')
const org = () => import('@/routes/areas/org')
const scoped = () => import('@/routes/areas/scoped')

export const AdminOverview = lazy(() => admin().then((m) => ({ default: m.AdminOverview })))
export const AdminTenants = lazy(() => admin().then((m) => ({ default: m.AdminTenants })))
export const AdminTenantDetail = lazy(() => admin().then((m) => ({ default: m.AdminTenantDetail })))
export const AdminBilling = lazy(() => admin().then((m) => ({ default: m.AdminBilling })))
export const AdminModuleFlags = lazy(() => admin().then((m) => ({ default: m.AdminModuleFlags })))
export const AdminSystemHealth = lazy(() => admin().then((m) => ({ default: m.AdminSystemHealth })))
export const AdminAnalytics = lazy(() => admin().then((m) => ({ default: m.AdminAnalytics })))
export const AdminSupport = lazy(() => admin().then((m) => ({ default: m.AdminSupport })))

export const OrgOverview = lazy(() => org().then((m) => ({ default: m.OrgOverview })))
export const OrgCameras = lazy(() => org().then((m) => ({ default: m.OrgCameras })))
export const OrgCamerasConnect = lazy(() => org().then((m) => ({ default: m.OrgCamerasConnect })))
export const OrgCameraLive = lazy(() => org().then((m) => ({ default: m.OrgCameraLive })))
export const OrgModules = lazy(() => org().then((m) => ({ default: m.OrgModules })))
export const OrgAlerts = lazy(() => org().then((m) => ({ default: m.OrgAlerts })))
export const OrgAlertDetail = lazy(() => org().then((m) => ({ default: m.OrgAlertDetail })))
export const OrgHistory = lazy(() => org().then((m) => ({ default: m.OrgHistory })))
export const OrgUsers = lazy(() => org().then((m) => ({ default: m.OrgUsers })))
export const OrgRoleBuilder = lazy(() => org().then((m) => ({ default: m.OrgRoleBuilder })))
export const OrgAnalytics = lazy(() => org().then((m) => ({ default: m.OrgAnalytics })))
export const OrgBilling = lazy(() => org().then((m) => ({ default: m.OrgBilling })))
export const OrgSettings = lazy(() => org().then((m) => ({ default: m.OrgSettings })))
export const OrgNotifications = lazy(() => org().then((m) => ({ default: m.OrgNotifications })))
export const OrgProfile = lazy(() => org().then((m) => ({ default: m.OrgProfile })))
export const OrgSecurity = lazy(() => org().then((m) => ({ default: m.OrgSecurity })))
export const OrgZones = lazy(() => org().then((m) => ({ default: m.OrgZones })))
export const OrgAuditLog = lazy(() => org().then((m) => ({ default: m.OrgAuditLog })))

export const AlertQueue = lazy(() => scoped().then((m) => ({ default: m.AlertQueue })))
export const AlertDetail = lazy(() => scoped().then((m) => ({ default: m.AlertDetail })))
export const Cameras = lazy(() => scoped().then((m) => ({ default: m.Cameras })))

/** Belongs to no area — anyone signed in can land here — so it stands alone. */
export const NoAccess = lazy(() => import('@/pages/no-access'))

/**
 * Also no area: everybody signed in has an account, including somebody holding
 * no grants at all. Its own chunk for the same reason — an operator should not
 * download the org area to change their own password.
 */
export const Account = lazy(() => import('@/pages/account'))
