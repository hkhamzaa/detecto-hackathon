import { useEffect, useState } from 'react'

import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { cn } from '@/lib/utils'

/**
 * The only chart in the product, in two orientations.
 *
 * There is no charting library here and this page did not add one. Everything
 * analytics needs to say — how many, where, when, how long — is a comparison of
 * magnitudes against a shared baseline, which is a bar. Bars are also the one
 * form that survives a phone: rows reflow, columns scroll, and neither needs a
 * second simplified rendering to stay readable.
 *
 * Stacking is not a separate component. A bar is a list of segments; a plain
 * bar is a list of one.
 *
 * Colour carries the same meaning it does everywhere else in Detecto, and is
 * not a palette. The names are the design system's own — the same words `Panel`
 * and `StatusWord` take — rather than any one page's vocabulary, because the
 * same green means "resolved and good" whether the subject is a confirmed
 * detection or a box that is reporting in.
 *
 * `muted` is the important one. It is for the part of a bar that is real but
 * unremarkable — a false positive, a request that simply succeeded — and it is
 * deliberately grey rather than red: noise is not an emergency, and what is
 * worth seeing about it is its share of the bar, not its colour.
 */

export type BarTone = 'confirm' | 'signal' | 'muted' | 'neutral' | 'ink'

const TONE: Record<BarTone, string> = {
  /** Resolved and good: verified by a person, reporting in, inside target. */
  confirm: 'bg-confirm-500',
  /** Needs attention: unreviewed, offline, over threshold. */
  signal: 'bg-signal-500',
  /** Real but unremarkable. See above. */
  muted: 'bg-neutral-300',
  neutral: 'bg-neutral-400',
  ink: 'bg-ink',
}

export type BarSegment = {
  tone: BarTone
  value: number
  /** Named in the screen-reader text, e.g. "confirmed". */
  label: string
}

export type BarDatum = {
  key: string
  /** The full reading, e.g. "Front of house". Read out, and shown on hover. */
  label: string
  /** The axis tick, when it needs to be shorter than the label. */
  tick?: string
  segments: BarSegment[]
  /** The one the surrounding copy is pointing at. */
  marked?: boolean
}

function total(datum: BarDatum) {
  return datum.segments.reduce((sum, segment) => sum + segment.value, 0)
}

/** The reading a screen reader gets: the label, the total, and the split. */
function readout(datum: BarDatum, unit: string) {
  const sum = total(datum)
  const parts = datum.segments
    .filter((segment) => segment.value > 0)
    .map((segment) => `${segment.value} ${segment.label}`)

  const split = parts.length > 1 ? ` — ${parts.join(', ')}` : ''
  return `${datum.label}: ${sum} ${sum === 1 ? unit : `${unit}s`}${split}`
}

/**
 * Bars grow from the baseline on first paint, which is the only animation on
 * the page. Under `prefers-reduced-motion` they are simply drawn at full size —
 * not animated faster, which would still be movement. The preference is read in
 * JS as well as CSS so the bars never start at zero in the first place, and
 * there is no flash of an empty chart to catch the eye on the way past.
 */
function useGrown() {
  const reduced = useReducedMotion()
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Full size immediately when motion is reduced, including if the preference
  // is turned on while the page is open — the bars land, they do not race.
  return { grown: reduced || started, reduced }
}

