import { Router } from 'express';

import { pool } from '../db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export const adminModulesRouter = Router();

/**
 * `requireSuperAdmin`, same as adminTenantsRouter/adminBillingRouter — this
 * is the platform-level counterpart to modules.js's GET /api/modules
 * (`requireOrgScope`-gated): that one answers "which of the modules
 * available to me are running on this camera" for one org; this one
 * answers "which modules exist, and who is entitled to them" for the whole
 * catalogue. See lib/module-flags/api.ts's own header — confirmed against
 * the frontend rather than assumed, per this phase's Step 1.
 *
 * Not audited. audit_log.org_id is NOT NULL and a module release isn't
 * scoped to any one org — there's no correct id to write here, unlike
 * platform.tenant_suspended (which targets one specific tenant's own log).
 * A genuine platform-level audit trail would need its own table; that's a
 * real follow-up, not a guess made mid-phase. See this phase's Step 1
 * report for the full reasoning.
 */
adminModulesRouter.use(requireAuth, requireSuperAdmin);

const STATUSES = ['live', 'coming_soon'];

function toWireModule(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    module_status: row.status,
    false_positive_rate: row.status === 'live' ? row.false_positive_rate : null,
    resource_note: row.resource_note,
    plan_ids: row.plan_ids,
    live_since: row.live_since ? row.live_since.toISOString() : null,
  };
}

/* -------------------------------------------------------------------------- */
/* GET /api/admin/modules                                                     */
/* -------------------------------------------------------------------------- */

adminModulesRouter.get('/modules', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, status, false_positive_rate, resource_note, plan_ids, live_since
     FROM modules
     ORDER BY (status = 'live') DESC, name`,
  );
  res.status(200).json({ modules: rows.map(toWireModule) });
});

// modules.id is text (a catalogue slug like 'weapon'), not a uuid — no
// isUuid param gate here (contrast admin-tenants.js's :id); an unknown id
// just falls through to the 404 the PATCH below already returns.

/* -------------------------------------------------------------------------- */
/* PATCH /api/admin/modules/:id                                               */
/* -------------------------------------------------------------------------- */

/**
 * Accepts `status`, `planIds` and/or `falsePositiveRate`, any subset —
 * same "whatever's present, applied together" shape as PATCH
 * /api/admin/tenants/:id. The contract lib/module-flags/api.ts's own mock
 * holds is enforced here rather than trusted from the client:
 *   - going live stamps `live_since` only if it wasn't already set
 *     (re-releasing doesn't misreport how long a module has actually run);
 *     going back to coming_soon clears it.
 *   - a rate never survives on anything not live — matches the DB's own
 *     modules_rate_requires_live_check constraint, computed here so the
 *     response reflects it immediately rather than a follow-up read doing
 *     the correcting.
 */
adminModulesRouter.patch('/modules/:id', async (req, res) => {
  const body = req.body ?? {};
  const { status, planIds, falsePositiveRate } = body;

  if (status === undefined && planIds === undefined && falsePositiveRate === undefined) {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'Nothing to update.' } });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(422).json({
      error: 'validation_failed',
      errors: { status: "status must be 'live' or 'coming_soon'." },
    });
  }
  if (planIds !== undefined) {
    if (!Array.isArray(planIds) || !planIds.every((id) => typeof id === 'string')) {
      return res.status(422).json({ error: 'validation_failed', errors: { planIds: 'planIds must be a list of plan ids.' } });
    }
    // Checked against the real catalogue rather than a hardcoded list, so
    // this can never drift from what `plans` actually holds.
    const known = await pool.query('SELECT id FROM plans');
    const knownIds = known.rows.map((row) => row.id);
    const unknown = planIds.filter((id) => !knownIds.includes(id));
    if (unknown.length > 0) {
      return res.status(422).json({
        error: 'validation_failed',
        errors: { planIds: `Unknown plan id(s): ${unknown.join(', ')}.` },
      });
    }
  }
  if (
    falsePositiveRate !== undefined &&
    falsePositiveRate !== null &&
    (typeof falsePositiveRate !== 'number' || falsePositiveRate < 0 || falsePositiveRate > 1)
  ) {
    return res.status(422).json({
      error: 'validation_failed',
      errors: { falsePositiveRate: 'falsePositiveRate must be a number between 0 and 1, or null.' },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT status, false_positive_rate, live_since FROM modules WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const nextStatus = status ?? before.rows[0].status;
    // `in` rather than `??` — the rate is nullable, so "clear the rate" and
    // "this patch didn't mention it" both arrive as a falsy value, and `??`
    // would read the first as the second and silently keep the old number.
    const requestedRate = 'falsePositiveRate' in body ? falsePositiveRate : before.rows[0].false_positive_rate;
    const nextRate = nextStatus === 'live' ? requestedRate : null;
    const nextLiveSince =
      nextStatus === 'live'
        ? (before.rows[0].live_since ?? new Date())
        : null;

    const updates = [];
    const values = [];
    let index = 1;

    if (status !== undefined) {
      updates.push(`status = $${index++}`);
      values.push(nextStatus);
    }
    if (planIds !== undefined) {
      updates.push(`plan_ids = $${index++}`);
      values.push(planIds);
    }
    // Rate/live_since are written whenever status is touched (to keep the
    // contract) or when the rate itself was the thing patched.
    if (status !== undefined || falsePositiveRate !== undefined) {
      updates.push(`false_positive_rate = $${index++}`);
      values.push(nextRate);
      updates.push(`live_since = $${index++}`);
      values.push(nextLiveSince);
    }
    updates.push(`updated_at = now()`);

    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE modules SET ${updates.join(', ')} WHERE id = $${index}
       RETURNING id, name, description, status, false_positive_rate, resource_note, plan_ids, live_since`,
      values,
    );

    await client.query('COMMIT');
    res.status(200).json(toWireModule(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
