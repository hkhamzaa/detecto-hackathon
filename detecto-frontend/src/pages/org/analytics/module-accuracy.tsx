import { BarColumns, ChartLegend, type BarDatum } from '@/components/chart/bars'
import { NotEnoughData } from '@/components/chart/not-enough-data'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { Alert, DetectionKind } from '@/lib/alerts/api'
import { ENOUGH, moduleAccuracy, type ModuleAccuracy } from '@/lib/analytics/stats'
import { confidenceLabel } from '@/lib/alerts/labels'
import type { DetectionModule } from '@/lib/modules/api'

/**
 * Is this module actually reliable?
 *
 * The question the section exists to answer, and it is answered with the
 * organisation's own decisions rather than with anything Detecto asserts about
 * itself. A confirmed alert is a person having said the model was right. A
 * dismissed one is a person having said it was wrong. Divide the second by the
 * total and you have a false-positive rate that the customer produced, and can
 * check, and can hand to somebody.
 *
 * Two figures sit next to each other on purpose. `module.falsePositiveRate` is
 * the published, benchmarked rate for the model build. The observed rate is
 * what this account's people actually waved off, in their lighting, at their
 * angles, in their zones — and it is almost always the higher of the two. A
 * product that showed only the first would be quoting a lab result at somebody
 * standing in a car park. A product that showed only the second would leave
 * them no way to tell a bad install from a bad model.
 */

const LEGEND = [
  { tone: 'confirm' as const, label: 'Confirmed by a person' },
  { tone: 'muted' as const, label: 'False positive' },
]

/** `0.172` → `17%`. Exact, unlike the published rate's `~4%`: this is a count. */
function observedPercent(rate: number) {
  return `${Math.round(rate * 100)}%`
}

function weekLabel(weeksAgo: number) {
  if (weeksAgo === 0) return 'This week'
  if (weeksAgo === 1) return 'Last week'
  return `${weeksAgo} weeks ago`
}

function toColumns(accuracy: ModuleAccuracy): BarDatum[] {
  return accuracy.weeks.map((week) => ({
    key: String(week.weeksAgo),
    label: weekLabel(week.weeksAgo),
    tick: week.weeksAgo === 0 ? 'now' : `${week.weeksAgo}w`,
    marked: week.weeksAgo === 0,
    segments: [
      { tone: 'confirm' as const, value: week.confirmed, label: 'confirmed' },
      { tone: 'muted' as const, value: week.falsePositive, label: 'dismissed as false positives' },
    ],
  }))
}

/** The direction of travel, or nothing when the ends are within a point of each other. */
function trendSentence(accuracy: ModuleAccuracy) {
  const active = accuracy.weeks.filter((week) => week.falsePositiveRate !== null)
  if (active.length < ENOUGH.accuracyWeeks) return null

  const first = active[0].falsePositiveRate as number
  const last = active[active.length - 1].falsePositiveRate as number
  const shift = Math.round((last - first) * 100)

  if (Math.abs(shift) < 2) return 'The rate has held steady across the window.'
  return shift < 0
    ? `The rate has come down ${Math.abs(shift)} points since the start of the window.`
    : `The rate has risen ${shift} points since the start of the window. Worth asking what changed.`
}

