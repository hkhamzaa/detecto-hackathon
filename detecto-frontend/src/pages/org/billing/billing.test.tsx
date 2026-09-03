import { fireEvent } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Camera } from '@/lib/cameras/api'
import { CAMERAS_KEY } from '@/lib/cameras/queries'
import { formatPrice, planById } from '@/lib/plans'
import { getSubscription, type Subscription } from '@/lib/subscription/api'
import { SUBSCRIPTION_KEY } from '@/lib/subscription/queries'
import type { Claims } from '@/lib/auth/claims'
import OrgBillingPage from '@/pages/org/billing'
import { NO_GRANTS, renderPage, signIn } from '@/test/harness'

let base: Subscription

beforeAll(async () => {
  const result = await getSubscription()
  if (!result.ok) throw new Error(result.code)
  base = result.subscription
})

const ORG_ADMIN: Claims = {
  sub: 'usr_admin',
  email: 'admin@northgate.com',
  role: 'org_admin',
  permissions: ['billing:manage'],
  orgId: 'org_northgate',
  exp: Math.floor(Date.now() / 1000) + 900,
}

/** `n` cameras, all in one zone. Only the count matters to this page. */
function cameras(n: number): Camera[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `cam_${index}`,
    name: `Camera ${index + 1}`,
    zone: 'Yard',
    online: true,
    lastSeen: null,
    reviewStatus: 'approved',
    sourceType: 'file',
  }))
}

function open(subscription: Subscription = base, connected = 4) {
  return renderPage(<OrgBillingPage />, {
    seed: (client) => {
      client.setQueryData(SUBSCRIPTION_KEY, subscription)
      client.setQueryData(CAMERAS_KEY, cameras(connected))
    },
  })
}

const SITE = planById('site')

describe('permissions', () => {
  it('refuses an account without the grant', () => {
    signIn(NO_GRANTS)
    expect(open().text()).toContain("You don't have permission to see billing")
  })

  it('matches the key that already gates the route', () => {
    // `billing:manage` — the grant in `lib/auth/nav.ts`, whose own description
    // reads "The plan, invoices, payment method and billing contact".
    signIn(ORG_ADMIN)
    expect(open().text()).not.toContain("You don't have permission")
  })

  it('flags that there is no view-only billing grant', () => {
    // A finance contact who should read invoices without touching the
    // subscription is a real thing to want, and the permission does not exist.
    signIn(ORG_ADMIN)
    expect(open().text()).toContain(
      'Seeing the bill and changing it are the same permission',
    )
  })
})

describe('the current plan', () => {
  it('shows the plan, its price and what it includes', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Site')
    expect(out).toContain(formatPrice(SITE?.monthly as number))
    for (const line of SITE?.includes ?? []) expect(out).toContain(line)
  })

  it('counts cameras actually connected against the plan limit', () => {
    signIn(ORG_ADMIN)
    expect(open(base, 12).text()).toContain(`12 of ${SITE?.maxCameras}`)
  })

  it('flags the pricing as provisional, where the number is', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('This pricing has not been finalised')
    expect(out).toContain('has not been signed off commercially')
  })

  it('leads with an outstanding invoice without scolding anybody', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('One invoice is outstanding')
    expect(out).not.toMatch(/overdue|late|failed to pay/i)
  })

  it('says plainly when the account is suspended', () => {
    signIn(ORG_ADMIN)
    const out = open({ ...base, status: 'suspended' }).text()

    expect(out).toContain('This account is suspended, so your cameras are not being watched')
  })

  it('shows an unrecognised plan as-is rather than guessing at one', () => {
    signIn(ORG_ADMIN)
    const out = open({ ...base, planId: 'estate-legacy' }).text()

    expect(out).toContain('estate-legacy')
    expect(out).toContain('does not have details for')
  })
})

describe('cameras against the plan', () => {
  it('stays quiet when comfortably inside', () => {
    signIn(ORG_ADMIN)
    const out = open(base, 4).text()

    expect(out).toContain('Comfortably inside your plan. Nothing to do here.')
    expect(out).not.toContain('worth knowing if you are planning to add more')
  })

  it('says so once the limit is in sight, as information', () => {
    signIn(ORG_ADMIN)
    // 40 of 48 is past four-fifths.
    const out = open(base, 40).text()

    expect(out).toContain('8 cameras left on Site')
    expect(out).toContain('nothing to act on otherwise')
  })

  it('warns before the next camera rather than after it', () => {
    signIn(ORG_ADMIN)
    const out = open(base, SITE?.maxCameras ?? 48).text()

    expect(out).toContain('the next camera you connect will not fit')
    expect(out).toContain('Nothing is wrong')
  })

  it('says nothing is switched off when over the limit', () => {
    // The reassurance that has to be exact: a plan is not a kill switch.
    signIn(ORG_ADMIN)
    const out = open(base, 52).text()

    expect(out).toContain('52 cameras connected, 48 covered by this plan')
    expect(out).toContain('Nothing has been switched off and nothing will be')
    expect(out).toContain('Detecto does not disconnect one because of a plan')
  })

  it('reads as a new account, not a problem, with nothing connected', () => {
    signIn(ORG_ADMIN)
    const out = open(base, 0).text()

    expect(out).toContain('No cameras connected yet')
    expect(out).not.toContain('left on Site')
  })
})

