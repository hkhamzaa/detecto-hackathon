import { describe, expect, it } from 'vitest'

import type { FleetRow } from '@/lib/health/api'
import {
  byStaleness,
  concernTier,
  fleetLabel,
  fleetTone,
  formatLag,
  formatRate,
  formatUptime,
  formatUsd,
  queueTone,
  silentMinutes,
  THRESHOLD,
} from '@/lib/health/status'

/**
 * What earns colour on the system health page.
 *
 * The restraint rule is the thing under test. A status page that colours a
 * quarter of itself every day is one people stop reading, and the morning it
 * matters they scroll past it — so "quiet when fine" is a behaviour worth
 * failing a build over, not a matter of taste.
 */

const NOW = Date.parse('2026-08-27T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

function row(seed: Partial<FleetRow> & { tenantId: string }): FleetRow {
  return {
    tenantId: seed.tenantId,
    tenantName: seed.tenantName ?? seed.tenantId,
    boxCount: seed.boxCount ?? 1,
    online: seed.online ?? 0,
    offline: seed.offline ?? 0,
    neverConnected: seed.neverConnected ?? 0,
    lastSeenAt: seed.lastSeenAt ?? null,
    suspended: seed.suspended ?? false,
  }
}

const HEALTHY = row({
  tenantId: 'healthy',
  boxCount: 3,
  online: 3,
  lastSeenAt: new Date(NOW - 2 * MIN).toISOString(),
})

const SILENT = row({
  tenantId: 'silent',
  boxCount: 2,
  online: 1,
  offline: 1,
  lastSeenAt: new Date(NOW - 9 * HOUR).toISOString(),
})

const STALLED = row({ tenantId: 'stalled', boxCount: 1, neverConnected: 1 })

const SUSPENDED = row({
  tenantId: 'suspended',
  boxCount: 2,
  offline: 2,
  suspended: true,
  lastSeenAt: new Date(NOW - 9 * 24 * HOUR).toISOString(),
})

describe('fleet tone', () => {
  it('stays quiet when every box is reporting', () => {
    expect(fleetTone(HEALTHY)).toBe('confirm')
  })

  it('raises Signal for a box that has gone silent', () => {
    expect(fleetTone(SILENT)).toBe('signal')
  })

  it('does not shout about a box that was never plugged in', () => {
    // An onboarding that stalled is worth surfacing, but it is not an outage.
    expect(fleetTone(STALLED)).toBe('neutral')
  })

  it('never treats a suspended account as a fault', () => {
    // Their boxes are quiet because a person decided they should be. Colouring
    // that red every day would train whoever reads this page to ignore the one
    // colour that matters.
    expect(fleetTone(SUSPENDED)).toBe('neutral')
  })
})

describe('fleet label', () => {
  it('says suspension plainly rather than dressing it as an outage', () => {
    expect(fleetLabel(SUSPENDED, NOW)).toBe('2 suspended')
  })

  it('names how many of how many are silent', () => {
    expect(fleetLabel(SILENT, NOW)).toBe('1 of 2 silent')
  })

  it('distinguishes a blip from a full outage once past the threshold', () => {
    const brief = row({
      tenantId: 'brief',
      boxCount: 1,
      offline: 1,
      lastSeenAt: new Date(NOW - 30 * MIN).toISOString(),
    })
    const long = row({
      tenantId: 'long',
      boxCount: 1,
      offline: 1,
      lastSeenAt: new Date(NOW - (THRESHOLD.boxOutageHours + 1) * HOUR).toISOString(),
    })

    expect(fleetLabel(brief, NOW)).toBe('Offline')
    expect(fleetLabel(long, NOW)).toBe('Silent')
  })

  it('reads as fine when everything is fine', () => {
    expect(fleetLabel(HEALTHY, NOW)).toBe('All 3 online')
  })
})

describe('sorting by staleness', () => {
  const sorted = [HEALTHY, SUSPENDED, STALLED, SILENT].sort(byStaleness(NOW))

  it('puts the real outage first', () => {
    expect(sorted[0].tenantId).toBe('silent')
  })

  it('puts stalled onboarding above healthy accounts', () => {
    expect(sorted[1].tenantId).toBe('stalled')
  })

  it('sorts suspended accounts to the bottom, below the healthy ones', () => {
    expect(sorted[sorted.length - 1].tenantId).toBe('suspended')
  })

  it('ranks two outages by how long each has been quiet', () => {
    const older = row({
      tenantId: 'older',
      offline: 1,
      lastSeenAt: new Date(NOW - 20 * HOUR).toISOString(),
    })
    expect([SILENT, older].sort(byStaleness(NOW))[0].tenantId).toBe('older')
  })

  it('tiers suspension below everything, whatever its timestamp says', () => {
    expect(concernTier(SUSPENDED)).toBeGreaterThan(concernTier(HEALTHY))
  })
})

describe('silentMinutes', () => {
  it('measures from the last check-in', () => {
    expect(silentMinutes(SILENT, NOW)).toBeCloseTo(9 * 60)
  })

  it('is null for a box that has never checked in', () => {
    // Null, not zero and not Infinity — there is no elapsed time to report.
    expect(silentMinutes(STALLED, NOW)).toBeNull()
  })
})

describe('queue tone', () => {
  it('stays quiet under the target', () => {
    expect(queueTone({ lagSeconds: THRESHOLD.queueLagSeconds - 1 })).toBe('confirm')
  })

  it('raises Signal at the target, because lag is time added to every alert', () => {
    expect(queueTone({ lagSeconds: THRESHOLD.queueLagSeconds })).toBe('signal')
  })
})

describe('formatting', () => {
  it('keeps two decimals on a rate small enough to need them', () => {
    expect(formatRate(0.0018)).toBe('0.18%')
  })

  it('keeps uptime in nines', () => {
    expect(formatUptime(0.99977)).toBe('99.977%')
  })

  it('shows money to the cent', () => {
    expect(formatUsd(3.8)).toBe('$3.80')
    expect(formatUsd(0)).toBe('$0.00')
  })

  it('says lag the way an engineer would', () => {
    expect(formatLag(42)).toBe('42s')
    expect(formatLag(120)).toBe('2m')
    expect(formatLag(135)).toBe('2m 15s')
  })
})
