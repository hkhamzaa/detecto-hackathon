import { describe, expect, it } from 'vitest'

import { getBillingLedger } from '@/lib/billing/api'
import { planById, PLANS } from '@/lib/plans'
import { getTenant, listTenants, MOCK_UNPAID } from '@/lib/tenants/api'

/**
 * The billing ledger, exercised through its own dev mock.
 *
 * The property worth protecting hardest is that this page and the tenant detail
 * page are one system. Whether an account has paid is a single fact with two
 * readers, and a build where billing lists an account as past due while its own
 * record shows every invoice settled would make both pages untrustworthy on the
 * one subject somebody opens them to check.
 *
 * The second is the boundary. It is the least contentious one on the platform —
 * money has no route into footage — which is exactly why it is asserted rather
 * than assumed.
 */

async function ledger() {
  const result = await getBillingLedger()
  if (!result.ok) throw new Error(result.code)
  return result.ledger
}

describe('outstanding invoices', () => {
  it('names exactly the accounts the registry says have not paid', async () => {
    const { outstanding } = await ledger()

    expect(outstanding.map((row) => row.tenantId).sort()).toEqual(
      Object.keys(MOCK_UNPAID).sort(),
    )
  })

  it('agrees with each account’s own invoice history', async () => {
    // Two views of one ledger. If these ever disagree, one of the two pages is
    // lying to a support engineer about whether somebody owes money.
    for (const row of (await ledger()).outstanding) {
      const detail = await getTenant(row.tenantId)
      if (!detail.ok) throw new Error(detail.code)

      expect(detail.tenant.billing.invoices[0].status).not.toBe('paid')
      expect(detail.tenant.billing.invoices[0].amount).toBe(row.amount)
    }
  })

  it('prices what is owed from the plan the account is on', async () => {
    const list = await listTenants()
    if (!list.ok) throw new Error(list.code)

    for (const row of (await ledger()).outstanding) {
      const account = list.tenants.find((t) => t.id === row.tenantId)
      expect(row.planId).toBe(account?.planId)
      expect(row.amount).toBe(planById(row.planId)?.monthly)
    }
  })

  it('spans the three states the page has to draw differently', async () => {
    const { outstanding } = await ledger()
    const by = (id: string) => outstanding.find((row) => row.tenantId === id)

    // Declined and already suspended: long past due, service cut.
    const castleford = by('ten_castleford')
    expect(castleford?.attempts).toBeGreaterThan(1)
    expect(castleford?.daysPastDue).toBeGreaterThan(14)
    expect(castleford?.suspended).toBe(true)

    // Declined but still inside its terms: recoverable, nothing cut yet.
    const priory = by('ten_priory')
    expect(priory?.attempts).toBeGreaterThan(0)
    expect(priory?.daysPastDue).toBe(0)
    expect(priory?.suspended).toBe(false)

    // Past due having never been attempted. This is the case that makes
    // "failed" and "past due" two questions rather than two words for one.
    const lindqvist = by('ten_lindqvist')
    expect(lindqvist?.attempts).toBe(0)
    expect(lindqvist?.reason).toBeNull()
    expect(lindqvist?.lastAttemptAt).toBeNull()
    expect(lindqvist?.daysPastDue).toBeGreaterThan(0)
  })

  it('gives a decline the processor’s own reason rather than a summary', async () => {
    for (const row of (await ledger()).outstanding) {
      if (row.attempts > 0) {
        expect(row.reason).toBeTypeOf('string')
        expect(row.lastAttemptAt).toBeTypeOf('string')
      }
    }
  })

  it('never reports an invoice inside its terms as negatively past due', async () => {
    for (const row of (await ledger()).outstanding) {
      expect(row.daysPastDue).toBeGreaterThanOrEqual(0)
    }
  })

  it('sorts the most past due first', async () => {
    const days = (await ledger()).outstanding.map((row) => row.daysPastDue)
    expect([...days].sort((a, b) => b - a)).toEqual(days)
  })
})

describe('the plan change log', () => {
  it('reads most recent first', async () => {
    const dates = (await ledger()).changes.map((change) => Date.parse(change.at))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })

  it('covers upgrades, downgrades and cancellations', async () => {
    const { changes } = await ledger()
    const priceOf = (id: string) => planById(id)?.monthly ?? 0

    expect(changes.some((c) => c.toPlanId === null)).toBe(true)
    expect(
      changes.some((c) => c.toPlanId !== null && priceOf(c.toPlanId) > priceOf(c.fromPlanId)),
    ).toBe(true)
    expect(
      changes.some((c) => c.toPlanId !== null && priceOf(c.toPlanId) < priceOf(c.fromPlanId)),
    ).toBe(true)
  })

  it('only names plans the catalogue actually has', async () => {
    const known = PLANS.map((plan) => plan.id)

    for (const change of (await ledger()).changes) {
      expect(known).toContain(change.fromPlanId)
      if (change.toPlanId !== null) expect(known).toContain(change.toPlanId)
    }
  })

  it('agrees with where each account ended up', async () => {
    // A log saying Northgate moved to Estate while the registry has them on
    // Site would make the history fiction on the page that reads both.
    const list = await listTenants()
    if (!list.ok) throw new Error(list.code)

    for (const change of (await ledger()).changes) {
      const account = list.tenants.find((t) => t.id === change.tenantId)
      if (!account) continue

      const later = (await ledger()).changes.filter(
        (other) =>
          other.tenantId === change.tenantId && Date.parse(other.at) > Date.parse(change.at),
      )
      // The most recent change for an account is where it is now.
      if (later.length === 0) expect(account.planId).toBe(change.toPlanId)
    }
  })

  it('carries the name, because a cancelled account has left the registry', async () => {
    const list = await listTenants()
    if (!list.ok) throw new Error(list.code)

    const cancelled = (await ledger()).changes.filter((c) => c.toPlanId === null)
    expect(cancelled.length).toBeGreaterThan(0)

    for (const change of cancelled) {
      expect(change.tenantName.length).toBeGreaterThan(0)
      expect(list.tenants.some((t) => t.id === change.tenantId)).toBe(false)
    }
  })
})

describe('the boundary', () => {
  it('keeps an outstanding invoice to payment state, with nothing to render', async () => {
    expect(Object.keys((await ledger()).outstanding[0]).sort()).toEqual([
      'amount',
      'attempts',
      'daysPastDue',
      'dueAt',
      'lastAttemptAt',
      'planId',
      'reason',
      'suspended',
      'tenantId',
      'tenantName',
    ])
  })

  it('keeps a plan change to plans and a date', async () => {
    expect(Object.keys((await ledger()).changes[0]).sort()).toEqual([
      'at',
      'fromPlanId',
      'id',
      'tenantId',
      'tenantName',
      'toPlanId',
    ])
  })

  it('offers no write of any kind', async () => {
    // Read-only on purpose: no processor is connected, so a retry, refund or
    // write-off would report success having charged nobody.
    const api = await import('@/lib/billing/api')
    expect(Object.keys(api)).toEqual(['getBillingLedger'])
  })
})
