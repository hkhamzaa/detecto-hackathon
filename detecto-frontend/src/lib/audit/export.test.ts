import { describe, expect, it } from 'vitest'

import type { AuditEntry } from '@/lib/audit/api'
import { auditFilename, buildAuditCsv } from '@/lib/audit/export'

/**
 * The file somebody hands to an auditor.
 *
 * The formula-injection guard lives in `lib/csv.ts` and is tested there and in
 * the analytics export; what is checked here is that this export goes through
 * it rather than around it. Role names and camera names are typed by customers
 * and land in the same spreadsheet, so a second export that quoted its own
 * fields would be a second thing to get wrong.
 */

const BASE: AuditEntry = {
  id: 'aud_0001',
  at: '2026-08-14T12:00:00.000Z',
  actor: { id: 'usr_ade', name: 'Ade Okafor', roleName: 'Admin' },
  action: 'role.deleted',
  summary: 'Deleted the role Night shift',
  detail: ['1 person was moved to Site supervisor.', 'Nobody was left without a role.'],
  alertId: null,
}

const header = (csv: string) => csv.split('\r\n')[0]
const row = (csv: string, index = 1) => csv.split('\r\n')[index]

describe('buildAuditCsv', () => {
  it('writes one header and one row per entry', () => {
    const csv = buildAuditCsv([BASE, { ...BASE, id: 'aud_0002' }])
    expect(header(csv).split(',')).toHaveLength(9)
    expect(csv.trimEnd().split('\r\n')).toHaveLength(3)
  })

  it('carries both the raw action and the words for it', () => {
    // The id so a machine can group on it, the label so a person can read it.
    const line = row(buildAuditCsv([BASE]))
    expect(line).toContain('role.deleted')
    expect(line).toContain('Role deleted')
  })

  it('writes the role as it was recorded, not as it stands today', () => {
    expect(row(buildAuditCsv([BASE]))).toContain('Admin')
  })

  it('leaves the role empty when none was recorded, rather than guessing', () => {
    const decision: AuditEntry = {
      ...BASE,
      actor: { id: 'usr_l', name: 'L. Ferreira', roleName: null },
      action: 'alert.dismissed',
      summary: 'Marked ALR-2286 a false positive',
      detail: [],
      alertId: 'ALR-2286',
    }

    const cells = row(buildAuditCsv([decision])).split(',')
    // entry_id, logged_at, actor_name, actor_role_at_the_time → the fourth.
    expect(cells[3]).toBe('')
  })

  it('keeps one entry to one row when it has several detail lines', () => {
    // A row that split would break every reader that counts them.
    expect(buildAuditCsv([BASE]).trimEnd().split('\r\n')).toHaveLength(2)
    expect(row(buildAuditCsv([BASE]))).toContain('1 person was moved to Site supervisor.')
  })

  it('neutralises anything a spreadsheet would run as a formula', () => {
    // A role can be named by a customer, and it lands in a file an auditor
    // opens in Excel.
    const nasty: AuditEntry = {
      ...BASE,
      summary: '=cmd|/c calc',
      actor: { ...BASE.actor, roleName: '+SUM(A1)' },
    }

    const line = row(buildAuditCsv([nasty]))
    expect(line).toContain(`"'=cmd|/c calc"`)
    expect(line).toContain(`"'+SUM(A1)"`)
  })

  it('carries the alert id so a decision can be traced back', () => {
    const decision = { ...BASE, action: 'alert.confirmed' as const, alertId: 'ALR-2291' }
    expect(row(buildAuditCsv([decision])).trimEnd().endsWith('ALR-2291')).toBe(true)
  })

  it('uses CRLF, like the analytics export it shares its writer with', () => {
    expect(buildAuditCsv([BASE])).toContain('\r\n')
  })

  it('produces a header-only file when the filters matched nothing', () => {
    expect(buildAuditCsv([]).trimEnd().split('\r\n')).toHaveLength(1)
  })
})

describe('auditFilename', () => {
  it('is dated, and says what it is', () => {
    expect(auditFilename(new Date(2026, 7, 27))).toBe('detecto-audit-log-2026-08-27.csv')
  })

  it('pads single-digit months and days', () => {
    expect(auditFilename(new Date(2026, 0, 5))).toBe('detecto-audit-log-2026-01-05.csv')
  })
})
