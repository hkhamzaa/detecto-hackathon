import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import { TenantStatus } from '@/components/admin/tenant-status'
import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Figure } from '@/components/ui/figure'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { can } from '@/lib/auth/claims'
import type { PlatformSummary } from '@/lib/tenants/api'
import { planLabel } from '@/lib/tenants/labels'
import { usePlatformSummary } from '@/lib/tenants/queries'
import { formatDate, formatRelative } from '@/lib/time'
import { useAuthStore } from '@/store/auth-store'

/**
 * The platform on one screen.
 *
 * Everything here is a count, and that is a boundary rather than a limitation.
 * A super admin needs to know that 1,284 detections were raised this week; they
 * do not need to know what any one of them was, whose camera raised it, or what
 * it showed. See the note at the top of `lib/tenants/api.ts` — the restraint is
 * enforced in the types, and this page could not show a detection if it wanted
 * to.
 */
export default function AdminOverviewPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'admin:overview')

  const summary = usePlatformSummary()

  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Platform" title="Overview" />
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

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Overview"
        lead="Every tenant Detecto runs for, counted: how many accounts, how many cameras watching, and how much the models raised this week."
      />

      {summary.isPending ? (
        <Loading />
      ) : summary.isError ? (
        <Unavailable
          onRetry={() => void summary.refetch()}
          pending={summary.isFetching}
        />
      ) : (
        <>
          <Numbers summary={summary.data} />
          <Health health={summary.data.health} />
          <RecentSignups signups={summary.data.recentSignups} />

          <p className="max-w-2xl text-meta text-neutral-500">
            Nothing on this page is a single detection. Alerts, clips and camera
            feeds belong to the tenant whose cameras raised them, and no platform
            surface opens them.
          </p>
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The numbers                                                                */
/* -------------------------------------------------------------------------- */

function Numbers({ summary }: { summary: PlatformSummary }) {
  const { tenants, cameras, alertsThisWeek, alertsLastWeek } = summary

  return (
    <Panel
      label="Across the platform"
      tone={tenants.suspended > 0 ? 'signal' : 'neutral'}
      className="mb-6"
    >
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Tenants"
          value={String(tenants.total)}
          note={
            // The breakdown, in the same status words the tenant list uses, so
            // the two pages cannot describe the same account differently.
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <StatusWord tone="confirm">{tenants.active} active</StatusWord>
              <StatusWord tone="neutral">{tenants.trial} on trial</StatusWord>
              <StatusWord tone={tenants.suspended > 0 ? 'signal' : 'neutral'}>
                {tenants.suspended} suspended
              </StatusWord>
            </span>
          }
        />

        <Figure
          label="Cameras connected"
          value={cameras.toLocaleString('en-GB')}
          note="Across every tenant, as counted by their boxes"
        />

        <Figure
          label="Alerts raised this week"
          value={alertsThisWeek.toLocaleString('en-GB')}
          note={volumeNote(alertsThisWeek, alertsLastWeek)}
        />
      </div>
    </Panel>
  )
}

/** Last week in a sentence. Same phrasing the org analytics strip uses. */
function volumeNote(thisWeek: number, lastWeek: number) {
  if (lastWeek === 0) return 'Nothing was raised last week'
  if (thisWeek === lastWeek) return 'Level with last week'
  const from = lastWeek.toLocaleString('en-GB')
  return thisWeek > lastWeek ? `Up from ${from} last week` : `Down from ${from} last week`
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One line, with the whole picture a click away.
 *
 * The summary and `/admin/system-health` are two views of one fleet, and both
 * read the same rollup, so they cannot disagree about how many boxes are down.
 * A silent box is the state that matters — it means cameras are being watched
 * by nothing at all, and the customer has no way of knowing that from their end.
 */
function Health({ health }: { health: PlatformSummary['health'] }) {
  const silent = health.boxesSilent > 0

  return (
    <Panel
      label="System health"
      tone={silent ? 'signal' : 'confirm'}
      className="mb-6"
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/system-health">
            Full health view
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          <span className="font-mono text-data text-ink">
            {health.boxesReporting}
          </span>{' '}
          {health.boxesReporting === 1 ? 'box is' : 'boxes are'} reporting in.{' '}
          {silent ? (
            <span className="text-signal-700">
              <span className="font-mono text-data">{health.boxesSilent}</span>{' '}
              {health.boxesSilent === 1 ? 'has' : 'have'} gone silent — the
              cameras behind {health.boxesSilent === 1 ? 'it' : 'them'} are being
              watched by nothing, and the customer cannot tell.
            </span>
          ) : (
            'Nothing has gone silent.'
          )}
        </p>

        <p className="mt-4 max-w-2xl text-meta text-neutral-500">
          Checked{' '}
          <time dateTime={health.checkedAt}>
            {formatRelative(health.checkedAt).toLowerCase()}
          </time>
          . System health has the fleet box by box, API latency and error rate,
          queue lag, and what the platform is costing this month.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Recent signups                                                             */
/* -------------------------------------------------------------------------- */

function RecentSignups({ signups }: { signups: PlatformSummary['recentSignups'] }) {
  return (
    <Panel
      label="Recent signups"
      className="mb-6"
      action={
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/tenants">
            All tenants
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      {signups.length === 0 ? (
        <PanelBody>
          <p className="text-meta text-neutral-600">
            Nobody has signed up yet.
          </p>
        </PanelBody>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {signups.map((tenant) => (
            <li
              key={tenant.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-4 sm:px-6"
            >
              <div className="min-w-0">
                <Link
                  to={`/admin/tenants/${tenant.id}`}
                  className="text-body font-medium text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {tenant.name}
                </Link>
                <p className="mt-1 text-meta text-neutral-600">
                  {planLabel(tenant.planId)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                <TenantStatus
                  tenant={{ status: tenant.status, trialEndsAt: null }}
                  className="text-meta"
                />
                <time
                  dateTime={tenant.createdAt}
                  className="whitespace-nowrap font-mono text-data text-neutral-600"
                >
                  {formatDate(tenant.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Overview">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Counting the platform…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load the overview" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that counts the platform. This is
          the reporting layer, not the platform itself — tenants are unaffected,
          detection is still running, and nothing has stopped on their side.
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
