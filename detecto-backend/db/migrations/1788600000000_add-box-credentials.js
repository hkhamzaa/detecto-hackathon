/**
 * box_credentials — a real per-box secret, replacing the single shared
 * `INTERNAL_API_KEY` for the two box-facing endpoints built in earlier
 * phases (`POST /api/boxes/:id/heartbeat`, `POST /api/boxes/:id/cameras`).
 * Both routes' own comments flagged this exact gap when they shipped: any
 * holder of the one shared key could act as ANY box on ANY org. This table
 * is what closes it -- each box gets its own credential, checked against
 * that specific box's row, not a fleet-wide secret.
 *
 * Same hash-at-rest shape as `refresh_tokens.token_hash` /
 * `box_pairing_codes.code_hash` -- only a SHA-256 hash is ever stored, so a
 * leaked table can't be used to authenticate as a box. Unlike a refresh
 * token, this is NOT single-use/rotated on every call: a box presents the
 * same secret on every heartbeat and camera report, the way an API key
 * does, not the way a refresh-token cookie does. `revoked_at` (nullable,
 * NULL = active) is the whole revoke/reissue story -- reissuing is just
 * "revoke the current one, insert a new one" (see lib/box-credentials.js),
 * mirroring `refresh_tokens.revoked_at` rather than deleting rows, so a
 * revoked credential's existence stays auditable.
 *
 * `POST /api/alerts` (the dev-only Python pipeline, not a real box) is
 * deliberately NOT migrated here -- it keeps using the shared
 * `INTERNAL_API_KEY` until a real box exists to replace that dev server,
 * per this phase's own scoping.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('box_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    box_id: { type: 'uuid', notNull: true, references: 'boxes', onDelete: 'CASCADE' },
    secret_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // NULL while active. Set the moment it's revoked or reissued away --
    // never deleted, matching refresh_tokens' own reasoning: a later
    // presentation of a revoked secret should resolve to a real, known-dead
    // row rather than an unknown one.
    revoked_at: { type: 'timestamptz' },
  });

  // Looked up on every heartbeat/camera-report call; uniqueness also makes
  // a hash collision (astronomically unlikely, SHA-256) fail loudly instead
  // of silently authenticating as the wrong box.
  pgm.createIndex('box_credentials', 'secret_hash', { unique: true });
  pgm.createIndex('box_credentials', 'box_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('box_credentials');
};
