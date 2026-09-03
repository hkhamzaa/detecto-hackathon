/**
 * Live overlay copy for the demo playback page.
 *
 * Each tick is one model window (~12 consecutive frames). Playback looks
 * up the window that contains video.currentTime. A miss is Neutral 0%/0%
 * — not a leftover clip from elsewhere in the file or another camera.
 */

export const HEAD_THRESHOLD = 0.5

/** Fallback span when a tick was stored without start/end (~12 frames @ 30fps). */
const DEFAULT_WINDOW_S = 0.4

export type DetectionTick = {
  cameraId: string
  offsetS: number
  startS: number
  endS: number
  timestamp: string
  classification: string
  violence: number
  weapon: number
}

export type OverlayTone = 'pending' | 'normal' | 'moderate' | 'high'

export type OverlayBanner = {
  text: string
  tone: OverlayTone
}

function pct(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function windowOf(tick: DetectionTick): { start: number; end: number } {
  const start = Number.isFinite(tick.startS) ? tick.startS : Math.max(0, tick.offsetS - DEFAULT_WINDOW_S)
  const end = Number.isFinite(tick.endS) ? tick.endS : tick.offsetS
  return { start, end }
}

export function overlayFor(tick: DetectionTick | null): OverlayBanner {
  if (!tick) {
    return {
      text: 'Normal  (Violence 0% | Weapon 0%)',
      tone: 'normal',
    }
  }

  const violent = tick.violence >= HEAD_THRESHOLD
  const armed = tick.weapon >= HEAD_THRESHOLD
  const scores = `Weapon ${pct(tick.weapon)} | Violence ${pct(tick.violence)}`

  if (violent && armed) {
    return { text: `ALERT: ${scores}`, tone: 'high' }
  }
  if (violent || armed) {
    const rest = armed
      ? `Weapon ${pct(tick.weapon)} | Violence ${pct(tick.violence)}`
      : `Violence ${pct(tick.violence)} | Weapon ${pct(tick.weapon)}`
    return { text: `ALERT: ${rest}`, tone: 'moderate' }
  }
  return {
    text: `Normal  (Violence ${pct(tick.violence)} | Weapon ${pct(tick.weapon)})`,
    tone: 'normal',
  }
}

/**
 * The model window whose span contains this playhead and whose centre is
 * closest to it. Ticks must be sorted. A miss is Neutral 0%/0% — never a
 * 2-second clip from elsewhere in the file.
 */
export function tickAt(
  ticks: DetectionTick[],
  playbackS: number,
  options: { cameraId?: string } = {},
): DetectionTick | null {
  const scoped = options.cameraId
    ? ticks.filter((tick) => tick.cameraId === options.cameraId)
    : ticks
  if (scoped.length === 0) return null

  let best: DetectionTick | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const tick of scoped) {
    const { start, end } = windowOf(tick)
    if (playbackS < start || playbackS > end) continue
    const dist = Math.abs((start + end) / 2 - playbackS)
    if (dist < bestDist) {
      best = tick
      bestDist = dist
    }
  }
  return best
}

export function scoredUntil(ticks: DetectionTick[]): number | null {
  if (ticks.length === 0) return null
  return windowOf(ticks[ticks.length - 1]).end
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseTick(value: unknown, cameraId?: string): DetectionTick | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>
  const id = typeof t.cameraId === 'string' ? t.cameraId : null
  const offsetS = num(t.offsetS)
  const violence = num(t.violence)
  const weapon = num(t.weapon)
  if (!id || offsetS === null || violence === null || weapon === null) {
    return null
  }
  if (cameraId && id !== cameraId) return null
  const startS = num(t.startS)
  const endS = num(t.endS)
  return {
    cameraId: id,
    offsetS,
    startS: startS ?? Math.max(0, offsetS - DEFAULT_WINDOW_S),
    endS: endS ?? offsetS,
    timestamp: typeof t.timestamp === 'string' ? t.timestamp : '',
    classification: typeof t.classification === 'string' ? t.classification : '',
    violence,
    weapon,
  }
}

export function mergeTicks(
  existing: DetectionTick[],
  incoming: DetectionTick[],
  cameraId?: string,
): DetectionTick[] {
  const keep = (tick: DetectionTick) => !cameraId || tick.cameraId === cameraId
  const byOffset = new Map<number, DetectionTick>()
  for (const tick of existing) {
    if (keep(tick)) byOffset.set(tick.offsetS, tick)
  }
  for (const tick of incoming) {
    if (keep(tick)) byOffset.set(tick.offsetS, tick)
  }
  return [...byOffset.values()].sort((a, b) => a.offsetS - b.offsetS)
}
