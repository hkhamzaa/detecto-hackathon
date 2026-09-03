import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { login } from '@/lib/auth/api'
import { DEMO_PERSONAS, demoPassword, type DemoPersona } from '@/lib/auth/demo-personas'
import { landingPathFor } from '@/lib/auth/redirect'
import { focusFirstInvalid, isEmail, type Errors } from '@/lib/forms'
import { useAuthStore } from '@/store/auth-store'

type FormError =
  | { kind: 'generic' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'unavailable' }

function messageFor(error: FormError) {
  switch (error.kind) {
    // One message for a wrong email and a wrong password alike. Anything that
    // distinguishes them hands an attacker a list of real accounts.
    case 'generic':
      return 'Email or password is incorrect.'
    case 'rate_limited':
      return `Too many attempts. Try again in ${formatWait(error.retryAfterSeconds)}.`
    case 'unavailable':
      return "Can't reach Detecto right now. Check your connection and try again."
  }
}

function formatWait(seconds: number) {
  if (seconds < 60) return 'less than a minute'
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export function CredentialsStep({
  onMfaRequired,
}: {
  onMfaRequired: (challengeId: string) => void
}) {
  const navigate = useNavigate()
  const signIn = useAuthStore((s) => s.signIn)

  // Nothing on this screen is persisted anywhere. It lives and dies here.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)

  const [errors, setErrors] = useState<Errors<'email' | 'password'>>({})
  const [formError, setFormError] = useState<FormError | null>(null)
  const [pending, setPending] = useState<'form' | string | null>(null)

  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return

    const next: Errors<'email' | 'password'> = {}
    if (!email.trim()) {
      next.email = 'Enter your email.'
    } else if (!isEmail(email)) {
      next.email = 'This needs an @ and a domain, like name@company.com.'
    }
    if (!password) next.password = 'Enter your password.'

    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }

    setPending('form')
    const result = await login({ email: email.trim(), password, remember })
    setPending(null)
    applyLoginResult(result)
  }

  const onDemoLogin = async (persona: DemoPersona) => {
    if (pending) return
    setFormError(null)
    setErrors({})
    setPending(persona.id)
    const result = await login({
      email: persona.email,
      password: demoPassword(),
      remember: false,
    })
    setPending(null)
    applyLoginResult(result)
  }

  const applyLoginResult = (result: Awaited<ReturnType<typeof login>>) => {
    if (result.ok) {
      const claims = signIn(result.accessToken)
      navigate(landingPathFor(claims), { replace: true })
      return
    }

    if (result.code === 'mfa_required') {
      onMfaRequired(result.challengeId)
      return
    }

    if (result.code === 'rate_limited') {
      setFormError({
        kind: 'rate_limited',
        retryAfterSeconds: result.retryAfterSeconds,
      })
      requestAnimationFrame(() => alertRef.current?.focus())
      return
    }

    if (result.code === 'unavailable') {
      setFormError({ kind: 'unavailable' })
      requestAnimationFrame(() => alertRef.current?.focus())
      return
    }

    setFormError({ kind: 'generic' })
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLInputElement>('input[type="password"]')
        ?.focus()
    })
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={Boolean(pending)}>
      <h1 className="font-display text-display-md font-medium text-ink">
        Sign in
      </h1>
      <p className="mt-3 text-body text-neutral-600">
        Alerts are waiting on the people who can confirm them.
      </p>

      {formError && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="mt-6 rounded-md border border-signal-500/40 bg-signal-50 px-4 py-3 text-meta text-signal-700 outline-none"
        >
          {messageFor(formError)}
        </div>
      )}

      <div className="mt-8 grid gap-6">
        <Field label="Email" error={errors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setErrors((p) => ({ ...p, email: undefined }))
              }}
              autoComplete="email"
              autoFocus
            />
          )}
        </Field>

        <div>
          <Field label="Password" error={errors.password}>
            {(props) => (
              <Input
                {...props}
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setErrors((p) => ({ ...p, password: undefined }))
                }}
                autoComplete="current-password"
              />
            )}
          </Field>
          <Link
            to="/forgot-password"
            className="mt-2 inline-block text-meta text-neutral-600 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Forgot your password?
          </Link>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="block text-meta font-medium text-ink">
              Remember me
            </span>
            <span className="block text-meta text-neutral-600">
              Keeps you signed in on this device for 30 days. Leave it off on a
              shared computer.
            </span>
          </span>
        </label>
      </div>

      <Button
        type="submit"
        size="lg"
        className="mt-8 w-full"
        disabled={Boolean(pending)}
      >
        {pending === 'form' ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="mt-4 text-center text-body font-medium text-signal-600">
        Scroll below to sign in directly — no email or password needed.
      </p>

      <div className="mt-8 border-t border-neutral-200 pt-6">
        <p className="text-meta font-medium text-ink">Demo roles</p>
        <p className="mt-1 text-meta text-neutral-600">
          Hackathon shortcut. One click signs you in as that person.
        </p>
        <ul className="mt-4 grid gap-2">
          {DEMO_PERSONAS.map((persona) => (
            <li
              key={persona.id}
              className={
                persona.recommended
                  ? 'flex items-center gap-3 rounded-md border-2 border-signal-500 bg-signal-50/40 px-3 py-2.5'
                  : 'flex items-center gap-3 rounded-md border border-neutral-200 px-3 py-2.5'
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-meta font-medium text-ink">{persona.label}</p>
                  {persona.recommended && (
                    <span className="rounded-full bg-signal-500 px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-white">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="font-mono text-meta text-neutral-700">{persona.email}</p>
                <p className="text-meta text-neutral-600">{persona.blurb}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(pending)}
                onClick={() => void onDemoLogin(persona)}
              >
                {pending === persona.id ? 'Signing in…' : 'Log in'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  )
}
