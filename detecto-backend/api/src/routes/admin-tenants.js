import { Router } from 'express';

import { pool } from '../db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { isUuid } from '../lib/validation.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';
import { revokeAllForOrg } from '../lib/refresh-tokens.js';

export const adminTenantsRouter = Router();

/**
 * `requireSuperAdmin`, never `requireOrgScope`/`requirePermission` — see
 * that middleware's own comment. Every query below deliberately has no
 * `org_id = $1` clause anywhere: this route group's whole reason to exist
 * is reading *across* every organization, which is exactly what every
 * other route in this codebase is built to prevent a single request from
 * doing.
 *
 * BOUNDARY: mirrors lib/tenants/api.ts's header exactly. Every query here
 * touches `organizations`, `plans`, `boxes` (only its count/last_seen_at)
 * and `invoices` — never `cameras.*`/`alerts.*` beyond a bare COUNT, and no
 * query selects a content column from either table. No response from this
 * file can carry a camera name, a zone, a detection, or a clip, because
 * none of them are ever selected — verified in this phase's own tests, in
 * the spirit of pages/admin/boundary.test.tsx on the frontend.
 *
 * Mounted at /api/admin — this router owns /summary and /tenants(/:id) as
 * siblings under that prefix, the same way orgRouter/rolesRouter/auditRouter
 * share /api/org.
 */
adminTenantsRouter.use(requireAuth, requireSuperAdmin);

const TENANT_COLUMNS = `
  o.id, o.name, o.plan_id, o.account_type, o.status, o.created_at,
  o.admin_email, o.trial_ends_at, o.suspended_at, o.note,
  (SELECT count(*) FROM cameras c WHERE c.org_id = o.id) AS camera_count,
  (SELECT count(*) FROM boxes b WHERE b.org_id = o.id) AS box_count,
  (SELECT count(*) FROM users u WHERE u.org_id = o.id) AS user_count
`;

function toWireTenant(row) {
  return {
    id: row.id,
    name: row.name,
    planId: row.plan_id,
    accountType: row.account_type,
    status: row.status,
    cameraCount: Number(row.camera_count),
    boxCount: Number(row.box_count),
    userCount: Number(row.user_count),
    createdAt: row.created_at.toISOString(),
    adminEmail: row.admin_email ?? '',
    trialEndsAt: row.trial_ends_at ? row.trial_ends_at.toISOString() : null,
    suspendedAt: row.suspended_at ? row.suspended_at.toISOString() : null,
    note: row.note ?? '',
  };
}

/* -------------------------------------------------------------------------- */
/* GET /api/admin/summary                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How long a box may go quiet before it's counted as silent rather than
 * reporting. One platform-wide threshold, not configurable per plan today.
 */
const SILENT_AFTER = '10 minutes';

