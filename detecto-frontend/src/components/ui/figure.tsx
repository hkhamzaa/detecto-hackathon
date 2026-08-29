import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * One headline number with a plain label under it.
 *
 * Lifted out of the org analytics overview strip when the platform overview
 * needed the same thing — the two pages ask different questions of different
 * data and arrive at an identical shape, which is the point at which a local
 * component becomes a shared one.
 *
 * The type division is the product's, not this file's: the figure is mono,
 * because it is machine-reported data, and the label and note are Inter,
 * because they are words a person wrote. Signal is available and is for the
 * case where the number is itself the problem — cameras offline, accounts
 * suspended — never for emphasis.
 */
export function Figure({
  label,
  value,
  note,
  tone = 'neutral',
  className,
}: {
  label: string
  value: string
  note?: ReactNode
  tone?: 'neutral' | 'signal'
  className?: string
}) {
  return (
    <div className={cn('px-5 py-5 sm:px-6', className)}>
      <p className="text-meta text-neutral-500">{label}</p>
      <p
        className={cn(
          'mt-2 font-mono text-display-md font-medium',
          tone === 'signal' ? 'text-signal-700' : 'text-ink',
        )}
      >
        {value}
      </p>
      {note && <div className="mt-1.5 text-meta text-neutral-500">{note}</div>}
    </div>
  )
}
