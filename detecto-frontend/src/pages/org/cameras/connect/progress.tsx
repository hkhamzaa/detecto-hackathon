import { cn } from '@/lib/utils'

/**
 * The signup progress bar, retoned for Paper. Same shape deliberately: four
 * rules, the current one filled, labels that collapse to a single line of text
 * on a small screen where four truncated labels would say nothing.
 */
export function WizardProgress({
  steps,
  current,
  label,
}: {
  steps: string[]
  /** 1-based. */
  current: number
  label: string
}) {
  return (
    <nav aria-label={label} className="mb-8">
      <p className="label-micro mb-3 text-neutral-500 sm:hidden">
        Step {current} of {steps.length} — {steps[current - 1]}
      </p>

      <ol className="flex gap-2">
        {steps.map((step, i) => {
          const n = i + 1
          const done = n < current
          const isCurrent = n === current
          return (
            <li
              key={step}
              className="min-w-0 flex-1"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div
                className={cn(
                  'h-0.5 w-full rounded-full',
                  isCurrent ? 'bg-ink' : done ? 'bg-neutral-400' : 'bg-neutral-200',
                )}
              />
              <p
                className={cn(
                  'label-micro mt-2 hidden truncate sm:block',
                  isCurrent
                    ? 'text-ink'
                    : done
                      ? 'text-neutral-600'
                      : 'text-neutral-400',
                )}
              >
                {step}
              </p>
              <span className="sr-only">
                {step}
                {done ? ' — done' : isCurrent ? ' — current step' : ' — not started'}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
