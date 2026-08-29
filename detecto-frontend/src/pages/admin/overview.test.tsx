import { beforeAll, describe, expect, it } from 'vitest'

import { getPlatformSummary, type PlatformSummary } from '@/lib/tenants/api'
import { SUMMARY_KEY } from '@/lib/tenants/queries'
import AdminOverviewPage from '@/pages/admin/overview'
import { NO_GRANTS, renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

let summary: PlatformSummary

beforeAll(async () => {
  const result = await getPlatformSummary()
  if (!result.ok) throw new Error(result.code)
  summary = result.summary
})

function open() {
  return renderPage(<AdminOverviewPage />, {
    seed: (client) => client.setQueryData(SUMMARY_KEY, summary),
  })
}

describe('the platform overview', () => {
  it('refuses an account without the grant', () => {
    // The route is gated too. This is the belt-and-braces check, and it is the
    // one that keeps the page correct if the route's gate is ever widened.
    signIn(NO_GRANTS)
    expect(open().text()).toContain("doesn't hold the grant")
  })

  it('shows the tenant total with its breakdown', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Tenants')
    expect(out).toContain(`${summary.tenants.active} active`)
    expect(out).toContain(`${summary.tenants.trial} on trial`)
    expect(out).toContain(`${summary.tenants.suspended} suspended`)
  })

  it('shows cameras and this week’s alert volume against last week', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain(summary.cameras.toLocaleString('en-GB'))
    expect(out).toContain(summary.alertsThisWeek.toLocaleString('en-GB'))
    expect(out).toContain('last week')
  })

  it('names the boxes that have gone silent and why that matters', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('gone silent')
    expect(out).toContain('the customer cannot tell')
  })

  it('links through to system health rather than calling it a follow-up', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    expect(view.html()).toContain('/admin/system-health')
    expect(view.text()).not.toContain('follow-up')
    expect(view.text()).not.toContain('placeholder')
  })

  it('lists recent signups with a plan and a link, and nothing more', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    expect(view.text()).toContain(summary.recentSignups[0].name)
    expect(view.html()).toContain(`/admin/tenants/${summary.recentSignups[0].id}`)
    // No contact details on a signup row — that is account data, and this is a
    // list of who arrived, not a directory.
    expect(view.text()).not.toContain('@')
  })

  it('states the boundary on the page itself', () => {
    signIn(SUPER_ADMIN)
    expect(open().text()).toContain('Nothing on this page is a single detection')
  })
})
