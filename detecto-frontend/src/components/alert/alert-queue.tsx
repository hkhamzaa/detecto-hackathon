import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { AlertStatus } from '@/components/alert/alert-status'
import { PipelineBadge } from '@/components/alert/pipeline-badge'
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
import type { Alert, AlertStatus as Status } from '@/lib/alerts/api'
import { confidenceLabel, detectionLabel } from '@/lib/alerts/labels'
import { useLiveAlerts } from '@/lib/alerts/live'
import { useAlerts } from '@/lib/alerts/queries'
import { formatShort, formatTimestamp } from '@/lib/time'
import { cn } from '@/lib/utils'

type Segment = Status | 'all'

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'unconfirmed', label: 'Awaiting human' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dismissed', label: 'False positive' },
  { value: 'all', label: 'All' },
]

const DEFAULT_SEGMENT: Segment = 'unconfirmed'

function isSegment(value: string | null): value is Segment {
  return SEGMENTS.some((segment) => segment.value === value)
}

/**
 * Unreviewed first, then newest first.
 *
 * The status term is not a tie-break, it is the point: nothing should sit
 * waiting on a person because it happened to be raised on a quiet afternoon and
 * got pushed down the page by things that have already been dealt with.
 */
function byUrgency(a: Alert, b: Alert) {
  const waiting = (alert: Alert) => (alert.status === 'unconfirmed' ? 0 : 1)
  const byStatus = waiting(a) - waiting(b)
  if (byStatus !== 0) return byStatus
  return Date.parse(b.detectedAt) - Date.parse(a.detectedAt)
}

/**
 * One queue, two doors. `/alerts` is a member's own watch and `/org/alerts` is
 * an org admin's whole estate, but the page is the same and so is the code —
 * which of these rows come back is decided by the session, on the server.
 */
