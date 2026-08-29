import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { requestPasswordReset } from '@/lib/auth/api'
import { focusFirstInvalid, isEmail, type Errors } from '@/lib/forms'

type Stage = 'form' | 'sent'

export default function ForgotPasswordPage() {
  const [stage, setStage] = useState<Stage>('form')
  const [email, setEmail] = useState('')

  const stageRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    stageRef.current?.focus()
  }, [stage])

  return (
    <AuthShell
      footer={
        <p className="text-meta text-neutral-500">
          Remembered it?{' '}
          <Link
            to="/login"
            className="text-neutral-300 underline decoration-neutral-600 underline-offset-4 transition-colors hover:text-paper hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <div
        key={stage}
        ref={stageRef}
        tabIndex={-1}
        className="animate-in fade-in duration-200 outline-none"
      >
        {stage === 'form' ? (
          <RequestForm
            email={email}
            setEmail={setEmail}
            onSent={() => setStage('sent')}
          />
        ) : (
          <SentNotice email={email} onSendAgain={() => setStage('form')} />
        )}
      </div>
    </AuthShell>
  )
}

function RequestForm({
  email,
  setEmail,
  onSent,
}: {
  email: string
  setEmail: (value: string) => void
  onSent: () => void
}) {
  const [errors, setErrors] = useState<Errors<'email'>>({})
  const [transportError, setTransportError] = useState(false)
  const [pending, setPending] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return

    const next: Errors<'email'> = {}
    if (!email.trim()) {
      next.email = 'Enter the email on the account.'
    } else if (!isEmail(email)) {
      next.email = 'This needs an @ and a domain, like name@company.com.'
    }

    setErrors(next)
    setTransportError(false)
    if (next.email) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }

    setPending(true)
    const result = await requestPasswordReset(email.trim())
    setPending(false)

    // Only a transport failure is reported. Any answer the server actually
    // gave leads to the same notice, whether or not the account exists.
    if (!result.ok) {
      setTransportError(true)
      requestAnimationFrame(() => alertRef.current?.focus())
      return
    }
    onSent()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={pending}>
      <h1 className="font-display text-display-md font-medium text-ink">
        Reset your password
      </h1>
      <p className="mt-3 text-body text-neutral-600">
        Enter the email on the account. We'll send a link to set a new one.
      </p>

      {transportError && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="mt-6 rounded-md border border-signal-500/40 bg-signal-50 px-4 py-3 text-meta text-signal-700 outline-none"
        >
          Can't reach Detecto right now. Check your connection and try again.
        </div>
      )}

      <div className="mt-8">
        <Field label="Email" error={errors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setErrors({})
              }}
              autoComplete="email"
              autoFocus
            />
          )}
        </Field>
      </div>

      <Button type="submit" size="lg" className="mt-8 w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>

      <div className="mt-6 border-t border-neutral-200 pt-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    </form>
  )
}

function SentNotice({
  email,
  onSendAgain,
}: {
  email: string
  onSendAgain: () => void
}) {
  return (
    <div>
      <h1 className="font-display text-display-md font-medium text-ink">
        Check your email
      </h1>
      <p className="mt-3 text-body text-neutral-600">
        If that email has an account, we've sent a reset link to{' '}
        <span className="font-mono text-data text-ink">{email}</span>.
      </p>
      <p className="mt-4 text-meta text-neutral-600">
        The link works once and expires in 30 minutes. Your current password
        keeps working until you set a new one.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link to="/login">Back to sign in</Link>
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onSendAgain}>
          Send it again
        </Button>
      </div>
    </div>
  )
}
