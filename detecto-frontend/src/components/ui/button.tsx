import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'font-medium transition-colors duration-150',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/88 active:bg-primary/78',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-neutral-200 active:bg-neutral-300 dark:hover:bg-neutral-800 dark:active:bg-neutral-700',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground active:bg-neutral-200 dark:active:bg-neutral-800',
        ghost:
          'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground active:bg-neutral-200 dark:active:bg-neutral-800',
        /* Signal. Escalating an unconfirmed detection, and destructive or
           dangerous actions elsewhere in the app.
           Rests on signal-600 so the white label clears AA (5.70:1 vs 4.38:1
           on signal-500); hover/active step down to keep the press feedback.
           signal-500 remains the resting value everywhere else in the system. */
        destructive:
          'bg-signal-600 text-white hover:bg-signal-700 active:bg-signal-800 focus-visible:outline-signal-500',
        /* Confirm. Human-verified / trust actions. */
        confirm:
          'bg-confirm-500 text-white hover:bg-confirm-600 active:bg-confirm-700',
        link: 'bg-transparent text-foreground underline underline-offset-4 decoration-neutral-400 hover:decoration-current',
      },
      size: {
        sm: 'h-8 gap-1.5 px-3 text-meta',
        default: 'h-9 px-4 text-meta',
        lg: 'h-11 px-6 text-body',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
