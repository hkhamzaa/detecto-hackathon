/**
 * Mirrors ALL_PERMISSION_KEYS from
 * detecto-frontend/src/lib/roles/permissions.ts. Signup grants every one of
 * these to the org's default Admin role — the same set db/seed.js gives the
 * seeded test org, and the same set lib/roles/api.ts's own mock seeds for a
 * brand-new org.
 */
export const ALL_PERMISSION_KEYS = [
  'cameras:view',
  'alerts:view',
  'alerts:confirm',
  'modules:manage',
  'history:view',
  'analytics:view',
  'audit:view',
  'org:overview',
  'users:manage',
  'billing:manage',
  'org:settings',
];
