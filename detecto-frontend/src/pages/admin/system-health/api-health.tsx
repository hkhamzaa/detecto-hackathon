import { BarColumns, ChartLegend, type BarDatum } from '@/components/chart/bars'
import { NotEnoughData } from '@/components/chart/not-enough-data'
import { Figure } from '@/components/ui/figure'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { ApiHealth } from '@/lib/health/api'
import {
  ENOUGH_HOURS,
  errorTone,
  formatRate,
  formatUptime,
  latencyTone,
  THRESHOLD,
  uptimeTone,
} from '@/lib/health/status'
import { formatHour } from '@/lib/time'

/**
 * The API Detecto runs, rather than anything a tenant owns.
 *
 * No boundary question here at all: this is our own infrastructure answering
 * for itself. It earns its place on the page because every other number in the
 * product arrives through it — a slow API is a slow alert queue, and an alert
 * queue that takes four seconds to open is one an operator stops opening.
 */

/** Every third hour gets a tick. Twenty-four labels in a row is a smear. */
function hourTick(iso: string, index: number) {
  return index % 3 === 0 ? formatHour(new Date(iso).getHours()) : ''
}

export function ApiHealthSection({
  api,
  observedHours,
}: {
  api: ApiHealth
  observedHours: number
}) {
  const enough = observedHours >= ENOUGH_HOURS

  const latencyBars: BarDatum[] = api.latencySeries.map((point, index) => ({
    key: point.at,
    label: formatHour(new Date(point.at).getHours()),
    tick: hourTick(point.at, index),
    marked: point.value >= THRESHOLD.latencyP95Ms,
    segments: [
      {
        // Only the hours actually over the line are coloured. A chart where
        // every bar is Signal says nothing about which hour to go and look at.
        tone: point.value >= THRESHOLD.latencyP95Ms ? ('signal' as const) : ('ink' as const),
        value: point.value,
        label: 'p95',
      },
    ],
  }))

  const errorBars: BarDatum[] = api.requestSeries.map((point, index) => ({
    key: point.at,
    label: formatHour(new Date(point.at).getHours()),
    tick: hourTick(point.at, index),
    segments: [
      { tone: 'signal' as const, value: point.errors, label: 'failed' },
      { tone: 'muted' as const, value: point.ok, label: 'succeeded' },
    ],
  }))

  return (
    <Panel label="API and servers" className="mb-6">
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Response time (p95)"
          value={`${api.latencyP95} ms`}
          tone={latencyTone(api) === 'signal' ? 'signal' : 'neutral'}
          note={`Median ${api.latencyP50} ms · target under ${THRESHOLD.latencyP95Ms} ms`}
        />
        <Figure
          label="Error rate"
          value={formatRate(api.errorRate)}
          tone={errorTone(api) === 'signal' ? 'signal' : 'neutral'}
          note={`Across the last ${api.hours} ${api.hours === 1 ? 'hour' : 'hours'} · target under ${formatRate(THRESHOLD.errorRate)}`}
        />
        <Figure
          label="Uptime"
          value={formatUptime(api.uptime30d)}
          tone={uptimeTone(api) === 'signal' ? 'signal' : 'neutral'}
          note="Last 30 days"
        />
      </div>

      <PanelBody className="border-t border-neutral-200">
        {enough ? (
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-title font-medium text-ink">Response time by hour</h3>
              <p className="mt-1 text-meta text-neutral-600">
                95th percentile, in milliseconds. Hours over target are marked.
              </p>
              {/* Columns keep their width and the chart scrolls sideways on a
                  phone — the same treatment the data tables get. Squeezing a
                  day into 360px would hide the one hour worth looking at. */}
              <BarColumns
                data={latencyBars}
                caption="API response time by hour, 95th percentile in milliseconds"
                unit="millisecond"
                className="mt-5"
                height="h-32"
                columnClass="min-w-6"
              />
            </div>

            <div>
              <h3 className="text-title font-medium text-ink">Requests by hour</h3>
              <p className="mt-1 text-meta text-neutral-600">
                Failures sit at the base of each bar, so a bad hour is visible
                against the volume it happened in.
              </p>
              <BarColumns
                data={errorBars}
                caption="API requests by hour, failed against succeeded"
                unit="request"
                className="mt-5"
                height="h-32"
                columnClass="min-w-6"
              />
              <ChartLegend
                items={[
                  { tone: 'signal', label: 'Failed' },
                  { tone: 'muted', label: 'Succeeded' },
                ]}
                className="mt-4"
              />
            </div>
          </div>
        ) : (
          <NotEnoughData
            need={`An hourly chart needs at least ${ENOUGH_HOURS} hours behind it before its shape means anything — enough to hold both a busy stretch and a quiet one. The platform has been collecting for ${observedHours} ${observedHours === 1 ? 'hour' : 'hours'}. The figures above are live and true; only the trend is withheld.`}
          />
        )}
      </PanelBody>
    </Panel>
  )
}
