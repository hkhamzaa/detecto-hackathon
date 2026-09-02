/**
 * Adds the four action types the write side needed once real routes started
 * logging (see detecto-backend/api/src/lib/audit.js): camera edits weren't
 * distinguishable from camera.added/removed, and org-settings changes and
 * sign-in/out had no action group at all. Mirrors the addition into
 * detecto-frontend/src/lib/audit/api.ts's AUDIT_ACTIONS and filter.ts's
 * ACTION_GROUPS/ACTION_LABEL — the two lists are meant to stay identical,
 * per the original migration's comment on this constraint.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

const ORIGINAL_ACTIONS = `action in (
      'role.created','role.edited','role.deleted',
      'person.invited','person.role_changed','person.deactivated','person.reactivated',
      'camera.added','camera.removed',
      'module.enabled','module.disabled','module.zone_bulk',
      'notifications.routing_changed','notifications.escalation_changed',
      'alert.confirmed','alert.dismissed'
    )`;

const EXTENDED_ACTIONS = `action in (
      'role.created','role.edited','role.deleted',
      'person.invited','person.role_changed','person.deactivated','person.reactivated',
      'camera.added','camera.removed','camera.updated',
      'module.enabled','module.disabled','module.zone_bulk',
      'notifications.routing_changed','notifications.escalation_changed',
      'alert.confirmed','alert.dismissed',
      'org.settings_changed',
      'auth.logged_in','auth.logged_out'
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
  pgm.addConstraint('audit_log', 'audit_log_action_check', { check: ORIGINAL_ACTIONS });
};
