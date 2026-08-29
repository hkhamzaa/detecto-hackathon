/**
 * Single source of truth for whether the frontend talks to its in-memory
 * mocks or the real backend, across every module's `api.ts` under `lib/`.
 *
 * Deliberately not gated on Vite's DEV flag: Vite hardcodes it to false in
 * every production build, including preview and Vercel deploys, so a
 * dev-gated flag would silently force the real transport there no matter
 * what the env var said. Mocks stay on everywhere — dev, preview, and
 * production — until a real backend exists, unless explicitly disabled.
 */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'
