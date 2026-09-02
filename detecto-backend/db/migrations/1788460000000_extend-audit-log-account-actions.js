/**
 * Adds auth.password_changed — the self-service password change on
 * routes/account.js's POST /api/account/password. Written into the acting
 * person's own org's audit_log (org_id = req.claims.orgId), same as
 * auth.logged_in/logged_out — and, same as those two, skipped entirely for
 * a super admin (no org to log into; see auth.js's own comment on why that
 * is not a gap in this table).
 *
 * Deliberately the only account.js mutation that gets one. PATCH /api/account
 * (name/email) is a low-stakes profile edit with no precedent action to
 * extend into, and no platform-level action was added here for
 * module-flags — routes/admin-modules.js's own header explains why: a
 * module release isn't scoped to one org, and audit_log.org_id is NOT NULL
 * by design (see platform.* actions' own migration for the one shape that
 * does fit: an action on one specific tenant).
 *
 * Mirrors the addition into detecto-frontend/src/lib/audit/api.ts's
 * AUDIT_ACTIONS and filter.ts's ACTION_LABEL, same recipe as the four
 * migrations before this one.
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
      'billing.plan_change_requested','billing.plan_change_withdrawn',
      'platform.tenant_suspended','platform.tenant_reactivated','platform.support_note_changed'
    )`;

const EXTENDED_ACTIONS = `action in (
      'role.created','role.edited','role.deleted',
      'person.invited','person.role_changed','person.deactivated','person.reactivated',
      'camera.added','camera.removed','camera.updated',
      'module.enabled','module.disabled','module.zone_bulk',
      'notifications.routing_changed','notifications.escalation_changed',
      'alert.confirmed','alert.dismissed',
      'org.settings_changed',
      'auth.logged_in','auth.logged_out','auth.password_changed',
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
