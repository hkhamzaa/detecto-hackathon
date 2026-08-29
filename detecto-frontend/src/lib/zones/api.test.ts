import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Renaming and merging, exercised through the dev mocks.
 *
 * The property worth protecting hardest is that all three stores move together.
 * A zone name lives on cameras, on role scopes and on notification routes, and
 * a rewrite that reached one and missed another would not look broken — it
 * would look like the product quietly going wrong a day later, with a role
 * scoped to a name nothing has and the people holding it seeing nothing.
 *
 * Modules are reloaded per test: all four mocks hold session state the way a
 * real store would, and a rename in one test would otherwise be the starting
 * position of the next.
 */
/*
 * Every mock call in this file sleeps, deliberately — the transports imitate a
 * network so the loading states are real in the dev server. A merge test does
 * eight of them in sequence (add cameras, save two roles, set two routes, then
 * the merge, which reads all three stores before it writes), which lands close
 * enough to the 5s default to fail on a slow machine and pass on a fast one.
 *
 * Raised here rather than by making the mocks faster: the delays are what make
 * the pages honest to develop against, and a suite that only passes on a good
 * day is worse than a slow one.
 */
vi.setConfig({ testTimeout: 30_000 })

async function load() {
  vi.resetModules()
  const cameras = await import('@/lib/cameras/api')
  const roles = await import('@/lib/roles/api')
  const notifications = await import('@/lib/notifications/api')
  const zones = await import('@/lib/zones/api')
  return { cameras, roles, notifications, zones }
}

/** The camera mock starts empty, so a zone has to be put there first. */
async function withZones(api: Awaited<ReturnType<typeof load>>) {
  const added = await api.cameras.addCameras([
    { name: 'Loading bay', zone: 'Yard', discoveredId: null, address: '10.0.0.1' },
    { name: 'Gate', zone: 'Yard', discoveredId: null, address: '10.0.0.2' },
    { name: 'Main entrance', zone: 'Front of house', discoveredId: null, address: '10.0.0.3' },
  ])
  if (!added.ok) throw new Error(added.code)
  return added.cameras
}

async function currentCameras(api: Awaited<ReturnType<typeof load>>) {
  const result = await api.cameras.listCameras()
  if (!result.ok) throw new Error(result.code)
  return result.cameras
}

async function currentRoles(api: Awaited<ReturnType<typeof load>>) {
  const result = await api.roles.getDirectory()
  if (!result.ok) throw new Error(result.code)
  return result.directory.roles
}

async function currentRoutes(api: Awaited<ReturnType<typeof load>>) {
  const result = await api.notifications.getNotificationSettings()
  if (!result.ok) throw new Error(result.code)
  return result.settings.routes
}

/** A role held to specific zones, since the seed only has one unscoped role. */
async function scopedRole(
  api: Awaited<ReturnType<typeof load>>,
  name: string,
  zones: string[],
) {
  const saved = await api.roles.saveRole({ name, permissions: ['alerts:view'], zones })
  if (!saved.ok) throw new Error(saved.code)
  return saved.role
}

beforeEach(() => {
  vi.resetModules()
})

describe('renaming a zone', () => {
  it('moves every camera in it', async () => {
    const api = await load()
    await withZones(api)

    const result = await api.zones.renameZone('Yard', 'Loading yard')
    expect(result.ok).toBe(true)

    const cameras = await currentCameras(api)
    expect(cameras.filter((c) => c.zone === 'Loading yard')).toHaveLength(2)
    expect(cameras.filter((c) => c.zone === 'Yard')).toHaveLength(0)
    // Untouched zones stay exactly as they were.
    expect(cameras.filter((c) => c.zone === 'Front of house')).toHaveLength(1)
  })

  it('re-scopes the roles held to it, in the same change', async () => {
    // The half that would break access if it were missed.
    const api = await load()
    await withZones(api)
    const role = await scopedRole(api, 'Yard team', ['Yard'])

    await api.zones.renameZone('Yard', 'Loading yard')

    const roles = await currentRoles(api)
    expect(roles.find((r) => r.id === role.id)?.zones).toEqual(['Loading yard'])
  })

  it('moves the notification route keyed on it', async () => {
    const api = await load()
    await withZones(api)
    await api.notifications.setRoute('zone', 'Yard', ['role_admin'])

    await api.zones.renameZone('Yard', 'Loading yard')

    const routes = await currentRoutes(api)
    expect(routes.find((r) => r.kind === 'zone')?.target).toBe('Loading yard')
    expect(routes.some((r) => r.target === 'Yard')).toBe(false)
  })

  it('leaves a role that reaches every camera alone', async () => {
    const api = await load()
    await withZones(api)

    await api.zones.renameZone('Yard', 'Loading yard')

    const roles = await currentRoles(api)
    // The seeded Admin role is unscoped, and a rename must not scope it.
    expect(roles.find((r) => r.isDefault)?.zones).toBeNull()
  })

  it('refuses a name that is already a different zone', async () => {
    const api = await load()
    await withZones(api)

    const result = await api.zones.renameZone('Yard', 'Front of house')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('name_taken')

    // And nothing moved.
    const cameras = await currentCameras(api)
    expect(cameras.filter((c) => c.zone === 'Yard')).toHaveLength(2)
  })

  it('refuses a zone no camera is in', async () => {
    const api = await load()
    await withZones(api)

    const result = await api.zones.renameZone('Perimeter', 'Fence line')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_found')
  })

  it('trims the new name, so a stray space is not a different zone', async () => {
    const api = await load()
    await withZones(api)

    await api.zones.renameZone('Yard', '  Loading yard  ')
    const cameras = await currentCameras(api)
    expect(cameras.some((c) => c.zone === 'Loading yard')).toBe(true)
  })
})

