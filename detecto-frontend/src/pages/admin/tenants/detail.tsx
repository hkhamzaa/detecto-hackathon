import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { TenantStatus } from '@/components/admin/tenant-status'
import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
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
import { invoiceStatusLabel } from '@/lib/invoice'
import { formatPrice, planById } from '@/lib/plans'
import type { Invoice, TenantDetail } from '@/lib/tenants/api'
import { trialDaysLeft } from '@/lib/tenants/labels'
import { useTenant } from '@/lib/tenants/queries'
import { formatDate, formatRelative } from '@/lib/time'
import { AccountAccess } from '@/pages/admin/tenants/suspend'
import { SupportNote } from '@/pages/admin/tenants/support-note'
import { useAuthStore } from '@/store/auth-store'

/**
 * One account, opened.
 *
 * How the account is configured and what it is being billed — and nothing else.
 * There is no route from this page into the tenant's cameras, alert queue,
 * history or clips, and there is no "view as this tenant" control, in this pass
 * or by accident. The claims system puts a person in exactly one area; a super
 * admin borrowing an org's session would undo the isolation the routing model
 * is built on, and every surface here is designed so that it never becomes the
 * obvious next step.
 *
 * Counts are shown because counts are account-level facts — how many cameras
 * they are entitled to against how many they have connected is a billing
 * conversation. Which cameras, and what those cameras saw, is theirs.
 */
export default function AdminTenantDetailPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'admin:tenants')

  const { id = '' } = useParams()
  const { data: tenant, isPending, isError, error, refetch, isFetching } = useTenant(id)

  if (!canView) {
    return (
      <Shell title="Tenant">
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              This is a Detecto platform surface, and your account doesn't hold
              the grant for it.
            </p>
          </PanelBody>
        </Panel>
      </Shell>
    )
  }

  if (isPending) {
    return (
      <Shell title="Tenant">
        <Panel label="Tenant">
          <PanelBody>
            <p role="status" aria-live="polite" className="text-meta text-neutral-500">
              Loading the account…
            </p>
          </PanelBody>
        </Panel>
      </Shell>
    )
  }

  if (isError) {
    const notFound = error instanceof Error && error.message === 'not_found'
    return (
      <Shell title="Tenant">
        <Panel
          label={notFound ? 'No such tenant' : "Can't load this account"}
          tone="signal"
        >
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              {notFound
                ? 'There is no account with that id. It may have been removed, or the link may be wrong.'
                : "Detecto couldn't reach the tenant registry. Nothing has been changed on this account."}
            </p>
            {!notFound && (
              <Button
                type="button"
                variant="outline"
                className="mt-5"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {isFetching ? 'Trying again…' : 'Try again'}
              </Button>
            )}
          </PanelBody>
        </Panel>
      </Shell>
    )
  }

  return (
    <Shell title={tenant.name}>
      <Account tenant={tenant} />
      <Billing tenant={tenant} />
      <AccountAccess tenant={tenant} />
      <SupportNote tenant={tenant} />

      <p className="max-w-2xl text-meta text-neutral-500">
        This is everything the platform holds about how the account is set up and
        billed. It is not a way into their cameras: footage, detections and
        clips stay with the customer who owns them, and no platform surface opens
        them.
      </p>
    </Shell>
  )
}

/** The header and the way back, shared by every state this page has. */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4">
        <Link to="/admin/tenants">
          <ArrowLeft />
          All tenants
        </Link>
      </Button>
      <PageHeader eyebrow="Platform · Tenant" title={title} />
      {children}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-neutral-200 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-baseline sm:gap-4 sm:px-6">
      <dt className="text-meta text-neutral-500">{label}</dt>
      <dd className="min-w-0 text-meta text-neutral-800">{children}</dd>
    </div>
  )
}

