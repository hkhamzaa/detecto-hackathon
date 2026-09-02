import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { ALERT_COLUMNS, toWireAlert } from '../lib/alert-shape.js';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth, requireOrgScope, requireActiveOrg, requirePermission('analytics:view'));

/**
 * How far back the reporting window reaches. lib/analytics/api.ts's mock
 * comment says this should come "from the plan's retention" — but the
 * schema has no structured retention-days field anywhere (plans.includes is
 * free text like "90-day clip history", never parsed as data). Fixed at the
 * mock's own default (eight weeks) rather than inventing a column for it;
 * see the Step 1 report for this phase.
 */
const WINDOW_DAYS = 56;

/**
 * GET /api/analytics/alerts — raw alert records over the reporting window,
 * not pre-computed statistics. lib/analytics/stats.ts derives every number
 * the analytics page shows from records shaped exactly like GET /api/alerts'
 * — deliberately: a backend that returned ready-made percentages would be
 * quicker and completely unauditable (see lib/analytics/api.ts's header).
 */
analyticsRouter.get('/alerts', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLUMNS} FROM alerts
     WHERE org_id = $1 AND detected_at >= now() - $2::interval
     ORDER BY detected_at DESC`,
    [req.claims.orgId, `${WINDOW_DAYS} days`],
  );

  res.status(200).json({
    alerts: rows.map(toWireAlert),
    windowDays: WINDOW_DAYS,
  });
});
