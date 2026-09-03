import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Alert, DetectionKind } from '@/lib/alerts/api'
import type { Camera } from '@/lib/cameras/api'
import type { DetectionModule } from '@/lib/modules/api'
import { IncidentPatternSection } from '@/pages/org/analytics/incident-pattern'
import { ModuleAccuracySection } from '@/pages/org/analytics/module-accuracy'
import { OverviewStrip } from '@/pages/org/analytics/overview-strip'
import { ResponseTimeSection } from '@/pages/org/analytics/response-time'

/**
 * What the analytics page actually puts on screen, at three volumes.
 *
 * The behaviour worth protecting is the restraint: a section that has enough
 * behind it draws a chart, and a section that does not says so and shows the
 * true counts instead. It would be easy for a later change to make the sparse
 * path quietly start rendering a two-point trend, and nothing else in the build
 * would notice.
 */

const NOW = Date.parse('2026-08-27T12:00:00Z')
const MIN = 60_000
const ZONES = ['Front of house', 'Yard', 'Level 2', 'Perimeter']

const MODULES: DetectionModule[] = [
  { id: 'weapon', name: 'Weapon detection', description: '', status: 'live', falsePositiveRate: 0.04, resourceNote: null },
  { id: 'violence', name: 'Violence detection', description: '', status: 'live', falsePositiveRate: 0.07, resourceNote: null },
  { id: 'loitering', name: 'Loitering', description: '', status: 'coming_soon', falsePositiveRate: null, resourceNote: null },
]

const CAMERAS: Camera[] = [
  { id: 'c1', name: 'Main entrance', zone: 'Front of house', online: true, lastSeen: null, reviewStatus: 'approved', sourceType: 'file' },
  { id: 'c2', name: 'Loading bay', zone: 'Yard', online: false, lastSeen: null, reviewStatus: 'approved', sourceType: 'file' },
  { id: 'c3', name: 'Car park', zone: 'Perimeter', online: true, lastSeen: null, reviewStatus: 'approved', sourceType: 'file' },
]

/** Spread across eight weeks and around the clock, with a slow tail in it. */
function alerts(count: number): Alert[] {
  return Array.from({ length: count }, (_, i) => {
    const minutesAgo = Math.floor((i / count) * 56 * 24 * 60) + (i % 24) * 60
    const dismissed = i % 5 === 0
    const waiting = i % 17 === 0
    const detectedAt = new Date(NOW - minutesAgo * MIN)
    const took = i % 23 === 0 ? 500 : 2 + (i % 12)

    return {
      id: `ALR-${2000 + i}`,
      cameraId: `c${(i % 3) + 1}`,
      cameraName: CAMERAS[i % 3].name,
      zone: ZONES[i % ZONES.length],
      kind: (i % 3 === 0 ? 'violence' : 'weapon') as DetectionKind,
      subtype: i % 2 ? 'handgun' : null,
      confidence: dismissed ? 0.61 : 0.89,
      detectedAt: detectedAt.toISOString(),
      model: 'wv-detect 3.2',
      status: waiting ? 'unconfirmed' : dismissed ? 'dismissed' : 'confirmed',
      decidedBy: waiting ? null : 'A. Okafor',
      decidedAt: waiting ? null : new Date(detectedAt.getTime() + took * MIN).toISOString(),
    }
  })
}

const text = (ui: React.ReactElement) =>
  (render(ui).container.textContent ?? '').replace(/\s+/g, ' ')

const markup = (ui: React.ReactElement) => render(ui).container.innerHTML

const FULL = alerts(120)
/** What a customer sees in their first week. */
const SPARSE = alerts(7)

describe('overview strip', () => {
  it('reports the week, the median decision and the offline cameras', () => {
    const out = text(<OverviewStrip alerts={FULL} cameras={CAMERAS} now={NOW} />)
    expect(out).toContain('Alerts raised')
    expect(out).toContain('Median time to a decision')
    expect(out).toContain('Of 3 configured')
  })

  it('colours the offline count, because that figure is itself the problem', () => {
    expect(markup(<OverviewStrip alerts={FULL} cameras={CAMERAS} now={NOW} />)).toContain(
      'text-signal-700',
    )
  })

  it('says it could not check rather than claiming zero when cameras are unreachable', () => {
    // "0 cameras offline" and "we could not check" are not the same claim.
    const out = text(<OverviewStrip alerts={FULL} cameras={null} now={NOW} />)
    expect(out).toContain('reach the camera list')
    expect(out).toContain('—')
  })

  it('does not divide by zero on an empty window', () => {
    expect(text(<OverviewStrip alerts={[]} cameras={CAMERAS} now={NOW} />)).toContain(
      'Nothing has been decided yet',
    )
  })
})

describe('module accuracy', () => {
  const full = () => (
    <ModuleAccuracySection alerts={FULL} modules={MODULES} windowDays={56} now={NOW} />
  )

  it('shows every live module', () => {
    const out = text(full())
    expect(out).toContain('Weapon detection')
    expect(out).toContain('Violence detection')
  })

  it('leaves out modules that have never run', () => {
    // A `coming_soon` module has no accuracy, and inventing a bar for it would
    // contradict the modules page.
    expect(text(full())).not.toContain('Loitering')
  })

  it('puts the published rate next to the observed one', () => {
    expect(text(full())).toContain('~4%')
  })

  it('reports the confidence split', () => {
    expect(text(full())).toContain('median confidence')
  })

  it('withholds the rate on thin data but keeps the counts', () => {
    const out = text(
      <ModuleAccuracySection alerts={SPARSE} modules={MODULES} windowDays={56} now={NOW} />,
    )
    expect(out).toContain('Not enough data yet')
    expect(out).toContain('False positive')
    expect(out).not.toContain('your false positive rate')
  })

  it('explains itself when nothing has been decided at all', () => {
    expect(
      text(<ModuleAccuracySection alerts={[]} modules={MODULES} windowDays={56} now={NOW} />),
    ).toContain('Nobody has confirmed or dismissed')
  })
})

describe('incident pattern', () => {
  it('ranks zones and draws the hour axis when there is volume', () => {
    const out = text(<IncidentPatternSection alerts={FULL} />)
    expect(out).toContain('Front of house')
    expect(out).toContain('By time of day')
    expect(out).toContain('00:00')
    expect(out).not.toContain('Not enough data yet')
  })

  it('withholds both charts on thin data', () => {
    const out = text(<IncidentPatternSection alerts={SPARSE} />)
    expect(out).toContain('Not enough data yet')
    // No hour axis means no peak is being claimed from seven detections.
    expect(out).not.toContain('00:00')
  })

  it('says so plainly when nothing has been raised', () => {
    expect(text(<IncidentPatternSection alerts={[]} />)).toContain(
      'Nothing has been raised in any zone yet',
    )
  })
})

describe('response time', () => {
  it('shows the distribution, the slow bucket and anything still waiting', () => {
    const out = text(<ResponseTimeSection alerts={FULL} now={NOW} />)
    expect(out).toContain('Nine in ten within')
    expect(out).toContain('4h+')
    expect(out).toContain('awaiting a human right now')
    expect(out).not.toContain('Not enough data yet')
  })

  it('withholds the spread on thin data and drops the percentile figure with it', () => {
    const out = text(<ResponseTimeSection alerts={SPARSE} now={NOW} />)
    expect(out).toContain('Not enough data yet')
    expect(out).not.toContain('Nine in ten within')
  })

  it('says so plainly when nothing has been decided', () => {
    expect(text(<ResponseTimeSection alerts={[]} now={NOW} />)).toContain(
      'Nothing has been confirmed or dismissed yet',
    )
  })
})
