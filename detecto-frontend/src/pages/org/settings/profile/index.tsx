import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Panel, PanelBody } from '@/components/ui/panel'
import { can } from '@/lib/auth/claims'
import { countIssues, focusFirstInvalid, issueSummary, type Errors } from '@/lib/forms'
import { useOrgSettings, useSaveOrgProfile } from '@/lib/org/queries'
import {
  normaliseProfile,
  validateOrgProfile,
  type OrgProfile,
  type OrgProfileField,
} from '@/lib/org/profile'
import { ORG_TYPES, type OrgType } from '@/lib/plans'
import { useAuthStore } from '@/store/auth-store'

/**
 * What the organisation is called, and who to reach about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PLAIN SAVE, ON PURPOSE
 *
 * Nothing on this page is behind a confirm step, and that is a decision rather
 * than an omission. The product spends confirm steps on changes that take
 * something away from somebody who is not in the room — deleting a role,
 * suspending an account, narrowing who hears about a weapon, merging two zones.
 * Renaming an organisation changes a label. It is visible immediately,
 * reversible by typing the old name back, and it costs nobody any access.
 *
 * Putting a confirm on it would not make it safer; it would make the confirms
 * that matter cheaper, because a step somebody clicks through ten times a week
 * stops being read the eleventh.
 *
 * PERMISSION
 *
 * `org:settings`, the same grant that gates the notification settings beside
 * it. The route is already gated on it; the check is repeated against the form
 * so the page stays correct if that gate is ever widened.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrgProfilePage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'org:settings')
  const settings = useOrgSettings()

  return (
    <>
      <BackToSettings />

      <PageHeader
        eyebrow="Organisation · Settings"
        title="Profile"
        lead="What your organisation is called, what kind of site it is, and who Detecto should reach about the account itself."
      />

      {settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <Unavailable
          onRetry={() => void settings.refetch()}
          pending={settings.isFetching}
        />
      ) : (
        <ProfileForm profile={settings.data.profile} canManage={canManage} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The form                                                                   */
/* -------------------------------------------------------------------------- */

function ProfileForm({
  profile,
  canManage,
}: {
  profile: OrgProfile
  canManage: boolean
}) {
  const mutation = useSaveOrgProfile()

  const [draft, setDraft] = useState<OrgProfile>(profile)
  const [errors, setErrors] = useState<Errors<OrgProfileField>>({})

  /*
   * Re-seed when the stored profile changes underneath us — this page's own
   * refetch landing after a save, or another administrator having edited it.
   *
   * Adjusted during render rather than in an effect, the same way the tenant
   * support note does it: React restarts the render before anything commits, so
   * the field never paints the stale value and then corrects it.
   */
  const [seeded, setSeeded] = useState(profile)
  if (seeded !== profile) {
    setSeeded(profile)
    setDraft(profile)
  }

  const dirty =
    draft.name !== profile.name ||
    draft.type !== profile.type ||
    draft.contactEmail !== profile.contactEmail ||
    draft.contactPhone !== profile.contactPhone

  const patch = (changes: Partial<OrgProfile>) => {
    setDraft((current) => ({ ...current, ...changes }))
  }

  const clear = (field: OrgProfileField) =>
    setErrors((current) => ({ ...current, [field]: undefined }))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return

    const next = validateOrgProfile(draft)
    setErrors(next)

    if (countIssues(next) > 0) {
      requestAnimationFrame(() => focusFirstInvalid(document.querySelector('form')))
      return
    }

    mutation.mutate(normaliseProfile(draft))
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={mutation.isPending}>
      {!canManage && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-neutral-200 bg-paper-sunken px-4 py-3 text-meta text-neutral-600"
        >
          You don't have permission to change your organisation's settings.
          Everything below is how it is set up today. An administrator can
          change it.
        </p>
      )}

      <Panel label="Identity" className="mb-6">
        <PanelBody>
          <fieldset disabled={!canManage || mutation.isPending} className="grid gap-6">
            <legend className="sr-only">Organisation identity</legend>

            <Field
              label="Organisation name"
              error={errors.name}
              hint="What your organisation operates under. It appears at the top of every page."
              className="sm:max-w-md"
            >
              {(props) => (
                <Input
                  {...props}
                  value={draft.name}
                  onChange={(event) => {
                    patch({ name: event.target.value })
                    clear('name')
                  }}
                  autoComplete="organization"
                  maxLength={80}
                />
              )}
            </Field>

            <Field
              label="What kind of site is it?"
              error={errors.type}
              hint="Used to size a deployment. Pick the closest match — you can change it later."
              className="sm:max-w-xs"
            >
              {(props) => (
                <NativeSelect
                  {...props}
                  value={draft.type}
                  onChange={(event) => {
                    patch({ type: event.target.value as OrgType })
                    clear('type')
                  }}
                >
                  <option value="" disabled>
                    Select one
                  </option>
                  {ORG_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </fieldset>
        </PanelBody>
      </Panel>

      <Panel label="Contact" className="mb-6">
        <PanelBody className="border-b border-neutral-200 py-4">
          <p className="max-w-2xl text-meta text-neutral-600">
            Who Detecto reaches about the account itself — a security question, a
            problem with a box, anything that needs a person on your side.
            Invoices are sent somewhere separate: that is the billing contact on
            your billing page, and it is not changed here.
          </p>
        </PanelBody>

        <PanelBody>
          <fieldset
            disabled={!canManage || mutation.isPending}
            className="grid gap-6 sm:max-w-md"
          >
            <legend className="sr-only">Organisation contact</legend>

            <Field label="Contact email" error={errors.contactEmail}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  inputMode="email"
                  value={draft.contactEmail}
                  onChange={(event) => {
                    patch({ contactEmail: event.target.value })
                    clear('contactEmail')
                  }}
                  autoComplete="email"
                  placeholder="security@company.com"
                />
              )}
            </Field>

            <Field
              label="Contact phone"
              error={errors.contactPhone}
              hint="For anything that should not wait for an email to be read."
            >
              {(props) => (
                <Input
                  {...props}
                  type="tel"
                  inputMode="tel"
                  value={draft.contactPhone}
                  onChange={(event) => {
                    patch({ contactPhone: event.target.value })
                    clear('contactPhone')
                  }}
                  autoComplete="tel"
                />
              )}
            </Field>
          </fieldset>

          <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
            Stored, not dialled. Detecto contacts the people in your
            organisation and nobody outside it — an emergency service is reached
            by a person who decided to reach one, never by this account having a
            number on it.
          </p>
        </PanelBody>
      </Panel>

      {mutation.isError && (
        <p role="alert" className="mb-6 max-w-2xl text-meta text-signal-700">
          {mutation.error instanceof Error && mutation.error.message === 'forbidden'
            ? "Detecto refused the change: this account can't change organisation settings."
            : "Nothing was saved — the change didn't reach Detecto. Everything you have entered is still here, and your organisation is exactly as it was."}
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {issueSummary(errors)}
      </p>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>

          {dirty && !mutation.isPending && (
            <Button type="button" variant="ghost" onClick={() => setDraft(profile)}>
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
      )}
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

export function BackToSettings() {
  return (
    <p className="mb-6">
      <Link
        to="/org/settings"
        className="inline-flex items-center gap-2 text-meta text-neutral-600 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Back to settings
      </Link>
    </p>
  )
}

function Loading() {
  return (
    <Panel label="Profile">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your organisation…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your organisation" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds your organisation's
          details. Nothing has changed — this is the settings page, and it has
          not written anything. Detection is unaffected.
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
