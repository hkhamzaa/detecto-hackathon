import { listCameras } from '@/lib/cameras/api'
import { USE_MOCKS } from '@/lib/config/mocks'
import { useAuthStore } from '@/store/auth-store'

/**
 * The alert queue: detections waiting on a person, and the record of the ones
 * who have had one.
 *
 * Same shape as the auth and camera modules — one function per operation, a
 * real transport, and a dev mock that only ever runs in dev.
 *
 * Which alerts come back is the backend's decision, not this file's. A member
 * assigned to two cameras and an org admin over forty of them call the same
 * endpoint; the scoping happens where the session is understood.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type AlertStatus = 'unconfirmed' | 'confirmed' | 'dismissed'
export type DetectionKind = 'weapon' | 'violence'

export type Alert = {
  /** Human-quotable, e.g. `ALR-2291`. What one operator says to another. */
  id: string
  cameraId: string
  cameraName: string
  zone: string
  kind: DetectionKind
  /** `handgun`, `knife`, `altercation` — null when the model only had a class. */
  subtype: string | null
  /** 0–1, as the model reported it. Never rounded away. */
  confidence: number
  detectedAt: string
  /** The model build that raised it, so a bad release can be traced. */
  model: string
  status: AlertStatus
  /** Who took responsibility, and when. Both null while it is still waiting. */
  decidedBy: string | null
  decidedAt: string | null
  /**
   * Set only by a pipeline whose output is not trusted yet, so the interface can
   * say so rather than presenting a beta detection as an ordinary one.
   *
   * Optional rather than `string | null` — the rest of this type describes facts
   * every alert has, even when the value is empty. This one is a claim only the
   * raising pipeline makes, and its absence is the normal case.
   */
  pipelineStatus?: 'beta'
  /**
   * The still the model flagged, as a self-contained `data:` URL. Only a
   * pipeline that captures frames sets it; the evidence panel falls back to its
   * placeholder when it is absent.
   */
  frameImage?: string
  /**
   * Set when the decision on this alert was only ever written to this browser,
   * because the pipeline that raised it has nowhere to record one. Never set by
   * anything that reached a server — that is the entire distinction it draws.
   */
  decisionScope?: 'local'
}

export type AlertsResult =
  | { ok: true; alerts: Alert[] }
  | { ok: false; code: 'unavailable' }

export type AlertResult =
  | { ok: true; alert: Alert }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'unavailable' }

/** A decision failing is not the same as a decision going unrecorded quietly. */
export type DecisionResult =
  | { ok: true; alert: Alert }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function listAlerts(): Promise<AlertsResult> {
  return USE_MOCKS ? mockList() : realList()
}

export function getAlert(id: string): Promise<AlertResult> {
  return USE_MOCKS ? mockGet(id) : realGet(id)
}

/** Records that a person took responsibility for this flag. Escalates nothing. */
export function confirmAlert(id: string): Promise<DecisionResult> {
  return USE_MOCKS ? mockDecide(id, 'confirmed') : realDecide(id, 'confirm')
}

export function dismissAlert(id: string): Promise<DecisionResult> {
  return USE_MOCKS ? mockDecide(id, 'dismissed') : realDecide(id, 'dismiss')
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

const STATUSES: string[] = ['unconfirmed', 'confirmed', 'dismissed']

/**
 * Only a self-contained image is allowed into the evidence panel.
 *
 * The value ends up in an `img src`, so an arbitrary URL off the wire would let
 * whatever served it watch who opened which alert, and when. A `data:` URL
 * cannot: it carries its own bytes and reaches nothing.
 */
const IMAGE_PREFIXES = ['data:image/jpeg;base64,', 'data:image/png;base64,']

function imageData(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix)) ? value : undefined
}

/**
 * One alert off the wire, or `null` if it is not one.
 *
 * Exported because analytics reads the same records over a longer window and
 * must accept exactly what the queue accepts — a second parser would eventually
 * disagree with this one, and the page that disagreed would be the one nobody
 * was looking at.
 */