describe('changing plan', () => {
  it('offers the other plans for this kind of account, and no others', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Team')
    expect(out).toContain('Estate')
    // Home plans belong to the other half of the catalogue.
    expect(out).not.toContain('Home Extended')
  })

  it('says up front that nothing is charged', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain(
      'Nothing is charged and nothing changes when you send this',
    )
  })

  it('does not submit on the first click', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('radio', { name: /Estate/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    expect(view.text()).toContain('Ask to move to Estate?')
    expect(view.text()).not.toContain('Sending…')
  })

  it('states the price difference and that the plan does not change', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('radio', { name: /Estate/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    const difference = (planById('estate')?.monthly ?? 0) - (SITE?.monthly ?? 0)
    expect(view.text()).toContain(`an increase of ${formatPrice(difference)} a month`)
    expect(view.text()).toContain('This does not change your plan, and nothing is charged')
  })

  it('warns when a smaller plan would not cover the cameras they have', () => {
    signIn(ORG_ADMIN)
    const view = open(base, 30)

    // Team covers 16; they have 30 connected.
    expect(view.text()).toContain('You have 30 cameras connected. This plan covers 16.')

    fireEvent.click(view.getByRole('radio', { name: /Team/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))
    expect(view.text()).toContain('nobody will disconnect a camera on your behalf')
  })

  it('can be backed out of', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('radio', { name: /Estate/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))
    fireEvent.click(view.getByRole('button', { name: 'Back' }))

    expect(view.text()).not.toContain('Ask to move to Estate?')
  })

  it('offers no checkout, and no card fields anywhere', () => {
    // The refusal. A working-looking upgrade that moved a plan id with no money
    // moving would be worse than a placeholder.
    signIn(ORG_ADMIN)
    const view = open()

    for (const label of [/upgrade now/i, /pay/i, /checkout/i, /card number/i]) {
      expect(view.queryAllByRole('button', { name: label })).toHaveLength(0)
      expect(view.queryAllByRole('textbox', { name: label })).toHaveLength(0)
    }
  })

  it('shows an outstanding request as not having changed the plan', () => {
    signIn(ORG_ADMIN)
    const out = open({
      ...base,
      pendingChange: {
        planId: 'estate',
        requestedAt: new Date().toISOString(),
        status: 'requested',
      },
    }).text()

    expect(out).toContain('You asked to move to Estate')
    expect(out).toContain('You are still on Site, and nothing has been charged')
    expect(out).toContain('Withdraw the request')
  })
})

describe('invoices', () => {
  it('lists them with amounts and status', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    for (const invoice of base.invoices) expect(out).toContain(invoice.id)
    expect(out).toContain('Paid')
    expect(out).toContain('Due')
  })

  it('says where invoices are sent', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain(base.billingEmail)
  })

  it('offers the list as CSV, and says what it is not', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.getByRole('button', { name: 'Export invoices' })).toBeTruthy()
    expect(view.text()).toContain('it is not a tax document')
    expect(view.text()).toContain('no per-invoice PDF yet')
  })

  it('says nothing has been invoiced rather than showing an empty table', () => {
    signIn(ORG_ADMIN)
    const out = open({ ...base, invoices: [] }).text()

    expect(out).toContain('has not reached the end of its first billing period')
  })
})

describe('payment method', () => {
  it('builds no form, and says why', () => {
    // Collecting a real card number in a browser with no processor behind it is
    // the most dangerous placeholder this product could ship.
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.text()).toContain('There is no card on this account, and no way to add one yet')
    expect(view.text()).toContain("the number never touches Detecto's servers")
    expect(view.queryAllByRole('textbox')).toHaveLength(0)
    expect(view.queryAllByRole('button', { name: /add|update|change card/i })).toHaveLength(0)
  })
})

describe('the gaps this page is honest about', () => {
  it('says there is no payment processing', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('No payment processing, so no charges and no checkout')
    expect(out).toContain('Nothing in Detecto has ever taken a payment')
  })

  it('says the pricing is provisional and where it came from', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('Plan pricing is provisional')
  })

  it('says there are no invoice documents', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('No invoice documents')
  })
})
