import { useId, useState } from 'react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { Switch } from '@/components/ui/switch'
import { can } from '@/lib/auth/claims'
import { MIN_PASSWORD } from '@/lib/forms'
import { IDLE_TIMEOUTS, type IdleTimeout, type OrgSecurity } from '@/lib/org/api'
import { useOrgSettings, useSaveOrgSecurity } from '@/lib/org/queries'
import { cn } from '@/lib/utils'
import { BackToSettings } from '@/pages/org/settings/profile'
import { useAuthStore } from '@/store/auth-store'

/**
 * How sessions behave, what the password rule is, and what is not built.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE IDLE TIMEOUT IS A DECISION, NOT AN ENFORCEMENT
 *
 * This page stores how long an organisation wants an idle session to last.
 * Nothing acts on it today, and the banner says so above the control rather
 * than in a footnote underneath.
 *
 * The reason is worth being precise about, because a browser-side timer would
 * have been easy and would have been worse than nothing: signing somebody out
 * of this tab does not end their session. The access token stays valid on the
 * server for its full lifetime, so anybody holding it — a copied token, another
 * tab, a script — carries on working while the screen claims the session
 * closed. That is a control that looks like security and is not one, which is
 * the specific thing this product refuses to ship.
 *
 * What makes this setting real is the backend reading it when it issues a token
 * and refusing to refresh one that has gone idle. Until then the honest thing
 * is to record the decision and be plain that it is waiting on the other half.
 *
 * MFA IS SHOWN, DISABLED, AND WRITES NOWHERE
 *
 * Rendered the way a `coming_soon` detection module is rendered — in full, with
 * its real description, switched off, marked coming soon, and not styled to
 * look broken. Enterprise and government buyers ask for it, so hiding it would
 * misrepresent the roadmap; wiring it would mean storing a flag that no part of
 * the auth system consults. There is deliberately no `requireMfa` field in
 * `OrgSecurity` at all — see the note there.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrgSecurityPage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'org:settings')
  const settings = useOrgSettings()

  return (
    <>
      <BackToSettings />

      <PageHeader
        eyebrow="Organisation · Settings"
        title="Security"
        lead="How long a session lasts, what the password rule is, and what Detecto does not yet enforce."
      />

      {settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <Unavailable
          onRetry={() => void settings.refetch()}
          pending={settings.isFetching}
        />
      ) : (
        <>
          <IdleTimeoutSection
            security={settings.data.security}
            canManage={canManage}
          />
          <PasswordPolicy />
          <MfaSeam />
          <Gaps />
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Idle timeout                                                               */
/* -------------------------------------------------------------------------- */

