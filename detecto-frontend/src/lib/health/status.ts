import type { ApiHealth, CostTracker, FleetRow, QueueStat } from '@/lib/health/api'

/**
 * What counts as a problem, and what is simply a number.
 *
 * Every threshold on the health page lives here, for the reason `ENOUGH` lives
 * in `analytics/stats.ts`: a limit scattered across the components that draw it
 * is a limit nobody can review. These are the lines at which somebody should do
 * something, and they are deliberately generous. A page that colours a quarter
 * of itself amber every day is a page people stop reading, and the one morning
 * it matters they will scroll past it.
 *
 * There is no warning tier. The design system has Signal, Confirm and neutral,
 * and a state is either worth a person's attention or it is not — inventing an
 * amber middle would mean deciding, every render, how worried to look.
 */
export const THRESHOLD = {
  /**
   * A box checks in on a short cycle. Quiet for longer than this is not the gap
   * between check-ins, it is a box that has stopped talking.
   */
  boxSilentMinutes: 15,
  /**
   * Past this, a silent box has stopped being a dropped connection and become
   * an outage — cameras watched by nothing, for most of a working day.
   */
  boxOutageHours: 6,
  /** Above this and the interface is slow enough for people to notice. */
  latencyP95Ms: 800,
  /** One request in a hundred failing is the point at which it is not noise. */
  errorRate: 0.01,
  /** Three nines. Below it, the month has had a real incident in it. */
  uptime: 0.999,
  /**
   * Queue lag is time added to every alert behind it. A minute is the point at
   * which a detection stops being prompt.
   */
  queueLagSeconds: 60,
} as const

/**
 * Hours of collected metrics before an hourly chart has a shape worth drawing.
 * Half a day: enough to have both a busy stretch and a quiet one in it.
 */
export const ENOUGH_HOURS = 12

/** The three tones the page uses, in the design system's own words. */
export type Tone = 'confirm' | 'signal' | 'neutral'

const MINUTE_MS = 60_000

/* -------------------------------------------------------------------------- */
/* Fleet                                                                      */
/* -------------------------------------------------------------------------- */

/** Minutes since a tenant's most recent check-in. Null when there never was one. */
export function silentMinutes(row: FleetRow, now: number): number | null {
  if (!row.lastSeenAt) return null
  const seen = Date.parse(row.lastSeenAt)
  if (Number.isNaN(seen)) return null
  return Math.max(0, (now - seen) / MINUTE_MS)
}

/**
 * How much a row deserves someone's attention, lowest first.
 *
 * Suspended accounts sort to the bottom and never carry Signal. Their boxes are
 * quiet because a person decided they should be — surfacing that as an outage
 * every day would train whoever reads this page to ignore the colour that
 * matters, which is the one failure mode a status page cannot afford.
 */
export function concernTier(row: FleetRow): number {
  if (row.suspended) return 3
  if (row.offline > 0) return 0
  if (row.neverConnected > 0) return 1
  return 2
}

/** Most concerning first: longest silence, then stalled onboarding, then fine. */
export function byStaleness(now: number) {
  return (a: FleetRow, b: FleetRow) => {
    const tiers = concernTier(a) - concernTier(b)
    if (tiers !== 0) return tiers

    const quiet = (row: FleetRow) => silentMinutes(row, now) ?? Number.POSITIVE_INFINITY
    const gap = quiet(b) - quiet(a)
    if (Number.isFinite(gap) && gap !== 0) return gap

    return a.tenantName.localeCompare(b.tenantName)
  }
}

export function byName(a: FleetRow, b: FleetRow) {
  return a.tenantName.localeCompare(b.tenantName)
}

export function byBoxCount(a: FleetRow, b: FleetRow) {
  return b.boxCount - a.boxCount || a.tenantName.localeCompare(b.tenantName)
}

export function fleetTone(row: FleetRow): Tone {
  if (row.suspended) return 'neutral'
  if (row.offline > 0) return 'signal'
  if (row.neverConnected > 0) return 'neutral'
  return 'confirm'
}

/** The state in a word. Suspension is said plainly rather than dressed as a fault. */
export function fleetLabel(row: FleetRow, now: number): string {
  if (row.suspended) {
    return row.boxCount === 1 ? 'Suspended' : `${row.boxCount} suspended`
  }
  if (row.offline > 0) {
    const quiet = silentMinutes(row, now)
    const outage = quiet !== null && quiet >= THRESHOLD.boxOutageHours * 60
    if (row.offline === row.boxCount) return outage ? 'Silent' : 'Offline'
    return `${row.offline} of ${row.boxCount} silent`
  }
  if (row.neverConnected > 0) {
    return row.neverConnected === row.boxCount
      ? 'Never connected'
      : `${row.neverConnected} never connected`
  }
  return row.boxCount === 1 ? 'Online' : `All ${row.boxCount} online`
}

/* -------------------------------------------------------------------------- */
/* API, queues, cost                                                          */
/* -------------------------------------------------------------------------- */

export function latencyTone(api: Pick<ApiHealth, 'latencyP95'>): Tone {
  return api.latencyP95 >= THRESHOLD.latencyP95Ms ? 'signal' : 'confirm'
}

export function errorTone(api: Pick<ApiHealth, 'errorRate'>): Tone {
  return api.errorRate >= THRESHOLD.errorRate ? 'signal' : 'confirm'
}

export function uptimeTone(api: Pick<ApiHealth, 'uptime30d'>): Tone {
  return api.uptime30d < THRESHOLD.uptime ? 'signal' : 'confirm'
}

export function queueTone(queue: Pick<QueueStat, 'lagSeconds'>): Tone {
  return queue.lagSeconds >= THRESHOLD.queueLagSeconds ? 'signal' : 'confirm'
}

export function costTone(cost: Pick<CostTracker, 'monthToDate' | 'budget'>): Tone {
  return cost.monthToDate >= cost.budget ? 'signal' : 'confirm'
}

/** True when anything on the page needs a person. Drives the page's own summary. */
export function needsAttention(health: {
  fleet: { offline: number }
  api: ApiHealth
  queues: QueueStat[]
  cost: CostTracker
}): boolean {
  return (
    health.fleet.offline > 0 ||
    latencyTone(health.api) === 'signal' ||
    errorTone(health.api) === 'signal' ||
    uptimeTone(health.api) === 'signal' ||
    health.queues.some((queue) => queueTone(queue) === 'signal') ||
    costTone(health.cost) === 'signal'
  )
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** `0.0018` → `0.18%`. Two decimals, because a rate this small needs them. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

/** `0.99977` → `99.977%`. Uptime is read in nines, so it keeps three decimals. */
export function formatUptime(uptime: number): string {
  return `${(uptime * 100).toFixed(3)}%`
}

/** Money with cents. `formatPrice` in `plans.ts` is for whole-dollar plan prices. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** Seconds, said the way an engineer would say them. */
export function formatLag(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}
