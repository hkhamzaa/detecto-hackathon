import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireInternalKey, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/validation.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';
import { detectionLabel } from '../lib/labels.js';
import { ALERT_COLUMNS, toWireAlert } from '../lib/alert-shape.js';

export const alertsRouter = Router();

// No router-level `.use()` here, unlike the other route files: POST / below
// is a service-to-service call authenticated by requireInternalKey, not a
// user's JWT, so requireAuth/requireOrgScope are applied per-route on
// everything else instead of blanket.

// alerts.id is `text` in the schema (human-readable, e.g. ALR-2291), not a
// uuid — so there's no cheap format check to reject a bad id early with,
// unlike cameras below. Postgres's `text = $1` comparison against a
// nonexistent id is a normal query, not an error, so this is fine as-is.

const KINDS = ['weapon', 'violence'];
const STATUSES = ['unconfirmed', 'confirmed', 'dismissed'];
const FRAME_IMAGE_RE = /^data:image\/(jpeg|png);base64,/;

/**
 * GET /api/alerts — optional ?status=&kind=&cameraId= filters.
 *
 * The mock (lib/alerts/api.ts) takes no params at all; filtering is this
 * task's own addition on top of that contract. Purely additive: the
 * existing zero-arg call is unaffected, and the response shape (`{alerts}`)
 * is unchanged either way.
 */