function Account({ tenant }: { tenant: TenantDetail }) {
  const plan = planById(tenant.planId)
  const trialLeft = trialDaysLeft(tenant)

  const atCeiling = plan !== undefined && tenant.cameraCount >= plan.maxCameras
  const noCameras = tenant.cameraCount === 0

  return (
    <Panel label="Account" className="mb-6">
      <dl>
        <Row label="Status">
          <TenantStatus tenant={tenant} />
          {tenant.status === 'trial' && trialLeft !== null && trialLeft > 0 && (
            <span className="ml-3 text-neutral-500">
              Ends{' '}
              <time dateTime={tenant.trialEndsAt ?? undefined} className="font-mono text-data">
                {tenant.trialEndsAt ? formatDate(tenant.trialEndsAt) : 'unknown'}
              </time>
            </span>
          )}
        </Row>

        <Row label="Plan">
          {plan ? (
            <>
              <span className="font-medium text-ink">{plan.name}</span>
              <span className="text-neutral-500">
                {' · '}
                {formatPrice(plan.monthly)}/month · up to {plan.maxCameras} cameras,{' '}
                {plan.maxUsers} {plan.maxUsers === 1 ? 'person' : 'people'}
              </span>
            </>
          ) : (
            // An unknown plan id is shown as-is rather than guessed at — a
            // support engineer needs to see that the record is odd.
            <span className="font-mono text-data">{tenant.planId || 'None'}</span>
          )}
        </Row>

        <Row label="Account type">
          {tenant.accountType === 'home' ? 'Household' : 'Organisation'}
        </Row>

        <Row label="Cameras connected">
          <span className="font-mono text-data text-ink">{tenant.cameraCount}</span>
          {plan && (
            <span className="text-neutral-500"> of {plan.maxCameras} on this plan</span>
          )}
          {atCeiling && (
            <StatusWord tone="signal" className="ml-3 text-meta">
              At the ceiling
            </StatusWord>
          )}
          {noCameras && (
            <StatusWord tone="signal" className="ml-3 text-meta">
              Nothing being watched
            </StatusWord>
          )}
        </Row>

        <Row label="Detecto Boxes">
          <span className="font-mono text-data text-ink">{tenant.boxCount}</span>
          <span className="text-neutral-500">
            {' '}
            paired
            {tenant.status === 'suspended' && ' · not syncing while suspended'}
          </span>
        </Row>

        <Row label="People on the account">
          <span className="font-mono text-data text-ink">{tenant.userCount}</span>
          {plan && <span className="text-neutral-500"> of {plan.maxUsers}</span>}
        </Row>

        <Row label="Account contact">
          <a
            href={`mailto:${tenant.adminEmail}`}
            className="break-all font-mono text-data text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {tenant.adminEmail}
          </a>
        </Row>

        <Row label="Created">
          <time dateTime={tenant.createdAt} className="font-mono text-data">
            {formatDate(tenant.createdAt)}
          </time>
          <span className="text-neutral-500">
            {' · '}
            {formatRelative(tenant.createdAt)}
          </span>
        </Row>

        <Row label="Tenant id">
          <span className="font-mono text-data text-neutral-600">{tenant.id}</span>
        </Row>
      </dl>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Billing                                                                    */
/* -------------------------------------------------------------------------- */

/** The words come from `lib/invoice.ts`, so both billing surfaces say the same. */
function invoiceStatus(status: Invoice['status']) {
  const tone = status === 'paid' ? 'confirm' : status === 'due' ? 'neutral' : 'signal'
  return (
    <StatusWord tone={tone} className="text-meta">
      {invoiceStatusLabel(status)}
    </StatusWord>
  )
}

function Billing({ tenant }: { tenant: TenantDetail }) {
  const { billing } = tenant
  const unpaid = billing.invoices.filter((invoice) => invoice.status !== 'paid')

  return (
    <Panel
      label="Billing history"
      tone={unpaid.length > 0 ? 'signal' : 'neutral'}
      className="mb-6"
      action={
        <span className="label-micro text-neutral-500">
          {formatPrice(billing.monthly)}/month
        </span>
      }
    >
      {billing.invoices.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Nothing has been invoiced yet. This account has not reached the end
            of its first billing period.
          </p>
        </PanelBody>
      ) : (
        <>
          <PanelBody className="border-b border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              <span className="font-mono text-data text-ink">
                {formatPrice(billing.totalBilled)}
              </span>{' '}
              invoiced across {billing.invoices.length}{' '}
              {billing.invoices.length === 1 ? 'period' : 'periods'}.
              {unpaid.length > 0 && (
                <span className="text-signal-700">
                  {' '}
                  {unpaid.length === 1 ? 'One is' : `${unpaid.length} are`}{' '}
                  outstanding.
                </span>
              )}{' '}
              A summary — the full ledger is on the platform billing page.
            </p>
          </PanelBody>

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
                {billing.invoices.map((invoice) => (
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
        </>
      )}
    </Panel>
  )
}
