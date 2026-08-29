// From the contract module, not from `lib/modules/api` — that file reaches for
// `lib/cameras/api` to build an organisation's per-camera config, and no
// platform surface may pull a camera module into its bundle.
import { USE_MOCKS } from '@/lib/config/mocks'
import { MOCK_CATALOGUE, type ModuleStatus } from '@/lib/modules/catalogue'
import { useAuthStore } from '@/store/auth-store'

/**
 * The module registry: what exists at all, and which plans include it.
 *
 * The platform-level counterpart to `lib/modules/api.ts`, and deliberately a
 * different thing. That file answers "which of the modules available to me are
 * running on this camera"; this one answers "which modules exist, and who is
 * entitled to them". An org admin turns a module on within what their plan
 * allows. This is where what their plan allows is decided.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME BOUNDARY EVERY PLATFORM SURFACE HOLDS
 *
 * Plan, tier and module configuration only. Nothing here knows or can ask which
 * cameras have a module enabled — that is per-camera state belonging to the
 * organisation that owns the camera, and it is `lib/modules/api.ts`'s business,
 * reached with an org's own session. There is no field on `ModuleFlag` that
 * could hold a camera, and no endpoint here that would return one.
 *
 * WHAT STILL NEEDS WIRING ON THE ORG SIDE
 *
 * `planIds` is authored here and, today, nothing reads it. `getModuleConfig()`
 * returns the whole catalogue to every organisation and gates only on `status`
 * — it never sees the org's plan. Until that endpoint filters the catalogue by
 * the caller's plan, the tier matrix on this page is a statement of intent
 * rather than an enforced entitlement, and it must not be described to anyone
 * as the latter. The same principle `lib/roles/permissions.ts` states about
 * grants applies here: a control that hands out something nothing checks is a
 * lie told with a checkbox.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ModuleFlag = {
  id: string
  name: string
  description: string
  /**
   * The contract's `module_status`. Every other surface reads this field; this
   * is the one that sets it.
   */
  status: ModuleStatus
  /**
   * 0–1, measured on a benchmark. Null for anything not live — a module that
   * has never run has no rate, and a plausible-looking one would be invented.
   */
  falsePositiveRate: number | null
  resourceNote: string | null
  /**
   * Plan ids from `lib/plans.ts` whose subscribers are entitled to this module.
   * See the wiring note above: authored here, not yet enforced org-side.
   */
  planIds: string[]
  /** When it was first switched live. Null while it is still coming soon. */
  liveSince: string | null
}

export type FlagsResult =
  | { ok: true; modules: ModuleFlag[] }
  | { ok: false; code: 'unavailable' }

export type FlagWriteResult =
  | { ok: true; module: ModuleFlag }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function listModuleFlags(): Promise<FlagsResult> {
  return USE_MOCKS ? mockList() : realList()
}

/**
 * Release a module, or pull it back.
 *
 * Going live is the consequential direction: every organisation on an included
 * plan can enable it the moment this returns. Going back to `coming_soon` stops
 * it being offered, and — per the contract — stops new detections from it; it
 * never touches detections a person has already confirmed, because those are a
 * record of a human decision rather than model output.
 */
export function setModuleStatus(
  id: string,
  status: ModuleStatus,
): Promise<FlagWriteResult> {
  return USE_MOCKS ? mockPatch(id, { status }) : realPatch(id, { status })
}

export function setModulePlans(
  id: string,
  planIds: string[],
): Promise<FlagWriteResult> {
  return USE_MOCKS ? mockPatch(id, { planIds }) : realPatch(id, { planIds })
}

/**
 * Record what the benchmark measured.
 *
 * Not a target and not a promise — a property of the model build. The page says
 * so, because a number a person can type is a number a person can wish for.
 */
