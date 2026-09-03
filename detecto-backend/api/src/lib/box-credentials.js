import { createHash, randomBytes } from 'node:crypto';

import { pool } from '../db.js';

/**
 * Per-box credentials — one real secret per box, replacing the single
 * shared `INTERNAL_API_KEY` for the box-facing endpoints (see boxes.js's
 * `/:id/heartbeat` and `/:id/cameras`). Same hash-at-rest pattern as
 * lib/refresh-tokens.js's `token_hash`, but NOT single-use/rotated per call
 * — a box presents the same secret on every heartbeat, the way an API key
 * does, not the way a refresh-token cookie does. Revocation/reissue is the
 * whole lifecycle story here, not per-request rotation.
 */

function rawSecret() {
  return randomBytes(32).toString('hex');
}

function hashSecret(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Issues a brand-new credential for a box, without touching any existing
 * one — callers that mean "replace" (pairing a box that somehow already had
 * one, or an explicit reissue) call `revokeBoxCredentials` first; this
 * function alone doesn't decide that policy. Returns the raw secret — the
 * only time it ever exists outside its hash — for the caller to hand back
 * once. `client` is whatever transaction the caller is already in (pairing
 * inserts the box and its credential together), matching logAudit's own
 * client param.
 */
export async function issueBoxCredential(client, boxId) {
  const raw = rawSecret();
  await client.query(
    `INSERT INTO box_credentials (box_id, secret_hash) VALUES ($1, $2)`,
    [boxId, hashSecret(raw)],
  );
  return raw;
}

/**
 * Revokes every currently-active credential for a box. Normally there's
 * exactly one (issued at pairing, or by a prior reissue), but this clears
 * all of them rather than assuming that invariant always held — cheap
 * insurance against ever leaving a second live credential behind.
 */
export async function revokeBoxCredentials(client, boxId) {
  await client.query(
    `UPDATE box_credentials SET revoked_at = now() WHERE box_id = $1 AND revoked_at IS NULL`,
    [boxId],
  );
}

/** Revoke whatever's currently active, then issue a fresh one — the whole
 * rotation story for a box whose credential needs to change (suspected
 * compromise, or just routine hygiene). The old secret stops working the
 * instant this commits; nothing about the "presented but already revoked"
 * grace period refresh tokens use applies here, since a box isn't racing
 * concurrent browser tabs over a single-use token. */
export async function reissueBoxCredential(client, boxId) {
  await revokeBoxCredentials(client, boxId);
  return issueBoxCredential(client, boxId);
}

/**
 * True only if `presented` is the raw secret for an active credential
 * belonging to exactly this `boxId` — a credential for a different box, or
 * a revoked one for this box, both fail. This is the actual enforcement of
 * "a box's credential only authenticates as that specific box": the lookup
 * is scoped by `box_id` from the start, not just "is this secret valid for
 * someone."
 */
export async function verifyBoxCredential(boxId, presented) {
  if (typeof presented !== 'string' || !presented) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM box_credentials
     WHERE box_id = $1 AND secret_hash = $2 AND revoked_at IS NULL
     LIMIT 1`,
    [boxId, hashSecret(presented)],
  );
  return rows.length > 0;
}
