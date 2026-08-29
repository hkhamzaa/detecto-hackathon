import type { Person, Role } from '@/lib/roles/api'

/**
 * Who gets told, worked out from the roles an organisation already has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE INVENTS A CONTACT LIST
 *
 * Every recipient this file returns is a `Person` from `lib/roles/api.ts`,
 * reached through a `Role` they actually hold. There is no notification-only
 * address book, no "alert contacts" field, and no way to name somebody who is
 * not in the organisation — which is the whole point. A second list of who
 * matters would drift from the first one the day somebody left, and the page
 * that drifted would be the one nobody was reading.
 *
 * The default falls out of data that already exists: holding `alerts:view` or
 * `alerts:confirm` is what makes somebody an alert recipient, and a role's
 * `zones` is what limits which alerts reach them. An organisation that has
 * never opened the notifications page is already routed correctly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Holding either of these is what makes somebody an alert recipient. */
export const ALERT_GRANTS = ['alerts:confirm', 'alerts:view']

export type RouteKind = 'zone' | 'module'

/** Whether a role hears about alerts at all. */
export function hearsAlerts(role: Role): boolean {
  return ALERT_GRANTS.some((grant) => role.permissions.includes(grant))
}

/**
 * Whether a role's scope reaches a zone. `null` zones means every camera — the
 * same reading `summariseScope` gives it in `lib/roles/permissions.ts`.
 */
export function reaches(role: Role, zone: string): boolean {
  return role.zones === null || role.zones.includes(zone)
}

/**
 * The roles one route resolves to.
 *
 * `override === null` is the default, and the two kinds default differently. A
 * zone route defaults to everyone whose access reaches that place. A detection
 * type is not a place — a weapon is found wherever the camera happens to be —
 * so a module route defaults to everyone who hears alerts at all.
 *
 * Scope is applied to a zone route even when it has been overridden, and that
 * is not a detail. A role's `zones` is an access boundary, not a preference:
 * somebody scoped to the yard cannot open a front-of-house alert in the queue,
 * so listing them as a recipient for one would promise a notification about
 * something they are not allowed to see. Narrowing a zone to a role that does
 * not reach it therefore resolves to nobody — which the page shows, and
 * refuses to save.
 */
export function rolesFor(
  kind: RouteKind,
  target: string,
  override: string[] | null,
  roles: Role[],
): Role[] {
  if (kind === 'zone') {
    const named =
      override === null
        ? roles.filter(hearsAlerts)
        : roles.filter((role) => override.includes(role.id))
    return named.filter((role) => reaches(role, target))
  }

  return override === null
    ? roles.filter(hearsAlerts)
    : roles.filter((role) => override.includes(role.id))
}

/**
 * The people a set of roles actually reaches.
 *
 * Active accounts only, and that is not a detail. An invitation nobody has
 * answered is not a person who will see a notification, and a deactivated
 * account cannot receive one. Counting either would tell an administrator that
 * four people are watching the yard when one is.
 */
export function peopleIn(roles: Role[], people: Person[]): Person[] {
  const ids = new Set(roles.map((role) => role.id))
  return people.filter(
    (person) =>
      person.status === 'active' && person.roleId !== null && ids.has(person.roleId),
  )
}

/**
 * People who hold a role but cannot receive anything yet.
 *
 * Shown beside the recipient count rather than folded into it: "three people,
 * two of whom have never accepted their invitation" is a different situation
 * from "one person", and an administrator setting up routing needs to see the
 * difference before they rely on it.
 */
