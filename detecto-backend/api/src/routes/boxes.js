import { createHash } from 'node:crypto';

import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';

export const boxesRouter = Router();

/**
 * `cameras:view` gates this, same stand-in cameras.js already uses — box
 * pairing is one step inside the "connect a camera" flow, and no finer
 * `boxes:manage` key exists in the frontend's catalogue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONLY PAIRING IS BUILT HERE. DISCOVERY IS NOT, AND WILL NOT BE FAKED.
 *
 * lib/cameras/api.ts has two box operations: pairBox() and
 * discoverCameras(). They look similar but are not: pairing consumes a
 * code the box's own screen shows (pair.tsx: "type it in below to link it
 * to this organisation") — a fact about a piece of hardware, knowable
 * without talking to it, same as reading a serial number off a label. It
 * is genuine state, and POST /pair below is a real implementation of it.
 *
 * Discovery is different in kind, not just detail: find.tsx's own copy
 * says the box "checks every camera and recorder it can reach on your
 * network" — the CUSTOMER's network, which this API server has no path
 * onto. Answering that request honestly requires a box physically present
 * on that network, running firmware this project does not include and has
 * no way to build without real hardware to write it against. There is no
 * POST /api/boxes/:id/discover route here. Building one that returns
 * anything but "we cannot reach a box" would be fabricating camera data —
 * exactly what this phase's task was told not to do. A request to that
 * path 404s, which lib/cameras/api.ts's realDiscover() already turns into
 * the honest `{ ok: false, code: 'unavailable' }` the frontend already
 * knows how to show.
 * ─────────────────────────────────────────────────────────────────────────
 */
boxesRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

function hashCode(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* POST /api/boxes/pair                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Body: `{ code }`, matching pairBox()'s real contract. `code` arrives
 * already normalised by lib/cameras/pairing.ts's pairingCodeValue() —
 * eight characters, no separator, uppercase — but re-normalised here too
 * rather than trusted, the same caution every other route in this codebase
 * takes with client input.
 *
 * Response is the flat `{id, label, channels}` PairedBox shape realPair()
 * parses — never wrapped in a `{box: ...}` envelope.
 */
boxesRouter.post('/pair', requirePermission('cameras:view'), async (req, res) => {
  const code = String(req.body?.code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (code.length !== 8) {
    return res.status(404).json({ error: 'invalid_code' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, label, channels, expires_at
       FROM box_pairing_codes
       WHERE code_hash = $1 AND claimed_at IS NULL
       FOR UPDATE`,
      [hashCode(code)],
    );
    const pairing = rows[0];

    // Unknown code, or one somebody else already claimed — the mock's own
    // "no box is showing that code" reading: once claimed, a code stops
    // being a thing this endpoint will recognise, same as it would if it
    // never existed.
    if (!pairing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'invalid_code' });
    }
    if (pairing.expires_at <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'expired_code' });
    }

    const box = await client.query(
      `INSERT INTO boxes (org_id, label, channels, paired_at)
       VALUES ($1, $2, $3, now())
       RETURNING id, label, channels`,
      [req.claims.orgId, pairing.label, pairing.channels],
    );

    await client.query(
      `UPDATE box_pairing_codes
       SET claimed_by_org_id = $1, claimed_box_id = $2, claimed_at = now()
       WHERE id = $3`,
      [req.claims.orgId, box.rows[0].id, pairing.id],
    );

    await client.query('COMMIT');
    res.status(200).json({
      id: box.rows[0].id,
      label: box.rows[0].label,
      channels: box.rows[0].channels,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
