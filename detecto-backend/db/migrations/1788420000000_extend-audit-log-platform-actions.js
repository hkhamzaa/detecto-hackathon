/**
 * Adds platform.tenant_suspended/tenant_reactivated/support_note_changed —
 * B7g's admin (super-admin-only) tenant actions, written into the AFFECTED
 * TENANT's own audit_log (org_id = that tenant's id, not the platform
 * staff member's — a super admin has no org of their own to log into).
 *
 * This is a deliberate design choice, not an oversight: a customer whose
 * account was suspended by Detecto sees that action in their own audit
 * log, same as every other consequential thing that happened to their
 * account — matching pages/admin/support.tsx's own stated intent that a
 * platform action on a tenant belongs in "their audit log where they can
 * see it." The `platform.` prefix (a new group, distinct from `org.`)
 * exists specifically so the log is honest about WHO acted: `org.*` means
 * someone inside the org did this; `platform.*` means Detecto did.
 *
 * Mirrors the addition into detecto-frontend/src/lib/audit/api.ts's
 * AUDIT_ACTIONS and filter.ts's ACTION_GROUPS/ACTION_LABEL, same recipe as
 * the three migrations before this one.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

const PREVIOUS_ACTIONS = `action in (
      'role.created','role.edited','role.deleted',
      'person.invited','person.role_changed','person.deactivated','person.reactivated',
      'camera.added','camera.removed','camera.updated',
      'module.enabled','module.disabled','module.zone_bulk',
      'notifications.routing_changed','notifications.escalation_changed',
      'alert.confirmed','alert.dismissed',
      'org.settings_changed',
      'auth.logged_in','auth.logged_out',
      'zone.renamed','zone.merged',
      'billing.plan_change_requested','billing.plan_change_withdrawn'
    )`;

const EXTENDED_ACTIONS = `action in (
      'role.created','role.edited','role.deleted',
      'person.invited','person.role_changed','person.deactivated','person.reactivated',
      'camera.added','camera.removed','camera.updated',
      'module.enabled','module.disabled','module.zone_bulk',
      'notifications.routing_changed','notifications.escalation_changed',
      'alert.confirmed','alert.dismissed',
      'org.settings_changed',
      'auth.logged_in','auth.logged_out',
      'zone.renamed','zone.merged',
      'billing.plan_change_requested','billing.plan_change_withdrawn',
      'platform.tenant_suspended','platform.tenant_reactivated','platform.support_note_changed'
    )`;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.dropConstraint('audit_log', 'audit_log_action_check');
  pgm.addConstraint('audit_log', 'audit_log_action_check', { check: EXTENDED_ACTIONS });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint('audit_log', 'audit_log_action_check');
  pgm.addConstraint('audit_log', 'audit_log_action_check', { check: PREVIOUS_ACTIONS });
};
