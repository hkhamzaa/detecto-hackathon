import { useEffect, useRef } from 'react'

import { SignupProgress } from '@/pages/signup/progress'
import { StepAccountType } from '@/pages/signup/steps/account-type'
import { StepCredentials } from '@/pages/signup/steps/credentials'
import { StepDetails } from '@/pages/signup/steps/details'
import { StepPlan } from '@/pages/signup/steps/plan'
import { Confirmation } from '@/pages/signup/steps/confirmation'
import { useSignupStore } from '@/store/signup-store'

export default function SignupPage() {
  const step = useSignupStore((s) => s.step)
  const complete = useSignupStore((s) => s.complete)
  const accountType = useSignupStore((s) => s.accountType)

  const stepRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  // Move focus to the new step so keyboard and screen-reader users are not
  // left at the bottom of the screen they just finished.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    stepRef.current?.focus()
    window.scrollTo({ top: 0 })
  }, [step, complete])

  return (
    <div className="min-h-dvh bg-ink">
      <header className="border-b border-ink-hairline">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4 sm:px-6">
          <span aria-hidden="true" className="size-2 rounded-full bg-signal-500" />
          <span className="font-display text-title font-semibold tracking-tight text-paper">
            Detecto
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        {!complete && <SignupProgress step={step} accountType={accountType} />}

        <div
          key={complete ? 'done' : step}
          ref={stepRef}
          tabIndex={-1}
          className="animate-in fade-in slide-in-from-bottom-2 rounded-lg border border-ink-hairline bg-paper p-5 outline-none duration-200 sm:p-8"
        >
          {complete ? (
            <Confirmation />
          ) : step === 1 ? (
            <StepAccountType />
          ) : step === 2 ? (
            <StepDetails />
          ) : step === 3 ? (
            <StepCredentials />
          ) : (
            <StepPlan />
          )}
        </div>

        <p className="mt-6 text-center text-meta text-neutral-500">
          Detecto never contacts authorities on its own. A person confirms every
          alert first.
        </p>
      </main>
    </div>
  )
}
