import { USE_MOCKS } from '@/lib/config/mocks'
import { planById } from '@/lib/plans'
import { listTenants, MOCK_UNPAID, type Tenant } from '@/lib/tenants/api'
import { useAuthStore } from '@/store/auth-store'

/**
 * The ledger: who has not paid, and how subscriptions have moved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME BOUNDARY EVERY PLATFORM SURFACE HOLDS
 *
 * Subscription and payment state only. Nothing here returns, references, or
 * could be persuaded to return a camera, a detection, a clip or a zone — and as
 * in `lib/tenants/api.ts`, that is a property of the types rather than a habit
 * of the components drawing them. There is no field on `Outstanding` or
 * `PlanChange` that could hold one. This is the least contentious boundary on
 * the platform, because money has no natural route into footage; it is written
 * down and tested anyway, because "obviously nobody would" is how the other
 * boundaries would have been lost too.
 *
 * WHAT THIS FILE IS FOR, AND WHAT `revenue.ts` IS FOR
 *
 * The division is what the browser can work out for itself against what only a
 * payment processor could know. Plan assignments and prices are arithmetic, and
 * they live in `lib/billing/revenue.ts`. Whether a charge went through is a
 * fact somebody else holds, and it lives here.
 *
 * NO PROCESSOR IS CONNECTED
 *
 * There is no Stripe, no GoCardless, no merchant account and no `/api/admin/
 * billing` behind this build. The transport below is written against the
 * endpoint that will exist; every value a person sees today comes from the mock
 * at the bottom of the file. That is why this module offers no retry, no
 * refund, no write-off and no dunning control: an action that cannot reach a
 * processor is a button that lies, and the page says so where somebody would go
 * looking for one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** An invoice that has been issued and not paid. */
export type Outstanding = {
  tenantId: string
  tenantName: string
  planId: string
  /** What is owed for the period. */
  amount: number
  /** When payment was due. */
  dueAt: string
  /** Whole days past `dueAt`. Zero while the invoice is still inside its terms. */
  daysPastDue: number
  /** Consecutive declines. Zero for an invoice that was never attempted at all. */
  attempts: number
  /** The processor's own words for the last decline. Null when never attempted. */
  reason: string | null
  lastAttemptAt: string | null
  /** Access already cut over this. A suspended account is not accruing more. */
  suspended: boolean
}

/** One movement between plans. A record of what happened, never a control. */
export type PlanChange = {
  id: string
  tenantId: string
  /**
   * Carried on the record rather than looked up. A cancelled account leaves the
   * registry, and a history that could only name accounts that still exist
   * would quietly drop every cancellation — the entries most worth reading.
   */
  tenantName: string
  fromPlanId: string
  /** Null for a cancellation: there is no plan on the other side of it. */
  toPlanId: string | null
  at: string
}

export type BillingLedger = {
  /** Most past due first. */
  outstanding: Outstanding[]
  /** Most recent first. */
  changes: PlanChange[]
}

export type LedgerResult =
  | { ok: true; ledger: BillingLedger }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Read-only, and the only function this module exports.
 *
 * There is deliberately no `retryPayment`, `refund`, `writeOff` or
 * `applyCredit`. Not because they are hard, but because there is no processor
 * for them to reach — see the note at the top of the file.
 */
export function getBillingLedger(): Promise<LedgerResult> {
  return USE_MOCKS ? mockLedger() : realLedger()
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

function toOutstanding(value: unknown): Outstanding | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>

  const tenantId = str(o.tenantId)
  const tenantName = str(o.tenantName)
  const dueAt = str(o.dueAt)
  if (!tenantId || !tenantName || !dueAt) return null

  return {
    tenantId,
    tenantName,
    planId: str(o.planId) ?? '',
    amount: num(o.amount),
    dueAt,
    // Never negative: an invoice inside its terms is not "minus four days past
    // due", it is simply not past due, and the page branches on that.
    daysPastDue: Math.max(0, num(o.daysPastDue)),
    attempts: Math.max(0, num(o.attempts)),
    reason: str(o.reason),
    lastAttemptAt: str(o.lastAttemptAt),
    suspended: o.suspended === true,
  }
}

function toChange(value: unknown): PlanChange | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>

  const id = str(c.id)
  const tenantName = str(c.tenantName)
  const fromPlanId = str(c.fromPlanId)
  const at = str(c.at)
  if (!id || !tenantName || !fromPlanId || !at) return null

  return {
    id,
    tenantId: str(c.tenantId) ?? '',
    tenantName,
    fromPlanId,
    // Absent and null both mean cancelled. Only a string is a plan.
    toPlanId: str(c.toPlanId),
    at,
  }
}

