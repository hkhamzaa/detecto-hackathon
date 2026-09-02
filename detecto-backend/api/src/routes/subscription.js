import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';

export const subscriptionRouter = Router();

/**
 * `billing:manage` — lib/roles/permissions.ts's own description of that key
 * is "The plan, invoices, payment method and billing contact." This is that
 * exact surface, distinct from `org:settings` (sites/zones/notifications).
 */
subscriptionRouter.use(requireAuth, requireOrgScope, requireActiveOrg, requirePermission('billing:manage'));

/**
 * NO PAYMENT PROCESSOR IS CONNECTED HERE, DELIBERATELY.
 *
 * This mirrors lib/subscription/api.ts's own boundary exactly: `planId` on
 * `organizations` never moves as a side effect of anything in this file.
 * POST /plan-change writes only subscriptions.pending_change_plan_id and
 * .pending_change_requested_at — the same "records an intent, does not
 * change the plan" contract the frontend's naming and types already commit
 * to (PlanChangeRequest.status is a single-value literal `'requested'`
 * because nothing in the product can ever move it further). Actually
 * moving an org onto a different plan is a distinct, future, deliberately
 * out-of-scope action — see this phase's Step 1 report.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toWireInvoice(row) {
  return {
    id: row.id,
    periodEnd: row.period_end.toISOString(),
    amount: num(row.amount),
    status: row.status,
  };
}

function toWireSubscription(org, sub, invoices) {
  return {
    planId: org.plan_id,
    accountType: org.account_type,
    status: org.status,
    trialEndsAt: org.trial_ends_at ? org.trial_ends_at.toISOString() : null,
    renewsAt: sub.renews_at.toISOString(),
    billingEmail: sub.billing_email ?? '',
    invoices: invoices.map(toWireInvoice),
    pendingChange: sub.pending_change_plan_id
      ? {
          planId: sub.pending_change_plan_id,
          requestedAt: sub.pending_change_requested_at.toISOString(),
          status: 'requested',
        }
      : null,
  };
}

/**
 * Reads the full subscription state, lazily creating the subscriptions row
 * on first visit — signup (auth.js) creates organizations/roles/users but
 * not a subscriptions row, so an org that predates this phase (or any org
 * that has simply never opened its billing page) would otherwise have none.
 * `ON CONFLICT DO NOTHING` makes this safe under concurrent first-visits.
 */
async function loadSubscriptionState(client, orgId) {
  const org = await client.query(
    `SELECT plan_id, account_type, status, trial_ends_at FROM organizations WHERE id = $1`,
    [orgId],
  );
  if (!org.rows[0]) return null;

  await client.query(
    `INSERT INTO subscriptions (org_id, renews_at) VALUES ($1, now() + interval '30 days')
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId],
  );
  const sub = await client.query(`SELECT * FROM subscriptions WHERE org_id = $1`, [orgId]);
  const invoices = await client.query(
    `SELECT id, period_end, amount, status FROM invoices WHERE org_id = $1 ORDER BY period_end DESC`,
    [orgId],
  );

  return toWireSubscription(org.rows[0], sub.rows[0], invoices.rows);
}

subscriptionRouter.get('/', async (req, res) => {
  const state = await loadSubscriptionState(pool, req.claims.orgId);
  // The org in the token was deleted out from under an otherwise-valid
  // session — same not-reachable-in-normal-operation case org.js's own
  // /settings route guards against.
  if (!state) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(state);
});

/**
 * POST /api/org/subscription/plan-change — lib/subscription/api.ts's
 * requestPlanChange(). Mirrors mockRequest's validation exactly: a plan the
 * catalogue doesn't have, one from the other audience (home vs org), or the
 * org's own current plan are all refused the same way — `unknown_plan`,
 * regardless of which of the three it was.
 */
subscriptionRouter.post('/plan-change', async (req, res) => {
  const { planId } = req.body ?? {};
  if (typeof planId !== 'string' || !planId) {
    return res.status(422).json({ error: 'validation_failed', errors: { planId: 'planId is required.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const org = await client.query(
      `SELECT plan_id, account_type FROM organizations WHERE id = $1 FOR UPDATE`,
      [req.claims.orgId],
    );
    if (!org.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const plan = await client.query(`SELECT id, name, audience FROM plans WHERE id = $1`, [planId]);
    if (!plan.rows[0] || plan.rows[0].audience !== org.rows[0].account_type || planId === org.rows[0].plan_id) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'unknown_plan' });
    }

    await client.query(
      `INSERT INTO subscriptions (org_id, renews_at, pending_change_plan_id, pending_change_requested_at)
       VALUES ($1, now() + interval '30 days', $2, now())
       ON CONFLICT (org_id) DO UPDATE SET
         pending_change_plan_id = excluded.pending_change_plan_id,
         pending_change_requested_at = excluded.pending_change_requested_at`,
      [req.claims.orgId, planId],
    );

    const currentPlan = await client.query(`SELECT name FROM plans WHERE id = $1`, [org.rows[0].plan_id]);
    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'billing.plan_change_requested',
      summary: `Requested a move to ${plan.rows[0].name}`,
      detail: [
        `Currently on ${currentPlan.rows[0]?.name ?? org.rows[0].plan_id}.`,
        'No charge has been made — this is a request only.',
      ],
    });

    const state = await loadSubscriptionState(client, req.claims.orgId);
    await client.query('COMMIT');
    res.status(200).json(state);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/org/subscription/plan-change — lib/subscription/api.ts's
 * withdrawPlanChange(). Idempotent, like the mock: withdrawing with nothing
 * pending just succeeds having changed nothing, and only logs an audit
 * entry when there was actually a request to take back.
 */
subscriptionRouter.delete('/plan-change', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const org = await client.query(`SELECT 1 FROM organizations WHERE id = $1`, [req.claims.orgId]);
    if (!org.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const before = await client.query(
      `SELECT pending_change_plan_id FROM subscriptions WHERE org_id = $1`,
      [req.claims.orgId],
    );
    const hadPending = before.rows[0]?.pending_change_plan_id ?? null;

    await client.query(
      `UPDATE subscriptions SET pending_change_plan_id = NULL, pending_change_requested_at = NULL WHERE org_id = $1`,
      [req.claims.orgId],
    );

    if (hadPending) {
      const plan = await client.query(`SELECT name FROM plans WHERE id = $1`, [hadPending]);
      const actor = await actorSnapshot(client, req.claims.sub);
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'billing.plan_change_withdrawn',
        summary: `Withdrew the request to move to ${plan.rows[0]?.name ?? hadPending}`,
        detail: [],
      });
    }

    const state = await loadSubscriptionState(client, req.claims.orgId);
    await client.query('COMMIT');
    res.status(200).json(state);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
