import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5',
    'label-micro whitespace-nowrap',
    '[&>svg]:size-3 [&>svg]:pointer-events-none',
  ),
  {
    variants: {
      variant: {
        /* Awaiting a human decision — the only place Signal appears at rest. */
        unconfirmed:
          'border-signal-500/35 bg-signal-50 text-signal-700 dark:border-signal-500/40 dark:bg-signal-950 dark:text-signal-300',
        /* A person took responsibility for this flag. */
        confirmed:
          'border-confirm-500/35 bg-confirm-50 text-confirm-700 dark:border-confirm-500/40 dark:bg-confirm-950 dark:text-confirm-300',
        dismissed:
          'border-border bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400',
        outline: 'border-border bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'outline',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
