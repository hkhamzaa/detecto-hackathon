import { useRef, useState, type FormEvent } from 'react'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { StepActions, StepHeading } from '@/pages/signup/step-parts'
import {
  countIssues,
  focusFirstInvalid,
  isEmail,
  isPhone,
  issueSummary,
  MIN_PASSWORD,
  passwordIssue,
  type Errors,
} from '@/lib/forms'
import { useSignupStore } from '@/store/signup-store'

type AccountField = 'name' | 'email' | 'phone' | 'password'

export function StepCredentials() {
  const account = useSignupStore((s) => s.account)
  const patchAccount = useSignupStore((s) => s.patchAccount)
  const goNext = useSignupStore((s) => s.goNext)
  const [errors, setErrors] = useState<Errors<AccountField>>({})
  const formRef = useRef<HTMLFormElement>(null)

  const clear = (field: AccountField) =>
    setErrors((prev) => ({ ...prev, [field]: undefined }))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next: Errors<AccountField> = {}

    if (!account.name.trim()) {
      next.name = 'Enter the name this account belongs to.'
    }
    if (!account.email.trim()) {
      next.email = 'Enter an email address. Confirmations and alerts go here.'
    } else if (!isEmail(account.email)) {
      next.email = 'This needs an @ and a domain, like name@company.com.'
    }
    if (!account.phone.trim()) {
      next.phone = 'Enter a phone number we can reach you on.'
    } else if (!isPhone(account.phone)) {
      next.phone = 'This needs at least 7 digits.'
    }
    // The one password rule the product has, applied from the one place that
    // states it — see `MIN_PASSWORD` in `lib/forms.ts`.
    next.password = passwordIssue(account.password)

    setErrors(next)
    // `countIssues`, not a key count: `passwordIssue` returns undefined for a
    // password that is fine, and assigning that still creates the key.
    if (countIssues(next) > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    goNext()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <StepHeading title="Your account">
        This is the account you'll sign in with. One person owns it; you can
        invite others once setup is done.
      </StepHeading>

      <div className="grid gap-6">
        <Field label="Full name" error={errors.name}>
          {(props) => (
            <Input
              {...props}
              value={account.name}
              onChange={(e) => {
                patchAccount({ name: e.target.value })
                clear('name')
              }}
              autoComplete="name"
            />
          )}
        </Field>

        <Field label="Email" error={errors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              inputMode="email"
              value={account.email}
              onChange={(e) => {
                patchAccount({ email: e.target.value })
                clear('email')
              }}
              autoComplete="email"
            />
          )}
        </Field>

        <Field
          label="Phone"
          error={errors.phone}
          hint="Used to reach you when an alert is waiting on a decision."
        >
          {(props) => (
            <Input
              {...props}
              type="tel"
              inputMode="tel"
              value={account.phone}
              onChange={(e) => {
                patchAccount({ phone: e.target.value })
                clear('phone')
              }}
              autoComplete="tel"
            />
          )}
        </Field>

        <Field
          label="Password"
          error={errors.password}
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              value={account.password}
              onChange={(e) => {
                patchAccount({ password: e.target.value })
                clear('password')
              }}
              autoComplete="new-password"
            />
          )}
        </Field>
      </div>

      <p aria-live="polite" className="sr-only">
        {issueSummary(errors)}
      </p>
      <StepActions submitLabel="Continue" />
    </form>
  )
}
