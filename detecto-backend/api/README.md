# Detecto API

The Express REST API layer for Detecto's backend: authentication
(`/api/auth/*`) plus core resource endpoints (`/api/alerts`, `/api/cameras`,
`/api/org/*`), built to match `detecto-frontend/src/lib/`'s existing mock
contracts field-for-field — see the design notes below for where a contract
had gaps and how they were filled. Connects to the Postgres schema from
`detecto-backend/db`.

## Setup

```sh
cp .env.example .env    # point at your local Postgres, set a real JWT_SECRET
npm install
npm start                # or `npm run dev` for --watch
```

Requires the `db` package's migrations and seed to have already been run
against the same database (see `../db/README.md`) — `users`, `roles`,
`organizations` and `plans` all need to exist and be populated (`plans`
specifically, since signup resolves a default plan id from it).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{email, password, remember}` → `{accessToken}` |
| POST | `/api/auth/signup` | — | Creates an org + its default Admin role + one user → `{accessToken}` |
| POST | `/api/auth/logout` | — | Always `{ok: true}` — see note below |
| POST | `/api/auth/password-reset` | — | `{email}` → always `{ok: true}` |
| GET | `/api/alerts` | `alerts:view` | `?status=&kind=&cameraId=` filters (additive; mock has none) → `{alerts: Alert[]}` |
| GET | `/api/alerts/:id` | `alerts:view` | `Alert` direct, or `404` |
| POST | `/api/alerts/:id/confirm` | `alerts:confirm` | `Alert` direct — sets `decidedBy` to the caller's email |
| POST | `/api/alerts/:id/dismiss` | `alerts:confirm` | same as confirm, `status: 'dismissed'` |
| GET | `/api/cameras` | `cameras:view` | `{cameras: Camera[]}` |
| POST | `/api/cameras` | `cameras:view`* | `{cameras: NewCamera[]}` → `201 {cameras: Camera[]}` |
| GET | `/api/cameras/:id` | `cameras:view` | `Camera` direct, or `404` |
| PATCH | `/api/cameras/:id` | `cameras:view`* | `{name?, zone?}` → `Camera` direct |
| GET | `/api/org/settings` | `org:settings` | `{profile, security}` direct |
| PATCH | `/api/org/settings` | `org:settings` | `{profile?, security?}` (whole objects, not sub-patches) → same shape |
| GET | `/api/org/directory` | `users:manage` | `{roles: Role[], people: Person[]}` direct — the real contract for "list roles" |
| POST | `/api/org/roles` | `users:manage` | `RoleDraft` body → `201 Role` direct, or `409 duplicate_name` |
| PUT | `/api/org/roles/:id` | `users:manage` | `RoleDraft` body → `200 Role` direct |
| GET | `/health` | — | Liveness check |

\* No `cameras:manage` permission exists in the frontend's catalogue — see
the design notes.

Every endpoint above except `/api/auth/*` and `/health` requires:
1. A valid bearer JWT (`Authorization: Bearer <token>`) — `401` otherwise.
2. A non-null `orgId` in that token — `403` for platform/super-admin
   accounts, which have no org to scope to (see design notes).
3. The specific permission listed above — `403` otherwise.

Every query is scoped to `req.claims.orgId`; no endpoint accepts an org id
from the client in any form.

### Path note

The task that produced this named the reset endpoint
`/api/auth/forgot-password`. It's implemented at `/api/auth/password-reset`
instead, because that's the path `detecto-frontend/src/lib/auth/api.ts`'s
`requestPasswordReset()` actually calls — matching the real contract took
priority over the task text's paraphrase of it.

## Design notes (decisions made where the frontend contract had gaps)

- **JWT claims** match `lib/auth/claims.ts`'s `Claims` type field-for-field
  (`sub, email, role, permissions, orgId, exp`, plus a harmless `iat` the
  frontend's decoder ignores). Signed HS256 with `JWT_SECRET` — the mock's
  `alg: 'none'` unsigned token is gone.
- **`role` derivation**: the frontend's coarse `'super_admin' | 'org_admin'
  | 'member'` has no column in the schema — roles are custom per org by
  design (`db`'s `roles` table). Derived at token-issue time instead:
  `is_super_admin` → `'super_admin'`; holding the org's `is_default` role
  (the one every org's signup/seed creates, called "Admin") → `'org_admin'`;
  anything else (a custom role, or no role) → `'member'`. See
  `src/lib/tokens.js`.
- **"Remember me"** maps directly to JWT expiry — 30 days vs. a 1-day
  default — with no refresh-token/cookie endpoint in this pass. The mock's
  intended design (an httpOnly refresh cookie behind a short-lived access
  token) isn't built; the JWT returned from login/signup *is* the whole
  session. `POST /api/auth/logout` is a no-op for the same reason: there's
  no server-side session or refresh cookie to revoke. A future pass wanting
  actual server-side revocation needs a refresh-token table and a
  `/api/auth/refresh` endpoint — neither exists yet.
- **Enumeration safety** (preserved from the discovered frontend contract):
  - Login returns the identical `401 {"error":"invalid_credentials"}` for
    an unknown email, a wrong password, and a non-`active` account status
    (invited/deactivated) — same status, same body. A dummy argon2 hash is
    verified when no user is found (`src/lib/passwords.js`) so the
    unknown-email path costs roughly what the real one does — otherwise the
    *timing* would leak what the identical body doesn't.
  - Failed-login rate limiting (5 attempts / 900s lockout, matching the
    mock's own numbers) is keyed by the submitted email string, not by
    whether it resolves to a real account — so the lockout schedule itself
    can't be used to probe which emails exist.
  - `password-reset` always returns `200 {"ok": true}`, whether or not the
    account exists — the "send" is stubbed to a `console.log` of what would
    be emailed, fired only when the account is real, but the response the
    caller sees never reflects that.
  - **Signup is the one exception, deliberately**: `409 {"error":
    "email_taken"}` on a collision. It's the applicant's own submitted
    email, not a third party probing — see the report for this reasoning.
- **Password reset tokens aren't persisted.** No `reset-password` endpoint
  to consume one was requested this pass, so there's nothing to build the
  persistence for yet — the stub only logs what a real email would contain.
  A real implementation needs a single-use, expiring, hashed token table
  plus a consuming endpoint before this does anything but log.
- **Signup's phone field** goes to `organizations.contact_phone` (and the
  signup email to `organizations.contact_email`) — the `users` table has no
  phone column. This seeds the org's own contact info from the person
  signing up, which the org settings page (`lib/org/api.ts`) can change
  later.
- **Signup's plan resolution**: an explicit `planId` is honored only if it
  belongs to the requested `accountType`'s audience; otherwise (or if
  omitted) it falls back to the cheapest plan for that audience — the same
  fallback shape as `recommendPlan()` in `lib/plans.ts`.
- **The response-shape rule, ported exactly**: every mock module follows one
  pattern — a single record comes back as the response body directly (no
  `{alert: ...}` wrapper), a list comes back wrapped under its plural key
  (`{alerts: [...]}`). Every route above matches this per-endpoint, not by
  convention alone — e.g. `GET /api/alerts/:id` returns the `Alert` object
  at the top level, but `GET /api/alerts` wraps it in `{alerts: [...]}}`.
- **Super admins are blocked from every route in this file**, independent
  of the permission check. `can()` trivially returns `true` for
  `role: 'super_admin'` on any permission string, which would otherwise let
  a platform account through every `requirePermission()` below — so
  `requireOrgScope` (in `src/middleware/auth.js`) checks `orgId !== null`
  first, on every route, regardless of role. This isn't a permission rule;
  it's `lib/tenants/api.ts`'s own stated boundary ("a super admin... does
  not get to watch the customer's cameras") enforced at the API layer.
- **No `cameras:manage` permission exists.** `lib/roles/permissions.ts`
  says outright that camera admin was never gated by more than "being in
  the org area at all." `cameras:view` is used as the mutation gate on
  `POST`/`PATCH /api/cameras` as the closest real stand-in — meaning today,
  anyone who can *see* cameras can also add or rename one. A future
  `cameras:manage` key should replace this on both routes.
- **"List roles" is `GET /api/org/directory`.** The mock has no roles-only
  endpoint — `getDirectory()` always returns roles and people together —
  so that's what's implemented, rather than a narrower endpoint the real
  frontend would never call.
- **`PATCH /api/org/settings` takes whole objects, not field patches.**
  `saveOrgProfile(profile: OrgProfile)` always sends the complete profile,
  never one field of it — so `profile`/`security` in the request body are
  validated and written as units. A partial-merge implementation was tried
  first and had a real bug: a `profile` sent without an explicit `type` key
  would have silently cleared `org_type` to null on every save, because
  there's no way to distinguish "clear this field" from "didn't touch this
  field" once you're merging field-by-field against a caller that never
  sends partial objects.
- **`GET /api/cameras/:id` and `PATCH /api/cameras/:id` don't exist in the
  mock at all** — designed fresh, following the same direct-object pattern
  as every other single-record endpoint. `PATCH` only allows `name`/`zone`;
  `online`/`lastSeen` are device-reported and wiring the ingest pipeline to
  set them is a later, separate task. `PATCH` also does *not* do the
  atomic cross-table zone rewrite `lib/zones/api.ts`'s `renameZone()` does
  (cameras + roles + notification_routes together) — that's a distinct
  "rename this zone everywhere" operation on a module out of this task's
  scope; this only moves the one camera.

## Test credentials

Seeded by `../db/seed.js`:

```
email:    admin@northgate.example
password: detecto-test-password
```
