import type { LucideIcon } from 'lucide-react'
import { Building2, House } from 'lucide-react'

import { StepHeading } from '@/pages/signup/step-parts'
import { useSignupStore } from '@/store/signup-store'
import type { AccountType } from '@/lib/plans'

const CHOICES: {
  value: AccountType
  title: string
  body: string
  icon: LucideIcon
}[] = [
  {
    value: 'home',
    title: 'Home',
    body: 'One property, a handful of cameras. You confirm alerts yourself.',
    icon: House,
  },
  {
    value: 'org',
    title: 'Organization / Business',
    body: 'One or more sites, with staff who each need their own sign-in and permissions.',
    icon: Building2,
  },
]

export function StepAccountType() {
  const chooseAccountType = useSignupStore((s) => s.chooseAccountType)

  return (
    <div>
      <StepHeading title="Who are these cameras for?">
        This decides what we ask next.
      </StepHeading>

      <div className="grid gap-4 sm:grid-cols-2">
        {CHOICES.map(({ value, title, body, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => chooseAccountType(value)}
            className="group flex min-h-44 flex-col items-start rounded-md border border-neutral-300 bg-paper-raised p-5 text-left transition-colors duration-150 hover:border-ink hover:bg-paper-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-6"
          >
            <Icon aria-hidden="true" className="size-5 text-neutral-500" />
            <span className="mt-4 font-display text-display-sm font-medium text-ink">
              {title}
            </span>
            <span className="mt-2 text-meta text-neutral-600">{body}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
