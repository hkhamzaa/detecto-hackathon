/**
 * Core Detecto schema: organizations, users, custom roles, hardware boxes,
 * cameras, the frozen detection-module catalogue, alerts, an append-only
 * audit log, plans, subscriptions/invoices, and org-level notification
 * routing.
 *
 * Table order follows foreign-key dependency: plans and modules have none,
 * organizations depends on plans, everything else fans out from there.
 *
 * A "zone" is deliberately not a table anywhere below. The frontend
 * (lib/zones/api.ts) treats a zone as a name repeated across cameras.zone,
 * roles.zones and notification_routes.target, rewritten atomically by a
 * rename/merge operation rather than looked up by id — see the header
 * comment on that file for why. Giving it a table here would invent a
 * record the product doesn't have.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // ---------------------------------------------------------------------
  // plans — static catalogue, referenced by id from organizations,
  // subscriptions and plan_changes. Rows are seeded, not app-created.
  // ---------------------------------------------------------------------
  pgm.createTable('plans', {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    audience: { type: 'text', notNull: true },
    monthly: { type: 'numeric(10,2)', notNull: true },
    max_cameras: { type: 'smallint', notNull: true },
    max_users: { type: 'smallint', notNull: true },
    summary: { type: 'text', notNull: true },
    includes: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
  });
  pgm.addConstraint('plans', 'plans_audience_check', {
    check: "audience in ('home','org')",
  });

  // ---------------------------------------------------------------------
  // organizations — the multi-tenant root. Doubles as the platform's
  // "tenant" record (lib/tenants/api.ts) and the org's own settings
  // record (lib/org/api.ts) — same row, two views, per the frontend.
  // ---------------------------------------------------------------------
  pgm.createTable('organizations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    org_type: { type: 'text' },
    contact_email: { type: 'text' },
    contact_phone: { type: 'text' },
    idle_timeout_minutes: { type: 'smallint', notNull: true, default: 15 },
    account_type: { type: 'text', notNull: true },
    plan_id: { type: 'text', references: 'plans', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'trial' },
    trial_ends_at: { type: 'timestamptz' },
    suspended_at: { type: 'timestamptz' },
    // The account contact — billing-level, distinct from any one person's
    // own email. Support-only `note` is platform-staff visible, never the
    // tenant's own.
    admin_email: { type: 'text' },
    note: { type: 'text', notNull: true, default: '' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('organizations', 'organizations_account_type_check', {
    check: "account_type in ('home','org')",
  });
  pgm.addConstraint('organizations', 'organizations_status_check', {
    check: "status in ('active','trial','suspended')",
  });
  pgm.addConstraint('organizations', 'organizations_idle_timeout_check', {
    check: 'idle_timeout_minutes in (15, 30, 60)',
  });

  // ---------------------------------------------------------------------
  // roles — custom, built from a permission checklist per org (not fixed
  // tiers). `permissions` is a plain text[] of keys: the frontend's own
  // catalogue (lib/roles/permissions.ts) is a static constant with no
  // per-permission data worth a table of its own, so a join table would
  // normalize something that isn't an entity. `zones = NULL` means every
  // camera, matching the frontend's reading exactly.
  // ---------------------------------------------------------------------
  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    permissions: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
    zones: { type: 'text[]' },
    // The org's own admin role. Never deletable — see lib/roles/api.ts.
    is_default: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Case-insensitive per-org uniqueness, matching the 'duplicate_name' check
  // in lib/roles/api.ts's mockSaveRole.
  pgm.createIndex('roles', ['org_id', pgm.func('lower(name)')], {
    unique: true,
    name: 'roles_org_id_lower_name_key',
  });

  // ---------------------------------------------------------------------
  // users — one row per person. `role_id = NULL` means "holds no role,
  // sees nothing" (lib/roles/api.ts Person.roleId). `org_id = NULL` is
  // reserved for platform staff (`is_super_admin`), who per
  // lib/auth/claims.ts belong to no organization at all.
  // ---------------------------------------------------------------------
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', references: 'organizations', onDelete: 'CASCADE' },
    name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true },
    // Never sent to the client. The frontend types never carry this because
    // they describe wire payloads, not storage.
    password_hash: { type: 'text', notNull: true },
    role_id: { type: 'uuid', references: 'roles', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'invited' },
    invited_at: { type: 'timestamptz' },
    is_super_admin: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('users', 'users_status_check', {
    check: "status in ('active','invited','deactivated')",
  });
  // Case-insensitive: the same address must not sign up twice under a
  // different capitalization.
  pgm.createIndex('users', pgm.func('lower(email)'), {
    unique: true,
    name: 'users_lower_email_key',
  });
  // A super admin belongs to no org; everyone else belongs to exactly one.
  pgm.addConstraint('users', 'users_super_admin_org_check', {
    check: '(is_super_admin AND org_id IS NULL) OR (NOT is_super_admin AND org_id IS NOT NULL)',
  });

  // ---------------------------------------------------------------------
  // boxes — the "Detecto Box" hardware a camera is paired through
  // (lib/cameras/api.ts PairedBox). Not every camera has one: a manually
  // added camera carries an address instead.
  // ---------------------------------------------------------------------
  pgm.createTable('boxes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    label: { type: 'text', notNull: true },
    channels: { type: 'smallint', notNull: true, default: 0 },
    paired_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz' },
  });

  // ---------------------------------------------------------------------
  // cameras — belong to an org, optionally paired through a box.
  // `zone` is plain text, not a foreign key — see the header note.
  // ---------------------------------------------------------------------
  pgm.createTable('cameras', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    box_id: { type: 'uuid', references: 'boxes', onDelete: 'SET NULL' },
    name: { type: 'text', notNull: true },
    zone: { type: 'text', notNull: true, default: '' },
    online: { type: 'boolean', notNull: true, default: false },
    last_seen: { type: 'timestamptz' },
    // Set for a manually added camera; null for one discovered through a box.
    address: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('cameras', 'org_id');

  // ---------------------------------------------------------------------
  // modules — the platform-wide detection-module catalogue
  // (lib/modules/catalogue.ts). `status` is a frozen two-value contract:
  // 'live' or 'coming_soon', nothing else — enforced here, not just in
  // the frontend's parser. A module that isn't live has no measured rate.
  // ---------------------------------------------------------------------
  pgm.createTable('modules', {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    status: { type: 'text', notNull: true, default: 'coming_soon' },
    false_positive_rate: { type: 'real' },
    resource_note: { type: 'text' },
    // Plan ids this module is entitled to (lib/module-flags/api.ts). Not a
    // foreign key array — Postgres has no array FK — enforced at the app
    // layer against `plans.id`.
    plan_ids: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
    live_since: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('modules', 'modules_status_check', {
    check: "status in ('live','coming_soon')",
  });
  pgm.addConstraint('modules', 'modules_rate_range_check', {
    check: 'false_positive_rate is null or (false_positive_rate >= 0 and false_positive_rate <= 1)',
  });
  // The contract holds in the database too: nothing not live carries a rate.
  pgm.addConstraint('modules', 'modules_rate_requires_live_check', {
    check: "status = 'live' or false_positive_rate is null",
  });

  // ---------------------------------------------------------------------
  // camera_modules — which modules are enabled on which camera
  // (lib/modules/api.ts CameraModules).
  // ---------------------------------------------------------------------
  pgm.createTable('camera_modules', {
    camera_id: { type: 'uuid', notNull: true, references: 'cameras', onDelete: 'CASCADE' },
    module_id: { type: 'text', notNull: true, references: 'modules', onDelete: 'CASCADE' },
    enabled_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('camera_modules', 'camera_modules_pkey', {
    primaryKey: ['camera_id', 'module_id'],
  });

  // ---------------------------------------------------------------------
  // alerts — the detection queue and its history (lib/alerts/api.ts).
  // `camera_name` and `zone` are denormalized snapshots at detection
  // time, matching the frontend's own Alert type field-for-field.
  //
  // `decisionScope: 'local'` from the frontend is deliberately NOT a
  // column here: it marks a decision that was only ever written to one
  // browser because the raising pipeline has nowhere to record one — by
  // definition it never reaches this table. A row that exists here was
  // never local.
  // ---------------------------------------------------------------------
  pgm.createTable('alerts', {
    // Human-quotable id, e.g. ALR-2291 — what one operator says to
    // another, exactly as the frontend type documents it.
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    camera_id: { type: 'uuid', notNull: true, references: 'cameras', onDelete: 'CASCADE' },
    camera_name: { type: 'text', notNull: true },
    zone: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true },
    subtype: { type: 'text' },
    confidence: { type: 'real', notNull: true },
    detected_at: { type: 'timestamptz', notNull: true },
    model: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'unconfirmed' },
    decided_by: { type: 'text' },
    decided_at: { type: 'timestamptz' },
    pipeline_status: { type: 'text' },
    // The flagged still, as a self-contained data: URL — stored as-is,
    // never a fetchable URL (see the frontend's imageData() comment on why).
    frame_image: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('alerts', 'alerts_kind_check', {
    check: "kind in ('weapon','violence')",
  });
  pgm.addConstraint('alerts', 'alerts_status_check', {
    check: "status in ('unconfirmed','confirmed','dismissed')",
  });
  pgm.addConstraint('alerts', 'alerts_confidence_range_check', {
    check: 'confidence >= 0 and confidence <= 1',
  });
  pgm.addConstraint('alerts', 'alerts_pipeline_status_check', {
    check: "pipeline_status is null or pipeline_status = 'beta'",
  });
  pgm.createIndex('alerts', 'org_id');
  pgm.createIndex('alerts', 'camera_id');
  pgm.createIndex('alerts', 'status');

  // ---------------------------------------------------------------------
  // audit_log — append-only. `actor_id`/`actor_name`/`actor_role_name`
  // are captured as a SNAPSHOT at the time of the action, deliberately
  // not foreign keys: a role gets renamed, edited or deleted, and a
  // person can leave, but the entry must go on saying what was true when
  // it happened. See the header of lib/audit/api.ts.
  //
  // A trigger below blocks UPDATE and DELETE outright, so "read-only, by
  // construction rather than by convention" — the frontend's own words
  // for this module — holds at the database, not only in the API layer.
  //
  // Both foreign keys below are RESTRICT rather than CASCADE/SET NULL:
  // either would have Postgres itself issue a DELETE/UPDATE against this
  // table when the org or alert it references is removed, and the
  // immutability trigger below would reject that write and fail the
  // whole operation anyway — RESTRICT says the same thing up front,
  // as a clear "can't delete this while audit history references it"
  // rather than a cascade silently tripping the trigger.
  // ---------------------------------------------------------------------
  pgm.createTable('audit_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // Snapshot only — no foreign key to users, on purpose (see above).
    actor_id: { type: 'text', notNull: true },
    actor_name: { type: 'text', notNull: true },
    actor_role_name: { type: 'text' },
    action: { type: 'text', notNull: true },
    summary: { type: 'text', notNull: true },
    detail: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
    alert_id: { type: 'text', references: 'alerts', onDelete: 'RESTRICT' },
  });
  pgm.addConstraint('audit_log', 'audit_log_action_check', {
    check: `action in (
      'role.created','role.edited','role.deleted',
      'person.invited','person.role_changed','person.deactivated','person.reactivated',
      'camera.added','camera.removed',
      'module.enabled','module.disabled','module.zone_bulk',
      'notifications.routing_changed','notifications.escalation_changed',
      'alert.confirmed','alert.dismissed'
    )`,
  });
  pgm.createIndex('audit_log', 'org_id');
  pgm.createIndex('audit_log', 'at');

  pgm.createFunction(
    'audit_log_immutable',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
      RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
    END;`,
  );
  pgm.createTrigger('audit_log', 'audit_log_no_update', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'audit_log_immutable',
  });
  pgm.createTrigger('audit_log', 'audit_log_no_delete', {
    when: 'BEFORE',
    operation: 'DELETE',
    level: 'ROW',
    function: 'audit_log_immutable',
  });

  // ---------------------------------------------------------------------
  // subscriptions — one row per org. Plan/status/trial live on
  // `organizations` already (that's the platform's tenant view); this
  // holds only what's specific to the org's own billing page
  // (lib/subscription/api.ts) so the two don't duplicate the same fact.
  // `pending_change_status` is always 'requested' — the only reachable
  // value, per the frontend's own comment on why the others don't exist.
  // ---------------------------------------------------------------------
  pgm.createTable('subscriptions', {
    org_id: { type: 'uuid', primaryKey: true, references: 'organizations', onDelete: 'CASCADE' },
    renews_at: { type: 'timestamptz' },
    billing_email: { type: 'text' },
    pending_change_plan_id: { type: 'text', references: 'plans' },
    pending_change_requested_at: { type: 'timestamptz' },
  });

  // ---------------------------------------------------------------------
  // invoices — shared shape between the org's own billing page and the
  // platform tenant view (lib/invoice.ts). `attempts`/`reason`/
  // `last_attempt_at` cover what lib/billing/api.ts's Outstanding needs
  // from a processor, without a separate payment-attempts table.
  // ---------------------------------------------------------------------
  pgm.createTable('invoices', {
    id: { type: 'text', primaryKey: true },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    period_end: { type: 'timestamptz', notNull: true },
    amount: { type: 'numeric(10,2)', notNull: true },
    status: { type: 'text', notNull: true },
    attempts: { type: 'smallint', notNull: true, default: 0 },
    reason: { type: 'text' },
    last_attempt_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('invoices', 'invoices_status_check', {
    check: "status in ('paid','due','failed')",
  });
  pgm.createIndex('invoices', 'org_id');

  // ---------------------------------------------------------------------
  // plan_changes — platform-level history (lib/billing/api.ts PlanChange).
  // `org_name` is a snapshot, same reasoning as audit_log: a cancelled
  // account leaves the registry, and the history has to go on naming it.
  // `org_id` is therefore nullable and set null rather than cascaded away.
  // ---------------------------------------------------------------------
  pgm.createTable('plan_changes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', references: 'organizations', onDelete: 'SET NULL' },
    org_name: { type: 'text', notNull: true },
    from_plan_id: { type: 'text', references: 'plans' },
    to_plan_id: { type: 'text', references: 'plans' },
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // ---------------------------------------------------------------------
  // notification_routes — org-level overrides (lib/notifications/api.ts).
  // A row only exists when an org has narrowed something: "back to
  // default" is a row deletion, never a stored null, matching the
  // frontend's mockSetRoute exactly. `role_ids` can be a real empty
  // array (narrowed to nobody) — that's different from no row at all.
  // ---------------------------------------------------------------------
  pgm.createTable('notification_routes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    org_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true },
    target: { type: 'text', notNull: true },
    // Role ids, not a foreign key array — enforced at the app layer.
    role_ids: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'") },
  });
  pgm.addConstraint('notification_routes', 'notification_routes_kind_check', {
    check: "kind in ('zone','module')",
  });
  pgm.addConstraint('notification_routes', 'notification_routes_org_id_kind_target_key', {
    unique: ['org_id', 'kind', 'target'],
  });

  // ---------------------------------------------------------------------
  // notification_escalation_policy — one row per org (lib/notifications
  // /api.ts EscalationPolicy). Off, and empty, until an org turns it on.
  // ---------------------------------------------------------------------
  pgm.createTable('notification_escalation_policy', {
    org_id: { type: 'uuid', primaryKey: true, references: 'organizations', onDelete: 'CASCADE' },
    enabled: { type: 'boolean', notNull: true, default: false },
    after_minutes: { type: 'smallint', notNull: true, default: 15 },
    role_ids: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'") },
  });
  pgm.addConstraint('notification_escalation_policy', 'notification_escalation_after_minutes_check', {
    check: 'after_minutes in (5, 15, 30)',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('notification_escalation_policy');
  pgm.dropTable('notification_routes');
  pgm.dropTable('plan_changes');
  pgm.dropTable('invoices');
  pgm.dropTable('subscriptions');
  pgm.dropTable('audit_log');
  pgm.dropFunction('audit_log_immutable', []);
  pgm.dropTable('alerts');
  pgm.dropTable('camera_modules');
  pgm.dropTable('modules');
  pgm.dropTable('cameras');
  pgm.dropTable('boxes');
  pgm.dropTable('users');
  pgm.dropTable('roles');
  pgm.dropTable('organizations');
  pgm.dropTable('plans');
};
