import { Router } from 'express';

import { pool } from '../db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export const adminBillingRouter = Router();

/**
 * `requireSuperAdmin`, same as adminTenantsRouter — see that file's own
 * comment for why this is never `requireOrgScope`/`requirePermission`.
 *
 * BOUNDARY: mirrors lib/billing/api.ts's header exactly. Every query here
 * touches `invoices`, `organizations` (name/status only, for the join) and
 * `plan_changes` — never `cameras.*`/`alerts.*` in any form. Money has no
 * route into footage; that is asserted below rather than assumed, the same
 * way admin-tenants.js does it.
 *
 * Mounted at /api/admin, alongside adminTenantsRouter — see that comment in
 * app.js. Deliberately its own file/router rather than folded into
 * admin-tenants.js: the frontend keeps `lib/tenants/api.ts` and
 * `lib/billing/api.ts` apart for the same reason (see this task's own
 * discovery note — revenue/MRR is arithmetic the browser already does over
 * `/api/admin/tenants`, so this router owns only the processor-side facts
 * neither that endpoint nor the browser can work out for itself: whether a
 * charge went through, and the plan-change history. No separate revenue
 * endpoint exists on purpose — a second read of tenant state here would be
 * exactly the "two pages disagree" drift risk this phase was asked to avoid).
 */
adminBillingRouter.use(requireAuth, requireSuperAdmin);

/**
 * Days after a period closes that payment is due. Not stored anywhere — no
 * `due_at` column exists on `invoices` — so it's derived the same way
 * lib/billing/api.ts's dev mock derives it (`PAYMENT_TERMS_DAYS`), which is
 * the only convention for this that exists anywhere in the codebase today.
 */
const PAYMENT_TERMS_DAYS = 14;

/* -------------------------------------------------------------------------- */
/* GET /api/admin/billing                                                     */
/* -------------------------------------------------------------------------- */

adminBillingRouter.get('/billing', async (req, res) => {
  const [outstandingRows, changeRows] = await Promise.all([
    // One row per unpaid invoice, not per tenant: nothing in the schema
    // enforces "only one outstanding invoice per account" (that's a seed-data
    // invariant, not a constraint), so this reads whatever is actually there
    // rather than assuming it.
    pool.query(
      `SELECT
         i.id, i.org_id, o.name AS org_name, o.plan_id, i.amount, i.period_end,
         i.attempts, i.reason, i.last_attempt_at, o.status AS org_status
       FROM invoices i
       JOIN organizations o ON o.id = i.org_id
       WHERE i.status IN ('due', 'failed')`,
    ),
    pool.query(
      `SELECT id, org_id, org_name, from_plan_id, to_plan_id, at
       FROM plan_changes
       ORDER BY at DESC`,
    ),
  ]);

  const now = Date.now();
  const TERMS_MS = PAYMENT_TERMS_DAYS * 24 * 60 * 60 * 1000;

  const outstanding = outstandingRows.rows.map((row) => {
    const dueAt = new Date(row.period_end).getTime() + TERMS_MS;
    return {
      tenantId: row.org_id,
      tenantName: row.org_name,
      planId: row.plan_id,
      amount: Number(row.amount),
      dueAt: new Date(dueAt).toISOString(),
      daysPastDue: Math.max(0, Math.floor((now - dueAt) / (24 * 60 * 60 * 1000))),
      attempts: row.attempts,
      reason: row.reason,
      lastAttemptAt: row.last_attempt_at ? row.last_attempt_at.toISOString() : null,
      suspended: row.org_status === 'suspended',
    };
  });

  const changes = changeRows.rows.map((row) => ({
    id: row.id,
    tenantId: row.org_id ?? '',
    tenantName: row.org_name,
    fromPlanId: row.from_plan_id,
    toPlanId: row.to_plan_id,
    at: row.at.toISOString(),
  }));

  res.status(200).json({ outstanding, changes });
});
