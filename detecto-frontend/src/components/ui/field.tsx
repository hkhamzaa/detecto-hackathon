import { useId, type ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type ControlProps = {
  id: string
  'aria-describedby': string | undefined
  'aria-invalid': true | undefined
}

/**
 * Wires a label, hint and error message to a control with the right ids, so
 * every field announces its own requirement and its own failure.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  className?: string
  children: (props: ControlProps) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {optional && (
          <span className="text-meta text-neutral-500">Optional</span>
        )}
      </div>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {hint && !error && (
        <p id={hintId} className="text-meta text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-meta text-signal-700 dark:text-signal-300">
          {error}
        </p>
      )}
    </div>
  )
}
