/**
 * How much of a plan an organisation is using.
 *
 * Its own module because the thresholds are a product decision, not a component
 * detail — the same reasoning `lib/health/status.ts` gives for keeping every
 * health threshold in one reviewable place.
 *
 * The restraint rule the whole product follows applies hardest here. This is a
 * customer's own billing page, and the temptation on one of those is to make
 * every number feel urgent so somebody upgrades. Being near a limit is
 * information, not a fault: nothing has broken, no camera has stopped being
 * watched, and nobody needs to do anything today. Only being *over* a limit
 * gets Signal, because that is the one state where the next camera somebody
 * tries to connect will not fit.
 */

/** At or above this share of the limit, the page says so plainly. Not a warning. */
export const APPROACHING = 0.8

export type UsageState =
  /** Nothing connected yet. A new account, not a problem. */
  | 'none'
  /** Comfortably inside. The page stays quiet. */
  | 'within'
  /** Inside, but worth knowing before somebody orders more cameras. */
  | 'approaching'
  /** Exactly at it. The next one will not fit. */
  | 'at'
  /** Past it — possible after a downgrade, and the only state that needs a person. */
  | 'over'

export type Usage = {
  used: number
  limit: number
  state: UsageState
  /** Headroom left. Negative once over, so the page can say by how much. */
  remaining: number
}

export function usageFor(used: number, limit: number): Usage {
  const remaining = limit - used

  return { used, limit, remaining, state: stateFor(used, limit) }
}

function stateFor(used: number, limit: number): UsageState {
  if (used === 0) return 'none'
  // A plan with no limit to compare against cannot be approached or exceeded.
  if (limit <= 0) return 'within'
  if (used > limit) return 'over'
  if (used === limit) return 'at'
  return used / limit >= APPROACHING ? 'approaching' : 'within'
}

/**
 * Signal for one state and one only.
 *
 * A page that colours a customer's own bill amber whenever they are busy is a
 * page they learn to ignore, and the one time it matters they will scroll past
 * it — the same argument `lib/health/status.ts` makes for having no warning
 * tier at all.
 */
export function usageTone(state: UsageState): 'signal' | 'neutral' | 'confirm' {
  if (state === 'over') return 'signal'
  if (state === 'within' || state === 'none') return 'confirm'
  return 'neutral'
}

/** Whether the section has anything worth saying beyond the count. */
export function needsSaying(state: UsageState): boolean {
  return state === 'approaching' || state === 'at' || state === 'over'
}
