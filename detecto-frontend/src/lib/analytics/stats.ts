import type { Alert, DetectionKind } from '@/lib/alerts/api'

/**
 * Every number on the analytics page, derived from alert records.
 *
 * Pure functions over `Alert[]` and nothing else — no fetching, no React, no
 * rounding for display. A figure on screen is a count of detections or a
 * function of their timestamps, and can be checked against the exported rows.
 *
 * The thresholds in `ENOUGH` are as much a part of this file as the maths. A
 * false-positive rate over nine alerts is arithmetic, not evidence, and the
 * page has to be able to tell the difference.
 */

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
export const WEEK_MS = 7 * DAY_MS

/* -------------------------------------------------------------------------- */
/* How much is enough                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The minimum behind each visualisation, below which the page says so instead
 * of drawing it.
 *
 * These are not defensive coding. A single point stretched across a chart built
 * for eight weeks of trend reads as a flat line, and a flat line is a claim —
 * that nothing is changing — which nobody has the data to make. Withholding the
 * chart and stating the counts plainly is the honest version of the same
 * screen.
 */
export const ENOUGH = {
  /**
   * Weeks with at least one decided alert. Three points is the fewest that can
   * show a direction rather than just a pair of values.
   */
  accuracyWeeks: 3,
  /**
   * Decided alerts for one module. Below a dozen, a single extra dismissal
   * swings the rate by whole percentage points, and a customer would be reading
   * noise as a trend in model quality.
   */
  accuracyRate: 12,
  /**
   * Alerts across 24 hourly buckets. Fewer than one per bucket on average and
   * the "peak hour" is whichever hour happened to get two.
   */
  hourPattern: 24,
  /** Decided alerts. A distribution needs enough bodies to have a shape. */
  responseSpread: 10,
  /** Alerts in a zone before its share of the total means anything. */
  zonePattern: 8,
} as const

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                              */
/* -------------------------------------------------------------------------- */

/** An alert a person has closed, with the timestamp proving it. */
export type DecidedAlert = Alert & { decidedAt: string }

export function decidedOnly(alerts: Alert[]): DecidedAlert[] {
  return alerts.filter(
    (alert): alert is DecidedAlert =>
      alert.status !== 'unconfirmed' && alert.decidedAt !== null,
  )
}

export function waitingOnly(alerts: Alert[]): Alert[] {
  return alerts.filter((alert) => alert.status === 'unconfirmed')
}

/** Minutes from raised to decided. Never negative, whatever the clocks say. */
export function minutesToDecision(alert: DecidedAlert): number {
  const raised = Date.parse(alert.detectedAt)
  const decided = Date.parse(alert.decidedAt)
  if (Number.isNaN(raised) || Number.isNaN(decided)) return 0
  return Math.max(0, (decided - raised) / MINUTE_MS)
}

/** How long something has been waiting, as of `now`. */
export function minutesWaiting(alert: Alert, now: number): number {
  const raised = Date.parse(alert.detectedAt)
  if (Number.isNaN(raised)) return 0
  return Math.max(0, (now - raised) / MINUTE_MS)
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/** The value below which `fraction` of the set falls. Used for the slow tail. */
export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  )
  return sorted[index]
}

/** Whole weeks back from now. 0 is the last seven days. */
function weeksAgo(iso: string, now: number): number {
  const raised = Date.parse(iso)
  if (Number.isNaN(raised)) return -1
  return Math.floor((now - raised) / WEEK_MS)
}

/* -------------------------------------------------------------------------- */
/* 1. Overview                                                                */
/* -------------------------------------------------------------------------- */

export type WeekOnWeek = {
  thisWeek: number
  lastWeek: number
  /**
   * Proportional change, or `null` when last week was zero. There is no
   * percentage increase from nothing, and printing one would be inventing a
   * denominator.
   */
  change: number | null
}

export function weekOnWeek(alerts: Alert[], now: number): WeekOnWeek {
  let thisWeek = 0
  let lastWeek = 0

  for (const alert of alerts) {
    const week = weeksAgo(alert.detectedAt, now)
    if (week === 0) thisWeek += 1
    else if (week === 1) lastWeek += 1
  }

  return {
    thisWeek,
    lastWeek,
    change: lastWeek === 0 ? null : (thisWeek - lastWeek) / lastWeek,
  }
}

