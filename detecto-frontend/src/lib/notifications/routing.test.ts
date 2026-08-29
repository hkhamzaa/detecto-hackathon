import { describe, expect, it } from 'vitest'

import {
  ALERT_GRANTS,
  coverageFor,
  countPeople,
  hearsAlerts,
  notifiedFor,
  peopleIn,
  pendingIn,
  reaches,
  recipientsFor,
  rolesFor,
  summariseNames,
  summariseRoles,
  type Route,
} from '@/lib/notifications/routing'
import { ALL_PERMISSION_KEYS } from '@/lib/roles/permissions'
import type { Person, Role } from '@/lib/roles/api'

/**
 * Who gets told, worked out from roles that already exist.
 *
 * The property worth protecting hardest is the union in `notifiedFor`. Two
 * separately sensible narrowings must never combine into nobody being told
 * about a weapon, and that is exactly the kind of rule a later refactor
 * "simplifies" into an intersection without noticing what it cost.
 */

function role(over: Partial<Role> = {}): Role {
  return {
    id: 'role_a',
    name: 'Role A',
    permissions: ['alerts:view'],
    zones: null,
    isDefault: false,
    ...over,
  }
}

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'usr_a',
    name: 'Person A',
    email: 'a@example.com',
    roleId: 'role_a',
    status: 'active',
    invitedAt: null,
    ...over,
  }
}

describe('who hears alerts at all', () => {
  it('is decided by the two grants the claims system already has', () => {
    // Not a notification-only flag. These are the same keys `can()` is asked
    // about everywhere else, so a role that can open the queue is a role that
    // can be told about it.
    expect(ALERT_GRANTS.every((grant) => ALL_PERMISSION_KEYS.includes(grant))).toBe(true)

    expect(hearsAlerts(role({ permissions: ['alerts:view'] }))).toBe(true)
    expect(hearsAlerts(role({ permissions: ['alerts:confirm'] }))).toBe(true)
    expect(hearsAlerts(role({ permissions: ['cameras:view'] }))).toBe(false)
    expect(hearsAlerts(role({ permissions: [] }))).toBe(false)
  })

  it('reads null zones as every camera, the same as the role builder does', () => {
    expect(reaches(role({ zones: null }), 'Yard')).toBe(true)
    expect(reaches(role({ zones: ['Yard'] }), 'Yard')).toBe(true)
    expect(reaches(role({ zones: ['Yard'] }), 'Front of house')).toBe(false)
    // A role scoped to nothing reaches nothing — not everything.
    expect(reaches(role({ zones: [] }), 'Yard')).toBe(false)
  })
})

describe('the default route', () => {
  const yard = role({ id: 'role_yard', name: 'Yard team', zones: ['Yard'] })
  const all = role({ id: 'role_all', name: 'Control room', zones: null })
  const blind = role({ id: 'role_blind', name: 'Installer', permissions: ['cameras:view'] })
  const roles = [yard, all, blind]

  it('tells everyone whose scope reaches the zone, and nobody else', () => {
    expect(rolesFor('zone', 'Yard', null, roles).map((r) => r.id)).toEqual([
      'role_yard',
      'role_all',
    ])
    expect(rolesFor('zone', 'Front of house', null, roles).map((r) => r.id)).toEqual([
      'role_all',
    ])
  })

  it('does not scope a detection type by zone, because it is not a place', () => {
    // A weapon is found wherever the camera happens to be. The role's own scope
    // still decides which of those alerts reach it.
    expect(rolesFor('module', 'weapon', null, roles).map((r) => r.id)).toEqual([
      'role_yard',
      'role_all',
    ])
  })

  it('is overridden by an explicit list, empty included', () => {
    expect(rolesFor('zone', 'Yard', ['role_all'], roles).map((r) => r.id)).toEqual([
      'role_all',
    ])
    // Narrowed to nothing is a real answer, and a different one from default.
    expect(rolesFor('zone', 'Yard', [], roles)).toEqual([])
  })

  it('applies zone scope even to a role somebody named explicitly', () => {
    // A role's zones is an access boundary, not a preference: naming the yard
    // team as recipients for the front of house cannot make them able to open
    // that alert, so it must not promise them a notification about it.
    expect(rolesFor('zone', 'Front of house', ['role_yard'], roles)).toEqual([])
  })
})

describe('who is actually reachable', () => {
  const roles = [role()]

  it('counts only active accounts', () => {
    // An invitation nobody answered is not somebody who will see a
    // notification, and a deactivated account cannot receive one.
    const people = [
      person({ id: 'usr_active', status: 'active' }),
      person({ id: 'usr_invited', status: 'invited' }),
      person({ id: 'usr_off', status: 'deactivated' }),
    ]

    expect(peopleIn(roles, people).map((p) => p.id)).toEqual(['usr_active'])
    expect(pendingIn(roles, people).map((p) => p.id)).toEqual(['usr_invited', 'usr_off'])
  })

  it('leaves out somebody holding no role at all', () => {
    expect(peopleIn(roles, [person({ roleId: null })])).toEqual([])
  })
})

