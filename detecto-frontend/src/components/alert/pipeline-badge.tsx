import { Badge } from '@/components/ui/badge'
import type { Alert } from '@/lib/alerts/api'

const EXPLANATION =
  'Raised by a detection pipeline that has not been verified. Treat the ' +
  'detection type and confidence as unconfirmed.'

/**
 * Marks an alert that came from a pipeline whose output is not trusted yet.
 *
 * `outline` rather than one of the alert variants on purpose. The others carry
 * meaning about the detection itself — `unconfirmed` there is a detection
 * waiting on a person, and this is not that. This says something about where
 * the row came from, so it takes the neutral variant the product already uses
 * for that kind of aside (a role, a recommended plan).
 *
 * Renders nothing for an ordinary alert, so it can sit unconditionally
 * wherever an alert is shown.
 */
export function PipelineBadge({
  alert,
  className,
}: {
  alert: Pick<Alert, 'pipelineStatus'>
  className?: string
}) {
  if (alert.pipelineStatus !== 'beta') return null

  return (
    <Badge variant="outline" className={className} title={EXPLANATION}>
      Beta
    </Badge>
  )
}
