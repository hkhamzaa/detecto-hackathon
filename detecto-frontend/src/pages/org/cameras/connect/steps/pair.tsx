import { useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { pairBox, type PairedBox, type PairResult } from '@/lib/cameras/api'
import {
  formatPairingCode,
  isCompletePairingCode,
  pairingCodeValue,
} from '@/lib/cameras/pairing'
import { StepActions, StepHeading } from '@/pages/org/cameras/connect/step-parts'

type Failure = Extract<PairResult, { ok: false }>['code']

function messageFor(code: Failure) {
  switch (code) {
    case 'invalid_code':
      return "No box is showing that code. Check the eight characters on the box's screen and try again."
    case 'expired_code':
      return 'That code has expired. The box shows a new one every ten minutes — read the current one off the screen.'
    case 'unavailable':
      return "Can't reach Detecto right now. Check your connection and try again."
  }
}

export function StepPair({
  box,
  onPaired,
}: {
  /** Set when someone has come back to this step from the next one. */
  box: PairedBox | null
  onPaired: (box: PairedBox) => void
}) {
  const [searchParams] = useSearchParams()

  /**
   * The QR code printed on the box points at this page with the code in the
   * URL, so scanning it with a phone's own camera app fills the field in.
   * Typing it stays the path for anyone at a desk.
   *
   * Read once, as the field's initial value: a URL that changed under someone
   * mid-flow should not overwrite what they have typed.
   */
  const scanned = searchParams.get('code')
  const [code, setCode] = useState(() =>
    scanned ? formatPairingCode(scanned) : '',
  )

  const [fieldError, setFieldError] = useState<string>()
  const [failure, setFailure] = useState<Failure | null>(null)
  const [pending, setPending] = useState(false)
  const [paired, setPaired] = useState<PairedBox | null>(box)

  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return

    if (!isCompletePairingCode(code)) {
      setFieldError("Enter all eight characters from the box's screen.")
      setFailure(null)
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLInputElement>('input')?.focus(),
      )
      return
    }

    setFieldError(undefined)
    setFailure(null)
    setPending(true)
    const result = await pairBox(pairingCodeValue(code))
    setPending(false)

    if (result.ok) {
      setPaired(result.box)
      return
    }

    setFailure(result.code)
    requestAnimationFrame(() => alertRef.current?.focus())
  }

  if (paired) {
    return (
      <PairedWithBox
        box={paired}
        onContinue={() => onPaired(paired)}
        onChangeBox={() => {
          setPaired(null)
          setCode('')
        }}
      />
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-busy={pending}>
      <StepHeading title="Pair your Detecto Box">
        Your box is on your network and waiting to be claimed. Its screen is
        showing an eight-character code — type it in below to link it to this
        organisation.
      </StepHeading>

      {failure && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="mb-7 rounded-md border border-signal-500/40 bg-signal-50 px-4 py-3 text-meta text-signal-700 outline-none"
        >
          {messageFor(failure)}
        </div>
      )}

      <Field
        label="Pairing code"
        error={fieldError}
        hint="On the box's screen, under “Pair with Detecto”."
        className="max-w-sm"
      >
        {(props) => (
          <Input
            {...props}
            value={code}
            onChange={(event) => {
              setCode(formatPairingCode(event.target.value))
              setFieldError(undefined)
              setFailure(null)
            }}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            autoFocus
            className="h-12 font-mono text-title tracking-[0.22em] uppercase placeholder:tracking-[0.22em]"
          />
        )}
      </Field>

      {scanned && (
        <p className="mt-3 max-w-sm text-meta text-neutral-500">
          Filled in from the code you scanned. Check it matches the box in front
          of you before you continue.
        </p>
      )}

      {import.meta.env.DEV && <DevCodes />}

      <StepActions submitLabel={pending ? 'Pairing…' : 'Pair box'} pending={pending} />
    </form>
  )
}

/* -------------------------------------------------------------------------- */

function PairedWithBox({
  box,
  onContinue,
  onChangeBox,
}: {
  box: PairedBox
  onContinue: () => void
  onChangeBox: () => void
}) {
  return (
    <div>
      <StepHeading title="Box paired">
        This box is now linked to your organisation. Next, it looks over your
        network for cameras it can reach.
      </StepHeading>

      <div
        role="status"
        className="flex items-start gap-4 rounded-md border border-confirm-500/35 bg-confirm-50 px-4 py-4"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-confirm-600 text-white"
        >
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-body font-medium text-confirm-900">{box.label}</p>
          <p className="mt-1 text-meta text-confirm-800">
            {box.channels === 0
              ? 'Paired. It has not reported any camera inputs yet.'
              : `Paired, with ${box.channels} camera inputs available.`}
          </p>
          <p className="mt-2 font-mono text-micro uppercase tracking-[0.14em] text-confirm-700">
            {box.id}
          </p>
        </div>
      </div>

      <div className="mt-9 flex flex-col-reverse gap-3 border-t border-neutral-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onChangeBox}>
          Pair a different box
        </Button>
        <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onContinue}>
          Find cameras
        </Button>
      </div>
    </div>
  )
}

/** Dev only. The mock has no box to read a code off, so it lists its own. */
function DevCodes() {
  return (
    <p className="mt-6 max-w-sm text-meta text-neutral-500">
      <span className="label-micro text-neutral-500">Dev mock</span>
      <br />
      <code className="font-mono text-data">DEMO-1234</code> five cameras ·{' '}
      <code className="font-mono text-data">HALF-1234</code> two with problems ·{' '}
      <code className="font-mono text-data">NONE-1234</code> none found ·{' '}
      <code className="font-mono text-data">DOWN-1234</code> box drops out ·{' '}
      <code className="font-mono text-data">GONE-1234</code> expired
    </p>
  )
}
