import { StatusWord } from '@/components/ui/status-word'
import type { Camera } from '@/lib/cameras/api'

type CameraLike = Pick<Camera, 'online' | 'sourceType'>

/**
 * Online, offline, or never configured — three genuinely different facts,
 * not one boolean. `sourceType: 'unconfigured'` means nothing has ever been
 * wired up to send this camera a picture, which is not the same claim as
 * "it was sending one and stopped." Collapsing the two into a single
 * Offline/Signal reading (this component's original shape) told an operator
 * a fault existed where there was only an unfinished setup step — see the
 * Step 1 report on camera status honesty.
 *
 * Mirrors the box-fleet pattern in lib/health/status.ts (`fleetTone`/
 * `fleetLabel`): a state nobody caused isn't drawn the same as a state
 * something broke. A camera nothing is receiving from *despite having a
 * real source* is a fault, so that keeps Signal, same as before.
 */
export function cameraTone(camera: CameraLike): 'confirm' | 'signal' | 'neutral' {
  if (camera.sourceType === 'unconfigured') return 'neutral'
  return camera.online ? 'confirm' : 'signal'
}

export function cameraStatusLabel(camera: CameraLike): string {
  if (camera.sourceType === 'unconfigured') return 'Not configured'
  return camera.online ? 'Online' : 'Offline'
}

export function CameraStatus({
  camera,
  className,
}: {
  camera: CameraLike
  className?: string
}) {
  return (
    <StatusWord tone={cameraTone(camera)} className={className}>
      {cameraStatusLabel(camera)}
    </StatusWord>
  )
}
