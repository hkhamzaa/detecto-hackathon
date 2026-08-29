import { BarRows, type BarDatum } from '@/components/chart/bars'
import { Figure } from '@/components/ui/figure'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { CostTracker } from '@/lib/health/api'
import { costTone, formatUsd } from '@/lib/health/status'

/**
 * What the platform is costing this month.
 *
 * Detecto's architecture was chosen to cost almost nothing until scale forces
 * it to — compute on an always-free tier, clips on storage that does not bill
 * egress. That is a promise, and a promise nobody measures is an assumption.
 * This panel exists so somebody can see it is still true, and notice the month
 * it stops being true.
 *
 * Not a finance dashboard, on purpose. No forecasting, no per-service
 * drill-down, no graphs of spend over quarters. A total, the lines behind it,
 * and whether the total is still small.
 */
export function CostSection({
  cost,
  tenants,
}: {
  cost: CostTracker
  /** For the per-account figure — the number that has to stay flat as we grow. */
  tenants: number
}) {
  const tone = costTone(cost)
  const perTenant = tenants > 0 ? cost.monthToDate / tenants : null

  const paid = cost.lines.filter((line) => line.amount > 0)
  const free = cost.lines.filter((line) => line.amount === 0)

  const bars: BarDatum[] = paid.map((line) => ({
    key: line.id,
    label: `${line.name} · ${line.provider}`,
    marked: line === paid[0],
    segments: [{ tone: 'ink' as const, value: line.amount, label: 'dollars' }],
  }))

  const change = cost.monthToDate - cost.lastMonth

  return (
    <Panel
      label="Infrastructure cost"
      tone={tone === 'signal' ? 'signal' : 'neutral'}
      className="mb-6"
    >
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Month to date"
          value={formatUsd(cost.monthToDate)}
          tone={tone === 'signal' ? 'signal' : 'neutral'}
          note={
            tone === 'signal'
              ? `Over the ${formatUsd(cost.budget)} line — the near-zero-cost promise has stopped being true`
              : `Comfortably under the ${formatUsd(cost.budget)} line`
          }
        />
        <Figure
          label="Last full month"
          value={formatUsd(cost.lastMonth)}
          note={
            Math.abs(change) < 0.01
              ? 'Level with this month so far'
              : change > 0
                ? `Up ${formatUsd(change)} so far this month`
                : `Down ${formatUsd(Math.abs(change))} so far this month`
          }
        />
        <Figure
          label="Per account"
          value={perTenant === null ? '—' : formatUsd(perTenant)}
          note={
            perTenant === null
              ? 'No accounts to divide by yet'
              : `Across ${tenants} ${tenants === 1 ? 'account' : 'accounts'} — the figure that has to stay flat`
          }
        />
      </div>

      <PanelBody className="border-t border-neutral-200">
        {paid.length === 0 ? (
          <p className="max-w-2xl text-body text-neutral-700">
            Nothing is being billed this month. Everything the platform runs on
            is still inside a free allowance.
          </p>
        ) : (
          <>
            <h3 className="text-title font-medium text-ink">What is being billed</h3>
            {/* Horizontal rows reflow on their own, so this needs no separate
                mobile treatment — the label sits over the bar and the bar takes
                whatever width there is. */}
            <BarRows
              data={bars}
              caption="Infrastructure cost this month, by line"
              unit="dollar"
              className="mt-5 max-w-2xl"
            />

            <dl className="mt-6 grid max-w-2xl gap-3">
              {paid.map((line) => (
                <div key={line.id} className="grid gap-0.5">
                  <dt className="text-meta font-medium text-ink">
                    {line.name}
                    <span className="font-normal text-neutral-500">
                      {' · '}
                      {line.provider}
                      {' · '}
                    </span>
                    <span className="font-mono text-data">{formatUsd(line.amount)}</span>
                  </dt>
                  <dd className="text-meta text-neutral-600">{line.note}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {free.length > 0 && (
          <div className="mt-6 max-w-2xl border-t border-neutral-200 pt-4">
            <h3 className="label-micro text-neutral-500">Still costing nothing</h3>
            <ul className="mt-3 grid gap-2.5">
              {free.map((line) => (
                <li key={line.id} className="flex gap-3 text-meta text-neutral-600">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 bg-confirm-500"
                  />
                  <span>
                    <span className="text-neutral-800">
                      {line.name} · {line.provider}
                    </span>{' '}
                    — {line.note}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}
