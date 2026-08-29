import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * A native checkbox wearing `role="switch"` — same reasoning as `checkbox` and
 * `native-select`: the platform control needs no JS, is keyboard-operable for
 * free, and cannot desynchronise from what it represents.
 *
 * A switch rather than a checkbox because the distinction is real: a checkbox
 * says "this will be applied when you save", a switch says "this takes effect
 * now". Module toggles take effect now.
 *
 * On is Ink, not Confirm. Confirm means a person verified something; a module
 * being switched on is a setting, not a verdict, and the two should not wear
 * the same colour.
 */
function Switch({ className, ...props }: ComponentProps<'input'>) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        data-slot="switch"
        className={cn(
          'peer h-5 w-9 appearance-none rounded-full border border-neutral-400 bg-neutral-200',
          'transition-colors duration-150',
          'checked:border-ink checked:bg-ink',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:border-neutral-600 dark:bg-neutral-800 dark:checked:border-paper dark:checked:bg-paper',
          className,
        )}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-paper-raised',
          'transition-transform duration-150 peer-checked:translate-x-4',
          'peer-disabled:opacity-70',
          'dark:bg-ink dark:peer-checked:bg-ink',
        )}
      />
    </span>
  )
}

export { Switch }
