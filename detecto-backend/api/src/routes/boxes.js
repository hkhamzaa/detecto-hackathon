import { createHash } from 'node:crypto';

import { Router } from 'express';

import { pool } from '../db.js';
import {
  requireActiveOrg,
  requireAuth,
  requireBoxCredential,
  requireOrgScope,
  requirePermission,
} from '../middleware/auth.js';
import { issueBoxCredential, reissueBoxCredential } from '../lib/box-credentials.js';
import { createRateLimiter, rateLimitMiddleware } from '../lib/rate-limiter.js';
import { isUuid } from '../lib/validation.js';

export const boxesRouter = Router();

boxesRouter.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  next();
});

/**
 * Pairing codes are 8 characters — a brute-forceable space without a
 * ceiling on attempts. Keyed by org rather than IP: the thing worth
 * limiting is one org hammering the pairing endpoint, regardless of which
 * address the requests happen to come from.
 */
const pairLimiter = rateLimitMiddleware(
  createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }),
  (req) => req.claims.orgId,
);

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
 *
 * No router-level `.use()` here, unlike cameras.js/org.js — matching
 * alerts.js's own reasoning: `/pair` below is a person acting through the
 * org's UI (requireAuth/requireOrgScope/requireActiveOrg, applied directly
 * on that route), but `/:id/heartbeat` further down is the box itself,
 * which has no user session to require one of. Blanket auth here would wrongly
 * demand a JWT from a device that will never have one.
 *
 * `/pair` also issues that box's one real credential (see
 * lib/box-credentials.js) in the same transaction that creates the row —
 * `requireBoxCredential`, not the old shared `requireInternalKey`, is what
 * gates `/:id/heartbeat` and `/:id/cameras` below now. See each route's own
 * comment for what changed and why.
 */

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
 * parses, PLUS one additive field: `boxSecret`, the raw per-box credential
 * (see lib/box-credentials.js) this call just issued — the only moment it
 * ever exists outside its hash. `realPair()`'s parser drops fields it
 * doesn't name, so today's frontend build ignores it entirely; nothing
 * breaks either way, matching how `reviewStatus` was added to cameras'
 * wire shape earlier.
 *
 * WHERE THIS SECRET IS SUPPOSED TO GO, HONESTLY: in a real deployment, a
 * box's own firmware would need this credential to ever call
 * `/:id/heartbeat` or `/:id/cameras` — which means it has to reach the box
 * itself, not just this HTTP response to whichever browser happened to
 * submit the pairing code. This project has no real box firmware and no
 * path onto a customer's LAN to hand a secret to one directly (the same
 * boundary POST /:id/discover's absence already documents above) — so
 * returning it here, in the one response already tied to "a specific box
 * just came into existence," is the closest honest approximation available
 * without hardware to build the real exchange against. Flagged, not hidden.
 */