adminTenantsRouter.get('/summary', async (req, res) => {
  const [tenantsByStatus, cameraTotal, alertsThisWeek, alertsLastWeek, health, recentSignups] =
    await Promise.all([
      pool.query(`SELECT status, count(*) AS count FROM organizations GROUP BY status`),
      pool.query(`SELECT count(*) AS count FROM cameras`),
      // "This week"/"last week" as rolling 7-day windows counted back from
      // now — matching lib/analytics/stats.ts's weekOnWeek(), not calendar
      // weeks. A COUNT crossing the boundary is the aggregate the mock's own
      // header describes as "the backend's own metrics rollup" — no alert
      // row is ever selected, here or anywhere in this file.
      pool.query(`SELECT count(*) AS count FROM alerts WHERE detected_at >= now() - interval '7 days'`),
      pool.query(
        `SELECT count(*) AS count FROM alerts
         WHERE detected_at >= now() - interval '14 days' AND detected_at < now() - interval '7 days'`,
      ),
      // A suspended tenant's boxes are excluded entirely, matching the
      // mock's own rule ("not syncing while suspended" — see
      // pages/admin/tenants/suspend.tsx) rather than counted as silent.
      pool.query(
        `SELECT
           count(*) FILTER (WHERE b.last_seen_at >= now() - $1::interval) AS reporting,
           count(*) FILTER (WHERE b.last_seen_at IS NULL OR b.last_seen_at < now() - $1::interval) AS silent
         FROM boxes b
         JOIN organizations o ON o.id = b.org_id
         WHERE o.status <> 'suspended'`,
        [SILENT_AFTER],
      ),
      pool.query(
        `SELECT id, name, plan_id, status, created_at FROM organizations ORDER BY created_at DESC LIMIT 4`,
      ),
    ]);

  const byStatus = (status) =>
    Number(tenantsByStatus.rows.find((row) => row.status === status)?.count ?? 0);

  res.status(200).json({
    tenants: {
      total: tenantsByStatus.rows.reduce((sum, row) => sum + Number(row.count), 0),
      active: byStatus('active'),
      trial: byStatus('trial'),
      suspended: byStatus('suspended'),
    },
    cameras: Number(cameraTotal.rows[0].count),
    alertsThisWeek: Number(alertsThisWeek.rows[0].count),
    alertsLastWeek: Number(alertsLastWeek.rows[0].count),
    health: {
      boxesReporting: Number(health.rows[0].reporting),
      boxesSilent: Number(health.rows[0].silent),
      checkedAt: new Date().toISOString(),
    },
    recentSignups: recentSignups.rows.map((row) => ({
      id: row.id,
      name: row.name,
      planId: row.plan_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/admin/tenants                                                     */
/* -------------------------------------------------------------------------- */

adminTenantsRouter.get('/tenants', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${TENANT_COLUMNS} FROM organizations o ORDER BY o.name`,
  );
  res.status(200).json({ tenants: rows.map(toWireTenant) });
});

adminTenantsRouter.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  next();
});

/* -------------------------------------------------------------------------- */
/* GET /api/admin/tenants/:id                                                 */
/* -------------------------------------------------------------------------- */

export async function loadTenantDetail(client, id) {
  const tenant = await client.query(`SELECT ${TENANT_COLUMNS} FROM organizations o WHERE o.id = $1`, [id]);
  if (!tenant.rows[0]) return null;

  const [plan, invoices, totalBilled] = await Promise.all([
    client.query(`SELECT monthly FROM plans WHERE id = $1`, [tenant.rows[0].plan_id]),
    client.query(
      `SELECT id, period_end, amount, status FROM invoices WHERE org_id = $1 ORDER BY period_end DESC`,
      [id],
    ),
    client.query(`SELECT COALESCE(sum(amount), 0) AS total FROM invoices WHERE org_id = $1`, [id]),
  ]);

  return {
    ...toWireTenant(tenant.rows[0]),
    billing: {
      monthly: Number(plan.rows[0]?.monthly ?? 0),
      totalBilled: Number(totalBilled.rows[0].total),
      invoices: invoices.rows.map((row) => ({
        id: row.id,
        periodEnd: row.period_end.toISOString(),
        amount: Number(row.amount),
        status: row.status,
      })),
    },
  };
}

adminTenantsRouter.get('/tenants/:id', async (req, res) => {
  const detail = await loadTenantDetail(pool, req.params.id);
  if (!detail) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(detail);
});

/* -------------------------------------------------------------------------- */
/* PATCH /api/admin/tenants/:id                                               */
/* -------------------------------------------------------------------------- */

const STATUSES = ['active', 'suspended'];

/**
 * lib/tenants/api.ts's setTenantStatus()/setTenantNote() both call
 * realPatch(), which PATCHes this one path with `{status}` or `{note}` —
 * not the two separate POST endpoints the task brief sketched; this
 * matches what the frontend actually sends, the same correction this
 * project has made every time a task description's guess and the real
 * fetch call disagreed (see e.g. the GET /api/org/audit vs /api/audit note
 * a few phases back). Accepts either field alone or both together, same
 * shape as org.js's PATCH /settings.
 *
 * `'trial'` is refused for `status` — not settable by hand, matching
 * setTenantStatus()'s own type (`Extract<TenantStatus, 'active' |
 * 'suspended'>`) and its comment: "putting one back into it by hand would
 * rewrite how it is being billed."
 */
adminTenantsRouter.patch('/tenants/:id', async (req, res) => {
  const { status, note } = req.body ?? {};

  if (status === undefined && note === undefined) {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'Nothing to update.' } });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(422).json({ error: 'validation_failed', errors: { status: "status must be 'active' or 'suspended'." } });
  }
  if (note !== undefined && typeof note !== 'string') {
    return res.status(422).json({ error: 'validation_failed', errors: { note: 'note must be a string.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(`SELECT status FROM organizations WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    const previousStatus = before.rows[0].status;
    const statusChanged = status !== undefined && status !== previousStatus;

    if (status !== undefined) {
      await client.query(
        `UPDATE organizations SET
           status = $1,
           suspended_at = CASE WHEN $1 = 'suspended' THEN now() WHEN $1 = 'active' THEN NULL ELSE suspended_at END,
           updated_at = now()
         WHERE id = $2`,
        [status, req.params.id],
      );
    }
    if (note !== undefined) {
      await client.query(`UPDATE organizations SET note = $1, updated_at = now() WHERE id = $2`, [note, req.params.id]);
    }

    // The acting super admin's own name, with a literal roleName — never
    // actorSnapshot()'s ordinary role lookup, which would join against
    // *this* org's roles and find nothing (a super admin holds none) —
    // see the note on AuditActor.roleName in lib/audit/api.ts for why a
    // literal string rather than null.
    const actor = { ...(await actorSnapshot(client, req.claims.sub)), roleName: 'Detecto Platform' };

    if (statusChanged && status === 'suspended') {
      // The real teeth: every active session on this org stops working on
      // its very next request (requireActiveOrg) and can't refresh past
      // that (revoked here) or sign back in (checked at login) — matching
      // suspend.tsx's own description of what suspension does.
      await revokeAllForOrg(client, req.params.id);
      await logAudit(client, {
        orgId: req.params.id,
        actor,
        action: 'platform.tenant_suspended',
        summary: 'Account suspended by Detecto',
        detail: [],
      });
    } else if (statusChanged && status === 'active') {
      await logAudit(client, {
        orgId: req.params.id,
        actor,
        action: 'platform.tenant_reactivated',
        summary: 'Account reactivated by Detecto',
        detail: [],
      });
    }

    if (note !== undefined) {
      await logAudit(client, {
        orgId: req.params.id,
        actor,
        action: 'platform.support_note_changed',
        summary: 'Support note updated by Detecto',
        // Never the note's own text — this is Detecto-internal context an
        // org's own audit reader (someone at the tenant, holding
        // audit:view) is not the audience for; that the note changed, and
        // by whom, is the part that belongs on their log.
        detail: [],
      });
    }

    const detail = await loadTenantDetail(client, req.params.id);
    await client.query('COMMIT');
    res.status(200).json(detail);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
