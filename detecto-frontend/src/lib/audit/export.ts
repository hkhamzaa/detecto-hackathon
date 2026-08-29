import type { AuditEntry } from '@/lib/audit/api'
import { actionLabel } from '@/lib/audit/filter'
import { csvFilename, saveCsv, toCsv } from '@/lib/csv'

/**
 * The log as a file somebody hands to an auditor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME WARNING AS THE ANALYTICS EXPORT, AND IT MATTERS MORE HERE
 *
 * `lib/analytics/export.ts` says a client-built CSV cannot carry provenance and
 * has to become a server-side job. Every word of that applies to this file, and
 * this one is worse on two counts:
 *
 *   1. The analytics export at least writes out records the backend produced.
 *      This writes out a feed with no backend behind it at all — see the header
 *      of `lib/audit/api.ts`. A file that looks like an audit export and was
 *      assembled from a dev mock is the most misleading artefact this codebase
 *      could produce, so the page says what it is before offering the button.
 *   2. Exporting an audit log is itself an auditable event. It is the one
 *      export where somebody will later ask who took a copy, and nothing here
 *      records that — because there is nothing to record it to. On the page
 *      that exists to answer exactly that question, the gap is worth stating
 *      out loud rather than filing under "later".
 *
 * Endpoint when it exists: POST /api/org/audit/export → a job id, then a signed
 * download URL, and an audit entry for the export itself.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The field quoting and the formula-injection guard come from `lib/csv.ts`,
 * shared with the analytics export. Role names and camera names in here are
 * typed by customers and land in the same spreadsheet, so they need the same
 * guard — written once, not twice.
 */

const COLUMNS = [
  'entry_id',
  'logged_at',
  'actor_name',
  'actor_role_at_the_time',
  'action',
  'action_label',
  'summary',
  'detail',
  'alert_id',
] as const

export function buildAuditCsv(entries: AuditEntry[]): string {
  return toCsv([
    [...COLUMNS],
    ...entries.map((entry) => [
      entry.id,
      entry.at,
      entry.actor.name,
      // Empty, never the role they hold today. A blank cell is a fact about
      // what was captured; today's role would be a claim about the past.
      entry.actor.roleName,
      entry.action,
      actionLabel(entry.action),
      entry.summary,
      // One cell, so a row stays a row. The reader gets the sentences whole.
      entry.detail.join(' '),
      entry.alertId,
    ]),
  ])
}

/** `detecto-audit-log-2026-08-27.csv`. */
export function auditFilename(now = new Date()): string {
  return csvFilename('audit-log', now)
}

export function downloadAuditCsv(
  entries: AuditEntry[],
  filename = auditFilename(),
): void {
  saveCsv(buildAuditCsv(entries), filename)
}
