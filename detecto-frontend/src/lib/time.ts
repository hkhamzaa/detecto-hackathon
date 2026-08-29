const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

/**
 * How long ago, in words. Deliberately coarse — for a camera that has been
 * quiet for two days, the exact minute is noise, and the exact timestamp is one
 * hover away in the `title` on every place this is rendered.
 */
export function formatRelative(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'Unknown'

  const elapsed = now - then
  if (elapsed < 0) return 'Just now'
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour')
  return plural(Math.floor(elapsed / DAY), 'day')
}

/**
 * The compact form for a dense column: clock time for anything today, date and
 * time for anything older. Alerts are read against each other down a page, so
 * this is set in mono with tabular figures wherever it appears.
 */
export function formatShort(iso: string, now = Date.now()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const sameDay = date.toDateString() === new Date(now).toDateString()
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour12: false })
    : date.toLocaleString('en-GB', {
        hour12: false,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
}

/**
 * A calendar date with no clock on it — a signup, a period end, an anniversary.
 *
 * Distinct from `formatShort`, which is for things read against each other down
 * a dense column and therefore needs the time. An account created eight months
 * ago has a date; the minute it happened is noise.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * A length of time, not a point in one — "how long did that take", rather than
 * "when was it".
 *
 * Coarse in the same way `formatRelative` is, and for the same reason, with one
 * exception: minutes are kept whole right up to the hour, because the
 * difference between a four-minute response and a fifty-minute one is the
 * entire subject of the page that reads this.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return 'Unknown'
  if (minutes < 1) return 'under a minute'

  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`

  const hours = Math.floor(whole / 60)
  if (hours < 24) {
    const rest = whole % 60
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
  }

  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`
}

/** An hour of the day as a clock reading, for an axis. 24-hour, like everything else. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** The full value, for a `title` or anywhere the exact moment matters. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', { hour12: false })
}
