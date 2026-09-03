import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { cameraVideoUrl } from '@/lib/cameras/api'
import { useDetectionTicks } from '@/lib/cameras/live'
import { overlayFor, tickAt } from '@/lib/cameras/overlay'
import { useCamera } from '@/lib/cameras/queries'
import { DEMO_MODE } from '@/lib/config/demo'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'

const TONE_CLASS = {
  pending: 'bg-neutral-700',
  normal: 'bg-confirm-600',
  moderate: 'bg-amber-600',
  high: 'bg-signal-600',
} as const

export default function OrgCameraLivePage() {
  const { id } = useParams<{ id: string }>()
  const { data: camera, isPending, isError, refetch, isFetching } = useCamera(id)
  const token = useAuthStore((s) => s.accessToken)
  const { ticks, connected, complete } = useDetectionTicks(id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playbackS, setPlaybackS] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTime = () => setPlaybackS(video.currentTime)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onTime)

    let frame = 0
    const loop = () => {
      if (!video.paused && !video.ended) setPlaybackS(video.currentTime)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onTime)
      cancelAnimationFrame(frame)
    }
  }, [camera?.id])

  if (isPending) {
    return (
      <Panel label="Watch live">
        <PanelBody>
          <p role="status" className="text-meta text-neutral-500">
            Loading this camera…
          </p>
        </PanelBody>
      </Panel>
    )
  }

  if (isError || !camera) {
    return (
      <Panel label="Can't load this camera" tone="signal">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Detecto couldn't find this camera, or couldn't reach the service that
            knows about it.
          </p>
          <Button variant="outline" className="mt-5" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? 'Trying again…' : 'Try again'}
          </Button>
        </PanelBody>
      </Panel>
    )
  }

  const tick = tickAt(ticks, playbackS, { cameraId: camera.id })
  const banner = overlayFor(tick)
  const canPlay = camera.sourceType === 'file' && Boolean(token)
  const src = token ? cameraVideoUrl(camera.id, token) : ''

  return (
    <>
      <PageHeader
        eyebrow="Organisation · Cameras"
        title={camera.name}
        lead={
          DEMO_MODE
            ? 'Demo mode: this is the uploaded file playing in the browser, with the model’s scores drawn on top. It is not a live camera. Confirming an alert still happens in the alert queue — this page does not contact anyone.'
            : 'The picture this camera is sending, with the model’s current scores overlaid.'
        }
        action={
          <Button asChild variant="outline">
            <Link to="/org/alerts">Open the alert queue</Link>
          </Button>
        }
      />

      <p className="mb-6 max-w-2xl text-meta text-ink">
        {ticks.length === 0 ? (
          connected ? (
            <>
              <span className="font-medium text-signal-600">
                AI MODEL is currently processing the CCTV footage.
              </span>{' '}
              Please wait a while, then you may play the video.
            </>
          ) : (
            'Waiting to reach the detection service. Scores appear once the model has analysed this file.'
          )
        ) : complete ? (
          `detecto-hackathon-final has analysed this file (${ticks.length} clips). Play the video — the bar is that model’s score for the current time.`
        ) : (
          <>
            <span className="font-medium text-signal-600">
              AI MODEL is currently processing the CCTV footage ({ticks.length}{' '}
              clips so far).
            </span>{' '}
            Please wait a while, then you may play the video.
          </>
        )}
      </p>

      {canPlay ? (
        <div className="relative overflow-hidden rounded-md bg-ink">
          <video
            ref={videoRef}
            className="block w-full bg-ink"
            src={src}
            controls
            playsInline
            preload="auto"
          />
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 px-4 py-3',
              'font-medium tracking-wide text-white',
              TONE_CLASS[banner.tone],
            )}
          >
            {banner.text}
          </div>
        </div>
      ) : (
        <Panel label="No file to play" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              This camera has no uploaded demo file. Watch live is the playback
              of a file Detecto already has — it is not a live RTSP stream.
            </p>
          </PanelBody>
        </Panel>
      )}

      <p className="mt-6 max-w-2xl text-meta text-neutral-500">
        <Link
          to="/org/cameras"
          className="underline decoration-neutral-300 underline-offset-4 hover:decoration-current"
        >
          Back to cameras
        </Link>
        {' · '}
        Overlay colours: green is both heads below 50%, orange is one head at or
        above, red is both. The two percentages are independent — Detecto does
        not fuse them into a single class on this page.
      </p>
    </>
  )
}
