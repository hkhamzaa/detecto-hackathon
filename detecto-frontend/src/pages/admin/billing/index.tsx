import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { can } from '@/lib/auth/claims'
import { useBillingLedger } from '@/lib/billing/queries'
import { useTenants } from '@/lib/tenants/queries'
import { PlanChanges } from '@/pages/admin/billing/changes'
import { PaymentHealth } from '@/pages/admin/billing/payments'
import { RevenueSection } from '@/pages/admin/billing/revenue'
import { useAuthStore } from '@/store/auth-store'

/**
 * What the platform is earning, and what it is not collecting.
 *
 * The platform-level counterpart to an organisation's own billing page, and not
 * the same thing at all. `/org/billing` is where a customer manages their
 * subscription: their card, their invoices, their plan. This is oversight
 * across every account — recurring revenue, who has not paid, and how
 * subscriptions are moving — and it manages nobody's billing, least of all from
 * here.
 *
 * PERMISSION
 *
 * `admin:billing`, the grant that already gates this route in `lib/auth/nav.ts`.
 * No new key: nothing here is more sensitive than the tenant registry a super
 * admin already reads, and inventing a second gate for one page would put the
 * sidebar and the route guard out of step. `billing:manage` is a different
 * grant on a different area — it lets an org admin manage their own
 * subscription, and it opens nothing here.
 *
 * BOUNDARY
 *
 * Subscription and payment state only. Money has no natural route into footage,
 * so this is the least contentious boundary on the platform — which is exactly
 * why it is written down and tested rather than assumed. See
 * `lib/billing/api.ts` and `pages/admin/boundary.test.tsx`.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * Two sources, deliberately separate. Revenue is derived in the browser from
 * the tenant registry and the placeholder plan catalogue, because there is no
 * billing service to ask; the ledger — who has not paid — comes from a
 * transport that has a dev mock behind it, because no payment processor is
 * connected either. Both facts are on the page, not in this comment only.
 */
export default function AdminBillingPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'admin:billing')

  // Revenue is arithmetic over the registry, so the tenants query is not a
  // supporting read here — it is where MRR comes from.
  const tenants = useTenants()
  const ledger = useBillingLedger()

  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Platform" title="Billing" />
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              This is a Detecto platform surface, and your account doesn't hold
              the grant for it.
            </p>
          </PanelBody>
        </Panel>
      </>
    )
  }

  const pending = tenants.isPending || ledger.isPending
  // Each section says so itself when its own source is missing, so the page
  // only takes over when there is nothing left to draw.
  const nothing = tenants.isError && ledger.isError

  const retry = () => {
    void tenants.refetch()
    void ledger.refetch()
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Billing"
        lead="Recurring revenue across every account, what has not been collected, and how subscriptions are moving. Oversight only — an organisation's own subscription is theirs to manage."
      />

      {pending ? (
        <Loading />
      ) : nothing ? (
        <Unavailable
          onRetry={retry}
          pending={tenants.isFetching || ledger.isFetching}
        />
      ) : (
        <>
          <RevenueSection tenants={tenants.isSuccess ? tenants.data : null} />

          <PaymentHealth
            ledger={ledger.isSuccess ? ledger.data : null}
            tenants={tenants.isSuccess ? tenants.data : null}
          />

          <PlanChanges
            ledger={ledger.isSuccess ? ledger.data : null}
            tenants={tenants.isSuccess ? tenants.data : null}
          />

          <Gaps />

          <p className="max-w-2xl text-meta text-neutral-500">
            Everything on this page is subscription and payment state. Nothing
            here is a camera or a detection: what a tenant's cameras saw belongs
            to the tenant, and no platform surface opens it.
          </p>
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* What this page does not do                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Four honest gaps, stated on the page rather than left for somebody to find by
 * trusting a figure that does not mean what it looks like it means.
 *
 * COUPONS AND DISCOUNTS ARE ABSENT FOR A CONCRETE REASON, NOT AN AESTHETIC ONE.
 * `lib/plans.ts` has `monthly` and nothing else — no discount, no credit, no
 * promotional price, no coupon — and `Tenant` carries a `planId` with no
 * modifier beside it. There is no field to read, no endpoint to ask and no
 * shape to render. A coupons section built today would be a data model invented
 * in the UI layer, and every figure in it would be something this page made up.
 * That is the same refusal the module flags page makes about staged rollout and
 * `lib/roles/permissions.ts` makes about `cameras:manage`: when a capability has
 * no backing, the product says so where a person would go looking for it.
 */
function Gaps() {
  return (
    <Panel label="Not built" className="mb-6">
      <PanelBody>
        <ul className="grid max-w-2xl gap-4">
          <li>
            <h3 className="text-meta font-medium text-ink">
              No coupons, discounts or credits
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Nothing in the product has any concept of one. The plan catalogue
              holds a single monthly price per plan and an account holds a plan
              id — there is no discount field, no credit balance and no coupon
              anywhere to read. Rather than invent the data model on screen,
              there is no section for it. When plans can carry a modifier, this
              is where it will be reported.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              Plan pricing is placeholder
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              MRR, every amount owed and every effect on MRR in the change log
              are computed from the same provisional catalogue the signup flow
              and the module flags page use. It has not been signed off
              commercially. These figures show the shape of the business, not its
              revenue, and none of them belongs in anything a customer or an
              investor reads.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No payment processor is connected
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Nothing on this page has been reconciled against a real merchant
              account, because there is not one. The declines, the attempt counts
              and the reasons come from the dev mock. That is also why there is
              no retry, refund or write-off control anywhere here — a button that
              cannot reach a processor would report success having charged
              nobody.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No dunning schedule
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              How many times a failed charge is retried, how long an account has
              before suspension, and what the customer is told at each step are
              all policy nothing here holds. The attempt counts above are what
              was recorded, not a sequence this page is running or could change.
            </p>
          </li>
        </ul>

        <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
          This page reports on subscriptions; it does not administer anybody's.
          Suspending or restoring access is done on the account record, where the
          support context sits beside it.
        </p>
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
          Counting what the platform is billing…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load billing" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the tenant registry or the billing ledger. This
          is the reporting layer, not the platform itself — no invoice has moved,
          nobody's access has changed, and detection is still running for every
          account. It does mean nobody can currently tell who has paid.
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