function scale(value: number, max: number) {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

/* -------------------------------------------------------------------------- */
/* Horizontal — a short list of named things, ranked                          */
/* -------------------------------------------------------------------------- */

export function BarRows({
  data,
  caption,
  unit = 'alert',
  max,
  className,
}: {
  data: BarDatum[]
  /** Describes the chart to somebody who cannot see it. */
  caption: string
  unit?: string
  /** The full-width value. Defaults to the largest bar. */
  max?: number
  className?: string
}) {
  const { grown, reduced } = useGrown()
  const ceiling = max ?? Math.max(...data.map(total), 1)

  return (
    <ul className={cn('grid gap-4', className)} aria-label={caption}>
      {data.map((datum) => {
        const sum = total(datum)

        return (
          <li key={datum.key} className="grid gap-1.5">
            <span className="sr-only">{readout(datum, unit)}</span>

            <div aria-hidden="true" className="flex items-baseline justify-between gap-4">
              <span
                className={cn(
                  'min-w-0 truncate text-meta',
                  datum.marked ? 'font-medium text-ink' : 'text-neutral-700',
                )}
                title={datum.label}
              >
                {datum.label}
              </span>
              <span className="shrink-0 font-mono text-data text-neutral-600">
                {sum}
              </span>
            </div>

            <div
              aria-hidden="true"
              className="flex h-2 w-full overflow-hidden rounded-sm bg-paper-sunken"
            >
              {datum.segments.map((segment, index) => (
                <div
                  key={`${datum.key}-${segment.label}-${index}`}
                  className={cn(
                    'shrink-0',
                    TONE[segment.tone],
                    !reduced && 'transition-[width] duration-500 ease-out',
                  )}
                  style={{
                    width: grown ? `${scale(segment.value, ceiling)}%` : '0%',
                    // Staggered just enough to read as one movement rather than
                    // a row of things arriving at once.
                    transitionDelay: reduced ? undefined : `${index * 60}ms`,
                  }}
                />
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */
/* Vertical — an axis with an order that matters                              */
/* -------------------------------------------------------------------------- */

/**
 * Columns keep their width and the chart scrolls sideways below the breakpoint,
 * the same treatment the alert table gets and for the same reason: twenty-four
 * hours squeezed into a phone's width stops being twenty-four hours. The
 * scroller is focusable so it can be reached and moved with a keyboard.
 */
export function BarColumns({
  data,
  caption,
  unit = 'alert',
  max,
  height = 'h-40',
  columnClass = 'min-w-8',
  className,
}: {
  data: BarDatum[]
  caption: string
  unit?: string
  max?: number
  /** Plot height. Tailwind class, so it can differ per section. */
  height?: string
  /** Minimum column width — what forces the scroll rather than a squeeze. */
  columnClass?: string
  className?: string
}) {
  const { grown, reduced } = useGrown()
  const ceiling = max ?? Math.max(...data.map(total), 1)

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={caption}
      className={cn(
        'overflow-x-auto pb-1',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <div className="min-w-full">
        {/* The bars, sitting on a real axis rule. Without it an hour with
            nothing in it reads as a full-height pale column rather than as a
            gap, which on a chart about when things happen is the wrong way
            round. */}
        <ul className="flex items-end gap-1.5 border-b border-neutral-300">
          {data.map((datum) => (
            <li
              key={datum.key}
              className={cn('flex-1', columnClass)}
              title={`${datum.label} — ${total(datum)}`}
            >
              <span className="sr-only">{readout(datum, unit)}</span>

              <div
                aria-hidden="true"
                className={cn(
                  'flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-paper-sunken',
                  height,
                )}
              >
                {/* Stacked from the baseline up, so the segments read in the
                    same order the legend lists them. */}
                {[...datum.segments].reverse().map((segment, index) => (
                  <div
                    key={`${datum.key}-${segment.label}-${index}`}
                    className={cn(
                      'w-full shrink-0',
                      TONE[segment.tone],
                      !reduced && 'transition-[height] duration-500 ease-out',
                    )}
                    style={{
                      height: grown ? `${scale(segment.value, ceiling)}%` : '0%',
                    }}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>

        {/* The axis labels, in a matching row rather than inside each bar, so
            a tick can be blank without collapsing its column. */}
        <ul aria-hidden="true" className="mt-2 flex gap-1.5">
          {data.map((datum) => (
            <li
              key={datum.key}
              className={cn(
                'flex-1 text-center font-mono text-micro whitespace-nowrap',
                columnClass,
                datum.marked ? 'text-ink' : 'text-neutral-500',
              )}
            >
              {datum.tick ?? datum.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Hidden from screen readers on purpose: every bar already carries its own
 * split in words, so reading the key aloud as well would be saying the same
 * thing twice before getting to the numbers.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: { tone: BarTone; label: string }[]
  className?: string
}) {
  return (
    <ul
      aria-hidden="true"
      className={cn('flex flex-wrap items-center gap-x-5 gap-y-2', className)}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className={cn('size-1.5 shrink-0 rounded-full', TONE[item.tone])} />
          <span className="text-meta text-neutral-600">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
