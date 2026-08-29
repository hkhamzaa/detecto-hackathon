import { useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Panel, PanelBody } from '@/components/ui/panel'
import { useChangePassword } from '@/lib/account/queries'
import {
  countIssues,
  focusFirstInvalid,
  MIN_PASSWORD,
  passwordIssue,
  type Errors,
} from '@/lib/forms'

type PasswordField = 'current' | 'next' | 'repeat'

/**
 * Changing your own password while signed in.
 *
 * A different thing from the reset link on the sign-in screen, and deliberately
 * a different endpoint: that one proves you own an inbox, this one proves you
 * know the current password. Asking for the current password is the whole
 * security value of this form — without it, an unattended signed-in machine is
 * a permanent takeover rather than a temporary one — so it is required and the
 * server checks it as well.
 *
 * The repeat field is here because there is no way back from a typo: get it
 * wrong once and the new password is something nobody knows, and the only route
 * in is the reset email. That is a cheap field to justify.
 */
export function ChangePassword() {
  const mutation = useChangePassword()
  const formRef = useRef<HTMLFormElement>(null)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<Errors<PasswordField>>({})

  const clear = (field: PasswordField) =>
    setErrors((issues) => ({ ...issues, [field]: undefined }))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return

    const issues: Errors<PasswordField> = {}
    if (!current) issues.current = 'Enter your current password.'
    issues.next = passwordIssue(next)
    if (!issues.next && next === current) {
      issues.next = 'That is your current password. Pick a different one.'
    }
    if (!issues.next && repeat !== next) {
      issues.repeat = "This doesn't match the new password."
    }

    setErrors(issues)
    if (countIssues(issues) > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }

    mutation.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          // Nothing is kept once it has been used. Leaving three passwords in
          // component state after a successful change is a needless place for
          // them to sit.
          setCurrent('')
          setNext('')
          setRepeat('')
        },
      },
    )
  }

  return (
    <Panel label="Password" className="mb-6">
      <PanelBody>
        <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={mutation.isPending}>
          <p className="max-w-2xl text-meta text-neutral-600">
            At least {MIN_PASSWORD} characters — that is the whole rule. Your
            current password is asked for because knowing it is what proves this
            is you and not somebody who found the screen unlocked.
          </p>

          {mutation.isSuccess && (
            <p
              role="status"
              className="mt-5 max-w-prose rounded-md border border-confirm-500/35 bg-confirm-50 px-4 py-3 text-meta text-confirm-800"
            >
              Your password has been changed. You are still signed in here — and
              anywhere else you were already signed in stays signed in, because
              Detecto has no record of your other sessions to end. That gap is
              on the organisation's security page.
            </p>
          )}

          <fieldset
            disabled={mutation.isPending}
            className="mt-6 grid gap-6 sm:max-w-md"
          >
            <legend className="sr-only">Change your password</legend>

            <Field label="Current password" error={errors.current}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={current}
                  onChange={(event) => {
                    setCurrent(event.target.value)
                    clear('current')
                  }}
                  autoComplete="current-password"
                />
              )}
            </Field>

            <Field
              label="New password"
              error={errors.next}
              hint={`At least ${MIN_PASSWORD} characters.`}
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={next}
                  onChange={(event) => {
                    setNext(event.target.value)
                    clear('next')
                  }}
                  autoComplete="new-password"
                />
              )}
            </Field>

            <Field label="New password again" error={errors.repeat}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={repeat}
                  onChange={(event) => {
                    setRepeat(event.target.value)
                    clear('repeat')
                  }}
                  autoComplete="new-password"
                />
              )}
            </Field>
          </fieldset>

          {mutation.isError && (
            <p role="alert" className="mt-5 max-w-prose text-meta text-signal-700">
              {mutation.error instanceof Error &&
              mutation.error.message === 'wrong_password'
                ? 'That is not your current password. Nothing has been changed.'
                : mutation.error instanceof Error &&
                    mutation.error.message === 'weak_password'
                  ? `Detecto refused it: a password needs at least ${MIN_PASSWORD} characters.`
                  : "Nothing was changed — the request didn't reach Detecto. Your password is still the one you signed in with."}
            </p>
          )}

          <Button type="submit" className="mt-6" disabled={mutation.isPending}>
            {mutation.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </PanelBody>
    </Panel>
  )
}
