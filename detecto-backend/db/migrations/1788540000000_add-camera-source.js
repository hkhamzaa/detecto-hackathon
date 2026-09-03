/**
 * cameras.source_type / cameras.source_uri — the piece the schema was
 * missing to say HOW a camera's frames actually arrive, as opposed to
 * `address` (a cosmetic display field never read by any capture logic) or
 * `online` (a status flag, not a wiring description).
 *
 * `box_id` already existed (see the init migration) and answers a different
 * question -- which piece of hardware a camera is paired through, if any.
 * `source_type`/`source_uri` answer "does anything actually feed this
 * camera frames, and from where" -- orthogonal, because a box-paired camera
 * and a manually-added one can each be wired or not.
 *
 * Three states, not a boolean, because "not yet wired to anything" is a
 * real, common, honest state -- not an error and not the same as `file` or
 * `rtsp` pointed at nothing. Every existing row (and every new one, unless
 * a caller sets otherwise) defaults to `unconfigured`: a DB row is not a
 * live source until something explicitly says what feeds it.
 *
 * `rtsp` is deliberately just a value this column can hold today, not a
 * feature -- there is no RTSP capture code anywhere in this project yet
 * (see inference/live_infer.py's VideoSource stub). Adding the column now,
 * while it's a cheap nullable addition with no existing data to migrate, is
 * the point: a real Detecto Box arriving later is a config/data change
 * against this column, not a schema migration against a table that by then
 * holds real camera and alert history.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('cameras', {
    source_type: { type: 'text', notNull: true, default: 'unconfigured' },
    // Meaningful only once source_type is 'file' or 'rtsp' -- a file path or
    // an rtsp:// URL respectively. Left null for 'unconfigured', and not
    // enforced as required for 'file'/'rtsp' either: nothing in this pass
    // consumes the column yet (see the Step 1 report), so there's nothing
    // here to validate against beyond the shape node-pg-migrate can express.
    source_uri: { type: 'text' },
  });
  pgm.addConstraint('cameras', 'cameras_source_type_check', {
    check: "source_type in ('file','rtsp','unconfigured')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint('cameras', 'cameras_source_type_check');
  pgm.dropColumns('cameras', ['source_type', 'source_uri']);
};
