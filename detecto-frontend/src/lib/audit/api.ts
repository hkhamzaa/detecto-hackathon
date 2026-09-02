import { listAlerts, type Alert } from '@/lib/alerts/api'
import { detectionLabel } from '@/lib/alerts/labels'
import { USE_MOCKS } from '@/lib/config/mocks'
import { useAuthStore } from '@/store/auth-store'

/**
 * The record of what people did in this organisation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS IS NOT THE DURABLE RECORD, AND IT CANNOT BE MADE INTO ONE HERE
 *
 * There is no audit-event endpoint. Every feature in this product has its own
 * API — roles, cameras, modules, notifications, alerts — and none of them
 * writes an event anybody can read back. The feed below is assembled in a dev
 * mock so the page has the right shape to build against. It is not a log.
 *
 * A real audit log has to be written on the server, by the same transaction
 * that performs the action, to an append-only store. Not for tidiness — because
 * of three things a browser physically cannot do:
 *
 *   1. COMPLETENESS. A log the client assembles can only contain what this
 *      client was told about. An action taken by a colleague in another
 *      session, from the mobile app, by an API token, or by Detecto's own
 *      support staff would simply never appear — and an audit log with silent
 *      gaps is worse than none, because somebody will rely on it.
 *   2. INTEGRITY. Append-only means the writer cannot go back. Anything the
 *      browser holds can be edited by whoever holds it before it is passed on,
 *      and there is nothing to check a copy against.
 *   3. TIME. Entries would be stamped with the clock of the machine that
 *      happened to be looking, which is not evidence of when anything happened.
 *
 * The page says all of this on screen, above the table, in those words. It must
 * never be reworded into something that implies these entries are kept.
 *
 * Endpoint when it exists: GET /api/org/audit — server-paginated and
 * server-filtered, because a compliance customer's real log is far larger than
 * anything worth sending to a page.
 *
 * WHAT IS REAL IN HERE TODAY
 *
 * The alert decisions are. They are read from the alert store rather than
 * invented, so every one of them references a detection that exists and links
 * to a page that opens — see `entriesFromAlerts`. Everything else is seeded.
 * Even the real ones are incomplete as audit events: an `Alert` carries who
 * decided it, and not what that person was allowed to do at the time, because
 * it was never designed to be an audit record. That gap is on the page too.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every action worth recording, named after the thing it happened to.
 *
 * Deliberately a closed list of real operations rather than a generic
 * "activity" type. Each one corresponds to a function that already exists in
 * this app — `saveRole`, `deleteRole`, `invitePerson`, `setCameraModule`,
 * `setZoneModule`, `setRoute`, `setEscalation`, `confirmAlert`, `dismissAlert`,
 * `editCamera`, `saveOrgSettings`, `login`, `logout`, `renameZone`, `mergeZones`,
 * `requestPlanChange`, `withdrawPlanChange`, `setTenantStatus`, `setTenantNote`
 * — so the log describes what the product can actually do, and adding a row
 * here means somebody added a capability rather than a label.
 */
export type AuditAction =
  | 'role.created'
  | 'role.edited'
  | 'role.deleted'
  | 'person.invited'
  | 'person.role_changed'
  | 'person.deactivated'
  | 'person.reactivated'
  | 'camera.added'
  | 'camera.removed'
  | 'module.enabled'
  | 'module.disabled'
  | 'module.zone_bulk'
  | 'notifications.routing_changed'
  | 'notifications.escalation_changed'
  | 'alert.confirmed'
  | 'alert.dismissed'
  | 'camera.updated'
  | 'org.settings_changed'
  | 'auth.logged_in'
  | 'auth.logged_out'
  | 'auth.password_changed'
  | 'zone.renamed'
  | 'zone.merged'
  | 'billing.plan_change_requested'
  | 'billing.plan_change_withdrawn'
  | 'platform.tenant_suspended'
  | 'platform.tenant_reactivated'
  | 'platform.support_note_changed'

export const AUDIT_ACTIONS: AuditAction[] = [
  'role.created',
  'role.edited',
  'role.deleted',
  'person.invited',
  'person.role_changed',
  'person.deactivated',
  'person.reactivated',
  'camera.added',
  'camera.removed',
  'module.enabled',
  'module.disabled',
  'module.zone_bulk',
  'notifications.routing_changed',
  'notifications.escalation_changed',
  'alert.confirmed',
  'alert.dismissed',
  'camera.updated',
  'org.settings_changed',
  'auth.logged_in',
  'auth.logged_out',
  'auth.password_changed',
  'zone.renamed',
  'zone.merged',
  'billing.plan_change_requested',
  'billing.plan_change_withdrawn',
  'platform.tenant_suspended',
  'platform.tenant_reactivated',
  'platform.support_note_changed',
]

