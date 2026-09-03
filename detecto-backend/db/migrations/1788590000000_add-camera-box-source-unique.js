/**
 * A unique constraint on (box_id, source_uri) — what
 * `POST /api/boxes/:id/cameras` (camera auto-registration) upserts against
 * so a box re-reporting the same camera updates the existing row instead of
 * creating a duplicate every time it reports.
 *
 * Standard SQL unique-constraint semantics do the right thing here without
 * a partial index: a NULL in either column is never considered equal to
 * another NULL, so this constraint is silently inert for every
 * manually-added camera (`box_id` is always null there — see
 * cameras.js/db/seed.js) and only actually fires for the box-reported case
 * it exists for, where both columns are always set together.
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addConstraint('cameras', 'cameras_box_source_uri_key', {
    unique: ['box_id', 'source_uri'],
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint('cameras', 'cameras_box_source_uri_key');
};
