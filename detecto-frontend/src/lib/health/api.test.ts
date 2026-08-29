import { afterEach, describe, expect, it, vi } from 'vitest'

import { needsAttention, THRESHOLD } from '@/lib/health/status'

/**
 * The platform health payload, across all three mock modes.
 *
 * The mode is read once at module scope — the same as every other mock in the
 * project — so each mode needs a fresh module registry rather than a flag flip.
 * `vi.resetModules()` plus a dynamic import is what makes that possible without
 * exporting a seam that only tests would use.
 */

async function health(mode?: 'degraded' | 'new') {
  vi.resetModules()
  if (mode) vi.stubEnv('VITE_HEALTH_MOCK', mode)
  else vi.stubEnv('VITE_HEALTH_MOCK', '')

  const api = await import('@/lib/health/api')
  const result = await api.getPlatformHealth()
  if (!result.ok) throw new Error(result.code)
  return result.health
}

async function registry() {
  const tenants = await import('@/lib/tenants/api')
  const result = await tenants.listTenants()
  if (!result.ok) throw new Error(result.code)
  return result
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the fleet, derived from the tenant registry', () => {
  it('accounts for every registered box exactly once', async () => {
    const { fleet } = await health()
    expect(fleet.online + fleet.offline + fleet.neverConnected + fleet.suspended).toBe(
      fleet.total,
    )
  })

  it('takes its box counts from the tenant records rather than a second list', async () => {
    // The whole point of deriving this: adding a tenant to the seed data shows
    // up here without a second place to edit, and the two pages cannot disagree
    // about how many boxes a customer has.
    const { fleet } = await health()
    const { tenants } = await registry()
    const withBoxes = tenants.filter((t) => t.boxCount > 0)

    expect(fleet.rows).toHaveLength(withBoxes.length)
    expect(fleet.rows.reduce((sum, r) => sum + r.boxCount, 0)).toBe(
      withBoxes.reduce((sum, t) => sum + t.boxCount, 0),
    )
  })

  it('agrees with the overview rollup on what is talking and what is not', async () => {
    const { fleet } = await health()
    const tenants = await import('@/lib/tenants/api')
    const summary = await tenants.getPlatformSummary()
    if (!summary.ok) throw new Error(summary.code)

    // Two views of one fleet. A build where these drift is a build where the
    // only number that means "go and do something" is wrong on one of them.
    expect(fleet.offline).toBe(summary.summary.health.boxesSilent)
    expect(fleet.online).toBe(summary.summary.health.boxesReporting)
  })

  it('counts boxes quiet because of suspension separately from faults', async () => {
    const { fleet } = await health()
    expect(fleet.suspended).toBeGreaterThan(0)
    expect(fleet.rows.filter((r) => r.suspended).every((r) => r.offline > 0)).toBe(true)
  })

  it('keeps a fleet row to counts and a timestamp', async () => {
    const { fleet } = await health()
    expect(Object.keys(fleet.rows[0]).sort()).toEqual([
      'boxCount',
      'lastSeenAt',
      'neverConnected',
      'offline',
      'online',
      'suspended',
      'tenantId',
      'tenantName',
    ])
  })

  it('gives a never-connected box no last-seen time at all', async () => {
    const { fleet } = await health()
    const stalled = fleet.rows.find((r) => r.neverConnected > 0 && r.online === 0)
    expect(stalled?.lastSeenAt).toBeNull()
  })
})

describe('a healthy platform', () => {
  it('sits inside every threshold', async () => {
    const platform = await health()

    expect(platform.api.latencyP95).toBeLessThan(THRESHOLD.latencyP95Ms)
    expect(platform.api.errorRate).toBeLessThan(THRESHOLD.errorRate)
    expect(platform.api.uptime30d).toBeGreaterThanOrEqual(THRESHOLD.uptime)
    expect(
      platform.queues.every((q) => q.lagSeconds < THRESHOLD.queueLagSeconds),
    ).toBe(true)
  })

  it('reports both queues the ingest path runs on', async () => {
    const platform = await health()
    expect(platform.queues.map((q) => q.id)).toEqual(['ingest', 'anomaly'])
  })

  it('carries a full day of API series and half a day of queue series', async () => {
    const platform = await health()
    expect(platform.api.latencySeries).toHaveLength(24)
    expect(platform.api.requestSeries).toHaveLength(24)
    expect(platform.queues[0].series).toHaveLength(12)
  })

  it('keeps the cost near zero, as the architecture promised', async () => {
    const platform = await health()
    const { cost } = platform

    expect(cost.monthToDate).toBeCloseTo(
      cost.lines.reduce((sum, line) => sum + line.amount, 0),
      2,
    )
    expect(cost.monthToDate).toBeLessThan(cost.budget)
    // Most of the stack should still be inside a free allowance.
    expect(cost.lines.filter((line) => line.amount === 0).length).toBeGreaterThanOrEqual(3)
  })

  it('still needs attention, because two boxes have gone silent', async () => {
    const platform = await health()
    expect(needsAttention(platform)).toBe(true)
    // And goes quiet entirely once they come back.
    expect(needsAttention({ ...platform, fleet: { offline: 0 } })).toBe(false)
  })
})

describe('a degraded platform', () => {
  it('breaches latency, error rate and uptime together', async () => {
    const platform = await health('degraded')

    expect(platform.api.latencyP95).toBeGreaterThanOrEqual(THRESHOLD.latencyP95Ms)
    expect(platform.api.errorRate).toBeGreaterThanOrEqual(THRESHOLD.errorRate)
    expect(platform.api.uptime30d).toBeLessThan(THRESHOLD.uptime)
  })

  it('backs both queues up past the target', async () => {
    const platform = await health('degraded')
    expect(
      platform.queues.every((q) => q.lagSeconds >= THRESHOLD.queueLagSeconds),
    ).toBe(true)
  })

  it('leaves the bill under budget, so the cost panel stays quiet', async () => {
    // Restraint check: a bad day for the servers is not a reason to colour the
    // cost panel too.
    const platform = await health('degraded')
    expect(platform.cost.monthToDate).toBeLessThan(platform.cost.budget)
  })
})

describe('a brand new platform', () => {
  it('reports how little it has observed', async () => {
    expect((await health('new')).observedHours).toBe(3)
  })

  it('truncates the series to what actually exists', async () => {
    // Not padded with zeros, which would draw a cliff that never happened.
    const platform = await health('new')
    expect(platform.api.latencySeries).toHaveLength(3)
    expect(platform.queues[0].series).toHaveLength(3)
  })

  it('still reports real current figures', async () => {
    const platform = await health('new')
    expect(platform.api.latencyP95).toBeGreaterThan(0)
    expect(platform.queues[0].lagSeconds).toBeGreaterThanOrEqual(0)
  })
})
