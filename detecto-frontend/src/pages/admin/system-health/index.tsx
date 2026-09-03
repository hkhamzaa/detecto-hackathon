import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { can } from '@/lib/auth/claims'
import type { PlatformHealth } from '@/lib/health/api'
import { usePlatformHealth } from '@/lib/health/queries'
import { needsAttention } from '@/lib/health/status'
import { usePlatformSummary } from '@/lib/tenants/queries'
import { formatRelative } from '@/lib/time'
import { ApiHealthSection } from '@/pages/admin/system-health/api-health'
import { CostSection } from '@/pages/admin/system-health/cost'
import { FleetSection } from '@/pages/admin/system-health/fleet'
import { QueueSection } from '@/pages/admin/system-health/queues'
import { DEMO_MODE } from '@/lib/config/demo'
import { useAuthStore } from '@/store/auth-store'

/**
 * Whether the platform is doing its job right now.
 *
 * Four questions, in the order somebody would ask them at three in the morning:
 * are the boxes talking to us, is the API answering, is anything backing up,
 * and is it still costing nothing. The first is the one that matters most — a
 * silent box means cameras watched by nothing, and the customer has no way of
 * knowing that from their end.
 *
 * Same boundary as the tenant registry: counts, status and timestamps. The
 * fleet section names organisations because a fault has to be attributable to
 * somebody, and carries nothing about what their cameras saw. See the note at
 * the top of `lib/health/api.ts`.
 */
export default function AdminSystemHealthPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'admin:health')

  const health = usePlatformHealth()
  const summary = usePlatformSummary()

  // As of when the reading was taken, not as of this render — see the same note
  // on the org analytics page. A status page whose clock moves under it is one
  // whose "last seen" figures cannot be trusted.
  const now = health.dataUpdatedAt

  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Platform" title="System health" />
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
        title="System health"
        lead="Whether the platform is doing its job right now: boxes reporting in, the API answering, the queues keeping up, and what all of it is costing."
      />

      {health.isPending ? (
        <Loading />
      ) : health.isError ? (
        <Unavailable
          onRetry={() => void health.refetch()}
          pending={health.isFetching}
        />
      ) : (
        <>
          <Verdict health={health.data} now={now} />

          {!DEMO_MODE && <FleetSection fleet={health.data.fleet} now={now} />}

          <ApiHealthSection
            api={health.data.api}
            observedHours={health.data.observedHours}
          />

          <QueueSection
            queues={health.data.queues}
            observedHours={health.data.observedHours}
          />

          <CostSection
            cost={health.data.cost}
            // Zero when the registry is unreachable, which renders as "—"
            // rather than as a per-account cost worked out from a guess.
            tenants={summary.isSuccess ? summary.data.tenants.total : 0}
          />

          <p className="max-w-2xl text-meta text-neutral-500">
            Everything here is infrastructure and connectivity. Nothing on this
            page is a detection: what a tenant's cameras saw belongs to the
            tenant, and no platform surface opens it.
          </p>
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Verdict                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One line, before any of the numbers.
 *
 * Somebody opening this page at speed wants to know whether to keep reading.
 * When everything is fine it says so in three words and gets out of the way —
 * which is the whole reason the sections below are allowed to stay quiet.
 */
function Verdict({ health, now }: { health: PlatformHealth; now: number }) {
  const attention = needsAttention(health)

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <StatusWord tone={attention ? 'signal' : 'confirm'} className="text-body">
        {attention
          ? 'Something needs attention'
          : 'Everything is reporting normally'}
      </StatusWord>

      <p className="text-meta text-neutral-500">
        Checked{' '}
        <time dateTime={health.checkedAt}>
          {formatRelative(health.checkedAt, now).toLowerCase()}
        </time>
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="System health">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Checking the platform…
        </p>
      </PanelBody>
    </Panel>
  )
}

/**
 * The monitor being down is its own kind of bad news, and the copy says so
 * rather than reassuring anyone. Not knowing whether boxes are reporting is not
 * the same as knowing they are.
 */
function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't reach the health service" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that reports on itself. That does
          not mean the platform is down — but it does mean nobody can currently
          tell whether it is, including this page. If tenants are reporting
          problems, treat that as the more reliable signal until this comes back.
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
