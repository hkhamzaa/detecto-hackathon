import { fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { listModuleFlags, type ModuleFlag } from '@/lib/module-flags/api'
import { MODULE_FLAGS_KEY } from '@/lib/module-flags/queries'
import { listTenants, type Tenant } from '@/lib/tenants/api'
import { TENANTS_KEY } from '@/lib/tenants/queries'
import AdminModuleFlagsPage from '@/pages/admin/module-flags'
import { NO_GRANTS, renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

let modules: ModuleFlag[]
let tenants: Tenant[]

beforeAll(async () => {
  const flags = await listModuleFlags()
  if (!flags.ok) throw new Error(flags.code)
  modules = flags.modules

  const list = await listTenants()
  if (!list.ok) throw new Error(list.code)
  tenants = list.tenants
})

function open() {
  return renderPage(<AdminModuleFlagsPage />, {
    seed: (client) => {
      client.setQueryData(MODULE_FLAGS_KEY, modules)
      client.setQueryData(TENANTS_KEY, tenants)
    },
  })
}

describe('permissions', () => {
  it('refuses an account without the grant', () => {
    // `admin:modules`, the key that already gates this route. No new key.
    signIn(NO_GRANTS)
    expect(open().text()).toContain("doesn't hold the grant")
  })
})

describe('the registry', () => {
  it('lists every module, live and not', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Weapon detection')
    expect(out).toContain('Violence detection')
    expect(out).toContain('Loitering')
    expect(out).toContain('Forced movement')
  })

  it('says which are live and which are still coming', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Live')
    expect(out).toContain('Coming soon')
  })

  it('names the plans each module is included in', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Included in')
    expect(out).toContain('Estate')
    expect(out).toContain('Team')
  })

  it('offers the measured rate for a live module only', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    // One field per live module, and there are two live in the seed.
    expect(view.getAllByLabelText('Measured false positive rate')).toHaveLength(2)
    expect(view.text()).toContain('It is a measurement, not a target')
  })

  it('explains why a module that has never run has no rate', () => {
    signIn(SUPER_ADMIN)
    expect(open().text()).toContain('a plausible-looking one would be a fabrication')
  })
})

describe('releasing a module', () => {
  it('does not release on a single click', () => {
    // The confirm step exists because this changes what a great many people are
    // offered. Opening it must not be the same as agreeing to it.
    signIn(SUPER_ADMIN)
    const view = open()

    fireEvent.click(view.getAllByRole('button', { name: 'Release' })[0])
    expect(view.text()).toContain('Release Loitering?')
    expect(view.text()).not.toContain('Releasing…')
  })

  it('states the blast radius as a number', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    fireEvent.click(view.getAllByRole('button', { name: 'Release' })[0])

    const loitering = modules.find((m) => m.id === 'loitering') as ModuleFlag
    const affected = tenants.filter(
      (t) => loitering.planIds.includes(t.planId) && t.status !== 'suspended',
    ).length

    expect(view.text()).toContain(
      `${affected} organisations on plans that include this module will be able to enable it immediately`,
    )
  })

  it('says that nothing turns itself on', () => {
    // The most important line in the dialogue: releasing offers a module, it
    // does not start watching anybody with it.
    signIn(SUPER_ADMIN)
    const view = open()

    fireEvent.click(view.getAllByRole('button', { name: 'Release' })[0])
    expect(view.text()).toContain('Nothing turns itself on')
    expect(view.text()).toContain('Detecto does not announce it')
  })

  it('counts suspended accounts separately, since nothing changes for them', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    fireEvent.click(view.getAllByRole('button', { name: 'Release' })[0])
    expect(view.text()).toContain('suspended, so nothing changes for')
  })

  it('can be backed out of', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    fireEvent.click(view.getAllByRole('button', { name: 'Release' })[0])
    fireEvent.click(view.getByRole('button', { name: 'Not yet' }))
    expect(view.text()).not.toContain('Release Loitering?')
  })

  it('warns rather than releasing a module no plan includes', async () => {
    signIn(SUPER_ADMIN)
    const orphan = modules.map((m) =>
      m.id === 'loitering' ? { ...m, planIds: [] } : m,
    )

    const view = renderPage(<AdminModuleFlagsPage />, {
      seed: (client) => {
        client.setQueryData(MODULE_FLAGS_KEY, orphan)
        client.setQueryData(TENANTS_KEY, tenants)
      },
    })

    fireEvent.click(view.getAllByRole('button', { name: 'Release' })[0])
    expect(view.text()).toContain('releasing it would offer it to nobody')

    await waitFor(() => {
      const confirm = view.getByRole('button', { name: /Release to/ }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
    })
  })
})

describe('withdrawing a module', () => {
  it('offers withdraw for a live module, and says what it costs', () => {
    signIn(SUPER_ADMIN)
    const view = open()

    fireEvent.click(view.getAllByRole('button', { name: 'Withdraw' })[0])
    expect(view.text()).toContain('Withdraw Weapon detection?')
    expect(view.text()).toContain('stops being watched for it')
    // Withdrawing a module never rewrites a human decision.
    expect(view.text()).toContain('Detections a person already confirmed are untouched')
  })
})

describe('the gaps this page is honest about', () => {
  it('says the plan tiers are not yet enforced org-side', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('Plan tiers are authored here, not yet enforced')
    expect(out).toContain('Do not quote them to a customer as an entitlement')
  })

  it('says there is no staged rollout, and why', () => {
    signIn(SUPER_ADMIN)
    const out = open().text()

    expect(out).toContain('No staged rollout')
    expect(out).toContain('nothing in the data model holds one')
  })

  it('flags the plan catalogue as placeholder', () => {
    signIn(SUPER_ADMIN)
    expect(open().text()).toContain('Plan catalogue is placeholder')
  })

  it('states the boundary on the page itself', () => {
    signIn(SUPER_ADMIN)
    expect(open().text()).toContain('This page governs availability, never per-camera state')
  })
})