function ModuleBlock({
  module,
  accuracy,
}: {
  module: DetectionModule
  accuracy: ModuleAccuracy
}) {
  const decided = accuracy.confirmed + accuracy.falsePositive
  const trend = trendSentence(accuracy)

  return (
    <div className="px-5 py-6 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-title font-medium text-ink">{module.name}</h3>
          <p className="mt-1 text-meta text-neutral-500">
            <span className="font-mono text-data">{accuracy.raised}</span> raised
            {accuracy.waiting > 0 && (
              <>
                {' · '}
                <span className="font-mono text-data">{accuracy.waiting}</span> still
                awaiting a person
              </>
            )}
          </p>
        </div>

        {accuracy.rateIsMeaningful && accuracy.falsePositiveRate !== null && (
          <div className="text-right">
            <p className="font-mono text-display-sm font-medium text-ink">
              {observedPercent(accuracy.falsePositiveRate)}
            </p>
            <p className="text-meta text-neutral-500">
              your false positive rate
              {module.falsePositiveRate !== null && (
                <>
                  {' · '}
                  <span className="font-mono text-data">
                    ~{Math.round(module.falsePositiveRate * 100)}%
                  </span>{' '}
                  published
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {accuracy.trendIsMeaningful ? (
        <>
          <BarColumns
            data={toColumns(accuracy)}
            caption={`${module.name}: confirmed and false positive detections, week by week`}
            className="mt-6"
            height="h-32"
            columnClass="min-w-10"
          />
          <ChartLegend items={LEGEND} className="mt-4" />
          {trend && <p className="mt-4 text-meta text-neutral-600">{trend}</p>}
        </>
      ) : (
        <NotEnoughData
          className="mt-5"
          need={
            decided === 0
              ? 'Nobody has confirmed or dismissed a detection from this module yet, so there is no rate to report. The rate appears once your team has decided a dozen of them.'
              : `A false positive rate needs at least ${ENOUGH.accuracyRate} decided detections and ${ENOUGH.accuracyWeeks} weeks with activity in them before it says anything about the model. Below that, one more dismissal moves it by whole points.`
          }
        >
          <dl className="grid grid-cols-3 gap-4">
            <Count label="Raised" value={accuracy.raised} />
            <Count label="Confirmed" value={accuracy.confirmed} />
            <Count label="False positive" value={accuracy.falsePositive} />
          </dl>
        </NotEnoughData>
      )}

      {/*
        The confidence split is the second half of the trust answer, and it
        holds up on far less data than a rate does. If the detections people
        threw out were the ones the model was already unsure about, the model
        knows what it does not know — which is the property you actually want
        from something that wakes a person up.
      */}
      {accuracy.confidenceConfirmed !== null && accuracy.confidenceDismissed !== null && (
        <p className="mt-5 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-600">
          Detections your team confirmed came in at{' '}
          <span className="font-mono text-data text-ink">
            {confidenceLabel(accuracy.confidenceConfirmed)}
          </span>{' '}
          median confidence. The ones they dismissed came in at{' '}
          <span className="font-mono text-data text-ink">
            {confidenceLabel(accuracy.confidenceDismissed)}
          </span>
          .{' '}
          {accuracy.confidenceConfirmed - accuracy.confidenceDismissed >= 0.08
            ? 'The model was already less sure about the ones that turned out to be nothing.'
            : 'The model was about as sure of the ones that were nothing as of the ones that were real, which is worth raising with us.'}
        </p>
      )}
    </div>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-meta text-neutral-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-title text-ink">{value}</dd>
    </div>
  )
}

export function ModuleAccuracySection({
  alerts,
  modules,
  windowDays,
  now,
}: {
  alerts: Alert[]
  /** Every module the catalogue knows about; only the live ones are shown. */
  modules: DetectionModule[]
  windowDays: number
  now: number
}) {
  /*
   * Only `live` modules, and the ids are the detection kinds. A `coming_soon`
   * module has never run and has no accuracy — the modules page says so, and
   * inventing a bar for it here would contradict it.
   */
  const live = modules.filter(
    (module) =>
      module.status === 'live' &&
      (module.id === 'weapon' || module.id === 'violence'),
  )

  return (
    <Panel label="Module accuracy" className="mb-6">
      <PanelBody className="border-b border-neutral-200 py-4">
        <p className="max-w-2xl text-meta text-neutral-600">
          Worked out from your team's own decisions — a confirmation is somebody
          saying the model was right, a dismissal is somebody saying it was
          wrong. The published rate next to it is measured on a benchmark, not on
          your cameras, and yours will usually read higher.
        </p>
      </PanelBody>

      {live.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            No detection modules are running yet, so there is nothing to measure.
          </p>
        </PanelBody>
      ) : (
        <div className="divide-y divide-neutral-200">
          {live.map((module) => (
            <ModuleBlock
              key={module.id}
              module={module}
              accuracy={moduleAccuracy(
                alerts,
                module.id as DetectionKind,
                windowDays,
                now,
              )}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
