import { useState } from 'react'
import { Download } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Figure } from '@/components/ui/figure'
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
import { can } from '@/lib/auth/claims'
import { useCameras } from '@/lib/cameras/queries'
import { invoiceStatusLabel, unpaid, type Invoice } from '@/lib/invoice'
import { formatPrice, planById, type Plan } from '@/lib/plans'
import type { Subscription } from '@/lib/subscription/api'
import { downloadInvoiceCsv, invoiceFilename } from '@/lib/subscription/export'
import { useSubscription } from '@/lib/subscription/queries'
import { needsSaying, usageFor, usageTone, type Usage } from '@/lib/subscription/usage'
import { formatDate } from '@/lib/time'
import { ChangePlan } from '@/pages/org/billing/change-plan'
import { useAuthStore } from '@/store/auth-store'

/**
 * An organisation's own subscription.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CUSTOMER-FACING MIRROR OF `/admin/billing`, AND A DIFFERENT PAGE
 *
 * The platform billing page reads every account's revenue for Detecto's own
 * staff. This reads one account's plan, its own cameras against that plan's
 * limits, and its own invoices — and it cannot reach anything else. Nothing
 * here imports `lib/billing` or `lib/tenants`; the only shape the two areas
 * share is what an invoice is, which lives out in `lib/invoice.ts` precisely so
 * that neither had to reach into the other. `boundary.test.tsx` in this folder
 * fails the build on the commit that changes that.
 *
 * PERMISSION
 *
 * `billing:manage`, the grant that already gates this route and whose own
 * description reads "The plan, invoices, payment method and billing contact".
 * It fits, and no new key was invented. It is a *manage* grant, though, and
 * there is no view-only counterpart — see the note in `Gaps` below, where that
 * is flagged rather than quietly worked around.
 *
 * TONE
 *
 * This is a bill, not a sales page. Being near a plan's limit is information;
 * it is not a fault, nothing has stopped being watched, and the page must not
 * read as a paywall trying to move somebody up a tier. See
 * `lib/subscription/usage.ts` for where that restraint is decided.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrgBillingPage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'billing:manage')

  const subscription = useSubscription()
  // Real camera data, from the org's own camera list. Usage against a plan
  // limit is only worth showing if it is counted from what is actually
  // connected.
  const cameras = useCameras()

  /*
   * The route is already gated on `billing:manage`, so reaching this page means
   * holding the grant. Asked again anyway: this page shows an organisation's
   * invoices and billing contact, and it is the right place to fail closed if
   * that gate is ever widened.
   */
  if (!canManage) {
    return (
      <>
        <PageHeader eyebrow="Organisation" title="Billing" />
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              You don't have permission to see billing for this organisation. An
              administrator in your organisation can grant it.
            </p>
          </PanelBody>
        </Panel>
      </>
    )
  }

  const pending = subscription.isPending || cameras.isPending

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Billing"
        lead="Your plan, what it covers, how much of it you are using, and every invoice Detecto has raised against it."
        action={
          subscription.isSuccess && subscription.data.invoices.length > 0 ? (
            <ExportInvoices
              invoices={subscription.data.invoices}
              planId={subscription.data.planId}
            />
          ) : undefined
        }
      />

      {pending ? (
        <Loading />
      ) : subscription.isError ? (
        <Unavailable
          onRetry={() => {
            void subscription.refetch()
            void cameras.refetch()
          }}
          pending={subscription.isFetching}
        />
      ) : (
        <Sections
          subscription={subscription.data}
          // Null rather than zero when the camera list is unreachable: "no
          // cameras connected" and "we couldn't check" are not the same claim
          // to make on a page about limits.
          cameras={cameras.isSuccess ? cameras.data.length : null}
        />
      )}
    </>
  )
}

