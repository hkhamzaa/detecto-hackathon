import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { CameraFrame } from '@/components/camera/camera-frame'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addCameras, type DiscoveredCamera, type NewCamera } from '@/lib/cameras/api'
import { CAMERAS_KEY, useCameras } from '@/lib/cameras/queries'
import { focusFirstInvalid, issueSummary, type Errors } from '@/lib/forms'
import type { CameraRow } from '@/pages/org/cameras/connect'
import { StepActions, StepHeading } from '@/pages/org/cameras/connect/step-parts'

const NAME_MAX = 48
const ZONE_MAX = 40

/**
 * Everything found starts selected — unticking three is less work than ticking
 * three, and adding a camera is reversible. A device's own name is kept when it
 * reported one; a channel number is not, because it means nothing in an alert
 * at three in the morning.
 */
function defaultRow(camera: DiscoveredCamera): CameraRow {
  return { selected: true, name: camera.suggestedName ?? '', zone: '' }
}

export function StepName({
  cameras,
  rows: stored,
  onRows,
  onBack,
  onAdded,
}: {
  cameras: DiscoveredCamera[]
  rows: Record<string, CameraRow>
  onRows: (rows: Record<string, CameraRow>) => void
  onBack: () => void
  onAdded: (count: number) => void
}) {
  const queryClient = useQueryClient()
  const { data: existing } = useCameras()

  // Derived rather than synced: a camera added by hand on the previous step
  // appears here with its defaults, without an effect chasing the prop.
  const rows = useMemo(() => {
    const merged: Record<string, CameraRow> = {}
    for (const camera of cameras) {
      merged[camera.id] = stored[camera.id] ?? defaultRow(camera)
    }
    return merged
  }, [cameras, stored])

  const [errors, setErrors] = useState<Errors<string>>({})
  const [bulkZone, setBulkZone] = useState('')

  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const bulkZoneId = useId()
  const zoneListId = useId()

  const mutation = useMutation({
    mutationFn: async (payload: NewCamera[]) => {
      const result = await addCameras(payload)
      if (!result.ok) throw new Error(result.code)
      return result.cameras
    },
    onSuccess: (added) => {
      void queryClient.invalidateQueries({ queryKey: CAMERAS_KEY })
      onAdded(added.length)
    },
    onError: () => {
      requestAnimationFrame(() => alertRef.current?.focus())
    },
  })

  // Writes the merged rows back, so a default that has never been edited is
  // persisted alongside the change rather than being recomputed forever.
  const patch = (id: string, changes: Partial<CameraRow>) => {
    onRows({ ...rows, [id]: { ...rows[id], ...changes } })
  }

  const selected = cameras.filter((camera) => rows[camera.id].selected)

  /** Zones already in use, plus any typed in on this screen. */
  const knownZones = Array.from(
    new Set(
      [
        ...(existing ?? []).map((camera) => camera.zone),
        ...Object.values(rows).map((row) => row.zone),
      ]
        .map((zone) => zone.trim())
        .filter(Boolean),
    ),
  ).sort()

  const applyZoneToAll = () => {
    const zone = bulkZone.trim()
    if (!zone) return
    onRows(
      Object.fromEntries(
        Object.entries(rows).map(([id, row]) => [
          id,
          row.selected ? { ...row, zone } : row,
        ]),
      ),
    )
    setErrors({})
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return

    const next: Errors<string> = {}
    if (selected.length === 0) {
      next.selection = 'Pick at least one camera to add, or go back and look again.'
    }
    for (const camera of selected) {
      const row = rows[camera.id]
      if (!row.name.trim()) {
        next[`${camera.id}-name`] = "Give this camera a name you'll recognise."
      }
      if (!row.zone.trim()) {
        next[`${camera.id}-zone`] = 'Say where this camera is.'
      }
    }

    setErrors(next)
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }

    mutation.mutate(
      selected.map((camera) => ({
        name: rows[camera.id].name.trim(),
        zone: rows[camera.id].zone.trim(),
        discoveredId: camera.source === 'box' ? camera.id : null,
        address: camera.source === 'manual' ? camera.address : null,
      })),
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={mutation.isPending}>
      <StepHeading title="Name what you're adding">
        {cameras.length === 1
          ? 'One camera is ready to connect.'
          : `${cameras.length} cameras are ready to connect.`}{' '}
        Add the ones you want. A name and a zone are what an alert will show, so
        write them the way you would say them out loud.
      </StepHeading>

      {mutation.isError && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="mb-7 rounded-md border border-signal-500/40 bg-signal-50 px-4 py-3 text-meta text-signal-700 outline-none"
        >
          Nothing was added — Detecto couldn't be reached. Your names and zones
          are still here, so you can try again without retyping them.
        </div>
      )}

      {errors.selection && (
        <p role="alert" className="mb-7 text-meta text-signal-700">
          {errors.selection}
        </p>
      )}

      {/* One zone covers most of a job: a recorder's channels are usually all
          in the same building, if not the same corridor. */}
      <div className="rounded-md border border-neutral-200 bg-paper-sunken px-4 py-4 sm:px-5">
        <Label htmlFor={bulkZoneId}>Same zone for all of them</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            id={bulkZoneId}
            list={zoneListId}
            value={bulkZone}
            onChange={(event) => setBulkZone(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              applyZoneToAll()
            }}
            placeholder="West corridor"
            autoComplete="off"
            maxLength={ZONE_MAX}
            className="w-full sm:w-64"
          />
          <Button type="button" variant="outline" onClick={applyZoneToAll}>
            Apply to all
          </Button>
        </div>
        <p className="mt-2 text-meta text-neutral-500">
          Fills in the zone on every selected camera. You can change any of them
          afterwards.
        </p>
      </div>

      <datalist id={zoneListId}>
        {knownZones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <ul className="mt-2 divide-y divide-neutral-200">
        {cameras.map((camera) => {
          const row = rows[camera.id]
          const title = camera.suggestedName ?? camera.channel
          return (
            <li key={camera.id} className="py-6">
              <div className="flex items-start justify-between gap-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={row.selected}
                    onChange={(event) => {
                      patch(camera.id, { selected: event.target.checked })
                      setErrors({})
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink">
                      {title}
                    </span>
                    <span className="block text-meta text-neutral-500">
                      {camera.source === 'manual'
                        ? `Added by hand · ${camera.address}`
                        : [camera.channel, camera.resolution]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </span>
                </label>

                <CameraFrame
                  className="hidden sm:block"
                  caption={camera.source === 'manual' ? 'By hand' : camera.channel}
                />
              </div>

              {row.selected && (
                <div className="mt-5 grid gap-5 sm:grid-cols-2 sm:pl-8">
                  <Field
                    label="Name"
                    error={errors[`${camera.id}-name`]}
                    hint="What you want to read in an alert."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={row.name}
                        onChange={(event) => {
                          patch(camera.id, { name: event.target.value })
                          setErrors((p) => ({ ...p, [`${camera.id}-name`]: undefined }))
                        }}
                        placeholder="Side door"
                        autoComplete="off"
                        maxLength={NAME_MAX}
                      />
                    )}
                  </Field>

                  <Field
                    label="Zone"
                    error={errors[`${camera.id}-zone`]}
                    hint="The area it covers, in your own words."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        list={zoneListId}
                        value={row.zone}
                        onChange={(event) => {
                          patch(camera.id, { zone: event.target.value })
                          setErrors((p) => ({ ...p, [`${camera.id}-zone`]: undefined }))
                        }}
                        placeholder="West corridor"
                        autoComplete="off"
                        maxLength={ZONE_MAX}
                      />
                    )}
                  </Field>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Review
        cameras={selected.map((camera) => ({
          id: camera.id,
          name: rows[camera.id].name.trim(),
          zone: rows[camera.id].zone.trim(),
        }))}
      />

      <p aria-live="polite" className="sr-only">
        {issueSummary(errors)}
      </p>

      <StepActions
        submitLabel={
          mutation.isPending
            ? 'Adding…'
            : selected.length === 1
              ? 'Add 1 camera'
              : `Add ${selected.length} cameras`
        }
        onBack={onBack}
        pending={mutation.isPending}
      />
    </form>
  )
}

/* -------------------------------------------------------------------------- */

function Review({
  cameras,
}: {
  cameras: { id: string; name: string; zone: string }[]
}) {
  return (
    <section aria-labelledby="review-heading" className="border-t border-neutral-200 pt-6">
      <h3 id="review-heading" className="label-micro text-neutral-500">
        Ready to add
      </h3>

      {cameras.length === 0 ? (
        <p className="mt-3 text-meta text-neutral-500">
          Nothing selected. Tick at least one camera above.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {cameras.map((camera) => (
            <li key={camera.id} className="text-meta text-neutral-700">
              <span className="text-ink">{camera.name || 'Unnamed camera'}</span>
              <span className="text-neutral-400"> — </span>
              <span>{camera.zone || 'no zone yet'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

