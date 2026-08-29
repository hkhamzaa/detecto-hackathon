import { describe, expect, it } from 'vitest'

import {
  getPlatformSummary,
  getTenant,
  listTenants,
  setTenantNote,
  setTenantStatus,
} from '@/lib/tenants/api'

/**
 * The tenant registry, exercised through its own dev mock.
 *
 * Two things are being protected. The first is that the seed data still spans
 * every state both pages have to draw — a demo that quietly lost its suspended
 * account would leave a whole branch untested and unlooked-at. The second is
 * the boundary: `Tenant` must stay a record of counts, because the moment it
 * grows a collection of anything, a component will render it.
 */

/** Unwraps a result, failing the test with the transport's own code. */
async function tenants() {
  const result = await listTenants()
  if (!result.ok) throw new Error(result.code)
  return result.tenants
}

describe('the seeded platform', () => {
  it('spans every account state both pages have to draw', async () => {
    const all = await tenants()

    expect(all.length).toBeGreaterThanOrEqual(6)
    expect([...new Set(all.map((t) => t.status))].sort()).toEqual([
      'active',
      'suspended',
      'trial',
    ])
  })

  it('spans plan tiers on both audiences', async () => {
    const all = await tenants()

    expect([...new Set(all.map((t) => t.accountType))].sort()).toEqual(['home', 'org'])
    expect(new Set(all.map((t) => t.planId)).size).toBeGreaterThanOrEqual(4)
  })

  it('includes an account that has connected no cameras', async () => {
    // The "nothing being watched" branch on the tenant detail page.
    expect((await tenants()).some((t) => t.cameraCount === 0)).toBe(true)
  })

  it('keeps Tenant a record of counts, with no collection to render', async () => {
    expect(Object.keys((await tenants())[0]).sort()).toEqual([
      'accountType',
      'adminEmail',
      'boxCount',
      'cameraCount',
      'createdAt',
      'id',
      'name',
      'note',
      'planId',
      'status',
      'suspendedAt',
      'trialEndsAt',
      'userCount',
    ])
  })
})

describe('getPlatformSummary', () => {
  it('breaks the tenant count down without losing anybody', async () => {
    const result = await getPlatformSummary()
    if (!result.ok) throw new Error(result.code)

    const { tenants } = result.summary
    expect(tenants.active + tenants.trial + tenants.suspended).toBe(tenants.total)
  })

  it('sums cameras from the registry rather than asserting a figure', async () => {
    const summary = await getPlatformSummary()
    if (!summary.ok) throw new Error(summary.code)

    expect(summary.summary.cameras).toBe(
      (await tenants()).reduce((sum, t) => sum + t.cameraCount, 0),
    )
  })

  it('reports alert volume as a scalar and nothing more', async () => {
    // The boundary. A count derived by fetching the records behind it would put
    // a tenant's detections in a super admin's browser.
    const result = await getPlatformSummary()
    if (!result.ok) throw new Error(result.code)
    expect(typeof result.summary.alertsThisWeek).toBe('number')
  })

  it('lists recent signups newest first, with no contact details on them', async () => {
    const result = await getPlatformSummary()
    if (!result.ok) throw new Error(result.code)

    const signups = result.summary.recentSignups
    expect(Object.keys(signups[0]).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'planId',
      'status',
    ])

    const dates = signups.map((s) => Date.parse(s.createdAt))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })
})

describe('getTenant', () => {
  it('returns billing history with only the most recent invoice outstanding', async () => {
    // A gap in the middle of a payment history would be a billing bug, not a
    // demo state.
    const result = await getTenant('ten_castleford')
    if (!result.ok) throw new Error(result.code)

    expect(result.tenant.billing.invoices[0].status).toBe('failed')
    expect(
      result.tenant.billing.invoices.slice(1).every((i) => i.status === 'paid'),
    ).toBe(true)
  })

  it('never invoices an account for a period before it existed', async () => {
    const result = await getTenant('ten_barrow')
    if (!result.ok) throw new Error(result.code)
    expect(result.tenant.billing.invoices).toHaveLength(0)
  })

  it('distinguishes an unknown id from an unreachable service', async () => {
    const result = await getTenant('ten_nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_found')
  })
})

describe('suspending and restoring', () => {
  it('moves the platform counts with the account', async () => {
    const before = await getPlatformSummary()
    if (!before.ok) throw new Error(before.code)

    const suspended = await setTenantStatus('ten_priory', 'suspended')
    if (!suspended.ok) throw new Error(suspended.code)
    expect(suspended.tenant.status).toBe('suspended')
    // The timestamp is the platform's to set: it is the record of when access
    // was actually cut, and support will be asked.
    expect(typeof suspended.tenant.suspendedAt).toBe('string')

    const after = await getPlatformSummary()
    if (!after.ok) throw new Error(after.code)
    expect(after.summary.tenants.suspended).toBe(before.summary.tenants.suspended + 1)
    expect(after.summary.tenants.active).toBe(before.summary.tenants.active - 1)
    // A suspended account's boxes stop being counted as reporting, because
    // suspension is what stops them syncing.
    expect(after.summary.health.boxesReporting).toBe(
      before.summary.health.boxesReporting - 1,
    )

    const restored = await setTenantStatus('ten_priory', 'active')
    if (!restored.ok) throw new Error(restored.code)
    expect(restored.tenant.status).toBe('active')
    expect(restored.tenant.suspendedAt).toBeNull()
  })

  it('saves a support note without disturbing anything else', async () => {
    const result = await setTenantNote('ten_halden', 'Called 2 Mar, all good.')
    if (!result.ok) throw new Error(result.code)

    expect(result.tenant.note).toBe('Called 2 Mar, all good.')
    expect(result.tenant.status).toBe('active')
  })
})