export function setModuleRate(
  id: string,
  falsePositiveRate: number | null,
): Promise<FlagWriteResult> {
  return USE_MOCKS
    ? mockPatch(id, { falsePositiveRate })
    : realPatch(id, { falsePositiveRate })
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

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/**
 * An unrecognised `module_status` is treated as `coming_soon`, never as `live`
 * — the same reading `lib/modules/api.ts` takes, for the same reason. If the
 * contract grows a third state this build has not heard of, the failure has to
 * fall on the side of offering less.
 */
function toFlag(value: unknown): ModuleFlag | null {
  if (typeof value !== 'object' || value === null) return null
  const m = value as Record<string, unknown>

  const id = str(m.id)
  const name = str(m.name)
  if (!id || !name) return null

  const status: ModuleStatus = m.module_status === 'live' ? 'live' : 'coming_soon'
  const rate = m.false_positive_rate

  return {
    id,
    name,
    description: str(m.description) ?? '',
    status,
    falsePositiveRate: status === 'live' && typeof rate === 'number' ? rate : null,
    resourceNote: str(m.resource_note),
    planIds: Array.isArray(m.plan_ids)
      ? m.plan_ids.filter((plan): plan is string => typeof plan === 'string')
      : [],
    liveSince: str(m.live_since),
  }
}

async function realList(): Promise<FlagsResult> {
  let response: Response
  try {
    response = await fetch('/api/admin/modules', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload || !Array.isArray(payload.modules)) {
    return { ok: false, code: 'unavailable' }
  }
  return {
    ok: true,
    modules: payload.modules
      .map(toFlag)
      .filter((module): module is ModuleFlag => module !== null),
  }
}

async function realPatch(
  id: string,
  patch: Partial<Pick<ModuleFlag, 'status' | 'planIds' | 'falsePositiveRate'>>,
): Promise<FlagWriteResult> {
  let response: Response
  try {
    response = await fetch(`/api/admin/modules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  // Releasing a module to every tenant on a plan is checked on the server as
  // well as here. The disabled control is a courtesy; this is the answer that
  // counts.
  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const module = toFlag(await readObject(response))
  return module ? { ok: true, module } : { ok: false, code: 'unavailable' }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/admin/modules is live                          */
/* -------------------------------------------------------------------------- */

/**
 * Which plans include which modules.
 *
 * ⚠ The plan catalogue in `lib/plans.ts` is placeholder pricing and a
 * placeholder ladder — it has not been signed off commercially, and the tier
 * names and ceilings there are as provisional as the numbers. This mapping
 * inherits all of that. It is here so the matrix on the page has something
 * plausible in it, not because anybody has decided that Loitering belongs to
 * Team and above. Treat every row as a placeholder until the plans themselves
 * are settled.
 *
 * The shape of the guesses is at least consistent: weapon detection is the
 * product, so everyone gets it; heavier or more specialised models climb the
 * ladder.
 */
const PLAN_TIERS: Record<string, string[]> = {
  weapon: ['home', 'home-extended', 'team', 'site', 'estate'],
  violence: ['home-extended', 'team', 'site', 'estate'],
  loitering: ['team', 'site', 'estate'],
  zone_intrusion: ['site', 'estate'],
  theft: ['team', 'site', 'estate'],
  forced_movement: ['estate'],
}

const MOCK_DELAY = { read: 400, write: 650 }
const DAY = 86_400_000

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Built once per session from the same catalogue the org page reads, then
 * mutated by writes like a real store would be.
 *
 * `liveSince` is not on `DetectionModule` — it is platform bookkeeping the org
 * side has no use for — so it is held here and seeded plausibly for whatever is
 * already live.
 */
let store: ModuleFlag[] | null = null

function flags(): ModuleFlag[] {
  store ??= MOCK_CATALOGUE.map((module, index) => ({
    id: module.id,
    name: module.name,
    description: module.description,
    status: module.status,
    falsePositiveRate: module.falsePositiveRate,
    resourceNote: module.resourceNote,
    planIds: PLAN_TIERS[module.id] ?? [],
    liveSince:
      module.status === 'live'
        ? new Date(Date.now() - (180 + index * 45) * DAY).toISOString()
        : null,
  }))
  return store
}

/**
 * Writes the platform's decision back into the catalogue the org page reads.
 *
 * One direction only, which is the real one: the platform sets `module_status`
 * and `false_positive_rate`, and every org surface reads them. Without this the
 * two mocks would drift and the flags page would appear to do nothing, which is
 * the opposite of the point it exists to make.
 */
function syncToCatalogue(flag: ModuleFlag) {
  const module = MOCK_CATALOGUE.find((item) => item.id === flag.id)
  if (!module) return

  module.status = flag.status
  // A module that is not live has no rate, on both sides of the contract.
  module.falsePositiveRate = flag.status === 'live' ? flag.falsePositiveRate : null
}

async function mockList(): Promise<FlagsResult> {
  await wait(MOCK_DELAY.read)
  return { ok: true, modules: flags().map((flag) => ({ ...flag })) }
}

async function mockPatch(
  id: string,
  patch: Partial<Pick<ModuleFlag, 'status' | 'planIds' | 'falsePositiveRate'>>,
): Promise<FlagWriteResult> {
  await wait(MOCK_DELAY.write)

  const all = flags()
  const index = all.findIndex((flag) => flag.id === id)
  if (index === -1) return { ok: false, code: 'unavailable' }

  const current = all[index]
  const status = patch.status ?? current.status

  /*
   * `in` rather than `??`. The rate is nullable, so "clear the rate" and "this
   * patch is not about the rate" both arrive as a falsy value, and `??` would
   * read the first as the second and silently keep the old number.
   */
  const rate = 'falsePositiveRate' in patch
    ? patch.falsePositiveRate
    : current.falsePositiveRate

  const updated: ModuleFlag = {
    ...current,
    ...patch,
    status,
    // Going live stamps the date; coming back off clears it, because the next
    // release is a new one and dating it from the first would misreport how
    // long it has actually been out.
    liveSince:
      status === 'live'
        ? (current.liveSince ?? new Date().toISOString())
        : null,
    // The contract holds on both sides: no rate on anything not live.
    falsePositiveRate: status === 'live' ? (rate ?? null) : null,
  }

  // Replaced, not mutated, so the list notices the row changed.
  all[index] = updated
  syncToCatalogue(updated)

  return { ok: true, module: { ...updated } }
}
