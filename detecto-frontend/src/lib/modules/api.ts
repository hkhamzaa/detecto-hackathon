import { listCameras } from '@/lib/cameras/api'
import { USE_MOCKS } from '@/lib/config/mocks'
import { MOCK_CATALOGUE, type DetectionModule, type ModuleStatus } from '@/lib/modules/catalogue'
import { useAuthStore } from '@/store/auth-store'

/** Re-exported so existing importers keep one place to reach for the contract. */
export type { DetectionModule, ModuleStatus } from '@/lib/modules/catalogue'

/**
 * Detection modules, and which cameras they run on.
 *
 * `module_status` is a frozen field in the backend's JSON: a module is either
 * `live` or `coming_soon`, and the difference is not cosmetic. A `coming_soon`
 * module does not exist yet — it cannot be switched on, it will never raise a
 * detection, and this file must not let the interface imply otherwise. The
 * status arrives from the contract; nothing here derives or guesses it.
 *
 * `falsePositiveRate` comes from the same place, for the same reason. It is a
 * measured property of a model build, so it belongs to the module record and is
 * read from it — never approximated in the component that draws it.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type CameraModules = {
  cameraId: string
  /** Ids of the modules currently running on this camera. */
  enabled: string[]
}

export type ModuleConfig = {
  modules: DetectionModule[]
  cameras: CameraModules[]
}

export type ConfigResult =
  | { ok: true; config: ModuleConfig }
  | { ok: false; code: 'unavailable' }

export type SetResult =
  | { ok: true; cameraId: string; enabled: string[] }
  | { ok: false; code: 'not_live' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

export type BulkResult =
  | { ok: true; changed: number; unchanged: number }
  | { ok: false; code: 'not_live' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getModuleConfig(): Promise<ConfigResult> {
  return USE_MOCKS ? mockConfig() : realConfig()
}

export function setCameraModule(
  cameraId: string,
  moduleId: string,
  enabled: boolean,
): Promise<SetResult> {
  return USE_MOCKS
    ? mockSet(cameraId, moduleId, enabled)
    : realSet(cameraId, moduleId, enabled)
}

/** The same change across every camera in one zone. */
export function setZoneModule(
  zone: string,
  moduleId: string,
  enabled: boolean,
): Promise<BulkResult> {
  return USE_MOCKS
    ? mockSetZone(zone, moduleId, enabled)
    : realSetZone(zone, moduleId, enabled)
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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/**
 * An unrecognised `module_status` is treated as `coming_soon`, never as `live`.
 * If the contract grows a third state this build has not heard of, the safe
 * reading is that the module is not available — the failure has to fall on the
 * side of offering less, not of offering something that does not exist.
 */
function toModule(value: unknown): DetectionModule | null {
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
    falsePositiveRate:
      status === 'live' && typeof rate === 'number' ? rate : null,
    resourceNote: str(m.resource_note),
  }
}

function toCameraModules(value: unknown): CameraModules | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  const cameraId = str(c.cameraId)
  return cameraId ? { cameraId, enabled: strings(c.enabled) } : null
}

async function realConfig(): Promise<ConfigResult> {
  let response: Response
  try {
    response = await fetch('/api/modules', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }

  return {
    ok: true,
    config: {
      modules: (Array.isArray(payload.modules) ? payload.modules : [])
        .map(toModule)
        .filter((module): module is DetectionModule => module !== null),
      cameras: (Array.isArray(payload.cameras) ? payload.cameras : [])
        .map(toCameraModules)
        .filter((camera): camera is CameraModules => camera !== null),
    },
  }
}

async function realSet(
  cameraId: string,
  moduleId: string,
  enabled: boolean,
): Promise<SetResult> {
  let response: Response
  try {
    response = await fetch(
      `/api/cameras/${encodeURIComponent(cameraId)}/modules/${encodeURIComponent(moduleId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled }),
      },
    )
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  // The backend refuses a module that is not live, whatever the browser thinks.
  if (response.status === 409) return { ok: false, code: 'not_live' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }
  return { ok: true, cameraId, enabled: strings(payload.enabled) }
}

async function realSetZone(
  zone: string,
  moduleId: string,
  enabled: boolean,
): Promise<BulkResult> {
  let response: Response
  try {
    response = await fetch('/api/modules/zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ zone, moduleId, enabled }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (response.status === 409) return { ok: false, code: 'not_live' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }
  return {
    ok: true,
    changed: typeof payload.changed === 'number' ? payload.changed : 0,
    unchanged: typeof payload.unchanged === 'number' ? payload.unchanged : 0,
  }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/modules is live                                */
/* -------------------------------------------------------------------------- */

const MOCK_DELAY = { config: 400, set: 500, zone: 900 }

/**
 * Every fifth write fails, so the revert path is something you meet by using
 * the page rather than something you have to take on trust. Deterministic on
 * purpose: a random failure is impossible to demonstrate twice.
 */
const FAIL_EVERY = 5
let writes = 0

/** Camera id → module ids. Nothing is on until somebody turns it on. */
const enabledByCamera = new Map<string, string[]>()

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isLive(moduleId: string) {
  return MOCK_CATALOGUE.some((module) => module.id === moduleId && module.status === 'live')
}

function enabledFor(cameraId: string) {
  return enabledByCamera.get(cameraId) ?? []
}

async function mockConfig(): Promise<ConfigResult> {
  await wait(MOCK_DELAY.config)

  const result = await listCameras()
  const cameras = result.ok ? result.cameras : []

  return {
    ok: true,
    config: {
      modules: MOCK_CATALOGUE,
      cameras: cameras.map((camera) => ({
        cameraId: camera.id,
        enabled: enabledFor(camera.id),
      })),
    },
  }
}

async function mockSet(
  cameraId: string,
  moduleId: string,
  enabled: boolean,
): Promise<SetResult> {
  await wait(MOCK_DELAY.set)

  // The same refusal the backend gives. A module that is not live cannot be
  // switched on, however the request got here.
  if (!isLive(moduleId)) return { ok: false, code: 'not_live' }

  writes += 1
  if (writes % FAIL_EVERY === 0) return { ok: false, code: 'unavailable' }

  const current = enabledFor(cameraId)
  const next = enabled
    ? current.includes(moduleId)
      ? current
      : [...current, moduleId]
    : current.filter((id) => id !== moduleId)

  enabledByCamera.set(cameraId, next)
  return { ok: true, cameraId, enabled: next }
}

async function mockSetZone(
  zone: string,
  moduleId: string,
  enabled: boolean,
): Promise<BulkResult> {
  await wait(MOCK_DELAY.zone)

  if (!isLive(moduleId)) return { ok: false, code: 'not_live' }

  writes += 1
  if (writes % FAIL_EVERY === 0) return { ok: false, code: 'unavailable' }

  const result = await listCameras()
  if (!result.ok) return { ok: false, code: 'unavailable' }

  const inZone = result.cameras.filter((camera) => camera.zone === zone)
  let changed = 0

  for (const camera of inZone) {
    const current = enabledFor(camera.id)
    const already = current.includes(moduleId)
    if (already === enabled) continue

    enabledByCamera.set(
      camera.id,
      enabled ? [...current, moduleId] : current.filter((id) => id !== moduleId),
    )
    changed += 1
  }

  return { ok: true, changed, unchanged: inZone.length - changed }
}