/**
 * Who did it, captured when they did it.
 *
 * `roleName` is a string on the entry and never a reference to a live `Role`,
 * and that is the whole design. Roles get renamed, edited and deleted; an entry
 * that resolved its role at read time would quietly change what it said about
 * the past, or lose it altogether the day somebody tidied up. "Deleted the
 * Night shift role" has to still say who held what when it is read next year,
 * and a foreign key cannot promise that.
 */
export type AuditActor = {
  id: string
  name: string
  /**
   * The role they held at the time. Null when the action came from a record
   * that did not capture one — see the note about alerts at the top of this
   * file. Never guessed at from their role today.
   *
   * For a `platform.*` entry, this is never null and never a real org role —
   * it's a literal string like `"Detecto Platform"`. Those entries are
   * written by a super admin, who holds no role in the org they land on;
   * the literal string is what makes one visually distinct from an
   * org-internal actor at a glance, rather than reading as an ordinary
   * member whose role happened to go missing.
   */
  roleName: string | null
}

export type AuditEntry = {
  id: string
  at: string
  actor: AuditActor
  action: AuditAction
  /**
   * What changed, in the words a customer would use — the same register as the
   * role summaries in `lib/roles/permissions.ts`, never a field-level diff. A
   * person reading this needs to know what happened, not which key changed.
   */
  summary: string
  /** The consequence, or the decision behind it. Nothing that repeats `summary`. */
  detail: string[]
  /** The detection this decided, when the action was one. Links to the alert. */
  alertId: string | null
}

export type AuditResult =
  | { ok: true; entries: AuditEntry[] }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Read-only, and the only function this module will ever export.
 *
 * There is no `record`, no `write` and no `delete`. A log the client can append
 * to is not a log, and one it can delete from is evidence of nothing.
 */
export function getAuditLog(): Promise<AuditResult> {
  return USE_MOCKS ? mockLog() : realLog()
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function toEntry(value: unknown): AuditEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const e = value as Record<string, unknown>

  const id = str(e.id)
  const at = str(e.at)
  const action = str(e.action)
  const summary = str(e.summary)
  if (!id || !at || !summary) return null
  // An action this build has never heard of is dropped rather than rendered as
  // a bare string: an audit row nobody can read is not evidence, and guessing
  // at what it meant would be worse.
  if (!action || !AUDIT_ACTIONS.includes(action as AuditAction)) return null

  const actor =
    typeof e.actor === 'object' && e.actor !== null
      ? (e.actor as Record<string, unknown>)
      : {}

  return {
    id,
    at,
    actor: {
      id: str(actor.id) ?? '',
      // Somebody must be named. An entry that cannot say who acted is not one.
      name: str(actor.name) ?? 'Unknown account',
      roleName: str(actor.roleName),
    },
    action: action as AuditAction,
    summary,
    detail: strings(e.detail),
    alertId: str(e.alertId),
  }
}

