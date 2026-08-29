import { Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { digits } from '@/lib/forms'

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
  id,
  label,
  className,
  ...aria
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  id?: string
  /** Used for the +/- button labels, e.g. "cameras". */
  label: string
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        aria-label={`One fewer ${label}`}
      >
        <Minus />
      </Button>

      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          const raw = digits(e.target.value)
          onChange(raw === '' ? min : clamp(Number(raw)))
        }}
        className={cn(
          'h-10 w-20 rounded-md border border-input bg-paper-raised text-center font-mono text-data text-foreground',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'aria-[invalid=true]:border-signal-500',
          'dark:bg-ink-raised',
        )}
        {...aria}
      />

      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        aria-label={`One more ${label}`}
      >
        <Plus />
      </Button>
    </div>
  )
}