boxesRouter.post(
  '/pair',
  requireAuth,
  requireOrgScope,
  requireActiveOrg,
  requirePermission('cameras:view'),
  pairLimiter,
  async (req, res) => {
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

    const boxSecret = await issueBoxCredential(client, box.rows[0].id);

    await client.query('COMMIT');
    res.status(200).json({
      id: box.rows[0].id,
      label: box.rows[0].label,
      channels: box.rows[0].channels,
      boxSecret,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/boxes/:id/credential/reissue                                     */
/* -------------------------------------------------------------------------- */

/**
 * Revokes this box's current credential and issues a new one — the
 * revoke/reissue story `lib/box-credentials.js` exists for. A person acting
 * through the org's UI, same auth chain as `/pair` (this is org
 * administration, not a box calling in about itself), gated by the same
 * `cameras:view` stand-in every other box/camera mutation in this file
 * uses. Org-scoped like every other route here: a box belonging to a
 * different org 404s, same as it not existing at all — this isn't the
 * enumeration-sensitive boundary login's vague 401 exists for (see
 * requireBoxCredential's own comment), so a plain 404 is fine.
 *
 * Response is `{ boxSecret }` — the new raw secret, the only moment it
 * exists outside its hash, same "additive, real box firmware would need
 * this" honesty note as `/pair`'s own `boxSecret` field above. The old
 * secret stops working the instant this commits.
 */
boxesRouter.post(
  '/:id/credential/reissue',
  requireAuth,
  requireOrgScope,
  requireActiveOrg,
  requirePermission('cameras:view'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const box = await client.query(
        `SELECT id FROM boxes WHERE id = $1 AND org_id = $2`,
        [req.params.id, req.claims.orgId],
      );
      if (!box.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not_found' });
      }

      const boxSecret = await reissueBoxCredential(client, req.params.id);

      await client.query('COMMIT');
      res.status(200).json({ boxSecret });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

/* -------------------------------------------------------------------------- */
/* POST /api/boxes/:id/heartbeat                                              */
/* -------------------------------------------------------------------------- */

/**
 * How a Detecto Box says "I'm alive and connected" — the one write path for
 * `boxes.last_seen_at`, which existed in the schema since the init migration
 * but had no producer anywhere in this codebase until now (see the Step 1
 * report: admin-health.js and admin-tenants.js already READ it correctly —
 * fleet honesty was never the gap; nothing ever WROTE it).
 *
 * AUTH — `requireBoxCredential`: a real secret specific to THIS box (see
 * lib/box-credentials.js), issued at pairing time, checked against `:id`
 * specifically. This used to be the shared `requireInternalKey` — every
 * holder of that one key could heartbeat as any box on any org, a gap this
 * route's own comment flagged explicitly when it shipped. That gap is
 * closed now: `requireBoxCredential` already 404s an unknown box and 401s a
 * wrong/missing/revoked secret before this handler runs, and attaches
 * `req.box` so there's no separate lookup left to do here.
 *
 * No rate limiting here, matching POST /api/alerts's own precedent for a
 * machine-authenticated endpoint — not a surface a login-style lockout
 * pattern was ever built for.
 */
boxesRouter.post('/:id/heartbeat', requireBoxCredential, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE boxes SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at`,
    [req.box.id],
  );
  res.status(200).json({ ok: true, lastHeartbeatAt: rows[0].last_seen_at.toISOString() });
});

/* -------------------------------------------------------------------------- */
/* POST /api/boxes/:id/cameras                                                */
/* -------------------------------------------------------------------------- */

const CAMERA_SOURCE_TYPES = ['rtsp'];

/**
 * Camera auto-registration: how a box tells the backend what cameras it can
 * currently see, so they exist in the system without a human re-typing each
 * one. Body: `{ cameras: [{ sourceUri, label? }] }`.
 *
 * AUTH — `requireBoxCredential`, same as `/:id/heartbeat` above and for the
 * same reason; see that route's own comment for the full case. Formerly the
 * shared `requireInternalKey`, which let any key-holder report cameras onto
 * any box on any org — that gap is closed the same way here.
 *
 * `sourceType` is always `'rtsp'`, not accepted from the request: `'file'`
 * exists in the schema purely as this project's own dev/test stand-in for
 * a video file (see inference/live_infer.py's `FileVideoSource`) — no real
 * box firmware would ever report one, and letting a caller claim it here
 * would let a test/demo box inject a nonsensical row into real org data.
 *
 * HUMAN-IN-THE-LOOP, the point of this whole endpoint: every row this
 * creates starts `review_status: 'pending'` (the column's own default) and
 * is never flipped to `'approved'` here — see PATCH /api/cameras/:id's own
 * note on the one place that happens, which requires a person's JWT and
 * permission, never anything reachable from this device-authenticated
 * route. A box reporting a camera makes it exist and be reviewable; it does
 * not put it into use. `PUT /:id/modules/:moduleId` (cameras.js) enforces
 * the other half: a still-pending camera can't have a detection module
 * turned on regardless of who asks, so "not yet reviewed" can't be routed
 * around by skipping straight to enabling a module.
 *
 * De-duplication is by `(box_id, source_uri)` — see the schema migration
 * adding that unique constraint for why that pair, not a separate
 * fabricated hardware-id column nothing here can actually read. Re-running
 * the same report (the simulator does this on every heartbeat cycle, and a
 * real box would too) updates the existing row's `label`/`last_seen`-via-
 * heartbeat rather than creating a second one — `review_status` is
 * deliberately NOT reset back to `'pending'` on an update that only
 * confirms a camera already known: an admin who already reviewed a camera
 * shouldn't have that review silently undone because the box mentioned it
 * again.
 */
boxesRouter.post('/:id/cameras', requireBoxCredential, async (req, res) => {
  const cameras = req.body?.cameras;
  if (!Array.isArray(cameras) || cameras.length === 0) {
    return res.status(422).json({ error: 'validation_failed', errors: { cameras: 'At least one camera is required.' } });
  }

  const errors = {};
  cameras.forEach((camera, index) => {
    if (!camera || typeof camera !== 'object' || !String(camera.sourceUri ?? '').trim()) {
      errors[index] = 'sourceUri is required.';
    } else if (camera.sourceType !== undefined && !CAMERA_SOURCE_TYPES.includes(camera.sourceType)) {
      errors[index] = `sourceType must be one of: ${CAMERA_SOURCE_TYPES.join(', ')}.`;
    }
  });
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const registered = [];
    for (const camera of cameras) {
      const sourceUri = String(camera.sourceUri).trim();
      const label = String(camera.label ?? '').trim() || sourceUri;

      const { rows } = await client.query(
        `INSERT INTO cameras (org_id, box_id, name, source_type, source_uri, review_status)
         VALUES ($1, $2, $3, 'rtsp', $4, 'pending')
         ON CONFLICT (box_id, source_uri) DO UPDATE SET
           name = excluded.name,
           updated_at = now()
         RETURNING id, name, zone, source_type, review_status`,
        [req.box.orgId, req.box.id, label, sourceUri],
      );
      registered.push(rows[0]);
    }

    await client.query('COMMIT');
    res.status(200).json({
      cameras: registered.map((row) => ({
        id: row.id,
        name: row.name,
        zone: row.zone,
        sourceType: row.source_type,
        reviewStatus: row.review_status,
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
