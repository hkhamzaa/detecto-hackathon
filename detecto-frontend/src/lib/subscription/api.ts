import { USE_MOCKS } from '@/lib/config/mocks'
import { INVOICE_STATUSES, type Invoice } from '@/lib/invoice'
import { planById, type AccountType } from '@/lib/plans'
import { useAuthStore } from '@/store/auth-store'

/**
 * One organisation's own subscription.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CUSTOMER-FACING COUNTERPART TO `lib/billing`, AND NOT THE SAME THING
 *
 * `lib/billing/api.ts` is the platform's revenue view: every account's ledger,
 * read by Detecto's own staff. This is one customer's view of their own plan,
 * their own cameras against its limits, and their own invoices. The two never
 * import each other, in either direction — the same area isolation the tenant
 * registry, the module flags and the alert modules all hold, and for the same
 * reason: a page that cannot reach another organisation's data cannot leak it.
 *
 * Everything here is scoped by the session on the server. There is no `orgId`
 * parameter on any function below and there is not going to be one: an endpoint
 * that took one would be an endpoint somebody could pass a different one to.
 *
 * The shape of an invoice is shared, because two surfaces showing a customer's
 * unpaid bill must not word it differently — see `lib/invoice.ts`. A shared
 * *type* is not a shared transport, and nothing about this module can reach the
 * tenant registry.
 *
 * NO PAYMENT PROCESSOR IS CONNECTED
 *
 * There is no Stripe, no merchant account and no `/api/org/subscription`
 * behind this build. Signup collects card details into a browser store and
 * charges nothing; nothing in the product has ever taken a payment. So this
 * module offers no way to update a card, no checkout, and no function that
 * completes a plan change — `requestPlanChange` records an intent and says so
 * in its name. The page says the same thing where somebody would look for the
 * button, which is the same decision the platform billing page made about
 * retrying a failed charge.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type SubscriptionStatus = 'active' | 'trial' | 'suspended'

/**
 * A plan change the organisation has asked for.
 *
 * `'requested'` is the only status, deliberately. There is no processor to take
 * a payment and no pipeline to move this along, so `'approved'`, `'scheduled'`
 * and `'active'` would be states nothing in the product could ever put it into
 * — a status field whose other values are unreachable is a promise the
 * interface would make on the backend's behalf.
 */
export type PlanChangeRequest = {
  planId: string
  requestedAt: string
  status: 'requested'
}

export type Subscription = {
  planId: string
  /** Which half of the catalogue this account is on. Decides what it can move to. */
  accountType: AccountType
  status: SubscriptionStatus
  /** When the trial ends. Null for anything not on trial. */
  trialEndsAt: string | null
  /** The next period close. What the plan renews on, not what it costs. */
  renewsAt: string
  /** Where invoices are sent. The account's own contact, never anybody else's. */
  billingEmail: string
  /** Most recent first. */
  invoices: Invoice[]
  /** An outstanding request to move plans, or null. */
  pendingChange: PlanChangeRequest | null
}

export type SubscriptionResult =
  | { ok: true; subscription: Subscription }
  | { ok: false; code: 'unavailable' }

export type ChangeResult =
  | { ok: true; subscription: Subscription }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unknown_plan' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getSubscription(): Promise<SubscriptionResult> {
  return USE_MOCKS ? mockGet() : realGet()
}

/**
 * Asks to move plans. Does not move plans.
 *
 * Named for what it does. There is no payment integration, so nothing here can
 * take the money a bigger plan costs or refund the difference on a smaller one,
 * and a function called `changePlan` would have been a lie in the call site as
 * well as on the screen. What this records is an intent for somebody at Detecto
 * to pick up.
 */
export function requestPlanChange(planId: string): Promise<ChangeResult> {
  return USE_MOCKS ? mockRequest(planId) : realRequest(planId)
}

/**
 * Takes the request back.
 *
 * Offered because it can be honoured: withdrawing something nobody has acted on
 * needs no processor. The asymmetry is the point — an organisation can undo
 * every action this page actually performs.
 */
export function withdrawPlanChange(): Promise<ChangeResult> {
  return USE_MOCKS ? mockWithdraw() : realWithdraw()
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

function toInvoice(value: unknown): Invoice | null {
  if (typeof value !== 'object' || value === null) return null
  const i = value as Record<string, unknown>

  const id = str(i.id)
  const periodEnd = str(i.periodEnd)
  const status = str(i.status)
  if (!id || !periodEnd || !status || !INVOICE_STATUSES.includes(status)) return null

  return { id, periodEnd, amount: num(i.amount), status: status as Invoice['status'] }
}

function toRequest(value: unknown): PlanChangeRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>

  const planId = str(r.planId)
  const requestedAt = str(r.requestedAt)
  if (!planId || !requestedAt) return null

  return { planId, requestedAt, status: 'requested' }
}

const STATUSES: string[] = ['active', 'trial', 'suspended']

