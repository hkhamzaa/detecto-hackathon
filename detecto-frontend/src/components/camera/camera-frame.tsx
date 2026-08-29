import { Cctv } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Where a still from the camera will go. There is no imagery in the product
 * yet, and a grey rectangle that pretends to be a picture is worse than one
 * that admits it is waiting for one.
 */
export function CameraFrame({
  caption,
  muted = false,
  className,
}: {
  /** Usually the channel the box reported, set in mono under the frame. */
  caption?: string
  /** For a channel the box could not get a picture from. */
  muted?: boolean
  className?: string
}) {
  return (
    <div className={cn('w-24 shrink-0 sm:w-28', className)}>
      <div
        className={cn(
          'grid aspect-video place-items-center rounded-sm border',
          muted
            ? 'border-neutral-200 bg-paper-sunken'
            : 'border-neutral-300 bg-neutral-100',
        )}
      >
        <Cctv
          aria-hidden="true"
          className={cn('size-4', muted ? 'text-neutral-400' : 'text-neutral-500')}
        />
      </div>
      {caption && (
        <p className="mt-1.5 truncate font-mono text-micro uppercase tracking-[0.14em] text-neutral-500">
          {caption}
        </p>
      )}
    </div>
  )
}
