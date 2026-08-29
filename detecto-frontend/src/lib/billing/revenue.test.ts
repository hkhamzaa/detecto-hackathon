import { describe, expect, it } from 'vitest'

import {
  changeDelta,
  changeKind,
  CYCLE_DAYS,
  formatDelta,
  formatShare,
  monthlyFor,
  nextRenewal,
  share,
  summariseRevenue,
  upcomingCharges,
} from '@/lib/billing/revenue'
import { planById, PLANS } from '@/lib/plans'
import { listTenants, type Tenant } from '@/lib/tenants/api'

/**
 * The arithmetic the billing page does in the browser.
 *
 * Exercised against the real registry rather than a fixture, because the whole
 * point of this module is that MRR is derived from the accounts that actually
 * exist. Expectations are computed from the same catalogue the page reads —
 * asserting `$1,848` here would be asserting the placeholder prices, and those
 * are provisional by design.
 */

const DAY = 86_400_000

async function registry(): Promise<Tenant[]> {
  const result = await listTenants()
  if (!result.ok) throw new Error(result.code)
  return result.tenants
}

/** A tenant with only the fields these functions read. */
function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 'ten_test',
    name: 'Test Account',
    planId: 'team',
    accountType: 'org',
    status: 'active',
    cameraCount: 0,
    boxCount: 1,
    userCount: 1,
    createdAt: new Date(Date.now() - 100 * DAY).toISOString(),
    adminEmail: 'test@example.com',
    trialEndsAt: null,
    suspendedAt: null,
    note: '',
    ...over,
  }
}

describe('recurring revenue', () => {
  it('counts only accounts that are actually being billed', async () => {
    const all = await registry()
    const summary = summariseRevenue(all)

    const expected = all
      .filter((t) => t.status === 'active')
      .reduce((sum, t) => sum + (planById(t.planId)?.monthly ?? 0), 0)

    expect(summary.mrr).toBe(expected)
    expect(summary.billing).toBe(all.filter((t) => t.status === 'active').length)
  })

  it('reports trials and suspensions beside MRR rather than inside it', async () => {
    const summary = summariseRevenue(await registry())

    expect(summary.trial.tenants).toBeGreaterThan(0)
    expect(summary.trial.monthly).toBeGreaterThan(0)
    expect(summary.suspended.tenants).toBeGreaterThan(0)
    // The two figures beside MRR are what MRR is deliberately not.
    expect(summary.mrr).toBeLessThan(
      summary.mrr + summary.trial.monthly + summary.suspended.monthly,
    )
  })

  it('breaks MRR down by plan without losing or inventing a dollar', async () => {
    const summary = summariseRevenue(await registry())

    expect(summary.byPlan.reduce((sum, row) => sum + row.monthly, 0)).toBe(summary.mrr)
    expect(summary.byPlan.reduce((sum, row) => sum + row.tenants, 0)).toBe(
      summary.billing,
    )
  })

  it('lists every plan in the catalogue, including the ones nobody is on', () => {
    // A tier with no accounts on it is a fact worth showing, not a row to hide.
    const summary = summariseRevenue([tenant({ planId: 'team' })])

    expect(summary.byPlan).toHaveLength(PLANS.length)
    expect(summary.byPlan.find((row) => row.plan.id === 'estate')?.monthly).toBe(0)
    expect(summary.byPlan.find((row) => row.plan.id === 'team')?.tenants).toBe(1)
  })

  it('leaves an unpriceable account out of MRR instead of counting it as free', () => {
    // `planLabel` shows an unknown plan id as-is for the same reason: a plan
    // this build has never heard of is a record somebody should look at.
    const summary = summariseRevenue([
      tenant({ id: 'ten_a', planId: 'team' }),
      tenant({ id: 'ten_b', planId: 'estate-legacy' }),
    ])

    expect(summary.mrr).toBe(planById('team')?.monthly)
    expect(summary.billing).toBe(1)
    expect(summary.unpriced).toBe(1)
    expect(monthlyFor({ planId: 'estate-legacy' })).toBeNull()
  })

  it('takes no share of nothing', () => {
    expect(share(0, 0)).toBe(0)
    expect(formatShare(share(180, 720))).toBe('25%')
  })
})

describe('upcoming charges', () => {
  it('never puts a renewal in the past', async () => {
    const now = Date.now()
    for (const account of await registry()) {
      const at = nextRenewal(account, now)
      expect(at).not.toBeNull()
      expect(Date.parse(at as string)).toBeGreaterThan(now)
    }
  })

  it('renews on the signup anniversary, one cycle at a time', () => {
    const now = Date.now()
    const account = tenant({ createdAt: new Date(now - 100 * DAY).toISOString() })

    // 100 days in is three whole cycles, so the next one closes at 120.
    const at = Date.parse(nextRenewal(account, now) as string)
    expect(Math.round((at - now) / DAY)).toBe(4 * CYCLE_DAYS - 100)
  })

  it('marks a trial as a first charge, dated to the end of the trial', () => {
    const endsAt = new Date(Date.now() + 5 * DAY).toISOString()
    const charges = upcomingCharges([
      tenant({ status: 'trial', trialEndsAt: endsAt }),
    ])

    expect(charges).toHaveLength(1)
    expect(charges[0].kind).toBe('first-charge')
    expect(charges[0].at).toBe(endsAt)
  })

  it('leaves suspended accounts out entirely', () => {
    // Nothing renews while access is cut.
    expect(
      upcomingCharges([tenant({ status: 'suspended', suspendedAt: new Date().toISOString() })]),
    ).toEqual([])
  })

  it('respects the horizon and sorts soonest first', async () => {
    const all = await registry()
    const now = Date.now()
    const charges = upcomingCharges(all, 14, now)

    expect(charges.length).toBeGreaterThan(0)
    for (const charge of charges) {
      const at = Date.parse(charge.at)
      expect(at).toBeGreaterThanOrEqual(now)
      expect(at).toBeLessThanOrEqual(now + 14 * DAY)
    }

    const dates = charges.map((charge) => Date.parse(charge.at))
    expect([...dates].sort((a, b) => a - b)).toEqual(dates)
  })

  it('shows no amount for a plan the catalogue cannot price', () => {
    const charges = upcomingCharges([tenant({ planId: 'estate-legacy' }), tenant()], 60)
    expect(charges.find((c) => c.planId === 'estate-legacy')?.amount).toBeNull()
  })
})

describe('plan changes', () => {
  it('reads the direction off the catalogue', () => {
    expect(changeKind('site', 'estate')).toBe('upgrade')
    expect(changeKind('estate', 'site')).toBe('downgrade')
    expect(changeKind('team', null)).toBe('cancellation')
  })

  it('refuses to guess a direction it cannot work out', () => {
    // An unknown plan id renders as a plain change rather than a made-up arrow.
    expect(changeKind('estate-legacy', 'estate')).toBeNull()
    expect(changeKind('team', 'team')).toBeNull()
  })

  it('prices what a change did to MRR, and a cancellation as the whole plan', () => {
    const site = planById('site')?.monthly as number
    const estate = planById('estate')?.monthly as number

    expect(changeDelta('site', 'estate')).toBe(estate - site)
    expect(changeDelta('estate', 'site')).toBe(site - estate)
    expect(changeDelta('site', null)).toBe(-site)
    expect(changeDelta('estate-legacy', 'site')).toBeNull()
  })

  it('signs the amount so a downgrade cannot read as a gain', () => {
    expect(formatDelta(540)).toBe('+$540')
    expect(formatDelta(-540)).toBe('-$540')
  })
})