/**
 * The headline time-to-decision, as a median.
 *
 * The mean is the wrong summary here and section 4 of this page is the reason:
 * a handful of alerts that sat overnight drag a mean far above anything a
 * person on shift would recognise, and it is precisely those alerts the page
 * must not average away. The median is what a typical decision actually took;
 * the distribution below it shows the ones that did not.
 */
export function medianDecisionMinutes(alerts: Alert[]): number | null {
  return median(decidedOnly(alerts).map(minutesToDecision))
}

/* -------------------------------------------------------------------------- */
/* 2. Module accuracy                                                         */
/* -------------------------------------------------------------------------- */

export type AccuracyWeek = {
  /** Weeks back from now. 0 is the last seven days. */
  weeksAgo: number
  confirmed: number
  falsePositive: number
  /** Of the decided ones this week. Null when none were decided. */
  falsePositiveRate: number | null
}

export type ModuleAccuracy = {
  kind: DetectionKind
  raised: number
  confirmed: number
  falsePositive: number
  waiting: number
  /** Over the whole window, of the decided ones. Null when none were decided. */
  falsePositiveRate: number | null
  /** Median confidence of the ones a person confirmed, and of the ones they threw out. */
  confidenceConfirmed: number | null
  confidenceDismissed: number | null
  /** Oldest first, one entry per week in the window. */
  weeks: AccuracyWeek[]
  /** Weeks that actually had a decision in them. Compared against `ENOUGH`. */
  weeksWithData: number
  /** True when the rate is worth putting on a chart at all. */
  rateIsMeaningful: boolean
  trendIsMeaningful: boolean
}

export function moduleAccuracy(
  alerts: Alert[],
  kind: DetectionKind,
  windowDays: number,
  now: number,
): ModuleAccuracy {
  const mine = alerts.filter((alert) => alert.kind === kind)
  const decided = decidedOnly(mine)

  const confirmed = decided.filter((alert) => alert.status === 'confirmed')
  const falsePositive = decided.filter((alert) => alert.status === 'dismissed')

  const weekCount = Math.max(1, Math.ceil(windowDays / 7))
  const weeks: AccuracyWeek[] = []

  for (let index = weekCount - 1; index >= 0; index -= 1) {
    const inWeek = decided.filter(
      (alert) => weeksAgo(alert.detectedAt, now) === index,
    )
    const weekConfirmed = inWeek.filter((a) => a.status === 'confirmed').length
    const weekFalse = inWeek.length - weekConfirmed

    weeks.push({
      weeksAgo: index,
      confirmed: weekConfirmed,
      falsePositive: weekFalse,
      falsePositiveRate: inWeek.length === 0 ? null : weekFalse / inWeek.length,
    })
  }

  const weeksWithData = weeks.filter(
    (week) => week.confirmed + week.falsePositive > 0,
  ).length

  return {
    kind,
    raised: mine.length,
    confirmed: confirmed.length,
    falsePositive: falsePositive.length,
    waiting: mine.length - decided.length,
    falsePositiveRate:
      decided.length === 0 ? null : falsePositive.length / decided.length,
    confidenceConfirmed: median(confirmed.map((a) => a.confidence)),
    confidenceDismissed: median(falsePositive.map((a) => a.confidence)),
    weeks,
    weeksWithData,
    rateIsMeaningful: decided.length >= ENOUGH.accuracyRate,
    trendIsMeaningful:
      decided.length >= ENOUGH.accuracyRate &&
      weeksWithData >= ENOUGH.accuracyWeeks,
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Incident pattern                                                        */
/* -------------------------------------------------------------------------- */

export type ZoneCount = {
  zone: string
  label: string
  total: number
  confirmed: number
  falsePositive: number
  waiting: number
}

/** Busiest zone first. Anything unzoned sorts last — it is a loose end, not a place. */
export function byZone(alerts: Alert[]): ZoneCount[] {
  const zones = new Map<string, ZoneCount>()

  for (const alert of alerts) {
    const zone = alert.zone.trim()
    const entry = zones.get(zone) ?? {
      zone,
      label: zone || 'No zone set',
      total: 0,
      confirmed: 0,
      falsePositive: 0,
      waiting: 0,
    }

    entry.total += 1
    if (alert.status === 'confirmed') entry.confirmed += 1
    else if (alert.status === 'dismissed') entry.falsePositive += 1
    else entry.waiting += 1

    zones.set(zone, entry)
  }

  return [...zones.values()].sort((a, b) => {
    if (!a.zone) return 1
    if (!b.zone) return -1
    return b.total - a.total || a.label.localeCompare(b.label)
  })
}

export type HourCount = { hour: number; total: number; confirmed: number }

/** Always 24 entries, including the quiet ones — the gaps are the finding. */
export function byHour(alerts: Alert[]): HourCount[] {
  const hours: HourCount[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    confirmed: 0,
  }))

  for (const alert of alerts) {
    const raised = new Date(alert.detectedAt)
    if (Number.isNaN(raised.getTime())) continue
    const entry = hours[raised.getHours()]
    entry.total += 1
    if (alert.status === 'confirmed') entry.confirmed += 1
  }

  return hours
}

