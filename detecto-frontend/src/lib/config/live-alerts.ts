/**
 * Whether the frontend also listens to the Phase 2 alert server for detections
 * arriving in real time.
 *
 * Deliberately independent of `USE_MOCKS`. The two answer different questions —
 * that one picks a transport for the whole app, this one adds a live feed on
 * top of whatever transport is in use — and either can be on without the other.
 * With both on, real detections arrive alongside the seeded queue, which is the
 * combination worth having while the backend is one video file and a socket.
 *
 * Off unless explicitly switched on. The opposite polarity to `USE_MOCKS`, and
 * for the same reason: the safe default is the one that does not quietly reach
 * for a server that is not there.
 */
export const LIVE_ALERTS = import.meta.env.VITE_LIVE_ALERTS === 'true'

/** Where `detecto-backend/server/app.py` listens by default. */
export const LIVE_ALERTS_URL =
  import.meta.env.VITE_LIVE_ALERTS_URL ?? 'http://127.0.0.1:8000'

/** The event that server emits one `Alert` on. */
export const LIVE_ALERTS_EVENT = 'alert:new'

/** Every classified window, including Normal — the live overlay, not the queue. */
export const DETECTION_TICK_EVENT = 'detection:tick'
export const DETECTION_TICK_HISTORY_EVENT = 'detection:history'
export const WATCH_CAMERA_EVENT = 'watch_camera'
