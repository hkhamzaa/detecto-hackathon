import { Router } from 'express';

import { pool } from '../db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { observedHours, snapshot } from '../lib/request-metrics.js';

export const adminHealthRouter = Router();

/**
 * `requireSuperAdmin`, same as every other /api/admin/* router.
 *
 * BOUNDARY: mirrors lib/health/api.ts's header. The fleet query below
 * touches `organizations` and `boxes` only — never `cameras.*`/`alerts.*` —
 * so no response from this file can carry a camera name, a zone, a
 * detection or a clip.
 *
 * WHAT'S REAL HERE AND WHAT ISN'T — see this phase's Step 1 report for the
 * full reasoning; the short version:
 *   - `fleet` is a real, live query — the same boxes/organizations join
 *     admin-tenants.js's /summary already does, broken out per tenant.
 *   - `api` is real but minimal: an in-memory request-timing ring buffer
 *     (lib/request-metrics.js), not a metrics service. `observedHours` is
 *     the true age of this process, not a fabricated history — on a
 *     freshly started server that's honestly small, which is exactly the
 *     state the frontend's own `ENOUGH_HOURS` / `NotEnoughData` copy exists
 *     to describe rather than something this route needs to paper over
 *     with invented hourly buckets.
 *   - `queues` is genuinely `[]`: there is no background job queue
 *     anywhere in this stack (alerts are written synchronously by
 *     detecto-backend/server's POST /api/alerts). The frontend already has
 *     honest copy for an empty queue list ("No queues are reporting").
 *   - `cost` is genuinely zero: no billing/cost-provider integration
 *     exists to read from.
 */
adminHealthRouter.use(requireAuth, requireSuperAdmin);

/** Matches admin-tenants.js's own SILENT_AFTER exactly — one platform-wide
 *  threshold for "still talking" vs "gone quiet", not redefined per route. */
const SILENT_AFTER_MS = 10 * 60 * 1000;

function buildFleet(boxRows) {
  const byOrg = new Map();
  for (const row of boxRows) {
    const entry = byOrg.get(row.org_id) ?? {
      tenantId: row.org_id,
      tenantName: row.org_name,
      suspended: row.org_status === 'suspended',
      suspendedAt: row.suspended_at,
      lastSeenAts: [],
    };
    entry.lastSeenAts.push(row.last_seen_at);
    byOrg.set(row.org_id, entry);
  }

  const now = Date.now();
  const rows = [...byOrg.values()].map((entry) => {
    const boxCount = entry.lastSeenAts.length;

    if (entry.suspended) {
      return {
        tenantId: entry.tenantId,
        tenantName: entry.tenantName,
        boxCount,
        online: 0,
        offline: boxCount,
        neverConnected: 0,
        lastSeenAt: entry.suspendedAt ? entry.suspendedAt.toISOString() : null,
        suspended: true,
      };
    }

    let online = 0;
    let offline = 0;
    let neverConnected = 0;
    let mostRecent = null;
    for (const lastSeenAt of entry.lastSeenAts) {
      if (!lastSeenAt) {
        neverConnected += 1;
        continue;
      }
      if (!mostRecent || lastSeenAt > mostRecent) mostRecent = lastSeenAt;
      if (now - lastSeenAt.getTime() < SILENT_AFTER_MS) online += 1;
      else offline += 1;
    }

    return {
      tenantId: entry.tenantId,
      tenantName: entry.tenantName,
      boxCount,
      online,
      offline,
      neverConnected,
      lastSeenAt: mostRecent ? mostRecent.toISOString() : null,
      suspended: false,
    };
  });

  rows.sort((a, b) => a.tenantName.localeCompare(b.tenantName));

  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);

  return {
    online: sum((row) => row.online),
    // Excludes suspended rows' `offline` — those boxes are quiet on
    // purpose, not a fault. See lib/health/api.ts's FleetHealth comment.
    offline: sum((row) => (row.suspended ? 0 : row.offline)),
    neverConnected: sum((row) => row.neverConnected),
    suspended: sum((row) => (row.suspended ? row.offline : 0)),
    total: sum((row) => row.boxCount),
    rows,
  };
}

/* -------------------------------------------------------------------------- */
/* GET /api/admin/health                                                      */
/* -------------------------------------------------------------------------- */

adminHealthRouter.get('/health', async (req, res) => {
  const boxRows = await pool.query(
    `SELECT o.id AS org_id, o.name AS org_name, o.status AS org_status, o.suspended_at,
            b.last_seen_at
     FROM boxes b
     JOIN organizations o ON o.id = b.org_id`,
  );

  const hours = observedHours();
  const { latencyP50, latencyP95, errorRate } = snapshot();

  res.status(200).json({
    fleet: buildFleet(boxRows.rows),
    api: {
      hours,
      latencyP50,
      latencyP95,
      errorRate,
      // Self-reported: this process has been up for its entire observed
      // window by definition (it's answering this request), and there is
      // no persisted restart/outage log to compute a true trailing-30-day
      // figure from — building one is the metrics pipeline this phase was
      // told not to invent. Documented here rather than silently implied.
      uptime30d: 1,
      latencySeries: [],
      requestSeries: [],
    },
    queues: [],
    cost: { monthToDate: 0, lastMonth: 0, budget: 50, lines: [] },
    observedHours: hours,
    checkedAt: new Date().toISOString(),
  });
});
