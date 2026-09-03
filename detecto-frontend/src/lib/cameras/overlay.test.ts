import { describe, expect, it } from 'vitest'

import { overlayFor, parseTick, scoredUntil, tickAt, type DetectionTick } from '@/lib/cameras/overlay'

function tick(partial: Partial<DetectionTick>): DetectionTick {
  const offsetS = partial.offsetS ?? 0.4
  return {
    cameraId: 'cam-1',
    offsetS,
    startS: Math.max(0, offsetS - 0.4),
    endS: offsetS,
    timestamp: '2026-09-03T00:00:02Z',
    classification: 'Normal',
    violence: 0.1,
    weapon: 0.1,
    ...partial,
  }
}

describe('overlayFor', () => {
  it('is Neutral 0%/0% when this moment has no covering model window', () => {
    expect(overlayFor(null)).toEqual({
      text: 'Normal  (Violence 0% | Weapon 0%)',
      tone: 'normal',
    })
  })

  it('is green Normal when both heads are below the threshold', () => {
    const banner = overlayFor(tick({ violence: 0.12, weapon: 0.08 }))
    expect(banner.tone).toBe('normal')
    expect(banner.text).toContain('Normal')
    expect(banner.text).toContain('Violence 12%')
    expect(banner.text).toContain('Weapon 8%')
  })

  it('is orange ALERT when only one head is up', () => {
    const weapon = overlayFor(tick({ violence: 0.2, weapon: 0.81 }))
    expect(weapon.tone).toBe('moderate')
    expect(weapon.text).toBe('ALERT: Weapon 81% | Violence 20%')

    const violence = overlayFor(tick({ violence: 0.74, weapon: 0.1 }))
    expect(violence.tone).toBe('moderate')
    expect(violence.text).toBe('ALERT: Violence 74% | Weapon 10%')
  })

  it('is red ALERT when both heads are up', () => {
    const banner = overlayFor(tick({ violence: 0.93, weapon: 0.88 }))
    expect(banner.tone).toBe('high')
    expect(banner.text).toBe('ALERT: Weapon 88% | Violence 93%')
  })
})

describe('tickAt', () => {
  const ticks = [
    tick({ offsetS: 0.4, startS: 0, endS: 0.4, violence: 0.05, weapon: 0.02 }),
    tick({ offsetS: 2.0, startS: 1.6, endS: 2.0, violence: 0.9, weapon: 0.8 }),
  ]

  it('only uses a window that covers the playhead, never a 2s-away clip', () => {
    expect(tickAt(ticks, 0.2)?.violence).toBe(0.05)
    expect(tickAt(ticks, 0.8)).toBeNull()
    expect(tickAt(ticks, 1.8)?.weapon).toBe(0.8)
    expect(tickAt(ticks, 20)).toBeNull()
  })

  it('ignores ticks from another camera', () => {
    const mixed = [...ticks, tick({ cameraId: 'cam-other', offsetS: 0.2, startS: 0, endS: 0.4, violence: 0.99 })]
    expect(tickAt(mixed, 0.2, { cameraId: 'cam-1' })?.violence).toBe(0.05)
  })

  it('reports how far through the file has been scored', () => {
    expect(scoredUntil([])).toBeNull()
    expect(scoredUntil(ticks)).toBe(2)
  })
})

describe('parseTick', () => {
  it('accepts a well-formed socket payload and rejects the rest', () => {
    expect(
      parseTick({
        cameraId: 'cam-1',
        offsetS: 4.5,
        startS: 4.1,
        endS: 4.5,
        timestamp: 't',
        classification: 'Violence',
        violence: 0.6,
        weapon: 0.2,
      }),
    ).toMatchObject({ cameraId: 'cam-1', offsetS: 4.5, startS: 4.1, endS: 4.5, violence: 0.6 })
    expect(parseTick({ cameraId: 'cam-1' })).toBeNull()
    expect(parseTick(null)).toBeNull()
    expect(
      parseTick(
        { cameraId: 'cam-other', offsetS: 1, violence: 0.9, weapon: 0.9 },
        'cam-1',
      ),
    ).toBeNull()
  })
})
