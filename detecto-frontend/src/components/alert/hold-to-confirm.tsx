import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, ShieldAlert } from 'lucide-react'

import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { cn } from '@/lib/utils'

type Stage = 'idle' | 'holding' | 'armed' | 'confirmed'

export type HoldToConfirmProps = {
  /** How long the operator must hold before responsibility is recorded. */
  holdMs?: number
  label?: string
  onConfirm?: (at: Date) => void
  disabled?: boolean
  /**
   * Why the control cannot be used, shown in place of the usual instructions
   * when `disabled`. It replaces the hint rather than sitting beside it, so a
   * control nobody can operate never tells them to press and hold — and because
   * the hint is what `aria-describedby` points at, the reason is announced with
   * the button instead of being left to a nearby paragraph.
   */
  disabledReason?: string
  /** Force the two-stage variant regardless of OS motion preference. */
  forceTwoStage?: boolean
  /**
   * What the hint says once confirmed.
   *
   * The default claims the decision is recorded against the operator's ID,
   * which is true wherever a confirmation reaches a server. A caller whose
   * decision does not reach one has to say so itself — this control cannot
   * know, and the sentence is too consequential to leave as a guess.
   */
  confirmedHint?: string
  className?: string
}

const CONFIRMED_HINT =
  'Escalation is now unlocked. This action is recorded against your operator ID.'

const HOLD_KEYS = new Set([' ', 'Spacebar', 'Enter'])

/**
 * The one deliberate interaction in Detecto.
 *
 * Confirming an alert is the moment a human takes responsibility for an AI
 * flag before anything escalates, so it is not a click. The operator holds
 * the control for a sustained beat and watches the commitment fill; letting
 * go early aborts and says so.
 *
 * When the user prefers reduced motion the duration cue would be meaningless,
 * so the control switches to an explicit two-stage confirm instead of simply
 * running the same animation faster.
 */
