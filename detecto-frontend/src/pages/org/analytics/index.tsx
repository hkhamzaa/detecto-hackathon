import { useState } from 'react'
import { Download } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { NoCamerasYet } from '@/components/camera/no-cameras-yet'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { Alert } from '@/lib/alerts/api'
import { downloadCsv, exportFilename } from '@/lib/analytics/export'
import { useAlertHistory } from '@/lib/analytics/queries'
import { can } from '@/lib/auth/claims'
import { useCameras } from '@/lib/cameras/queries'
import { useModuleConfig } from '@/lib/modules/queries'
import { IncidentPatternSection } from '@/pages/org/analytics/incident-pattern'
import { ModuleAccuracySection } from '@/pages/org/analytics/module-accuracy'
import { OverviewStrip } from '@/pages/org/analytics/overview-strip'
import { ResponseTimeSection } from '@/pages/org/analytics/response-time'
import { useAuthStore } from '@/store/auth-store'

/**
 * Trends across an organisation's alerts and cameras, rather than the live
 * queue.
 *
 * Every figure is derived in `lib/analytics/stats.ts` from alert records the
 * backend sent — the same records the export writes out. Nothing on this page
 * is a number the server asserted and the browser repeated, which is what makes
 * it something a customer can hand to an auditor and defend.
 *
 * The sections that need volume to mean anything check that they have it before
 * drawing. A new organisation gets its true counts and a plain sentence about
 * what is missing, never a trend line through two points.
 */
export default function OrgAnalyticsPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'analytics:view')

  const history = useAlertHistory()
  const cameras = useCameras()
  const modules = useModuleConfig()

  /*
   * "Now" is when the report was pulled, not when React last rendered.
   *
   * Reading the clock during render would move every week boundary and every
   * "waiting for" duration a few milliseconds on each pass, and would make the
   * figures disagree with the export taken from the same data. Query already
   * records the moment the data landed, so the whole page is as of one instant.
   */
  const now = history.dataUpdatedAt

  /*
   * The route is already gated on `analytics:view`, so reaching this page means
   * holding the grant. Asked again anyway: it is three lines, and this page
   * renders an entire account's detection record — the one place where a gate
   * widened by accident should still fail closed.
   */
  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Organisation" title="Analytics" />
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              You don't have permission to see analytics for this organisation.
              An administrator in your organisation can grant it.
            </p>
          </PanelBody>
        </Panel>
      </>
    )
  }

  const isPending = history.isPending || modules.isPending
  const isError = history.isError || modules.isError

  const retry = () => {
    void history.refetch()
    void cameras.refetch()
    void modules.refetch()
  }

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Analytics"
        lead="What your cameras have actually seen — how much, how often, and how much of it turned out to matter."
        action={
          history.data && history.data.alerts.length > 0 ? (
            <ExportReport alerts={history.data.alerts} />
          ) : undefined
        }
      />

      {isPending ? (
        <Loading />
      ) : isError ? (
        <Unavailable
          onRetry={retry}
          pending={history.isFetching || modules.isFetching}
        />
      ) : cameras.data?.length === 0 ? (
        <NoCamerasYet lead="Analytics counts what your cameras have raised, so there is nothing to report until some are connected. Your Detecto Box connects to the recorder or cameras on your network and starts receiving the pictures they already produce." />
      ) : history.data.alerts.length === 0 ? (
        <NothingYet windowDays={history.data.windowDays} />
      ) : (
        <>
          <OverviewStrip
            alerts={history.data.alerts}
            // Null rather than an empty list when the camera list is unreachable:
            // "0 cameras offline" and "we couldn't check" are not the same claim.
            cameras={cameras.isSuccess ? cameras.data : null}
            now={now}
          />

          <ModuleAccuracySection
            alerts={history.data.alerts}
            modules={modules.data.modules}
            windowDays={history.data.windowDays}
            now={now}
          />

          <IncidentPatternSection alerts={history.data.alerts} />

          <ResponseTimeSection alerts={history.data.alerts} now={now} />

          <WindowNote
            windowDays={history.data.windowDays}
            count={history.data.alerts.length}
          />
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One plain action, because the customers who need it — enterprise, government,
 * anyone with an auditor — are going to hand the result to somebody outside the
 * product, and that is not a moment for a wizard.
 *
 * CSV for this pass: one row per detection, re-addable by whoever receives it.
 * A paginated PDF with the charts on headed pages is the obvious follow-up and
 * is deliberately not built here — see the long note in `lib/analytics/export.ts`
 * for why both formats belong to a server-side job rather than to the browser.
 */
function ExportReport({ alerts }: { alerts: Alert[] }) {
  const [saved, setSaved] = useState<string | null>(null)

  return (
    <div className="text-right">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const filename = exportFilename()
          downloadCsv(alerts, filename)
          setSaved(filename)
        }}
      >
        <Download />
        Export report
      </Button>

      <p role="status" aria-live="polite" className="mt-2 text-meta text-neutral-500">
        {saved ? (
          <>
            Saved <span className="font-mono text-data">{saved}</span>
          </>
        ) : (
          <>
            <span className="font-mono text-data">{alerts.length}</span> detections
            as CSV
          </>
        )}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Analytics">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Working out the last few weeks…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your analytics" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds your detection record.
          Detection itself is unaffected — this is the report, not the cameras,
          and nothing has stopped being watched while it has been down.
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

/**
 * Cameras connected, nothing raised. Not a failure and not an apology — for
 * most sites, most weeks, this is the correct answer, and the alert queue takes
 * the same line about an empty queue being the good outcome.
 */
function NothingYet({ windowDays }: { windowDays: number }) {
  return (
    <Panel label="Nothing to report yet" tone="confirm">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          Your cameras haven't raised a detection in the last {windowDays} days.
          There is nothing to chart, which on this page is the good outcome.
        </p>
        <p className="mt-4 max-w-2xl text-meta text-neutral-600">
          This page fills itself as detections arrive. If you were expecting
          some, it is worth checking that a detection module is switched on for
          the cameras you care about — connecting a camera does not switch
          detection on by itself.
        </p>
      </PanelBody>
    </Panel>
  )
}

function WindowNote({ windowDays, count }: { windowDays: number; count: number }) {
  return (
    <p className="max-w-2xl text-meta text-neutral-500">
      Covering the last <span className="font-mono text-data">{windowDays}</span>{' '}
      days — <span className="font-mono text-data">{count}</span> detections, and
      every figure above is worked out from them. These are counts of detections,
      not of people. Detecto does not identify anyone, and nothing here is built
      to.
    </p>
  )
}