describe('when a zone route and a module route both apply', () => {
  const yard = role({ id: 'role_yard', name: 'Yard team', zones: ['Yard'] })
  const weapons = role({ id: 'role_weapons', name: 'Weapons response', zones: null })
  const roles = [yard, weapons]
  const people = [
    person({ id: 'usr_yard', roleId: 'role_yard' }),
    person({ id: 'usr_weapons', roleId: 'role_weapons' }),
  ]

  const routes: Route[] = [
    { kind: 'zone', target: 'Yard', roleIds: ['role_yard'] },
    { kind: 'module', target: 'weapon', roleIds: ['role_weapons'] },
  ]

  it('tells everybody named by either, never only those named by both', () => {
    // The most consequential rule in the module. An intersection here would
    // notify nobody about a weapon in the yard, because the two narrowings do
    // not overlap — two sensible settings combining into silence.
    const told = notifiedFor('Yard', 'weapon', routes, roles, people)
    expect(told.map((p) => p.id).sort()).toEqual(['usr_weapons', 'usr_yard'])
  })

  it('never lists the same person twice when both routes name them', () => {
    const both: Route[] = [
      { kind: 'zone', target: 'Yard', roleIds: ['role_yard'] },
      { kind: 'module', target: 'weapon', roleIds: ['role_yard'] },
    ]
    expect(notifiedFor('Yard', 'weapon', both, roles, people).map((p) => p.id)).toEqual([
      'usr_yard',
    ])
  })

  it('still reaches somebody when one of the two routes is narrowed to nobody', () => {
    const silenced: Route[] = [
      { kind: 'zone', target: 'Yard', roleIds: [] },
      { kind: 'module', target: 'weapon', roleIds: ['role_weapons'] },
    ]
    expect(notifiedFor('Yard', 'weapon', silenced, roles, people)).toHaveLength(1)
  })

  it('never notifies somebody about a zone their role cannot reach', () => {
    // The union widens who is eligible; it must not widen what anybody can see.
    // On the default routing a module route names every alerts role, and the
    // yard team must still hear nothing about the front of house.
    const told = notifiedFor('Front of house', 'weapon', [], roles, people)
    expect(told.map((p) => p.id)).toEqual(['usr_weapons'])
  })

  it('holds that rule even when a module route names them by hand', () => {
    const routes: Route[] = [
      { kind: 'module', target: 'weapon', roleIds: ['role_yard'] },
    ]
    const told = notifiedFor('Front of house', 'weapon', routes, roles, people)

    // Naming the yard team for weapons cannot hand them the front of house.
    expect(told.map((p) => p.id)).not.toContain('usr_yard')
  })
})

describe('coverage, read from the person’s side', () => {
  const yard = role({ id: 'role_yard', name: 'Yard team', zones: null })
  const roles = [yard]
  const someone = person({ id: 'usr_yard', roleId: 'role_yard' })

  it('lists everything an unnarrowed person is told about', () => {
    const coverage = coverageFor(someone, [], roles, ['Yard', 'Front of house'], ['weapon'])
    expect(coverage.zones).toEqual(['Yard', 'Front of house'])
    expect(coverage.modules).toEqual(['weapon'])
  })

  it('does not credit somebody with zones their role cannot reach', () => {
    // Read axis by axis, a scoped person looks like they hear about every
    // weapon detection everywhere. They do not, and this column must not say so.
    const scoped = [role({ id: 'role_yard', name: 'Yard team', zones: ['Yard'] })]
    const coverage = coverageFor(
      someone,
      [],
      scoped,
      ['Yard', 'Front of house'],
      ['weapon'],
    )

    expect(coverage.zones).toEqual(['Yard'])
    expect(coverage.modules).toEqual(['weapon'])
  })

  it('falls back to eligibility when no camera has a zone yet', () => {
    // Reporting "nothing" here would blame routing for an organisation simply
    // not having zoned its cameras.
    const coverage = coverageFor(someone, [], roles, [], ['weapon'])
    expect(coverage.modules).toEqual(['weapon'])
  })

  it('shows when every route has been narrowed past somebody', () => {
    // The failure this view exists to catch: routing looks reasonable read down
    // the list, and one person has quietly stopped hearing about anything.
    const routes: Route[] = [
      { kind: 'zone', target: 'Yard', roleIds: [] },
      { kind: 'zone', target: 'Front of house', roleIds: [] },
      { kind: 'module', target: 'weapon', roleIds: [] },
    ]

    const coverage = coverageFor(someone, routes, roles, ['Yard', 'Front of house'], ['weapon'])
    expect(coverage.zones).toEqual([])
    expect(coverage.modules).toEqual([])
  })

  it('agrees with the route’s own recipient list', () => {
    const routes: Route[] = [{ kind: 'zone', target: 'Yard', roleIds: ['role_yard'] }]
    expect(recipientsFor('zone', 'Yard', routes, roles, [someone])).toHaveLength(1)
    expect(coverageFor(someone, routes, roles, ['Yard'], []).zones).toEqual(['Yard'])
  })
})

describe('words', () => {
  it('says nobody rather than zero', () => {
    expect(countPeople([])).toBe('nobody')
    expect(summariseNames([])).toBe('nobody')
    expect(summariseRoles([])).toBe('nobody')
  })

  it('counts one person singular', () => {
    expect(countPeople([person()])).toBe('1 person')
    expect(countPeople([person({ id: 'a' }), person({ id: 'b' })])).toBe('2 people')
  })

  it('joins names with and, and trims a long list to a count', () => {
    const names = ['Ada', 'Bo', 'Cai', 'Dee'].map((name, index) =>
      person({ id: `usr_${index}`, name }),
    )

    expect(summariseNames(names.slice(0, 2))).toBe('Ada and Bo')
    expect(summariseNames(names)).toBe('Ada, Bo, Cai and 1 more')
    expect(summariseNames(names, 6)).toBe('Ada, Bo, Cai and Dee')
  })

  it('names roles the way the confirm step reads them out', () => {
    expect(summariseRoles([role({ name: 'Yard team' })])).toBe('Yard team')
    expect(
      summariseRoles([role({ name: 'Yard team' }), role({ name: 'Night shift' })]),
    ).toBe('Yard team and Night shift')
  })
})
