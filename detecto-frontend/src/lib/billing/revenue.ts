import { formatPrice, PLANS, planById, type Plan } from '@/lib/plans'
import type { Tenant } from '@/lib/tenants/api'

/**
 * What the platform is billing, worked out in the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ EVERY FIGURE THIS FILE PRODUCES IS BUILT ON PRICING NOBODY HAS SIGNED OFF
 *
 * There is no billing service to ask and no payment processor connected. MRR is
 * not read from anywhere — it is arithmetic over the tenant registry and the
 * plan catalogue in `lib/plans.ts`, and that catalogue is placeholder: the
 * tiers, the ceilings and the prices are all provisional. The module flags page
 * says exactly this about the same numbers, and it matters more here, because
 * multiplying a placeholder price by a real account count produces something
 * that looks like revenue.
 *
 * It is not revenue. It must not be quoted to a customer, to an investor, or in
 * a board pack. The page says so beside the number rather than in a footnote,
 * and `PLACEHOLDER_PRICING` is the sentence it says — kept here so the warning
 * and the arithmetic cannot drift apart.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The split between this file and `lib/billing/api.ts` is what the browser can
 * work out for itself against what only a payment processor could know. Plan
 * assignments and prices are here. Whether a charge actually went through is
 * there.
 */

export const PLACEHOLDER_PRICING =
  'Every amount on this page is worked out from placeholder prices that nobody has signed off.'

/** A billing cycle, in days. The invoice history counts in the same units. */
export const CYCLE_DAYS = 30

const DAY_MS = 86_400_000

/* -------------------------------------------------------------------------- */
/* Recurring revenue                                                          */
/* -------------------------------------------------------------------------- */

export type PlanRevenue = {
  plan: Plan
  /** Accounts being billed for this plan. */
  tenants: number
  /** Their combined monthly. */
  monthly: number
}

export type RevenueSummary = {
  /** Monthly recurring revenue: what active accounts are billed each cycle. */
  mrr: number
  /** Accounts contributing to it. */
  billing: number
  byPlan: PlanRevenue[]
  /** Chosen a plan, charged nothing yet. Not revenue until somebody converts. */
  trial: { tenants: number; monthly: number }
  /** Was billing, is not now — suspension stops the subscription, not the account. */
  suspended: { tenants: number; monthly: number }
  /**
   * On a plan id the catalogue has never heard of, so it cannot be priced at
   * all. Reported rather than quietly counted as zero: an account nobody can
   * price is a record worth noticing, the same reasoning `planLabel` follows
   * when it shows an unknown id as-is.
   */
  unpriced: number
}

/** Only an active account is being billed. See the two fields beside `mrr`. */
export function isBilling(tenant: Pick<Tenant, 'status'>): boolean {
  return tenant.status === 'active'
}

/** The monthly for a tenant's plan, or null when the catalogue has no such plan. */
export function monthlyFor(tenant: Pick<Tenant, 'planId'>): number | null {
  return planById(tenant.planId)?.monthly ?? null
}

function totalMonthly(tenants: Pick<Tenant, 'planId'>[]): number {
  return tenants.reduce((sum, tenant) => sum + (monthlyFor(tenant) ?? 0), 0)
}

export function summariseRevenue(tenants: Tenant[]): RevenueSummary {
  // Priced *and* active. An account whose plan the catalogue cannot price adds
  // nothing to MRR, so it must not be counted among the accounts MRR is across.
  const billing = tenants.filter(
    (tenant) => isBilling(tenant) && monthlyFor(tenant) !== null,
  )
  const trial = tenants.filter((tenant) => tenant.status === 'trial')
  const suspended = tenants.filter((tenant) => tenant.status === 'suspended')

  return {
    mrr: totalMonthly(billing),
    billing: billing.length,
    byPlan: PLANS.map((plan) => {
      const on = billing.filter((tenant) => tenant.planId === plan.id).length
      return { plan, tenants: on, monthly: plan.monthly * on }
    }),
    trial: { tenants: trial.length, monthly: totalMonthly(trial) },
    suspended: { tenants: suspended.length, monthly: totalMonthly(suspended) },
    unpriced: tenants.filter((tenant) => monthlyFor(tenant) === null).length,
  }
}

