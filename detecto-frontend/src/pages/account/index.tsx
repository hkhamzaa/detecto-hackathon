import { useRef, useState, type FormEvent } from 'react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { Account } from '@/lib/account/api'
import { useAccount, useSaveAccount } from '@/lib/account/queries'
import { roleLabel } from '@/lib/auth/labels'
import {
  countIssues,
  focusFirstInvalid,
  isEmail,
  issueSummary,
  type Errors,
} from '@/lib/forms'
import { ChangePassword } from '@/pages/account/password'
import { useAuthStore } from '@/store/auth-store'

/**
 * Your own account, as distinct from your organisation's settings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO PERMISSION GATE, AND THAT IS THE POINT
 *
 * This is the one authenticated page in the product with no `can()` check on
 * it. Everybody signed in has an account, including somebody holding no grants
 * at all who lands on `/no-access` — they still have a name, an email address
 * and a password, and no administrator should have to be involved for them to
 * change their own.
 *
 * That also means it belongs to no navigation area. `navFor` sorts people into
 * exactly one of admin, org or scoped, and this page is none of them, so it is
 * routed beside `/no-access`: inside the session guard, outside `Guarded`,
 * reached from the header rather than the sidebar. It is in its own lazy chunk
 * for the same reason — an operator should not download the org area to change
 * their password.
 *
 * WHAT IT DOES NOT TOUCH
 *
 * Nothing about the organisation: not its name, not its people, not its roles,
 * not another person's record. `lib/account/api.ts` has no function that takes
 * an id, and `pages/account/boundary.test.tsx` holds that as a build failure
 * rather than a habit. Your role is shown, because it is a fact about you worth
 * seeing, and it is read-only here — changing what somebody is allowed to do is
 * `users:manage`'s job, on the People page, and it must not be self-service.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AccountPage() {
  const claims = useAuthStore((s) => s.claims)
  const account = useAccount()

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Account"
        lead="Your own name, email address and password. This is yours, not your organisation's — nothing here changes anything for anybody else."
      />

      {account.isPending ? (
        <Loading />
      ) : account.isError ? (
        <Unavailable
          onRetry={() => void account.refetch()}
          pending={account.isFetching}
        />
      ) : (
        <>
          <Details account={account.data} />
          <ChangePassword />
          <YourAccess />
          <Gaps />
        </>
      )}

      <p className="max-w-2xl text-meta text-neutral-500">
        Signed in as{' '}
        <span className="font-mono text-data text-neutral-600">
          {claims?.email}
        </span>
        {claims && <> · {roleLabel(claims.role)}</>}. What you are allowed to do
        is set by your organisation, not on this page.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Name and email                                                             */
/* -------------------------------------------------------------------------- */

type DetailField = 'name' | 'email'

