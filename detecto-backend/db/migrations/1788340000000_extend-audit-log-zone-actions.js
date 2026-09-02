/**
 * Adds zone.renamed/zone.merged — B7d's zones endpoints rewrite access
 * control across cameras, roles, and notification routing in one
 * transaction, which is audit-worthy the same way role/camera/org changes
 * already are (see routes/zones.js). Mirrors the addition into
 * detecto-frontend/src/lib/audit/api.ts's AUDIT_ACTIONS and filter.ts's
 * ACTION_GROUPS/ACTION_LABEL, same as
 * 1788300000000_extend-audit-log-actions.js did for the previous batch.
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
      'auth.logged_in','auth.logged_out'
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
      'zone.renamed','zone.merged'
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
