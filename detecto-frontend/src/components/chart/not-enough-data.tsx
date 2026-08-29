import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * What sits where a chart would have gone, when there is not enough behind it
 * for the chart to mean anything.
 *
 * This is not an empty state and it does not apologise. Something is nearly
 * always known — how many detections there have been, what they were, how they
 * were decided — and all of it is still shown. What is withheld is the *shape*:
 * a trend line, a rate, a peak hour. Those are claims about a pattern, and a
 * pattern needs volume before anyone should be asked to act on it.
 *
 * A new organisation therefore gets a page that tells them the truth twice: the
 * numbers they have, and a plain sentence about what would make the picture
 * trustworthy. That is more useful than a chart with three points on it, and it
 * is considerably more useful than a blank rectangle.
 */
export function NotEnoughData({
  /** What is missing, in the customer's terms. One line, no hedging. */
  need,
  /** The counts that are true right now. Rendered as-is. */
  children,
  className,
}: {
  need: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-neutral-300 bg-paper-sunken px-4 py-4',
        className,
      )}
    >
      <p className="label-micro text-neutral-500">Not enough data yet</p>
      <p className="mt-2.5 max-w-xl text-meta text-neutral-600">{need}</p>
      {children && (
        <div className="mt-4 border-t border-neutral-200 pt-4">{children}</div>
      )}
    </div>
  )
}