export function pendingIn(roles: Role[], people: Person[]): Person[] {
  const ids = new Set(roles.map((role) => role.id))
  return people.filter(
    (person) =>
      person.status !== 'active' && person.roleId !== null && ids.has(person.roleId),
  )
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

export type Route = { kind: RouteKind; target: string; roleIds: string[] | null }

function overrideFor(routes: Route[], kind: RouteKind, target: string) {
  return routes.find((route) => route.kind === kind && route.target === target)?.roleIds ?? null
}

/** The people one zone or module currently notifies. */
export function recipientsFor(
  kind: RouteKind,
  target: string,
  routes: Route[],
  roles: Role[],
  people: Person[],
): Person[] {
  return peopleIn(rolesFor(kind, target, overrideFor(routes, kind, target), roles), people)
}

/**
 * Who is told about one detection: the zone's recipients and the detection
 * type's, together, minus anybody whose access does not reach the place it
 * happened.
 *
 * The union is the most consequential decision in the file. Narrowing to the
 * people named by *both* routes would let two individually sensible settings
 * combine into nobody at all — a weapon found in the yard reaching an empty
 * list because the yard route and the weapon route happen not to overlap. On a
 * product whose entire claim is that a person sees the flag, a silent zero must
 * not be reachable by accident. Telling one extra person is the cheaper
 * mistake, so it is the one this makes.
 *
 * Scope is then applied on top, and it is not negotiable. Routing decides who
 * is eligible; a role's `zones` decides what they are allowed to see at all. A
 * module route naming everybody must not page a yard-scoped operator about the
 * front of house — they could not open that alert if they tried, and a
 * notification about something invisible is worse than none.
 */
export function notifiedFor(
  zone: string,
  moduleId: string,
  routes: Route[],
  roles: Role[],
  people: Person[],
): Person[] {
  const byZone = rolesFor('zone', zone, overrideFor(routes, 'zone', zone), roles)
  const byModule = rolesFor(
    'module',
    moduleId,
    overrideFor(routes, 'module', moduleId),
    roles,
  )

  const named = new Map<string, Role>()
  for (const role of [...byZone, ...byModule]) {
    if (reaches(role, zone)) named.set(role.id, role)
  }

  return peopleIn([...named.values()], people)
}

/**
 * Everything one person would currently be told about.
 *
 * The inverse of `notifiedFor`, and worth computing rather than describing: an
 * administrator can read down a routing table and still not notice that one
 * person is now hearing about nothing. This is the view that makes that
 * obvious.
 *
 * Worked out over every zone-and-detection pair rather than each axis on its
 * own, because the two do not combine independently — somebody eligible for
 * every weapon detection still only receives the ones raised where their access
 * reaches. Reading the axes separately is exactly how this column would come to
 * claim otherwise.
 */
export function coverageFor(
  person: Person,
  routes: Route[],
  roles: Role[],
  zones: string[],
  moduleIds: string[],
): { zones: string[]; modules: string[] } {
  // With one axis empty there are no pairs to walk, so each is answered on its
  // own. Reporting "nothing" in that case would blame routing for an
  // organisation that has simply not zoned its cameras, or for there being no
  // live detection module to raise anything in the first place.
  if (zones.length === 0 || moduleIds.length === 0) {
    return {
      zones: zones.filter(
        (zone) => recipientsFor('zone', zone, routes, roles, [person]).length > 0,
      ),
      modules: moduleIds.filter(
        (moduleId) => recipientsFor('module', moduleId, routes, roles, [person]).length > 0,
      ),
    }
  }

  const told = { zones: new Set<string>(), modules: new Set<string>() }

  for (const zone of zones) {
    for (const moduleId of moduleIds) {
      if (notifiedFor(zone, moduleId, routes, roles, [person]).length === 0) continue
      told.zones.add(zone)
      told.modules.add(moduleId)
    }
  }

  return {
    zones: zones.filter((zone) => told.zones.has(zone)),
    modules: moduleIds.filter((moduleId) => told.modules.has(moduleId)),
  }
}

/* -------------------------------------------------------------------------- */
/* Words                                                                      */
/* -------------------------------------------------------------------------- */

function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Role names as a sentence fragment, for the confirm step and the summaries. */
export function summariseRoles(roles: Role[]): string {
  if (roles.length === 0) return 'nobody'
  return join(roles.map((role) => role.name))
}

/** `2 people` / `nobody`. The count that decides whether a route is a problem. */
export function countPeople(people: Person[]): string {
  if (people.length === 0) return 'nobody'
  return `${people.length} ${people.length === 1 ? 'person' : 'people'}`
}

/**
 * A list of names, trimmed. Used where the whole list would crowd out the
 * number, which is the part that matters.
 */
export function summariseNames(people: Person[], max = 3): string {
  if (people.length === 0) return 'nobody'
  if (people.length <= max) return join(people.map((person) => person.name))
  const shown = people.slice(0, max).map((person) => person.name)
  return `${shown.join(', ')} and ${people.length - max} more`
}