function toSubscription(payload: Record<string, unknown> | null): Subscription | null {
  if (!payload) return null

  const planId = str(payload.planId)
  const status = str(payload.status)
  const renewsAt = str(payload.renewsAt)
  if (!planId || !renewsAt || !status || !STATUSES.includes(status)) return null

  return {
    planId,
    accountType: payload.accountType === 'home' ? 'home' : 'org',
    status: status as SubscriptionStatus,
    trialEndsAt: str(payload.trialEndsAt),
    renewsAt,
    billingEmail: str(payload.billingEmail) ?? '',
    invoices: (Array.isArray(payload.invoices) ? payload.invoices : [])
      .map(toInvoice)
      .filter((invoice): invoice is Invoice => invoice !== null)
      .sort((a, b) => Date.parse(b.periodEnd) - Date.parse(a.periodEnd)),
    pendingChange: toRequest(payload.pendingChange),
  }
}

async function realGet(): Promise<SubscriptionResult> {
  let response: Response
  try {
    // No org id in the path. The session decides whose subscription this is;
    // an endpoint that took one would be one somebody could pass another to.
    response = await fetch('/api/org/subscription', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const subscription = toSubscription(await readObject(response))
  return subscription
    ? { ok: true, subscription }
    : { ok: false, code: 'unavailable' }
}

async function realWrite(init: RequestInit): Promise<ChangeResult> {
  let response: Response
  try {
    response = await fetch('/api/org/subscription/plan-change', {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      ...init,
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  // Checked on the server as well as here. The disabled control is a courtesy;
  // this is the answer that counts.
  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (response.status === 422) return { ok: false, code: 'unknown_plan' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const subscription = toSubscription(await readObject(response))
  return subscription
    ? { ok: true, subscription }
    : { ok: false, code: 'unavailable' }
}

function realRequest(planId: string): Promise<ChangeResult> {
  return realWrite({ method: 'POST', body: JSON.stringify({ planId }) })
}

function realWithdraw(): Promise<ChangeResult> {
  return realWrite({ method: 'DELETE' })
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/org/subscription is live                       */
/* -------------------------------------------------------------------------- */

/**
 * One established organisation on the Site plan.
 *
 * ⚠ Every amount below is the plan's price from `lib/plans.ts`, which is a
 * placeholder catalogue nobody has signed off — the same warning the module
 * flags page and the platform billing page carry about the same numbers. An
 * invoice history multiplied out of a provisional price is a provisional
 * invoice history, and the page says so above the table.
 *
 * The most recent invoice is unpaid and inside its terms, because "due" is the
 * ordinary state of the invoice at the top of a real billing page and the one
 * the customer-facing copy has to get right. Nothing here is overdue: an
 * organisation being chased is a state the platform page draws, not one to
 * seed into every demo of a customer's own account.
 */
const MOCK_PLAN = 'site'
const MOCK_PERIODS = 6
const DAY = 86_400_000
const CYCLE_DAYS = 30
const MOCK_DELAY = { read: 400, write: 600 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let store: Subscription | null = null

function seed(): Subscription {
  const monthly = planById(MOCK_PLAN)?.monthly ?? 0
  const now = Date.now()
  // The last period closed a few days ago rather than this instant, so the
  // renewal date is a real date in the future rather than "now plus a month".
  const lastClose = now - 4 * DAY

  const invoices: Invoice[] = Array.from({ length: MOCK_PERIODS }, (_, index) => ({
    id: `INV-${String(MOCK_PERIODS - index).padStart(4, '0')}`,
    periodEnd: new Date(lastClose - index * CYCLE_DAYS * DAY).toISOString(),
    amount: monthly,
    // Only the most recent can be outstanding. A gap in the middle of a payment
    // history would be a billing bug, not a demo state.
    status: index === 0 ? 'due' : 'paid',
  }))

  return {
    planId: MOCK_PLAN,
    accountType: 'org',
    status: 'active',
    trialEndsAt: null,
    renewsAt: new Date(lastClose + CYCLE_DAYS * DAY).toISOString(),
    // Whoever is signed in. A billing page showing somebody else's contact
    // would be the first thing wrong with it.
    billingEmail: useAuthStore.getState().claims?.email ?? 'billing@example.com',
    invoices,
    pendingChange: null,
  }
}

function subscription(): Subscription {
  store ??= seed()
  return store
}

/** A copy, so a caller holding the result cannot write through it. */
function snapshot(): Subscription {
  const current = subscription()
  return {
    ...current,
    invoices: current.invoices.map((invoice) => ({ ...invoice })),
    pendingChange: current.pendingChange ? { ...current.pendingChange } : null,
  }
}

async function mockGet(): Promise<SubscriptionResult> {
  await wait(MOCK_DELAY.read)
  return { ok: true, subscription: snapshot() }
}

async function mockRequest(planId: string): Promise<ChangeResult> {
  await wait(MOCK_DELAY.write)

  const plan = planById(planId)
  const current = subscription()
  // A plan the catalogue has never heard of, or one from the other half of it.
  // The backend refuses both, whatever the browser sent.
  if (!plan || plan.audience !== current.accountType) {
    return { ok: false, code: 'unknown_plan' }
  }
  if (planId === current.planId) return { ok: false, code: 'unknown_plan' }

  current.pendingChange = {
    planId,
    requestedAt: new Date().toISOString(),
    status: 'requested',
  }
  // Note what does *not* happen: `planId` is untouched, no invoice is raised,
  // and nothing is charged. The request is the whole of it.
  return { ok: true, subscription: snapshot() }
}

async function mockWithdraw(): Promise<ChangeResult> {
  await wait(MOCK_DELAY.write)
  subscription().pendingChange = null
  return { ok: true, subscription: snapshot() }
}
