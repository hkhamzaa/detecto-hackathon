import type { AuditAction, AuditActor, AuditEntry } from '@/lib/audit/api'

/**
 * Finding one thing in the log.
 *
 * This is not a page people browse. Somebody opens it because an auditor asked
 * a question — who changed that role, when did that camera come off, who
 * dismissed that detection — and leaves once they have the answer. So the
 * filters are the page, and they are pure functions here so they can be tested
 * against awkward input rather than clicked through.
 */

/* -------------------------------------------------------------------------- */
/* Action groups                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Sixteen actions is too many to choose from and six areas is about right, so
 * the filter offers the area and the table shows the action. The group is the
 * prefix of the action id, which means a new action joins its group by being
 * named correctly rather than by being added to a second list that could
 * disagree with the first.
 */
export type ActionGroup =
  | 'role'
  | 'person'
  | 'camera'
  | 'module'
  | 'notifications'
  | 'alert'

export const ACTION_GROUPS: { id: ActionGroup; label: string }[] = [
  { id: 'role', label: 'Roles and permissions' },
  { id: 'person', label: 'People' },
  { id: 'camera', label: 'Cameras' },
  { id: 'module', label: 'Detection modules' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'alert', label: 'Alert decisions' },
]

export function groupOf(action: AuditAction): ActionGroup {
  return action.split('.')[0] as ActionGroup
}

export function isActionGroup(value: string | null): value is ActionGroup {
  return ACTION_GROUPS.some((group) => group.id === value)
}

/** What one entry is called in the table. Plain words, never the raw id. */
const ACTION_LABEL: Record<AuditAction, string> = {
  'role.created': 'Role created',
  'role.edited': 'Role edited',
  'role.deleted': 'Role deleted',
  'person.invited': 'Person invited',
  'person.role_changed': 'Role changed',
  'person.deactivated': 'Access turned off',
  'person.reactivated': 'Access turned on',
  'camera.added': 'Camera added',
  'camera.removed': 'Camera removed',
  'module.enabled': 'Detection turned on',
  'module.disabled': 'Detection turned off',
  'module.zone_bulk': 'Detection changed for a zone',
  'notifications.routing_changed': 'Notification routing changed',
  'notifications.escalation_changed': 'Escalation changed',
  'alert.confirmed': 'Alert confirmed',
  'alert.dismissed': 'Alert dismissed',
}

export function actionLabel(action: AuditAction): string {
  return ACTION_LABEL[action]
}

/* -------------------------------------------------------------------------- */
/* The filter                                                                 */
/* -------------------------------------------------------------------------- */

export type AuditFilter = {
  /** An actor id, or null for anybody. */
  actorId: string | null
  group: ActionGroup | null
  /** `YYYY-MM-DD`, inclusive. Null for no bound. */
  from: string | null
  to: string | null
  /** Free text over the words on the row. Empty for no search. */
  query: string
}

export const NO_FILTER: AuditFilter = {
  actorId: null,
  group: null,
  from: null,
  to: null,
  query: '',
}

export function isFiltered(filter: AuditFilter): boolean {
  return (
    filter.actorId !== null ||
    filter.group !== null ||
    filter.from !== null ||
    filter.to !== null ||
    filter.query.trim() !== ''
  )
}

/**
 * The day boundaries a person means when they type a date.
 *
 * `from` is midnight at the start of that day and `to` is the last millisecond
 * of it, both in the reader's own timezone — because somebody asking for "the
 * 14th" means their 14th, and an audit answer that quietly used UTC would drop
 * the evening of the day they asked about. Returned as numbers so the caller
 * compares against `Date.parse` once per entry rather than per bound.
 */
function boundsOf(filter: AuditFilter): { start: number; end: number } {
  const start = filter.from ? startOfDay(filter.from) : Number.NEGATIVE_INFINITY
  const end = filter.to ? endOfDay(filter.to) : Number.POSITIVE_INFINITY
  return { start, end }
}

function parts(day: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  return [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
}

function startOfDay(day: string): number {
  const p = parts(day)
  // An unparseable bound is no bound. A date field somebody is halfway through
  // typing must not empty the table under them.
  return p ? new Date(p[0], p[1], p[2], 0, 0, 0, 0).getTime() : Number.NEGATIVE_INFINITY
}

function endOfDay(day: string): number {
  const p = parts(day)
  return p
    ? new Date(p[0], p[1], p[2], 23, 59, 59, 999).getTime()
    : Number.POSITIVE_INFINITY
}

/** Everything on the row a search should look at, lowercased once. */
function haystack(entry: AuditEntry): string {
  return [
    entry.actor.name,
    entry.actor.roleName ?? '',
    actionLabel(entry.action),
    entry.summary,
    ...entry.detail,
    entry.alertId ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

/**
 * The filtered log, newest first.
 *
 * Every clause narrows; none of them reorders. Somebody checking a date range
 * against a colleague's account is reading two filtered views of one list, and
 * a filter that also changed the order would make that comparison harder than
 * it needs to be.
 */
export function applyFilter(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  const { start, end } = boundsOf(filter)
  const query = filter.query.trim().toLowerCase()

  return entries.filter((entry) => {
    if (filter.actorId !== null && entry.actor.id !== filter.actorId) return false
    if (filter.group !== null && groupOf(entry.action) !== filter.group) return false

    const at = Date.parse(entry.at)
    if (Number.isNaN(at) || at < start || at > end) return false

    return query === '' || haystack(entry).includes(query)
  })
}

/**
 * Everybody who appears in the log, for the person filter.
 *
 * Drawn from the entries themselves rather than from the current directory, and
 * that is deliberate: the people worth filtering by include the ones who have
 * since been deactivated or removed, and they are frequently the reason
 * somebody opened this page.
 */
export function actorsIn(entries: AuditEntry[]): AuditActor[] {
  const byId = new Map<string, AuditActor>()
  for (const entry of entries) {
    if (!byId.has(entry.actor.id)) byId.set(entry.actor.id, entry.actor)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}
