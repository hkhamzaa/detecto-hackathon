import { BarRows, type BarDatum } from '@/components/chart/bars'
import { Figure } from '@/components/ui/figure'
import { Panel, PanelBody } from '@/components/ui/panel'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CYCLE_DAYS,
  formatShare,
  PLACEHOLDER_PRICING,
  share,
  summariseRevenue,
} from '@/lib/billing/revenue'
import { formatPrice } from '@/lib/plans'
import type { Tenant } from '@/lib/tenants/api'

/**
 * Recurring revenue, and where it comes from.
 *
 * Derived in the browser rather than fetched, because there is nothing to fetch
 * it from — see the header of `lib/billing/revenue.ts`. That is not a detail to
 * bury: the warning sits directly under the figures, in the panel, because
 * somebody reading MRR off a screen will not go looking for a footnote first.
 */
export function RevenueSection({ tenants }: { tenants: Tenant[] | null }) {
  if (!tenants) {
    return (
      <Panel label="Can't count the platform" tone="signal" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Recurring revenue is worked out from the tenant registry, and Detecto
            couldn't reach it. Nothing is shown rather than a figure counted from
            an incomplete list — a wrong MRR is worse than none.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  const summary = summariseRevenue(tenants)
  const contributing = summary.byPlan
    .filter((row) => row.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly)

  const bars: BarDatum[] = contributing.map((row) => ({
    key: row.plan.id,
    label: `${row.plan.name} · ${row.tenants} ${row.tenants === 1 ? 'account' : 'accounts'}`,
    marked: row === contributing[0],
    segments: [{ tone: 'ink' as const, value: row.monthly, label: 'dollars' }],
  }))

  return (
    <Panel label="Recurring revenue" className="mb-6">
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Monthly recurring revenue"
          value={formatPrice(summary.mrr)}
          note={`Across ${summary.billing} ${summary.billing === 1 ? 'account' : 'accounts'} being billed, on a ${CYCLE_DAYS}-day cycle`}
        />
        <Figure
          label="On trial"
          value={formatPrice(summary.trial.monthly)}
          note={`${summary.trial.tenants} ${summary.trial.tenants === 1 ? 'account has' : 'accounts have'} chosen a plan and been charged nothing. Not revenue until they convert.`}
        />
        <Figure
          label="Suspended"
          value={formatPrice(summary.suspended.monthly)}
          tone={summary.suspended.tenants > 0 ? 'signal' : 'neutral'}
          note={
            summary.suspended.tenants === 0
              ? 'No account has had its access cut'
              : `${summary.suspended.tenants} ${summary.suspended.tenants === 1 ? 'account was' : 'accounts were'} billing this until access was cut`
          }
        />
      </div>

      {/* The warning, in the panel and directly under the number it is about. */}
      <PanelBody className="border-t border-neutral-200 bg-paper-sunken py-4">
        <p className="max-w-2xl text-meta text-neutral-700">
          <span className="font-medium text-ink">{PLACEHOLDER_PRICING}</span>{' '}
          MRR is this browser multiplying the plan catalogue in{' '}
          <span className="font-mono text-data">lib/plans.ts</span> by the accounts
          on each plan. The catalogue is provisional — the tiers, the ceilings and
          the prices are all unsigned-off, exactly as the module flags page says of
          the same numbers — and no payment processor has confirmed that a penny of
          it was collected. Read the shape, not the amount, and do not quote it.
        </p>
      </PanelBody>

      <PanelBody className="border-t border-neutral-200">
        <h3 className="text-title font-medium text-ink">By plan</h3>
        <p className="mt-2 max-w-2xl text-meta text-neutral-600">
          Accounts being billed, grouped by the plan they are on. Trials and
          suspended accounts are not counted here, because neither is paying.
        </p>

        {contributing.length === 0 ? (
          <p className="mt-5 max-w-2xl text-body text-neutral-700">
            No account is being billed yet. Every account on the platform is on
            trial, suspended, or on a plan the catalogue cannot price.
          </p>
        ) : (
          <>
            {/* Rows reflow on their own, so this needs no separate mobile
                treatment — the label sits over the bar and the bar takes
                whatever width there is. */}
            <BarRows
              data={bars}
              caption="Monthly recurring revenue by plan"
              unit="dollar"
              className="mt-5 max-w-2xl"
            />

            <div className="mt-7">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Accounts</TableHead>
                    <TableHead className="text-right">Contributes</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byPlan.map((row) => (
                    <TableRow key={row.plan.id}>
                      <TableCell className="font-medium text-ink">
                        {row.plan.name}
                        <span className="font-normal text-neutral-500">
                          {' · '}
                          {row.plan.audience === 'home' ? 'Home' : 'Organisation'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                        {formatPrice(row.plan.monthly)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-data text-neutral-600">
                        {row.tenants}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                        {/* Nobody on the tier contributes nothing, and an em
                            dash says that more plainly than $0 does. */}
                        {row.tenants === 0 ? '—' : formatPrice(row.monthly)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-data text-neutral-600">
                        {row.tenants === 0 ? '—' : formatShare(share(row.monthly, summary.mrr))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium text-ink">Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-data text-ink">
                      {summary.billing}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                      {formatPrice(summary.mrr)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </>
        )}

        {summary.unpriced > 0 && (
          <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-signal-700">
            {summary.unpriced}{' '}
            {summary.unpriced === 1 ? 'account is' : 'accounts are'} on a plan the
            catalogue has never heard of, so nothing above prices{' '}
            {summary.unpriced === 1 ? 'it' : 'them'}. They are missing from MRR
            rather than counted as zero — a plan id this build does not recognise
            is a record worth looking at, not a free account.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}
