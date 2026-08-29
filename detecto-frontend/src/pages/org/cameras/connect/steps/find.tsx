import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { CameraFrame } from '@/components/camera/camera-frame'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import {
  discoverCameras,
  type CameraProblem,
  type DiscoveredCamera,
  type PairedBox,
} from '@/lib/cameras/api'
import type { Discovery } from '@/pages/org/cameras/connect'
import { StepActions, StepHeading } from '@/pages/org/cameras/connect/step-parts'

/** How long before a search stops being "a moment" and needs saying so. */
const SLOW_AFTER_MS = 4000

const PROBLEM_TEXT: Record<CameraProblem, { reason: string; fix: string }> = {
  needs_password: {
    reason: 'Asked for a password before it would share its picture.',
    fix: 'Set this camera’s password on your recorder so it can pass it on, then look again.',
  },
  unreachable: {
    reason: 'Listed by your recorder, but no picture came back from it.',
    fix: 'Usually the camera is switched off or unplugged. Check it, then look again.',
  },
}

export function StepFind({
  box,
  discovery,
  onDiscovery,
  onBack,
  onContinue,
}: {
  box: PairedBox
  discovery: Discovery | null
  onDiscovery: (discovery: Discovery | null) => void
  onBack: () => void
  onContinue: () => void
}) {
  const [running, setRunning] = useState(false)
  const [slow, setSlow] = useState(false)
  const startedRef = useRef(false)

  const run = useCallback(async () => {
    setRunning(true)
    setSlow(false)
    onDiscovery(null)

    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    const result = await discoverCameras(box.id)
    window.clearTimeout(slowTimer)

    setRunning(false)
    onDiscovery(
      result.ok
        ? { status: 'found', cameras: result.cameras }
        : { status: 'failed', code: result.code },
    )
  }, [box.id, onDiscovery])

  // Search once on arrival. Coming back from step 3 finds the result already
  // here and leaves the network alone.
  useEffect(() => {
    if (discovery || startedRef.current) return
    startedRef.current = true
    void run()
  }, [discovery, run])

  const ready = discovery?.status === 'found'
    ? discovery.cameras.filter((camera) => camera.problem === null)
    : []
  const problems = discovery?.status === 'found'
    ? discovery.cameras.filter((camera) => camera.problem !== null)
    : []

  const addManual = (address: string) => {
    const existing = discovery?.status === 'found' ? discovery.cameras : []
    const manual: DiscoveredCamera = {
      id: `manual-${existing.length + 1}-${address}`,
      channel: 'Added by hand',
      suggestedName: null,
      resolution: null,
      problem: null,
      source: 'manual',
      address,
    }
    onDiscovery({ status: 'found', cameras: [...existing, manual] })
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        onContinue()
      }}
      noValidate
      aria-busy={running}
    >
      <StepHeading title="Look for cameras">
        The box checks every camera and recorder it can reach on your network.
        Nothing is connected to Detecto yet — this is only a look around.
      </StepHeading>

      {running && <Searching slow={slow} />}

      {!running && discovery?.status === 'failed' && (
        <Failed code={discovery.code} onRetry={() => void run()} />
      )}

      {!running && discovery?.status === 'found' && (
        <>
          {ready.length === 0 && problems.length === 0 && (
            <NothingFound onRetry={() => void run()} />
          )}

          {ready.length > 0 && <FoundList cameras={ready} />}

          {problems.length > 0 && <ProblemList cameras={problems} onRetry={() => void run()} />}

          <ManualEntry
            onAdd={addManual}
            taken={discovery.cameras
              .map((camera) => camera.address)
              .filter((address): address is string => address !== null)}
          />
        </>
      )}

      <StepActions
        submitLabel={
          ready.length === 0
            ? 'Continue'
            : `Continue with ${ready.length} camera${ready.length === 1 ? '' : 's'}`
        }
        onBack={onBack}
        disabled={running || ready.length === 0}
        hint={
          !running && discovery?.status === 'found' && ready.length === 0
            ? 'There is nothing here to add yet.'
            : undefined
        }
      />
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Searching({ slow }: { slow: boolean }) {
  // The dot carries "still working". Under reduced motion it would be a
  // stationary dot saying nothing, so the sentence carries it alone instead.
  const reduced = useReducedMotion()

  return (
    <div className="rounded-md border border-neutral-200 bg-paper-sunken px-5 py-5">
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 text-body text-neutral-700"
      >
        {!reduced && (
          <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-ink" />
        )}
        Looking for cameras…
      </p>
      <p className="mt-2 max-w-prose text-meta text-neutral-500">
        {slow
          ? 'Still looking. Some recorders take a minute to answer, especially the first time.'
          : 'This usually takes a few seconds.'}
      </p>
    </div>
  )
}

