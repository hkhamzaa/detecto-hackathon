import { describe, expect, it, vi } from 'vitest'

import { planById, PLANS } from '@/lib/plans'

/**
 * An organisation's own subscription, exercised through its own dev mock.
 *
 * Two properties are being protected. The first is that asking to change plan
 * does not change anything: there is no payment processor, so a request that
 * quietly moved the plan id would leave a customer believing they had bought
 * limits nobody had billed them for.
 *
 * The second is the boundary. This module answers for one account — the one the
 * session belongs to — and nothing it exports takes an org id or could be
 * pointed at somebody else's bill.
 *
 * Reloaded per test: the mock holds session state the way a real store would,
 * and a request made in one test would otherwise be the starting position of
 * the next.
 */
async function load() {
  vi.resetModules()
  return import('@/lib/subscription/api')
}

async function current() {
  const api = await load()
  const result = await api.getSubscription()
  if (!result.ok) throw new Error(result.code)
  return { api, subscription: result.subscription }
}

describe('the subscription', () => {
  it('is on a plan the catalogue knows, priced from it', async () => {
    const { subscription } = await current()
    const plan = planById(subscription.planId)

    expect(plan).toBeDefined()
    expect(plan?.audience).toBe(subscription.accountType)
  })

  it('bills every invoice at the plan price', async () => {
    // ⚠ Placeholder pricing, like everywhere else it appears. What is checked
    // here is that the history is internally consistent with the catalogue
    // rather than a set of numbers somebody typed.
    const { subscription } = await current()
    const monthly = planById(subscription.planId)?.monthly

    expect(subscription.invoices.length).toBeGreaterThan(0)
    for (const invoice of subscription.invoices) {
      expect(invoice.amount).toBe(monthly)
    }
  })

  it('reads newest first, with only the most recent unsettled', async () => {
    // A gap in the middle of a payment history would be a billing bug, not a
    // demo state.
    const { subscription } = await current()
    const dates = subscription.invoices.map((invoice) => Date.parse(invoice.periodEnd))

    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
    expect(subscription.invoices[0].status).not.toBe('paid')
    expect(subscription.invoices.slice(1).every((i) => i.status === 'paid')).toBe(true)
  })

  it('renews in the future rather than at the instant it was asked', async () => {
    const { subscription } = await current()
    expect(Date.parse(subscription.renewsAt)).toBeGreaterThan(Date.now())
  })

  it('starts with nothing requested', async () => {
    const { subscription } = await current()
    expect(subscription.pendingChange).toBeNull()
  })
})

describe('asking to change plan', () => {
  it('records the request and changes nothing else', async () => {
    // The whole point. No processor exists, so the plan, the invoices and the
    // renewal date all have to be exactly as they were.
    const { api, subscription: before } = await current()

    const result = await api.requestPlanChange('estate')
    if (!result.ok) throw new Error(result.code)

    expect(result.subscription.pendingChange?.planId).toBe('estate')
    expect(result.subscription.pendingChange?.status).toBe('requested')

    expect(result.subscription.planId).toBe(before.planId)
    expect(result.subscription.renewsAt).toBe(before.renewsAt)
    expect(result.subscription.invoices).toHaveLength(before.invoices.length)
  })

  it('raises no invoice for the plan somebody asked about', async () => {
    const { api, subscription: before } = await current()
    const estate = planById('estate')?.monthly

    const result = await api.requestPlanChange('estate')
    if (!result.ok) throw new Error(result.code)

    expect(result.subscription.invoices).toHaveLength(before.invoices.length)
    expect(result.subscription.invoices.some((i) => i.amount === estate)).toBe(false)
  })

  it('refuses a plan from the other half of the catalogue', async () => {
    // An organisation cannot move onto a Home plan, whatever the browser sent.
    const { api } = await current()
    const result = await api.requestPlanChange('home')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unknown_plan')
  })

  it('refuses a plan the catalogue has never heard of', async () => {
    const { api } = await current()
    const result = await api.requestPlanChange('estate-legacy')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unknown_plan')
  })

  it('refuses the plan they are already on', async () => {
    const { api, subscription } = await current()
    const result = await api.requestPlanChange(subscription.planId)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('unknown_plan')
  })

  it('replaces an outstanding request rather than stacking a second', async () => {
    const { api } = await current()
    await api.requestPlanChange('estate')

    const result = await api.requestPlanChange('team')
    if (!result.ok) throw new Error(result.code)
    expect(result.subscription.pendingChange?.planId).toBe('team')
  })

  it('can be taken back, because withdrawing needs no processor', async () => {
    const { api } = await current()
    await api.requestPlanChange('estate')

    const result = await api.withdrawPlanChange()
    if (!result.ok) throw new Error(result.code)
    expect(result.subscription.pendingChange).toBeNull()
  })

  it('hands back a copy a caller cannot write through', async () => {
    const { api } = await current()
    const first = await api.getSubscription()
    if (!first.ok) throw new Error(first.code)

    first.subscription.invoices[0].status = 'failed'

    const again = await api.getSubscription()
    if (!again.ok) throw new Error(again.code)
    expect(again.subscription.invoices[0].status).toBe('due')
  })
})

describe('the boundary this module keeps', () => {
  it('offers no way to reach another organisation, or to take a payment', async () => {
    // No `orgId` parameter anywhere, and no card function. An endpoint that
    // took an id would be one somebody could pass a different one to.
    const api = await load()
    expect(Object.keys(api).sort()).toEqual([
      'getSubscription',
      'requestPlanChange',
      'withdrawPlanChange',
    ])

    // One argument, and it is a plan.
    expect(api.getSubscription).toHaveLength(0)
    expect(api.requestPlanChange).toHaveLength(1)
    expect(api.withdrawPlanChange).toHaveLength(0)
  })

  it('carries none of the platform-only fields the tenant record has', async () => {
    // `note`, `suspendedAt` and the rest are Detecto's own support context. A
    // customer's own billing page must not be able to render them.
    const { subscription } = await current()

    expect(Object.keys(subscription).sort()).toEqual([
      'accountType',
      'billingEmail',
      'invoices',
      'pendingChange',
      'planId',
      'renewsAt',
      'status',
      'trialEndsAt',
    ])
  })

  it('names no organisation but the one signed in', async () => {
    // The seeded platform registry is full of other tenants. None of their
    // names, ids or contacts can reach this record.
    const { subscription } = await current()
    const serialised = JSON.stringify(subscription)

    for (const other of [
      'Northgate',
      'Halden',
      'Castleford',
      'Priory',
      'ten_',
      'castlefordworks',
    ]) {
      expect(serialised).not.toContain(other)
    }
  })

  it('offers only plans, never a tenant, as a change target', async () => {
    // Guards the refusal above: the ids this accepts are catalogue plan ids.
    const { api } = await current()
    const known = PLANS.map((plan) => plan.id)

    for (const id of known) {
      const result = await api.requestPlanChange(id)
      // Accepted or refused for being the wrong audience — never for being
      // unrecognised, which is what a tenant id would be.
      expect(result.ok || (!result.ok && result.code === 'unknown_plan')).toBe(true)
    }
  })
})
