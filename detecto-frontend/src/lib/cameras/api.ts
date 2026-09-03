import { USE_MOCKS } from '@/lib/config/mocks'
import { useAuthStore } from '@/store/auth-store'

/**
 * Camera connection and the camera list.
 *
 * Same shape as `lib/auth/api.ts`: one exported function per operation, a real
 * transport, and a dev mock that only ever runs in dev. A production build
 * always takes the real path, whatever the env var says.
 *
 * The vocabulary here is deliberately the customer's, not the installer's. A
 * recorder has *channels*; a camera has a *picture*. Protocol names belong in
 * the box's firmware and in this file's URLs, never on screen.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type PairedBox = {
  id: string
  /** What the box calls itself, as printed on its own screen. */
  label: string
  /** Inputs the box can see. Shown so they can tell one box from another. */
  channels: number
}

export type PairResult =
  | { ok: true; box: PairedBox }
  | { ok: false; code: 'invalid_code' }
  | { ok: false; code: 'expired_code' }
  | { ok: false; code: 'unavailable' }

/** Why the box could see an input but could not get a picture from it. */
export type CameraProblem = 'unreachable' | 'needs_password'

export type DiscoveredCamera = {
  id: string
  /** What the recorder calls this input, e.g. "Channel 3". */
  channel: string
  /** The name the device reports for itself, when it reports one. */
  suggestedName: string | null
  /** Human-readable, e.g. "1920 × 1080". Null when the box could not read it. */
  resolution: string | null
  /** Null means the box got a picture and the camera is ready to add. */
  problem: CameraProblem | null
  /**
   * The box always reports `'box'`. `'manual'` entries are built in the browser
   * when someone types in a camera the box did not find, and carry an address.
   */
  source: 'box' | 'manual'
  address: string | null
}

export type DiscoveryResult =
  | { ok: true; cameras: DiscoveredCamera[] }
  | { ok: false; code: 'box_offline' }
  | { ok: false; code: 'unavailable' }

export type Camera = {
  id: string
  name: string
  zone: string
  online: boolean
  /** ISO timestamp of the last picture received, or null if there never was one. */
  lastSeen: string | null
  /**
   * `'pending'` when a box reported this camera and nobody has looked at it
   * yet — it exists, and may already be sending a picture, but isn't in use
   * (the backend refuses to enable a detection module on it) until a person
   * moves it to `'approved'`. Every camera added by hand through this page's
   * own flow is `'approved'` immediately — a human already reviewed it by
   * the act of adding it.
   */
  reviewStatus: 'pending' | 'approved'
  /**
   * `'unconfigured'` — a row exists but nothing is actually wired up to
   * send it a picture. Every camera this page's own add flow creates starts
   * here; only a box auto-reporting itself (`'rtsp'`) or this project's own
   * dev/test harness (`'file'`) ever moves past it. Distinct from `online`
   * on purpose: `online: false` alone can't say whether a camera was ever
   * connected at all or just isn't sending anything right now, and treating
   * those as the same fact is exactly the honesty gap this field closes —
   * see components/camera/camera-status.tsx.
   */
  sourceType: 'unconfigured' | 'file' | 'rtsp'
}

export type NewCamera = {
  name: string
  zone: string
  /** Set for a camera the box found. */
  discoveredId: string | null
  /** Set instead for one typed in by hand. */
  address: string | null
}

export type AddResult =
  | { ok: true; cameras: Camera[] }
  | { ok: false; code: 'unavailable' }

export type ListResult =
  | { ok: true; cameras: Camera[] }
  | { ok: false; code: 'unavailable' }

export type ApproveResult =
  | { ok: true; camera: Camera }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function pairBox(code: string): Promise<PairResult> {
  return USE_MOCKS ? mockPair(code) : realPair(code)
}

export function discoverCameras(boxId: string): Promise<DiscoveryResult> {
  return USE_MOCKS ? mockDiscover(boxId) : realDiscover(boxId)
}

export function addCameras(cameras: NewCamera[]): Promise<AddResult> {
  return USE_MOCKS ? mockAdd(cameras) : realAdd(cameras)
}

/** Moves a box-reported camera from `'pending'` to `'approved'` — the one
 * thing a person does to put it into use. There is no reverse of this: a
 * camera already approved cannot be sent back to `'pending'` through this
 * or any other endpoint. */
export function approveCamera(id: string): Promise<ApproveResult> {
  return USE_MOCKS ? mockApprove(id) : realApprove(id)
}

