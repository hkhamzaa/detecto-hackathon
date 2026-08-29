import { USE_MOCKS } from '@/lib/config/mocks'
import {
  listTenants,
  MOCK_BOXES_NEVER_CONNECTED,
  MOCK_BOXES_SILENT,
  type Tenant,
} from '@/lib/tenants/api'
import { useAuthStore } from '@/store/auth-store'

/**
 * Whether the platform itself is working.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME BOUNDARY THE TENANT REGISTRY HOLDS
 *
 * This page is about Detecto's infrastructure, not about what anyone's cameras
 * saw. The fleet section names organisations and counts their boxes, because a
 * box being silent is a platform fault and somebody has to know whose it is.
 * It carries no camera, no zone, no clip and no detection — and, as in
 * `lib/tenants/api.ts`, that is a property of the types rather than a habit of
 * the components. There is no field here that could hold one.
 *
 * Sections 2 to 4 are infrastructure Detecto owns outright — request latency,
 * queue lag, the hosting bill — so no boundary question arises for them at all.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

const MODE = import.meta.env.VITE_HEALTH_MOCK as string | undefined

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** One tenant's Edge Agent fleet. Counts and a timestamp — nothing else. */
export type FleetRow = {
  tenantId: string
  tenantName: string
  boxCount: number
  online: number
  offline: number
  /** Shipped and registered, but has never once checked in. */
  neverConnected: number
  /** The most recent check-in across this tenant's boxes. Null if none ever did. */
  lastSeenAt: string | null
  /**
   * A suspended account's boxes are not syncing *by design* — that is what
   * suspension does. Carried here so the page can tell an outage apart from a
   * decision somebody made on purpose.
   */
  suspended: boolean
}

export type FleetHealth = {
  online: number
  /** Genuinely silent. Excludes boxes quiet because their account is suspended. */
  offline: number
  neverConnected: number
  /** Offline only because the account is suspended. Not a fault. */
  suspended: number
  total: number
  rows: FleetRow[]
}

export type Point = { at: string; value: number }

export type ApiHealth = {
  /** How many hours the series below covers. */
  hours: number
  latencyP50: number
  latencyP95: number
  /** 0–1, over the window. */
  errorRate: number
  /** 0–1, over the last 30 days. */
  uptime30d: number
  /** Hourly p95, oldest first. */
  latencySeries: Point[]
  /** Hourly request counts, oldest first. */
  requestSeries: { at: string; ok: number; errors: number }[]
}

export type QueueStat = {
  id: string
  name: string
  /** What the queue actually carries, in a line. */
  description: string
  /** Seconds between a job being enqueued and a worker picking it up, right now. */
  lagSeconds: number
  /** Jobs waiting. */
  depth: number
  /** Hourly lag in seconds, oldest first. */
  series: Point[]
}

export type CostLine = {
  id: string
  name: string
  provider: string
  /** Month to date, USD. */
  amount: number
  /** What is still covered by a free allowance, in the provider's own terms. */
  note: string
}

export type CostTracker = {
  monthToDate: number
  /** Last full month, for a direction of travel. */
  lastMonth: number
  /** The line above which somebody should be told. Not a hard cap. */
  budget: number
  lines: CostLine[]
}

export type PlatformHealth = {
  fleet: FleetHealth
  api: ApiHealth
  queues: QueueStat[]
  cost: CostTracker
  /**
   * How long the platform has been collecting metrics. Charts that need a shape
   * check this before drawing one — a platform three hours old has counts, not
   * trends.
   */
  observedHours: number
  checkedAt: string
}

