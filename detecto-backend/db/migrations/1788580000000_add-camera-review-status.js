/**
 * cameras.review_status — the piece missing to let a box auto-register the
 * cameras it sees (POST /api/boxes/:id/cameras) without silently putting
 * them into full org use. Every camera row was previously implicitly
 * "active" the instant it existed; there was no way to represent "this row
 * exists because a box reported it, but no human has looked at it yet."
 *
 * Two values, not a boolean: `'pending'` names a real, temporary state (a
 * box-reported camera awaiting human review) distinctly from `'approved'`
 * (everything else — every camera added through the existing manual
 * POST /api/cameras flow already had a human review it by the act of adding
 * it, so those default to `'approved'` and this migration changes nothing
 * about how they behave). A boolean `pending` flag would have made
 * "approved" the unnamed default rather than a real state with its own
 * word — worth the extra column value for the same reason `modules.status`
 * upstream chose two named values over a boolean.
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('cameras', {
    review_status: { type: 'text', notNull: true, default: 'approved' },
  });
  pgm.addConstraint('cameras', 'cameras_review_status_check', {
    check: "review_status in ('pending','approved')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint('cameras', 'cameras_review_status_check');
  pgm.dropColumns('cameras', ['review_status']);
};
