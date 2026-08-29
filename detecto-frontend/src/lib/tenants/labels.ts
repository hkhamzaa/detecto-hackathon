import { planById } from '@/lib/plans'
import type { Tenant } from '@/lib/tenants/api'

/**
 * How a tenant reads to a person. Display only — nothing decides anything here.
 *
 * Same role as `lib/alerts/labels.ts`, and kept out of the component that draws
 * it for the same reason: three surfaces show a plan name and a trial countdown,
 * and they must not each arrive at their own wording.
 */

/** Inside this, a trial has stopped being "in progress" and become a deadline. */
export const TRIAL_ENDING_DAYS = 3
const DAY = 86_400_000

/**
 * The plan's name, or the raw id when the catalogue has never heard of it.
 *
 * Deliberately not a friendly fallback. A tenant on a plan this build does not
 * know about is a record worth noticing, and `estate-legacy` on screen tells a
 * support engineer something that "Unknown plan" would hide.
 */
export function planLabel(planId: string): string {
  return planById(planId)?.name ?? planId ?? ''
}

/** Whole days until the trial ends. Negative once it has. Null when not on trial. */
export function trialDaysLeft(tenant: Pick<Tenant, 'trialEndsAt'>): number | null {
  if (!tenant.trialEndsAt) return null
  const ends = Date.parse(tenant.trialEndsAt)
  if (Number.isNaN(ends)) return null
  return Math.ceil((ends - Date.now()) / DAY)
}

export function trialIsEnding(tenant: Pick<Tenant, 'trialEndsAt'>): boolean {
  const left = trialDaysLeft(tenant)
  return left !== null && left <= TRIAL_ENDING_DAYS
}