export type HealthResult =
  | { ok: true; health: PlatformHealth }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getPlatformHealth(): Promise<HealthResult> {
  return USE_MOCKS ? mockHealth() : realHealth()
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toPoint(value: unknown): Point | null {
  const p = obj(value)
  const at = str(p.at)
  return at ? { at, value: num(p.value) } : null
}

function points(value: unknown): Point[] {
  return array(value)
    .map(toPoint)
    .filter((point): point is Point => point !== null)
}

function toFleetRow(value: unknown): FleetRow | null {
  const r = obj(value)
  const tenantId = str(r.tenantId)
  const tenantName = str(r.tenantName)
  if (!tenantId || !tenantName) return null

  return {
    tenantId,
    tenantName,
    boxCount: num(r.boxCount),
    online: num(r.online),
    offline: num(r.offline),
    neverConnected: num(r.neverConnected),
    lastSeenAt: str(r.lastSeenAt),
    suspended: r.suspended === true,
  }
}

function toQueue(value: unknown): QueueStat | null {
  const q = obj(value)
  const id = str(q.id)
  const name = str(q.name)
  if (!id || !name) return null

  return {
    id,
    name,
    description: str(q.description) ?? '',
    lagSeconds: num(q.lagSeconds),
    depth: num(q.depth),
    series: points(q.series),
  }
}

function toCostLine(value: unknown): CostLine | null {
  const c = obj(value)
  const id = str(c.id)
  const name = str(c.name)
  if (!id || !name) return null

  return {
    id,
    name,
    provider: str(c.provider) ?? '',
    amount: num(c.amount),
    note: str(c.note) ?? '',
  }
}

async function realHealth(): Promise<HealthResult> {
  let response: Response
  try {
    response = await fetch('/api/admin/health', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null) {
    return { ok: false, code: 'unavailable' }
  }

  const payload = obj(data)
  const fleet = obj(payload.fleet)
  const api = obj(payload.api)
  const cost = obj(payload.cost)

  return {
    ok: true,
    health: {
      fleet: {
        online: num(fleet.online),
        offline: num(fleet.offline),
        neverConnected: num(fleet.neverConnected),
        suspended: num(fleet.suspended),
        total: num(fleet.total),
        rows: array(fleet.rows)
          .map(toFleetRow)
          .filter((row): row is FleetRow => row !== null),
      },
      api: {
        hours: num(api.hours),
        latencyP50: num(api.latencyP50),
        latencyP95: num(api.latencyP95),
        errorRate: num(api.errorRate),
        uptime30d: num(api.uptime30d),
        latencySeries: points(api.latencySeries),
        requestSeries: array(api.requestSeries).flatMap((entry) => {
          const e = obj(entry)
          const at = str(e.at)
          return at ? [{ at, ok: num(e.ok), errors: num(e.errors) }] : []
        }),
      },
      queues: array(payload.queues)
        .map(toQueue)
        .filter((queue): queue is QueueStat => queue !== null),
      cost: {
        monthToDate: num(cost.monthToDate),
        lastMonth: num(cost.lastMonth),
        budget: num(cost.budget),
        lines: array(cost.lines)
          .map(toCostLine)
          .filter((line): line is CostLine => line !== null),
      },
      observedHours: num(payload.observedHours),
      checkedAt: str(payload.checkedAt) ?? new Date().toISOString(),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/admin/health is live                           */
/* -------------------------------------------------------------------------- */

/**
 * `VITE_HEALTH_MOCK` picks which platform you are looking at, so every state on
 * the page is reachable without a backend — the same trick the analytics window
 * and the pairing codes play:
 *
 *   (unset)   a healthy platform with two genuinely silent boxes
 *   degraded  latency, error rate and queue lag all over threshold
 *   new       a platform three hours old: real counts, no trends yet
 *   false     no mock at all; talk to the real endpoint
 *
 * `new` is the one worth opening. A chart drawn through three points would
 * claim a trend nobody has the data for.
 */
const MOCK_DELAY = 500
const HOUR_MS = 60 * 60 * 1000
const SERIES_HOURS = 24
const QUEUE_HOURS = 12

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fixed seed. A demo you cannot show twice is not a demo. Mulberry32. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function observedHours() {
  return MODE === 'new' ? 3 : 24 * 62
}

/**
 * The fleet, derived from the tenant registry rather than from a second list of
 * cameras.
 *
 * A real `/api/admin/health` reads the box registry directly. The mock builds
 * the same shape out of `listTenants()` so the two pages cannot disagree about
 * how many boxes a customer has — and so that adding a tenant to the seed data
 * shows up here without a second place to edit. Box *states* are the one thing
 * the tenant record does not carry, so they are assigned here, deterministically.
 */
async function buildFleet(now: number): Promise<FleetHealth> {
  const result = await listTenants()
  const tenants: Tenant[] = result.ok ? result.tenants : []
  const random = seeded(0x5eed_f1ee)

  // The genuinely silent boxes are handed out to the largest active fleets
  // first, which is where a real outage is most likely to be noticed.
  const candidates = tenants
    .filter((tenant) => tenant.status !== 'suspended' && tenant.boxCount > 0)
    .sort((a, b) => b.boxCount - a.boxCount)

  const silentFor = new Map<string, number>()
  let remaining = MOCK_BOXES_SILENT
  for (const tenant of candidates) {
    if (remaining === 0) break
    silentFor.set(tenant.id, 1)
    remaining -= 1
  }

  // Boxes shipped and never plugged in. Not an outage — an onboarding that
  // stalled — so they are counted and toned separately. Handed to the smallest
  // fleets, which is where a stalled setup actually happens, and never to an
  // account that already has a silent box: one fault per tenant reads clearer.
  const neverFor = new Set<string>()
  let stalled = MOCK_BOXES_NEVER_CONNECTED
  for (const tenant of [...candidates].reverse()) {
    if (stalled === 0) break
    if (silentFor.has(tenant.id)) continue
    neverFor.add(tenant.id)
    stalled -= 1
  }

  const rows: FleetRow[] = tenants
    .filter((tenant) => tenant.boxCount > 0)
    .map((tenant) => {
      const suspended = tenant.status === 'suspended'
      const never = neverFor.has(tenant.id) ? 1 : 0
      const offline = suspended ? tenant.boxCount : (silentFor.get(tenant.id) ?? 0)
      const online = Math.max(0, tenant.boxCount - offline - never)

      // Minutes since the most recent check-in. A suspended account's last
      // contact is the moment it was cut off, which is the honest reading.
      const lastSeenAt = suspended
        ? tenant.suspendedAt
        : online > 0
          ? new Date(now - Math.floor(random() * 9 * 60_000)).toISOString()
          : offline > 0
            ? new Date(now - (3 + Math.floor(random() * 40)) * HOUR_MS).toISOString()
            : null

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        boxCount: tenant.boxCount,
        online,
        offline,
        neverConnected: never,
        lastSeenAt,
        suspended,
      }
    })

  const sum = (pick: (row: FleetRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)

  return {
    online: sum((row) => row.online),
    offline: sum((row) => (row.suspended ? 0 : row.offline)),
    neverConnected: sum((row) => row.neverConnected),
    suspended: sum((row) => (row.suspended ? row.offline : 0)),
    total: sum((row) => row.boxCount),
    rows,
  }
}

/** Hourly stamps, oldest first, ending at the current hour. */
function hourStamps(now: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(now - (count - 1 - index) * HOUR_MS).toISOString(),
  )
}

function buildApi(now: number): ApiHealth {
  const degraded = MODE === 'degraded'
  const hours = Math.min(SERIES_HOURS, observedHours())
  const random = seeded(0xa9_11_ce)

  const stamps = hourStamps(now, hours)

  const latencySeries = stamps.map((at, index) => {
    // A gentle daytime rise, so the shape is a working day rather than noise.
    const hour = new Date(at).getHours()
    const daytime = hour >= 8 && hour <= 20 ? 1.25 : 0.85
    const base = degraded ? 900 : 210
    const jitter = 0.85 + random() * 0.3
    // In the degraded mock one hour is clearly the worst, so the chart has
    // something to point at rather than being uniformly bad.
    const spike = degraded && index === hours - 3 ? 1.7 : 1
    return { at, value: Math.round(base * daytime * jitter * spike) }
  })

  const requestSeries = stamps.map((at) => {
    const hour = new Date(at).getHours()
    const daytime = hour >= 8 && hour <= 20 ? 1.4 : 0.6
    const ok = Math.round(2600 * daytime * (0.9 + random() * 0.2))
    const rate = degraded ? 0.035 : 0.0018
    return { at, ok, errors: Math.max(0, Math.round(ok * rate * (0.7 + random()))) }
  })

  const totals = requestSeries.reduce(
    (acc, point) => ({ ok: acc.ok + point.ok, errors: acc.errors + point.errors }),
    { ok: 0, errors: 0 },
  )
  const requests = totals.ok + totals.errors

  const sorted = [...latencySeries].map((point) => point.value).sort((a, b) => a - b)
  const at = (fraction: number) =>
    sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]

  return {
    hours,
    latencyP50: at(0.5),
    latencyP95: at(0.95),
    errorRate: requests === 0 ? 0 : totals.errors / requests,
    uptime30d: degraded ? 0.9962 : 0.99977,
    latencySeries,
    requestSeries,
  }
}

/**
 * The two queues the ingest path actually runs on: frames arriving from the
 * boxes, and the detection jobs those frames turn into. Named as the backend
 * names them, because a platform engineer reading this page is going to go and
 * look at exactly those two things.
 */
function buildQueues(now: number): QueueStat[] {
  const degraded = MODE === 'degraded'
  const hours = Math.min(QUEUE_HOURS, observedHours())
  const stamps = hourStamps(now, hours)

  const shape = (base: number, seed: number) => {
    const random = seeded(seed)
    return stamps.map((at, index) => {
      const rising = degraded ? 1 + (index / Math.max(1, hours - 1)) * 3.5 : 1
      return { at, value: Math.round(base * rising * (0.7 + random() * 0.7)) }
    })
  }

  const ingest = shape(degraded ? 45 : 3, 0x1_9e57)
  const anomaly = shape(degraded ? 90 : 9, 0x2_a0a1)

  return [
    {
      id: 'ingest',
      name: 'Frame ingest',
      description:
        'Frames arriving from Edge Agents, waiting to be handed to a model worker.',
      lagSeconds: ingest[ingest.length - 1]?.value ?? 0,
      depth: degraded ? 4_180 : 34,
      series: ingest,
    },
    {
      id: 'anomaly',
      name: 'Anomaly detection',
      description:
        'Detection jobs waiting on a worker. Lag here is time added to every alert.',
      lagSeconds: anomaly[anomaly.length - 1]?.value ?? 0,
      depth: degraded ? 1_920 : 12,
      series: anomaly,
    },
  ]
}

/**
 * The bill, month to date.
 *
 * Deliberately small numbers, because the architecture was chosen to produce
 * small numbers: compute on Oracle's always-free tier, clips on R2 where egress
 * is not billed. This section exists so that promise is checked rather than
 * assumed — a line that starts creeping is the point of the whole panel.
 */
function buildCost(): CostTracker {
  const degraded = MODE === 'degraded'

  const lines: CostLine[] = [
    {
      id: 'compute',
      name: 'Compute',
      provider: 'Oracle Cloud',
      amount: 0,
      note: 'Two Ampere ARM instances, inside the always-free allowance.',
    },
    {
      id: 'clips',
      name: 'Clip storage',
      provider: 'Cloudflare R2',
      amount: degraded ? 14.6 : 3.82,
      note: 'Stored volume only — R2 bills no egress, which is why it was picked.',
    },
    {
      id: 'bandwidth',
      name: 'Bandwidth',
      provider: 'Cloudflare',
      amount: 0,
      note: 'Still inside the free allowance.',
    },
    {
      id: 'database',
      name: 'Database and backups',
      provider: 'Oracle Cloud',
      amount: 0,
      note: 'Block volume and automatic backups, inside the always-free allowance.',
    },
    {
      id: 'messaging',
      name: 'Email and SMS',
      provider: 'Postmark',
      amount: 2.41,
      note: 'Per-message, and the only line that grows directly with alert volume.',
    },
  ]

  return {
    monthToDate: lines.reduce((total, line) => total + line.amount, 0),
    lastMonth: degraded ? 9.4 : 5.87,
    // Not a hard cap. It is the number at which somebody should be told the
    // near-zero-cost promise has stopped being true.
    budget: 50,
    lines,
  }
}

async function mockHealth(): Promise<HealthResult> {
  await wait(MOCK_DELAY)
  const now = Date.now()

  return {
    ok: true,
    health: {
      fleet: await buildFleet(now),
      api: buildApi(now),
      queues: buildQueues(now),
      cost: buildCost(),
      observedHours: observedHours(),
      checkedAt: new Date(now - 90_000).toISOString(),
    },
  }
}