function Failed({
  code,
  onRetry,
}: {
  code: 'box_offline' | 'unavailable'
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-signal-500/40 bg-signal-50 px-5 py-5"
    >
      <h3 className="text-body font-medium text-signal-900">
        {code === 'box_offline'
          ? 'The box stopped answering'
          : "Can't reach Detecto right now"}
      </h3>
      <p className="mt-2 max-w-prose text-meta text-signal-800">
        {code === 'box_offline'
          ? 'It paired a moment ago, so it is powered on, but it has gone quiet since. Check the network cable and that nothing has been unplugged, then look again.'
          : 'The box may well have found your cameras — we could not get the answer back. Nothing has been changed.'}
      </p>
      <Button type="button" variant="outline" className="mt-5" onClick={onRetry}>
        Look again
      </Button>
    </div>
  )
}

const NOTHING_REASONS = [
  'The recorder is on a different network from the box.',
  'The recorder or cameras are switched off, or still starting up.',
  'The recorder is set to keep its cameras to itself, and needs to be allowed to share them.',
]

function NothingFound({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-paper-sunken px-5 py-5">
      <h3 className="text-body font-medium text-ink">No cameras found</h3>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        The box is paired and working — it just cannot see any cameras from where
        it is. That is nearly always one of these:
      </p>
      <ul className="mt-4 max-w-prose space-y-2">
        {NOTHING_REASONS.map((reason) => (
          <li key={reason} className="flex gap-3 text-meta text-neutral-600">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="mt-5" onClick={onRetry}>
        Look again
      </Button>
      <p className="mt-4 max-w-prose text-meta text-neutral-500">
        If you know a camera's address, you can add it by hand below instead.
      </p>
    </div>
  )
}

function FoundList({ cameras }: { cameras: DiscoveredCamera[] }) {
  return (
    <section aria-labelledby="found-heading">
      <h3 id="found-heading" className="label-micro text-neutral-500">
        Found {cameras.length} camera{cameras.length === 1 ? '' : 's'}
      </h3>
      <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {cameras.map((camera) => (
          <li key={camera.id} className="flex items-start gap-4 py-4">
            <CameraFrame caption={camera.source === 'manual' ? 'By hand' : camera.channel} />
            <div className="min-w-0 pt-0.5">
              <p className="text-body text-ink">
                {camera.suggestedName ?? camera.channel}
              </p>
              <p className="mt-1 font-mono text-data text-neutral-500">
                {camera.source === 'manual'
                  ? camera.address
                  : (camera.resolution ?? 'Resolution unknown')}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-meta text-neutral-500">
        You choose which of these to add, and name them, on the next step.
      </p>
    </section>
  )
}

function ProblemList({
  cameras,
  onRetry,
}: {
  cameras: DiscoveredCamera[]
  onRetry: () => void
}) {
  return (
    <section aria-labelledby="problem-heading" className="mt-8">
      <h3 id="problem-heading" className="label-micro text-signal-700">
        Couldn't get a picture from {cameras.length}
      </h3>
      <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {cameras.map((camera) => (
          <li key={camera.id} className="flex items-start gap-4 py-4">
            <CameraFrame caption={camera.channel} muted />
            <div className="min-w-0 pt-0.5">
              <p className="text-body text-neutral-700">
                {camera.suggestedName ?? camera.channel}
              </p>
              <p className="mt-1 text-meta text-signal-700">
                {camera.problem && PROBLEM_TEXT[camera.problem].reason}
              </p>
              <p className="mt-1 text-meta text-neutral-500">
                {camera.problem && PROBLEM_TEXT[camera.problem].fix}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-prose text-meta text-neutral-500">
        These are left out for now — connecting one would give Detecto nothing to
        look at. Fix them and look again, or carry on and add them later.
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Look again
      </Button>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Manual entry — so "nothing found" is never the end of the road             */
/* -------------------------------------------------------------------------- */

function ManualEntry({
  onAdd,
  taken,
}: {
  onAdd: (address: string) => void
  /** Addresses already on the list, so the same feed is not added twice. */
  taken: string[]
}) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string>()

  if (!open) {
    return (
      <div className="mt-8 border-t border-neutral-200 pt-5">
        <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)}>
          Add a camera by hand
        </Button>
      </div>
    )
  }

  const submit = () => {
    const value = address.trim()
    if (!value) {
      setError('Enter the address the camera uses on your network.')
      return
    }
    if (taken.includes(value)) {
      setError('That camera is already on the list.')
      return
    }
    onAdd(value)
    setAddress('')
    setError(undefined)
    setOpen(false)
  }

  return (
    <div className="mt-8 rounded-md border border-neutral-200 bg-paper-sunken px-5 py-5">
      <h3 className="text-body font-medium text-ink">Add a camera by hand</h3>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        If the box could not find a camera you know is there, you can point it
        straight at one. Detecto will keep trying to reach it in the background.
      </p>

      <Field
        label="Camera address"
        error={error}
        hint="Your installer or the camera's own manual will have it — usually something like 192.168.1.64."
        className="mt-5 max-w-sm"
      >
        {(props) => (
          <Input
            {...props}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setError(undefined)
            }}
            onKeyDown={(event) => {
              // The wizard's own submit lives on the surrounding form; this
              // field must not trigger it.
              if (event.key !== 'Enter') return
              event.preventDefault()
              submit()
            }}
            placeholder="192.168.1.64"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-data"
          />
        )}
      </Field>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={submit}>
          Add to the list
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            setAddress('')
            setError(undefined)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
