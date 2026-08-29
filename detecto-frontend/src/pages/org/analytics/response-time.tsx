import { BarColumns, type BarDatum } from '@/components/chart/bars'
import { NotEnoughData } from '@/components/chart/not-enough-data'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import type { Alert } from '@/lib/alerts/api'
import { ENOUGH, responseSpread, SLOW_MINUTES } from '@/lib/analytics/stats'
import { formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * How long detections sat in "Awaiting human".
 *
 * A distribution, because an average here is actively misleading. Fifty alerts
 * dealt with in three minutes and two left overnight average out to something
 * comfortable, and the two are the entire story — they are the nights nobody
 * was watching, and they are what a customer will be asked about if something
 * happened during one.
 *
 * So the section reports three things a mean cannot: the shape, the ninetieth
 * percentile, and a flat count of the ones that took more than four hours.
 * Anything still waiting right now is separated out entirely — it has no
 * response time yet, and folding it in would quietly improve the numbers by
 * leaving out the worst cases.
 */

function figureTone(slow: number) {
  return slow > 0 ? 'text-signal-700' : 'text-ink'
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone?: string
}) {
  return (
    <div>
      <p className="text-meta text-neutral-500">{label}</p>
      <p className={cn('mt-1 font-mono text-display-sm font-medium', tone ?? 'text-ink')}>
        {value}
      </p>
      <p className="mt-0.5 text-meta text-neutral-500">{note}</p>
    </div>
  )
}

export function ResponseTimeSection({
  alerts,
  now,
}: {
  alerts: Alert[]
  now: number
}) {
  const spread = responseSpread(alerts, now)

  const bars: BarDatum[] = spread.buckets.map((bucket) => ({
    key: bucket.short,
    label: bucket.label,
    tick: bucket.short,
    // The slow end is marked in Signal rather than left as another neutral bar.
    // It is the one bucket on this page that means somebody should do something.
    marked: bucket.short === '4h+' && bucket.count > 0,
    segments: [
      {
        tone: bucket.short === '4h+' && bucket.count > 0 ? ('signal' as const) : ('ink' as const),
        value: bucket.count,
        label: 'decisions',
      },
    ],
  }))

  return (
    <Panel
      label="Response time"
      tone={spread.slow > 0 ? 'signal' : 'neutral'}
      className="mb-6"
    >
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          How long each detection sat awaiting a human before somebody confirmed
          or dismissed it. Shown as a spread rather than an average — a handful
          left overnight would disappear into a mean, and those are the ones
          worth knowing about.
        </p>

        {spread.isMeaningful ? (
          <>
            <div className="mt-6 grid gap-5 sm:grid-cols-3">
              <Figure
                label="Median"
                value={spread.median === null ? '—' : formatDuration(spread.median)}
                note="Half were dealt with faster"
              />
              {/*
                A threshold, and labelled as one. Calling this "the slowest 10%"
                would be wrong in exactly the way this section exists to guard
                against: nine in ten inside three minutes is entirely compatible
                with two alerts having sat all night, and it is the count beside
                it that catches those.
              */}
              <Figure
                label="Nine in ten within"
                value={spread.ninetieth === null ? '—' : formatDuration(spread.ninetieth)}
                note="The other one in ten took longer"
              />
              <Figure
                label={`Over ${formatDuration(SLOW_MINUTES)}`}
                value={String(spread.slow)}
                tone={figureTone(spread.slow)}
                note={
                  spread.slow === 0
                    ? 'Nothing sat that long'
                    : spread.slow === 1
                      ? 'One sat effectively unattended'
                      : 'Sat effectively unattended'
                }
              />
            </div>

            {/* Six labelled buckets. They keep their width and scroll rather
                than compressing, because the tick text is the axis here — an
                unreadable "15–60m" is a chart with no scale. */}
            <BarColumns
              data={bars}
              caption="Decisions by how long they took"
              unit="decision"
              className="mt-7"
              height="h-32"
              columnClass="min-w-14"
            />

            <p className="mt-4 text-meta text-neutral-500">
              <span className="font-mono text-data">{spread.decided}</span>{' '}
              decisions in the window.
            </p>
          </>
        ) : (
          <NotEnoughData
            className="mt-5"
            need={
              spread.decided === 0
                ? 'Nothing has been confirmed or dismissed yet, so there are no response times to spread out. This fills in as your team works through the queue.'
                : `A distribution needs at least ${ENOUGH.responseSpread} decisions before its shape means anything. There ${spread.decided === 1 ? 'has' : 'have'} been ${spread.decided} so far — here is what they came to.`
            }
          >
            {spread.median !== null && (
              <p className="text-meta text-neutral-600">
                Median so far:{' '}
                <span className="font-mono text-data text-ink">
                  {formatDuration(spread.median)}
                </span>
                . True, but built on {spread.decided} decision
                {spread.decided === 1 ? '' : 's'} — not yet a number to plan
                against.
              </p>
            )}
          </NotEnoughData>
        )}

        {/*
          Still open, and therefore still accruing. Kept out of every figure
          above: an alert that has been waiting six hours has not "taken six
          hours", it has taken at least six and counting, and averaging it in
          would understate it.
        */}
        {spread.waiting > 0 && (
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <StatusWord tone="signal" className="text-meta">
              {spread.waiting} awaiting a human right now
            </StatusWord>
            {spread.longestWaiting !== null && (
              <p className="mt-1.5 text-meta text-neutral-600">
                The oldest has been waiting{' '}
                <span className="font-mono text-data text-ink">
                  {formatDuration(spread.longestWaiting)}
                </span>
                . These are not counted in the figures above — they have not
                finished waiting.
              </p>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}
