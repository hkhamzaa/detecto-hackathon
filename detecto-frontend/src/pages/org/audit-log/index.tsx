import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AuditEntry } from '@/lib/audit/api'
import { auditFilename, downloadAuditCsv } from '@/lib/audit/export'
import {
  actionLabel,
  actorsIn,
  applyFilter,
  isActionGroup,
  isFiltered,
  type AuditFilter,
} from '@/lib/audit/filter'
import { useAuditLog } from '@/lib/audit/queries'
import { can } from '@/lib/auth/claims'
import { formatShort, formatTimestamp } from '@/lib/time'
import { cn } from '@/lib/utils'
import { AuditFilters } from '@/pages/org/audit-log/filters'
import { useAuthStore } from '@/store/auth-store'

/**
 * What people did in this organisation, and when.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS, AND WHAT IT IS NOT
 *
 * It is the view. It is not the record — there is no audit-event endpoint, and
 * nothing shown here is stored anywhere. The banner above the table says so in
 * those words, and it is the first thing on the page rather than a footnote,
 * because this is the one surface in the product where somebody might rely on
 * what they are reading in front of a regulator.
 *
 * The full argument is in the header of `lib/audit/api.ts`: a log the browser
 * assembles can only contain what this browser was told about, cannot be
 * append-only, and is stamped with whatever clock happened to be looking. Those
 * are not gaps to be closed later in this file. They are the reason the log has
 * to be written server-side, by the transaction that performs the action.
 *
 * PERMISSION
 *
 * `audit:view`, which already exists as its own grant in
 * `lib/roles/permissions.ts` and already gates this route. It is deliberately
 * not `org:settings`: reading the record and changing the settings are
 * different jobs, and a compliance officer who can see everything and change
 * nothing is a role an organisation can build here today. The check is repeated
 * against the page rather than trusted from the route — this renders an entire
 * organisation's history of who did what, and it is the right place to fail
 * closed if a gate is ever widened.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrgAuditLogPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'audit:view')

  const log = useAuditLog()
  const [searchParams, setSearchParams] = useSearchParams()

  /*
   * The filter lives in the URL, not in component state.
   *
   * This is the page whose answers get passed on — "here is what I found" in an
   * email to an auditor. A filtered view that cannot be linked to would have to
   * be described instead of shown, and the person receiving it would rebuild it
   * by hand and hope they matched.
   */
  const filter: AuditFilter = {
    actorId: searchParams.get('who'),
    group: isActionGroup(searchParams.get('action'))
      ? (searchParams.get('action') as AuditFilter['group'])
      : null,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    query: searchParams.get('q') ?? '',
  }

  const setFilter = (next: AuditFilter) => {
    const params = new URLSearchParams()
    if (next.actorId) params.set('who', next.actorId)
    if (next.group) params.set('action', next.group)
    if (next.from) params.set('from', next.from)
    if (next.to) params.set('to', next.to)
    if (next.query.trim()) params.set('q', next.query)
    // Replaced, so typing in the search box does not fill the back button with
    // a step per keystroke on the way out of the page.
    setSearchParams(params, { replace: true })
  }

  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Organisation" title="Audit log" />
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              You don't have permission to read the audit log for this
              organisation. An administrator can grant it.
            </p>
          </PanelBody>
        </Panel>
      </>
    )
  }

  const entries = log.data ?? []
  const shown = applyFilter(entries, filter)

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Audit log"
        lead="What people did in your account — permission changes, cameras and detection, notification routing, and every decision taken on a detection. Read-only, and filterable by person, action and date."
        action={
          log.isSuccess && entries.length > 0 ? (
            <ExportLog entries={shown} filtered={isFiltered(filter)} />
          ) : undefined
        }
      />

      <NotTheRecord />

      {log.isPending ? (
        <Loading />
      ) : log.isError ? (
        <Unavailable onRetry={() => void log.refetch()} pending={log.isFetching} />
      ) : entries.length === 0 ? (
        <Nothing />
      ) : (
        <>
          <AuditFilters
            filter={filter}
            actors={actorsIn(entries)}
            matching={shown.length}
            total={entries.length}
            onChange={setFilter}
          />

          {shown.length === 0 ? (
            <NoMatches onClear={() => setSearchParams(new URLSearchParams(), { replace: true })} />
          ) : (
            <Entries entries={shown} />
          )}

          <Gaps />
        </>
      )}

      <p className="max-w-2xl text-meta text-neutral-500">
        Every entry names the person who acted and the role they held at the
        time, kept as it was written. Roles get renamed and deleted; what
        somebody was allowed to do on the day they did something does not change
        afterwards, and this log should not either.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The statement that has to come first                                       */
