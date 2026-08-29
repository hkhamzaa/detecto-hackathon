import type { Camera } from '@/lib/cameras/api'
import type { NotificationRoute } from '@/lib/notifications/api'
import type { Role } from '@/lib/roles/api'

/**
 * What a zone name is actually holding up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ZONE IS NOT A RECORD. IT IS A STRING, REPEATED IN THREE PLACES.
 *
 * There is no zone entity anywhere in the product and no zone id. A zone exists
 * because somebody typed the same words into three unrelated stores:
 *
 *   `Camera.zone`                     — a string, set when the camera was added
 *   `Role.zones: string[] | null`     — an access boundary, by name
 *   `NotificationRoute.target`        — the routing key, by name, when kind is 'zone'
 *
 * That is why this module exists and why renaming is not a field edit. Two of
 * those three are load-bearing for things other than labels: a role's `zones`
 * decides which cameras a person is allowed to open at all, and a route's
 * `target` decides who is told when something is found there. A rename that
 * reached the cameras and missed the roles would leave a role scoped to a zone
 * that no longer exists — which resolves to no cameras, silently, for everyone
 * holding it.
 *
 * So every function here is pure and reports *consequences* rather than
 * performing them. The page states what will happen, the transport does it in
 * one server-side transaction, and neither pretends the browser could safely do
 * it as three separate calls. See `lib/zones/api.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ZoneReferences = {
  zone: string
  /** Cameras assigned to it. This is what makes the zone exist at all. */
  cameras: Camera[]
  /** Roles held to it. Scope, not preference — see the note above. */
  roles: Role[]
  /** Notification routes keyed on it. At most one, but typed as a list to match the store. */
  routes: NotificationRoute[]
}

/**
 * Every zone a camera is actually in, alphabetically.
 *
 * Derived from cameras and nothing else, because that is the only place a zone
 * is brought into existence. A role scoped to a zone with no cameras left in it
 * is a dangling reference rather than a zone — `orphanedZones` finds those, and
 * the page shows them separately instead of quietly listing them as if they
 * were places.
 */