describe('merging two zones', () => {
  it('moves the cameras and re-scopes the roles together', async () => {
    const api = await load()
    await withZones(api)
    const role = await scopedRole(api, 'Yard team', ['Yard'])

    const result = await api.zones.mergeZones('Yard', 'Front of house')
    expect(result.ok).toBe(true)

    const cameras = await currentCameras(api)
    expect(cameras.filter((c) => c.zone === 'Front of house')).toHaveLength(3)
    expect(cameras.some((c) => c.zone === 'Yard')).toBe(false)

    const roles = await currentRoles(api)
    expect(roles.find((r) => r.id === role.id)?.zones).toEqual(['Front of house'])
  })

  it('leaves a role that held both with one entry, not two', async () => {
    const api = await load()
    await withZones(api)
    const role = await scopedRole(api, 'Both', ['Yard', 'Front of house'])

    await api.zones.mergeZones('Yard', 'Front of house')

    const roles = await currentRoles(api)
    expect(roles.find((r) => r.id === role.id)?.zones).toEqual(['Front of house'])
  })

  it('widens the routing rather than narrowing it', async () => {
    // The destination was narrowed and the source was not. Keeping the
    // narrowing would stop the people who heard about the yard hearing about
    // its cameras — so the merged zone falls back to the default.
    const api = await load()
    await withZones(api)
    await api.notifications.setRoute('zone', 'Front of house', ['role_admin'])

    await api.zones.mergeZones('Yard', 'Front of house')

    const routes = await currentRoutes(api)
    expect(routes.some((r) => r.kind === 'zone')).toBe(false)
  })

  it('unions the two lists when both were narrowed', async () => {
    const api = await load()
    await withZones(api)
    const yard = await scopedRole(api, 'Yard team', ['Yard'])
    const front = await scopedRole(api, 'Front team', ['Front of house'])

    await api.notifications.setRoute('zone', 'Yard', [yard.id])
    await api.notifications.setRoute('zone', 'Front of house', [front.id])

    await api.zones.mergeZones('Yard', 'Front of house')

    const routes = await currentRoutes(api)
    const merged = routes.find((r) => r.kind === 'zone')
    expect(merged?.target).toBe('Front of house')
    expect(merged?.roleIds?.sort()).toEqual([front.id, yard.id].sort())
  })

  it('refuses to merge a zone into itself', async () => {
    const api = await load()
    await withZones(api)

    const result = await api.zones.mergeZones('Yard', 'Yard')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_found')
  })

  it('refuses a destination no camera is in', async () => {
    const api = await load()
    await withZones(api)

    const result = await api.zones.mergeZones('Yard', 'Perimeter')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_found')
  })
})

describe('what the transport offers', () => {
  it('is two operations and nothing else', async () => {
    // No create, and no delete. A zone is made by putting a camera in one and
    // stops existing when the last camera leaves, so neither would have
    // anything to act on.
    const api = await load()
    expect(Object.keys(api.zones).sort()).toEqual(['mergeZones', 'renameZone'])
  })

  it('takes zone names rather than ids, because there are no ids', async () => {
    const api = await load()
    expect(api.zones.renameZone).toHaveLength(2)
    expect(api.zones.mergeZones).toHaveLength(2)
  })
})
