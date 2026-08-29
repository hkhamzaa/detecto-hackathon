import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Claims } from '@/lib/auth/claims'
import type { OrgSettings } from '@/lib/org/api'
import { ORG_SETTINGS_KEY } from '@/lib/org/queries'
import { validateOrgIdentity, validateOrgProfile } from '@/lib/org/profile'
import { ALL_PERMISSION_KEYS } from '@/lib/roles/permissions'
import OrgProfilePage from '@/pages/org/settings/profile'
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
  return renderPage(<OrgProfilePage />, {
    seed: (client) => client.setQueryData(ORG_SETTINGS_KEY, settings),
  })
}

describe('the shared validation', () => {
  it('is the same rules the signup step applies to the same two fields', () => {
    // Asking one question in two places is fine; answering it two different
    // ways is how they come to disagree.
    expect(validateOrgIdentity({ name: '', type: 'Warehouse' }).name).toBeTruthy()
    expect(validateOrgIdentity({ name: 'Northgate', type: '' }).type).toBeTruthy()
    expect(validateOrgIdentity({ name: 'Northgate', type: 'Warehouse' })).toEqual({})
  })

  it('adds contact rules the settings page needs and signup does not ask for', () => {
    const issues = validateOrgProfile({
      name: 'Northgate',
      type: 'Warehouse',
      contactEmail: 'not-an-email',
      contactPhone: '12',
    })

    expect(issues.contactEmail).toBeTruthy()
    expect(issues.contactPhone).toBeTruthy()
    // The identity half is still checked by the same function.
    expect(issues.name).toBeUndefined()
  })
})

describe('the form', () => {
  it('shows what is stored', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect((view.getByLabelText('Organisation name') as HTMLInputElement).value).toBe(
      'Northgate Logistics',
    )
    expect((view.getByLabelText('Contact email') as HTMLInputElement).value).toBe(
      'security@northgate.com',
    )
  })

  it('offers only the organisation types the catalogue knows', () => {
    signIn(ORG_ADMIN)
    const view = open()

    const options = [
      ...view.getByLabelText('What kind of site is it?').querySelectorAll('option'),
    ].map((option) => option.textContent)

    expect(options).toContain('Warehouse')
    expect(options).toContain('Other')
  })

  it('will not save until something has changed', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(
      (view.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.change(view.getByLabelText('Organisation name'), {
      target: { value: 'Northgate Logistics Ltd' },
    })
    expect(
      (view.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('refuses an email that is not one, rather than sending it', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.change(view.getByLabelText('Contact email'), {
      target: { value: 'nope' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))

    expect(view.text()).toContain('This needs an @ and a domain')
  })

  it('can be discarded back to what is stored', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.change(view.getByLabelText('Organisation name'), {
      target: { value: 'Something else' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Discard changes' }))

    expect((view.getByLabelText('Organisation name') as HTMLInputElement).value).toBe(
      'Northgate Logistics',
    )
  })
})

describe('the weight of the action', () => {
  it('saves plainly, with no confirm step', () => {
    /*
     * Deliberate. The product spends confirm steps on changes that take
     * something away from somebody who is not in the room. Renaming an
     * organisation changes a label — visible, reversible, and costing nobody
     * any access. A confirm here would make the ones that matter cheaper.
     */
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.change(view.getByLabelText('Organisation name'), {
      target: { value: 'Northgate Logistics Ltd' },
    })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))

    expect(view.text()).not.toMatch(/are you sure|review the change/i)
  })
})

describe('what this page is not', () => {
  it('says the billing contact is set somewhere else', () => {
    // Two contact addresses on one account is confusing unless the difference
    // is stated where somebody would otherwise assume they are the same.
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('that is the billing contact on your billing page')
  })

  it('says contacts are stored and never dialled', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Stored, not dialled')
    expect(out).toContain('an emergency service is reached by a person')
  })
})

describe('permissions', () => {
  it('shows the profile read-only to somebody without the grant', () => {
    // `org:settings`, matching the notification settings beside it.
    signIn(NO_GRANTS)
    const view = open()

    expect(view.text()).toContain("You don't have permission to change your organisation's settings")
    expect(view.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('offers the form to an administrator', () => {
    signIn(ORG_ADMIN)
    expect(open().getByRole('button', { name: 'Save changes' })).toBeTruthy()
  })
})
