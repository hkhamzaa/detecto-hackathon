import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSignupStore } from '@/store/signup-store'

export function StepHeading({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-display-md font-medium text-ink">{title}</h1>
      {children && (
        <p className="mt-3 max-w-prose text-body text-neutral-600">{children}</p>
      )}
    </div>
  )
}

/** Back on the left, the one forward action on the right. */
export function StepActions({
  submitLabel,
  showBack = true,
}: {
  submitLabel: string
  showBack?: boolean
}) {
  const goBack = useSignupStore((s) => s.goBack)

  return (
    <div className="mt-10 flex flex-col-reverse gap-3 border-t border-neutral-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
      {showBack ? (
        <Button type="button" variant="ghost" onClick={goBack} className="sm:w-auto">
          <ArrowLeft />
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" size="lg" className="w-full sm:w-auto">
        {submitLabel}
      </Button>
    </div>
  )
}
