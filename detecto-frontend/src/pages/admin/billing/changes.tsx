import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { BillingLedger, PlanChange } from '@/lib/billing/api'
import { changeDelta, changeKind, formatDelta } from '@/lib/billing/revenue'
import type { Tenant } from '@/lib/tenants/api'
import { planLabel } from '@/lib/tenants/labels'
import { formatDate, formatRelative } from '@/lib/time'
import { AccountLink } from '@/pages/admin/billing/account-link'

/**
 * How subscriptions have moved.
 *
 * A record, and only a record. There is no control on this panel and there is
 * not going to be one: a plan change is a decision made with the customer, on
 * their account, and correcting history from a platform page would mean the log
 * no longer describes what happened. Read-only is the feature.
 *
 * Which way a change went is read off the plan catalogue rather than stored on
 * the row, so the log cannot disagree with the prices the rest of the page is
 * using — and when the catalogue cannot compare the two ends, the row says
 * "plan change" instead of guessing a direction.
 */
export function PlanChanges({
  ledger,
  tenants,
}: {
  ledger: BillingLedger | null
  tenants: Tenant[] | null
}) {
  if (!ledger) {
    return (
      <Panel label="Plan changes" tone="signal" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Detecto couldn't reach the billing ledger, so the change history is
            not available. Nothing has moved — this is the record, not the thing
            being recorded.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  const { changes } = ledger

  return (
    <Panel label="Plan changes" className="mb-6">
      {changes.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            No account has changed or cancelled its plan.
          </p>
        </PanelBody>
      ) : (
        <>
          <PanelBody className="border-b border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              Upgrades, downgrades and cancellations, most recent first. What each
              one did to MRR is worked out from the same placeholder catalogue as
              everything else on this page.
            </p>
          </PanelBody>

          <PanelBody className="py-2 sm:py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">When</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Moved</TableHead>
                  <TableHead className="text-right">Effect on MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((change) => (
                  <ChangeRow
                    key={change.id}
                    change={change}
                    // A cancelled account has left the registry, so there is no
                    // record left to link to. See `AccountLink`.
                    known={tenants?.some((t) => t.id === change.tenantId) ?? false}
                  />
                ))}
              </TableBody>
            </Table>
          </PanelBody>

          <PanelBody className="border-t border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              Nothing in the data model records a plan change:{' '}
              <span className="font-mono text-data">Tenant</span> carries the plan
              an account is on and no history behind it. This log comes from the
              dev mock, the same standing as the tenant registry and the invoice
              history beside it, and the endpoint behind it is not built. It is
              shown because a record can be mocked honestly and labelled — a
              control for data nobody stores could not be.
            </p>
          </PanelBody>
        </>
      )}
    </Panel>
  )
}

const KIND_LABEL = {
  upgrade: 'Upgrade',
  downgrade: 'Downgrade',
  cancellation: 'Cancelled',
} as const

function ChangeRow({ change, known }: { change: PlanChange; known: boolean }) {
  const kind = changeKind(change.fromPlanId, change.toPlanId)
  const delta = changeDelta(change.fromPlanId, change.toPlanId)

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
        <time dateTime={change.at} title={formatRelative(change.at)}>
          {formatDate(change.at)}
        </time>
      </TableCell>

      <TableCell>
        <AccountLink id={change.tenantId} name={change.tenantName} known={known} />
      </TableCell>

      <TableCell>
        {kind === null ? (
          <StatusWord tone="neutral" className="text-meta">
            Plan change
          </StatusWord>
        ) : (
          <StatusWord
            // A cancellation is the only one that needs anybody: an upgrade and
            // a downgrade are both a customer deciding something, and colouring
            // a downgrade red would make a normal event look like a fault.
            tone={kind === 'cancellation' ? 'signal' : 'neutral'}
            className="text-meta"
          >
            {KIND_LABEL[kind]}
          </StatusWord>
        )}
      </TableCell>

      <TableCell className="text-neutral-700">
        {planLabel(change.fromPlanId)}
        {change.toPlanId === null ? (
          <span className="text-neutral-500"> → no plan</span>
        ) : (
          <> → {planLabel(change.toPlanId)}</>
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap text-right font-mono text-data">
        {delta === null ? (
          <span className="text-neutral-500">—</span>
        ) : (
          <span className={delta < 0 ? 'text-signal-700' : 'text-ink'}>
            {formatDelta(delta)}
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}
