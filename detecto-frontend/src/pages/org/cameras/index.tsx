import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { CameraStatus } from '@/components/camera/camera-status'
import { DemoUploadPanel } from '@/components/camera/demo-upload'
import { CONNECT_PATH, NoCamerasYet } from '@/components/camera/no-cameras-yet'
import { ReviewStatusBadge } from '@/components/camera/review-status-badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Camera } from '@/lib/cameras/api'
import { useApproveCamera, useCameras } from '@/lib/cameras/queries'
import { DEMO_MODE } from '@/lib/config/demo'
import { formatRelative, formatTimestamp } from '@/lib/time'

export default function OrgCamerasPage() {
  const { data: cameras, isPending, isError, refetch, isFetching } = useCameras()
  const hasCameras = (cameras?.length ?? 0) > 0

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Cameras"
        lead={
          DEMO_MODE
            ? 'Demo mode: upload a video file to simulate a live camera feed. The same model and the same alert pipeline run against the file — this is not a live camera.'
            : 'The cameras Detecto is watching for you, and whether each one is sending a picture right now.'
        }
        action={
          hasCameras && !DEMO_MODE ? (
            <Button asChild>
              <Link to={CONNECT_PATH}>
                <Plus />
                Add cameras
              </Link>
            </Button>
          ) : undefined
        }
      />

      {DEMO_MODE && <DemoUploadPanel />}

      {isPending ? (
        <Loading />
      ) : isError ? (
        <Unavailable onRetry={() => void refetch()} pending={isFetching} />
      ) : cameras.length === 0 ? (
        DEMO_MODE ? null : <NoCamerasYet />
      ) : (
        <CameraTable cameras={cameras} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Cameras">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your cameras…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({
  onRetry,
  pending,
}: {
  onRetry: () => void
  pending: boolean
}) {
  return (
    <Panel label="Can't load your cameras" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that knows about your cameras. Your
          cameras themselves are unaffected — this is the list, not the feeds.
        </p>
        <Button variant="outline" className="mt-5" onClick={onRetry} disabled={pending}>
          {pending ? 'Trying again…' : 'Try again'}
        </Button>
      </PanelBody>
    </Panel>
  )
}

function CameraTable({ cameras }: { cameras: Camera[] }) {
  // "N of total online" against a total that includes never-configured
  // cameras would read as more broken than it is — see the Step 1 report.
  // Configured is the honest denominator for an online/offline ratio.
  const configured = cameras.filter((camera) => camera.sourceType !== 'unconfigured')
  const online = configured.filter((camera) => camera.online).length
  const pending = cameras.filter((camera) => camera.reviewStatus === 'pending').length

  return (
    <Panel
      label="Connected cameras"
      action={
        <span className="label-micro text-neutral-500">
          {configured.length === 0
            ? 'None configured yet'
            : `${online} of ${configured.length} configured online`}
          {pending > 0 && ` · ${pending} pending review`}
        </span>
      }
    >
      <PanelBody className="py-2 sm:py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Camera</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Last picture</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cameras.map((camera) => (
              <TableRow key={camera.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="text-meta font-medium text-ink">{camera.name}</span>
                    <ReviewStatusBadge camera={camera} />
                  </span>
                  <span className="block font-mono text-micro uppercase tracking-[0.14em] text-neutral-500">
                    {camera.id}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-neutral-700">
                  {camera.zone || <span className="text-neutral-400">Not set</span>}
                </TableCell>
                <TableCell>
                  <CameraStatus camera={camera} className="text-meta" />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                  {camera.lastSeen ? (
                    <time dateTime={camera.lastSeen} title={formatTimestamp(camera.lastSeen)}>
                      {formatRelative(camera.lastSeen)}
                    </time>
                  ) : (
                    'Never'
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex flex-col items-end gap-1">
                    {DEMO_MODE && camera.sourceType === 'file' && (
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/org/cameras/${camera.id}/live`}>Watch live</Link>
                      </Button>
                    )}
                    {!DEMO_MODE && camera.reviewStatus === 'pending' && (
                      <ApproveButton camera={camera} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}

/**
 * The one control that moves a box-reported camera into use. Not
 * optimistic (see useApproveCamera) — shows its own pending/error state
 * rather than assuming the row will just update.
 */
function ApproveButton({ camera }: { camera: Camera }) {
  const approve = useApproveCamera()

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        variant="confirm"
        size="sm"
        onClick={() => approve.mutate(camera.id)}
        disabled={approve.isPending}
      >
        {approve.isPending ? 'Approving…' : 'Approve'}
      </Button>
      {approve.isError && (
        <span role="alert" className="text-micro text-signal-700 dark:text-signal-300">
          Couldn't approve. Try again.
        </span>
      )}
    </div>
  )
}