/** A plan's share of MRR, 0–1. Zero when there is no MRR to take a share of. */
export function share(monthly: number, mrr: number): number {
  return mrr > 0 ? monthly / mrr : 0
}

/** `0.28` → `28%`. Whole numbers: a share to the decimal implies a precision the prices do not have. */
export function formatShare(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/* -------------------------------------------------------------------------- */
/* What is about to be charged                                                */
/* -------------------------------------------------------------------------- */

export type ChargeKind = 'renewal' | 'first-charge'

export type UpcomingCharge = {
  tenantId: string
  tenantName: string
  planId: string
  /** Null when the catalogue cannot price the plan. */
  amount: number | null
  at: string
  kind: ChargeKind
}

/**
 * The next charge for one account, counted from the day it signed up.
 *
 * There is no billing service holding a schedule, so the cycle is derived from
 * the signup date on the same 30-day cycle the invoice history uses. Always
 * strictly in the future — an account whose anniversary is today has already
 * been charged for the period that just closed.
 */
export function nextRenewal(tenant: Pick<Tenant, 'createdAt'>, now = Date.now()): string | null {
  const start = Date.parse(tenant.createdAt)
  if (Number.isNaN(start)) return null

  const cycle = CYCLE_DAYS * DAY_MS
  const elapsed = Math.max(0, now - start)
  return new Date(start + (Math.floor(elapsed / cycle) + 1) * cycle).toISOString()
}

/**
 * What is about to be charged, derived rather than fetched.
 *
 * A trial's first charge is its trial end date, and it is marked as a first
 * charge rather than a renewal because it depends on somebody converting. It is
 * not revenue yet, and a page that added it to MRR would be forecasting.
 *
 * Suspended accounts are absent: nothing renews while access is cut.
 */
export function upcomingCharges(
  tenants: Tenant[],
  withinDays = 14,
  now = Date.now(),
): UpcomingCharge[] {
  const horizon = now + withinDays * DAY_MS

  const charges = tenants.flatMap((tenant): UpcomingCharge[] => {
    if (tenant.status === 'suspended') return []

    const at = tenant.status === 'trial' ? tenant.trialEndsAt : nextRenewal(tenant, now)
    if (!at) return []

    const when = Date.parse(at)
    if (Number.isNaN(when) || when < now || when > horizon) return []

    return [
      {
        tenantId: tenant.id,
        tenantName: tenant.name,
        planId: tenant.planId,
        amount: monthlyFor(tenant),
        at,
        kind: tenant.status === 'trial' ? 'first-charge' : 'renewal',
      },
    ]
  })

  return charges.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/* -------------------------------------------------------------------------- */
/* Plan changes                                                               */
/* -------------------------------------------------------------------------- */

export type ChangeKind = 'upgrade' | 'downgrade' | 'cancellation'

/**
 * What a plan change was, read off the catalogue rather than stored on the
 * record. Null when the catalogue cannot compare the two ends — an unknown plan
 * id is shown as a plain change rather than guessed at a direction.
 */
export function changeKind(fromPlanId: string, toPlanId: string | null): ChangeKind | null {
  if (toPlanId === null) return 'cancellation'

  const from = planById(fromPlanId)?.monthly
  const to = planById(toPlanId)?.monthly
  if (from === undefined || to === undefined || from === to) return null

  return to > from ? 'upgrade' : 'downgrade'
}

/** What the change did to MRR. Null when either end cannot be priced. */
export function changeDelta(fromPlanId: string, toPlanId: string | null): number | null {
  const from = planById(fromPlanId)?.monthly
  if (from === undefined) return null
  if (toPlanId === null) return -from

  const to = planById(toPlanId)?.monthly
  return to === undefined ? null : to - from
}

/** A signed amount. `formatPrice` covers everywhere the sign is not the point. */
export function formatDelta(delta: number): string {
  return delta >= 0 ? `+${formatPrice(delta)}` : `-${formatPrice(Math.abs(delta))}`
}
