import { USE_MOCKS } from '@/lib/config/mocks'
import type { RouteKind } from '@/lib/notifications/routing'
import { useAuthStore } from '@/store/auth-store'

/**
 * Where alerts are routed, and what happens when nobody reviews one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL HERE, AND WHAT IS NOT
 *
 * The *decisions* this module stores are real and sit on data that already
 * exists: zones come from the cameras an organisation has connected, detection
 * types come from the module catalogue, and every recipient is a role from
 * `lib/roles/api.ts`. Nothing invents a contact.
 *
 * The *delivery* does not exist. Detecto has no push registration, no service
 * worker, no mail sender and no telephony of any kind, and this module does not
 * pretend otherwise — there is no `send`, no `test notification`, and no
 * per-channel field. What this holds is a routing decision an organisation can
 * make, review and be held to once delivery is built. The page says that at the
 * top, in those words, because a settings screen that looks like it is working
 * is worse than one that is honestly empty.
 *
 * NO CHANNEL PREFERENCE, DELIBERATELY
 *
 * `Person` carries a name, an email address and a role. It has no channel
 * preference, no notification setting, and — decisively — no telephone number.
 * A per-person channel matrix would require inventing all three, plus a record
 * of consent for each. The product's given is a push notification in the app;
 * email and SMS were discussed in planning and neither has anywhere to be
 * stored. See the note on the page: this is the same refusal made for coupons
 * on platform billing and for staged rollout on module flags.
 *
 * ESCALATION NOTIFIES A COLLEAGUE. NOTHING ELSE.
 *
 * There is no authority contact in this module, no emergency-service field, and
 * no code path that could reach one. Escalation adds people from the same
 * organisation to the same list. That is the product's standing promise — see
 * the confirmed-alert copy in `components/alert/alert-detail.tsx` — and it is
 * held here in the types, not only in the wording.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type NotificationRoute = {
  kind: RouteKind
  /** A zone name, or a module id. */
  target: string
  /**
   * Role ids that get notified, or `null` for the default — everyone whose role
   * carries an alerts grant and whose scope reaches this. Nullable for the same
   * reason `Role.zones` is: "not narrowed" and "narrowed to nothing" are
   * different answers, and an empty array must not be able to mean the first.
   */
  roleIds: string[] | null
}

/**
 * Minutes an alert may sit unreviewed. A short list, not a freeform timer: the
 * useful question is "roughly how long", and a field accepting 7 would invite
 * somebody to tune a number that nothing measures to that precision.
 */
export type EscalationDelay = 5 | 15 | 30
export const ESCALATION_DELAYS: EscalationDelay[] = [5, 15, 30]

export type EscalationPolicy = {
  enabled: boolean
  afterMinutes: EscalationDelay
  /**
   * Roles told *in addition to* whoever was already notified. Never instead of:
   * escalation widens the list, it does not hand the alert on and stop telling
   * the people who were watching for it.
   */
  roleIds: string[]
}

export type NotificationSettings = {
  routes: NotificationRoute[]
  escalation: EscalationPolicy
}

export type SettingsResult =
  | { ok: true; settings: NotificationSettings }
  | { ok: false; code: 'unavailable' }

export type WriteResult =
  | { ok: true; settings: NotificationSettings }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getNotificationSettings(): Promise<SettingsResult> {
  return USE_MOCKS ? mockGet() : realGet()
}

/** Narrow one zone or detection type, or pass `null` to put it back to default. */
export function setRoute(
  kind: RouteKind,
  target: string,
  roleIds: string[] | null,
): Promise<WriteResult> {
  return USE_MOCKS ? mockSetRoute(kind, target, roleIds) : realSetRoute(kind, target, roleIds)
}

