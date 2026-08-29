import { beforeAll, describe, expect, it } from 'vitest'

import { getBillingLedger, type BillingLedger } from '@/lib/billing/api'
import { BILLING_KEY } from '@/lib/billing/queries'
import {
  changeDelta,
  formatDelta,
  PLACEHOLDER_PRICING,
  summariseRevenue,
  upcomingCharges,
} from '@/lib/billing/revenue'
import { formatPrice, planById } from '@/lib/plans'
import { listTenants, type Tenant } from '@/lib/tenants/api'
import { TENANTS_KEY } from '@/lib/tenants/queries'
import AdminBillingPage from '@/pages/admin/billing'
import { NO_GRANTS, renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

let tenants: Tenant[]
let ledger: BillingLedger

beforeAll(async () => {
  const list = await listTenants()
  if (!list.ok) throw new Error(list.code)
  tenants = list.tenants

  const result = await getBillingLedger()
  if (!result.ok) throw new Error(result.code)
  ledger = result.ledger
})

function open() {
  return renderPage(<AdminBillingPage />, {
    seed: (client) => {
      client.setQueryData(TENANTS_KEY, tenants)
      client.setQueryData(BILLING_KEY, ledger)
    },
  })
}

describe('permissions', () => {
  it('refuses an account without the grant', () => {
    // `admin:billing`, the key that already gates this route in `lib/auth/nav.ts`.
    // No new key was invented for this page.
    signIn(NO_GRANTS)
    expect(open().text()).toContain("doesn't hold the grant")
  })
})

describe('recurring revenue', () => {
  it('shows MRR as the registry and the catalogue make it', () => {
    signIn(SUPER_ADMIN)
    const summary = summariseRevenue(tenants)

    expect(open().text()).toContain(formatPrice(summary.mrr))
    expect(summary.mrr).toBeGreaterThan(0)
  })

  it('keeps trials and suspensions out of MRR and says where they went', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('On trial')
    expect(out).toContain('Not revenue until they convert')
    expect(out).toContain('billing this until access was cut')
  })

  it('flags the pricing as placeholder beside the number, not in a footnote', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain(PLACEHOLDER_PRICING)
    expect(out).toContain('lib/plans.ts')
    expect(out).toContain('Read the shape, not the amount, and do not quote it')
  })

  it('breaks revenue down by plan, with the accounts on each', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()
    const summary = summariseRevenue(tenants)

    expect(out).toContain('By plan')
    for (const row of summary.byPlan) {
      expect(out).toContain(row.plan.name)
    }
    // The tier that contributes most, priced.
    const top = [...summary.byPlan].sort((a, b) => b.monthly - a.monthly)[0]
    expect(out).toContain(formatPrice(top.monthly))
  })
})

describe('payment health', () => {
  it('lists a declined charge with the processor’s own reason', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()
    const failed = ledger.outstanding.filter((row) => row.attempts > 0)

    expect(failed.length).toBeGreaterThan(0)
    for (const row of failed) {
      expect(out).toContain(row.tenantName)
      expect(out).toContain(row.reason as string)
    }
  })

  it('says on a declined row when the service is already off', () => {
    // Read on its own, that row must not send somebody to ring a customer
    // about a card while their access is already cut.
    signIn(SUPER_ADMIN)
    const cut = ledger.outstanding.find((row) => row.attempts > 0 && row.suspended)

    expect(cut).toBeDefined()
    expect(open().text()).toContain('· access already cut')
  })

  it('separates being declined from being past due', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Failed payments')
    expect(out).toContain('Past due')
    expect(out).toContain('it can be past due having never been attempted at all')
  })

  it('makes a past-due account that is still running obvious', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    const running = ledger.outstanding.filter((row) => row.daysPastDue > 0 && !row.suspended)
    expect(running.length).toBeGreaterThan(0)

    for (const row of running) {
      expect(out).toContain(row.tenantName)
      expect(out).toContain(`${row.daysPastDue} days`)
    }
    // The state that says a customer is being watched over for free and has
    // probably not noticed.
    expect(out).toContain('Still running')
    expect(out).toContain('Access already cut')
  })

  it('gives support the billing contact, which is a real thing it can do', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    const running = ledger.outstanding.find((row) => row.daysPastDue > 0 && !row.suspended)
    const account = tenants.find((t) => t.id === running?.tenantId)
    expect(view.html()).toContain(`mailto:${account?.adminEmail}`)
  })

  it('offers no control it cannot honour', () => {
    // The staged-rollout refusal, applied to money. No processor is connected,
    // so a retry or a refund would report success having charged nobody.
    signIn(SUPER_ADMIN)
    const view = open()

    for (const label of [/retry/i, /charge now/i, /refund/i, /write off/i, /collect/i]) {
      expect(view.queryAllByRole('button', { name: label })).toHaveLength(0)
    }
    expect(view.text()).toContain('There is nothing to press here')
    expect(view.text()).toContain('would report success having charged nobody')
  })

  it('says what is about to be charged, and what is only a maybe', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()
    const charges = upcomingCharges(tenants, 14)

    expect(charges.length).toBeGreaterThan(0)
    for (const charge of charges) {
      expect(out).toContain(charge.tenantName)
    }
    // A trial's first charge depends on somebody converting, and is not in MRR.
    expect(charges.some((charge) => charge.kind === 'first-charge')).toBe(true)
    expect(out).toContain('First charge, if they convert')
  })
})

