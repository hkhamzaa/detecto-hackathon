import { listAlerts, parseAlert, type Alert, type DetectionKind } from '@/lib/alerts/api'
import { listCameras } from '@/lib/cameras/api'
import { USE_MOCKS } from '@/lib/config/mocks'
import { useAuthStore } from '@/store/auth-store'

/**
 * The alert record over a reporting window, rather than the live queue.
 *
 * Deliberately its own endpoint. `/api/alerts` answers "what needs a person
 * right now" and is read every few seconds; this answers "what has happened
 * over eight weeks" and is read when somebody opens a page. Serving the second
 * from the first would mean shipping a quarter's worth of detections to the
 * browser to draw a queue of four.
 *
 * What comes back is alert *records*, not pre-computed statistics. Every figure
 * on the analytics page is derived from these in `stats.ts`, so a number on
 * screen can always be traced to the detections behind it — and so the export
 * hands over the same rows the charts were drawn from. A backend that returned
 * ready-made percentages would be quicker and completely unauditable.
 *
 * Same shape as every other module here: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

const MODE = import.meta.env.VITE_ANALYTICS_MOCK as string | undefined

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type AlertHistory = {
  /** Every alert raised inside the window — decided or still waiting. */
  alerts: Alert[]
  /**
   * How far back the window reaches. The backend decides it, from the plan's
   * retention. The page reports the window it was given rather than implying a
   * range nobody promised.
   */
  windowDays: number
}

export type HistoryResult =
  | { ok: true; history: AlertHistory }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getAlertHistory(): Promise<HistoryResult> {
  return USE_MOCKS ? mockHistory() : realHistory()
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function realHistory(): Promise<HistoryResult> {
  let response: Response
  try {
    response = await fetch('/api/analytics/alerts', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, code: 'unavailable' }
  }

  const payload = data as Record<string, unknown>
  if (!Array.isArray(payload.alerts)) return { ok: false, code: 'unavailable' }

  return {
    ok: true,
    history: {
      // An empty window is a real answer — a new organisation. The page has a
      // state for it, so it is not treated as a failure.
      alerts: payload.alerts
        .map(parseAlert)
        .filter((alert): alert is Alert => alert !== null),
      windowDays:
        typeof payload.windowDays === 'number' ? payload.windowDays : WINDOW_DAYS,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/analytics/alerts is live                       */
/* -------------------------------------------------------------------------- */

/**
 * Eight weeks, which is the shortest window in which a weekly trend has enough
 * points to be worth drawing.
 */
const WINDOW_DAYS = 56

/**
 * `VITE_ANALYTICS_MOCK` picks which organisation you are looking at, so every
 * state on the page is reachable without a backend — the same trick the pairing
 * codes play in `cameras/api.ts`:
 *
 *   (unset)  an established account: eight weeks of detections behind the queue
 *   sparse   a new account: the live queue and nothing older
 *   empty    an account whose cameras have never raised anything
 *   false    no mock at all; talk to the real endpoint
 *
 * `sparse` is the one worth opening. It is what a customer sees in their first
 * week, and it is the case where a chart drawn anyway would be a lie.
 */
const MOCK_DELAY = 550

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fixed seed, on purpose. A demo you cannot show twice is not a demo, and a
 * false-positive rate that moves every reload is not something anyone can be
 * asked to trust. Mulberry32 — small, and good enough to shape a mock.
 */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * When detections actually happen, by hour. Trouble follows people: a long
 * evening peak around closing time, a smaller one at the morning open, and very
 * little at 04:00. This is the shape the incident-pattern section exists to
 * show, so it has to be in the data rather than in the chart.
 */
const HOUR_WEIGHT = [
  0.2, 0.15, 0.1, 0.1, 0.1, 0.15, 0.3, 0.6, 0.9, 0.7, 0.5, 0.5,
  0.6, 0.5, 0.5, 0.6, 0.8, 1.0, 1.2, 1.3, 1.1, 0.9, 0.7, 0.4,
]

/** Friday and Saturday nights carry more than a Tuesday. Sunday is quiet. */
const DAY_WEIGHT = [0.6, 0.8, 0.85, 0.9, 1.0, 1.35, 1.25]

/** Roughly how many detections a camera raises per day, before the shaping. */
const BASE_PER_CAMERA_PER_DAY = 1.15

/**
 * How the two live modules behave, as an organisation actually experiences
 * them. `dismissRate` is the share of *decided* alerts a person marked a false
 * positive, and it sits above the lab false-positive rate on each module record
 * — a model that is right 96% of the time on a benchmark is not right 96% of
 * the time in a car park at night. The analytics page shows both numbers next
 * to each other precisely because they differ.
 *
 * `improving` bends the rate down across the window: both models have had a
 * build shipped in the last two months, and being able to see that is the whole
 * point of a trend.
 */
const MODULE_BEHAVIOUR: Record<
  DetectionKind,
  { share: number; dismissRate: number; improving: number; confidence: [number, number] }
> = {
  weapon: { share: 0.58, dismissRate: 0.17, improving: 0.06, confidence: [0.55, 0.97] },
  violence: { share: 0.42, dismissRate: 0.29, improving: 0.09, confidence: [0.52, 0.93] },
}

const SUBTYPES: Record<DetectionKind, (string | null)[]> = {
  weapon: ['handgun', 'knife', 'handgun', 'rifle', null],
  violence: ['altercation', 'altercation', 'struggle', null],
}

const DECIDERS = ['A. Okafor', 'L. Ferreira', 'M. Haddad', 'R. Nwosu']

const MOCK_MODEL = 'wv-detect 3.2'

/** Same fallback the alert mock uses, for an account that has added no cameras. */
const PLACEHOLDER_CAMERAS = [
  { id: 'cam_demo_1', name: 'Main entrance', zone: 'Front of house' },
  { id: 'cam_demo_2', name: 'Loading bay', zone: 'Yard' },
  { id: 'cam_demo_3', name: 'West corridor', zone: 'Level 2' },
  { id: 'cam_demo_4', name: 'Car park', zone: 'Perimeter' },
]

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * How long a detection sat before somebody decided it, in minutes.
 *
 * Log-normal, because response times are: most are dealt with inside a few
 * minutes and a few are not dealt with for hours, and it is the few that the
 * response-time section is for. A distribution that ran 1–8 minutes and stopped
 * would make the page agree with itself and tell nobody anything.
 */
function responseMinutes(random: () => number, hour: number) {
  // Two uniforms into a normal, then exponentiated. Box–Muller.
  const u1 = Math.max(random(), 1e-9)
  const u2 = random()
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)

  // Nights are slower: fewer people on, and the ones on are further away.
  const overnight = hour >= 1 && hour <= 5
  const centre = overnight ? 1.9 : 1.1
  const spread = overnight ? 1.25 : 1.0

  return Math.max(1, Math.round(Math.exp(centre + spread * normal)))
}

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length) % items.length]
}

