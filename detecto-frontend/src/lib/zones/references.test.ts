import { describe, expect, it } from 'vitest'

import type { Camera } from '@/lib/cameras/api'
import type { NotificationRoute } from '@/lib/notifications/api'
import type { Role } from '@/lib/roles/api'
import {
  countReferences,
  mergeRoute,
  orphanedZones,
  planMerge,
  referencesFor,
  renameIssue,
  summariseReferences,
  zonesInUse,
} from '@/lib/zones/references'

/**
 * What a zone name is holding up, and what happens when two become one.
 *
 * This is the file that earns the zones page. A zone has no record — it is the
 * same string written into cameras, role scopes and notification routes — so
 * every consequence of touching one has to be worked out rather than read off,
 * and the two that matter most are easy to get quietly wrong:
 *
 *   - merging widens access, because a role held to one zone ends up held to
 *     the other zone's cameras as well;
 *   - merging must never narrow who is notified, because the alternative is a
 *     detection nobody hears about.
 *
 * Both are asserted below against hand-built fixtures rather than the dev mock,
 * so the awkward combinations are reachable.
 */

function camera(over: Partial<Camera> = {}): Camera {
  return {
    id: 'cam_1',
    name: 'Camera 1',
    zone: 'Yard',
    online: true,
    lastSeen: null,
    ...over,
  }
}

function role(over: Partial<Role> = {}): Role {
  return {
    id: 'role_1',
    name: 'Role 1',
    permissions: ['alerts:view'],
    zones: null,
    isDefault: false,
    ...over,
  }
}

function route(target: string, roleIds: string[] | null): NotificationRoute {
  return { kind: 'zone', target, roleIds }
}

describe('which zones exist', () => {
  it('comes from the cameras, because that is what makes a zone', () => {
    const cameras = [
      camera({ id: 'a', zone: 'Yard' }),
      camera({ id: 'b', zone: 'Front of house' }),
      camera({ id: 'c', zone: 'Yard' }),
    ]

    expect(zonesInUse(cameras)).toEqual(['Front of house', 'Yard'])
  })

  it('ignores a camera with no zone rather than inventing an empty one', () => {
    expect(zonesInUse([camera({ zone: '' }), camera({ id: 'b', zone: '   ' })])).toEqual([])
  })

  it('treats a zone as the same zone whatever whitespace surrounds it', () => {
    const cameras = [camera({ id: 'a', zone: 'Yard' }), camera({ id: 'b', zone: ' Yard ' })]
    expect(zonesInUse(cameras)).toEqual(['Yard'])
  })
})

describe('names nothing is in', () => {
  it('finds a role still held to a zone with no cameras left', () => {
    // The dangling reference that matters: a role scoped only to this reaches
    // no cameras at all, and nothing else in the product would say so.
    const orphans = orphanedZones(
      [camera({ zone: 'Yard' })],
      [role({ zones: ['Yard', 'Loading dock'] })],
      [],
    )

    expect(orphans).toEqual(['Loading dock'])
  })

  it('finds a notification route pointing at one', () => {
    const orphans = orphanedZones(
      [camera({ zone: 'Yard' })],
      [],
      [route('Perimeter', ['role_1'])],
    )

    expect(orphans).toEqual(['Perimeter'])
  })

  it('does not call a live zone an orphan', () => {
    expect(
      orphanedZones([camera({ zone: 'Yard' })], [role({ zones: ['Yard'] })], [
        route('Yard', null),
      ]),
    ).toEqual([])
  })

  it('ignores a role that reaches every camera', () => {
    // `zones: null` is not a reference to any zone by name.
    expect(orphanedZones([camera({ zone: 'Yard' })], [role({ zones: null })], [])).toEqual([])
  })
})

