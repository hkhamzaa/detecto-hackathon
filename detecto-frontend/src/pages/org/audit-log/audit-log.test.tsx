import { fireEvent } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAuditLog, type AuditEntry } from '@/lib/audit/api'
import { groupOf } from '@/lib/audit/filter'
import { AUDIT_KEY } from '@/lib/audit/queries'
import type { Claims } from '@/lib/auth/claims'
import { navFor } from '@/lib/auth/nav'
import { landingPathFor } from '@/lib/auth/redirect'
import OrgAuditLogPage from '@/pages/org/audit-log'
import { NO_GRANTS, renderPage, signIn } from '@/test/harness'

let entries: AuditEntry[]

beforeAll(async () => {
  const result = await getAuditLog()
  if (!result.ok) throw new Error(result.code)
  entries = result.entries
})

function claimsWith(permissions: string[]): Claims {
  return {
    sub: 'usr_test',
    email: 'test@northgate.com',
    role: 'member',
    permissions,
    orgId: 'org_northgate',
    exp: Math.floor(Date.now() / 1000) + 900,
  }
}

const AUDITOR = claimsWith(['audit:view'])

/** `path` carries the filter, the same way the page reads it back. */
function open(path = '/org/audit-log') {
  return renderPage(<OrgAuditLogPage />, {
    path,
    route: '/org/audit-log',
    seed: (client) => {
      client.setQueryData(AUDIT_KEY, entries)
    },
  })
}

describe('permissions', () => {
  it('refuses an account without the grant', () => {
    signIn(NO_GRANTS)
    expect(open().text()).toContain("You don't have permission to read the audit log")
  })

  it('is its own grant, not the settings one', () => {
    // A compliance officer reads the record and changes nothing. `audit:view`
    // has always been separate from `org:settings`; what follows is that
    // holding only it is enough to open this page.
    signIn(AUDITOR)
    expect(open().text()).toContain('Audit log')
    expect(open().text()).not.toContain("You don't have permission")

    signIn(claimsWith(['org:settings']))
    expect(open().text()).toContain("You don't have permission to read the audit log")
  })

  it('lands somebody holding only that grant on this page', () => {
    // Before this, `audit:view` was a permission the role builder could hand
    // out that led nowhere: the holder landed on `/no-access` and could not
    // reach the one page it exists for.
    expect(landingPathFor(AUDITOR)).toBe('/org/audit-log')

    const nav = navFor(AUDITOR)
    expect(nav?.items.map((item) => item.to)).toEqual(['/org/audit-log'])
  })

  it('still sends somebody who also watches alerts to their queue', () => {
    // The record is a side job for an operator; the queue is not.
    expect(landingPathFor(claimsWith(['alerts:confirm', 'audit:view']))).toBe('/alerts')
  })
})

describe('what the page says about itself', () => {
  it('leads with the fact that the log is stored', () => {
    signIn(AUDITOR)
    const out = open().text()

    expect(out).toContain('This log is stored')
    expect(out).toContain('written when the action happened')
    expect(out).toContain('Confirming records that a person took responsibility')
    expect(out).toContain('Detecto has not contacted anyone')
  })

  it('warns that a missing entry proves nothing', () => {
    // The failure mode that matters: somebody reading absence as evidence.
    signIn(AUDITOR)
    const out = open().text()

    expect(out).toContain('This page is a view of that record')
    expect(out).toContain('do not treat a missing entry as evidence that nothing happened')
  })

  it('does not claim the feed is assembled or unstored', () => {
    signIn(AUDITOR)
    const out = open().text()

    expect(out).not.toContain('assembled for this page')
    expect(out).not.toContain('nothing below is stored')
    expect(out).not.toContain('does not exist yet')
    expect(out).not.toContain('No audit-event service')
  })
})

describe('the entries', () => {
  it('shows who, what and when', () => {
    signIn(AUDITOR)
    const out = open().text()

    expect(out).toContain('Ade Okafor')
    expect(out).toContain('Deleted the role Night shift')
    expect(out).toContain('Turned Weapon detection on for every camera in Yard')
  })

  it('names the role somebody held at the time, including a deleted one', () => {
    signIn(AUDITOR)
    const out = open().text()

    // Neither role exists in the directory any more. The entry still says them.
    expect(out).toContain('Rota lead')
    expect(out).toContain('Night shift')
  })

  it('carries the reassignment decision, not just the deletion', () => {
    signIn(AUDITOR)
    expect(open().text()).toContain('moved to Site supervisor')
  })

  it('says plainly when a role was not recorded rather than guessing one', () => {
    signIn(AUDITOR)
    expect(open().text()).toContain('role not recorded')
  })

  it('links an alert decision to the detection it decided', () => {
    signIn(AUDITOR)
    const view = open()

    const decision = entries.find((entry) => entry.alertId !== null)
    expect(decision).toBeDefined()
    expect(view.html()).toContain(`/org/alerts/${decision?.alertId}`)
  })

  it('reads the actions in words, never as ids', () => {
    signIn(AUDITOR)
    const out = open().text()

    expect(out).toContain('Detection turned on')
    expect(out).toContain('Notification routing changed')
    expect(out).not.toContain('module.enabled')
  })
})

