import { describe, expect, it } from 'vitest'

import type { Alert } from '@/lib/alerts/api'
import { buildCsv, exportFilename } from '@/lib/analytics/export'

/**
 * The file a customer hands to somebody outside Detecto.
 *
 * The formula-injection guard is the one worth having a test for. Camera names
 * and zones are typed by customers, and a zone called `=cmd|...` in a file an
 * auditor opens in Excel is a well-known way to run code on their machine.
 * Quoting alone does not stop it.
 */

const BASE: Alert = {
  id: 'ALR-1',
  cameraId: 'cam_1',
  cameraName: 'Main entrance',
  zone: 'Front of house',
  kind: 'weapon',
  subtype: 'handgun',
  confidence: 0.94,
  detectedAt: '2026-08-27T10:00:00.000Z',
  model: 'wv-detect 3.2',
  status: 'confirmed',
  decidedBy: 'A. Okafor',
  decidedAt: '2026-08-27T10:07:00.000Z',
}

const header = (csv: string) => csv.split('\r\n')[0]
const row = (csv: string, index = 1) => csv.split('\r\n')[index]

describe('buildCsv', () => {
  it('writes one header and one row per alert', () => {
    const csv = buildCsv([BASE, { ...BASE, id: 'ALR-2' }])
    expect(header(csv).split(',')).toHaveLength(13)
    expect(csv.trimEnd().split('\r\n')).toHaveLength(3)
  })

  it('neutralises anything a spreadsheet would run as a formula', () => {
    const csv = buildCsv([{ ...BASE, zone: '=cmd|/c calc' }])
    expect(row(csv)).toContain(`"'=cmd|/c calc"`)
  })

  it('guards every formula lead character, not just equals', () => {
    for (const dangerous of ['=x', '+x', '-x', '@x']) {
      const csv = buildCsv([{ ...BASE, cameraName: dangerous }])
      expect(row(csv)).toContain(`"'${dangerous}"`)
    }
  })

  it('escapes quotes and commas the way the CSV spec asks', () => {
    const csv = buildCsv([{ ...BASE, cameraName: 'Front, "main"' }])
    expect(row(csv)).toContain('"Front, ""main"""')
  })

  it('carries the response time so the figures can be re-derived', () => {
    // The point of exporting rows rather than a chart: whoever receives this
    // can add it up themselves.
    expect(row(buildCsv([BASE])).trimEnd().endsWith(',7')).toBe(true)
  })

  it('leaves the response time empty for an alert still waiting', () => {
    const waiting = { ...BASE, status: 'unconfirmed' as const, decidedBy: null, decidedAt: null }
    expect(row(buildCsv([waiting])).trimEnd().endsWith(',')).toBe(true)
  })

  it('prints confidence to two decimals, as every other surface does', () => {
    expect(row(buildCsv([{ ...BASE, confidence: 0.6 }]))).toContain('0.60')
  })

  it('uses CRLF, which is what the spreadsheet these open in expects', () => {
    expect(buildCsv([BASE])).toContain('\r\n')
  })

  it('produces a header-only file for an empty window', () => {
    expect(buildCsv([]).trimEnd().split('\r\n')).toHaveLength(1)
  })
})

describe('exportFilename', () => {
  it('is dated, so two exports never collide', () => {
    expect(exportFilename(new Date(2026, 7, 27))).toBe('detecto-alerts-2026-08-27.csv')
  })

  it('pads single-digit months and days', () => {
    expect(exportFilename(new Date(2026, 0, 5))).toBe('detecto-alerts-2026-01-05.csv')
  })
})