export function listCameras(): Promise<ListResult> {
  return USE_MOCKS ? mockList() : realList()
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Auth's own endpoints are reached with the refresh cookie; every other request
 * carries the short-lived access token instead. Kept local to this module until
 * a second feature needs it — one shared client is worth writing once there is
 * something to share.
 */
function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toDiscovered(value: unknown): DiscoveredCamera | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  const id = str(c.id)
  const channel = str(c.channel)
  if (!id || !channel) return null

  const problem = str(c.problem)
  return {
    id,
    channel,
    suggestedName: str(c.suggestedName),
    resolution: str(c.resolution),
    problem: problem === 'unreachable' || problem === 'needs_password' ? problem : null,
    source: 'box',
    address: null,
  }
}

function toCamera(value: unknown): Camera | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Record<string, unknown>
  const id = str(c.id)
  const name = str(c.name)
  if (!id || !name) return null

  return {
    id,
    name,
    zone: str(c.zone) ?? '',
    online: c.online === true,
    lastSeen: str(c.lastSeen),
    // 'pending' only when the server actually says so; any other value
    // (including one this build doesn't recognise yet) reads as the
    // long-standing default every camera had before this field existed.
    reviewStatus: c.reviewStatus === 'pending' ? 'pending' : 'approved',
    // Same defensive rule as reviewStatus above: anything other than the
    // two real configured values reads as 'unconfigured' rather than
    // silently claiming a source that isn't actually there.
    sourceType: c.sourceType === 'file' || c.sourceType === 'rtsp' ? c.sourceType : 'unconfigured',
  }
}

function collect<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.map(map).filter((item): item is T => item !== null)
}

