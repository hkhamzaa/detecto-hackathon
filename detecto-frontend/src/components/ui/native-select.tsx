import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A native <select> wearing the Detecto tokens.
 *
 * Deliberately not the Radix listbox: for a five-option field in a signup form
 * the platform control is better — it opens as a real picker on mobile, needs
 * no JS, and cannot desynchronise from the form. Named `native-select` so a
 * later `shadcn add select` does not collide with it.
 */
function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          'flex h-10 w-full appearance-none rounded-md border border-input bg-paper-raised pl-3 pr-9 text-body text-foreground',
          'transition-colors duration-150',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-[invalid=true]:border-signal-500 aria-[invalid=true]:focus-visible:outline-signal-500',
          'dark:bg-ink-raised',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
      />
    </div>
  )
}

export { NativeSelect }