async function mockCameras() {
  const result = await listCameras()
  return result.ok && result.cameras.length > 0
    ? result.cameras.map((c) => ({ id: c.id, name: c.name, zone: c.zone }))
    : PLACEHOLDER_CAMERAS
}

/**
 * The window, built behind whatever the live queue is holding.
 *
 * The queue's own alerts are included rather than regenerated, so the two pages
 * agree: an org admin who counts four detections on Tuesday in the queue finds
 * the same four in the analytics window. Generated history stops short of the
 * queue's oldest seed so nothing is counted twice.
 */
async function buildHistory(now: number): Promise<Alert[]> {
  const [cameras, queue] = await Promise.all([mockCameras(), listAlerts()])
  const live = queue.ok ? queue.alerts : []

  const oldestLive = live.reduce(
    (oldest, alert) => Math.min(oldest, Date.parse(alert.detectedAt)),
    now,
  )

  const random = seeded(0x0d37ec70)
  const generated: Alert[] = []
  let serial = 1000

  for (let daysAgo = WINDOW_DAYS; daysAgo >= 0; daysAgo -= 1) {
    const midnight = new Date(now - daysAgo * DAY_MS)
    midnight.setHours(0, 0, 0, 0)

    const dayWeight = DAY_WEIGHT[midnight.getDay()]
    // A slow drift upward across the window: the account has been adding
    // cameras, so recent weeks carry more than the oldest ones.
    const growth = 0.72 + 0.28 * ((WINDOW_DAYS - daysAgo) / WINDOW_DAYS)

    for (let hour = 0; hour < 24; hour += 1) {
      const expected =
        (cameras.length * BASE_PER_CAMERA_PER_DAY * dayWeight * growth * HOUR_WEIGHT[hour]) / 24

      // Bernoulli per hour rather than a Poisson draw: at these rates the
      // difference is invisible and this stays readable.
      if (random() > expected) continue

      const detectedAt = midnight.getTime() + hour * HOUR_MS + Math.floor(random() * HOUR_MS)
      // Anything inside the queue's own range belongs to the queue.
      if (detectedAt >= oldestLive) continue

      const camera = pick(random, cameras)
      const kind: DetectionKind =
        random() < MODULE_BEHAVIOUR.weapon.share ? 'weapon' : 'violence'
      const behaviour = MODULE_BEHAVIOUR[kind]

      // The model got better across the window, so the rate is read at the
      // point in time the detection was raised.
      const age = daysAgo / WINDOW_DAYS
      const dismissRate = behaviour.dismissRate - behaviour.improving * (1 - age)
      const dismissed = random() < dismissRate

      /*
       * Confidence and outcome are drawn together, not independently.
       *
       * This is the one relationship on the page that has to be real: the
       * accuracy section is asking "can I trust this module", and the answer a
       * customer needs is that low-confidence flags are the ones people throw
       * out. Random confidences would draw a chart showing the model is noise.
       */
      const [floor, ceiling] = behaviour.confidence
      const span = ceiling - floor
      const confidence = dismissed
        ? floor + span * 0.35 * random()
        : floor + span * (0.45 + 0.55 * random())

      serial += 1
      const decided = new Date(detectedAt + responseMinutes(random, hour) * 60_000)

      generated.push({
        id: `ALR-${serial}`,
        cameraId: camera.id,
        cameraName: camera.name,
        zone: camera.zone,
        kind,
        subtype: pick(random, SUBTYPES[kind]),
        confidence: Math.round(confidence * 100) / 100,
        detectedAt: new Date(detectedAt).toISOString(),
        model: MOCK_MODEL,
        status: dismissed ? 'dismissed' : 'confirmed',
        decidedBy: pick(random, DECIDERS),
        decidedAt: decided.toISOString(),
      })
    }
  }

  return [...live, ...generated].sort(
    (a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt),
  )
}

/** Built once per session, like the queue's own store. */
let store: Promise<Alert[]> | null = null

async function mockHistory(): Promise<HistoryResult> {
  await wait(MOCK_DELAY)

  if (MODE === 'empty') {
    return { ok: true, history: { alerts: [], windowDays: WINDOW_DAYS } }
  }

  // A new organisation: the handful in the queue, and nothing behind them.
  if (MODE === 'sparse') {
    const queue = await listAlerts()
    return {
      ok: true,
      history: {
        alerts: queue.ok ? queue.alerts : [],
        windowDays: WINDOW_DAYS,
      },
    }
  }

  store ??= buildHistory(Date.now())
  return { ok: true, history: { alerts: await store, windowDays: WINDOW_DAYS } }
}