async function realPair(code: string): Promise<PairResult> {
  let response: Response
  try {
    response = await fetch('/api/boxes/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ code }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 404) return { ok: false, code: 'invalid_code' }
  if (response.status === 410) return { ok: false, code: 'expired_code' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  const id = payload ? str(payload.id) : null
  if (!payload || !id) return { ok: false, code: 'unavailable' }

  return {
    ok: true,
    box: {
      id,
      label: str(payload.label) ?? 'Detecto Box',
      channels: typeof payload.channels === 'number' ? payload.channels : 0,
    },
  }
}

async function realDiscover(boxId: string): Promise<DiscoveryResult> {
  let response: Response
  try {
    response = await fetch(`/api/boxes/${encodeURIComponent(boxId)}/discover`, {
      method: 'POST',
      headers: authHeaders(),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  // The box stopped answering the platform between pairing and discovery.
  if (response.status === 409) return { ok: false, code: 'box_offline' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }
  // An empty list is a real answer, not a failure. It gets its own screen.
  return { ok: true, cameras: collect(payload.cameras, toDiscovered) }
}

async function realAdd(cameras: NewCamera[]): Promise<AddResult> {
  let response: Response
  try {
    response = await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ cameras }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (!response.ok) return { ok: false, code: 'unavailable' }
  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }
  return { ok: true, cameras: collect(payload.cameras, toCamera) }
}

async function realList(): Promise<ListResult> {
  let response: Response
  try {
    response = await fetch('/api/cameras', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (!response.ok) return { ok: false, code: 'unavailable' }
  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }
  return { ok: true, cameras: collect(payload.cameras, toCamera) }
}

async function realApprove(id: string): Promise<ApproveResult> {
  let response: Response
  try {
    response = await fetch(`/api/cameras/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ reviewStatus: 'approved' }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const camera = toCamera(await readObject(response))
  if (!camera) return { ok: false, code: 'unavailable' }
  return { ok: true, camera }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/boxes and /api/cameras are live                 */
/* -------------------------------------------------------------------------- */

/**
 * The first block of the pairing code picks the outcome, so every state in the
 * flow can be reached without a backend:
 *
 *   DEMO-####   pairs, then finds five cameras, all of them ready
 *   HALF-####   pairs, then finds five, two of which it cannot get a picture from
 *   NONE-####   pairs, then finds nothing at all
 *   DOWN-####   pairs, then the box stops answering before it can look
 *   GONE-####   the code has expired
 *   anything else — no such box
 *
 * The camera list starts empty, which is what a new organisation actually sees.
 * Running the flow fills it, and a reload empties it again.
 */
const MOCK_DELAY = { pair: 900, discover: 2200, add: 700, list: 350 }

let mockCameras: Camera[] = []
let mockCounter = 0

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The first of the code's two blocks. Read positionally, not by splitting on
 * the separator — what arrives here is the normalised eight characters, and the
 * dash the field draws while typing is never part of it.
 */
function firstBlock(code: string) {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
}

async function mockPair(code: string): Promise<PairResult> {
  await wait(MOCK_DELAY.pair)

  const block = firstBlock(code)
  if (block === 'GONE') return { ok: false, code: 'expired_code' }
  if (!['DEMO', 'HALF', 'NONE', 'DOWN'].includes(block)) {
    return { ok: false, code: 'invalid_code' }
  }

  return {
    ok: true,
    box: {
      id: `box_${block.toLowerCase()}`,
      label: 'Detecto Box · Front office',
      channels: block === 'NONE' ? 0 : 8,
    },
  }
}

const MOCK_CHANNELS: Omit<DiscoveredCamera, 'problem' | 'source' | 'address'>[] = [
  { id: 'ch1', channel: 'Channel 1', suggestedName: 'Front entrance', resolution: '1920 × 1080' },
  { id: 'ch2', channel: 'Channel 2', suggestedName: null, resolution: '1920 × 1080' },
  { id: 'ch3', channel: 'Channel 3', suggestedName: 'Loading bay', resolution: '2560 × 1440' },
  { id: 'ch4', channel: 'Channel 4', suggestedName: null, resolution: '1280 × 720' },
  { id: 'ch5', channel: 'Channel 5', suggestedName: 'Car park', resolution: '1920 × 1080' },
]

async function mockDiscover(boxId: string): Promise<DiscoveryResult> {
  await wait(MOCK_DELAY.discover)

  if (boxId === 'box_down') return { ok: false, code: 'box_offline' }
  if (boxId === 'box_none') return { ok: true, cameras: [] }

  const problems: Record<string, CameraProblem> =
    boxId === 'box_half' ? { ch3: 'needs_password', ch5: 'unreachable' } : {}

  return {
    ok: true,
    cameras: MOCK_CHANNELS.map((channel) => ({
      ...channel,
      problem: problems[channel.id] ?? null,
      source: 'box' as const,
      address: null,
    })),
  }
}

async function mockAdd(cameras: NewCamera[]): Promise<AddResult> {
  await wait(MOCK_DELAY.add)

  const added: Camera[] = cameras.map((camera) => {
    mockCounter += 1
    return {
      id: `cam_${String(mockCounter).padStart(3, '0')}`,
      name: camera.name,
      zone: camera.zone,
      // Matches the real POST /api/cameras exactly: online is NOT decided by
      // whether the box discovered this camera or a person typed it in —
      // every camera this flow creates starts unconfigured and offline,
      // full stop. It only becomes real once something wires an actual
      // source to it, which this human add-flow doesn't do (see
      // cameras.js's own note on this — a known, honestly-stated gap, not
      // hidden behind a discoveredId-based "online" guess).
      online: false,
      lastSeen: null,
      // A human just walked through this exact flow to add it — already
      // reviewed, same as every camera this mock has ever produced. Only
      // POST /api/boxes/:id/cameras (a real box reporting on its own,
      // outside this UI entirely) ever creates a 'pending' one.
      reviewStatus: 'approved',
      sourceType: 'unconfigured',
    }
  })

  mockCameras = [...mockCameras, ...added]
  return { ok: true, cameras: added }
}

async function mockList(): Promise<ListResult> {
  await wait(MOCK_DELAY.list)
  return { ok: true, cameras: mockCameras }
}

async function mockApprove(id: string): Promise<ApproveResult> {
  await wait(MOCK_DELAY.add)

  const camera = mockCameras.find((c) => c.id === id)
  if (!camera) return { ok: false, code: 'unavailable' }

  camera.reviewStatus = 'approved'
  return { ok: true, camera }
}

/**
 * Moves every camera in one zone to another name.
 *
 * Exported for the zones mock, for the same reason `MOCK_BOXES_SILENT` is
 * exported for the health mock: a zone is a name repeated across three stores,
 * and renaming it has to reach all three or it breaks access scope. On a real
 * backend that is one transaction; here it is three mock modules agreeing,
 * and a demo where the cameras moved but the roles did not would be worse than
 * no rename at all. All of them are dev mocks; they are deleted together.
 */
export function mockRewriteCameraZone(from: string, to: string): number {
  let moved = 0
  mockCameras = mockCameras.map((camera) => {
    if (camera.zone.trim() !== from) return camera
    moved += 1
    return { ...camera, zone: to }
  })
  return moved
}