function IdleTimeoutSection({
  security,
  canManage,
}: {
  security: OrgSecurity
  canManage: boolean
}) {
  const groupName = useId()
  const mutation = useSaveOrgSecurity()

  const [chosen, setChosen] = useState<IdleTimeout>(security.idleTimeoutMinutes)

  // Re-seeded during render when the stored value changes underneath us, the
  // same way the profile form and the tenant support note do it.
  const [seeded, setSeeded] = useState(security.idleTimeoutMinutes)
  if (seeded !== security.idleTimeoutMinutes) {
    setSeeded(security.idleTimeoutMinutes)
    setChosen(security.idleTimeoutMinutes)
  }

  const dirty = chosen !== security.idleTimeoutMinutes

  return (
    <Panel label="Session timeout" className="mb-6">
      <PanelBody className="border-b border-neutral-200 bg-paper-sunken py-4">
        <p className="max-w-2xl text-meta text-neutral-700">
          <strong className="font-medium text-ink">
            Detecto does not enforce this yet.
          </strong>{' '}
          A session currently ends when its access token expires, on a lifetime
          the backend decides — nothing reads the setting below, and nothing in
          the browser tracks whether you have gone idle. What is recorded here is
          the decision your organisation has made, and it will be honoured when
          sessions are issued against it.
        </p>
      </PanelBody>

      <PanelBody>
        <fieldset disabled={!canManage || mutation.isPending}>
          <legend className="text-meta font-medium text-ink">
            Sign somebody out after they have been idle for
          </legend>
          <p className="mt-1 max-w-prose text-meta text-neutral-600">
            Shorter is safer on a shared machine in a control room. Longer is
            kinder to somebody watching a quiet site for a whole shift.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {IDLE_TIMEOUTS.map((minutes) => (
              <label key={minutes} className="cursor-pointer">
                <input
                  type="radio"
                  name={groupName}
                  checked={chosen === minutes}
                  onChange={() => setChosen(minutes)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'block rounded-md border border-neutral-300 bg-paper-raised px-4 py-2 text-meta text-neutral-700',
                    'transition-colors duration-150 hover:border-neutral-400',
                    'peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                    'peer-disabled:opacity-50',
                  )}
                >
                  {minutes} minutes
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mutation.isError && (
          <p role="alert" className="mt-5 max-w-prose text-meta text-signal-700">
            Nothing was saved — the change didn't reach Detecto. The timeout is
            still {security.idleTimeoutMinutes} minutes. Try again.
          </p>
        )}

        {canManage && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!dirty || mutation.isPending}
              onClick={() => mutation.mutate({ idleTimeoutMinutes: chosen })}
            >
              {mutation.isPending ? 'Saving…' : 'Save timeout'}
            </Button>

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
        )}

        {!canManage && (
          <p className="mt-5 max-w-2xl text-meta text-neutral-500">
            You don't have permission to change this. An administrator in your
            organisation can.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Password policy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The one rule, and the honest list of what is not a rule.
 *
 * There is no policy record anywhere in the claims system or the auth
 * transport. `MIN_PASSWORD` in `lib/forms.ts` is the entire policy — one
 * number, checked in the browser at signup and when somebody changes their own
 * password. Rendering a set of policy toggles here would be inventing a data
 * model on screen, which is the same refusal made about coupons, staged rollout
 * and per-person notification channels.
 */
function PasswordPolicy() {
  return (
    <Panel label="Password policy" className="mb-6">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          Detecto has one password rule: at least{' '}
          <span className="font-mono text-data text-ink">{MIN_PASSWORD}</span>{' '}
          characters. It is the same rule at signup and when somebody changes
          their own password.
        </p>

        <h3 className="label-micro mt-7 text-neutral-500">
          Not enforced, and not configurable
        </h3>
        <ul className="mt-3 grid max-w-2xl gap-2.5">
          {[
            'No complexity requirement — no forced mixture of cases, digits or symbols.',
            'No expiry or rotation. Nobody is asked to change a working password on a schedule.',
            'No reuse history, so an old password can be set again.',
            'No check against known breached passwords.',
          ].map((line) => (
            <li key={line} className="flex gap-3 text-meta text-neutral-600">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-600">
          None of those are switches somebody turned off — there is no password
          policy record in Detecto for them to be stored in. This page reports
          the rule that exists rather than offering options with nothing behind
          them. Length is checked in the browser and again by the endpoint that
          sets the password, so the check is not only a courtesy.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* MFA seam                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Present, switched off, and honest about it.
 *
 * The same treatment a `coming_soon` detection module gets on the org modules
 * page: shown in full with its real description, disabled, marked coming soon,
 * and explicitly not styled as broken. It writes nowhere — there is no
 * `requireMfa` field to write to, deliberately.
 */
function MfaSeam() {
  const id = useId()

  return (
    <Panel label="Multi-factor authentication" className="mb-6">
      <PanelBody>
        <div className="flex items-start gap-4">
          <Switch id={id} checked={false} disabled className="mt-1" />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label htmlFor={id} className="text-body text-ink">
                Require a second factor for everyone in this organisation
              </label>
              <StatusWord tone="neutral" className="text-meta">
                Coming soon
              </StatusWord>
            </div>

            <p className="mt-1 max-w-prose text-meta text-neutral-600">
              Everybody signing in would have to confirm with a second factor as
              well as a password — the thing most enterprise and government
              buyers ask for before anything else.
            </p>

            <p className="mt-2 max-w-prose text-meta text-neutral-500">
              Not built. Detecto has no second factor to require: the sign-in
              flow has the seam for a verification step and nothing behind it,
              and there is no enrolment, no recovery codes and no way for
              somebody locked out to get back in. Turning this on before those
              exist would lock an organisation out of its own cameras, so the
              switch stays off and stores nothing until it can do what it says.
            </p>
          </div>
        </div>
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
              The timeout is stored, not applied
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Sessions end when the access token expires, on a lifetime the
              backend sets. Making this setting real means the backend reading it
              when it issues and refreshes a token. A timer in the browser would
              not do it: signing this tab out leaves the token valid on the
              server, which looks like a control and is not one.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No session list, and no way to sign other devices out
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              "Where am I signed in, and end that one" needs the backend to keep
              a record of live sessions. Nothing does, so there is nothing to
              list and nothing to revoke — including after a password change,
              which is exactly when somebody would want it.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No single sign-on
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              SAML or OIDC against an organisation's own identity provider is
              the other thing enterprise buyers ask for, and it would replace
              most of this page rather than sit beside it. Nothing here assumes
              passwords are permanent.
            </p>
          </li>
        </ul>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Security">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your security settings…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your security settings" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds them. Nothing has
          changed, and nobody has been signed out — this is the settings page,
          and it has not written anything.
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
