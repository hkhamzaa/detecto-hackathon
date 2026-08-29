import type { AccountType } from '@/lib/plans'
import { TOTAL_STEPS, type Step } from '@/store/signup-store'
import { cn } from '@/lib/utils'

function labelsFor(accountType: AccountType | null) {
  return [
    'Account type',
    accountType === 'org' ? 'Organization' : accountType === 'home' ? 'Your home' : 'Details',
    'Account',
    'Plan & checkout',
  ]
}

export function SignupProgress({
  step,
  accountType,
}: {
  step: Step
  accountType: AccountType | null
}) {
  const labels = labelsFor(accountType)

  return (
    <nav aria-label="Signup progress" className="mb-6">
      <p className="label-micro mb-3 text-neutral-500 sm:hidden">
        Step {step} of {TOTAL_STEPS} — {labels[step - 1]}
      </p>

      <ol className="flex gap-2">
        {labels.map((label, i) => {
          const n = i + 1
          const done = n < step
          const current = n === step
          return (
            <li
              key={label}
              className="min-w-0 flex-1"
              aria-current={current ? 'step' : undefined}
            >
              <div
                className={cn(
                  'h-0.5 w-full rounded-full',
                  current ? 'bg-paper' : done ? 'bg-neutral-500' : 'bg-neutral-800',
                )}
              />
              <p
                className={cn(
                  'label-micro mt-2 hidden truncate sm:block',
                  current ? 'text-paper' : done ? 'text-neutral-400' : 'text-neutral-600',
                )}
              >
                {label}
              </p>
              <span className="sr-only">
                {label}
                {done ? ' — done' : current ? ' — current step' : ' — not started'}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