export function zonesInUse(cameras: Camera[]): string[] {
  const names = new Set<string>()
  for (const camera of cameras) {
    const zone = camera.zone.trim()
    if (zone) names.add(zone)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * Zone names something still points at, that no camera is in any more.
 *
 * Reachable today: renaming a zone is transactional, but a camera can be moved
 * or removed one at a time, and the last camera leaving a zone does not tidy up
 * the role scopes and routes that named it. Those references are not harmless —
 * a role scoped only to a zone that no longer exists reaches nothing.
 */
export function orphanedZones(
  cameras: Camera[],
  roles: Role[],
  routes: NotificationRoute[],
): string[] {
  const live = new Set(zonesInUse(cameras))
  const referenced = new Set<string>()

  for (const role of roles) {
    for (const zone of role.zones ?? []) {
      const name = zone.trim()
      if (name && !live.has(name)) referenced.add(name)
    }
  }
  for (const route of routes) {
    const name = route.target.trim()
    if (route.kind === 'zone' && name && !live.has(name)) referenced.add(name)
  }

  return [...referenced].sort((a, b) => a.localeCompare(b))
}

/** Everything pointing at one zone name. */
export function referencesFor(
  zone: string,
  cameras: Camera[],
  roles: Role[],
  routes: NotificationRoute[],
): ZoneReferences {
  return {
    zone,
    cameras: cameras.filter((camera) => camera.zone.trim() === zone),
    // `zones: null` means every camera, which is not a reference to this zone
    // by name — such a role is unaffected by anything done to it here.
    roles: roles.filter((role) => role.zones !== null && role.zones.includes(zone)),
    routes: routes.filter((route) => route.kind === 'zone' && route.target === zone),
  }
}

export function countReferences(references: ZoneReferences): number {
  return (
    references.cameras.length + references.roles.length + references.routes.length
  )
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The reference count as a sentence fragment, for a confirm step.
 *
 * Parts with nothing in them are left out rather than printed as zero: "3
 * cameras and 1 role" is what somebody needs to weigh, and "3 cameras, 0 roles
 * and 1 notification route" makes them do arithmetic to find it.
 */
export function summariseReferences(references: ZoneReferences): string {
  const parts: string[] = []

  if (references.cameras.length > 0) {
    parts.push(plural(references.cameras.length, 'camera', 'cameras'))
  }
  if (references.roles.length > 0) {
    parts.push(plural(references.roles.length, 'role', 'roles'))
  }
  if (references.routes.length > 0) {
    parts.push(
      plural(references.routes.length, 'notification route', 'notification routes'),
    )
  }

  if (parts.length === 0) return 'nothing'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/* -------------------------------------------------------------------------- */
/* Renaming                                                                   */
/* -------------------------------------------------------------------------- */

export type RenameIssue = 'empty' | 'unchanged' | 'name_taken'

/**
 * Whether a rename can go ahead, before anything is sent.
 *
 * A name that only differs in case is allowed through — "yard" to "Yard" is a
 * correction, not a collision — but a name that matches a *different* existing
 * zone is refused, because that is a merge wearing a rename's clothes and merges
 * have consequences this page states separately.
 */
export function renameIssue(
  from: string,
  to: string,
  zones: string[],
): RenameIssue | null {
  const next = to.trim()
  if (!next) return 'empty'
  if (next === from) return 'unchanged'

  const clash = zones.some(
    (zone) => zone !== from && zone.toLowerCase() === next.toLowerCase(),
  )
  return clash ? 'name_taken' : null
}

/* -------------------------------------------------------------------------- */
/* Merging                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the merged zone's notification route becomes.
 *
 * The rule is chosen so that nobody silently stops being told about a camera
 * they were being told about before:
 *
 *   - If *either* zone is on the default — everyone whose role can see alerts —
 *     the merged zone is on the default. The narrower of the two is discarded.
 *   - Otherwise both were narrowed, and the merged zone notifies the union of
 *     the two lists.
 *
 * The alternative — keeping the destination's narrowing — would mean cameras
 * moving from a zone routed to everyone into a zone routed to two people, and
 * the people who were being notified about those cameras would stop being
 * notified without anybody choosing that. Widening reaches one extra person;
 * narrowing loses a detection. `lib/notifications/routing.ts` makes the same
 * trade for the same reason.
 */
export type MergedRoute = {
  /** `null` means the merged zone falls back to the default route. */
  roleIds: string[] | null
  reason: string
}

export function mergeRoute(
  from: string,
  into: string,
  routes: NotificationRoute[],
): MergedRoute {
  const zoneRoute = (target: string) =>
    routes.find((route) => route.kind === 'zone' && route.target === target)

  const fromRoute = zoneRoute(from)
  const intoRoute = zoneRoute(into)

  if (!fromRoute && !intoRoute) {
    return {
      roleIds: null,
      reason: 'Neither zone has been narrowed, so the merged zone keeps the default.',
    }
  }

  // An absent row *is* the default, and the default is the wider of the two.
  if (!fromRoute || !intoRoute) {
    const narrowed = fromRoute ?? intoRoute
    return {
      roleIds: null,
      reason:
        narrowed?.target === from
          ? `${from} was narrowed and ${into} was not. The merged zone keeps the wider setting — everyone who can see alerts is told — so nobody stops being notified.`
          : `${into} was narrowed and ${from} was not. The merged zone keeps the wider setting — everyone who can see alerts is told — so nobody stops being notified.`,
    }
  }

  const union = [...new Set([...(fromRoute.roleIds ?? []), ...(intoRoute.roleIds ?? [])])]
  return {
    roleIds: union,
    reason:
      'Both zones were narrowed, so the merged zone notifies everybody either of them named.',
  }
}

export type MergePlan = {
  from: string
  into: string
  /** Cameras that change zone. */
  camerasMoving: Camera[]
  /** Roles held to `from`, which will be held to `into` instead. */
  rolesRescoped: Role[]
  /**
   * The access consequence, and the reason this needs a confirm step.
   *
   * A role held to `from` and not to `into` could not open the cameras already
   * in `into`. After the merge it is held to `into`, and it can. Merging zones
   * widens access, and the page has to say whose and by how much.
   */
  widened: { role: Role; gains: Camera[] }[]
  route: MergedRoute
  /** Route rows the merge removes outright. */
  routesRemoved: NotificationRoute[]
}

export function planMerge(
  from: string,
  into: string,
  cameras: Camera[],
  roles: Role[],
  routes: NotificationRoute[],
): MergePlan {
  const fromRefs = referencesFor(from, cameras, roles, routes)
  const intoRefs = referencesFor(into, cameras, roles, routes)

  // Only roles that could not already reach the destination gain anything.
  const widened = fromRefs.roles
    .filter((role) => role.zones !== null && !role.zones.includes(into))
    .map((role) => ({ role, gains: intoRefs.cameras }))
    .filter((entry) => entry.gains.length > 0)

  const route = mergeRoute(from, into, routes)

  return {
    from,
    into,
    camerasMoving: fromRefs.cameras,
    rolesRescoped: fromRefs.roles,
    widened,
    route,
    // The `from` row always goes. The `into` row goes too when the outcome is
    // the default, since an absent row is how the default is stored.
    routesRemoved:
      route.roleIds === null
        ? [...fromRefs.routes, ...intoRefs.routes]
        : fromRefs.routes,
  }
}
