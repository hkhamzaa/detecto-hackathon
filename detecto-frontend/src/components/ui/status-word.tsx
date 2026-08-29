import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A state, said in a word, with a dot agreeing with it.
 *
 * Not a `Badge`: those variants carry alert meaning — `confirmed` there is a
 * human having verified a detection — and most states in the product are not
 * that. This is the plain alternative, lifted out of the camera list where the
 * distinction was first drawn.
 *
 * The rule the tones follow: colour the *word* only when something needs a
 * person. A state that is simply fine gets a coloured dot and neutral text, so
 * a screen full of fine things stays quiet and the one that isn't stands out.
 */

const TONES = {
  /** Needs attention: unreviewed, offline, failed. */
  signal: { dot: 'bg-signal-500', text: 'text-signal-700' },
  /** Resolved and good: online, confirmed by a person. */
  confirm: { dot: 'bg-confirm-500', text: 'text-neutral-700' },
  /** Resolved and unremarkable: dismissed, closed, archived. */
  neutral: { dot: 'bg-neutral-400', text: 'text-neutral-500' },
}

export function StatusWord({
  tone,
  className,
  children,
}: {
  tone: keyof typeof TONES
  className?: string
  children: ReactNode
}) {
  const { dot, text } = TONES[tone]

  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot)} />
      <span className={text}>{children}</span>
    </span>
  )
}
