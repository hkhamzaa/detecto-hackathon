import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Account } from '@/lib/account/api'
import { ACCOUNT_KEY } from '@/lib/account/queries'
import type { Claims } from '@/lib/auth/claims'
import { MIN_PASSWORD } from '@/lib/forms'
import AccountPage from '@/pages/account'
import { NO_GRANTS, renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

const ACCOUNT: Account = {
  id: 'usr_member',
  name: 'Rhea Mehta',
  email: 'rhea.mehta@northgate.com',
}

const ORG_ADMIN: Claims = {
  sub: 'usr_admin',
  email: 'admin@northgate.com',
  role: 'org_admin',
  permissions: ['org:settings'],
  orgId: 'org_northgate',
  exp: Math.floor(Date.now() / 1000) + 900,
}

const MEMBER: Claims = {
  sub: 'usr_member',
  email: 'rhea.mehta@northgate.com',
  role: 'member',
  permissions: ['alerts:view'],
  orgId: 'org_northgate',
  exp: Math.floor(Date.now() / 1000) + 900,
}

function open(account: Account = ACCOUNT) {
  return renderPage(<AccountPage />, {
    seed: (client) => client.setQueryData(ACCOUNT_KEY, account),
  })
}

describe('who can open it', () => {
  it('has no permission gate at all', () => {
    /*
     * The one authenticated page with no `can()` on it. Everybody signed in has
     * an account — including somebody holding no grants who lands on
     * `/no-access` — and changing your own name should not need an
     * administrator.
     */
    signIn(NO_GRANTS)
    const view = open()

    expect(view.text()).not.toContain("don't have permission")
    expect(view.getByLabelText('Name')).toBeTruthy()
  })

  it('opens for a member, an org admin and a super admin alike', () => {
    // Cleaned up between renders: the harness unmounts per test, not per loop,
    // and Testing Library's queries search the whole document rather than one
    // container — so two mounted copies would collide on every lookup.
    for (const claims of [MEMBER, ORG_ADMIN, SUPER_ADMIN]) {
      signIn(claims)
      const view = open()
      expect(view.getByRole('button', { name: 'Change password' })).toBeTruthy()
      cleanup()
    }
  })
})

describe('your own details', () => {
  it('shows what is stored', () => {
    signIn(MEMBER)
    const view = open()

    expect((view.getByLabelText('Name') as HTMLInputElement).value).toBe('Rhea Mehta')
    expect((view.getByLabelText('Email') as HTMLInputElement).value).toBe(
      'rhea.mehta@northgate.com',
    )
  })

  it('will not save until something has changed', () => {
    signIn(MEMBER)
    const view = open()

    expect(
      (view.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Rhea M' } })
    expect(
      (view.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('refuses an email that is not one', () => {
    signIn(MEMBER)
    const view = open()

    fireEvent.change(view.getByLabelText('Email'), { target: { value: 'nope' } })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))

    expect(view.text()).toContain('This needs an @ and a domain')
  })
})

describe('changing your own password', () => {
  it('asks for the current one, and says why', () => {
    signIn(MEMBER)
    const view = open()

    expect(view.getByLabelText('Current password')).toBeTruthy()
    expect(view.text()).toContain(
      'knowing it is what proves this is you and not somebody who found the screen unlocked',
    )
  })

  it('asks for the new one twice, because there is no way back from a typo', () => {
    signIn(MEMBER)
    const view = open()

    fireEvent.change(view.getByLabelText('Current password'), {
      target: { value: 'detecto-demo' },
    })
    fireEvent.change(view.getByLabelText('New password'), {
      target: { value: 'a-long-enough-one' },
    })
    fireEvent.change(view.getByLabelText('New password again'), {
      target: { value: 'a-long-enough-typo' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Change password' }))

    expect(view.text()).toContain("This doesn't match the new password")
  })

  it('applies the same length rule the rest of the product states', () => {
    signIn(MEMBER)
    const view = open()

    fireEvent.change(view.getByLabelText('Current password'), {
      target: { value: 'detecto-demo' },
    })
    fireEvent.change(view.getByLabelText('New password'), { target: { value: 'short' } })
    fireEvent.click(view.getByRole('button', { name: 'Change password' }))

    expect(view.text()).toContain(`Use at least ${MIN_PASSWORD} characters`)
  })

  it('refuses a new password that is the current one', () => {
    signIn(MEMBER)
    const view = open()

    fireEvent.change(view.getByLabelText('Current password'), {
      target: { value: 'detecto-demo-long' },
    })
    fireEvent.change(view.getByLabelText('New password'), {
      target: { value: 'detecto-demo-long' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Change password' }))

    expect(view.text()).toContain('That is your current password')
  })

  it('says the current password was wrong without saying which field was right', async () => {
    signIn(MEMBER)
    const view = open()

    fireEvent.change(view.getByLabelText('Current password'), {
      target: { value: 'not-the-password' },
    })
    fireEvent.change(view.getByLabelText('New password'), {
      target: { value: 'a-long-enough-one' },
    })
    fireEvent.change(view.getByLabelText('New password again'), {
      target: { value: 'a-long-enough-one' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(view.text()).toContain('That is not your current password')
    })
    expect(view.text()).toContain('Nothing has been changed')
  })

  it('is not the forgot-password flow, and does not claim to be', () => {
    // That one proves you own an inbox; this one proves you know the password.
    signIn(MEMBER)
    expect(open().text()).not.toMatch(/reset link|check your email/i)
  })
})

describe('your access, read-only', () => {
  it('shows the role and says it is not changed here', () => {
    // Somebody widening their own access from their own settings page would
    // make every role in the product advisory.
    signIn(MEMBER)
    const out = open().text()

    expect(out).toContain('Member')
    expect(out).toContain('a page where somebody could grant themselves more')
    expect(out).toContain('sign out and back in to pick it up')
  })

  it('offers no control over it', () => {
    signIn(MEMBER)
    const view = open()

    expect(view.queryAllByRole('combobox')).toHaveLength(0)
    expect(view.queryAllByRole('button', { name: /role|permission/i })).toHaveLength(0)
  })
})

describe('the gaps this page is honest about', () => {
  it('states the same channel-preference gap the notification settings found', () => {
    signIn(MEMBER)
    const out = open().text()

    expect(out).toContain('No notification preferences of your own')
    expect(out).toContain('no channel preference, no consent record and no telephone number')
  })

  it('offers no channel control, having said there is nowhere to store one', () => {
    signIn(MEMBER)
    const view = open()

    for (const invented of [/email/i, /sms/i, /push/i]) {
      expect(view.queryAllByRole('switch', { name: invented })).toHaveLength(0)
      expect(view.queryAllByRole('checkbox', { name: invented })).toHaveLength(0)
    }
  })

  it('says there is no second factor to enrol and no session list', () => {
    signIn(MEMBER)
    const out = open().text()

    expect(out).toContain('No second factor to enrol')
    expect(out).toContain('No list of where you are signed in')
  })

  it('says why closing your own account is not offered', () => {
    signIn(MEMBER)
    expect(open().text()).toContain(
      "which is your organisation's audit trail rather than yours to remove",
    )
  })
})
