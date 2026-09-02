/**
 * refresh_tokens — backs the httpOnly refresh cookie described in
 * detecto-frontend/src/store/auth-store.ts's "Boot seam" comment and
 * db/README.md's former "Not yet built" note.
 *
 * Deliberately NOT a JWT: the access token is a stateless JWT because it
 * only ever needs to be verified, never revoked mid-flight (it's short-lived
 * enough that a compromise self-heals). A refresh token is long-lived and
 * must be revocable on demand — on logout, and automatically on reuse
 * detection below — so it has to be a row the server can delete, not a
 * signature the server can only verify.
 *
 * Only the SHA-256 hash of the raw token is stored, the same reasoning as
 * `users.password_hash`: a leaked table (backup, replica, dump) must not
 * hand out live credentials. The raw token exists only in the httpOnly
 * cookie on the client and in the response that mints it.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('refresh_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    token_hash: { type: 'text', notNull: true },
    // Carried through rotation so a "remembered" session keeps renewing on
    // its 30-day window instead of collapsing to the 1-day default the
    // moment it rotates — see lib/refresh-tokens.js.
    remember: { type: 'boolean', notNull: true, default: false },
    expires_at: { type: 'timestamptz', notNull: true },
    // NULL while active. Set the moment the token is rotated away, logged
    // out, or swept up by reuse-detection's mass revoke — never deleted, so
    // a later replay of the same raw token still resolves to a row here and
    // can be recognized as reuse rather than as "unknown token".
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // The hash is looked up on every refresh call; uniqueness also makes a
  // hash collision (astronomically unlikely, SHA-256) fail loudly instead
  // of silently handing one session's rotation to another's row.
  pgm.createIndex('refresh_tokens', 'token_hash', { unique: true });
  // Reuse detection's mass revoke scans "every active token for this user".
  pgm.createIndex('refresh_tokens', 'user_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('refresh_tokens');
};
