import { Figure } from '@/components/ui/figure'
import { Panel } from '@/components/ui/panel'
import type { Alert } from '@/lib/alerts/api'
import { medianDecisionMinutes, weekOnWeek } from '@/lib/analytics/stats'
import type { Camera } from '@/lib/cameras/api'
import { formatDuration } from '@/lib/time'

/**
 * Three numbers, not a wall of them.
 *
 * The test each one had to pass: would an org admin do something differently
 * this morning because of it. Volume against last week says whether something
 * has changed. Time to a decision says whether anybody is actually watching.
 * Cameras offline says whether the answer to either can be trusted, because a
 * quiet week and a blind week produce exactly the same first figure.
 *
 * Figures are mono and labels are Inter, the same division the rest of the
 * product draws between machine-reported data and the words around it.
 */

/** Last week in a sentence, without a percentage nobody asked for. */
function volumeNote(thisWeek: number, lastWeek: number) {
  if (lastWeek === 0) {
    return thisWeek === 0
      ? 'Nothing last week either'
      : 'Nothing was raised last week'
  }
  if (thisWeek === lastWeek) return `Level with last week (${lastWeek})`
  return thisWeek > lastWeek
    ? `Up from ${lastWeek} last week`
    : `Down from ${lastWeek} last week`
}

export function OverviewStrip({
  alerts,
  cameras,
  now,
}: {
  alerts: Alert[]
  /** Null while the camera list is loading or unreachable. */
  cameras: Camera[] | null
  now: number
}) {
  const volume = weekOnWeek(alerts, now)
  const median = medianDecisionMinutes(alerts)

  const offline = cameras?.filter((camera) => !camera.online).length ?? null

  return (
    <Panel
      label="Last 7 days"
      tone={offline !== null && offline > 0 ? 'signal' : 'neutral'}
      className="mb-6"
    >
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Alerts raised"
          value={String(volume.thisWeek)}
          note={volumeNote(volume.thisWeek, volume.lastWeek)}
        />

        <Figure
          label="Median time to a decision"
          // A median, not a mean: see the note in `stats.ts`. The distribution
          // further down the page is where the slow ones are accounted for.
          value={median === null ? '—' : formatDuration(median)}
          note={
            median === null
              ? 'Nothing has been decided yet'
              : 'From raised to confirmed or dismissed'
          }
        />

        <Figure
          label="Cameras offline"
          value={offline === null ? '—' : String(offline)}
          tone={offline !== null && offline > 0 ? 'signal' : 'neutral'}
          note={
            offline === null
              ? "Couldn't reach the camera list"
              : offline === 0
                ? `All ${cameras?.length ?? 0} sending a picture`
                : `Of ${cameras?.length ?? 0} connected — not watching anything`
          }
        />
      </div>
    </Panel>
  )
}