describe('the plan change log', () => {
  it('lists what moved, dated, with its effect on MRR', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    for (const change of ledger.changes) {
      expect(out).toContain(change.tenantName)
    }

    const cancellation = ledger.changes.find((change) => change.toPlanId === null)
    const delta = changeDelta(
      cancellation?.fromPlanId as string,
      cancellation?.toPlanId ?? null,
    )
    expect(out).toContain(formatDelta(delta as number))
  })

  it('names the direction each change went', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Upgrade')
    expect(out).toContain('Downgrade')
    expect(out).toContain('Cancelled')
  })

  it('does not link a cancelled account to a record that no longer exists', () => {
    signIn(SUPER_ADMIN)
    const html = open().html()

    const cancelled = ledger.changes.filter((change) => change.toPlanId === null)
    expect(cancelled.length).toBeGreaterThan(0)
    for (const change of cancelled) {
      expect(html).not.toContain(`/admin/tenants/${change.tenantId}`)
    }
  })

  it('is a record and not a control surface', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Nothing in the data model records a plan change')
    expect(out).toContain('the endpoint behind it is not built')
  })
})

describe('the gaps this page is honest about', () => {
  it('refuses to invent coupons, and says why', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('No coupons, discounts or credits')
    expect(out).toContain('there is no discount field, no credit balance and no coupon')
    expect(out).toContain('Rather than invent the data model on screen')
  })

  it('says the pricing is placeholder and where it came from', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Plan pricing is placeholder')
    expect(out).toContain('It has not been signed off commercially')
  })

  it('says no payment processor is connected', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('No payment processor is connected')
    expect(out).toContain('No dunning schedule')
  })
})

describe('the boundary', () => {
  it('states it on the page', () => {
    signIn(SUPER_ADMIN)
    expect(open().text()).toContain(
      'Everything on this page is subscription and payment state',
    )
  })

  it('opens nothing a tenant owns', () => {
    // The standing rule, checked here as well as in `boundary.test.tsx`, which
    // holds it for every admin page at the import level.
    signIn(SUPER_ADMIN)
    const html = open().html()

    for (const route of ['/org/', '/alerts', '/cameras']) {
      expect(html).not.toContain(route)
    }
    for (const control of ['View as', 'Impersonate', 'Sign in as']) {
      expect(html).not.toContain(control)
    }
  })

  it('names accounts only through their platform record', () => {
    signIn(SUPER_ADMIN)
    const html = open().html()

    const known = ledger.outstanding[0]
    expect(html).toContain(`/admin/tenants/${known.tenantId}`)
  })
})

describe('degrading', () => {
  it('shows no MRR at all when the registry is unreachable', () => {
    // A figure counted from an incomplete list is worse than no figure.
    signIn(SUPER_ADMIN)
    const view = renderPage(<AdminBillingPage />, {
      seed: (client) => {
        client.setQueryData(BILLING_KEY, ledger)
      },
    })

    expect(view.text()).not.toContain(formatPrice(summariseRevenue(tenants).mrr))
  })

  it('prices an unknown plan as nothing rather than as free', () => {
    signIn(SUPER_ADMIN)
    const legacy: Tenant[] = [
      ...tenants,
      { ...tenants[0], id: 'ten_legacy', name: 'Legacy Holdings', planId: 'estate-legacy' },
    ]

    const view = renderPage(<AdminBillingPage />, {
      seed: (client) => {
        client.setQueryData(TENANTS_KEY, legacy)
        client.setQueryData(BILLING_KEY, ledger)
      },
    })

    expect(view.text()).toContain('on a plan the catalogue has never heard of')
    // MRR is unchanged: the account is missing from it, not added at zero.
    expect(view.text()).toContain(formatPrice(summariseRevenue(tenants).mrr))
    expect(planById('estate-legacy')).toBeUndefined()
  })
})