describe('filtering', () => {
  it('narrows by person', () => {
    signIn(AUDITOR)
    const view = open('/org/audit-log?who=usr_rhea')

    expect(view.text()).toContain('Rhea Mehta')
    expect(view.text()).not.toContain('Turned Weapon detection on for every camera in Yard')
  })

  it('narrows by action area', () => {
    signIn(AUDITOR)
    const view = open('/org/audit-log?action=role')

    expect(view.text()).toContain('Deleted the role Night shift')
    expect(view.text()).not.toContain('Added 4 cameras')
  })

  it('narrows by search, including by alert id', () => {
    signIn(AUDITOR)
    const decision = entries.find((entry) => entry.alertId !== null) as AuditEntry
    const view = open(`/org/audit-log?q=${encodeURIComponent(decision.alertId as string)}`)

    expect(view.text()).toContain(decision.alertId as string)
    expect(view.text()).not.toContain('Deleted the role Night shift')
  })

  it('says how many of the whole log is being shown', () => {
    signIn(AUDITOR)
    expect(open('/org/audit-log?action=role').text()).toContain(
      `of ${entries.length}`,
    )
  })

  it('keeps the filter in the URL so a finding can be sent on', () => {
    // This is the page whose answers get passed to somebody else, so the filter
    // lives in the URL rather than in component state. The page holds no state
    // of its own: if picking somebody narrows the table, the choice went out to
    // the URL and came back, which is exactly what makes the view linkable.
    signIn(AUDITOR)
    const view = open()
    expect(view.text()).toContain('Added 4 cameras')

    fireEvent.change(view.getByLabelText('Person'), {
      target: { value: 'usr_rhea' },
    })

    expect(view.text()).toContain('Rhea Mehta')
    expect(view.text()).not.toContain('Added 4 cameras')
  })

  it('offers everybody in the log, not everybody in the directory', () => {
    // `A. Okafor` is how the detection record names whoever decided an alert.
    // A person filter built from the current directory would not offer them at
    // all, and the decisions are frequently what somebody came here to find.
    signIn(AUDITOR)
    const view = open()

    const options = [...view.getByLabelText('Person').querySelectorAll('option')].map(
      (option) => option.textContent,
    )

    expect(options[0]).toBe('Anyone')
    expect(options).toContain('A. Okafor')
    expect(options).toContain('Tomas Bergstrom')
  })

  it('separates matching nothing from nothing having happened', () => {
    // On this page those are answers with completely different consequences.
    signIn(AUDITOR)
    const view = open('/org/audit-log?q=nothing-matches-this')

    expect(view.text()).toContain('Nothing in the log matches those filters')
    expect(view.text()).toContain('That is not the same as nothing having happened')
  })

  it('clears back to the whole log', () => {
    signIn(AUDITOR)
    const view = open('/org/audit-log?q=nothing-matches-this')

    // Offered twice on purpose — once in the filter panel, and once in the
    // empty result where the reader is actually looking.
    const clear = view.getAllByRole('button', { name: 'Clear filters' })
    expect(clear).toHaveLength(2)

    fireEvent.click(clear[1])
    expect(view.text()).toContain('Deleted the role Night shift')
  })

  it('offers a date range as two real date fields', () => {
    signIn(AUDITOR)
    const view = open()

    expect((view.getByLabelText('From') as HTMLInputElement).type).toBe('date')
    expect((view.getByLabelText('To') as HTMLInputElement).type).toBe('date')
  })
})

describe('export', () => {
  it('offers the log as CSV, counting what is on screen', () => {
    signIn(AUDITOR)
    const view = open()

    expect(view.getByRole('button', { name: 'Export' })).toBeTruthy()
    expect(view.text()).toContain(`${entries.length} entries as CSV`)
  })

  it('exports the filtered view, and says that is what it is', () => {
    signIn(AUDITOR)
    const shown = entries.filter((entry) => groupOf(entry.action) === 'role')
    const view = open('/org/audit-log?action=role')

    expect(view.text()).toContain(`${shown.length} matching entries as CSV`)
  })

  it('says the file carries no provenance and records nothing', () => {
    // Taking a copy of an audit log is itself an auditable event, and this is
    // the page where somebody will later ask who took one.
    signIn(AUDITOR)
    const out = open().text()

    expect(out).toContain('The export carries no provenance, and logs nothing')
    expect(out).toContain('nothing records that, because there is nothing to record it to')
  })
})

describe('the gaps this page is honest about', () => {
  it('explains why an alert decision has no role on it', () => {
    signIn(AUDITOR)
    expect(open().text()).toContain('it was never meant to be an audit event')
  })

  it('says filtering and paging belong on the server', () => {
    signIn(AUDITOR)
    expect(open().text()).toContain('Everything is filtered and drawn in the browser')
  })

  it('closes on why the role is kept as it was written', () => {
    signIn(AUDITOR)
    expect(open().text()).toContain(
      'what somebody was allowed to do on the day they did something does not change',
    )
  })
})

describe('an account where nothing has happened', () => {
  it('says so, without offering filters over an empty list', () => {
    signIn(AUDITOR)
    const view = renderPage(<OrgAuditLogPage />, {
      seed: (client) => {
        client.setQueryData(AUDIT_KEY, [])
      },
    })

    expect(view.text()).toContain('Nobody has done anything in this account yet')
    expect(view.queryByLabelText('Person')).toBeNull()
    expect(view.queryByRole('button', { name: 'Export' })).toBeNull()
  })
})