export function parseAlert(value: unknown): Alert | null {
  if (typeof value !== 'object' || value === null) return null
  const a = value as Record<string, unknown>

  const id = str(a.id)
  const detectedAt = str(a.detectedAt)
  const status = str(a.status)
  const kind = str(a.kind)
  if (!id || !detectedAt || !status || !STATUSES.includes(status)) return null
  if (kind !== 'weapon' && kind !== 'violence') return null

  const alert: Alert = {
    id,
    cameraId: str(a.cameraId) ?? '',
    cameraName: str(a.cameraName) ?? 'Unknown camera',
    zone: str(a.zone) ?? '',
    kind,
    subtype: str(a.subtype),
    confidence: typeof a.confidence === 'number' ? a.confidence : 0,
    detectedAt,
    model: str(a.model) ?? 'unknown',
    status: status as AlertStatus,
    decidedBy: str(a.decidedBy),
    decidedAt: str(a.decidedAt),
  }

  // Attached rather than defaulted: an alert off the trusted path should not
  // carry this key at all, and an unrecognised value is not a licence to invent
  // a reassuring one. Only the exact claim survives.
  if (str(a.pipelineStatus) === 'beta') alert.pipelineStatus = 'beta'

  const frameImage = imageData(a.frameImage)
  if (frameImage) alert.frameImage = frameImage

  // `decisionScope` is deliberately not read off the wire. It means "this was
  // never recorded anywhere", which is a claim only this browser can make about
  // its own cache — a server saying it would be saying something incoherent.

  return alert
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

async function realList(): Promise<AlertsResult> {
  let response: Response
  try {
    response = await fetch('/api/alerts', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload || !Array.isArray(payload.alerts)) {
    return { ok: false, code: 'unavailable' }
  }
  return {
    ok: true,
    alerts: payload.alerts
      .map(parseAlert)
      .filter((alert): alert is Alert => alert !== null),
  }
}

async function realGet(id: string): Promise<AlertResult> {
  let response: Response
  try {
    response = await fetch(`/api/alerts/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (response.status === 404) return { ok: false, code: 'not_found' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const alert = parseAlert(await readObject(response))
  return alert ? { ok: true, alert } : { ok: false, code: 'unavailable' }
}

async function realDecide(
  id: string,
  decision: 'confirm' | 'dismiss',
): Promise<DecisionResult> {
  let response: Response
  try {
    response = await fetch(
      `/api/alerts/${encodeURIComponent(id)}/${decision}`,
      { method: 'POST', headers: authHeaders() },
    )
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  // The grant is checked here as well as in the browser. The disabled control
  // is a courtesy; this is the answer that counts.
  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const alert = parseAlert(await readObject(response))
  return alert ? { ok: true, alert } : { ok: false, code: 'unavailable' }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/alerts is live                                 */
/* -------------------------------------------------------------------------- */

/**
 * Seeded against whatever cameras the connection flow has actually added, so
 * the queue talks about the same places the camera list does. Before anyone has
 * run that flow there are no cameras to name, so it falls back to four that
 * sound like somewhere real.
 */
const PLACEHOLDER_CAMERAS = [
  { id: 'cam_demo_1', name: 'Main entrance', zone: 'Front of house' },
  { id: 'cam_demo_2', name: 'Loading bay', zone: 'Yard' },
  { id: 'cam_demo_3', name: 'West corridor', zone: 'Level 2' },
  { id: 'cam_demo_4', name: 'Car park', zone: 'Perimeter' },
]

/**
 * Every state on the page, reachable without touching anything: three waiting
 * (including one at 0.62, because the low end of the range is exactly where a
 * human decision earns its place), two confirmed, two dismissed.
 */
const SEEDS: {
  id: string
  camera: number
  kind: DetectionKind
  subtype: string | null
  confidence: number
  minutesAgo: number
  status: AlertStatus
  decidedBy?: string
}[] = [
  { id: 'ALR-2291', camera: 0, kind: 'weapon', subtype: 'handgun', confidence: 0.94, minutesAgo: 6, status: 'unconfirmed' },
  { id: 'ALR-2290', camera: 1, kind: 'violence', subtype: 'altercation', confidence: 0.81, minutesAgo: 24, status: 'unconfirmed' },
  { id: 'ALR-2289', camera: 2, kind: 'weapon', subtype: 'knife', confidence: 0.62, minutesAgo: 47, status: 'unconfirmed' },
  { id: 'ALR-2288', camera: 3, kind: 'violence', subtype: null, confidence: 0.77, minutesAgo: 145, status: 'confirmed', decidedBy: 'A. Okafor' },
  { id: 'ALR-2287', camera: 0, kind: 'weapon', subtype: 'handgun', confidence: 0.88, minutesAgo: 213, status: 'confirmed', decidedBy: 'A. Okafor' },
  { id: 'ALR-2286', camera: 2, kind: 'weapon', subtype: 'knife', confidence: 0.58, minutesAgo: 336, status: 'dismissed', decidedBy: 'L. Ferreira' },
  { id: 'ALR-2285', camera: 1, kind: 'violence', subtype: 'altercation', confidence: 0.69, minutesAgo: 1490, status: 'dismissed', decidedBy: 'L. Ferreira' },
]

const MOCK_MODEL = 'wv-detect 3.2'
const MOCK_DELAY = { list: 400, get: 250, decide: 600 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Built once per session, then mutated by decisions like a real store would be. */
let store: Promise<Alert[]> | null = null

async function buildStore(): Promise<Alert[]> {
  const result = await listCameras()
  const cameras =
    result.ok && result.cameras.length > 0
      ? result.cameras.map((camera) => ({
          id: camera.id,
          name: camera.name,
          zone: camera.zone,
        }))
      : PLACEHOLDER_CAMERAS

  const now = Date.now()
  return SEEDS.map((seed) => {
    const camera = cameras[seed.camera % cameras.length]
    const detectedAt = new Date(now - seed.minutesAgo * 60_000)
    return {
      id: seed.id,
      cameraId: camera.id,
      cameraName: camera.name,
      zone: camera.zone,
      kind: seed.kind,
      subtype: seed.subtype,
      confidence: seed.confidence,
      detectedAt: detectedAt.toISOString(),
      model: MOCK_MODEL,
      status: seed.status,
      decidedBy: seed.decidedBy ?? null,
      // Decided a few minutes after it was raised, which is the whole point.
      decidedAt:
        seed.status === 'unconfirmed'
          ? null
          : new Date(detectedAt.getTime() + 4 * 60_000).toISOString(),
    }
  })
}

function alertStore() {
  store ??= buildStore()
  return store
}

async function mockList(): Promise<AlertsResult> {
  await wait(MOCK_DELAY.list)
  const alerts = await alertStore()
  return { ok: true, alerts: alerts.slice() }
}

async function mockGet(id: string): Promise<AlertResult> {
  await wait(MOCK_DELAY.get)
  const alerts = await alertStore()
  const alert = alerts.find((item) => item.id === id)
  return alert ? { ok: true, alert } : { ok: false, code: 'not_found' }
}

async function mockDecide(
  id: string,
  status: Exclude<AlertStatus, 'unconfirmed'>,
): Promise<DecisionResult> {
  await wait(MOCK_DELAY.decide)

  const alerts = await alertStore()
  const index = alerts.findIndex((item) => item.id === id)
  if (index === -1) return { ok: false, code: 'unavailable' }

  // The decision is recorded against whoever is signed in — the same thing the
  // audit log would show, rather than an anonymous state change.
  const claims = useAuthStore.getState().claims
  const decided: Alert = {
    ...alerts[index],
    status,
    decidedBy: claims?.email ?? 'Unknown operator',
    decidedAt: new Date().toISOString(),
  }
  // Replaced, not mutated: the row has to become a new object for the list to
  // notice it changed.
  alerts[index] = decided
  return { ok: true, alert: decided }
}
