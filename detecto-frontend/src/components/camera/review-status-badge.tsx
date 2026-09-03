import { Badge } from '@/components/ui/badge'
import type { Camera } from '@/lib/cameras/api'

const EXPLANATION =
  'A Detecto Box reported this camera on its own. It may already be sending ' +
  'a picture, but no detection module can be turned on for it until someone ' +
  'reviews and approves it.'

/**
 * Marks a camera a box auto-registered that nobody has approved yet.
 *
 * `unconfirmed` — the badge variant reserved for "awaiting a human
 * decision" (see components/ui/badge.tsx's own comment) — is exactly right
 * here, unlike PipelineBadge's `outline`: this genuinely is a thing waiting
 * on a person, not just an aside about where the row came from.
 *
 * Renders nothing for an approved camera, so it can sit unconditionally
 * wherever a camera is shown.
 */
export function ReviewStatusBadge({
  camera,
  className,
}: {
  camera: Pick<Camera, 'reviewStatus'>
  className?: string
}) {
  if (camera.reviewStatus !== 'pending') return null

  return (
    <Badge variant="unconfirmed" className={className} title={EXPLANATION}>
      Pending review
    </Badge>
  )
}
