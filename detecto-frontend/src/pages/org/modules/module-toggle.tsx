import { useId } from 'react'

import { Label } from '@/components/ui/label'
import { StatusWord } from '@/components/ui/status-word'
import { Switch } from '@/components/ui/switch'
import type { DetectionModule } from '@/lib/modules/api'
import { useSetModule } from '@/lib/modules/queries'

function failureMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'unavailable'
  switch (code) {
    case 'not_live':
      return "This module isn't available yet, so it can't be switched on."
    case 'forbidden':
      return "Detecto refused the change: this account can't manage modules."
    default:
      return "That didn't save. The switch is back where it was — try again."
  }
}

/** `0.04` → `~4%`. Read from the module record, never worked out per render. */
function ratePercent(rate: number) {
  return `~${Math.round(rate * 100)}%`
}

/**
 * One module against one camera.
 *
 * A `coming_soon` module is shown, switched off, and cannot be moved. It is not
 * hidden — a roadmap a customer can see is worth more than a shorter list — and
 * it is not styled to look broken either. It says what it is.
 */
export function ModuleToggle({
  module,
  cameraId,
  enabled,
  canManage,
}: {
  module: DetectionModule
  cameraId: string
  enabled: boolean
  canManage: boolean
}) {
  const id = useId()
  const mutation = useSetModule(cameraId, module.id)

  const live = module.status === 'live'
  const locked = !live || !canManage

  return (
    <li className="flex items-start gap-4">
      <Switch
        id={id}
        checked={enabled}
        disabled={locked || mutation.isPending}
        onChange={(event) => mutation.mutate(event.target.checked)}
        className="mt-1"
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Label htmlFor={id} className="text-body text-ink">
            {module.name}
          </Label>
          {!live && (
            <StatusWord tone="neutral" className="text-meta">
              Coming soon
            </StatusWord>
          )}
        </div>

        <p className="mt-1 max-w-prose text-meta text-neutral-600">
          {module.description}
        </p>

        {live && module.falsePositiveRate !== null && (
          <p className="mt-1.5 text-meta text-neutral-500">
            <span className="font-mono text-data">
              {ratePercent(module.falsePositiveRate)}
            </span>{' '}
            false positive rate — flags a person will look at and wave off.
          </p>
        )}

        {live && module.resourceNote && (
          <p className="mt-1 max-w-prose text-meta text-neutral-500">
            {module.resourceNote}
          </p>
        )}

        {!live && (
          <p className="mt-1.5 text-meta text-neutral-500">
            Not built yet. It will appear here, switched off, when it ships —
            nothing turns itself on.
          </p>
        )}

        {mutation.isError && (
          <p role="alert" className="mt-2 text-meta text-signal-700">
            {failureMessage(mutation.error)}
          </p>
        )}
      </div>
    </li>
  )
}