describe('what points at one zone', () => {
  const cameras = [
    camera({ id: 'a', zone: 'Yard' }),
    camera({ id: 'b', zone: 'Yard' }),
    camera({ id: 'c', zone: 'Front of house' }),
  ]
  const roles = [
    role({ id: 'role_yard', zones: ['Yard'] }),
    role({ id: 'role_all', zones: null }),
    role({ id: 'role_front', zones: ['Front of house'] }),
  ]
  const routes = [route('Yard', ['role_yard']), { kind: 'module' as const, target: 'weapon', roleIds: null }]

  it('counts cameras, roles and routes separately', () => {
    const refs = referencesFor('Yard', cameras, roles, routes)

    expect(refs.cameras).toHaveLength(2)
    expect(refs.roles.map((r) => r.id)).toEqual(['role_yard'])
    expect(refs.routes).toHaveLength(1)
    expect(countReferences(refs)).toBe(4)
  })

  it('leaves out a role that reaches every camera', () => {
    // Nothing done to this zone changes what such a role can see, so counting
    // it would overstate what a rename or a merge touches.
    expect(referencesFor('Yard', cameras, roles, routes).roles).toHaveLength(1)
  })

  it('never counts a module route as a zone reference', () => {
    // Both live in one list keyed by `target`, and a detection type called the
    // same thing as a zone must not be swept up by a zone operation.
    const clash = [route('weapon', ['role_1']), { kind: 'module' as const, target: 'weapon', roleIds: ['role_2'] }]
    expect(referencesFor('weapon', [], [], clash).routes).toHaveLength(1)
  })
})

describe('saying what it touches', () => {
  const refs = (cameras: number, roles: number, routes: number) => ({
    zone: 'Yard',
    cameras: Array.from({ length: cameras }, (_, i) => camera({ id: `c${i}` })),
    roles: Array.from({ length: roles }, (_, i) => role({ id: `r${i}` })),
    routes: Array.from({ length: routes }, () => route('Yard', null)),
  })

  it('reads as the sentence the confirm step needs', () => {
    expect(summariseReferences(refs(3, 2, 1))).toBe(
      '3 cameras, 2 roles and 1 notification route',
    )
  })

  it('leaves out the parts that are zero rather than printing them', () => {
    // "3 cameras, 0 roles and 1 notification route" makes somebody do
    // arithmetic to find what actually matters.
    expect(summariseReferences(refs(3, 0, 1))).toBe(
      '3 cameras and 1 notification route',
    )
    expect(summariseReferences(refs(1, 0, 0))).toBe('1 camera')
  })

  it('says nothing rather than an empty string', () => {
    expect(summariseReferences(refs(0, 0, 0))).toBe('nothing')
  })
})

describe('whether a rename can go ahead', () => {
  const zones = ['Yard', 'Front of house']

  it('allows a genuinely new name', () => {
    expect(renameIssue('Yard', 'Loading yard', zones)).toBeNull()
  })

  it('refuses an empty one', () => {
    expect(renameIssue('Yard', '   ', zones)).toBe('empty')
  })

  it('says nothing to do when the name has not changed', () => {
    expect(renameIssue('Yard', 'Yard', zones)).toBe('unchanged')
  })

  it('refuses a name that is already a different zone', () => {
    // That is a merge, and a merge has consequences a rename does not.
    expect(renameIssue('Yard', 'Front of house', zones)).toBe('name_taken')
    expect(renameIssue('Yard', 'front of house', zones)).toBe('name_taken')
  })

  it('allows fixing the case of the zone being renamed', () => {
    // "yard" to "Yard" is a correction, not a collision with itself.
    expect(renameIssue('yard', 'Yard', ['yard', 'Front of house'])).toBeNull()
  })
})

describe('who is notified after a merge', () => {
  /*
   * The rule that must not be got backwards: the merged zone can never notify
   * fewer people than either half did, because the failure mode is a weapon
   * detection nobody hears about.
   */
  it('keeps the default when neither zone was narrowed', () => {
    const merged = mergeRoute('Yard', 'Front of house', [])
    expect(merged.roleIds).toBeNull()
  })

  it('widens to the default when only the source was narrowed', () => {
    const merged = mergeRoute('Yard', 'Front of house', [route('Yard', ['role_yard'])])

    expect(merged.roleIds).toBeNull()
    expect(merged.reason).toContain('nobody stops being notified')
  })

  it('widens to the default when only the destination was narrowed', () => {
    // The dangerous direction if it were got wrong: cameras moving out of a
    // zone everyone hears about, into one two people hear about.
    const merged = mergeRoute('Yard', 'Front of house', [
      route('Front of house', ['role_front']),
    ])

    expect(merged.roleIds).toBeNull()
    expect(merged.reason).toContain('nobody stops being notified')
  })

  it('unions the two lists when both were narrowed', () => {
    const merged = mergeRoute('Yard', 'Front of house', [
      route('Yard', ['role_yard', 'role_shared']),
      route('Front of house', ['role_front', 'role_shared']),
    ])

    expect(merged.roleIds?.sort()).toEqual(['role_front', 'role_shared', 'role_yard'])
  })

  it('never names the same role twice', () => {
    const merged = mergeRoute('Yard', 'Front of house', [
      route('Yard', ['role_shared']),
      route('Front of house', ['role_shared']),
    ])

    expect(merged.roleIds).toEqual(['role_shared'])
  })

  it('ignores a module route that happens to share the name', () => {
    const merged = mergeRoute('Yard', 'Front of house', [
      { kind: 'module', target: 'Yard', roleIds: ['role_x'] },
    ])

    expect(merged.roleIds).toBeNull()
  })
})

