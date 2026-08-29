import { describe, expect, it } from 'vitest'

import { listAlerts } from '@/lib/alerts/api'
import { AUDIT_ACTIONS, getAuditLog } from '@/lib/audit/api'
import { ACTION_GROUPS, groupOf } from '@/lib/audit/filter'

/**
 * The audit feed, exercised through its own dev mock.
 *
 * Two properties are being protected. The first is that the alert decisions in
 * this feed are the *same* decisions the queue shows — read from the alert
 * store, not copied into a second list that could drift. An audit log that
 * disagrees with the queue it describes is worse than no audit log.
 *
 * The second is that an entry never resolves anything at read time. Who somebody
 * was, and what they held, has to be captured on the entry, or the log quietly
 * changes what it says about the past.
 */

async function log() {
  const result = await getAuditLog()
  if (!result.ok) throw new Error(result.code)
  return result.entries
}

describe('the feed', () => {
  it('reads newest first', async () => {
    const dates = (await log()).map((entry) => Date.parse(entry.at))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })

  it('covers every area a person can act in', async () => {
    // The log describes what the product can actually do. A group with no entry
    // in the mock is an area somebody would not think to look for.
    const groups = new Set((await log()).map((entry) => groupOf(entry.action)))
    for (const group of ACTION_GROUPS) {
      expect([...groups]).toContain(group.id)
    }
  })

  it('numbers seeded entries in the order things happened, not the order shown', async () => {
    // An append-only log's ids ascend with time. The feed is sorted newest
    // first for reading; the ids are the sequence the actions occurred in.
    const seeded = (await log())
      .filter((entry) => /^aud_\d+$/.test(entry.id))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((entry) => entry.id)

    expect(seeded).toEqual([...seeded].sort())
    expect(seeded[0]).toBe('aud_0001')
  })

  it('uses only actions this build knows about', async () => {
    for (const entry of await log()) {
      expect(AUDIT_ACTIONS).toContain(entry.action)
    }
  })

  it('names somebody on every entry', async () => {
    // An entry that cannot say who acted is not an audit entry.
    for (const entry of await log()) {
      expect(entry.actor.name.length).toBeGreaterThan(0)
      expect(entry.actor.id.length).toBeGreaterThan(0)
    }
  })

  it('says what changed in words, never as a diff', async () => {
    for (const entry of await log()) {
      expect(entry.summary.length).toBeGreaterThan(0)
      // The register the role summaries use: a sentence, not a field path.
      expect(entry.summary).not.toMatch(/[{}]|=>|null|undefined/)
    }
  })
})

describe('alert decisions', () => {
  it('references the queue rather than duplicating it', async () => {
    // Every decision entry points at a detection that exists. Copying the
    // decisions into the audit mock would have let the two drift.
    const alerts = await listAlerts()
    if (!alerts.ok) throw new Error(alerts.code)

    const decided = alerts.alerts.filter((alert) => alert.status !== 'unconfirmed')
    const entries = (await log()).filter((entry) => groupOf(entry.action) === 'alert')

    expect(entries).toHaveLength(decided.length)
    expect(entries.length).toBeGreaterThan(0)

    for (const entry of entries) {
      const alert = decided.find((item) => item.id === entry.alertId)
      expect(alert).toBeDefined()
      expect(entry.actor.name).toBe(alert?.decidedBy)
      expect(entry.at).toBe(alert?.decidedAt)
    }
  })

  it('matches the decision the queue recorded', async () => {
    const alerts = await listAlerts()
    if (!alerts.ok) throw new Error(alerts.code)

    for (const entry of (await log()).filter((e) => groupOf(e.action) === 'alert')) {
      const alert = alerts.alerts.find((item) => item.id === entry.alertId)
      expect(entry.action).toBe(
        alert?.status === 'confirmed' ? 'alert.confirmed' : 'alert.dismissed',
      )
    }
  })

  it('leaves an alert still waiting out of the log entirely', async () => {
    // Nothing has been decided about it, so there is nothing to record.
    const alerts = await listAlerts()
    if (!alerts.ok) throw new Error(alerts.code)

    const waiting = alerts.alerts.filter((alert) => alert.status === 'unconfirmed')
    const ids = (await log()).map((entry) => entry.alertId)

    expect(waiting.length).toBeGreaterThan(0)
    for (const alert of waiting) expect(ids).not.toContain(alert.id)
  })

  it('records no role, because the detection record never captured one', async () => {
    // An `Alert` carries who decided it and not what they were allowed to do.
    // Filling that in from their role today would be a claim about the past
    // that nobody checked.
    for (const entry of (await log()).filter((e) => groupOf(e.action) === 'alert')) {
      expect(entry.actor.roleName).toBeNull()
    }
  })

  it('says plainly that confirming contacted nobody', async () => {
    const confirmed = (await log()).find((entry) => entry.action === 'alert.confirmed')
    expect(confirmed?.detail.join(' ')).toContain('Detecto contacted nobody')
  })
})

describe('the role held at the time', () => {
  it('is a snapshot on the entry, not a live reference', async () => {
    // `Rota lead` is not a role in the directory — it was edited away
    // afterwards. An entry that resolved its role at read time would have lost
    // it, or quietly relabelled the past with whatever that person holds now.
    const roles = (await log())
      .map((entry) => entry.actor.roleName)
      .filter((role): role is string => role !== null)

    expect(roles).toContain('Rota lead')
  })

  it('keeps naming a deleted role in the entry that deleted it', async () => {
    const deletion = (await log()).find((entry) => entry.action === 'role.deleted')
    expect(deletion?.summary).toContain('Night shift')
    // The reassignment decision, which is the other half of that action.
    expect(deletion?.detail.join(' ')).toContain('moved to Site supervisor')
  })
})

describe('the boundary this module keeps', () => {
  it('offers no way to write or delete an entry', async () => {
    // A log the client can append to is not a log, and one it can delete from
    // is evidence of nothing.
    const api = await import('@/lib/audit/api')
    expect(Object.keys(api).sort()).toEqual(['AUDIT_ACTIONS', 'getAuditLog'])
  })

  it('keeps an entry to who, what, when — and nothing to render', async () => {
    expect(Object.keys((await log())[0]).sort()).toEqual([
      'action',
      'actor',
      'alertId',
      'at',
      'detail',
      'id',
      'summary',
    ])
  })
})