/* -------------------------------------------------------------------------- */

/**
 * Above the table, not below it.
 *
 * An organisation could otherwise take a screenshot of this page into a
 * compliance pack believing it was a record. The placeholder this page replaced
 * promised an append-only log that nobody can edit — true of what is being
 * built, and not true of anything on screen today, so the promise is not
 * repeated here until something can keep it.
 */
function NotTheRecord() {
  return (
    <div className="mb-6 rounded-md border border-neutral-300 bg-paper-sunken px-4 py-3.5">
      <p className="max-w-2xl text-meta text-neutral-700">
        <strong className="font-medium text-ink">
          This is a view of a record that does not exist yet.
        </strong>{' '}
        Detecto has no audit-event service, so nothing below is stored: the feed
        is assembled for this page, and it can only ever contain what this
        browser was told about. Actions taken in another session, from an API
        token, or by Detecto support would not appear at all. Do not put it in a
        compliance pack, and do not treat a missing entry as evidence that
        nothing happened.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The same one plain action the analytics export offers, and the same
 * unresolved problem — stated in the line under it rather than left in a source
 * comment, because on this page the person clicking it is the person who most
 * needs to know.
 */
function ExportLog({ entries, filtered }: { entries: AuditEntry[]; filtered: boolean }) {
  const [saved, setSaved] = useState<string | null>(null)

  return (
    <div className="text-right">
      <Button
        type="button"
        variant="outline"
        disabled={entries.length === 0}
        onClick={() => {
          const filename = auditFilename()
          downloadAuditCsv(entries, filename)
          setSaved(filename)
        }}
      >
        <Download />
        Export
      </Button>

      <p role="status" aria-live="polite" className="mt-2 text-meta text-neutral-500">
        {saved ? (
          <>
            Saved <span className="font-mono text-data">{saved}</span>
          </>
        ) : (
          <>
            <span className="font-mono text-data">{entries.length}</span>{' '}
            {filtered ? 'matching entries' : 'entries'} as CSV
          </>
        )}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

function Entries({ entries }: { entries: AuditEntry[] }) {
  return (
    <Panel
      label="Entries"
      className="mb-6"
      action={
        <span className="label-micro text-neutral-500">newest first</span>
      }
    >
      {/* Below `sm` this scrolls sideways inside its own container rather than
          reflowing, the same treatment the alert queue gets: the columns are
          read against each other, and who-did-what-when stops being a sentence
          once it is broken into stacked cards. */}
      <PanelBody className="py-2 sm:py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>What changed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-right align-top font-mono text-data text-neutral-600">
                  <time dateTime={entry.at} title={formatTimestamp(entry.at)}>
                    {formatShort(entry.at)}
                  </time>
                </TableCell>

                <TableCell className="align-top">
                  <span className="block whitespace-nowrap font-medium text-ink">
                    {entry.actor.name}
                  </span>
                  {/* The role as it was written, never resolved against the
                      roles that exist now — see `AuditActor`. */}
                  <span
                    className={cn(
                      'block whitespace-nowrap',
                      entry.actor.roleName ? 'text-neutral-500' : 'text-neutral-400 italic',
                    )}
                  >
                    {entry.actor.roleName ?? 'role not recorded'}
                  </span>
                </TableCell>

                <TableCell className="align-top text-neutral-700">
                  <span className="block">{actionLabel(entry.action)}</span>
                  {entry.alertId && (
                    <Link
                      to={`/org/alerts/${entry.alertId}`}
                      className={cn(
                        'mt-0.5 inline-block font-mono text-data text-ink',
                        'underline decoration-neutral-300 underline-offset-4',
                        'transition-colors hover:decoration-current',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      )}
                    >
                      {entry.alertId}
                    </Link>
                  )}
                </TableCell>

                <TableCell className="align-top">
                  <span className="block max-w-prose text-neutral-800">
                    {entry.summary}
                  </span>
                  {entry.detail.map((line) => (
                    <span
                      key={line}
                      className="mt-1 block max-w-prose text-neutral-500"
                    >
                      {line}
                    </span>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* What is not built                                                          */
/* -------------------------------------------------------------------------- */

function Gaps() {
  return (
    <Panel label="Not built" className="mb-6">
      <PanelBody>
        <ul className="grid max-w-2xl gap-4">
          <li>
            <h3 className="text-meta font-medium text-ink">
              No audit-event service, so nothing is kept
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Each feature in Detecto has its own API and none of them writes an
              event. A real log is written on the server by the same transaction
              that performs the action, to a store nobody can go back and edit.
              It cannot be assembled from the client afterwards: this browser
              only ever sees what it was told, so an action taken elsewhere would
              leave no trace here at all.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              Alert decisions do not record what the person was allowed to do
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              The decisions here are read from the real detection records rather
              than invented, which is why each one links to the alert it decided.
              A detection record carries who decided it and not the role they
              held, because it was never meant to be an audit event — so those
              rows say the role was not recorded, instead of filling the gap with
              whatever that person's role happens to be today.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              The export carries no provenance, and logs nothing
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              The CSV is built in this browser, so it cannot be signed,
              checksummed or attributed, and it can be edited before anybody
              passes it on. Taking a copy of an audit log is itself an auditable
              event — the one export where somebody will later ask who took it —
              and nothing records that, because there is nothing to record it to.
              Both need the same server-side job the analytics export needs.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              Everything is filtered and drawn in the browser
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Every entry is loaded at once and narrowed here. A real
              organisation's log runs to hundreds of thousands of rows, which
              means server-side filtering, paging and a retention window the plan
              actually promises — none of which is decided yet.
            </p>
          </li>
        </ul>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Audit log">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading the record…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load the audit log" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds your account's history.
          Nothing has been lost — this is the reader, not the record. Detection
          is unaffected, and everything anybody has done is still what they did.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={onRetry}
          disabled={pending}
        >
          {pending ? 'Trying again…' : 'Try again'}
        </Button>
      </PanelBody>
    </Panel>
  )
}

/** Nothing recorded at all — a brand new account, before anybody has done anything. */
function Nothing() {
  return (
    <Panel label="Nothing recorded yet">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          Nobody has done anything in this account yet. Inviting somebody,
          connecting a camera, switching a detection module on and deciding an
          alert all appear here as they happen.
        </p>
      </PanelBody>
    </Panel>
  )
}

/**
 * Filtered down to nothing.
 *
 * Deliberately a different panel from "nothing recorded yet". On a page where
 * somebody is checking whether an action happened, "no results" and "no record"
 * are answers with completely different consequences, and a shared empty state
 * would let one be read as the other.
 */
function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <Panel label="No entries match" className="mb-6">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          Nothing in the log matches those filters. That is not the same as
          nothing having happened — widen the dates or clear the filters to see
          everything this page has.
        </p>
        <Button type="button" variant="outline" className="mt-5" onClick={onClear}>
          Clear filters
        </Button>
      </PanelBody>
    </Panel>
  )
}
