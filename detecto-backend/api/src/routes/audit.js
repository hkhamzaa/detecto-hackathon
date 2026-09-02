import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/validation.js';

export const auditRouter = Router();

// requirePermission('audit:view') is applied per-route below, not blanket
// here — see the matching comment in org.js for why: this router shares
// the /api/org prefix with orgRouter and rolesRouter, and a router-level
// permission check runs for every request reaching this router regardless
// of whether one of its own routes ends up matching.
auditRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

/**
 * Mirrors detecto-frontend/src/lib/audit/api.ts's AUDIT_ACTIONS exactly —
 * same closed list the audit_log_action_check constraint enforces on write
 * (see db/migrations/1788420000000_extend-audit-log-platform-actions.js,
 * the latest of the four migrations that have extended this list). An
 * action value outside this list can't exist in the table at all, so
 * filtering by it is just an early, friendlier 400 than "matched nothing."
 */
const AUDIT_ACTIONS = [
  'role.created', 'role.edited', 'role.deleted',
  'person.invited', 'person.role_changed', 'person.deactivated', 'person.reactivated',
  'camera.added', 'camera.removed', 'camera.updated',
  'module.enabled', 'module.disabled', 'module.zone_bulk',
  'notifications.routing_changed', 'notifications.escalation_changed',
  'alert.confirmed', 'alert.dismissed',
  'org.settings_changed',
  'auth.logged_in', 'auth.logged_out',
  'zone.renamed', 'zone.merged',
  'billing.plan_change_requested', 'billing.plan_change_withdrawn',
  'platform.tenant_suspended', 'platform.tenant_reactivated', 'platform.support_note_changed',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toWireEntry(row) {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: {
      id: row.actor_id,
      name: row.actor_name,
      roleName: row.actor_role_name,
    },
    action: row.action,
    summary: row.summary,
    detail: row.detail,
    alertId: row.alert_id,
  };
}

/**
 * GET /api/org/audit — lib/audit/api.ts's realLog() calls this with no query
 * string at all today; every filter in lib/audit/filter.ts's AuditFilter is
 * applied client-side over the full list. These query params exist ahead of
 * that — for when a future phase (server pagination/filtering, per the
 * mock's own header comment) wires the frontend to send them — using the
 * same field names/vocabulary. Omitting all of them returns the org's full
 * log, exactly what's called today.
 */
auditRouter.get('/audit', requirePermission('audit:view'), async (req, res) => {
  const { action, group, from, to, actorId } = req.query;

  const conditions = ['org_id = $1'];
  const params = [req.claims.orgId];

  if (action !== undefined) {
    if (!AUDIT_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid_action' });
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (group !== undefined) {
    if (!AUDIT_ACTIONS.some((a) => a.startsWith(`${group}.`))) {
      return res.status(400).json({ error: 'invalid_group' });
    }
    params.push(`${group}.%`);
    conditions.push(`action LIKE $${params.length}`);
  }
  if (from !== undefined) {
    if (!DATE_RE.test(from)) return res.status(400).json({ error: 'invalid_from' });
    params.push(from);
    conditions.push(`at >= $${params.length}::date`);
  }
  if (to !== undefined) {
    if (!DATE_RE.test(to)) return res.status(400).json({ error: 'invalid_to' });
    params.push(to);
    conditions.push(`at < $${params.length}::date + interval '1 day'`);
  }
  if (actorId !== undefined) {
    if (!isUuid(actorId)) return res.status(400).json({ error: 'invalid_actor_id' });
    params.push(actorId);
    conditions.push(`actor_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT id, at, actor_id, actor_name, actor_role_name, action, summary, detail, alert_id
     FROM audit_log
     WHERE ${conditions.join(' AND ')}
     ORDER BY at DESC`,
    params,
  );

  res.status(200).json({ entries: rows.map(toWireEntry) });
});
