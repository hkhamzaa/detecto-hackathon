# Detecto DB

Postgres schema and migrations for Detecto's backend, built from what
`detecto-frontend` actually expects (its `lib/*/api.ts` types), not
invented ahead of the frontend. Schema and seed data only — no API server
lives here yet.

## Requirements

- Postgres 13+ (uses the built-in `gen_random_uuid()`, no extensions)
- Node 18+

## 1. Point at your local Postgres

Copy the example env file and adjust it for your instance:

```sh
cp .env.example .env
```

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/detecto_dev
```

Create the database if it doesn't exist yet:

```sh
psql -U postgres -h localhost -c "CREATE DATABASE detecto_dev;"
```

## 2. Install dependencies

```sh
npm install
```

## 3. Run migrations

```sh
npm run migrate:up      # apply all pending migrations
npm run migrate:down    # roll back the most recent migration
npm run migrate:create <name>   # scaffold a new migration
```

Migrations are managed by [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/)
and tracked in a `pgmigrations` table it creates automatically. Migration
files live in `migrations/`.

## 4. Seed

```sh
npm run seed
```

Seeds two kinds of data:

- **Catalogue data** — the 5 subscription plans (`lib/plans.ts`) and the
  6-module detection catalogue (`lib/modules/catalogue.ts`, `weapon` and
  `violence` live, four `coming_soon`). These are fixed, platform-authored
  lists the schema needs populated for foreign keys to resolve against,
  not test data.
- **One test organization** ("Northgate Logistics", on the `site` plan),
  its default Admin role (every permission, matching what
  `lib/roles/api.ts` seeds for a brand-new org), one test user
  (`admin@northgate.example`, password `detecto-test-password` — real
  argon2 hash, usable against `detecto-backend/api`'s real login endpoint,
  not a placeholder), and two test cameras ("Main entrance", "Loading
  bay"). Enough to poke at the schema by hand — not full parity with the
  frontend's dev-mock data.

The seed is safe to re-run: every insert is keyed and skips or upserts on
conflict rather than duplicating rows.

## Schema overview

16 tables, grouped by what they cover:

| Group | Tables |
|---|---|
| Tenancy | `organizations`, `users`, `roles`, `refresh_tokens` |
| Hardware | `boxes`, `cameras` |
| Detection | `modules`, `camera_modules`, `alerts` |
| Compliance | `audit_log` |
| Billing | `plans`, `subscriptions`, `invoices`, `plan_changes` |
| Notifications | `notification_routes`, `notification_escalation_policy` |

A few things worth knowing before touching this schema:

- **A "zone" is not a table.** The frontend (`lib/zones/api.ts`) treats a
  zone as a name repeated across `cameras.zone`, `roles.zones` and
  `notification_routes.target`, rewritten atomically across all three by
  a rename/merge — never looked up by id. Giving it a table would invent
  a record the product doesn't have.
- **`roles.permissions` is a `text[]`, not a join table.** The frontend's
  permission catalogue (`lib/roles/permissions.ts`) is a static constant
  with no per-permission data worth normalizing into rows of its own.
- **`modules.status` is frozen to exactly `'live'` or `'coming_soon'`**,
  enforced by a check constraint, plus a second constraint that nothing
  not `'live'` can carry a `false_positive_rate` — matching the
  frontend's own reading of the contract exactly.
- **`audit_log` is append-only at the database level**, not just by API
  convention. A trigger rejects any `UPDATE` or `DELETE` outright. Its
  `actor_id` / `actor_name` / `actor_role_name` columns are deliberate
  snapshots, not foreign keys to `users` / `roles` — a role gets renamed
  or deleted, a person can leave, but the entry must go on saying what
  was true when it happened. Because the trigger blocks even the
  `UPDATE`/`DELETE` that a `CASCADE` or `SET NULL` foreign key would
  trigger automatically, `audit_log.org_id` and `audit_log.alert_id` are
  both `ON DELETE RESTRICT`: you cannot delete an organization or an
  alert while audit history still references it.
- **`plan_changes.org_id` is nullable, `org_name` is not.** A cancelled
  account leaves the tenant registry; the change history has to go on
  naming it, so the org name is captured as a snapshot the same way an
  audit entry's actor is.
- **`notification_routes` rows only exist for overrides.** "Back to
  default" is a row deletion, never a stored null — matching
  `lib/notifications/api.ts`'s `mockSetRoute` exactly. An empty
  `role_ids` array is a real, different state: narrowed to nobody.

## Not yet built

Deliberately out of scope for this pass (per the task that produced this
schema):

- No API endpoints — schema and migrations only.
- No password reset tokens table — `POST /api/auth/password-reset` is
  stubbed (no email sender, nothing persisted); see the comment on that
  route in `detecto-backend/api/src/routes/auth.js`.
  (`refresh_tokens` *is* now built — see the `add-refresh-tokens`
  migration — backing the httpOnly refresh cookie the frontend's
  `auth-store.ts` boot-seam comment describes.)
- `health` and `analytics` have no tables — both are computed from other
  tables (`alerts`, plus live infrastructure metrics that aren't Detecto
  application data at all), not stored entities.
