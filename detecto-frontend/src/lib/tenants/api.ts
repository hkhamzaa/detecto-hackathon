import { USE_MOCKS } from '@/lib/config/mocks'
import { INVOICE_STATUSES, type Invoice, type InvoiceStatus } from '@/lib/invoice'
import type { AccountType } from '@/lib/plans'
import { planById } from '@/lib/plans'
import { useAuthStore } from '@/store/auth-store'

/**
 * The tenant registry, and the platform rollup above it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BOUNDARY THIS FILE EXISTS TO HOLD
 *
 * A super admin runs the platform. They do not get to watch the customer's
 * cameras. Nothing in this module returns, references, or can be persuaded to
 * return a camera, a stream, a detection, a clip, or a zone name — and that is
 * a property of the *types*, not of the components that draw them. `Tenant` has
 * `cameraCount`, a number. There is no `cameras` field to accidentally render,
 * no alert list to accidentally page through, and no endpoint here that would
 * accept a request for one.
 *
 * The same rule applies to people. A tenant carries `userCount` and a single
 * `adminEmail` — the account contact, which is billing information — and never
 * the org's user directory. Who works for a customer is the customer's business.
 *
 * `alertsThisWeek` on the summary is an aggregate produced by the backend's own
 * metrics rollup. It is deliberately a scalar. It must never be computed by
 * reading alert rows, here or anywhere else: the moment a count is derived by
 * fetching the records behind it, the records are in the browser and the
 * boundary is gone. See the note over `mockSummary`.
 *
 * Impersonation — "view as this tenant" — is not here and is not coming in this
 * pass. The claims system puts a person in exactly one area on purpose; a
 * super admin borrowing an org's session would defeat the isolation the whole
 * routing model is built on.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type TenantStatus = 'active' | 'trial' | 'suspended'

export type Tenant = {
  id: string
  name: string
  /** A plan id from `lib/plans.ts`. Unknown ids are shown as-is, never guessed at. */
  planId: string
  accountType: AccountType
  status: TenantStatus
  /** How many cameras they have connected. A count. Not the cameras. */
  cameraCount: number
  /** Detecto Boxes paired to the account. A count. */
  boxCount: number
  /** How many people are on the account. A count, never the directory. */
  userCount: number
  createdAt: string
  /** The account contact — billing-level, not the org's user list. */
  adminEmail: string
  /** When the trial runs out. Null for anything not on trial. */
  trialEndsAt: string | null
  suspendedAt: string | null
  /** Internal support context. Super admin only; the tenant never sees it. */
  note: string
}

/**
 * Re-exported so existing importers keep one place to reach for it. The shape
 * itself lives in `lib/invoice.ts`, shared with the organisation's own billing
 * page — see the note there. Neither area imports the other's transport.
 */
export type { Invoice, InvoiceStatus } from '@/lib/invoice'

/** The list record plus the account-level history. Still no tenant content. */
export type TenantDetail = Tenant & {
  billing: {
    /** Recurring monthly, as billed. */
    monthly: number
    /** Everything invoiced to date, paid or not. */
    totalBilled: number
    /** Most recent first. A summary — the full ledger lives in Billing. */
    invoices: Invoice[]
  }
}

export type PlatformSummary = {
  tenants: {
    total: number
    active: number
    trial: number
    suspended: number
  }
  /** Cameras connected across every tenant. A sum of counts. */
  cameras: number
  /** Aggregate only. See the note at the top of this file. */
  alertsThisWeek: number
  alertsLastWeek: number
  /** Boxes reporting in, as a rollup. No tenant is named. */
  health: {
    boxesReporting: number
    boxesSilent: number
    /** When the rollup was last computed by the backend. */
    checkedAt: string
  }
  /** The last few accounts to sign up. Name, plan and date — nothing else. */
  recentSignups: Pick<Tenant, 'id' | 'name' | 'planId' | 'status' | 'createdAt'>[]
}

export type SummaryResult =
  | { ok: true; summary: PlatformSummary }
  | { ok: false; code: 'unavailable' }

export type TenantsResult =
  | { ok: true; tenants: Tenant[] }
  | { ok: false; code: 'unavailable' }

export type TenantResult =
  | { ok: true; tenant: TenantDetail }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'unavailable' }

export type TenantWriteResult =
  | { ok: true; tenant: TenantDetail }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getPlatformSummary(): Promise<SummaryResult> {
  return USE_MOCKS ? mockSummary() : realSummary()
}

