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
import type { BillingLedger, Outstanding } from '@/lib/billing/api'
import { upcomingCharges } from '@/lib/billing/revenue'
import { formatPrice } from '@/lib/plans'
import type { Tenant } from '@/lib/tenants/api'
import { planLabel } from '@/lib/tenants/labels'
import { formatDate, formatRelative } from '@/lib/time'
import { AccountLink } from '@/pages/admin/billing/account-link'

/**
 * Whether the money is actually arriving.
 *
 * Three questions, and deliberately three panels rather than one: a decline is
 * something the processor told us, being past due is what it has come to mean
 * for the account, and a renewal is what happens next. An account can be in two
 * of them at once — a decline is the usual reason an invoice goes past due —
 * and the copy says so rather than the page pretending they are one list.
 *
 * NO ACTIONS HERE, AND THAT IS THE POINT
 *
 * There is no retry, no refund, no write-off and no "send a reminder". Not
 * because a support engineer would not want one, but because no payment
 * processor is connected to this build, so every one of those controls would
 * report success having done nothing. The same reasoning kept the staged
 * rollout picker off the module flags page and `cameras:manage` out of the role
 * builder: a control that hands out something nothing honours is a lie told
 * with a button. What this page can honestly offer is the account record and
 * the billing contact, both of which are real.
 */
export function PaymentHealth({
  ledger,
  tenants,
}: {
  ledger: BillingLedger | null
  tenants: Tenant[] | null
}) {
  return (
    <>
      <FailedPayments ledger={ledger} />
      <PastDue ledger={ledger} tenants={tenants} />
      <Renewals tenants={tenants} />
    </>
  )
}

/** The registry is the only place a billing contact lives. Null when unreachable. */
function contactFor(tenants: Tenant[] | null, tenantId: string): string | null {
  const tenant = tenants?.find((item) => item.id === tenantId)
  return tenant?.adminEmail ? tenant.adminEmail : null
}

