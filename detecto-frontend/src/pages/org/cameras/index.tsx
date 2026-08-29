import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { CameraStatus } from '@/components/camera/camera-status'
import { CONNECT_PATH, NoCamerasYet } from '@/components/camera/no-cameras-yet'
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
import { useCameras } from '@/lib/cameras/queries'
import { formatRelative, formatTimestamp } from '@/lib/time'

export default function OrgCamerasPage() {
  const { data: cameras, isPending, isError, refetch, isFetching } = useCameras()
  const hasCameras = (cameras?.length ?? 0) > 0

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Cameras"
        lead="The cameras Detecto is watching for you, and whether each one is sending a picture right now."
        action={
          hasCameras ? (
            <Button asChild>
              <Link to={CONNECT_PATH}>
                <Plus />
                Add cameras
              </Link>
            </Button>
          ) : undefined
        }
      />

      {isPending ? (
        <Loading />
      ) : isError ? (
        <Unavailable onRetry={() => void refetch()} pending={isFetching} />
      ) : cameras.length === 0 ? (
        <NoCamerasYet />
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
  const online = cameras.filter((camera) => camera.online).length

  return (
    <Panel
      label="Connected cameras"
      action={
        <span className="label-micro text-neutral-500">
          {online} of {cameras.length} online
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {cameras.map((camera) => (
              <TableRow key={camera.id}>
                <TableCell>
                  <span className="block text-meta font-medium text-ink">
                    {camera.name}
                  </span>
                  <span className="font-mono text-micro uppercase tracking-[0.14em] text-neutral-500">
                    {camera.id}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-neutral-700">
                  {camera.zone || <span className="text-neutral-400">Not set</span>}
                </TableCell>
                <TableCell>
                  <CameraStatus online={camera.online} className="text-meta" />
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}
