import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-paper-raised px-3 text-body text-foreground',
        'placeholder:text-neutral-400',
        'transition-colors duration-150',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-signal-500 aria-[invalid=true]:focus-visible:outline-signal-500',
        'dark:bg-ink-raised',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
