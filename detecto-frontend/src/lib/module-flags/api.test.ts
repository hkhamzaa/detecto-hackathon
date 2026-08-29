import { afterEach, describe, expect, it, vi } from 'vitest'

import { PLANS } from '@/lib/plans'

/**
 * The module registry, exercised through its own dev mock.
 *
 * The property worth protecting hardest is that this page and the org-side
 * modules page are one system. `module_status` is a single field with two
 * readers, and a build where the platform says a module is live while an
 * organisation's own page still calls it coming soon would make this page look
 * like it does nothing.
 *
 * Modules are reloaded per test: both mocks hold session state, and a release
 * in one test would otherwise be the starting position of the next.
 */

async function load() {
  vi.resetModules()
  const flags = await import('@/lib/module-flags/api')
  const modules = await import('@/lib/modules/api')
  return { flags, modules }
}

async function listed() {
  const { flags, modules } = await load()
  const result = await flags.listModuleFlags()
  if (!result.ok) throw new Error(result.code)
  return { registry: result.modules, flags, modules }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the registry', () => {
  it('carries every module in the contract', async () => {
    const { registry } = await listed()
    expect(registry.map((m) => m.id).sort()).toEqual([
      'forced_movement',
      'loitering',
      'theft',
      'violence',
      'weapon',
      'zone_intrusion',
    ])
  })

  it('matches the catalogue the org page reads', async () => {
    // Same six records, same statuses. Two sources of truth here would let the
    // pages disagree about what exists.
    const { registry, modules } = await listed()
    const config = await modules.getModuleConfig()
    if (!config.ok) throw new Error(config.code)

    expect(registry.map((m) => m.id).sort()).toEqual(
      config.config.modules.map((m) => m.id).sort(),
    )
    for (const flag of registry) {
      const module = config.config.modules.find((m) => m.id === flag.id)
      expect(module?.status).toBe(flag.status)
    }
  })

  it('starts with two live and four still coming', async () => {
    const { registry } = await listed()
    expect(registry.filter((m) => m.status === 'live').map((m) => m.id).sort()).toEqual([
      'violence',
      'weapon',
    ])
  })

  it('gives every module plan tiers drawn from the real catalogue', async () => {
    const { registry } = await listed()
    const known = PLANS.map((plan) => plan.id)

    for (const module of registry) {
      expect(module.planIds.length).toBeGreaterThan(0)
      // An id no plan matches would render as an empty tier and entitle nobody.
      expect(module.planIds.every((id) => known.includes(id))).toBe(true)
    }
  })

  it('publishes a rate for live modules and none for the rest', async () => {
    // A module that has never run has no measured rate, and a plausible-looking
    // one would be a fabrication.
    const { registry } = await listed()

    for (const module of registry) {
      if (module.status === 'live') {
        expect(module.falsePositiveRate).toBeGreaterThan(0)
        expect(module.liveSince).toBeTypeOf('string')
      } else {
        expect(module.falsePositiveRate).toBeNull()
        expect(module.liveSince).toBeNull()
      }
    }
  })

  it('keeps the registry to configuration, with no per-camera state', async () => {
    const { registry } = await listed()
    expect(Object.keys(registry[0]).sort()).toEqual([
      'description',
      'falsePositiveRate',
      'id',
      'liveSince',
      'name',
      'planIds',
      'resourceNote',
      'status',
    ])
  })
})

describe('releasing a module', () => {
  it('flips the status the org page reads', async () => {
    const { flags, modules } = await load()

    const before = await modules.getModuleConfig()
    if (!before.ok) throw new Error(before.code)
    expect(before.config.modules.find((m) => m.id === 'loitering')?.status).toBe(
      'coming_soon',
    )

    const released = await flags.setModuleStatus('loitering', 'live')
    if (!released.ok) throw new Error(released.code)
    expect(released.module.status).toBe('live')

    const after = await modules.getModuleConfig()
    if (!after.ok) throw new Error(after.code)
    expect(after.config.modules.find((m) => m.id === 'loitering')?.status).toBe('live')
  })

  it('lets the org side switch it on only once it is live', async () => {
    // The refusal the backend gives, whatever the browser thinks.
    const { flags, modules } = await load()

    const refused = await modules.setCameraModule('cam_x', 'loitering', true)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.code).toBe('not_live')

    await flags.setModuleStatus('loitering', 'live')
    const allowed = await modules.setCameraModule('cam_x', 'loitering', true)
    expect(allowed.ok).toBe(true)
  })

  it('stamps the release date, and clears it on withdrawal', async () => {
    const { flags } = await load()

    const released = await flags.setModuleStatus('theft', 'live')
    if (!released.ok) throw new Error(released.code)
    expect(released.module.liveSince).toBeTypeOf('string')

    const withdrawn = await flags.setModuleStatus('theft', 'coming_soon')
    if (!withdrawn.ok) throw new Error(withdrawn.code)
    // The next release is a new one. Dating it from the first would misreport
    // how long the module has actually been out.
    expect(withdrawn.module.liveSince).toBeNull()
  })

  it('takes the published rate away when a module is withdrawn', async () => {
    const { flags, modules } = await load()

    const withdrawn = await flags.setModuleStatus('weapon', 'coming_soon')
    if (!withdrawn.ok) throw new Error(withdrawn.code)
    expect(withdrawn.module.falsePositiveRate).toBeNull()

    const config = await modules.getModuleConfig()
    if (!config.ok) throw new Error(config.code)
    expect(config.config.modules.find((m) => m.id === 'weapon')?.falsePositiveRate).toBeNull()
  })
})

describe('plan tiers', () => {
  it('saves the plans a module is included in', async () => {
    const { flags } = await load()

    const result = await flags.setModulePlans('loitering', ['site', 'estate'])
    if (!result.ok) throw new Error(result.code)
    expect(result.module.planIds).toEqual(['site', 'estate'])
  })

  it('allows a module to be on no plan, which entitles nobody', async () => {
    const { flags } = await load()

    const result = await flags.setModulePlans('theft', [])
    if (!result.ok) throw new Error(result.code)
    expect(result.module.planIds).toEqual([])
  })

  it('does not disturb the status', async () => {
    const { flags } = await load()

    const result = await flags.setModulePlans('weapon', ['estate'])
    if (!result.ok) throw new Error(result.code)
    expect(result.module.status).toBe('live')
  })
})

describe('the measured rate', () => {
  it('records what the benchmark reported', async () => {
    const { flags, modules } = await load()

    const result = await flags.setModuleRate('weapon', 0.062)
    if (!result.ok) throw new Error(result.code)
    expect(result.module.falsePositiveRate).toBeCloseTo(0.062)

    // Read-only everywhere else, and the org page reads exactly this.
    const config = await modules.getModuleConfig()
    if (!config.ok) throw new Error(config.code)
    expect(
      config.config.modules.find((m) => m.id === 'weapon')?.falsePositiveRate,
    ).toBeCloseTo(0.062)
  })

  it('can be cleared back to unmeasured', async () => {
    const { flags } = await load()

    const result = await flags.setModuleRate('violence', null)
    if (!result.ok) throw new Error(result.code)
    expect(result.module.falsePositiveRate).toBeNull()
  })

  it('refuses to attach a rate to a module that has never run', async () => {
    // The contract holds on both sides: no rate on anything not live.
    const { flags } = await load()

    const result = await flags.setModuleRate('loitering', 0.05)
    if (!result.ok) throw new Error(result.code)
    expect(result.module.falsePositiveRate).toBeNull()
  })
})
