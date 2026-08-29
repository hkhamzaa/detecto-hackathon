import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { DetectionModule } from '@/lib/modules/api'
import { useSetZoneModule } from '@/lib/modules/queries'
import { cn } from '@/lib/utils'

/**
 * The zone-wide change, behind a confirm step.
 *
 * Forty cameras changing at once is not the same weight of action as one, so it
 * does not happen on a single click. This is deliberately the *light* version
 * of that idea: a sentence saying exactly what is about to happen and a button
 * to agree. Press-and-hold stays where it belongs, on the one decision in the
 * product that puts a person's name against a threat.
 */
export function ZoneBulk({
  id,
  zone,
  cameraCount,
  modules,
  onClose,
}: {
  id: string
  zone: string
  cameraCount: number
  /** Live modules only — nothing else can be switched on, in bulk or at all. */
  modules: DetectionModule[]
  onClose: () => void
}) {
  const selectId = useId()
  const mutation = useSetZoneModule(zone)

  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '')
  const [enabled, setEnabled] = useState(true)
  const [confirming, setConfirming] = useState(false)

  const module = modules.find((item) => item.id === moduleId)
  const cameras = `${cameraCount} ${cameraCount === 1 ? 'camera' : 'cameras'}`

  if (mutation.isSuccess) {
    const { changed, unchanged } = mutation.data
    return (
      <div id={id} className="border-b border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
        <p role="status" className="max-w-prose text-body text-ink">
          {module?.name} {enabled ? 'turned on' : 'turned off'} for{' '}
          {changed === 1 ? '1 camera' : `${changed} cameras`} in {zone}.
          {unchanged > 0 &&
            ` ${unchanged === 1 ? 'One was' : `${unchanged} were`} already set that way.`}
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (confirming) {
    return (
      <div id={id} className="border-b border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
        <h3 className="text-body font-medium text-ink">
          {enabled ? 'Turn this on' : 'Turn this off'} for every camera in {zone}?
        </h3>

        <p className="mt-2 max-w-prose text-meta text-neutral-600">
          {enabled ? (
            <>
              {module?.name} will run on all {cameras} in {zone}. Any that
              already have it stay exactly as they are.
            </>
          ) : (
            <>
              {module?.name} will stop running on all {cameras} in {zone}. Those
              cameras will not be watched for this until it is turned back on,
              and nothing will be flagged from them in the meantime.
            </>
          )}
        </p>

        {mutation.isError && (
          <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
            Nothing was changed — the request didn't reach Detecto. Every camera
            in {zone} is exactly as it was. Try again.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => mutation.mutate({ moduleId, enabled })}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? 'Applying…'
              : enabled
                ? `Turn on for ${cameras}`
                : `Turn off for ${cameras}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={mutation.isPending}
          >
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="border-b border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
      <h3 className="text-body font-medium text-ink">
        Apply to all {cameras} in {zone}
      </h3>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        Sets one module the same way across the whole zone, so a site with forty
        cameras is not configured one at a time.
      </p>

      <div className="mt-5 grid gap-5 sm:max-w-lg sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={selectId}>Module</Label>
          <NativeSelect
            id={selectId}
            value={moduleId}
            onChange={(event) => setModuleId(event.target.value)}
          >
            {modules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-meta font-medium text-ink">Set it to</legend>
          <div className="flex gap-2">
            {[
              { value: true, label: 'On' },
              { value: false, label: 'Off' },
            ].map((option) => (
              <label key={option.label} className="cursor-pointer">
                <input
                  type="radio"
                  name={`${id}-state`}
                  checked={enabled === option.value}
                  onChange={() => setEnabled(option.value)}
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
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={() => setConfirming(true)} disabled={!module}>
          Review the change
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
