import { listCameras, mockRewriteCameraZone } from '@/lib/cameras/api'
import { USE_MOCKS } from '@/lib/config/mocks'
import {
  getNotificationSettings,
  mockRewriteRouteZone,
} from '@/lib/notifications/api'
import { getDirectory, mockRewriteRoleZone } from '@/lib/roles/api'
import { mergeRoute, renameIssue, zonesInUse } from '@/lib/zones/references'
import { useAuthStore } from '@/store/auth-store'

/**
 * Renaming and merging zones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE ENDPOINT AND NOT THREE CALLS
 *
 * A zone has no record and no id. It is a name written into three unrelated
 * stores — `Camera.zone`, `Role.zones`, and a zone `NotificationRoute.target` —
 * and two of those are load-bearing: role scope decides which cameras somebody
 * is allowed to open, and the route decides who is told when something is found
 * there. See the header of `lib/zones/references.ts`.
 *
 * That makes a rename a small migration rather than a field edit, and it is why
 * the transport below is a single `POST` rather than the browser issuing a
 * camera write, then a role write, then a route write. A partial failure across
 * those three would not be a cosmetic problem:
 *
 *   - cameras renamed, roles missed → every role held to that zone now points
 *     at a name nothing has, reaches no cameras, and the people holding it stop
 *     seeing anything, silently;
 *   - cameras renamed, route missed → the zone route targets a name nothing
 *     raises alerts under, so nobody is notified about that zone at all.
 *
 * Neither failure announces itself. Both look like the product quietly going
 * wrong a day later. So the browser asks for the rename and the server does it
 * in one transaction, or it does not happen — there is no client-side sequence
 * here that could half-succeed.
 *
 * THE MOCK CAN BE ATOMIC, AND IS
 *
 * The three dev mocks are three module-scoped objects in one JavaScript process,
 * so the mock below genuinely applies all three rewrites together with nothing
 * that can fail in between. That is not a claim about the real system; it is
 * why the mock is not lying when it reports success. Each store exports one
 * `mockRewrite*` seam for this, documented in place, and all of them are
 * deleted together when `/api/org/zones` is live.
 *
 * WHAT IS NOT REWRITTEN, DELIBERATELY
 *
 * History keeps the name it was written with. An alert raised in "Yard" still
 * says Yard after Yard becomes "Loading yard", and an audit entry that recorded
 * a change to Yard still names Yard. Those are records of what happened, and
 * rewriting them so the past matches the present is precisely what an audit
 * trail must not do. The page says so.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ZoneWriteResult =
  | { ok: true }
  | { ok: false; code: 'not_found' }
  /** The new name is already a different zone. That would be a merge. */
  | { ok: false; code: 'name_taken' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One zone, renamed everywhere at once.
 *
 * Deliberately not `updateZone(id, fields)` — there is no id, and the old name
 * is the only handle there is.
 */
export function renameZone(from: string, to: string): Promise<ZoneWriteResult> {
  return USE_MOCKS ? mockRename(from, to) : realWrite('rename', { from, to })
}

/**
 * Two zones, made one.
 *
 * Consequential in a way renaming is not: a role held to `from` and not to
 * `into` can reach the destination's cameras afterwards. `planMerge` in
 * `lib/zones/references.ts` works out exactly whose access widens, and the page
 * states it before this is called.
 */
export function mergeZones(from: string, into: string): Promise<ZoneWriteResult> {
  return USE_MOCKS ? mockMerge(from, into) : realWrite('merge', { from, into })
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function realWrite(
  operation: 'rename' | 'merge',
  body: Record<string, string>,
): Promise<ZoneWriteResult> {
  let response: Response
  try {
    // One call. The transaction is the server's, for the reasons at the top of
    // this file — there is no version of this that is three requests.
    response = await fetch(`/api/org/zones/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (response.status === 404) return { ok: false, code: 'not_found' }
  if (response.status === 409) return { ok: false, code: 'name_taken' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  return { ok: true }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/org/zones is live                              */
/* -------------------------------------------------------------------------- */

const MOCK_DELAY = 600

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The three stores, read through their own public surfaces. */
async function currentState() {
  const [cameras, directory, settings] = await Promise.all([
    listCameras(),
    getDirectory(),
    getNotificationSettings(),
  ])

  if (!cameras.ok || !directory.ok || !settings.ok) return null
  return {
    cameras: cameras.cameras,
    roles: directory.directory.roles,
    routes: settings.settings.routes,
  }
}

async function mockRename(from: string, to: string): Promise<ZoneWriteResult> {
  await wait(MOCK_DELAY)

  const state = await currentState()
  if (!state) return { ok: false, code: 'unavailable' }

  const zones = zonesInUse(state.cameras)
  if (!zones.includes(from)) return { ok: false, code: 'not_found' }

  // The same check the page makes, made again here. The disabled button is a
  // courtesy; this is the answer that counts — as everywhere else.
  const issue = renameIssue(from, to, zones)
  if (issue === 'name_taken') return { ok: false, code: 'name_taken' }
  if (issue !== null) return { ok: false, code: 'unavailable' }

  const next = to.trim()
  const route = state.routes.find(
    (item) => item.kind === 'zone' && item.target === from,
  )

  // All three together. Nothing between these lines can fail.
  mockRewriteCameraZone(from, next)
  mockRewriteRoleZone(from, next)
  if (route) mockRewriteRouteZone(from, next, route.roleIds)

  return { ok: true }
}

async function mockMerge(from: string, into: string): Promise<ZoneWriteResult> {
  await wait(MOCK_DELAY)

  const state = await currentState()
  if (!state) return { ok: false, code: 'unavailable' }

  const zones = zonesInUse(state.cameras)
  if (from === into || !zones.includes(from) || !zones.includes(into)) {
    return { ok: false, code: 'not_found' }
  }

  // The routing outcome is decided by the pure, tested rule — not here.
  const merged = mergeRoute(from, into, state.routes)

  mockRewriteCameraZone(from, into)
  mockRewriteRoleZone(from, into)
  mockRewriteRouteZone(from, into, merged.roleIds)

  return { ok: true }
}
