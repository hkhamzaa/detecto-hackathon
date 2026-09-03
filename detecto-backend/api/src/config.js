import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  frontendOrigin,

  // Shared secret for service-to-service calls — today, detecto-backend/server
  // (the Python Socket.IO pipeline) posting new alerts, and this API calling
  // that server's POST /pipelines to start inference on an uploaded file.
  // Not a user credential and never issued as one: it authenticates
  // "this request came from a trusted local service", not a person, so it
  // carries no org/permission claims of its own — every route gated by it
  // must derive its own org scope from the request body (e.g. by looking up
  // the camera), never accept one directly. See src/routes/alerts.js.
  internalApiKey: required('INTERNAL_API_KEY'),

  // Hackathon demo copy: when on (the default here), POST /api/cameras/upload
  // accepts a video file, creates a real `source_type: 'file'` camera, and
  // asks the Python server to launch a pipeline against it. Set DEMO_MODE=false
  // to 404 that route without deleting it.
  demoMode: process.env.DEMO_MODE !== 'false',

  // Public GitHub + a live demo: leave signup on for local/dev, turn it off
  // on the VM with SIGNUP_ENABLED=false so strangers cannot create orgs.
  signupEnabled: process.env.SIGNUP_ENABLED !== 'false',

  // Bind address. Unset = all interfaces (local Vite proxy). On the VM set
  // LISTEN_HOST=127.0.0.1 so only nginx on :8001 can reach the API.
  listenHost: process.env.LISTEN_HOST || null,

  // detecto-backend/server (the process that owns POST /pipelines). Same
  // machine as this API in the local demo; the uploaded file's absolute path
  // is handed across as `video` on that call.
  pipelineUrl: (process.env.PIPELINE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, ''),

  uploadDir: path.resolve(process.env.DEMO_UPLOAD_DIR ?? path.join(here, '../uploads')),
  maxUploadBytes: Number(process.env.DEMO_MAX_UPLOAD_BYTES ?? 250 * 1024 * 1024),

  // Access-token (JWT) lifetime. Unaffected by the refresh flow below — the
  // JWT stays exactly as short-lived as it already was; "remember me" only
  // ever changes how long the *refresh* token behind it is allowed to keep
  // reissuing new ones.
  sessionExpiry: {
    default: '1d',
    remembered: '30d',
  },

  // Refresh-token (httpOnly cookie) lifetime, in milliseconds. Same
  // remembered/default split as the access token, and the same numbers —
  // there's no product reason for the two to disagree — but tracked
  // separately since one signs a JWT (`ms` string) and the other computes a
  // Postgres timestamp and a cookie Max-Age (needs milliseconds as a number).
  //
  // This is a sliding window: refresh-tokens.js resets `expires_at` to
  // `now + this` on every successful rotation, not just at issuance. "Keeps
  // you signed in on this device for 30 days" (the remember-me copy on the
  // login form) reads as "signs you out after 30 days of not using it", not
  // "signs you out exactly 30 days after you logged in regardless of use" —
  // the same sliding behavior most products mean by "remember me".
  refreshExpiryMs: {
    default: 24 * 60 * 60 * 1000,
    remembered: 30 * 24 * 60 * 60 * 1000,
  },

  // Name and scope of the refresh-token cookie. Path-scoped to /api/auth so
  // it's never attached to the (much more numerous) non-auth API calls that
  // don't need it — smaller exposure, and it keeps the cookie out of every
  // other route's request logs.
  refreshCookie: {
    name: 'detecto_refresh',
    path: '/api/auth',
  },

  // Cookies only get the Secure flag when the frontend itself is served over
  // https. Browsers special-case `http://localhost` as a secure context, so
  // this still works for the common local-dev shape (both origins on
  // localhost); a non-localhost, non-https dev setup would need its own
  // arrangement, same as it would for any other secure-cookie auth flow.
  cookieSecure: frontendOrigin.startsWith('https://'),

  // Matches the mock's own numbers (lib/auth/api.ts) exactly, so behavior the
  // frontend already codifies opinions about doesn't shift underneath it.
  login: {
    maxAttempts: 5,
    lockoutSeconds: 900,
  },
};
