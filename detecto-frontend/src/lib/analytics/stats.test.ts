import { describe, expect, it } from 'vitest'

import type { Alert } from '@/lib/alerts/api'
import {
  byHour,
  byZone,
  ENOUGH,
  medianDecisionMinutes,
  moduleAccuracy,
  peakWindow,
  percentile,
  responseSpread,
  weekOnWeek,
} from '@/lib/analytics/stats'

/**
 * The arithmetic behind the org analytics page.
 *
 * These are the numbers a customer is invited to trust — a false-positive rate
 * they might quote to an auditor, a response time they might be held to — so
 * they are checked against fixtures with known answers rather than against
 * whatever the mock happens to generate.
 */

const NOW = Date.parse('2026-08-27T12:00:00Z')
const MIN = 60_000

function alert(
  seed: Partial<Alert> & { id: string; minutesAgo: number; decidedAfter?: number },
): Alert {
  const detectedAt = new Date(NOW - seed.minutesAgo * MIN)
  const waiting = seed.status === 'unconfirmed'

  return {
    id: seed.id,
    cameraId: seed.cameraId ?? 'cam_1',
    cameraName: seed.cameraName ?? 'Main entrance',
    zone: seed.zone ?? 'Front of house',
    kind: seed.kind ?? 'weapon',
    subtype: seed.subtype ?? null,
    confidence: seed.confidence ?? 0.8,
    detectedAt: detectedAt.toISOString(),
    model: 'wv-detect 3.2',
    status: seed.status ?? 'confirmed',
    decidedBy: waiting ? null : 'A. Okafor',
    decidedAt: waiting
      ? null
      : new Date(detectedAt.getTime() + (seed.decidedAfter ?? 5) * MIN).toISOString(),
  }
}

/** Nine dealt with in three minutes, one left for ten hours. */
const SKEWED = [
  ...Array.from({ length: 9 }, (_, i) =>
    alert({ id: `f${i}`, minutesAgo: 500 + i, decidedAfter: 3 }),
  ),
  alert({ id: 'slow', minutesAgo: 900, decidedAfter: 600 }),
]

describe('weekOnWeek', () => {
  const volume = [
    alert({ id: 'a1', minutesAgo: 60 }),
    alert({ id: 'a2', minutesAgo: 60 * 24 * 3 }),
    alert({ id: 'a3', minutesAgo: 60 * 24 * 8 }),
    alert({ id: 'a4', minutesAgo: 60 * 24 * 10 }),
    alert({ id: 'a5', minutesAgo: 60 * 24 * 13 }),
    alert({ id: 'a6', minutesAgo: 60 * 24 * 30 }),
  ]

  it('splits the last two weeks and ignores anything older', () => {
    const week = weekOnWeek(volume, NOW)
    expect([week.thisWeek, week.lastWeek]).toEqual([2, 3])
  })

  it('reports change as a proportion', () => {
    expect(weekOnWeek(volume, NOW).change).toBeCloseTo((2 - 3) / 3)
  })

  it('refuses a percentage change from a week with nothing in it', () => {
    // There is no percentage increase from zero, and printing one would be
    // inventing a denominator.
    expect(weekOnWeek([alert({ id: 'x', minutesAgo: 10 })], NOW).change).toBeNull()
  })
})

describe('time to a decision', () => {
  it('uses the median, so one overnight alert cannot flatter the figure', () => {
    const mean =
      SKEWED.reduce(
        (sum, a) => sum + (Date.parse(a.decidedAt!) - Date.parse(a.detectedAt)) / MIN,
        0,
      ) / SKEWED.length

    expect(medianDecisionMinutes(SKEWED)).toBe(3)
    // The whole reason the median is used: the mean describes nothing that
    // happened to anybody.
    expect(mean).toBeGreaterThan(60)
  })

  it('returns null when nothing has been decided', () => {
    expect(
      medianDecisionMinutes([alert({ id: 'w', minutesAgo: 10, status: 'unconfirmed' })]),
    ).toBeNull()
  })
})

describe('percentile', () => {
  it('is nearest-rank: nine of ten really did come inside three minutes', () => {
    const minutes = SKEWED.map(
      (a) => (Date.parse(a.decidedAt!) - Date.parse(a.detectedAt)) / MIN,
    )
    expect(percentile(minutes, 0.9)).toBe(3)
  })

  it('reaches into the tail once the tail is more than a tenth of the set', () => {
    expect(percentile([...Array(16).fill(3), 400, 500, 800, 900], 0.9)).toBe(500)
  })
})

