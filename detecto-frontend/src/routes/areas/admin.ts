/**
 * The super-admin area as a single module.
 *
 * Every admin route imports from here and nowhere else, so the bundler emits
 * one chunk for the whole area — the pages have no other importer to be shared
 * with. Nothing outside this file references these pages statically, which is
 * what keeps admin code out of an org admin's or an operator's download.
 */
export { default as AdminOverview } from '@/pages/admin/overview'
export { default as AdminTenants } from '@/pages/admin/tenants'
export { default as AdminTenantDetail } from '@/pages/admin/tenants/detail'
export { default as AdminBilling } from '@/pages/admin/billing'
export { default as AdminModuleFlags } from '@/pages/admin/module-flags'
export { default as AdminSystemHealth } from '@/pages/admin/system-health'
export { default as AdminAnalytics } from '@/pages/admin/analytics'
export { default as AdminSupport } from '@/pages/admin/support'
