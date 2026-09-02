/**
 * box_pairing_codes — backs POST /api/boxes/pair (lib/cameras/api.ts
 * pairBox()). See the B7c/B5-gap discovery report: pairing is "type in the
 * eight-character code the box's screen shows" (pair.tsx's own copy), which
 * is genuine hardware-provisioning state — a code, a channel count, an
 * expiry — not a live conversation with the box. Box *discovery*
 * (POST /api/boxes/:id/discover) is the opposite: it asks the box to scan
 * the customer's own LAN, which this project has no hardware or box-side
 * agent to ever honestly answer, and is deliberately NOT built — see
 * routes/boxes.js's own header.
 *
 * Only the SHA-256 hash of the code is stored, same reasoning as
 * `refresh_tokens.token_hash` and `users.password_hash`: a leaked table
 * must not hand out a claimable code. Lower stakes than a password or a
 * refresh token (worst case of a leak is someone else claiming a box
 * before its rightful owner types the code off its screen — not an
 * account compromise) but the same hygiene costs nothing extra here.
 *
 * No endpoint in this build ever creates one of these rows: in a real
 * deployment a code originates from the box's own firmware/display at
 * manufacture or first boot, a process this project has no hardware side
 * for. Rows exist only via direct seeding, for the same reason
 * db/seed.js's test org exists — something to manually verify the real
 * pairing endpoint against.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('box_pairing_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code_hash: { type: 'text', notNull: true },
    // What the box displays alongside its code (pair.tsx's PairedBox.label).
    label: { type: 'text', notNull: true },
    channels: { type: 'smallint', notNull: true, default: 0 },
    // The mock's own stated behavior: "the box shows a new one every ten
    // minutes" (pair.tsx). Not renewed here — a code past this is simply
    // dead; a real box would be showing a different one by then.
    expires_at: { type: 'timestamptz', notNull: true },
    // Set together, the moment an org successfully claims this code. Both
    // null means still unclaimed and (if unexpired) available to pair.
    claimed_by_org_id: { type: 'uuid', references: 'organizations', onDelete: 'SET NULL' },
    claimed_box_id: { type: 'uuid', references: 'boxes', onDelete: 'SET NULL' },
    claimed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('box_pairing_codes', 'code_hash', { unique: true });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('box_pairing_codes');
};