describe('responseSpread', () => {
  const spread = responseSpread(
    [
      ...SKEWED,
      alert({ id: 'w1', minutesAgo: 200, status: 'unconfirmed' }),
      alert({ id: 'w2', minutesAgo: 45, status: 'unconfirmed' }),
    ],
    NOW,
  )

  it('counts only decided alerts', () => {
    expect(spread.decided).toBe(10)
    expect(spread.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(10)
  })

  it('flags the one that sat effectively unattended', () => {
    expect(spread.slow).toBe(1)
  })

  it('keeps still-waiting alerts out of every response figure', () => {
    // An alert waiting six hours has not "taken six hours" — it has taken at
    // least six and counting. Averaging it in would understate it.
    expect(spread.waiting).toBe(2)
    expect(spread.longestWaiting).toBe(200)
  })

  it('withholds the shape below the threshold and shows it above', () => {
    expect(spread.isMeaningful).toBe(true)
    expect(responseSpread(SKEWED.slice(0, 9), NOW).isMeaningful).toBe(false)
    expect(ENOUGH.responseSpread).toBe(10)
  })
})

describe('moduleAccuracy', () => {
  const alerts = [
    ...Array.from({ length: 20 }, (_, i) =>
      alert({
        id: `wc${i}`,
        kind: 'weapon',
        status: 'confirmed',
        confidence: 0.9,
        minutesAgo: 60 * 24 * (i % 21),
      }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      alert({
        id: `wd${i}`,
        kind: 'weapon',
        status: 'dismissed',
        confidence: 0.6,
        minutesAgo: 60 * 24 * (i % 21),
      }),
    ),
    alert({ id: 'ww', kind: 'weapon', status: 'unconfirmed', minutesAgo: 30 }),
    ...Array.from({ length: 4 }, (_, i) =>
      alert({ id: `v${i}`, kind: 'violence', minutesAgo: 60 * 24 * i }),
    ),
  ]

  const weapon = moduleAccuracy(alerts, 'weapon', 56, NOW)

  it('counts only its own module', () => {
    expect(weapon.raised).toBe(26)
    expect(weapon.confirmed).toBe(20)
    expect(weapon.falsePositive).toBe(5)
  })

  it('works the rate over decided alerts, never over raised', () => {
    // An alert still awaiting a person is not evidence either way, and folding
    // it into the denominator would quietly improve the rate.
    expect(weapon.waiting).toBe(1)
    expect(weapon.falsePositiveRate).toBeCloseTo(5 / 25)
  })

  it('splits confidence by what a person decided', () => {
    expect(weapon.confidenceConfirmed).toBe(0.9)
    expect(weapon.confidenceDismissed).toBe(0.6)
  })

  it('buckets the window into weeks, oldest first, losing nothing', () => {
    expect(weapon.weeks).toHaveLength(8)
    expect([weapon.weeks[0].weeksAgo, weapon.weeks[7].weeksAgo]).toEqual([7, 0])
    expect(
      weapon.weeks.reduce((sum, w) => sum + w.confirmed + w.falsePositive, 0),
    ).toBe(25)
  })

  it('withholds the rate and the trend when too little is behind them', () => {
    const thin = moduleAccuracy(
      Array.from({ length: 9 }, (_, i) =>
        alert({ id: `t${i}`, kind: 'violence', minutesAgo: 60 * (i + 1) }),
      ),
      'violence',
      56,
      NOW,
    )

    expect(thin.rateIsMeaningful).toBe(false)
    expect(thin.trendIsMeaningful).toBe(false)
    // The counts stay true and reportable — only the shape is withheld.
    expect([thin.raised, thin.confirmed]).toEqual([9, 9])
  })
})

describe('incident pattern', () => {
  const zoned = [
    alert({ id: 'z1', zone: 'Yard', status: 'confirmed', minutesAgo: 10 }),
    alert({ id: 'z2', zone: 'Yard', status: 'dismissed', minutesAgo: 20 }),
    alert({ id: 'z3', zone: 'Yard', status: 'unconfirmed', minutesAgo: 30 }),
    alert({ id: 'z4', zone: 'Perimeter', status: 'confirmed', minutesAgo: 40 }),
    alert({ id: 'z5', zone: '', status: 'confirmed', minutesAgo: 50 }),
  ]

  it('ranks zones busiest first and sorts the unzoned last', () => {
    const zones = byZone(zoned)
    expect(zones.map((z) => z.label)).toEqual(['Yard', 'Perimeter', 'No zone set'])
  })

  it('splits each zone by outcome', () => {
    const yard = byZone(zoned)[0]
    expect([yard.confirmed, yard.falsePositive, yard.waiting]).toEqual([1, 1, 1])
  })

  it('always returns 24 hours, including the quiet ones', () => {
    // The gaps are the finding — an hour with nothing in it is information.
    const hours = byHour(zoned)
    expect(hours).toHaveLength(24)
    expect(hours.reduce((sum, h) => sum + h.total, 0)).toBe(5)
  })

  it('reports no peak when there is nothing to peak', () => {
    expect(peakWindow(byHour([]))).toBeNull()
  })
})
