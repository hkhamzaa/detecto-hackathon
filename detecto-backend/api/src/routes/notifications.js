import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';
import { isUuid } from '../lib/validation.js';

export const notificationsRouter = Router();

// `org:settings` gates this — lib/roles/permissions.ts's own description of
// that key is "Sites and zones, notification routes, and escalation
// contacts", so this is the same grant org.js's /settings routes use, not a
// new one.
notificationsRouter.use(requireAuth, requireOrgScope, requireActiveOrg, requirePermission('org:settings'));

const KINDS = ['zone', 'module'];
const DELAYS = [5, 15, 30];

function toWireSettings(routes, escalation) {
  return {
    routes: routes.map((row) => ({
      kind: row.kind,
      target: row.target,
      roleIds: row.role_ids,
    })),
    escalation: escalation
      ? {
          enabled: escalation.enabled,
          afterMinutes: escalation.after_minutes,
          roleIds: escalation.role_ids,
        }
      // No row yet is the org's real starting state — off, and nothing
      // narrowed — matching lib/notifications/api.ts's mock seed exactly.
      : { enabled: false, afterMinutes: 15, roleIds: [] },
  };
}

async function currentSettings(client, orgId) {
  const [routes, escalation] = await Promise.all([
    client.query(
      `SELECT kind, target, role_ids FROM notification_routes WHERE org_id = $1 ORDER BY kind, target`,
      [orgId],
    ),
    client.query(`SELECT enabled, after_minutes, role_ids FROM notification_escalation_policy WHERE org_id = $1`, [orgId]),
  ]);
  return toWireSettings(routes.rows, escalation.rows[0] ?? null);
}

/**
 * Every role id an override names has to be a real role in this org —
 * role_ids isn't a foreign key array (B1's own comment: "enforced at the app
 * layer"), and silently dropping an unrecognized one here would be a quieter
 * failure than anywhere else in the app: it's who gets told about a weapon.
 */
async function unknownRoleIds(client, orgId, roleIds) {
  if (roleIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT id FROM roles WHERE org_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, roleIds],
  );
  const known = new Set(rows.map((row) => row.id));
  return roleIds.filter((id) => !known.has(id));
}

notificationsRouter.get('/', async (req, res) => {
  const settings = await currentSettings(pool, req.claims.orgId);
  res.status(200).json(settings);
});

/**
 * PUT /api/org/notifications/routes — lib/notifications/api.ts's setRoute().
 * `roleIds: null` is "back to default", stored as no row at all rather than
 * a stored null — matching mockSetRoute exactly, and the schema's own
 * comment on notification_routes.
 */
notificationsRouter.put('/routes', async (req, res) => {
  const { kind, target, roleIds } = req.body ?? {};

  if (!KINDS.includes(kind)) {
    return res.status(422).json({ error: 'validation_failed', errors: { kind: "kind must be 'zone' or 'module'." } });
  }
  if (!String(target ?? '').trim()) {
    return res.status(422).json({ error: 'validation_failed', errors: { target: 'target is required.' } });
  }
  if (roleIds !== null) {
    if (!Array.isArray(roleIds) || !roleIds.every(isUuid)) {
      return res.status(422).json({ error: 'validation_failed', errors: { roleIds: 'roleIds must be an array of role ids, or null.' } });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (roleIds !== null) {
      const unknown = await unknownRoleIds(client, req.claims.orgId, roleIds);
      if (unknown.length > 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'validation_failed', errors: { roleIds: `Unknown role id(s): ${unknown.join(', ')}` } });
      }
    }

    if (roleIds === null) {
      await client.query(
        `DELETE FROM notification_routes WHERE org_id = $1 AND kind = $2 AND target = $3`,
        [req.claims.orgId, kind, target],
      );
    } else {
      await client.query(
        `INSERT INTO notification_routes (org_id, kind, target, role_ids)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, kind, target) DO UPDATE SET role_ids = excluded.role_ids`,
        [req.claims.orgId, kind, target, roleIds],
      );
    }

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'notifications.routing_changed',
      summary:
        roleIds === null
          ? `Put ${target} back to the default routing`
          : `Narrowed ${target} alerts to ${roleIds.length} role(s)`,
      detail: [],
    });

    const settings = await currentSettings(client, req.claims.orgId);
    await client.query('COMMIT');
    res.status(200).json(settings);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * PUT /api/org/notifications/escalation — lib/notifications/api.ts's
 * setEscalation(). One row per org; upserted rather than required to exist
 * first, since a new org has none yet (off, per the mock's own default).
 */
notificationsRouter.put('/escalation', async (req, res) => {
  const { enabled, afterMinutes, roleIds } = req.body ?? {};

  if (typeof enabled !== 'boolean') {
    return res.status(422).json({ error: 'validation_failed', errors: { enabled: 'enabled must be a boolean.' } });
  }
  if (!DELAYS.includes(afterMinutes)) {
    return res.status(422).json({ error: 'validation_failed', errors: { afterMinutes: 'afterMinutes must be 5, 15, or 30.' } });
  }
  if (!Array.isArray(roleIds) || !roleIds.every(isUuid)) {
    return res.status(422).json({ error: 'validation_failed', errors: { roleIds: 'roleIds must be an array of role ids.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const unknown = await unknownRoleIds(client, req.claims.orgId, roleIds);
    if (unknown.length > 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'validation_failed', errors: { roleIds: `Unknown role id(s): ${unknown.join(', ')}` } });
    }

    await client.query(
      `INSERT INTO notification_escalation_policy (org_id, enabled, after_minutes, role_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id) DO UPDATE SET enabled = excluded.enabled, after_minutes = excluded.after_minutes, role_ids = excluded.role_ids`,
      [req.claims.orgId, enabled, afterMinutes, roleIds],
    );

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'notifications.escalation_changed',
      summary: enabled
        ? `Turned escalation on: unreviewed alerts also notify ${roleIds.length} role(s) after ${afterMinutes} minutes`
        : 'Turned escalation off',
      detail: [],
    });

    const settings = await currentSettings(client, req.claims.orgId);
    await client.query('COMMIT');
    res.status(200).json(settings);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
