import { describe, expect, it, vi } from 'vitest'

import { ESCALATION_DELAYS } from '@/lib/notifications/api'

/**
 * The notification settings store, exercised through its own dev mock.
 *
 * Reloaded per test: the mock holds session state the way a real store would,
 * and an override saved in one test would otherwise be the starting position of
 * the next.
 */
async function load() {
  vi.resetModules()
  return import('@/lib/notifications/api')
}

describe('what an organisation starts with', () => {
  it('has no overrides and no escalation', async () => {
    // The default *is* the answer: everyone who can see alerts is told about
    // the alerts their role reaches. A pre-narrowed mock would imply that
    // routing is a setup step somebody has to complete first.
    const api = await load()
    const result = await api.getNotificationSettings()
    if (!result.ok) throw new Error(result.code)

    expect(result.settings.routes).toEqual([])
    expect(result.settings.escalation).toEqual({
      enabled: false,
      afterMinutes: 15,
      roleIds: [],
    })
  })

  it('offers three thresholds and nothing freeform', async () => {
    expect(ESCALATION_DELAYS).toEqual([5, 15, 30])
  })
})

describe('narrowing a route', () => {
  it('stores the roles chosen for one zone', async () => {
    const api = await load()
    const saved = await api.setRoute('zone', 'Yard', ['role_yard'])
    if (!saved.ok) throw new Error(saved.code)

    expect(saved.settings.routes).toEqual([
      { kind: 'zone', target: 'Yard', roleIds: ['role_yard'] },
    ])
  })

  it('keeps a zone and a detection type of the same name apart', async () => {
    const api = await load()
    await api.setRoute('zone', 'weapon', ['role_a'])
    const saved = await api.setRoute('module', 'weapon', ['role_b'])
    if (!saved.ok) throw new Error(saved.code)

    expect(saved.settings.routes).toHaveLength(2)
    expect(
      saved.settings.routes.find((route) => route.kind === 'module')?.roleIds,
    ).toEqual(['role_b'])
  })

  it('replaces rather than accumulates when the same route is saved twice', async () => {
    const api = await load()
    await api.setRoute('zone', 'Yard', ['role_a'])
    const saved = await api.setRoute('zone', 'Yard', ['role_b'])
    if (!saved.ok) throw new Error(saved.code)

    expect(saved.settings.routes).toHaveLength(1)
    expect(saved.settings.routes[0].roleIds).toEqual(['role_b'])
  })

  it('deletes the row when a route goes back to default', async () => {
    // A stored `null` and an absent row would be two spellings of one state,
    // and the next reader would have to know which one this build meant.
    const api = await load()
    await api.setRoute('zone', 'Yard', ['role_a'])

    const cleared = await api.setRoute('zone', 'Yard', null)
    if (!cleared.ok) throw new Error(cleared.code)
    expect(cleared.settings.routes).toEqual([])
  })

  it('keeps narrowed-to-nobody as a real, distinct answer', async () => {
    // Different from default, and the page refuses to save it — but the store
    // has to be able to tell the two apart to know that.
    const api = await load()
    const saved = await api.setRoute('zone', 'Yard', [])
    if (!saved.ok) throw new Error(saved.code)

    expect(saved.settings.routes[0].roleIds).toEqual([])
  })

  it('hands back a copy a caller cannot write through', async () => {
    const api = await load()
    const first = await api.setRoute('zone', 'Yard', ['role_a'])
    if (!first.ok) throw new Error(first.code)

    first.settings.routes[0].roleIds?.push('role_smuggled')

    const again = await api.getNotificationSettings()
    if (!again.ok) throw new Error(again.code)
    expect(again.settings.routes[0].roleIds).toEqual(['role_a'])
  })
})

describe('escalation', () => {
  it('saves the threshold and who it reaches', async () => {
    const api = await load()
    const saved = await api.setEscalation({
      enabled: true,
      afterMinutes: 5,
      roleIds: ['role_night'],
    })
    if (!saved.ok) throw new Error(saved.code)

    expect(saved.settings.escalation).toEqual({
      enabled: true,
      afterMinutes: 5,
      roleIds: ['role_night'],
    })
  })

  it('survives a route change, and does not disturb one', async () => {
    const api = await load()
    await api.setEscalation({ enabled: true, afterMinutes: 30, roleIds: ['role_night'] })
    const saved = await api.setRoute('module', 'weapon', ['role_a'])
    if (!saved.ok) throw new Error(saved.code)

    expect(saved.settings.escalation.enabled).toBe(true)
    expect(saved.settings.escalation.afterMinutes).toBe(30)
  })

  it('can be turned off without forgetting who it named', async () => {
    // Turning it back on should not mean rebuilding the list from memory.
    const api = await load()
    await api.setEscalation({ enabled: true, afterMinutes: 15, roleIds: ['role_night'] })

    const off = await api.setEscalation({
      enabled: false,
      afterMinutes: 15,
      roleIds: ['role_night'],
    })
    if (!off.ok) throw new Error(off.code)

    expect(off.settings.escalation.enabled).toBe(false)
    expect(off.settings.escalation.roleIds).toEqual(['role_night'])
  })
})

describe('the boundary this module keeps', () => {
  it('offers no way to send anything, and no authority contact', async () => {
    /*
     * Escalation notifies a colleague. There is no field that could hold an
     * emergency service and no function that could reach one — the promise is
     * held in the types, not only in the copy.
     *
     * The list is exact rather than filtered, so anything added here has to be
     * looked at. `mockRewriteRouteZone` is the one addition: a dev-mock seam
     * the zones mock calls so that renaming a zone moves its route with it,
     * rather than leaving a route pointing at a name nothing raises alerts
     * under. It sends nothing, reaches nobody, and is deleted with the mocks.
     */
    const api = await load()
    expect(Object.keys(api).sort()).toEqual([
      'ESCALATION_DELAYS',
      'getNotificationSettings',
      'mockRewriteRouteZone',
      'setEscalation',
      'setRoute',
    ])
  })

  it('keeps a route to a target and a list of roles', async () => {
    const api = await load()
    const saved = await api.setRoute('zone', 'Yard', ['role_a'])
    if (!saved.ok) throw new Error(saved.code)

    expect(Object.keys(saved.settings.routes[0]).sort()).toEqual([
      'kind',
      'roleIds',
      'target',
    ])
  })

  it('carries no channel, address or telephone number anywhere', async () => {
    const api = await load()
    const saved = await api.setEscalation({
      enabled: true,
      afterMinutes: 15,
      roleIds: ['role_a'],
    })
    if (!saved.ok) throw new Error(saved.code)

    const serialised = JSON.stringify(saved.settings)
    for (const invented of ['channel', 'phone', 'sms', 'email', 'webhook', 'authority']) {
      expect(serialised.toLowerCase()).not.toContain(invented)
    }
  })
})
