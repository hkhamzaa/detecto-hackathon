import { StatusWord } from '@/components/ui/status-word'

/**
 * Online or not. A camera nothing is receiving from is watching nobody, which
 * is a fault rather than a neutral state — so it takes Signal, the way any
 * other error in the product does.
 */
export function CameraStatus({
  online,
  className,
}: {
  online: boolean
  className?: string
}) {
  return (
    <StatusWord tone={online ? 'confirm' : 'signal'} className={className}>
      {online ? 'Online' : 'Offline'}
    </StatusWord>
  )
}