/** The busiest run of three consecutive hours, said in words. Null when flat. */
export function peakWindow(hours: HourCount[]): { from: number; to: number } | null {
  const total = hours.reduce((sum, hour) => sum + hour.total, 0)
  if (total === 0) return null

  let best = { from: 0, count: -1 }
  for (let start = 0; start < 24; start += 1) {
    const count =
      hours[start].total +
      hours[(start + 1) % 24].total +
      hours[(start + 2) % 24].total
    if (count > best.count) best = { from: start, count }
  }

  // A run holding no more than an even share of the day is not a peak.
  if (best.count <= (total * 3) / 24) return null
  return { from: best.from, to: (best.from + 3) % 24 }
}

/* -------------------------------------------------------------------------- */
/* 4. Response time                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Buckets, not a continuous axis. An org admin asking this question is asking
 * "how many took too long", and the boundaries are the ones they would use:
 * inside five minutes is a person watching, over an hour is a person who was
 * not, and over four hours is a detection that was effectively unattended.
 */
export const RESPONSE_BUCKETS: { max: number; label: string; short: string }[] = [
  { max: 2, label: 'Under 2 minutes', short: '<2m' },
  { max: 5, label: '2 to 5 minutes', short: '2–5m' },
  { max: 15, label: '5 to 15 minutes', short: '5–15m' },
  { max: 60, label: '15 to 60 minutes', short: '15–60m' },
  { max: 240, label: '1 to 4 hours', short: '1–4h' },
  { max: Number.POSITIVE_INFINITY, label: 'Over 4 hours', short: '4h+' },
]

/** Anything past this is called out by itself rather than left in a bar. */
export const SLOW_MINUTES = 240

export type ResponseSpread = {
  buckets: { label: string; short: string; count: number }[]
  decided: number
  median: number | null
  /** Nine out of ten decisions came inside this. The number that catches the tail. */
  ninetieth: number | null
  /** Decided alerts that took longer than `SLOW_MINUTES`. */
  slow: number
  /** Still unconfirmed right now, and the longest of them. */
  waiting: number
  longestWaiting: number | null
  isMeaningful: boolean
}

export function responseSpread(alerts: Alert[], now: number): ResponseSpread {
  const minutes = decidedOnly(alerts).map(minutesToDecision)

  const buckets = RESPONSE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    short: bucket.short,
    count: 0,
  }))

  for (const value of minutes) {
    const index = RESPONSE_BUCKETS.findIndex((bucket) => value < bucket.max)
    buckets[index === -1 ? buckets.length - 1 : index].count += 1
  }

  const waiting = waitingOnly(alerts)
  const waits = waiting.map((alert) => minutesWaiting(alert, now))

  return {
    buckets,
    decided: minutes.length,
    median: median(minutes),
    ninetieth: percentile(minutes, 0.9),
    slow: minutes.filter((value) => value >= SLOW_MINUTES).length,
    waiting: waiting.length,
    longestWaiting: waits.length === 0 ? null : Math.max(...waits),
    isMeaningful: minutes.length >= ENOUGH.responseSpread,
  }
}
