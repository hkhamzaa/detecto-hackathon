import { useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Panel, PanelBody } from '@/components/ui/panel'
import { useCameras } from '@/lib/cameras/queries'
import { focusFirstInvalid, issueSummary, type Errors } from '@/lib/forms'
import {
  notesFor,
  PERMISSION_GROUPS,
  summarisePermissions,
  summariseScope,
} from '@/lib/roles/permissions'
import { useDirectory, useSaveRole } from '@/lib/roles/queries'
import { cn } from '@/lib/utils'

const NAME_MAX = 40

/**
 * Build a role from a checklist.
 *
 * The same screen creates and edits, because they are the same decision — what
 * should somebody holding this be able to do — and splitting them would mean
 * two places to keep the permission list correct.
 */
export default function RoleBuilderPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const directory = useDirectory()
  const cameras = useCameras()
  const mutation = useSaveRole()

  const existing = id ? directory.data?.roles.find((role) => role.id === id) : undefined
  const editing = Boolean(id)

  const nameId = useId()
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [restricted, setRestricted] = useState(false)
  const [zones, setZones] = useState<string[]>([])
  const [errors, setErrors] = useState<Errors<string>>({})
  const [loaded, setLoaded] = useState(false)

  // Fill the form the first time the role arrives, then leave it alone — a
  // background refetch must not overwrite what somebody is halfway through
  // typing.
  if (existing && !loaded) {
    setName(existing.name)
    setPermissions(existing.permissions)
    setRestricted(existing.zones !== null)
    setZones(existing.zones ?? [])
    setLoaded(true)
  }

  /** Zones in use, plus any this role already names even if its cameras moved. */
  const knownZones = useMemo(() => {
    const fromCameras = (cameras.data ?? [])
      .map((camera) => camera.zone.trim())
      .filter(Boolean)
    return [...new Set([...fromCameras, ...zones])].sort()
  }, [cameras.data, zones])

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return

    const next: Errors<string> = {}
    if (!name.trim()) next.name = 'Give the role a name people will recognise.'
    if (permissions.length === 0) {
      next.permissions =
        'Pick at least one thing this role can do. A role with nothing selected is the same as no role at all.'
    }
    if (restricted && zones.length === 0) {
      next.zones = 'Pick at least one zone, or let the role reach every camera.'
    }

    setErrors(next)
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(document.querySelector('form')))
      return
    }

    mutation.mutate(
      {
        id,
        name: name.trim(),
        permissions,
        zones: restricted ? zones : null,
      },
      { onSuccess: () => navigate('/org/users') },
    )
  }

  const notes = notesFor(permissions)

  return (
    <>
      <p className="mb-6">
        <Link
          to="/org/users"
          className="inline-flex items-center gap-2 text-meta text-neutral-600 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Back to people and roles
        </Link>
      </p>

      <PageHeader
        eyebrow="Organisation · People"
        title={editing ? existing?.name ?? 'Edit role' : 'Create a role'}
        lead="A role is a set of things somebody can do, and the cameras they can do it on. Tick what this one allows — everything left unticked is something people holding it will not be able to reach."
      />

      {editing && directory.isPending ? (
        <Panel label="Role">
          <PanelBody>
            <p role="status" aria-live="polite" className="text-meta text-neutral-500">
              Loading this role…
            </p>
          </PanelBody>
        </Panel>
      ) : editing && !existing ? (
        <Panel label="No such role" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              Nothing in your organisation has that reference. It may have been
              deleted since this link was made.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to="/org/users">Back to people and roles</Link>
            </Button>
          </PanelBody>
        </Panel>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={mutation.isPending}>
          <Panel label="Name">
            <PanelBody>
              <Field
                label="Role name"
                error={errors.name}
                hint="What your team would call it — “Night duty”, “Reception”, “Site manager”."
                className="sm:max-w-sm"
              >
                {(props) => (
                  <Input
                    {...props}
                    id={nameId}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value)
                      setErrors((p) => ({ ...p, name: undefined }))
                    }}
                    maxLength={NAME_MAX}
                    autoComplete="off"
                    autoFocus={!editing}
                  />
                )}
              </Field>
            </PanelBody>
          </Panel>

          <Panel label="What it allows" className="mt-6">
            <PanelBody>
              {errors.permissions && (
                <p role="alert" className="mb-5 max-w-prose text-meta text-signal-700">
                  {errors.permissions}
                </p>
              )}

              <div className="grid gap-8">
                {PERMISSION_GROUPS.map((group) => (
                  <fieldset key={group.id}>
                    <legend className="label-micro text-neutral-500">
                      {group.label}
                    </legend>
                    <div className="mt-4 grid gap-4">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex cursor-pointer items-start gap-3"
                        >
                          <Checkbox
                            checked={permissions.includes(permission.key)}
                            aria-invalid={errors.permissions ? true : undefined}
                            onChange={() => {
                              setPermissions((current) =>
                                toggle(current, permission.key),
                              )
                              setErrors((p) => ({ ...p, permissions: undefined }))
                            }}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-meta font-medium text-ink">
                              {permission.label}
                            </span>
                            <span className="block max-w-prose text-meta text-neutral-600">
                              {permission.description}
                            </span>
                            {permission.note && (
                              <span className="mt-1 block max-w-prose text-meta text-neutral-500">
                                {permission.note}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </PanelBody>
          </Panel>

          <Panel label="Which cameras" className="mt-6">
            <PanelBody>
              <fieldset>
                <legend className="sr-only">Camera scope</legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: false, label: 'All cameras' },
                    { value: true, label: 'Certain zones only' },
                  ].map((option) => (
                    <label key={option.label} className="cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        checked={restricted === option.value}
                        onChange={() => {
                          setRestricted(option.value)
                          setErrors((p) => ({ ...p, zones: undefined }))
                        }}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          'block rounded-md border border-neutral-300 bg-paper-raised px-4 py-2 text-meta text-neutral-700',
                          'transition-colors duration-150 hover:border-neutral-400',
                          'peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper',
                          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                        )}
                      >
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {restricted && (
                <div className="mt-6">
                  {knownZones.length === 0 ? (
                    <p className="max-w-prose text-meta text-neutral-600">
                      No zones yet. Zones come from the cameras you connect —
                      give your cameras a zone in camera setup and they will
                      appear here.
                    </p>
                  ) : (
                    <>
                      <fieldset>
                        <legend className="label-micro text-neutral-500">
                          Zones this role can reach
                        </legend>
                        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                          {knownZones.map((zone) => (
                            <label
                              key={zone}
                              className="flex cursor-pointer items-center gap-3"
                            >
                              <Checkbox
                                checked={zones.includes(zone)}
                                aria-invalid={errors.zones ? true : undefined}
                                onChange={() => {
                                  setZones((current) => toggle(current, zone))
                                  setErrors((p) => ({ ...p, zones: undefined }))
                                }}
                              />
                              <span className="text-meta text-ink">{zone}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      {errors.zones && (
                        <p role="alert" className="mt-3 text-meta text-signal-700">
                          {errors.zones}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </PanelBody>
          </Panel>

          {/* The checklist above is the input; this is what it adds up to. It
              is the sentence that will be shown against this role everywhere
              else, so it is worth reading before saving. */}
          <Panel label="What you are about to grant" tone="confirm" className="mt-6">
            <PanelBody>
              <p className="max-w-prose text-body text-ink">
                {summarisePermissions(permissions)}
              </p>
              <p className="mt-2 max-w-prose text-meta text-neutral-600">
                {summariseScope(restricted ? zones : null)}
              </p>
              {notes.map((note) => (
                <p key={note} className="mt-3 flex max-w-prose gap-2.5 text-meta text-neutral-600">
                  <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 bg-neutral-400" />
                  <span>{note}</span>
                </p>
              ))}
            </PanelBody>
          </Panel>

          {mutation.isError && (
            <p role="alert" className="mt-6 max-w-prose text-meta text-signal-700">
              {mutation.error instanceof Error &&
              mutation.error.message === 'duplicate_name'
                ? `Your organisation already has a role called “${name.trim()}”. Pick another name.`
                : "Nothing was saved — the request didn't reach Detecto. Everything you have entered is still here."}
            </p>
          )}

          <p aria-live="polite" className="sr-only">
            {issueSummary(errors)}
          </p>

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-neutral-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Button asChild variant="ghost">
              <Link to="/org/users">Cancel</Link>
            </Button>
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : 'Create role'}
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