async function realLedger(): Promise<LedgerResult> {
  let response: Response
  try {
    response = await fetch('/api/admin/billing', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }

  return {
    ok: true,
    ledger: {
      outstanding: (Array.isArray(payload.outstanding) ? payload.outstanding : [])
        .map(toOutstanding)
        .filter((row): row is Outstanding => row !== null)
        .sort((a, b) => b.daysPastDue - a.daysPastDue),
      changes: (Array.isArray(payload.changes) ? payload.changes : [])
        .map(toChange)
        .filter((change): change is PlanChange => change !== null)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/admin/billing is live                          */
/* -------------------------------------------------------------------------- */

const DAY = 86_400_000
const MOCK_DELAY = { read: 400 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Days after a period closes that payment is due.
 *
 * The processor's terms, not this page's to choose — it is here because the
 * mock has to derive a due date from the invoice history in `lib/tenants/api.ts`,
 * and the real endpoint will send `dueAt` outright.
 */
const PAYMENT_TERMS_DAYS = 14

/**
 * What the processor would have recorded against each unpaid invoice.
 *
 * Keyed by the same tenant ids as `MOCK_UNPAID`, which decides *who* is unpaid
 * and how old the invoice is. This adds only what a processor knows and the
 * tenant registry does not: how many times a charge was tried, and what came
 * back. Three states worth drawing differently — declined and suspended,
 * declined and still recoverable, and never attempted at all.
 */
const PROCESSOR: Record<
  string,
  { attempts: number; reason: string | null; lastAttemptDaysAgo: number | null }
> = {
  ten_castleford: {
    attempts: 3,
    reason: 'Card declined by the issuer (do_not_honour)',
    lastAttemptDaysAgo: 11,
  },
  ten_priory: {
    attempts: 2,
    reason: 'Insufficient funds',
    lastAttemptDaysAgo: 2,
  },
  // No card on the account to decline, so nothing was ever tried. Past due all
  // the same, which is the case that makes "failed" and "past due" different
  // questions rather than two words for one thing.
  ten_lindqvist: { attempts: 0, reason: null, lastAttemptDaysAgo: null },
}

/**
 * The plan change history.
 *
 * ⚠ Invented, and the page says so. Nothing in the data model records a plan
 * change: `Tenant` carries a `planId` and no history behind it, and there is no
 * endpoint that would return one. This is a read-only record in a dev mock —
 * the same standing as the tenant registry and the invoice history it sits
 * beside — and it is emphatically not a control surface. That is the line
 * between this and the coupons section that does not exist: a record can be
 * mocked honestly and labelled, whereas a control for data nobody stores would
 * be a promise the product cannot keep.
 *
 * Every entry agrees with the registry as it stands. Northgate is on Estate
 * with 96 cameras, so it could not have stayed on Site's 48-camera ceiling;
 * Castleford is on Site having come down from Estate. The two cancellations
 * name accounts that are no longer in the registry, because that is what
 * cancelling does.
 */
const CHANGES: {
  id: string
  tenantId: string
  tenantName: string
  from: string
  to: string | null
  daysAgo: number
}[] = [
  {
    id: 'chg_0148',
    tenantId: 'ten_marden',
    tenantName: 'Marden Foods',
    from: 'team',
    to: null,
    daysAgo: 24,
  },
  {
    id: 'chg_0139',
    tenantId: 'ten_sandhill',
    tenantName: 'Sandhill Storage',
    from: 'home-extended',
    to: null,
    daysAgo: 40,
  },
  {
    id: 'chg_0121',
    tenantId: 'ten_northgate',
    tenantName: 'Northgate Logistics',
    from: 'site',
    to: 'estate',
    daysAgo: 62,
  },
  {
    id: 'chg_0104',
    tenantId: 'ten_okonjo',
    tenantName: 'Okonjo Residence',
    from: 'home',
    to: 'home-extended',
    daysAgo: 88,
  },
  {
    id: 'chg_0072',
    tenantId: 'ten_castleford',
    tenantName: 'Castleford Works',
    from: 'estate',
    to: 'site',
    daysAgo: 150,
  },
]

/**
 * One unpaid invoice, priced from the plan catalogue.
 *
 * ⚠ The amount is placeholder, like every other figure on the billing page: it
 * is the plan's monthly from `lib/plans.ts`, not something a processor invoiced.
 * The type holds a real amount; the mock has no real amount to put in it.
 */
function outstandingFor(tenant: Tenant, now: number): Outstanding {
  const unpaid = MOCK_UNPAID[tenant.id]
  const processor = PROCESSOR[tenant.id] ?? {
    attempts: 0,
    reason: null,
    lastAttemptDaysAgo: null,
  }

  const periodEnd = now - unpaid.periodClosedDaysAgo * DAY
  const dueAt = periodEnd + PAYMENT_TERMS_DAYS * DAY

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    planId: tenant.planId,
    amount: planById(tenant.planId)?.monthly ?? 0,
    dueAt: new Date(dueAt).toISOString(),
    daysPastDue: Math.max(0, Math.floor((now - dueAt) / DAY)),
    attempts: processor.attempts,
    reason: processor.reason,
    lastAttemptAt:
      processor.lastAttemptDaysAgo === null
        ? null
        : new Date(now - processor.lastAttemptDaysAgo * DAY).toISOString(),
    suspended: tenant.status === 'suspended',
  }
}

async function mockLedger(): Promise<LedgerResult> {
  // Read through the registry's own public surface rather than reaching into
  // its seeds: the names, plans and suspension states on this page have to be
  // the ones the tenants page shows, including any suspension made this session.
  const list = await listTenants()
  if (!list.ok) return { ok: false, code: 'unavailable' }

  await wait(MOCK_DELAY.read)
  const now = Date.now()

  return {
    ok: true,
    ledger: {
      outstanding: list.tenants
        .filter((tenant) => tenant.id in MOCK_UNPAID)
        .map((tenant) => outstandingFor(tenant, now))
        .sort((a, b) => b.daysPastDue - a.daysPastDue),
      changes: [...CHANGES]
        .sort((a, b) => a.daysAgo - b.daysAgo)
        .map((change) => ({
          id: change.id,
          tenantId: change.tenantId,
          tenantName: change.tenantName,
          fromPlanId: change.from,
          toPlanId: change.to,
          at: new Date(now - change.daysAgo * DAY).toISOString(),
        })),
    },
  }
}