export function setEscalation(policy: EscalationPolicy): Promise<WriteResult> {
  return USE_MOCKS ? mockSetEscalation(policy) : realSetEscalation(policy)
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function json(body: unknown): RequestInit {
  return {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

function toRoute(value: unknown): NotificationRoute | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>

  const target = str(r.target)
  const kind = str(r.kind)
  if (!target || (kind !== 'zone' && kind !== 'module')) return null

  return {
    kind,
    target,
    // Absent means default. Only an array is an override, so a malformed
    // payload can never silently narrow a route to nobody.
    roleIds: Array.isArray(r.roleIds) ? strings(r.roleIds) : null,
  }
}

function toDelay(value: unknown): EscalationDelay {
  return ESCALATION_DELAYS.find((delay) => delay === value) ?? 15
}

function toSettings(payload: Record<string, unknown> | null): NotificationSettings | null {
  if (!payload) return null

  const escalation =
    typeof payload.escalation === 'object' && payload.escalation !== null
      ? (payload.escalation as Record<string, unknown>)
      : {}

  return {
    routes: (Array.isArray(payload.routes) ? payload.routes : [])
      .map(toRoute)
      .filter((route): route is NotificationRoute => route !== null),
    escalation: {
      // Anything but an explicit `true` is off. An escalation the browser is
      // unsure about must not be drawn as running.
      enabled: escalation.enabled === true,
      afterMinutes: toDelay(escalation.afterMinutes),
      roleIds: strings(escalation.roleIds),
    },
  }
}

async function realGet(): Promise<SettingsResult> {
  let response: Response
  try {
    response = await fetch('/api/org/notifications', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const settings = toSettings(await readObject(response))
  return settings ? { ok: true, settings } : { ok: false, code: 'unavailable' }
}

async function realWrite(path: string, body: unknown): Promise<WriteResult> {
  let response: Response
  try {
    response = await fetch(path, { method: 'PUT', ...json(body) })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  // Checked on the server as well as here. The read-only page is a courtesy;
  // this is the answer that counts.
  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const settings = toSettings(await readObject(response))
  return settings ? { ok: true, settings } : { ok: false, code: 'unavailable' }
}

function realSetRoute(
  kind: RouteKind,
  target: string,
  roleIds: string[] | null,
): Promise<WriteResult> {
  return realWrite('/api/org/notifications/routes', { kind, target, roleIds })
}

function realSetEscalation(policy: EscalationPolicy): Promise<WriteResult> {
  return realWrite('/api/org/notifications/escalation', policy)
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/org/notifications is live                      */
/* -------------------------------------------------------------------------- */

/**
 * An organisation starts with no overrides at all, and escalation off.
 *
 * Deliberately not seeded with a plausible-looking routing table. The default
 * *is* the product's answer — everyone who can see alerts is told about the
 * alerts their role reaches — and a mock that arrived pre-narrowed would
 * suggest that setting this up is a step somebody has to complete before
 * notifications work. It is not. Overrides are for the organisation that wants
 * something narrower, and until one does there is nothing stored.
 *
 * Escalation is off for the same reason it is off in the product: it changes
 * who is woken up, and nothing that consequential should arrive switched on.
 */
const MOCK_DELAY = { read: 400, write: 600 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let store: NotificationSettings | null = null

function settings(): NotificationSettings {
  store ??= {
    routes: [],
    escalation: { enabled: false, afterMinutes: 15, roleIds: [] },
  }
  return store
}

/** A copy, so a caller holding the result cannot write through it. */
function snapshot(): NotificationSettings {
  const current = settings()
  return {
    routes: current.routes.map((route) => ({
      ...route,
      roleIds: route.roleIds === null ? null : [...route.roleIds],
    })),
    escalation: { ...current.escalation, roleIds: [...current.escalation.roleIds] },
  }
}

async function mockGet(): Promise<SettingsResult> {
  await wait(MOCK_DELAY.read)
  return { ok: true, settings: snapshot() }
}

async function mockSetRoute(
  kind: RouteKind,
  target: string,
  roleIds: string[] | null,
): Promise<WriteResult> {
  await wait(MOCK_DELAY.write)
  const current = settings()

  const others = current.routes.filter(
    (route) => !(route.kind === kind && route.target === target),
  )

  // Back to default is a deletion, not a stored `null`. A row that says "this
  // is the default" and a row that is absent must not both exist, or the next
  // reader has two ways to spell the same thing.
  current.routes =
    roleIds === null ? others : [...others, { kind, target, roleIds: [...roleIds] }]

  return { ok: true, settings: snapshot() }
}

/**
 * Rewrites the zone routes a rename or a merge touches.
 *
 * Exported for the zones mock — see the note on `mockRewriteCameraZone`. The
 * *decision* about what the merged route should be is not made here: it is made
 * by `mergeRoute` in `lib/zones/references.ts`, which is pure and tested,
 * because "who is still notified after this" is exactly the kind of rule that
 * must not live inside a mock. This only applies the answer.
 *
 * `roleIds` of `null` removes the row, which is how the default is stored —
 * absent, never a stored null. See `mockSetRoute`.
 */
export function mockRewriteRouteZone(
  from: string,
  to: string,
  roleIds: string[] | null,
): void {
  const current = settings()

  const others = current.routes.filter(
    (route) => !(route.kind === 'zone' && (route.target === from || route.target === to)),
  )

  current.routes =
    roleIds === null
      ? others
      : [...others, { kind: 'zone', target: to, roleIds: [...roleIds] }]
}

async function mockSetEscalation(policy: EscalationPolicy): Promise<WriteResult> {
  await wait(MOCK_DELAY.write)
  const current = settings()

  current.escalation = {
    enabled: policy.enabled,
    afterMinutes: policy.afterMinutes,
    roleIds: [...policy.roleIds],
  }
  return { ok: true, settings: snapshot() }
}
