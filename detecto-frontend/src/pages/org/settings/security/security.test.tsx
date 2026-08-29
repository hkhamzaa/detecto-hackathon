import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Claims } from '@/lib/auth/claims'
import { MIN_PASSWORD } from '@/lib/forms'
import { IDLE_TIMEOUTS, type OrgSettings } from '@/lib/org/api'
import { ORG_SETTINGS_KEY } from '@/lib/org/queries'
import { ALL_PERMISSION_KEYS } from '@/lib/roles/permissions'
import OrgSecurityPage from '@/pages/org/settings/security'
import { NO_GRANTS, renderPage, signIn } from '@/test/harness'

const ORG_ADMIN: Claims = {
  sub: 'usr_admin',
  email: 'admin@northgate.com',
  role: 'org_admin',
  permissions: ALL_PERMISSION_KEYS,
  orgId: 'org_northgate',
  exp: Math.floor(Date.now() / 1000) + 900,
}

const SETTINGS: OrgSettings = {
  profile: {
    name: 'Northgate Logistics',
    type: 'Warehouse',
    contactEmail: 'security@northgate.com',
    contactPhone: '020 7946 0100',
  },
  security: { idleTimeoutMinutes: 15 },
}

function open(settings: OrgSettings = SETTINGS) {
  return renderPage(<OrgSecurityPage />, {
    seed: (client) => client.setQueryData(ORG_SETTINGS_KEY, settings),
  })
}

describe('the idle timeout', () => {
  it('offers three choices and no freeform field', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(IDLE_TIMEOUTS).toEqual([15, 30, 60])
    for (const minutes of IDLE_TIMEOUTS) {
      expect(view.getByRole('radio', { name: `${minutes} minutes` })).toBeTruthy()
    }
    expect(view.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(view.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('leads with the fact that nothing enforces it', () => {
    // Above the control, not underneath: somebody who sets this and walks away
    // believing sessions now expire has been misled by the page.
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Detecto does not enforce this yet')
    expect(out).toContain('nothing in the browser tracks whether you have gone idle')
  })

  it('says why a browser-side timer would not be the answer', () => {
    // The specific trap: signing this tab out leaves the token valid, which
    // looks like a control and is not one.
    signIn(ORG_ADMIN)
    expect(open().text()).toContain(
      'signing this tab out leaves the token valid on the server',
    )
  })

  it('will not save until the choice has changed', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(
      (view.getByRole('button', { name: 'Save timeout' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(view.getByRole('radio', { name: '60 minutes' }))
    expect(
      (view.getByRole('button', { name: 'Save timeout' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})

describe('the password policy', () => {
  it('reports the one rule that actually exists', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Detecto has one password rule')
    expect(out).toContain(String(MIN_PASSWORD))
  })

  it('lists what is not enforced rather than offering switches for it', () => {
    // The refusal: there is no password-policy record for these to be stored
    // in, so the page reports the rule that exists instead of inventing options.
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.text()).toContain('Not enforced, and not configurable')
    expect(view.text()).toContain('No complexity requirement')
    expect(view.text()).toContain('No check against known breached passwords')
    expect(view.text()).toContain('there is no password policy record in Detecto')

    // And no controls for any of it.
    for (const invented of [/complexity/i, /expiry/i, /rotation/i, /reuse/i]) {
      expect(view.queryAllByRole('checkbox', { name: invented })).toHaveLength(0)
      expect(view.queryAllByRole('switch', { name: invented })).toHaveLength(0)
    }
  })
})

describe('the MFA seam', () => {
  it('is visible, switched off, and cannot be moved', () => {
    // Rendered the way a coming-soon detection module is: shown in full,
    // disabled, marked, and not styled as broken.
    signIn(ORG_ADMIN)
    const view = open()

    const toggle = view.getByRole('switch', { name: /Require a second factor/ })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    expect((toggle as HTMLInputElement).disabled).toBe(true)
    expect(view.text()).toContain('Coming soon')
  })

  it('says why turning it on would be dangerous rather than just unfinished', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('no enrolment, no recovery codes')
    expect(out).toContain('lock an organisation out of its own cameras')
  })

  it('is not hidden, because customers ask for it', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('Multi-factor authentication')
  })
})

describe('the gaps this page is honest about', () => {
  it('says the timeout is stored and not applied', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('The timeout is stored, not applied')
  })

  it('says there is no session list and no way to sign other devices out', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('No session list, and no way to sign other devices out')
    expect(out).toContain('including after a password change')
  })

  it('says single sign-on is not built', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('No single sign-on')
  })
})

describe('permissions', () => {
  it('shows the settings read-only to somebody without the grant', () => {
    signIn(NO_GRANTS)
    const view = open()

    expect(view.text()).toContain("You don't have permission to change this")
    expect(view.queryByRole('button', { name: 'Save timeout' })).toBeNull()
  })
})