function Sections({
  subscription,
  cameras,
}: {
  subscription: Subscription
  cameras: number | null
}) {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'billing:manage')

  const plan = planById(subscription.planId)
  const usage = plan && cameras !== null ? usageFor(cameras, plan.maxCameras) : null

  return (
    <>
      <CurrentPlan subscription={subscription} plan={plan} usage={usage} />
      <CameraUsage plan={plan} usage={usage} />
      <ChangePlan
        subscription={subscription}
        cameras={cameras ?? 0}
        canManage={canManage}
      />
      <Invoices subscription={subscription} />
      <PaymentMethod subscription={subscription} />
      <Gaps />

      <p className="max-w-2xl text-meta text-neutral-500">
        Everything on this page is your organisation's own. Detecto's staff can
        see that this account exists and what it is billed; nobody outside your
        organisation sees your cameras or what they have raised.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Current plan                                                               */
/* -------------------------------------------------------------------------- */

function CurrentPlan({
  subscription,
  plan,
  usage,
}: {
  subscription: Subscription
  plan: Plan | undefined
  usage: Usage | null
}) {
  const outstanding = unpaid(subscription.invoices)

  if (!plan) {
    // The catalogue has never heard of this plan. Shown as-is rather than
    // guessed at — the same reading `planLabel` takes on the platform side.
    return (
      <Panel label="Your plan" tone="signal" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            This account is on{' '}
            <span className="font-mono text-data text-ink">
              {subscription.planId}
            </span>
            , which this version of Detecto does not have details for. Your
            cameras are unaffected. Get in touch and we will sort out what it
            should say here.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  return (
    <Panel
      label="Your plan"
      tone={subscription.status === 'suspended' ? 'signal' : 'neutral'}
      className="mb-6"
      action={
        <span className="label-micro text-neutral-500">{plan.name}</span>
      }
    >
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Monthly"
          value={formatPrice(plan.monthly)}
          note={
            subscription.status === 'trial'
              ? 'Nothing has been charged yet — you are on trial'
              : `Renews ${formatDate(subscription.renewsAt)}`
          }
        />
        <Figure
          label="Cameras"
          value={usage ? `${usage.used} of ${plan.maxCameras}` : `— of ${plan.maxCameras}`}
          tone={usage?.state === 'over' ? 'signal' : 'neutral'}
          note={
            usage === null
              ? "Couldn't reach your camera list to count them"
              : usage.state === 'none'
                ? 'None connected yet'
                : usage.state === 'over'
                  ? `${usage.used - plan.maxCameras} more than this plan covers`
                  : `${usage.remaining} still available`
          }
        />
        <Figure
          label="People"
          value={`up to ${plan.maxUsers}`}
          note="Each with their own permissions, set on the People page"
        />
      </div>

      {subscription.status === 'suspended' && (
        <PanelBody className="border-t border-neutral-200 py-4">
          <p className="max-w-2xl text-body text-signal-700">
            This account is suspended, so your cameras are not being watched.
            Get in touch — this is not something that resolves itself.
          </p>
        </PanelBody>
      )}

      {outstanding.length > 0 && subscription.status !== 'suspended' && (
        <PanelBody className="border-t border-neutral-200 py-4">
          <p className="max-w-2xl text-meta text-neutral-700">
            {outstanding.length === 1 ? 'One invoice is' : `${outstanding.length} invoices are`}{' '}
            outstanding, totalling{' '}
            <span className="font-mono text-data text-ink">
              {formatPrice(outstanding.reduce((sum, invoice) => sum + invoice.amount, 0))}
            </span>
            . They are listed below.
          </p>
        </PanelBody>
      )}

      <PanelBody className="border-t border-neutral-200">
        <h3 className="text-title font-medium text-ink">What is included</h3>
        <ul className="mt-4 grid max-w-2xl gap-2.5">
          {plan.includes.map((line) => (
            <li key={line} className="flex gap-3 text-meta text-neutral-700">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 bg-confirm-500"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {/* The same warning the module flags page and the platform billing page
            carry about the same catalogue, said here because this is the page
            where a customer would take the number at face value. */}
        <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-600">
          <span className="font-medium text-ink">
            This pricing has not been finalised.
          </span>{' '}
          The plans, their limits and their prices all come from a provisional
          catalogue that has not been signed off commercially. Treat what is
          above as the shape of the plan rather than a quotation, and check the
          figure with us before you budget against it.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Usage                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cameras against the plan's limit.
 *
 * Quiet by design. When an organisation is comfortably inside its plan this is
 * one line saying so and nothing else — no bar creeping toward red, no nudge
 * toward a bigger tier. See `lib/subscription/usage.ts`: only being *over* a
 * limit is a state that needs a person, and everything else is a number.
 */
function CameraUsage({ plan, usage }: { plan: Plan | undefined; usage: Usage | null }) {
  if (!plan) return null

  if (usage === null) {
    return (
      <Panel label="Cameras against your plan" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Detecto couldn't reach your camera list, so there is nothing to count
            against the plan's limit of {plan.maxCameras}. Your cameras are
            unaffected — this is the billing page, not the cameras.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  const tone = usageTone(usage.state)

  return (
    <Panel
      label="Cameras against your plan"
      tone={tone === 'signal' ? 'signal' : 'neutral'}
      className="mb-6"
    >
      <PanelBody>
        <StatusWord tone={tone} className="text-body">
          {usage.state === 'none'
            ? `No cameras connected yet — ${plan.maxCameras} available`
            : usage.state === 'over'
              ? `${usage.used} cameras connected, ${usage.limit} covered by this plan`
              : `${usage.used} of ${usage.limit} cameras connected`}
        </StatusWord>

        {needsSaying(usage.state) ? (
          <p className="mt-4 max-w-2xl text-meta text-neutral-600">
            {usage.state === 'over' ? (
              <>
                You have more cameras connected than {plan.name} covers. Nothing
                has been switched off and nothing will be — every camera is still
                watched, and Detecto does not disconnect one because of a plan.
                It does mean the plan and the site have drifted apart, so it is
                worth settling which one should move.
              </>
            ) : usage.state === 'at' ? (
              <>
                You are using every camera {plan.name} covers. Nothing is wrong,
                and nothing changes today — but the next camera you connect will
                not fit inside this plan, so it is worth knowing before you order
                one.
              </>
            ) : (
              <>
                You have {usage.remaining}{' '}
                {usage.remaining === 1 ? 'camera' : 'cameras'} left on{' '}
                {plan.name}. Worth knowing if you are planning to add more, and
                nothing to act on otherwise.
              </>
            )}
          </p>
        ) : (
          <p className="mt-4 max-w-2xl text-meta text-neutral-500">
            {usage.state === 'none'
              ? 'Connecting a camera does not switch detection on by itself — that is set per camera on the Detection modules page.'
              : 'Comfortably inside your plan. Nothing to do here.'}
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Invoices                                                                   */
/* -------------------------------------------------------------------------- */

function invoiceStatus(status: Invoice['status']) {
  const tone = status === 'paid' ? 'confirm' : status === 'due' ? 'neutral' : 'signal'
  return (
    <StatusWord tone={tone} className="text-meta">
      {invoiceStatusLabel(status)}
    </StatusWord>
  )
}

function Invoices({ subscription }: { subscription: Subscription }) {
  const { invoices } = subscription

  return (
    <Panel label="Invoices" className="mb-6">
      {invoices.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            Nothing has been invoiced yet. This account has not reached the end
            of its first billing period.
          </p>
        </PanelBody>
      ) : (
        <>
          {/* Below `sm` this scrolls sideways inside its own container rather
              than reflowing — the amounts are read down the column against each
              other, and a stack of cards loses that comparison. */}
          <PanelBody className="py-2 sm:py-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Period ended</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="whitespace-nowrap font-mono text-data text-ink">
                      {invoice.id}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                      <time dateTime={invoice.periodEnd}>
                        {formatDate(invoice.periodEnd)}
                      </time>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                      {formatPrice(invoice.amount)}
                    </TableCell>
                    <TableCell>{invoiceStatus(invoice.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>

          <PanelBody className="border-t border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              Invoices are sent to{' '}
              <span className="font-mono text-data text-ink">
                {subscription.billingEmail}
              </span>
              . The export above writes these rows out for reconciling against a
              statement — it is not a tax document, and there is no per-invoice
              PDF yet.
            </p>
          </PanelBody>
        </>
      )}
    </Panel>
  )
}

function ExportInvoices({ invoices, planId }: { invoices: Invoice[]; planId: string }) {
  const [saved, setSaved] = useState<string | null>(null)

  return (
    <div className="text-right">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const filename = invoiceFilename()
          downloadInvoiceCsv(invoices, planId, filename)
          setSaved(filename)
        }}
      >
        <Download />
        Export invoices
      </Button>

      <p role="status" aria-live="polite" className="mt-2 text-meta text-neutral-500">
        {saved ? (
          <>
            Saved <span className="font-mono text-data">{saved}</span>
          </>
        ) : (
          <>
            <span className="font-mono text-data">{invoices.length}</span> as CSV
          </>
        )}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Payment method                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The card, and why there is no form for it.
 *
 * A working-looking "update card" form is the most dangerous placeholder this
 * product could ship. It would collect a card number — real card data, from a
 * real customer — and hand it to nothing, in a browser with no processor
 * behind it and no PCI-compliant field to put it in. Refusing to draw it is not
 * caution about scope; it is the only correct answer.
 */
function PaymentMethod({ subscription }: { subscription: Subscription }) {
  return (
    <Panel label="Payment method" className="mb-6">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          There is no card on this account, and no way to add one yet.
        </p>

        <p className="mt-4 max-w-2xl text-meta text-neutral-600">
          Detecto has no payment processor connected. Taking a card number needs
          a processor's own hosted field so the number never touches Detecto's
          servers or this page — that is what keeps it compliant and it is not
          something a form here can stand in for. Rather than collect card
          details that would go nowhere, there is no form.
        </p>

        <p className="mt-4 max-w-2xl text-meta text-neutral-600">
          Until it is connected, billing is arranged directly with us and
          invoices go to{' '}
          <span className="font-mono text-data text-ink">
            {subscription.billingEmail}
          </span>
          . To change where they are sent, get in touch.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* What is not built                                                          */
/* -------------------------------------------------------------------------- */

function Gaps() {
  return (
    <Panel label="Not built" className="mb-6">
      <PanelBody>
        <ul className="grid max-w-2xl gap-4">
          <li>
            <h3 className="text-meta font-medium text-ink">
              No payment processing, so no charges and no checkout
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Nothing in Detecto has ever taken a payment. Changing plan sends a
              request to a person rather than completing an upgrade, there is no
              card on file, and no invoice on this page was settled by a
              machine. Every amount shown is what the plan would cost, not what
              has been collected.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              Plan pricing is provisional
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              The plans, their camera and people limits, and their prices come
              from a catalogue that has not been signed off. It is the same
              catalogue the signup flow quotes. Do not budget against these
              figures without checking them with us first.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No invoice documents
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              The export writes out the rows above, which is enough to reconcile
              against a bank statement and not enough for an accountant. A real
              invoice is a PDF with company details, a tax number and a date on
              it, produced on the server — this page will not fabricate one in
              the browser.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              Seeing the bill and changing it are the same permission
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Billing is one grant today, so anybody who can read your invoices
              can also ask to change your plan. A finance contact who should see
              what is owed without touching the subscription is a real thing to
              want, and it needs a separate view-only key in the permissions
              system — there is not one, so this page does not pretend to offer
              the distinction.
            </p>
          </li>
        </ul>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Billing">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your plan and invoices…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your billing" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds your plan and invoices.
          Nothing has changed and nothing has been charged — this is the billing
          page, not the billing itself. Your cameras are unaffected and
          detection is still running.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={onRetry}
          disabled={pending}
        >
          {pending ? 'Trying again…' : 'Try again'}
        </Button>
      </PanelBody>
    </Panel>
  )
}