async function realLog(): Promise<AuditResult> {
  let response: Response
  try {
    response = await fetch('/api/org/audit', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, code: 'unavailable' }
  }

  const payload = data as Record<string, unknown>
  if (!Array.isArray(payload.entries)) return { ok: false, code: 'unavailable' }

  return {
    ok: true,
    entries: payload.entries
      .map(toEntry)
      .filter((entry): entry is AuditEntry => entry !== null)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/org/audit is live                              */
/* -------------------------------------------------------------------------- */

const HOUR = 60 * 60_000
const MOCK_DELAY = 450

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The people who did things, and what they held when they did them.
 *
 * `Rota lead` and `Night shift` are the important ones: neither exists in the
 * roles mock, because both were edited away afterwards. An entry naming a role
 * nobody can look up is not a bug in this feed — it is the reason the role name
 * is a snapshot on the entry rather than a link to a live record.
 */
const ACTORS: Record<string, AuditActor> = {
  ade: { id: 'usr_ade', name: 'Ade Okafor', roleName: 'Admin' },
  rhea: { id: 'usr_rhea', name: 'Rhea Mehta', roleName: 'Site supervisor' },
  tomas: { id: 'usr_tomas', name: 'Tomas Bergstrom', roleName: 'Rota lead' },
  joan: { id: 'usr_joan', name: 'Joan Whitfield', roleName: 'Night shift' },
  /**
   * Never a member of this org — see the note on `AuditActor.roleName`.
   * `roleName` is the literal string a `platform.*` entry always carries,
   * never null and never a role this org actually has.
   */
  support: { id: 'usr_platform_support', name: 'Priya Shah', roleName: 'Detecto Platform' },
}

/**
 * Actions that leave no trace anywhere else in the product.
 *
 * Seeded, and that is the honest description: a role edited last Tuesday is
 * gone from `lib/roles/api.ts` the moment it is edited, because that module
 * stores current state and no history behind it. Every one of these corresponds
 * to a real operation the app can perform; none of them is recoverable from
 * what the app actually keeps, which is precisely the argument for a server-side
 * event stream.
 *
 * Spread across three weeks so a date filter has something to bite on, and
 * ordered oldest-first here for readability — the feed sorts on the way out.
 */
const SEEDED: {
  actor: keyof typeof ACTORS
  action: AuditAction
  hoursAgo: number
  summary: string
  detail?: string[]
}[] = [
  {
    actor: 'ade',
    action: 'auth.logged_in',
    hoursAgo: 23 * 24,
    summary: 'Signed in',
  },
  {
    actor: 'ade',
    action: 'camera.added',
    hoursAgo: 22 * 24,
    summary: 'Added 4 cameras from a newly paired Detecto Box',
    detail: [
      'Main entrance and West corridor to Front of house; Loading bay and Gate to Yard.',
      'Connecting a camera does not switch detection on — that was done separately.',
    ],
  },
  {
    actor: 'ade',
    action: 'zone.renamed',
    hoursAgo: 21 * 24 + 6,
    summary: 'Renamed the zone "West corridor" to "Level 2"',
    detail: ['2 cameras moved.', '1 role updated.'],
  },
  {
    actor: 'ade',
    action: 'role.created',
    hoursAgo: 21 * 24 + 3,
    summary: 'Created the role Night shift',
    detail: ['Can see the alert queue and confirm alerts.', 'Yard only.'],
  },
  {
    actor: 'ade',
    action: 'person.invited',
    hoursAgo: 21 * 24 + 2,
    summary: 'Invited joan.whitfield@northgate.com as Night shift',
    detail: ['An invitation gives no access until it is accepted.'],
  },
  {
    actor: 'ade',
    action: 'module.zone_bulk',
    hoursAgo: 20 * 24,
    summary: 'Turned Weapon detection on for every camera in Yard',
    detail: ['2 cameras changed. Nothing in the zone already had it.'],
  },
  {
    actor: 'rhea',
    action: 'module.enabled',
    hoursAgo: 19 * 24 + 6,
    summary: 'Turned Violence detection on for Loading bay',
  },
  {
    actor: 'rhea',
    action: 'module.disabled',
    hoursAgo: 16 * 24 + 4,
    summary: 'Turned Violence detection off for Main entrance',
    detail: [
      'That camera stopped being watched for violence at this point, and nothing was flagged from it until it was turned back on.',
    ],
  },
  {
    actor: 'tomas',
    action: 'notifications.routing_changed',
    hoursAgo: 14 * 24,
    summary: 'Narrowed Yard alerts to the Yard team',
    detail: [
      'Everyone who could see alerts was notified about the Yard before this; now 2 people are.',
      'Nothing is delivered from these routes yet.',
    ],
  },
  {
    actor: 'tomas',
    action: 'notifications.escalation_changed',
    hoursAgo: 14 * 24 - 1,
    summary: 'Turned escalation on: unreviewed alerts also notify Control room after 15 minutes',
    detail: [
      'Escalation notifies a colleague. It does not contact an emergency service.',
    ],
  },
  {
    actor: 'ade',
    action: 'module.enabled',
    hoursAgo: 11 * 24 + 2,
    summary: 'Turned Violence detection back on for Main entrance',
  },
  {
    actor: 'ade',
    action: 'org.settings_changed',
    hoursAgo: 10 * 24,
    summary: 'Changed organisation settings',
    detail: ['Idle timeout is now 30 minutes.'],
  },
  {
    actor: 'ade',
    action: 'role.edited',
    hoursAgo: 9 * 24,
    summary: 'Edited the role Night shift',
    detail: [
      'Was: can see the alert queue and confirm alerts. Now: can see the alert queue.',
      'Confirming an alert is the only permission that can begin an escalation, and this took it away from 1 person.',
    ],
  },
  {
    actor: 'rhea',
    action: 'camera.removed',
    hoursAgo: 8 * 24 + 5,
    summary: 'Removed the camera Gate from Yard',
    detail: ['Detections already raised by it are kept, and so are the decisions on them.'],
  },
  {
    actor: 'ade',
    action: 'person.role_changed',
    hoursAgo: 6 * 24,
    summary: 'Moved Rhea Mehta from Night shift to Site supervisor',
  },
  {
    actor: 'ade',
    action: 'role.deleted',
    hoursAgo: 6 * 24 - 1,
    summary: 'Deleted the role Night shift',
    detail: [
      '1 person was moved to Site supervisor and keeps everything that role allows.',
      'Nobody was left without a role.',
    ],
  },
  {
    actor: 'ade',
    action: 'billing.plan_change_requested',
    hoursAgo: 5 * 24 + 2,
    summary: 'Requested a move to Estate',
    detail: ['Currently on Site.', 'No charge has been made — this is a request only.'],
  },
  {
    actor: 'support',
    action: 'platform.support_note_changed',
    hoursAgo: 5 * 24 + 1,
    summary: 'Support note updated by Detecto',
    detail: ['Not shown to anyone on this account. Visible to Detecto staff only.'],
  },
  {
    actor: 'ade',
    action: 'person.deactivated',
    hoursAgo: 4 * 24 + 7,
    summary: 'Turned off access for Joan Whitfield',
    detail: [
      'Their account and everything they confirmed are kept — access can be turned back on.',
    ],
  },
  {
    actor: 'rhea',
    action: 'notifications.routing_changed',
    hoursAgo: 2 * 24 + 3,
    summary: 'Put Front of house alerts back to everyone who can see alerts',
  },
  {
    actor: 'ade',
    action: 'person.reactivated',
    hoursAgo: 20,
    summary: 'Turned access back on for Joan Whitfield',
  },
]

/**
 * The alert decisions, read from the alert store rather than invented.
 *
 * This is the part of the feed that is not made up: every entry references a
 * detection that exists, and the id links to a page that opens. Duplicating the
 * decisions into this mock would have let the two drift, and an audit log that
 * disagrees with the queue it is describing is worse than no audit log.
 *
 * `roleName` is null on purpose, and it is not laziness. `Alert` records
 * `decidedBy` — a name — and nothing about what that person was allowed to do
 * at the time, because it is a detection record and was never meant to be an
 * audit event. The page shows the gap rather than filling it with their role
 * today, which would be a claim about the past that nobody checked.
 */
function entriesFromAlerts(alerts: Alert[]): AuditEntry[] {
  return alerts
    .filter((alert) => alert.status !== 'unconfirmed' && alert.decidedAt !== null)
    .map((alert) => ({
      id: `aud_alert_${alert.id}`,
      at: alert.decidedAt as string,
      actor: {
        id: `usr_${(alert.decidedBy ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        name: alert.decidedBy ?? 'Unknown account',
        roleName: null,
      },
      action: (alert.status === 'confirmed'
        ? 'alert.confirmed'
        : 'alert.dismissed') as AuditAction,
      summary:
        alert.status === 'confirmed'
          ? `Confirmed ${alert.id} — ${detectionLabel(alert)} on ${alert.cameraName}`
          : `Marked ${alert.id} a false positive — ${detectionLabel(alert)} on ${alert.cameraName}`,
      detail:
        alert.status === 'confirmed'
          ? [
              'Confirming records that a person took responsibility for the detection. Detecto contacted nobody.',
            ]
          : [],
      alertId: alert.id,
    }))
}

async function mockLog(): Promise<AuditResult> {
  const alerts = await listAlerts()
  await wait(MOCK_DELAY)

  const now = Date.now()
  // `SEEDED` is oldest-first, so the counter ascends with time the way an
  // append-only log's does. The feed is sorted newest-first for reading; the
  // ids are not, because they are the order things actually happened in.
  const seeded: AuditEntry[] = SEEDED.map((entry, index) => ({
    id: `aud_${String(index + 1).padStart(4, '0')}`,
    at: new Date(now - entry.hoursAgo * HOUR).toISOString(),
    actor: ACTORS[entry.actor],
    action: entry.action,
    summary: entry.summary,
    detail: entry.detail ?? [],
    alertId: null,
  }))

  return {
    ok: true,
    entries: [...seeded, ...(alerts.ok ? entriesFromAlerts(alerts.alerts) : [])].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at),
    ),
  }
}
