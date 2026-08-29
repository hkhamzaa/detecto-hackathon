import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The bordered Paper surface with a hairline label strip, lifted out of
 * `PagePlaceholder` where the pattern started. Empty states, loading states,
 * result groups and review blocks are all this shape — the dot's tone is the
 * only thing that changes, and it changes for a reason.
 */

const DOT = {
  neutral: 'bg-neutral-400',
  /** Something needs attention or could not be reached. */
  signal: 'bg-signal-500',
  /** Something is done, connected, or verified. */
  confirm: 'bg-confirm-500',
}

export function Panel({
  label,
  tone = 'neutral',
  action,
  className,
  children,
}: {
  label?: string
  tone?: keyof typeof DOT
  /** Sits at the right of the label strip — a retry, a count, a small link. */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  const labelId = useId()

  return (
    <section
      aria-labelledby={label ? labelId : undefined}
      className={cn(
        'rounded-md border border-neutral-200 bg-paper-raised',
        className,
      )}
    >
      {label && (
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])}
            />
            <h2 id={labelId} className="label-micro truncate text-neutral-500">
              {label}
            </h2>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Standard padding for panel contents. Omit it when the child is a table. */
export function PanelBody({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={cn('px-5 py-5 sm:px-6', className)}>{children}</div>
}
