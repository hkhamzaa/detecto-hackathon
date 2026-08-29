import { describe, expect, it } from 'vitest'

import type { Invoice } from '@/lib/invoice'
import { buildInvoiceCsv, invoiceFilename } from '@/lib/subscription/export'

/**
 * A customer's invoice list, as a file their finance team opens.
 *
 * The formula-injection guard lives in `lib/csv.ts` and is tested there; what
 * is checked here is that this export goes through it rather than around it.
 * Three exports now share that guard, and a fourth that quoted its own fields
 * would be the one that got it wrong.
 */

const BASE: Invoice = {
  id: 'INV-0006',
  periodEnd: '2026-08-23T00:00:00.000Z',
  amount: 420,
  status: 'paid',
}

const header = (csv: string) => csv.split('\r\n')[0]
const row = (csv: string, index = 1) => csv.split('\r\n')[index]

describe('buildInvoiceCsv', () => {
  it('writes one header and one row per invoice', () => {
    const csv = buildInvoiceCsv([BASE, { ...BASE, id: 'INV-0005' }], 'site')
    expect(header(csv).split(',')).toHaveLength(5)
    expect(csv.trimEnd().split('\r\n')).toHaveLength(3)
  })

  it('names the plan the way the rest of the product does', () => {
    expect(row(buildInvoiceCsv([BASE], 'site'))).toContain('Site')
  })

  it('writes an unrecognised plan id as-is rather than blanking it', () => {
    // The same reading `planLabel` takes: a plan this build has never heard of
    // is a record worth seeing, not one to hide.
    expect(row(buildInvoiceCsv([BASE], 'estate-legacy'))).toContain('estate-legacy')
  })

  it('says the status in the same words the page does', () => {
    expect(row(buildInvoiceCsv([{ ...BASE, status: 'due' }], 'site'))).toContain('Due')
    expect(row(buildInvoiceCsv([{ ...BASE, status: 'failed' }], 'site'))).toContain(
      'Failed',
    )
  })

  it('writes the amount as a number, so it can be added up', () => {
    // The point of exporting rows rather than a summary: whoever receives this
    // reconciles it against a statement.
    expect(row(buildInvoiceCsv([BASE], 'site'))).toContain(',420,')
  })

  it('neutralises anything a spreadsheet would run as a formula', () => {
    // A plan id can arrive from the backend, and it lands in the same
    // spreadsheet an accountant opens.
    const csv = buildInvoiceCsv([BASE], '=cmd|/c calc')
    expect(row(csv)).toContain(`"'=cmd|/c calc"`)
  })

  it('uses CRLF, like every other export it shares its writer with', () => {
    expect(buildInvoiceCsv([BASE], 'site')).toContain('\r\n')
  })

  it('produces a header-only file for an account with no invoices', () => {
    expect(buildInvoiceCsv([], 'site').trimEnd().split('\r\n')).toHaveLength(1)
  })
})

describe('invoiceFilename', () => {
  it('is dated, and says what it is', () => {
    expect(invoiceFilename(new Date(2026, 7, 27))).toBe('detecto-invoices-2026-08-27.csv')
  })

  it('pads single-digit months and days', () => {
    expect(invoiceFilename(new Date(2026, 0, 5))).toBe('detecto-invoices-2026-01-05.csv')
  })
})
