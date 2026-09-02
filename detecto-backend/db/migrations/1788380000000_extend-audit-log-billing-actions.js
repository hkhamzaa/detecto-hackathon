/**
 * Adds billing.plan_change_requested/billing.plan_change_withdrawn — B7f's
 * org-scoped subscription endpoints (see routes/subscription.js). A plan
 * change is exactly the kind of consequential, reviewable action every
 * other module in this table already tracks. Mirrors the addition into
 * detecto-frontend/src/lib/audit/api.ts's AUDIT_ACTIONS and filter.ts's
 * ACTION_GROUPS/ACTION_LABEL, same recipe as the two migrations before this
 * one.
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
      'zone.renamed','zone.merged'
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
      'billing.plan_change_requested','billing.plan_change_withdrawn'
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