alertsRouter.get('/', requireAuth, requireOrgScope, requireActiveOrg, requirePermission('alerts:view'), async (req, res) => {
  const { status, kind, cameraId } = req.query;

  const conditions = ['org_id = $1'];
  const params = [req.claims.orgId];

  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (kind !== undefined) {
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
    params.push(kind);
    conditions.push(`kind = $${params.length}`);
  }
  if (cameraId !== undefined) {
    if (!isUuid(cameraId)) return res.status(400).json({ error: 'invalid_camera_id' });
    params.push(cameraId);
    conditions.push(`camera_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts WHERE ${conditions.join(' AND ')} ORDER BY detected_at DESC`,
    params,
  );
  res.status(200).json({ alerts: rows.map(toWireAlert) });
});

/**
 * POST /api/alerts — internal, service-to-service. The only caller today is
 * detecto-backend/server (the Python alert pipeline), authenticated with the
 * shared key rather than a user's JWT — there is no signed-in person behind
 * a detection the model raised on its own.
 *
 * `orgId` is deliberately never read from the request body: it's derived
 * from `cameraId`, which must name a camera that actually exists. A caller
 * holding only the shared key never gets to claim an org directly — it can
 * only act through a camera that's real, which is the same "never trust a
 * client-supplied org_id" rule every other route in this file holds, just
 * enforced one level removed since there's no JWT to read it from here.
 *
 * `id` is supplied by the caller (the pipeline's own `ALR-<8 hex chars>`
 * generator — 32 random bits per id, see server/translate.py's
 * `AlertIdSequence`) rather than generated here, so the id on the socket
 * emission and the id in Postgres are the same string — confirming/
 * dismissing from a UI that only has the socket payload has to resolve to
 * this exact row. A same-id conflict is astronomically unlikely now (it
 * used to be guaranteed on every restart, back when this was a zero-padded
 * per-process counter — see the Step 1 report on load testing that found
 * it); still handled as a 409 rather than a crash below, but the caller
 * (server/app.py's `Pipeline._persist`) now treats that 409 as the genuine
 * anomaly it is — a persist failure to count and log, not silent success.
 */
alertsRouter.post('/', requireInternalKey, async (req, res) => {
  const body = req.body ?? {};
  const errors = createAlertErrors(body);
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const camera = await pool.query('SELECT id, org_id, name, zone FROM cameras WHERE id = $1', [
    body.cameraId,
  ]);
  const cam = camera.rows[0];
  if (!cam) {
    return res.status(422).json({ error: 'validation_failed', errors: { cameraId: 'No camera with this id.' } });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO alerts (
         id, org_id, camera_id, camera_name, zone, kind, subtype, confidence,
         detected_at, model, status, pipeline_status, frame_image
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unconfirmed', $11, $12)
       RETURNING ${ALERT_COLUMNS}`,
      [
        body.id,
        cam.org_id,
        cam.id,
        // Falls back to the camera's own name/zone if the pipeline didn't
        // send one — a real caller always does (see translate.py), but the
        // row shouldn't be able to end up with a blank camera_name/zone.
        String(body.cameraName ?? '').trim() || cam.name,
        String(body.zone ?? '').trim() || cam.zone,
        body.kind,
        body.subtype ?? null,
        body.confidence,
        body.detectedAt,
        body.model,
        body.pipelineStatus ?? null,
        body.frameImage ?? null,
      ],
    );
    res.status(201).json(toWireAlert(rows[0]));
  } catch (err) {
    // alerts_pkey — the id the pipeline generated collided with one already
    // stored. With ids now 32 random bits (see the docstring above), this
    // should be vanishingly rare rather than the routine restart artifact it
    // used to be. A conflict, not a server error, so still a 409 rather than
    // a 500 — but the caller must NOT treat this as "already persisted and
    // therefore fine": it genuinely does not know whether the existing row
    // is this same detection or an unrelated collision, so it counts this as
    // a persist failure. See server/app.py's `Pipeline._persist`.
    if (err.code === '23505') return res.status(409).json({ error: 'duplicate_id' });
    throw err;
  }
});

function createAlertErrors(body) {
  const errors = {};
  if (!String(body.id ?? '').trim()) errors.id = 'id is required.';
  if (!isUuid(body.cameraId)) errors.cameraId = 'cameraId must be a valid camera id.';
  if (!KINDS.includes(body.kind)) errors.kind = "kind must be 'weapon' or 'violence'.";
  if (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1) {
    errors.confidence = 'confidence must be a number between 0 and 1.';
  }
  if (typeof body.detectedAt !== 'string' || Number.isNaN(Date.parse(body.detectedAt))) {
    errors.detectedAt = 'detectedAt must be a valid ISO-8601 timestamp.';
  }
  if (!String(body.model ?? '').trim()) errors.model = 'model is required.';
  if (body.pipelineStatus !== undefined && body.pipelineStatus !== 'beta') {
    errors.pipelineStatus = "pipelineStatus, if present, must be 'beta'.";
  }
  if (body.frameImage !== undefined && !FRAME_IMAGE_RE.test(body.frameImage)) {
    errors.frameImage = 'frameImage must be a data:image/jpeg or data:image/png base64 URL.';
  }
  return errors;
}

alertsRouter.get('/:id', requireAuth, requireOrgScope, requireActiveOrg, requirePermission('alerts:view'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.claims.orgId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(toWireAlert(rows[0]));
});

/**
 * The decision endpoints.
 *
 * `decidedBy` is the acting user's email, matching the mock's own
 * `decidedBy: claims?.email` exactly. Neither the mock nor this endpoint
 * gates on the alert's *current* status — confirming an already-decided
 * alert just overwrites, matching mockDecide's behavior rather than
 * inventing a state machine the frontend doesn't expect.
 */
function decide(status) {
  return async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE alerts SET status = $1, decided_by = $2, decided_at = now()
         WHERE id = $3 AND org_id = $4
         RETURNING ${ALERT_COLUMNS}`,
        [status, req.claims.email, req.params.id, req.claims.orgId],
      );
      const alert = rows[0];
      if (!alert) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not_found' });
      }

      const actor = await actorSnapshot(client, req.claims.sub);
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: status === 'confirmed' ? 'alert.confirmed' : 'alert.dismissed',
        summary:
          status === 'confirmed'
            ? `Confirmed ${alert.id} — ${detectionLabel(alert)} on ${alert.camera_name}`
            : `Marked ${alert.id} a false positive — ${detectionLabel(alert)} on ${alert.camera_name}`,
        detail:
          status === 'confirmed'
            ? ['Confirming records that a person took responsibility for the detection. Detecto contacted nobody.']
            : [],
        alertId: alert.id,
      });

      await client.query('COMMIT');
      res.status(200).json(toWireAlert(alert));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
}

alertsRouter.post(
  '/:id/confirm',
  requireAuth,
  requireOrgScope,
  requireActiveOrg,
  requirePermission('alerts:confirm'),
  decide('confirmed'),
);
alertsRouter.post(
  '/:id/dismiss',
  requireAuth,
  requireOrgScope,
  requireActiveOrg,
  requirePermission('alerts:confirm'),
  decide('dismissed'),
);