export function AlertQueue({
  eyebrow,
  lead,
  basePath,
}: {
  eyebrow: string
  lead: string
  /** Where a row links to, and the prefix for its detail route. */
  basePath: string
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: alerts, isPending, isError, refetch, isFetching } = useAlerts()

  // Writes new detections into the same cache `useAlerts` just read from, so
  // they arrive as rows in the list below rather than anywhere new. A no-op
  // unless VITE_LIVE_ALERTS is on.
  useLiveAlerts()

  const requested = searchParams.get('status')
  const segment: Segment = isSegment(requested) ? requested : DEFAULT_SEGMENT

  const setSegment = (next: Segment) => {
    const params = new URLSearchParams(searchParams)
    if (next === DEFAULT_SEGMENT) params.delete('status')
    else params.set('status', next)
    // Replace, so flicking between segments does not fill the back button with
    // steps on the way out of the page.
    setSearchParams(params, { replace: true })
  }

  const counts = {
    unconfirmed: alerts?.filter((a) => a.status === 'unconfirmed').length ?? 0,
    confirmed: alerts?.filter((a) => a.status === 'confirmed').length ?? 0,
    dismissed: alerts?.filter((a) => a.status === 'dismissed').length ?? 0,
    all: alerts?.length ?? 0,
  }

  const shown = (alerts ?? [])
    .filter((alert) => segment === 'all' || alert.status === segment)
    .sort(byUrgency)

  return (
    <>
      <PageHeader eyebrow={eyebrow} title="Alerts" lead={lead} />

      <SegmentControl
        value={segment}
        counts={counts}
        onChange={setSegment}
        disabled={isPending || isError}
      />

      {isPending ? (
        <Loading />
      ) : isError ? (
        <Unavailable onRetry={() => void refetch()} pending={isFetching} />
      ) : shown.length === 0 ? (
        <EmptyFor segment={segment} />
      ) : (
        <Results alerts={shown} segment={segment} basePath={basePath} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Filter                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Native radios, styled — the same pattern the signup flow uses for a small set
 * of exclusive choices. It comes with arrow-key navigation, a real focus ring
 * and a group the screen reader already understands.
 */
function SegmentControl({
  value,
  counts,
  onChange,
  disabled,
}: {
  value: Segment
  counts: Record<Segment, number>
  onChange: (segment: Segment) => void
  disabled: boolean
}) {
  return (
    <fieldset className="mb-6" disabled={disabled}>
      <legend className="label-micro mb-3 text-neutral-500">Show</legend>
      <div className="flex flex-wrap gap-2">
        {SEGMENTS.map((segment) => (
          <label key={segment.value} className="cursor-pointer">
            <input
              type="radio"
              name="alert-status"
              value={segment.value}
              checked={value === segment.value}
              onChange={() => onChange(segment.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex items-center gap-2 rounded-md border border-neutral-300 bg-paper-raised px-3.5 py-2 text-meta text-neutral-700',
                'transition-colors duration-150 hover:border-neutral-400',
                'peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                'peer-disabled:opacity-50',
              )}
            >
              {segment.label}
              <span
                className={cn(
                  'font-mono text-micro',
                  value === segment.value ? 'text-neutral-300' : 'text-neutral-500',
                )}
              >
                {counts[segment.value]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Alerts">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading the queue…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load the queue" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds your alerts. Detection
          itself is unaffected — this is the list, not the cameras. Nothing has
          been confirmed or dismissed on your behalf while it has been down.
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

/**
 * An empty queue is the good outcome on this page, and the copy says so rather
 * than performing the usual apology for having nothing to show.
 */
function EmptyFor({ segment }: { segment: Segment }) {
  if (segment === 'unconfirmed') {
    return (
      <Panel label="Nothing waiting" tone="confirm">
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            Nothing is waiting on a person right now. Every detection Detecto has
            raised has been looked at by someone.
          </p>
          <p className="mt-4 max-w-2xl text-meta text-neutral-600">
            The cameras are still watching. This page fills itself the moment
            something needs a decision, so there is no reason to sit on it.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  const text = {
    confirmed: 'Nothing has been confirmed yet. Confirmed detections stay here as a record of who decided what, and when.',
    dismissed: 'Nothing has been marked as a false positive yet.',
    all: 'Detecto has not raised a detection yet. Once your cameras are running, anything they flag arrives here first — and waits.',
  }[segment]

  return (
    <Panel label="Nothing to show">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">{text}</p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

function Results({
  alerts,
  segment,
  basePath,
}: {
  alerts: Alert[]
  segment: Segment
  basePath: string
}) {
  const label = SEGMENTS.find((s) => s.value === segment)?.label ?? 'Alerts'

  return (
    <Panel
      label={label}
      tone={segment === 'unconfirmed' ? 'signal' : 'neutral'}
      action={
        <span className="label-micro text-neutral-500">
          {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}
        </span>
      }
    >
      {/* Below `sm` this scrolls sideways inside its own container rather than
          reflowing — the columns are read against each other, and a stack of
          cards loses exactly the comparison an operator is making. */}
      <PanelBody className="py-2 sm:py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alert</TableHead>
              <TableHead>Camera</TableHead>
              <TableHead>Detection</TableHead>
              <TableHead className="text-right">Conf.</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((alert) => (
              <TableRow key={alert.id}>
                <TableCell>
                  <Link
                    to={`${basePath}/${alert.id}`}
                    aria-label={`Review ${alert.id}`}
                    className={cn(
                      'inline-flex items-center gap-1 font-mono text-data text-ink',
                      'underline decoration-neutral-300 underline-offset-4',
                      'transition-colors hover:decoration-current',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    {alert.id}
                    <ChevronRight aria-hidden="true" className="size-3.5 text-neutral-400" />
                  </Link>
                </TableCell>

                <TableCell>
                  <span className="block whitespace-nowrap text-meta font-medium text-ink">
                    {alert.cameraName}
                  </span>
                  <span className="block whitespace-nowrap text-meta text-neutral-500">
                    {alert.zone || 'No zone set'}
                  </span>
                </TableCell>

                <TableCell className="whitespace-nowrap text-neutral-700">
                  <span className="inline-flex items-center gap-2">
                    {detectionLabel(alert)}
                    <PipelineBadge alert={alert} />
                  </span>
                </TableCell>

                <TableCell className="text-right font-mono text-data text-ink">
                  {confidenceLabel(alert.confidence)}
                </TableCell>

                <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                  <time dateTime={alert.detectedAt} title={formatTimestamp(alert.detectedAt)}>
                    {formatShort(alert.detectedAt)}
                  </time>
                </TableCell>

                <TableCell>
                  <AlertStatus status={alert.status} className="text-meta" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}
