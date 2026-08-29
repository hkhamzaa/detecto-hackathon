import { useRef, useState, type FormEvent } from 'react'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { NumberStepper } from '@/components/ui/number-stepper'
import { StepActions, StepHeading } from '@/pages/signup/step-parts'
import { ORG_TYPES, type OrgType } from '@/lib/plans'
import { validateOrgIdentity, type OrgIdentityField } from '@/lib/org/profile'
import { focusFirstInvalid, issueSummary, type Errors } from '@/lib/forms'
import { CAMERA_BUCKETS, useSignupStore } from '@/store/signup-store'
import { cn } from '@/lib/utils'

export function StepDetails() {
  const accountType = useSignupStore((s) => s.accountType)
  return accountType === 'org' ? <OrgDetails /> : <HomeDetails />
}

/* -------------------------------------------------------------------------- */
/* Home — kept to two questions, one of them optional.                        */
/* -------------------------------------------------------------------------- */

function HomeDetails() {
  const home = useSignupStore((s) => s.home)
  const patchHome = useSignupStore((s) => s.patchHome)
  const goNext = useSignupStore((s) => s.goNext)
  const [errors, setErrors] = useState<Errors<'cameras'>>({})
  const formRef = useRef<HTMLFormElement>(null)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!home.cameras) {
      setErrors({ cameras: 'Pick a camera count so we can size your plan.' })
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    setErrors({})
    goNext()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <StepHeading title="How many cameras?">
        A rough number is enough — we use it to size your plan. You can add
        cameras later.
      </StepHeading>

      <div className="grid gap-8">
        <fieldset>
          <legend className="text-meta font-medium text-ink">Cameras</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {CAMERA_BUCKETS.map((bucket) => (
              <label key={bucket.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="cameras"
                  value={bucket.value}
                  checked={home.cameras === bucket.value}
                  aria-invalid={errors.cameras ? true : undefined}
                  aria-describedby={errors.cameras ? 'cameras-error' : undefined}
                  onChange={() => {
                    patchHome({ cameras: bucket.value })
                    setErrors({})
                  }}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'block rounded-md border bg-paper-raised px-4 py-2.5 text-meta text-neutral-700 transition-colors duration-150',
                    'hover:border-neutral-400',
                    'peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                    errors.cameras ? 'border-signal-500' : 'border-neutral-300',
                  )}
                >
                  {bucket.label}
                </span>
              </label>
            ))}
          </div>
          {errors.cameras && (
            <p id="cameras-error" className="mt-3 text-meta text-signal-700">
              {errors.cameras}
            </p>
          )}
        </fieldset>

        <Field
          label="Name this location"
          optional
          hint="Something you'll recognize in an alert, like “Front porch”."
        >
          {(props) => (
            <Input
              {...props}
              value={home.label}
              onChange={(e) => patchHome({ label: e.target.value })}
              placeholder="Front porch"
              autoComplete="off"
              maxLength={40}
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

/* -------------------------------------------------------------------------- */
/* Organization                                                               */
/* -------------------------------------------------------------------------- */

function OrgDetails() {
  const org = useSignupStore((s) => s.org)
  const patchOrg = useSignupStore((s) => s.patchOrg)
  const goNext = useSignupStore((s) => s.goNext)
  const [errors, setErrors] = useState<Errors<OrgIdentityField>>({})
  const formRef = useRef<HTMLFormElement>(null)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    // The same rules the settings page applies to the same two fields. Asking
    // one question in two places is fine; answering it two different ways is
    // how they come to disagree about whether a name is required.
    const next = validateOrgIdentity({ name: org.name, type: org.type })

    setErrors(next)
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    goNext()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <StepHeading title="About your organization">
        Estimates are fine. We use them to size the deployment and set up roles.
      </StepHeading>

      <div className="grid gap-6">
        <Field label="Organization name" error={errors.name}>
          {(props) => (
            <Input
              {...props}
              value={org.name}
              onChange={(e) => {
                patchOrg({ name: e.target.value })
                setErrors((p) => ({ ...p, name: undefined }))
              }}
              autoComplete="organization"
            />
          )}
        </Field>

        <Field label="What kind of site is it?" error={errors.type}>
          {(props) => (
            <NativeSelect
              {...props}
              value={org.type}
              onChange={(e) => {
                patchOrg({ type: e.target.value as OrgType })
                setErrors((p) => ({ ...p, type: undefined }))
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

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Cameras, roughly" hint="Across every site.">
            {({ id, ...props }) => (
              <NumberStepper
                id={id}
                {...props}
                label="camera"
                value={org.cameras}
                onChange={(cameras) => patchOrg({ cameras })}
                max={500}
              />
            )}
          </Field>

          <Field
            label="People who need access"
            hint="Anyone who will sign in and confirm alerts."
          >
            {({ id, ...props }) => (
              <NumberStepper
                id={id}
                {...props}
                label="person"
                value={org.users}
                onChange={(users) => patchOrg({ users })}
                max={500}
              />
            )}
          </Field>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {issueSummary(errors)}
      </p>
      <StepActions submitLabel="Continue" />
    </form>
  )
}
