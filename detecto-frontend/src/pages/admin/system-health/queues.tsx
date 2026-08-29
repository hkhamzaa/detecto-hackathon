import { BarColumns, type BarDatum } from '@/components/chart/bars'
import { NotEnoughData } from '@/components/chart/not-enough-data'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import type { QueueStat } from '@/lib/health/api'
import { ENOUGH_HOURS, formatLag, queueTone, THRESHOLD } from '@/lib/health/status'
import { formatHour } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * How far behind the background workers are.
 *
 * Two queues, because there are two: frames arriving from the boxes, and the
 * detection jobs those frames become. Deliberately not an operations dashboard
 * — no per-worker breakdown, no retry histogram. The question this page answers
 * is "is anything backing up", and the reason it matters is that queue lag is
 * time added to every alert behind it. A minute here is a minute a person did
 * not know something was happening.
 */
export function QueueSection({
  queues,
  observedHours,
}: {
  queues: QueueStat[]
  observedHours: number
}) {
  const enough = observedHours >= ENOUGH_HOURS
  const behind = queues.some((queue) => queueTone(queue) === 'signal')

  return (
    <Panel
      label="Queue health"
      tone={behind ? 'signal' : 'confirm'}
      className="mb-6"
    >
      {queues.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            No queues are reporting. That is itself worth checking — the ingest
            path should always have something to say.
          </p>
        </PanelBody>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {queues.map((queue) => (
            <li key={queue.id} className="px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <h3 className="text-title font-medium text-ink">{queue.name}</h3>
                  <p className="mt-1 max-w-prose text-meta text-neutral-600">
                    {queue.description}
                  </p>
                </div>

                <div className="text-right">
                  <p
                    className={cn(
                      'font-mono text-display-sm font-medium',
                      queueTone(queue) === 'signal' ? 'text-signal-700' : 'text-ink',
                    )}
                  >
                    {formatLag(queue.lagSeconds)}
                  </p>
                  <p className="text-meta text-neutral-500">
                    behind ·{' '}
                    <span className="font-mono text-data">
                      {queue.depth.toLocaleString('en-GB')}
                    </span>{' '}
                    waiting
                  </p>
                </div>
              </div>

              {queueTone(queue) === 'signal' && (
                <StatusWord tone="signal" className="mt-3 text-meta">
                  Over the {formatLag(THRESHOLD.queueLagSeconds)} target — every
                  alert behind this is arriving late
                </StatusWord>
              )}

              {enough && queue.series.length > 0 && (
                <BarColumns
                  data={toBars(queue)}
                  caption={`${queue.name}: lag in seconds, by hour`}
                  unit="second"
                  className="mt-5"
                  height="h-20"
                  columnClass="min-w-6"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {queues.length > 0 && !enough && (
        <PanelBody className="border-t border-neutral-200">
          <NotEnoughData
            need={`The lag figures above are current and true. The hourly trend needs ${ENOUGH_HOURS} hours behind it before a rise is a rise rather than the first two readings, and the platform has ${observedHours} ${observedHours === 1 ? 'hour' : 'hours'}.`}
          />
        </PanelBody>
      )}
    </Panel>
  )
}

function toBars(queue: QueueStat): BarDatum[] {
  return queue.series.map((point, index) => ({
    key: point.at,
    label: formatHour(new Date(point.at).getHours()),
    // Twelve columns, so every third tick is enough to read the axis.
    tick: index % 3 === 0 ? formatHour(new Date(point.at).getHours()) : '',
    marked: point.value >= THRESHOLD.queueLagSeconds,
    segments: [
      {
        tone:
          point.value >= THRESHOLD.queueLagSeconds
            ? ('signal' as const)
            : ('ink' as const),
        value: point.value,
        label: 'seconds behind',
      },
    ],
  }))
}
