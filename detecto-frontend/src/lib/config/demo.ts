/**
 * Hackathon demo copy of Detecto.
 *
 * When on, the UI offers a video-file upload that simulates a live camera
 * feed, and hides box pairing / RTSP / discovery / fleet-health surfaces
 * rather than deleting them. Production builds default on (hackathon demo).
 * Local/vitest stay off unless VITE_DEMO_MODE=true.
 */
export const DEMO_MODE = import.meta.env.PROD
  ? import.meta.env.VITE_DEMO_MODE !== 'false'
  : import.meta.env.VITE_DEMO_MODE === 'true'

/** Matches detecto-backend/api's DEMO_MAX_UPLOAD_BYTES default. */
export const MAX_DEMO_UPLOAD_BYTES = 250 * 1024 * 1024
