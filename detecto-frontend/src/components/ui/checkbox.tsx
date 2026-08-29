import type { ComponentProps } from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Native checkbox wearing the Detecto tokens — same reasoning as
 * `native-select`: the platform control needs no JS and cannot desynchronise
 * from the form it sits in.
 */
function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          'peer size-4.5 appearance-none rounded-sm border border-neutral-400 bg-paper-raised',
          'transition-colors duration-150',
          'checked:border-ink checked:bg-ink',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:bg-ink-raised dark:checked:border-paper dark:checked:bg-paper',
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2',
          'text-paper opacity-0 peer-checked:opacity-100 dark:text-ink',
        )}
      />
    </span>
  )
}

export { Checkbox }
