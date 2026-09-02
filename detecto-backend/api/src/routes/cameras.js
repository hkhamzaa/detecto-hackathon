import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/validation.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';

export const camerasRouter = Router();

camerasRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

camerasRouter.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  next();
});

/**
 * No `cameras:manage` permission exists in the frontend's catalogue —
 * lib/roles/permissions.ts says so outright, camera admin was never gated
 * by more than "being in the org area at all." `cameras:view` is used as
 * the gate for mutations too, as the closest real stand-in; a future
 * `cameras:manage` key would replace this on both routes below.
 */
const CAN_MUTATE = requirePermission('cameras:view');

function toWireCamera(row) {
  return {
    id: row.id,
    name: row.name,
    zone: row.zone,
    online: row.online,
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
  };
}

camerasRouter.get('/', requirePermission('cameras:view'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, zone, online, last_seen FROM cameras WHERE org_id = $1 ORDER BY name`,
    [req.claims.orgId],
  );
  res.status(200).json({ cameras: rows.map(toWireCamera) });
});

/**
 * POST /api/cameras — body: {cameras: NewCamera[]}, matching addCameras()'s
 * real contract exactly (batch, not single — a create of one camera is just
 * an array of length 1).
 *
 * `discoveredId` can't currently resolve to anything: box discovery is
 * ephemeral and was never persisted even in the B1 schema design, and no
 * discovery endpoint exists yet (that's later, alongside the box-pairing
 * flow). It's still accepted for wire compatibility — its only effect
 * today is deciding `online`, matching the mock's own
 * `online: camera.discoveredId !== null` exactly. `boxId` is always stored
 * null until a real discovery/pairing flow exists.
 */
camerasRouter.post('/', CAN_MUTATE, async (req, res) => {
  const cameras = req.body?.cameras;
  if (!Array.isArray(cameras) || cameras.length === 0) {
    return res.status(422).json({ error: 'validation_failed', errors: { cameras: 'At least one camera is required.' } });
  }

  const errors = {};
  cameras.forEach((camera, index) => {
    if (!camera || typeof camera !== 'object') {
      errors[index] = 'Invalid camera.';
      return;
    }
    if (!String(camera.name ?? '').trim()) errors[index] = 'name is required.';
    else if (!String(camera.zone ?? '').trim()) errors[index] = 'zone is required.';
  });
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const camera of cameras) {
      const online = camera.discoveredId != null;
      const { rows } = await client.query(
        `INSERT INTO cameras (org_id, name, zone, online, last_seen, address)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, zone, online, last_seen`,
        [
          req.claims.orgId,
          String(camera.name).trim(),
          String(camera.zone).trim(),
          online,
          online ? new Date() : null,
          camera.address ? String(camera.address).trim() : null,
        ],
      );
      created.push(toWireCamera(rows[0]));
    }

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'camera.added',
      summary:
        created.length === 1
          ? `Added the camera ${created[0].name}`
          : `Added ${created.length} cameras: ${created.map((c) => c.name).join(', ')}`,
      detail: created.map((c) => `${c.name} to ${c.zone}.`),
    });

    await client.query('COMMIT');
    res.status(201).json({ cameras: created });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

camerasRouter.get('/:id', requirePermission('cameras:view'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, zone, online, last_seen FROM cameras WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.claims.orgId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(toWireCamera(rows[0]));
});

/**
 * PATCH /api/cameras/:id — not in the mock at all (this task asked for it
 * fresh). Only `name`/`zone` are editable: `online`/`lastSeen` are
 * device-reported state, and wiring the ingest pipeline to set them is
 * explicitly a later task, not this one.
 *
 * Deliberately does NOT do the atomic cross-table zone rewrite
 * lib/zones/api.ts's renameZone() does (cameras.zone + roles.zones +
 * notification_routes.target together) — that's a distinct "rename this
 * zone everywhere" operation on a module not in this task's scope. This
 * only moves the one camera to a (possibly new, possibly existing) zone.
 */
camerasRouter.patch('/:id', CAN_MUTATE, async (req, res) => {
  const { name, zone } = req.body ?? {};
  if (name === undefined && zone === undefined) {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'Nothing to update.' } });
  }
  if (name !== undefined && !String(name).trim()) {
    return res.status(422).json({ error: 'validation_failed', errors: { name: 'name cannot be empty.' } });
  }
  if (zone !== undefined && !String(zone).trim()) {
    return res.status(422).json({ error: 'validation_failed', errors: { zone: 'zone cannot be empty.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT name, zone FROM cameras WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.claims.orgId],
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const { rows } = await client.query(
      `UPDATE cameras SET
         name = COALESCE($1, name),
         zone = COALESCE($2, zone),
         updated_at = now()
       WHERE id = $3 AND org_id = $4
       RETURNING id, name, zone, online, last_seen`,
      [name?.trim() ?? null, zone?.trim() ?? null, req.params.id, req.claims.orgId],
    );
    const camera = rows[0];

    const changes = [];
    if (name !== undefined && before.rows[0].name !== camera.name) {
      changes.push(`Renamed from "${before.rows[0].name}" to "${camera.name}".`);
    }
    if (zone !== undefined && before.rows[0].zone !== camera.zone) {
      changes.push(`Moved from ${before.rows[0].zone} to ${camera.zone}.`);
    }

    if (changes.length > 0) {
      const actor = await actorSnapshot(client, req.claims.sub);
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'camera.updated',
        summary: `Updated the camera ${camera.name}`,
        detail: changes,
      });
    }

    await client.query('COMMIT');
    res.status(200).json(toWireCamera(camera));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * PUT /api/cameras/:id/modules/:moduleId — body: `{ enabled }`, matching
 * setCameraModule()'s real contract. `modules:manage`, not `cameras:view`
 * — this is the org's own modules page mutating what runs on a camera it
 * already owns, gated the same way GET /api/modules already is.
 *
 * `camera_modules` is a presence table: enabling inserts a row, disabling
 * deletes it, `enabled_at` needs no separate tracking beyond the row's own
 * existence. Refused for a module that isn't live in *either* direction —
 * matches lib/modules/api.ts's mockSet() exactly, which checks `isLive`
 * unconditionally before looking at which way `enabled` points.
 */
camerasRouter.put('/:id/modules/:moduleId', requirePermission('modules:manage'), async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(422).json({ error: 'validation_failed', errors: { enabled: 'enabled must be a boolean.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const camera = await client.query(
      `SELECT id FROM cameras WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.claims.orgId],
    );
    if (!camera.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const module_ = await client.query(`SELECT status FROM modules WHERE id = $1`, [req.params.moduleId]);
    if (!module_.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (module_.rows[0].status !== 'live') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'not_live' });
    }

    if (enabled) {
      await client.query(
        `INSERT INTO camera_modules (camera_id, module_id) VALUES ($1, $2)
         ON CONFLICT (camera_id, module_id) DO NOTHING`,
        [req.params.id, req.params.moduleId],
      );
    } else {
      await client.query(
        `DELETE FROM camera_modules WHERE camera_id = $1 AND module_id = $2`,
        [req.params.id, req.params.moduleId],
      );
    }

    const { rows: enabledRows } = await client.query(
      `SELECT module_id FROM camera_modules WHERE camera_id = $1 ORDER BY module_id`,
      [req.params.id],
    );

    const cameraName = await client.query(`SELECT name FROM cameras WHERE id = $1`, [req.params.id]);
    const moduleName = await client.query(`SELECT name FROM modules WHERE id = $1`, [req.params.moduleId]);
    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: enabled ? 'module.enabled' : 'module.disabled',
      summary: `${enabled ? 'Turned on' : 'Turned off'} ${moduleName.rows[0].name} for ${cameraName.rows[0].name}`,
      detail: [],
    });

    await client.query('COMMIT');
    res.status(200).json({ enabled: enabledRows.map((row) => row.module_id) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
