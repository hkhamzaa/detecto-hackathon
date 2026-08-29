import { describe, expect, it } from 'vitest'

import { AUDIT_ACTIONS, type AuditEntry } from '@/lib/audit/api'
import {
  ACTION_GROUPS,
  actionLabel,
  actorsIn,
  applyFilter,
  groupOf,
  isActionGroup,
  isFiltered,
  NO_FILTER,
  type AuditFilter,
} from '@/lib/audit/filter'

/**
 * Finding one thing in the log.
 *
 * The date bounds are the part worth testing hardest. Somebody asking for "the
 * 14th" means their own 14th, start to end — an off-by-one at either edge on
 * this page is an auditor being told an action did not happen.
 */

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'aud_0001',
    at: '2026-08-14T12:00:00.000Z',
    actor: { id: 'usr_ade', name: 'Ade Okafor', roleName: 'Admin' },
    action: 'role.created',
    summary: 'Created the role Night shift',
    detail: ['Can see the alert queue and confirm alerts.'],
    alertId: null,
    ...over,
  }
}

/** A local `YYYY-MM-DD` for a date, matching what the date input hands back. */
function day(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function filter(over: Partial<AuditFilter> = {}): AuditFilter {
  return { ...NO_FILTER, ...over }
}

describe('action groups', () => {
  it('covers every action, with none left ungrouped', () => {
    // The group is the prefix of the action id, so a new action joins its group
    // by being named correctly rather than by being added to a second list.
    const known = ACTION_GROUPS.map((group) => group.id)
    for (const action of AUDIT_ACTIONS) {
      expect(known).toContain(groupOf(action))
    }
  })

  it('gives every action words rather than its id', () => {
    for (const action of AUDIT_ACTIONS) {
      const label = actionLabel(action)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('.')
      expect(label).not.toContain('_')
    }
  })

  it('rejects a group that is not one', () => {
    expect(isActionGroup('role')).toBe(true)
    expect(isActionGroup('nonsense')).toBe(false)
    expect(isActionGroup(null)).toBe(false)
  })
})

describe('no filter', () => {
  it('returns everything, in the order it was given', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    expect(applyFilter(entries, NO_FILTER).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(isFiltered(NO_FILTER)).toBe(false)
  })

  it('knows when any one control has been used', () => {
    expect(isFiltered(filter({ actorId: 'usr_ade' }))).toBe(true)
    expect(isFiltered(filter({ group: 'role' }))).toBe(true)
    expect(isFiltered(filter({ from: '2026-08-01' }))).toBe(true)
    expect(isFiltered(filter({ query: 'yard' }))).toBe(true)
    // Whitespace is not a search.
    expect(isFiltered(filter({ query: '   ' }))).toBe(false)
  })
})

describe('by person', () => {
  const entries = [
    entry({ id: 'a', actor: { id: 'usr_ade', name: 'Ade Okafor', roleName: 'Admin' } }),
    entry({ id: 'b', actor: { id: 'usr_rhea', name: 'Rhea Mehta', roleName: 'Supervisor' } }),
  ]

  it('narrows to one account', () => {
    expect(applyFilter(entries, filter({ actorId: 'usr_rhea' })).map((e) => e.id)).toEqual([
      'b',
    ])
  })

  it('lists everybody who appears, including people who have since left', () => {
    // Drawn from the entries rather than the current directory: a deactivated
    // colleague is frequently the reason somebody opened this page.
    const actors = actorsIn(entries)
    expect(actors.map((a) => a.name)).toEqual(['Ade Okafor', 'Rhea Mehta'])
  })

  it('lists each person once however many entries they have', () => {
    expect(actorsIn([...entries, entry({ id: 'c' })])).toHaveLength(2)
  })
})

describe('by action', () => {
  const entries = [
    entry({ id: 'a', action: 'role.created' }),
    entry({ id: 'b', action: 'role.deleted' }),
    entry({ id: 'c', action: 'alert.confirmed' }),
    entry({ id: 'd', action: 'camera.added' }),
  ]

  it('narrows to a whole area rather than a single action', () => {
    expect(applyFilter(entries, filter({ group: 'role' })).map((e) => e.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('separates alert decisions from everything else', () => {
    expect(applyFilter(entries, filter({ group: 'alert' })).map((e) => e.id)).toEqual(['c'])
  })
})

describe('by date range', () => {
  // Built from local time, because that is what the date input produces and
  // what the reader means.
  const midday = new Date(2026, 7, 14, 12, 0, 0)
  const justBefore = new Date(2026, 7, 14, 0, 0, 0)
  const justAfter = new Date(2026, 7, 14, 23, 59, 59)

  const entries = [
    entry({ id: 'before', at: new Date(2026, 7, 13, 23, 59, 59).toISOString() }),
    entry({ id: 'start', at: justBefore.toISOString() }),
    entry({ id: 'midday', at: midday.toISOString() }),
    entry({ id: 'end', at: justAfter.toISOString() }),
    entry({ id: 'after', at: new Date(2026, 7, 15, 0, 0, 0).toISOString() }),
  ]

  it('includes the whole of the first day and the whole of the last', () => {
    // The off-by-one that matters: an entry at one minute to midnight on the
    // day somebody asked about is an entry on that day.
    const shown = applyFilter(
      entries,
      filter({ from: day(midday), to: day(midday) }),
    )
    expect(shown.map((e) => e.id)).toEqual(['start', 'midday', 'end'])
  })

  it('takes a lower bound on its own', () => {
    const shown = applyFilter(entries, filter({ from: day(midday) }))
    expect(shown.map((e) => e.id)).toEqual(['start', 'midday', 'end', 'after'])
  })

  it('takes an upper bound on its own', () => {
    const shown = applyFilter(entries, filter({ to: day(midday) }))
    expect(shown.map((e) => e.id)).toEqual(['before', 'start', 'midday', 'end'])
  })

  it('treats a half-typed date as no bound rather than emptying the table', () => {
    // A date field somebody is midway through filling in must not make the log
    // look empty under them.
    expect(applyFilter(entries, filter({ from: '2026-08' }))).toHaveLength(entries.length)
    expect(applyFilter(entries, filter({ to: 'nonsense' }))).toHaveLength(entries.length)
  })

  it('drops an entry whose own timestamp cannot be read', () => {
    const broken = [entry({ id: 'broken', at: 'not a date' })]
    expect(applyFilter(broken, filter({ from: day(midday) }))).toEqual([])
  })
})

describe('search', () => {
  const entries = [
    entry({
      id: 'a',
      summary: 'Turned Weapon detection on for Loading bay',
      detail: [],
    }),
    entry({
      id: 'b',
      action: 'alert.confirmed',
      summary: 'Confirmed ALR-2291 — Weapon · handgun on Main entrance',
      alertId: 'ALR-2291',
    }),
    entry({ id: 'c', summary: 'Deleted the role Night shift', detail: ['1 person moved.'] }),
  ]

  it('matches what changed', () => {
    expect(applyFilter(entries, filter({ query: 'loading bay' })).map((e) => e.id)).toEqual([
      'a',
    ])
  })

  it('matches an alert id, which is how somebody arrives with one', () => {
    expect(applyFilter(entries, filter({ query: 'ALR-2291' })).map((e) => e.id)).toEqual([
      'b',
    ])
  })

  it('matches the detail lines as well as the summary', () => {
    expect(applyFilter(entries, filter({ query: 'person moved' })).map((e) => e.id)).toEqual([
      'c',
    ])
  })

  it('matches the person and the role they held', () => {
    expect(applyFilter(entries, filter({ query: 'okafor' }))).toHaveLength(3)
    expect(applyFilter(entries, filter({ query: 'admin' }))).toHaveLength(3)
  })

  it('ignores case and surrounding space', () => {
    expect(applyFilter(entries, filter({ query: '  WEAPON  ' }))).toHaveLength(2)
  })
})

describe('several filters at once', () => {
  it('narrows on every clause together', () => {
    const entries = [
      entry({ id: 'a', action: 'role.created', at: new Date(2026, 7, 14).toISOString() }),
      entry({
        id: 'b',
        action: 'role.deleted',
        at: new Date(2026, 7, 14).toISOString(),
        actor: { id: 'usr_rhea', name: 'Rhea Mehta', roleName: 'Supervisor' },
      }),
      entry({ id: 'c', action: 'role.deleted', at: new Date(2026, 7, 20).toISOString() }),
    ]

    const shown = applyFilter(
      entries,
      filter({
        actorId: 'usr_ade',
        group: 'role',
        from: day(new Date(2026, 7, 14)),
        to: day(new Date(2026, 7, 14)),
      }),
    )
    expect(shown.map((e) => e.id)).toEqual(['a'])
  })

  it('never reorders what it narrowed', () => {
    // Two filtered views of one list get compared against each other. A filter
    // that also resorted would make that harder than it needs to be.
    const entries = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    expect(applyFilter(entries, filter({ query: 'okafor' })).map((e) => e.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
