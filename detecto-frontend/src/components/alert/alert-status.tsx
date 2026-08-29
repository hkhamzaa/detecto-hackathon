import { StatusWord } from '@/components/ui/status-word'
import type { AlertStatus as Status } from '@/lib/alerts/api'
import { statusLabel } from '@/lib/alerts/labels'

const TONE = {
  /** The only one that needs a person, so the only one that gets Signal. */
  unconfirmed: 'signal',
  confirmed: 'confirm',
  dismissed: 'neutral',
} as const

export function AlertStatus({
  status,
  className,
}: {
  status: Status
  className?: string
}) {
  return (
    <StatusWord tone={TONE[status]} className={className}>
      {statusLabel(status)}
    </StatusWord>
  )
}
