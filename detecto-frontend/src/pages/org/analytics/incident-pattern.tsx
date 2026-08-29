import { BarColumns, BarRows, ChartLegend, type BarDatum } from '@/components/chart/bars'
import { NotEnoughData } from '@/components/chart/not-enough-data'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { Alert } from '@/lib/alerts/api'
import { byHour, byZone, ENOUGH, peakWindow } from '@/lib/analytics/stats'
import { formatHour } from '@/lib/time'

/**
 * Where alerts cluster, and when.
 *
 * Both halves are counts of the same detections cut two ways, so they share a
 * panel and a colour key rather than pretending to be separate findings. The
 * split by outcome is carried into the bars deliberately: a zone raising forty
 * detections that all turn out to be nothing is a very different problem from a
 * zone raising six that are all real, and a chart that only plotted totals
 * would show them as the same zone, only louder.
 */

const LEGEND = [
  { tone: 'confirm' as const, label: 'Confirmed' },
  { tone: 'muted' as const, label: 'False positive' },
  { tone: 'signal' as const, label: 'Awaiting human' },
]

function segmentsFor(counts: {
  confirmed: number
  falsePositive: number
  waiting: number
}) {
  return [
    { tone: 'confirm' as const, value: counts.confirmed, label: 'confirmed' },
    { tone: 'muted' as const, value: counts.falsePositive, label: 'dismissed as false positives' },
    { tone: 'signal' as const, value: counts.waiting, label: 'awaiting a person' },
  ]
}

/** Every third hour gets a tick. Twenty-four labels in a row is a smear. */
function hourTick(hour: number) {
  return hour % 3 === 0 ? formatHour(hour) : ''
}

export function IncidentPatternSection({ alerts }: { alerts: Alert[] }) {
  const zones = byZone(alerts)
  const hours = byHour(alerts)
  const peak = peakWindow(hours)

  const enoughForZones = alerts.length >= ENOUGH.zonePattern
  const enoughForHours = alerts.length >= ENOUGH.hourPattern

  const zoneBars: BarDatum[] = zones.map((zone) => ({
    key: zone.label,
    label: zone.label,
    marked: zone === zones[0],
    segments: segmentsFor(zone),
  }))

  const hourBars: BarDatum[] = hours.map((hour) => ({
    key: String(hour.hour),
    label: formatHour(hour.hour),
    tick: hourTick(hour.hour),
    marked:
      peak !== null &&
      (peak.from <= peak.to
        ? hour.hour >= peak.from && hour.hour < peak.to
        : hour.hour >= peak.from || hour.hour < peak.to),
    segments: [
      { tone: 'confirm' as const, value: hour.confirmed, label: 'confirmed' },
      {
        tone: 'neutral' as const,
        value: hour.total - hour.confirmed,
        label: 'not confirmed',
      },
    ],
  }))

  return (
    <Panel label="Incident pattern" className="mb-6">
      {/* ---------------------------------------------------------------- */}
      {/* By zone                                                          */}
      {/* ---------------------------------------------------------------- */}
      <PanelBody className="border-b border-neutral-200">
        <h3 className="text-title font-medium text-ink">By zone</h3>

        {enoughForZones ? (
          <>
            <p className="mt-1 max-w-2xl text-meta text-neutral-600">
              Busiest first. A zone that is mostly grey is raising noise, not
              incidents — that is usually a camera angle or a threshold, not the
              place itself.
            </p>
            {/* Horizontal rows reflow on their own, so this half needs no
                separate mobile treatment: the label sits over the bar and the
                bar takes whatever width there is. */}
            <BarRows
              data={zoneBars}
              caption="Alerts by zone, split by outcome"
              className="mt-5"
            />
            <ChartLegend items={LEGEND} className="mt-5" />
          </>
        ) : (
          <NotEnoughData
            className="mt-4"
            need={`Ranking zones against each other needs at least ${ENOUGH.zonePattern} detections in the window. With fewer, the busiest zone is whichever one happened to get two. Here is the count as it stands.`}
          >
            {zones.length === 0 ? (
              <p className="text-meta text-neutral-600">
                Nothing has been raised in any zone yet.
              </p>
            ) : (
              <dl className="grid gap-2">
                {zones.map((zone) => (
                  <div key={zone.label} className="flex items-baseline justify-between gap-4">
                    <dt className="min-w-0 truncate text-meta text-neutral-700">
                      {zone.label}
                    </dt>
                    <dd className="font-mono text-data text-ink">{zone.total}</dd>
                  </div>
                ))}
              </dl>
            )}
          </NotEnoughData>
        )}
      </PanelBody>

      {/* ---------------------------------------------------------------- */}
      {/* By time of day                                                   */}
      {/* ---------------------------------------------------------------- */}
      <PanelBody>
        <h3 className="text-title font-medium text-ink">By time of day</h3>

        {enoughForHours ? (
          <>
            <p className="mt-1 max-w-2xl text-meta text-neutral-600">
              Every detection in the window, by the hour it was raised.
              {peak && (
                <>
                  {' '}
                  Your busiest stretch is{' '}
                  <span className="font-mono text-data text-ink">
                    {formatHour(peak.from)}–{formatHour(peak.to)}
                  </span>
                  . Worth checking somebody is on watch through it.
                </>
              )}
            </p>
            {/* Twenty-four columns keep their width and the chart scrolls
                sideways on a phone, the same treatment the alert table gets.
                Squeezing a day into 360px would make the peak unreadable, which
                is the only thing this chart is for. */}
            <BarColumns
              data={hourBars}
              caption="Alerts by hour of day, confirmed against the rest"
              className="mt-5"
              height="h-36"
              columnClass="min-w-6"
            />
            <ChartLegend
              items={[
                { tone: 'confirm', label: 'Confirmed' },
                { tone: 'neutral', label: 'Dismissed or still waiting' },
              ]}
              className="mt-4"
            />
          </>
        ) : (
          <NotEnoughData
            className="mt-4"
            need={`A day has 24 hours in it, so a shape needs at least ${ENOUGH.hourPattern} detections before a peak is a peak rather than a coincidence. There ${alerts.length === 1 ? 'is' : 'are'} ${alerts.length} in the window so far.`}
          />
        )}
      </PanelBody>
    </Panel>
  )
}