function LedgerUnavailable({ label }: { label: string }) {
  return (
    <Panel label={label} tone="signal" className="mb-6">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the billing ledger. This is the reporting layer
          — nobody's access has changed, and no invoice has moved. It does mean
          nothing here can currently tell you whether an account has paid, which
          is not the same as knowing that it has.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Failed payments                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Charges the processor declined, in its own words.
 *
 * The reason is passed through rather than reworded. "Insufficient funds" and
 * "card declined by the issuer" lead to different conversations, and a friendly
 * summary that flattened them into "payment problem" would cost the person
 * reading this the only useful thing on the row.
 */
function FailedPayments({ ledger }: { ledger: BillingLedger | null }) {
  if (!ledger) return <LedgerUnavailable label="Failed payments" />

  const failed = ledger.outstanding.filter((row) => row.attempts > 0)

  return (
    <Panel
      label="Failed payments"
      tone={failed.length > 0 ? 'signal' : 'confirm'}
      className="mb-6"
    >
      {failed.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            Nothing has been declined. Every invoice the platform has issued was
            either paid or is still inside its terms.
          </p>
        </PanelBody>
      ) : (
        <>
          <PanelBody className="border-b border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              Charges the payment processor turned down, with the reason it gave.
              A decline is not the same as an account being past due — an invoice
              can be declined and still be inside its payment terms, and it can be
              past due having never been attempted at all.
            </p>
          </PanelBody>

          <PanelBody className="py-2 sm:py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Last tried</TableHead>
                  <TableHead>Reason given</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failed.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TableCell>
                      <AccountLink id={row.tenantId} name={row.tenantName} known />
                      <span className="block text-neutral-500">
                        {planLabel(row.planId)}
                        {/* Said here as well as under past due. A row read on
                            its own must not leave somebody ringing a customer
                            about a card while their service is already off. */}
                        {row.suspended && ' · access already cut'}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                      {formatPrice(row.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-data text-signal-700">
                      {row.attempts}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                      {row.lastAttemptAt ? (
                        <time dateTime={row.lastAttemptAt}>
                          {formatRelative(row.lastAttemptAt)}
                        </time>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-neutral-700">
                      {row.reason ?? 'None recorded'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        </>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Past due                                                                   */
/* -------------------------------------------------------------------------- */

/** How far past due, and whether it has already cost the customer their service. */
function pastDueState(row: Outstanding) {
  if (row.suspended) {
    return (
      <StatusWord tone="neutral" className="text-meta">
        Access already cut
      </StatusWord>
    )
  }
  return (
    <StatusWord tone="signal" className="text-meta">
      Still running
    </StatusWord>
  )
}

/**
 * The accounts that need somebody to pick up the phone.
 *
 * The column that matters is the last one. An account that is past due and
 * still running is a customer being watched over, for free, who has probably
 * not noticed — and it will end in a suspension nobody warned them about unless
 * a person intervenes. An account already suspended is a different conversation
 * and not an urgent one; it is here for completeness, and it sorts below.
 */
function PastDue({
  ledger,
  tenants,
}: {
  ledger: BillingLedger | null
  tenants: Tenant[] | null
}) {
  if (!ledger) return <LedgerUnavailable label="Past due" />

  const pastDue = [...ledger.outstanding]
    .filter((row) => row.daysPastDue > 0)
    // Still-running accounts first: those are the ones a call can still save.
    .sort((a, b) => Number(a.suspended) - Number(b.suspended) || b.daysPastDue - a.daysPastDue)

  return (
    <Panel
      label="Past due"
      tone={pastDue.some((row) => !row.suspended) ? 'signal' : 'confirm'}
      className="mb-6"
    >
      {pastDue.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            Nothing is past due. Every outstanding invoice is still inside its
            payment terms.
          </p>
        </PanelBody>
      ) : (
        <>
          <PanelBody className="border-b border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              Invoices past their due date. An account here may also appear under
              failed payments — a decline is the usual way an invoice ends up
              past due, but not the only one.
            </p>
          </PanelBody>

          <PanelBody className="py-2 sm:py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Past due</TableHead>
                  <TableHead>Service</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastDue.map((row) => {
                  const contact = contactFor(tenants, row.tenantId)

                  return (
                    <TableRow key={row.tenantId}>
                      <TableCell>
                        <AccountLink id={row.tenantId} name={row.tenantName} known />
                        {contact && (
                          <a
                            href={`mailto:${contact}`}
                            className="mt-0.5 block font-mono text-data text-neutral-500 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {contact}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                        {formatPrice(row.amount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                        <time dateTime={row.dueAt}>{formatDate(row.dueAt)}</time>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-data text-signal-700">
                        {row.daysPastDue} {row.daysPastDue === 1 ? 'day' : 'days'}
                      </TableCell>
                      <TableCell>{pastDueState(row)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </PanelBody>

          <PanelBody className="border-t border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              There is nothing to press here. No payment processor is connected to
              this build, so a retry, a refund or a write-off would report success
              having charged nobody — worse than no button at all. The follow-up
              is a person: the billing contact is a mail link above, and the
              account record carries the support note and the only control that
              genuinely works, which is suspending or restoring access.
            </p>
          </PanelBody>
        </>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Renewals                                                                   */
/* -------------------------------------------------------------------------- */

const HORIZON_DAYS = 14

/**
 * What is about to be charged.
 *
 * Worked out from each account's signup date rather than read from a schedule,
 * because there is no schedule to read — see `upcomingCharges`. A trial's first
 * charge is listed beside the renewals and marked as what it is: revenue that
 * depends on somebody converting, not revenue that is coming.
 */
function Renewals({ tenants }: { tenants: Tenant[] | null }) {
  if (!tenants) {
    return (
      <Panel label="Renewing soon" tone="signal" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Renewal dates are counted from the tenant registry, and Detecto
            couldn't reach it.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  const charges = upcomingCharges(tenants, HORIZON_DAYS)

  return (
    <Panel label={`Renewing in the next ${HORIZON_DAYS} days`} className="mb-6">
      {charges.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            Nothing renews in the next {HORIZON_DAYS} days.
          </p>
        </PanelBody>
      ) : (
        <>
          <PanelBody className="border-b border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              Counted from each account's signup date on a 30-day cycle. A trial
              appears as a first charge on the day the trial ends — that one is
              not revenue until they convert, and it is not counted in MRR above.
            </p>
          </PanelBody>

          <PanelBody className="py-2 sm:py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                  <TableHead>Charge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge) => (
                  <TableRow key={charge.tenantId}>
                    <TableCell>
                      <AccountLink
                        id={charge.tenantId}
                        name={charge.tenantName}
                        known
                      />
                    </TableCell>
                    <TableCell className="text-neutral-700">
                      {planLabel(charge.planId)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                      {charge.amount === null ? '—' : formatPrice(charge.amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                      <time dateTime={charge.at}>{formatDate(charge.at)}</time>
                    </TableCell>
                    <TableCell>
                      {charge.kind === 'first-charge' ? (
                        <StatusWord tone="neutral" className="text-meta">
                          First charge, if they convert
                        </StatusWord>
                      ) : (
                        <StatusWord tone="confirm" className="text-meta">
                          Renewal
                        </StatusWord>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        </>
      )}
    </Panel>
  )
}