export function HoldToConfirm({
  holdMs = 1400,
  label = 'Hold to confirm threat',
  onConfirm,
  disabled = false,
  disabledReason,
  forceTwoStage = false,
  confirmedHint = CONFIRMED_HINT,
  className,
}: HoldToConfirmProps) {
  const prefersReduced = useReducedMotion()
  const twoStage = prefersReduced || forceTwoStage

  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [aborted, setAborted] = useState(false)
  const [confirmedAt, setConfirmedAt] = useState<Date | null>(null)

  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const hintId = useId()

  const clearRaf = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(
    () => () => {
      clearRaf()
      clearTimer()
    },
    [clearRaf, clearTimer],
  )

  const complete = useCallback(() => {
    clearRaf()
    clearTimer()
    const at = new Date()
    setProgress(1)
    setAborted(false)
    setStage('confirmed')
    setConfirmedAt(at)
    onConfirm?.(at)
  }, [clearRaf, clearTimer, onConfirm])

  const tick = useCallback(
    (now: number) => {
      const ratio = Math.min(1, (now - startRef.current) / holdMs)
      setProgress(ratio)
      if (ratio >= 1) {
        complete()
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [complete, holdMs],
  )

  const beginHold = useCallback(() => {
    if (disabled || stage === 'confirmed' || stage === 'holding') return
    clearTimer()
    setAborted(false)
    setStage('holding')
    startRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }, [clearTimer, disabled, stage, tick])

  const releaseHold = useCallback(() => {
    if (stage !== 'holding') return
    clearRaf()
    setProgress(0)
    setStage('idle')
    setAborted(true)
    clearTimer()
    timerRef.current = window.setTimeout(() => setAborted(false), 2500)
  }, [clearRaf, clearTimer, stage])

  const advanceTwoStage = useCallback(() => {
    if (disabled || stage === 'confirmed') return
    if (stage === 'armed') {
      complete()
      return
    }
    setAborted(false)
    setStage('armed')
    clearTimer()
    // Disarms itself so a forgotten alert can never be confirmed by a stray click.
    timerRef.current = window.setTimeout(() => setStage('idle'), 8000)
  }, [clearTimer, complete, disabled, stage])

  const disarm = useCallback(() => {
    if (stage !== 'armed') return
    clearTimer()
    setStage('idle')
  }, [clearTimer, stage])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      disarm()
      return
    }
    if (!HOLD_KEYS.has(event.key)) return
    event.preventDefault()
    if (event.repeat) return
    beginHold()
  }

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return
    event.preventDefault()
    releaseHold()
  }

  const confirmed = stage === 'confirmed'
  const remaining = ((1 - progress) * holdMs) / 1000

  const readout = confirmed
    ? `verified ${confirmedAt ? formatClock(confirmedAt) : ''}`
    : stage === 'holding'
      ? `hold ${remaining.toFixed(1)}s`
      : stage === 'armed'
        ? 'armed · esc to cancel'
        : aborted
          ? 'released — not confirmed'
          : twoStage
            ? 'two-stage confirm'
            : `hold ${(holdMs / 1000).toFixed(1)}s`

  const buttonLabel = confirmed
    ? 'Confirmed by operator'
    : stage === 'armed'
      ? 'Press again to confirm'
      : twoStage
        ? 'Confirm threat'
        : label

  const announcement = confirmed
    ? `Detection confirmed at ${confirmedAt ? formatClock(confirmedAt) : ''}. Escalation unlocked.`
    : stage === 'armed'
      ? 'Armed. Activate again to confirm, or press Escape to cancel.'
      : stage === 'holding'
        ? 'Holding. Keep holding to confirm.'
        : aborted
          ? 'Released early. Not confirmed.'
          : ''

  const interactionProps = twoStage
    ? { onClick: advanceTwoStage, onKeyDown }
    : {
        onPointerDown: beginHold,
        onPointerUp: releaseHold,
        onPointerLeave: releaseHold,
        onPointerCancel: releaseHold,
        onBlur: releaseHold,
        onKeyDown,
        onKeyUp,
        onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
      }

  return (
    <div className={cn('w-full', className)}>
      <button
        type="button"
        disabled={disabled || confirmed}
        aria-describedby={hintId}
        data-stage={stage}
        className={cn(
          'group relative isolate w-full touch-none select-none overflow-hidden rounded-md border text-left',
          'px-4 py-3.5 transition-colors duration-150',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-default',
          confirmed
            ? 'border-confirm-600 bg-confirm-600 text-white'
            : cn(
                'border-signal-500/55 bg-signal-500/10 text-signal-800 dark:text-signal-100',
                'hover:border-signal-500 hover:bg-signal-500/15',
                'active:translate-y-px',
                stage === 'armed' && 'border-signal-500 bg-signal-500/20',
              ),
          disabled && !confirmed && 'opacity-45',
        )}
        {...interactionProps}
      >
        {/* Commitment fill — driven by rAF, never a CSS transition, so it
            reflects real elapsed hold time rather than an animation curve. */}
        {!confirmed && (
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 origin-left bg-signal-500/25"
            style={{ transform: `scaleX(${progress})`, willChange: 'transform' }}
          />
        )}
        {!confirmed && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-[3px] w-full origin-left bg-signal-500"
            style={{ transform: `scaleX(${progress})`, willChange: 'transform' }}
          />
        )}

        <span className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5">
            {confirmed ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <ShieldAlert aria-hidden="true" className="size-4" />
            )}
            <span className="font-display text-title font-medium">
              {buttonLabel}
            </span>
          </span>
          <span
            className={cn(
              'label-micro shrink-0 tabular-nums',
              confirmed
                ? 'text-confirm-100'
                : aborted
                  ? 'text-signal-600 dark:text-signal-300'
                  : 'text-signal-700/70 dark:text-signal-200/70',
            )}
          >
            {readout}
          </span>
        </span>
      </button>

      <p
        id={hintId}
        className="mt-2 text-meta text-neutral-500 dark:text-neutral-400"
      >
        {disabled && disabledReason
          ? disabledReason
          : confirmed
            ? confirmedHint
            : twoStage
              ? 'Activate once to arm, then activate again to take responsibility for this flag.'
              : 'Press and hold — with a pointer, or with Space / Enter — until the bar fills.'}
      </p>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  )
}

function formatClock(date: Date) {
  return date.toLocaleTimeString('en-GB', { hour12: false })
}
