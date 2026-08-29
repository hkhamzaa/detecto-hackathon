import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * `Input`, for text that runs to more than a line.
 *
 * Same tokens, same focus treatment, same invalid state — the only differences
 * are the ones the element forces: a minimum height instead of a fixed one, and
 * vertical-only resizing, so dragging the corner cannot break the column it
 * sits in.
 */
function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(
        'flex min-h-20 w-full resize-y rounded-md border border-input bg-paper-raised px-3 py-2 text-body text-foreground',
        'placeholder:text-neutral-400',
        'transition-colors duration-150',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-signal-500 aria-[invalid=true]:focus-visible:outline-signal-500',
        'dark:bg-ink-raised',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
