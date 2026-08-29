export type AccountType = 'home' | 'org'

export const ORG_TYPES = ['Office', 'Retail', 'Warehouse', 'School', 'Other'] as const
export type OrgType = (typeof ORG_TYPES)[number]

export type Plan = {
  id: string
  name: string
  audience: AccountType
  /** One total, billed monthly. Hardware is folded in, never priced separately. */
  monthly: number
  maxCameras: number
  maxUsers: number
  summary: string
  includes: string[]
}

/**
 * The Detecto Box is part of every plan. It is listed inside `includes` as a
 * detail of what arrives — never broken out as its own line item, because the
 * customer is choosing a plan, not evaluating a hardware purchase.
 */
export const PLANS: Plan[] = [
  {
    id: 'home',
    name: 'Home',
    audience: 'home',
    monthly: 39,
    maxCameras: 4,
    maxUsers: 1,
    summary: 'One property, up to four cameras.',
    includes: [
      'Detecto Box (one-time setup)',
      'Weapon and violence detection',
      'Up to 4 cameras',
      'Alerts on your phone, confirmed by you before anything escalates',
    ],
  },
  {
    id: 'home-extended',
    name: 'Home Extended',
    audience: 'home',
    monthly: 69,
    maxCameras: 12,
    maxUsers: 3,
    summary: 'Larger property, or more than one building.',
    includes: [
      'Detecto Box (one-time setup)',
      'Weapon and violence detection',
      'Up to 12 cameras',
      'Up to 3 people on the account',
      '30-day clip history',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    audience: 'org',
    monthly: 180,
    maxCameras: 16,
    maxUsers: 10,
    summary: 'A single site with a small security team.',
    includes: [
      'Detecto Box (one-time setup)',
      'Weapon and violence detection',
      'Up to 16 cameras',
      'Up to 10 people, each with their own permissions',
      'Audit trail on every confirmation',
    ],
  },
  {
    id: 'site',
    name: 'Site',
    audience: 'org',
    monthly: 420,
    maxCameras: 48,
    maxUsers: 40,
    summary: 'A full site, or several buildings under one operation.',
    includes: [
      'Detecto Box (one-time setup)',
      'Weapon and violence detection',
      'Up to 48 cameras',
      'Up to 40 people, each with their own permissions',
      'Audit trail on every confirmation',
      '90-day clip history',
    ],
  },
  {
    id: 'estate',
    name: 'Estate',
    audience: 'org',
    monthly: 960,
    maxCameras: 120,
    maxUsers: 200,
    summary: 'Multiple sites under central operations.',
    includes: [
      'Detecto Box (one-time setup)',
      'Weapon and violence detection',
      'Up to 120 cameras',
      'Up to 200 people, each with their own permissions',
      'Audit trail on every confirmation',
      '90-day clip history',
      'Named contact for deployment',
    ],
  },
]

export function plansFor(audience: AccountType) {
  return PLANS.filter((plan) => plan.audience === audience)
}

export function planById(id: string) {
  return PLANS.find((plan) => plan.id === id)
}

export type Recommendation = {
  plan: Plan
  /** True when the estimate exceeds even the largest plan for this audience. */
  overCapacity: boolean
}

/** Smallest plan that covers both the camera and the people estimate. */
export function recommendPlan(
  audience: AccountType,
  cameras: number,
  users: number,
): Recommendation {
  const candidates = plansFor(audience)
  const fit = candidates.find(
    (plan) => cameras <= plan.maxCameras && users <= plan.maxUsers,
  )
  const largest = candidates[candidates.length - 1]
  return { plan: fit ?? largest, overCapacity: !fit }
}

export function formatPrice(monthly: number) {
  return `$${monthly.toLocaleString('en-US')}`
}
