import { waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTenant, listTenants, type Tenant, type TenantDetail } from '@/lib/tenants/api'
import { TENANTS_KEY, tenantKey } from '@/lib/tenants/queries'
import AdminTenantDetailPage from '@/pages/admin/tenants/detail'
import AdminTenantsPage from '@/pages/admin/tenants'
import { NO_GRANTS, renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

let tenants: Tenant[]
let castleford: TenantDetail

beforeAll(async () => {
  const list = await listTenants()
  if (!list.ok) throw new Error(list.code)
  tenants = list.tenants

  const one = await getTenant('ten_castleford')
  if (!one.ok) throw new Error(one.code)
  castleford = one.tenant
})

function openList(path = '/') {
  return renderPage(<AdminTenantsPage />, {
    path,
    seed: (client) => client.setQueryData(TENANTS_KEY, tenants),
  })
}

function openDetail(id = 'ten_castleford', detail = castleford) {
  return renderPage(<AdminTenantDetailPage />, {
    path: `/admin/tenants/${id}`,
    route: '/admin/tenants/:id',
    seed: (client) => client.setQueryData(tenantKey(id), detail),
  })
}

describe('the tenant list', () => {
  it('refuses an account without the grant', () => {
    signIn(NO_GRANTS)
    expect(openList().text()).toContain("doesn't hold the grant")
  })

  it('shows plan, camera count against the ceiling, status and contact', () => {
    signIn(SUPER_ADMIN)
    const out = openList().text()

    expect(out).toContain('Northgate Logistics')
    expect(out).toContain('Estate')
    expect(out).toContain('/ 120')
    expect(out).toContain('security@haldenretail.com')
  })

  it('flags a trial about to run out, and leaves a comfortable one alone', () => {
    // Colour only where somebody needs to act this week.
    signIn(SUPER_ADMIN)
    const out = openList().text()

    expect(out).toContain('Trial ends in 2 days')
    expect(out).not.toContain('Trial ends in 7 days')
  })

  it('filters by status from the URL', () => {
    signIn(SUPER_ADMIN)
    const out = openList('/?status=suspended').text()

    expect(out).toContain('Castleford Works')
    expect(out).not.toContain('Northgate Logistics')
  })

  it('searches by name', () => {
    signIn(SUPER_ADMIN)
    const out = openList('/?q=residence').text()

    expect(out).toContain('Okonjo Residence')
    expect(out).not.toContain('Priory Park School')
  })

  it('searches by account contact, which is what support has in front of them', () => {
    signIn(SUPER_ADMIN)
    expect(openList('/?q=haldenretail').text()).toContain('Halden Retail Group')
  })

  it('offers a way back out when nothing matches', () => {
    signIn(SUPER_ADMIN)
    const out = openList('/?q=zzzz').text()

    expect(out).toContain('No account matches that')
    expect(out).toContain('Clear filters')
  })
})

describe('one tenant, opened', () => {
  it('refuses an account without the grant', () => {
    signIn(NO_GRANTS)
    expect(openDetail().text()).toContain("doesn't hold the grant")
  })

  it('shows the account and what it is billed', () => {
    signIn(SUPER_ADMIN)
    const out = openDetail().text()

    expect(out).toContain('Castleford Works')
    expect(out).toContain('$420')
    expect(out).toContain('ops@castlefordworks.co.uk')
    expect(out).toContain('INV-')
    expect(out).toContain('Failed')
  })

  it('shows the internal support note and says who can see it', () => {
    signIn(SUPER_ADMIN)
    const out = openDetail().text()

    expect(out).toContain('three failed payments')
    expect(out).toContain('Detecto staff only')
    // Staff-only is not the same as private — a customer can ask what we hold.
    expect(out).toContain('hand over if they ever asked')
  })

  it('offers restore, not suspend, for an account already suspended', () => {
    signIn(SUPER_ADMIN)
    const out = openDetail().text()

    expect(out).toContain('Restore access')
    expect(out).not.toContain('Suspend this account')
    expect(out).toContain('not syncing while suspended')
  })

  it('offers suspend for a running account, and spells out what it does', async () => {
    signIn(SUPER_ADMIN)
    const one = await getTenant('ten_northgate')
    if (!one.ok) throw new Error(one.code)

    const out = openDetail('ten_northgate', one.tenant).text()
    expect(out).toContain('Suspend this account')
    expect(out).not.toContain('Restore access')
  })

  it('says plainly there is no way into the tenant’s own data from here', () => {
    signIn(SUPER_ADMIN)
    expect(openDetail().text()).toContain('It is not a way into their cameras')
  })

  it('says there is no such tenant rather than showing an empty account', async () => {
    // Not seeded: this one goes through the real transport so the `not_found`
    // branch is exercised end to end, error code and all.
    signIn(SUPER_ADMIN)
    const view = renderPage(<AdminTenantDetailPage />, {
      path: '/admin/tenants/ten_nope',
      route: '/admin/tenants/:id',
    })

    await waitFor(() => {
      expect(view.text()).toContain('No such tenant')
    })
    expect(view.text()).not.toContain('Try again')
  })
})