function Details({ account }: { account: Account }) {
  const mutation = useSaveAccount()
  const formRef = useRef<HTMLFormElement>(null)

  const [draft, setDraft] = useState({ name: account.name, email: account.email })
  const [errors, setErrors] = useState<Errors<DetailField>>({})

  // Re-seeded during render when the stored record changes underneath us — the
  // same pattern the org profile form and the tenant support note use.
  const [seeded, setSeeded] = useState(account)
  if (seeded !== account) {
    setSeeded(account)
    setDraft({ name: account.name, email: account.email })
  }

  const dirty = draft.name !== account.name || draft.email !== account.email

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return

    const issues: Errors<DetailField> = {}
    if (!draft.name.trim()) {
      issues.name = 'Enter the name your colleagues will recognise.'
    }
    if (!draft.email.trim()) {
      issues.email = 'Enter your email address.'
    } else if (!isEmail(draft.email)) {
      issues.email = 'This needs an @ and a domain, like name@company.com.'
    }

    setErrors(issues)
    if (countIssues(issues) > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }

    mutation.mutate({ name: draft.name.trim(), email: draft.email.trim() })
  }

  return (
    <Panel label="You" className="mb-6">
      <PanelBody>
        <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={mutation.isPending}>
          <fieldset disabled={mutation.isPending} className="grid gap-6 sm:max-w-md">
            <legend className="sr-only">Your details</legend>

            <Field
              label="Name"
              error={errors.name}
              hint="Shown beside anything you confirm, so your colleagues know who decided."
            >
              {(props) => (
                <Input
                  {...props}
                  value={draft.name}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, name: event.target.value }))
                    setErrors((issues) => ({ ...issues, name: undefined }))
                  }}
                  autoComplete="name"
                  maxLength={60}
                />
              )}
            </Field>

            <Field
              label="Email"
              error={errors.email}
              hint="You sign in with this, and it is where a password reset would be sent."
            >
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  inputMode="email"
                  value={draft.email}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, email: event.target.value }))
                    setErrors((issues) => ({ ...issues, email: undefined }))
                  }}
                  autoComplete="email"
                />
              )}
            </Field>
          </fieldset>

          {mutation.isError && (
            <p role="alert" className="mt-5 max-w-prose text-meta text-signal-700">
              {mutation.error instanceof Error && mutation.error.message === 'email_taken'
                ? 'Somebody in your organisation already uses that email address. Nothing has been changed.'
                : "Nothing was saved — the change didn't reach Detecto. Your details are exactly as they were."}
            </p>
          )}

          <p aria-live="polite" className="sr-only">
            {issueSummary(errors)}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!dirty || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>

            {dirty && !mutation.isPending && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft({ name: account.name, email: account.email })
                }
              >
                Discard changes
              </Button>
            )}

            <p role="status" aria-live="polite" className="text-meta text-neutral-500">
              {mutation.isPending
                ? ''
                : dirty
                  ? 'Not saved yet'
                  : mutation.isSuccess
                    ? 'Saved'
                    : ''}
            </p>
          </div>
        </form>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Access, read-only                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What you are allowed to do, and where that is decided.
 *
 * Read-only, deliberately. Somebody being able to widen their own access from
 * their own settings page would make every role in the product advisory, so
 * this states the fact and points at the page that owns it.
 */
function YourAccess() {
  const claims = useAuthStore((s) => s.claims)
  if (!claims) return null

  return (
    <Panel label="Your access" className="mb-6">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          You are signed in as{' '}
          <span className="font-medium text-ink">{roleLabel(claims.role)}</span>.
        </p>
        <p className="mt-3 max-w-2xl text-meta text-neutral-600">
          What that lets you reach is set by whoever manages people in your
          organisation, and it is not something you can change here — a page
          where somebody could grant themselves more would make every role
          advisory. Ask an administrator if you need something you cannot get to.
        </p>
        <p className="mt-3 max-w-2xl text-meta text-neutral-500">
          Permissions are read when you sign in. If somebody has just changed
          yours, sign out and back in to pick it up.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Gaps                                                                       */
/* -------------------------------------------------------------------------- */

function Gaps() {
  return (
    <Panel label="Not built" className="mb-6">
      <PanelBody>
        <ul className="grid max-w-2xl gap-4">
          <li>
            <h3 className="text-meta font-medium text-ink">
              No notification preferences of your own
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              There is nothing here to choose how you are told about an alert,
              because there is nowhere to store the choice: a person in Detecto
              has a name, an email address and a role, and no channel
              preference, no consent record and no telephone number. It is the
              same gap the organisation's notification settings found from the
              other side. Which alerts reach you is set by your role and by your
              organisation's routing, not by you.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No second factor to enrol
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Multi-factor authentication does not exist in the sign-in flow
              yet, so there is nothing to set up here and no recovery codes to
              keep. It is marked as coming on the organisation's security page.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No list of where you are signed in
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Detecto keeps no record of live sessions, so there is nothing to
              show you and no way to end one from here — including after
              changing your password, which is exactly when you would want it.
            </p>
          </li>
        </ul>

        <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
          Closing your account is not here either. An account carries the record
          of everything you confirmed or dismissed, which is your organisation's
          audit trail rather than yours to remove — an administrator turns access
          off instead, and nothing you decided is erased.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Account">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your account…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your account" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds your details. You are
          still signed in and nothing has changed.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={onRetry}
          disabled={pending}
        >
          {pending ? 'Trying again…' : 'Try again'}
        </Button>
      </PanelBody>
    </Panel>
  )
}
