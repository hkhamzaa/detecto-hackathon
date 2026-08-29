import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { AuthShell } from '@/components/auth-shell'
import { CredentialsStep } from '@/pages/login/steps/credentials'
import { MfaStep } from '@/pages/login/steps/mfa'

/**
 * Login is one screen, not a wizard — but it is built as a step container so a
 * verification-code step can be dropped in without restructuring the page.
 * Today only `credentials` is reachable.
 */
export type LoginStep = 'credentials' | 'mfa'

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>('credentials')
  const [challengeId, setChallengeId] = useState<string | null>(null)

  const stepRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    stepRef.current?.focus()
  }, [step])

  return (
    <AuthShell
      footer={
        <p className="text-meta text-neutral-500">
          No account yet?{' '}
          <Link
            to="/signup"
            className="text-neutral-300 underline decoration-neutral-600 underline-offset-4 transition-colors hover:text-paper hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Create one
          </Link>
        </p>
      }
    >
      <div
        key={step}
        ref={stepRef}
        tabIndex={-1}
        className="animate-in fade-in duration-200 outline-none"
      >
        {step === 'credentials' ? (
          <CredentialsStep
            onMfaRequired={(id) => {
              setChallengeId(id)
              setStep('mfa')
            }}
          />
        ) : (
          <MfaStep
            challengeId={challengeId}
            onBack={() => {
              setChallengeId(null)
              setStep('credentials')
            }}
          />
        )}
      </div>
    </AuthShell>
  )
}