describe('planning a merge', () => {
  const cameras = [
    camera({ id: 'yard_1', zone: 'Yard' }),
    camera({ id: 'yard_2', zone: 'Yard' }),
    camera({ id: 'dock_1', zone: 'Loading dock' }),
    camera({ id: 'front_1', zone: 'Front of house' }),
  ]

  it('moves every camera in the source zone', () => {
    const plan = planMerge('Yard', 'Loading dock', cameras, [], [])
    expect(plan.camerasMoving.map((c) => c.id)).toEqual(['yard_1', 'yard_2'])
  })

  it('re-scopes the roles held to the source', () => {
    const roles = [
      role({ id: 'role_yard', zones: ['Yard'] }),
      role({ id: 'role_front', zones: ['Front of house'] }),
    ]

    const plan = planMerge('Yard', 'Loading dock', cameras, roles, [])
    expect(plan.rolesRescoped.map((r) => r.id)).toEqual(['role_yard'])
  })

  it('reports that access widens, and by exactly which cameras', () => {
    // The consequence somebody would otherwise discover afterwards: a role that
    // could only open the yard can open the loading dock too.
    const roles = [role({ id: 'role_yard', name: 'Yard team', zones: ['Yard'] })]

    const plan = planMerge('Yard', 'Loading dock', cameras, roles, [])
    expect(plan.widened).toHaveLength(1)
    expect(plan.widened[0].role.id).toBe('role_yard')
    expect(plan.widened[0].gains.map((c) => c.id)).toEqual(['dock_1'])
  })

  it('does not claim widening for a role that already reached both', () => {
    const roles = [role({ id: 'role_both', zones: ['Yard', 'Loading dock'] })]

    const plan = planMerge('Yard', 'Loading dock', cameras, roles, [])
    expect(plan.rolesRescoped.map((r) => r.id)).toEqual(['role_both'])
    expect(plan.widened).toEqual([])
  })

  it('does not claim widening for a role that reaches every camera', () => {
    const plan = planMerge('Yard', 'Loading dock', cameras, [role({ zones: null })], [])
    expect(plan.widened).toEqual([])
  })

  it('does not claim widening when the destination has no cameras of its own', () => {
    // Merging into a zone whose cameras have all moved out gains nobody
    // anything, and saying otherwise would be a warning nobody can act on.
    const roles = [role({ id: 'role_yard', zones: ['Yard'] })]
    const onlyYard = [camera({ id: 'yard_1', zone: 'Yard' })]

    const plan = planMerge('Yard', 'Loading dock', onlyYard, roles, [])
    expect(plan.widened).toEqual([])
  })

  it('removes both route rows when the merged zone falls back to the default', () => {
    // An absent row *is* the default, so leaving the destination's narrowing in
    // place would contradict the outcome the plan just reported.
    const routes = [route('Yard', ['role_yard'])]
    const plan = planMerge('Yard', 'Loading dock', cameras, [], routes)

    expect(plan.route.roleIds).toBeNull()
    expect(plan.routesRemoved).toHaveLength(1)
  })

  it('removes only the source row when both were narrowed', () => {
    const routes = [route('Yard', ['role_yard']), route('Loading dock', ['role_dock'])]
    const plan = planMerge('Yard', 'Loading dock', cameras, [], routes)

    expect(plan.route.roleIds?.sort()).toEqual(['role_dock', 'role_yard'])
    expect(plan.routesRemoved.map((r) => r.target)).toEqual(['Yard'])
  })

  it('carries both names, so the confirm step can name them', () => {
    const plan = planMerge('Yard', 'Loading dock', cameras, [], [])
    expect(plan.from).toBe('Yard')
    expect(plan.into).toBe('Loading dock')
  })
})