export function listTenants(): Promise<TenantsResult> {
  return USE_MOCKS ? mockList() : realList()
}

export function getTenant(id: string): Promise<TenantResult> {
  return USE_MOCKS ? mockGet(id) : realGet(id)
}

/**
 * Suspend or reactivate an account.
 *
 * `'trial'` is not settable: a trial is a state an account arrives in, and
 * putting one back into it by hand would rewrite how it is being billed. The
 * only two transitions a support decision makes are off and on again.
 */
export function setTenantStatus(
  id: string,
  status: Extract<TenantStatus, 'active' | 'suspended'>,
): Promise<TenantWriteResult> {
  return USE_MOCKS ? mockPatch(id, { status }) : realPatch(id, { status })
}

export function setTenantNote(id: string, note: string): Promise<TenantWriteResult> {
  return USE_MOCKS ? mockPatch(id, { note }) : realPatch(id, { note })
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

const STATUSES: string[] = ['active', 'trial', 'suspended']

function toTenant(value: unknown): Tenant | null {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>

  const id = str(t.id)
  const name = str(t.name)
  const status = str(t.status)
  const createdAt = str(t.createdAt)
  if (!id || !name || !createdAt || !status || !STATUSES.includes(status)) return null

  return {
    id,
    name,
    planId: str(t.planId) ?? '',
    accountType: t.accountType === 'home' ? 'home' : 'org',
    status: status as TenantStatus,
    cameraCount: num(t.cameraCount),
    boxCount: num(t.boxCount),
    userCount: num(t.userCount),
    createdAt,
    adminEmail: str(t.adminEmail) ?? '',
    trialEndsAt: str(t.trialEndsAt),
    suspendedAt: str(t.suspendedAt),
    note: typeof t.note === 'string' ? t.note : '',
  }
}

function toInvoice(value: unknown): Invoice | null {
  if (typeof value !== 'object' || value === null) return null
  const i = value as Record<string, unknown>

  const id = str(i.id)
  const periodEnd = str(i.periodEnd)
  const status = str(i.status)
  if (!id || !periodEnd || !status || !INVOICE_STATUSES.includes(status)) return null

  return { id, periodEnd, amount: num(i.amount), status: status as InvoiceStatus }
}

function toDetail(value: unknown): TenantDetail | null {
  const tenant = toTenant(value)
  if (!tenant) return null

  const billing = (value as Record<string, unknown>).billing
  const b = typeof billing === 'object' && billing !== null
    ? (billing as Record<string, unknown>)
    : {}

  return {
    ...tenant,
    billing: {
      monthly: num(b.monthly),
      totalBilled: num(b.totalBilled),
      invoices: (Array.isArray(b.invoices) ? b.invoices : [])
        .map(toInvoice)
        .filter((invoice): invoice is Invoice => invoice !== null),
    },
  }
}

async function realSummary(): Promise<SummaryResult> {
  let response: Response
  try {
    response = await fetch('/api/admin/summary', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }

  const tenants = typeof payload.tenants === 'object' && payload.tenants !== null
    ? (payload.tenants as Record<string, unknown>)
    : {}
  const health = typeof payload.health === 'object' && payload.health !== null
    ? (payload.health as Record<string, unknown>)
    : {}

  return {
    ok: true,
    summary: {
      tenants: {
        total: num(tenants.total),
        active: num(tenants.active),
        trial: num(tenants.trial),
        suspended: num(tenants.suspended),
      },
      cameras: num(payload.cameras),
      alertsThisWeek: num(payload.alertsThisWeek),
      alertsLastWeek: num(payload.alertsLastWeek),
      health: {
        boxesReporting: num(health.boxesReporting),
        boxesSilent: num(health.boxesSilent),
        checkedAt: str(health.checkedAt) ?? new Date().toISOString(),
      },
      recentSignups: (Array.isArray(payload.recentSignups) ? payload.recentSignups : [])
        .map(toTenant)
        .filter((tenant): tenant is Tenant => tenant !== null),
    },
  }
}

async function realList(): Promise<TenantsResult> {
  let response: Response
  try {
    response = await fetch('/api/admin/tenants', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload || !Array.isArray(payload.tenants)) {
    return { ok: false, code: 'unavailable' }
  }
  return {
    ok: true,
    tenants: payload.tenants
      .map(toTenant)
      .filter((tenant): tenant is Tenant => tenant !== null),
  }
}

async function realGet(id: string): Promise<TenantResult> {
  let response: Response
  try {
    response = await fetch(`/api/admin/tenants/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (response.status === 404) return { ok: false, code: 'not_found' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const tenant = toDetail(await readObject(response))
  return tenant ? { ok: true, tenant } : { ok: false, code: 'unavailable' }
}

async function realPatch(
  id: string,
  patch: Partial<Pick<Tenant, 'status' | 'note'>>,
): Promise<TenantWriteResult> {
  let response: Response
  try {
    response = await fetch(`/api/admin/tenants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  // Suspending a paying customer is checked on the server as well as here. The
  // disabled button is a courtesy; this is the answer that counts.
  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const tenant = toDetail(await readObject(response))
  return tenant ? { ok: true, tenant } : { ok: false, code: 'unavailable' }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/admin is live                                  */
/* -------------------------------------------------------------------------- */

/**
 * Nine accounts, chosen so every state on both pages is reachable without
 * setting anything up: three plan tiers on each audience, a trial with a week
 * left and one down to two days, a suspension that already has a support note
 * on it, accounts with an unpaid invoice, and one that has connected no
 * cameras at all since signing up.
 */
const DAY = 86_400_000

const SEEDS: {
  id: string
  name: string
  planId: string
  accountType: AccountType
  status: TenantStatus
  cameraCount: number
  boxCount: number
  userCount: number
  daysAgo: number
  adminEmail: string
  /** Days from now until the trial ends. Only read for `trial`. */
  trialInDays?: number
  /** Days ago the account was suspended. Only read for `suspended`. */
  suspendedDaysAgo?: number
  note?: string
}[] = [
  {
    id: 'ten_northgate',
    name: 'Northgate Logistics',
    planId: 'estate',
    accountType: 'org',
    status: 'active',
    cameraCount: 96,
    boxCount: 7,
    userCount: 34,
    daysAgo: 412,
    adminEmail: 'admin@northgate.com',
  },
  {
    id: 'ten_halden',
    name: 'Halden Retail Group',
    planId: 'site',
    accountType: 'org',
    status: 'active',
    cameraCount: 44,
    boxCount: 3,
    userCount: 18,
    daysAgo: 260,
    adminEmail: 'security@haldenretail.com',
    note: 'Running close to the 48-camera ceiling. Upgrade conversation opened 3 weeks ago, no answer yet.',
  },
  {
    id: 'ten_priory',
    name: 'Priory Park School',
    planId: 'team',
    accountType: 'org',
    status: 'active',
    cameraCount: 14,
    boxCount: 1,
    userCount: 6,
    daysAgo: 138,
    adminEmail: 'j.okonkwo@prioryparkschool.org',
  },
  {
    id: 'ten_castleford',
    name: 'Castleford Works',
    planId: 'site',
    accountType: 'org',
    status: 'suspended',
    cameraCount: 31,
    boxCount: 2,
    userCount: 11,
    daysAgo: 322,
    adminEmail: 'ops@castlefordworks.co.uk',
    suspendedDaysAgo: 9,
    note: 'Suspended after three failed payments and no reply on the billing contact. Finance said they are changing banks — check back before the 30-day retention window closes.',
  },
  {
    id: 'ten_verity',
    name: 'Verity Cold Storage',
    planId: 'team',
    accountType: 'org',
    status: 'trial',
    cameraCount: 9,
    boxCount: 1,
    userCount: 3,
    daysAgo: 7,
    adminEmail: 'dmoreau@veritycold.com',
    trialInDays: 7,
  },
  {
    id: 'ten_ashfield',
    name: 'Ashfield Community Trust',
    planId: 'team',
    accountType: 'org',
    status: 'trial',
    cameraCount: 0,
    boxCount: 1,
    userCount: 1,
    daysAgo: 12,
    adminEmail: 'p.ferreira@ashfieldtrust.org',
    trialInDays: 2,
    note: 'Box shipped and paired, no cameras added yet. Worth a call before the trial runs out.',
  },
  {
    id: 'ten_okonjo',
    name: 'Okonjo Residence',
    planId: 'home-extended',
    accountType: 'home',
    status: 'active',
    cameraCount: 11,
    boxCount: 1,
    userCount: 3,
    daysAgo: 195,
    adminEmail: 'a.okonjo@fastmail.com',
  },
  {
    id: 'ten_lindqvist',
    name: 'Lindqvist Residence',
    planId: 'home',
    accountType: 'home',
    status: 'active',
    cameraCount: 4,
    boxCount: 1,
    userCount: 1,
    daysAgo: 63,
    adminEmail: 'marta.lindqvist@proton.me',
  },
  {
    id: 'ten_barrow',
    name: 'Barrow Street Pharmacy',
    planId: 'team',
    accountType: 'org',
    status: 'active',
    cameraCount: 6,
    boxCount: 1,
    userCount: 4,
    daysAgo: 21,
    adminEmail: 'owner@barrowstreetrx.com',
  },
]

const MOCK_DELAY = { read: 450, write: 650 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Built once per session, then mutated by writes like a real store would be. */
let store: Tenant[] | null = null

function tenants(): Tenant[] {
  store ??= SEEDS.map((seed) => {
    const now = Date.now()
    return {
      id: seed.id,
      name: seed.name,
      planId: seed.planId,
      accountType: seed.accountType,
      status: seed.status,
      cameraCount: seed.cameraCount,
      boxCount: seed.boxCount,
      userCount: seed.userCount,
      createdAt: new Date(now - seed.daysAgo * DAY).toISOString(),
      adminEmail: seed.adminEmail,
      trialEndsAt:
        seed.status === 'trial' && seed.trialInDays !== undefined
          ? new Date(now + seed.trialInDays * DAY).toISOString()
          : null,
      suspendedAt:
        seed.status === 'suspended' && seed.suspendedDaysAgo !== undefined
          ? new Date(now - seed.suspendedDaysAgo * DAY).toISOString()
          : null,
      note: seed.note ?? '',
    }
  })
  return store
}

export type MockUnpaid = {
  status: Extract<InvoiceStatus, 'due' | 'failed'>
  /**
   * Days ago the period this invoice covers closed. It shifts the account's
   * whole history back by the same amount, so the unpaid invoice has a real
   * age: an invoice dated to the instant somebody opened the page could never
   * be past due, and the billing page has to count from something.
   */
  periodClosedDaysAgo: number
}

/**
 * The accounts carrying an unpaid invoice, and how old it is.
 *
 * Exported for the billing mock, for the same reason `MOCK_BOXES_SILENT` is
 * exported for the health mock. The tenant detail page and the platform billing
 * page are two views of one ledger, and a demo where they disagree about who
 * owes money would undermine the only figures on either page that mean somebody
 * should pick up the phone. Both are dev mocks; they are deleted together.
 */
export const MOCK_UNPAID: Record<string, MockUnpaid> = {
  // Declined three times, then suspended. Long past due.
  ten_castleford: { status: 'failed', periodClosedDaysAgo: 44 },
  // Declined, but still inside its payment terms. Recoverable.
  ten_priory: { status: 'failed', periodClosedDaysAgo: 8 },
  // Issued, never attempted, now overdue — past due without a decline.
  ten_lindqvist: { status: 'due', periodClosedDaysAgo: 26 },
}

/**
 * The billing summary for one account, derived from its plan and its age.
 *
 * Up to six months back, or fewer for an account younger than that — an
 * invoice history that predates the signup date would be an obvious fiction on
 * the one page where a support engineer is checking exactly that.
 */
function billingFor(tenant: Tenant): TenantDetail['billing'] {
  const monthly = planById(tenant.planId)?.monthly ?? 0
  const unpaid = MOCK_UNPAID[tenant.id]
  const offset = unpaid?.periodClosedDaysAgo ?? 0

  // Counted from the age the periods actually span, so the offset can never
  // push the oldest invoice back past the signup date.
  const age = Date.now() - Date.parse(tenant.createdAt)
  const count = Math.max(0, Math.min(6, Math.floor((age - offset * DAY) / (30 * DAY))))

  const invoices: Invoice[] = Array.from({ length: count }, (_, index) => {
    const periodEnd = new Date(Date.now() - (index * 30 + offset) * DAY)
    return {
      id: `INV-${tenant.id.slice(4, 8).toUpperCase()}-${String(count - index).padStart(3, '0')}`,
      periodEnd: periodEnd.toISOString(),
      amount: monthly,
      // Only the most recent one can be outstanding. An account with a gap in
      // the middle of its history would be a billing bug, not a demo state.
      status: index === 0 ? (unpaid?.status ?? 'paid') : 'paid',
    }
  })

  return {
    monthly,
    totalBilled: invoices.reduce((sum, invoice) => sum + invoice.amount, 0),
    invoices,
  }
}

function detailFor(tenant: Tenant): TenantDetail {
  return { ...tenant, billing: billingFor(tenant) }
}

/**
 * The platform rollup.
 *
 * Note what this does NOT do: it does not import `lib/alerts/api`, and it does
 * not count anything by fetching the records behind it. `alertsThisWeek` is a
 * scalar the backend's metrics pipeline produces, so the mock produces a scalar
 * too. Deriving it here from alert rows would be the easy version and would put
 * a tenant's detections in a super admin's browser, which is the one thing this
 * whole area is built not to do.
 *
 * Camera and tenant counts *are* summed from the registry, because those are
 * account-level facts this file already legitimately holds.
 */
const MOCK_ALERTS_THIS_WEEK = 1_284
const MOCK_ALERTS_LAST_WEEK = 1_147

/**
 * How many boxes have genuinely gone quiet, as opposed to belonging to a
 * suspended account and being quiet on purpose.
 *
 * Exported so the health mock can produce exactly this many silent boxes. The
 * overview's summary line and the system-health page are two views of one fleet,
 * and a demo where they disagree about how many boxes are down would undermine
 * the only number on either page that means somebody should act. Both are dev
 * mocks; they are deleted together.
 */
export const MOCK_BOXES_SILENT = 2

/**
 * Shipped, registered, never once plugged in. Not an outage — an onboarding
 * that stalled — but not reporting either, so it has to come out of the
 * reporting count as well. Exported for the same reason as the constant above.
 */
export const MOCK_BOXES_NEVER_CONNECTED = 1

async function mockSummary(): Promise<SummaryResult> {
  await wait(MOCK_DELAY.read)
  const all = tenants()

  const byStatus = (status: TenantStatus) =>
    all.filter((tenant) => tenant.status === status).length

  // A suspended account's boxes are not reporting, because they are not
  // syncing — that is what suspension does, and the rollup has to agree.
  const liveBoxes = all
    .filter((tenant) => tenant.status !== 'suspended')
    .reduce((sum, tenant) => sum + tenant.boxCount, 0)

  return {
    ok: true,
    summary: {
      tenants: {
        total: all.length,
        active: byStatus('active'),
        trial: byStatus('trial'),
        suspended: byStatus('suspended'),
      },
      cameras: all.reduce((sum, tenant) => sum + tenant.cameraCount, 0),
      alertsThisWeek: MOCK_ALERTS_THIS_WEEK,
      alertsLastWeek: MOCK_ALERTS_LAST_WEEK,
      health: {
        // A box that never connected is not reporting either, so it comes out
        // of this count as well as the silent ones. The system-health page
        // shows the three states separately; this line only needs the split
        // between talking and not.
        boxesReporting: Math.max(
          0,
          liveBoxes - MOCK_BOXES_SILENT - MOCK_BOXES_NEVER_CONNECTED,
        ),
        boxesSilent: MOCK_BOXES_SILENT,
        checkedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      },
      recentSignups: [...all]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 4)
        .map(({ id, name, planId, status, createdAt }) => ({
          id,
          name,
          planId,
          status,
          createdAt,
        })),
    },
  }
}

async function mockList(): Promise<TenantsResult> {
  await wait(MOCK_DELAY.read)
  return { ok: true, tenants: tenants().slice() }
}

async function mockGet(id: string): Promise<TenantResult> {
  await wait(MOCK_DELAY.read)
  const tenant = tenants().find((item) => item.id === id)
  return tenant ? { ok: true, tenant: detailFor(tenant) } : { ok: false, code: 'not_found' }
}

async function mockPatch(
  id: string,
  patch: Partial<Pick<Tenant, 'status' | 'note'>>,
): Promise<TenantWriteResult> {
  await wait(MOCK_DELAY.write)

  const all = tenants()
  const index = all.findIndex((item) => item.id === id)
  if (index === -1) return { ok: false, code: 'unavailable' }

  const updated: Tenant = {
    ...all[index],
    ...patch,
    // The timestamp is the platform's to set, not the caller's: it is the
    // record of when access was actually cut, and support will be asked.
    suspendedAt:
      patch.status === 'suspended'
        ? new Date().toISOString()
        : patch.status === 'active'
          ? null
          : all[index].suspendedAt,
  }

  // Replaced, not mutated, so the list notices the row changed.
  all[index] = updated
  return { ok: true, tenant: detailFor(updated) }
}
