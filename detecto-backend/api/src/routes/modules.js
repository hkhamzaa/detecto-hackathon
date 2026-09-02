import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';

export const modulesRouter = Router();

modulesRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

/**
 * GET /api/modules — the detection-module catalogue, plus which of them are
 * enabled per camera in this org. Read-only: switching a module on/off is a
 * separate, later phase (PUT /api/cameras/:id/modules/:id, POST
 * /api/modules/zone) — this route only serves lib/modules/api.ts's
 * getModuleConfig().
 *
 * `modules:manage` gates this even though it's a read: lib/roles/permissions.ts
 * has no separate view-only key for this feature area, so it's the only grant
 * available to check.
 *
 * Not filtered by the org's plan (modules.plan_ids) — the mock this matches
 * (MOCK_CATALOGUE via mockConfig()) returns the full catalogue regardless of
 * plan, and plan-gated entitlement is a billing concern out of this phase's
 * scope.
 */
modulesRouter.get('/', requirePermission('modules:manage'), async (req, res) => {
  const [modules, cameras] = await Promise.all([
    pool.query(
      `SELECT id, name, description, status, false_positive_rate, resource_note
       FROM modules
       ORDER BY (status = 'live') DESC, name`,
    ),
    pool.query(
      `SELECT c.id AS camera_id, array_remove(array_agg(cm.module_id), NULL) AS enabled
       FROM cameras c
       LEFT JOIN camera_modules cm ON cm.camera_id = c.id
       WHERE c.org_id = $1
       GROUP BY c.id
       ORDER BY c.id`,
      [req.claims.orgId],
    ),
  ]);

  res.status(200).json({
    modules: modules.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      // The frozen contract's wire key is literally `module_status`, not
      // `status` — see lib/modules/catalogue.ts's header comment.
      module_status: row.status,
      // Belt and suspenders alongside the DB's own
      // modules_rate_requires_live_check constraint: a non-live module never
      // carries a rate on the wire either.
      false_positive_rate: row.status === 'live' ? row.false_positive_rate : null,
      resource_note: row.resource_note,
    })),
    cameras: cameras.rows.map((row) => ({
      cameraId: row.camera_id,
      enabled: row.enabled,
    })),
  });
});

/**
 * POST /api/modules/zone — body: `{ zone, moduleId, enabled }`, matching
 * setZoneModule()'s real contract: the same change applied to every camera
 * in one zone, in one request rather than one PUT per camera. Refused for
 * a module that isn't live, same as the per-camera route.
 *
 * `changed`/`unchanged` mirror mockSetZone() exactly: a camera already in
 * the requested state doesn't get an audit line of its own or a wasted
 * write, but still counts in the total the confirm copy quotes.
 */
modulesRouter.post('/zone', requirePermission('modules:manage'), async (req, res) => {
  const { zone, moduleId, enabled } = req.body ?? {};
  const errors = {};
  if (!String(zone ?? '').trim()) errors.zone = 'zone is required.';
  if (!String(moduleId ?? '').trim()) errors.moduleId = 'moduleId is required.';
  if (typeof enabled !== 'boolean') errors.enabled = 'enabled must be a boolean.';
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const module_ = await client.query(`SELECT status, name FROM modules WHERE id = $1`, [moduleId]);
    if (!module_.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (module_.rows[0].status !== 'live') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'not_live' });
    }

    const cameras = await client.query(
      `SELECT c.id, (cm.camera_id IS NOT NULL) AS already
       FROM cameras c
       LEFT JOIN camera_modules cm ON cm.camera_id = c.id AND cm.module_id = $1
       WHERE c.org_id = $2 AND c.zone = $3`,
      [moduleId, req.claims.orgId, zone],
    );

    const toChange = cameras.rows.filter((row) => row.already !== enabled);

    if (toChange.length > 0) {
      if (enabled) {
        await client.query(
          `INSERT INTO camera_modules (camera_id, module_id)
           SELECT unnest($1::uuid[]), $2
           ON CONFLICT (camera_id, module_id) DO NOTHING`,
          [toChange.map((row) => row.id), moduleId],
        );
      } else {
        await client.query(
          `DELETE FROM camera_modules WHERE module_id = $1 AND camera_id = ANY($2::uuid[])`,
          [moduleId, toChange.map((row) => row.id)],
        );
      }

      const actor = await actorSnapshot(client, req.claims.sub);
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'module.zone_bulk',
        summary: `${enabled ? 'Turned on' : 'Turned off'} ${module_.rows[0].name} across ${zone}`,
        detail: [
          `${toChange.length} ${toChange.length === 1 ? 'camera' : 'cameras'} changed, ${cameras.rows.length - toChange.length} already ${enabled ? 'on' : 'off'}.`,
        ],
      });
    }

    await client.query('COMMIT');
    res.status(200).json({ changed: toChange.length, unchanged: cameras.rows.length - toChange.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
