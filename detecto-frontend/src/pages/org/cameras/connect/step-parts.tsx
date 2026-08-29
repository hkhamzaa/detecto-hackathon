import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Signup's step parts, with the heading dropped a level: this wizard lives on a
 * page that already owns an `h1`, so each step heads its own section instead of
 * claiming the page.
 */
export function StepHeading({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="mb-7">
      <h2 className="font-display text-display-md font-medium text-ink">{title}</h2>
      {children && (
        <p className="mt-3 max-w-prose text-body text-neutral-600">{children}</p>
      )}
    </div>
  )
}

/** Back on the left, the one forward action on the right. */
export function StepActions({
  submitLabel,
  onBack,
  pending = false,
  disabled = false,
  hint,
}: {
  submitLabel: string
  /** Omit on the first step, where there is nowhere to go back to. */
  onBack?: () => void
  pending?: boolean
  disabled?: boolean
  /** Why the forward action is unavailable, when it is. */
  hint?: string
}) {
  return (
    <div className="mt-9 border-t border-neutral-200 pt-6">
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
            <ArrowLeft />
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto"
          disabled={pending || disabled}
        >
          {submitLabel}
        </Button>
      </div>
      {hint && (
        <p className="mt-3 text-meta text-neutral-500 sm:text-right">{hint}</p>
      )}
    </div>
  )
}
