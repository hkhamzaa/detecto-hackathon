import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';

export const zonesRouter = Router();

// Same grant as org.js's /settings and notifications.js — see the comment
// there. A zone rename/merge is exactly the "Sites and zones" half of it.
zonesRouter.use(requireAuth, requireOrgScope, requireActiveOrg, requirePermission('org:settings'));

/**
 * A zone has no table and no id (see db/migrations/1788172856222_init-schema.js's
 * header note) — it's a name repeated across cameras.zone, roles.zones, and
 * a zone-kind notification_routes.target. Both rename and merge rewrite all
 * three in one transaction; a partial success would leave a role or a route
 * pointing at a name nothing has, silently. See lib/zones/api.ts's header
 * for the full reasoning this mirrors.
 */

async function zoneExists(client, orgId, zone) {
  const { rows } = await client.query(
    `SELECT 1 FROM cameras WHERE org_id = $1 AND zone = $2 LIMIT 1`,
    [orgId, zone],
  );
  return rows.length > 0;
}

/** Rewrites `from` -> `to` in every role's zones array that holds it. Deduped, in case a role already holds both. */
async function rewriteRoleZones(client, orgId, from, to) {
  const { rows } = await client.query(
    `SELECT id, zones FROM roles WHERE org_id = $1 AND zones IS NOT NULL AND $2 = ANY(zones)`,
    [orgId, from],
  );
  for (const role of rows) {
    const next = [...new Set(role.zones.map((zone) => (zone === from ? to : zone)))];
    await client.query(`UPDATE roles SET zones = $1, updated_at = now() WHERE id = $2`, [next, role.id]);
  }
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* POST /api/org/zones/rename                                                 */
/* -------------------------------------------------------------------------- */

zonesRouter.post('/rename', async (req, res) => {
  const { from, to } = req.body ?? {};
  if (typeof from !== 'string' || !from || typeof to !== 'string') {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'from and to are required.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!(await zoneExists(client, req.claims.orgId, from))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    // Mirrors lib/zones/references.ts's renameIssue() exactly: empty and
    // unchanged are both refused (mockRename maps both to 'unavailable',
    // not a distinct code, so a generic 422 here lands the same way through
    // realWrite's `!response.ok` branch).
    const next = to.trim();
    if (!next || next === from) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'validation_failed', errors: { to: 'to must be non-empty and different from from.' } });
    }

    // A name that matches a *different* existing zone, case-insensitively,
    // is a merge wearing a rename's clothes — refused the same way the page
    // itself refuses it before ever calling this.
    const { rows: clash } = await client.query(
      `SELECT 1 FROM cameras WHERE org_id = $1 AND lower(zone) = lower($2) AND zone <> $3 LIMIT 1`,
      [req.claims.orgId, next, from],
    );
    if (clash.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'name_taken' });
    }

    const { rows: movedCameras } = await client.query(
      `UPDATE cameras SET zone = $1, updated_at = now() WHERE org_id = $2 AND zone = $3 RETURNING id`,
      [next, req.claims.orgId, from],
    );
    const rolesUpdated = await rewriteRoleZones(client, req.claims.orgId, from, next);

    // An orphan route already sitting at `next` (no camera currently has
    // that zone, but a route was never cleaned up) would collide with the
    // unique (org_id, kind, target) constraint — cleared first, same as the
    // rename itself takes over the destination name outright.
    await client.query(
      `DELETE FROM notification_routes WHERE org_id = $1 AND kind = 'zone' AND target = $2`,
      [req.claims.orgId, next],
    );
    const { rowCount: routeMoved } = await client.query(
      `UPDATE notification_routes SET target = $1 WHERE org_id = $2 AND kind = 'zone' AND target = $3`,
      [next, req.claims.orgId, from],
    );

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'zone.renamed',
      summary: `Renamed the zone "${from}" to "${next}"`,
      detail: [
        `${movedCameras.length} camera${movedCameras.length === 1 ? '' : 's'} moved.`,
        ...(rolesUpdated > 0 ? [`${rolesUpdated} role${rolesUpdated === 1 ? '' : 's'} updated.`] : []),
        ...(routeMoved > 0 ? ['Its notification route moved with it.'] : []),
      ],
    });

    await client.query('COMMIT');
    res.status(200).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/org/zones/merge                                                  */
/* -------------------------------------------------------------------------- */

zonesRouter.post('/merge', async (req, res) => {
  const { from, into } = req.body ?? {};
  if (typeof from !== 'string' || !from || typeof into !== 'string' || !into) {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'from and into are required.' } });
  }
  if (from === into) {
    return res.status(404).json({ error: 'not_found' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const [fromExists, intoExists] = await Promise.all([
      zoneExists(client, req.claims.orgId, from),
      zoneExists(client, req.claims.orgId, into),
    ]);
    if (!fromExists || !intoExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    /**
     * Mirrors lib/zones/references.ts's mergeRoute() exactly: widen, never
     * narrow. Non-null (a union) only when *both* zones were individually
     * narrowed; any other combination — neither narrowed, or only one was —
     * falls back to the default, since an absent row is how the default is
     * stored and the wider of two settings must win.
     */
    const [fromRoute, intoRoute] = await Promise.all([
      client.query(`SELECT role_ids FROM notification_routes WHERE org_id = $1 AND kind = 'zone' AND target = $2`, [req.claims.orgId, from]),
      client.query(`SELECT role_ids FROM notification_routes WHERE org_id = $1 AND kind = 'zone' AND target = $2`, [req.claims.orgId, into]),
    ]);
    const mergedRoleIds =
      fromRoute.rows[0] && intoRoute.rows[0]
        ? [...new Set([...fromRoute.rows[0].role_ids, ...intoRoute.rows[0].role_ids])]
        : null;

    const { rows: movedCameras } = await client.query(
      `UPDATE cameras SET zone = $1, updated_at = now() WHERE org_id = $2 AND zone = $3 RETURNING id`,
      [into, req.claims.orgId, from],
    );
    const rolesUpdated = await rewriteRoleZones(client, req.claims.orgId, from, into);

    // The `from` row always goes — that name no longer exists. The `into`
    // row goes too when the merged outcome is the default (absent = default);
    // otherwise it's overwritten with the union computed above.
    await client.query(`DELETE FROM notification_routes WHERE org_id = $1 AND kind = 'zone' AND target = $2`, [req.claims.orgId, from]);
    if (mergedRoleIds === null) {
      await client.query(`DELETE FROM notification_routes WHERE org_id = $1 AND kind = 'zone' AND target = $2`, [req.claims.orgId, into]);
    } else {
      await client.query(
        `UPDATE notification_routes SET role_ids = $1 WHERE org_id = $2 AND kind = 'zone' AND target = $3`,
        [mergedRoleIds, req.claims.orgId, into],
      );
    }

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'zone.merged',
      summary: `Merged the zone "${from}" into "${into}"`,
      detail: [
        `${movedCameras.length} camera${movedCameras.length === 1 ? '' : 's'} moved.`,
        ...(rolesUpdated > 0 ? [`${rolesUpdated} role${rolesUpdated === 1 ? '' : 's'} rescoped.`] : []),
        mergedRoleIds === null
          ? 'Notification routing kept the default — everyone who can see alerts is told.'
          : `Notification routing now notifies ${mergedRoleIds.length} role(s) — the union of both zones' settings.`,
      ],
    });

    await client.query('COMMIT');
    res.status(200).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
