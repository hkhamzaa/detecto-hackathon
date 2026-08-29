import type { Alert } from '@/lib/alerts/api'
import { statusLabel } from '@/lib/alerts/labels'
import { decidedOnly, minutesToDecision } from '@/lib/analytics/stats'
import { csvFilename, saveCsv, toCsv } from '@/lib/csv'

/**
 * The analytics window as a file somebody outside Detecto can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT A REAL EXPORT PIPELINE. The file is assembled in the browser from
 * whatever the page already fetched, which is wrong for the customers who need
 * it most. Before this ships it has to be wired to a real export service, for
 * three reasons that are not solvable here:
 *
 *   1. Scope. This can only export rows the browser was sent. An enterprise
 *      account's real reporting window is larger than anything worth loading
 *      into a page, so the honest export is a server-side job over the whole
 *      range, delivered when it is done.
 *   2. Provenance. A compliance or government customer handing this to an
 *      auditor needs the file to be attributable — signed or checksummed,
 *      stamped with the org, the range, and the account that asked for it.
 *      A blob built client-side can be edited before it is sent on, and there
 *      is nothing to check it against.
 *   3. Record. Exporting a detection record is itself an auditable event and
 *      belongs in the audit log. Nothing here writes one, because nothing here
 *      reaches the backend at all.
 *
 * Endpoint when it exists: POST /api/analytics/export → a job id, then a signed
 * download URL. Keep this function as the fallback for nothing more than a dev
 * build without a backend.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CSV, not PDF, for this pass. It is the format an auditor can actually re-add
 * up, it holds one row per detection rather than a picture of a chart, and it
 * is the one of the two that can be generated honestly without a rendering
 * service. A paginated PDF — the charts, the summary and the org's name on
 * headed pages — is the follow-up, and belongs to the same server-side job
 * described above rather than to a second client-side implementation.
 */

const COLUMNS = [
  'alert_id',
  'detected_at',
  'camera_id',
  'camera_name',
  'zone',
  'module',
  'subtype',
  'confidence',
  'model',
  'status',
  'decided_by',
  'decided_at',
  'minutes_to_decision',
] as const

/**
 * Field quoting, the formula-injection guard and the file handoff live in
 * `lib/csv.ts`, shared with the audit log export. The guard in particular is a
 * security control, and one implementation is the point.
 */
export function buildCsv(alerts: Alert[]): string {
  const decidedMinutes = new Map(
    decidedOnly(alerts).map((alert) => [alert.id, Math.round(minutesToDecision(alert))]),
  )

  return toCsv([
    [...COLUMNS],
    ...alerts.map((alert) => [
      alert.id,
      alert.detectedAt,
      alert.cameraId,
      alert.cameraName,
      alert.zone,
      alert.kind,
      alert.subtype,
      // Two decimals, matching every other surface that prints a score.
      alert.confidence.toFixed(2),
      alert.model,
      statusLabel(alert.status),
      alert.decidedBy,
      alert.decidedAt,
      decidedMinutes.get(alert.id) ?? null,
    ]),
  ])
}

/** `detecto-alerts-2026-08-27.csv` — dated, so two exports never collide. */
export function exportFilename(now = new Date()): string {
  return csvFilename('alerts', now)
}

export function downloadCsv(alerts: Alert[], filename = exportFilename()): void {
  saveCsv(buildCsv(alerts), filename)
}
