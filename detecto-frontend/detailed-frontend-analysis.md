# Detecto Frontend — Detailed Project Analysis

**Scope of this document:** a complete, file-by-file, decision-by-decision account of the frontend codebase as it stands. It covers what exists, what doesn't, why things were built the way they were, and where the deliberate gaps are. Written from a pure frontend-engineering perspective — architecture, data flow, UI system, routing, state, testing, and the product reasoning embedded in the code itself.

Repository: `detecto-frontend`, pushed to `https://github.com/hkhamzaa/detecto-frontend`, single commit `05932cd` on `main` at time of writing. 227 tracked files.

---

## 1. What the product is

Detecto is AI weapon-and-violence detection layered onto a customer's **existing** CCTV. A small appliance ("the Detecto Box") plugs into a customer's network, pulls the video feeds their recorder or cameras already produce, and runs detection models against them. The one non-negotiable product rule, restated in code comments, page copy, and test assertions dozens of times across the codebase, is:

> **A detection never reaches anyone until a human confirms it. Nothing is ever reported to an external authority automatically.**

This isn't a footnote — it's the organizing principle of the entire frontend. The confirmation interaction (`HoldToConfirm`) is explicitly the *only* interaction in the product "allowed to feel heavy." Every other surface is deliberately quiet so that one moment of human judgment reads as the loudest thing on the screen. This shows up in extremely concrete ways: alert-decision mutations are never optimistic (the UI must not claim a human decided something before the server confirms it did), escalation settings notify *colleagues*, never emergency services, and every place the product could plausibly imply automation creeping toward "the machine decided" has explicit copy denying it.

The frontend serves three audiences through one codebase, strictly separated by routing area:

1. **Super Admin** (Detecto's own staff) — operates the platform: tenant accounts, platform billing/revenue, module rollout, system health, support.
2. **Org Admin** — runs one customer organization: their cameras, their people/roles, their own billing, their alert queue, their notification routing, their audit log.
3. **Member / scoped operator** — a person inside an org who only watches an alert queue and/or a camera list, scoped by fine-grained permission grants rather than a role tier.

---

## 2. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | React 19 + Vite (rolldown-vite, per `vite@^8`) | SPA — login-gated, no SEO surface, `noindex, nofollow` in `index.html` |
| Language | TypeScript ~6.0, project-referenced (`tsconfig.json` → app/node/test) | `verbatimModuleSyntax`, `erasableSyntaxOnly`, strict unused-locals/params |
| Styling | Tailwind CSS v4 (CSS-first `@theme`, no `tailwind.config.js`) + shadcn/ui primitives | `components.json` configured for `npx shadcn add` to keep working |
| Server state | TanStack Query v5 | One `QueryClient`, 30s default `staleTime`, `refetchOnWindowFocus: false`, `retry: 1` |
| Client/UI state | Zustand v5 | Three stores: `auth-store`, `signup-store` (persisted), `ui-store` |
| Routing | React Router v7, code-split per role-area via `React.lazy` | Route matching **after** a permission gate, not before |
| Icons | `lucide-react` | |
| Class merging | `clsx` + `tailwind-merge` (custom-extended for the app's own type-scale classes) | |
| Variants | `class-variance-authority` (cva) | Used in `Button`, `Badge` |
| Real-time (installed, unused) | `socket.io-client` | Listed as a dependency, explicitly "installed, not yet wired" per README |
| Testing | Vitest v4 + `@testing-library/react` + `happy-dom` | Runs through the app's actual Vite config so `import.meta.env.DEV` and the `@/` alias behave identically to the browser |
| Linting | `oxlint` | Two rules configured: `react/rules-of-hooks: error`, `react/only-export-components: warn` |
| CI | GitHub Actions, `.github/workflows/ci.yml` | `npm ci` → lint → build (`tsc -b && vite build`) → test, on every push/PR |

No backend exists yet for almost the entire product. Every `lib/*/api.ts` module is written as a **real HTTP transport plus a dev-only mock**, switched by `import.meta.env.DEV && VITE_<X>_MOCK !== 'false'`, so a production build always takes the real fetch path regardless of env vars, but `npm run dev` runs entirely against in-memory mocks today.

---

## 3. Design system

### 3.1 Token architecture (`src/index.css`)

All design tokens are declared once, in Tailwind v4's CSS-first `@theme` block, so they're simultaneously available as Tailwind utility classes (`bg-ink`, `text-signal-500`) and as raw CSS custom properties. There is no separate JS theme file.

**Color anchors:**
- `--color-ink: #14181f` — chrome (sidebars, headers, the alert confirmation card's shell). Deliberately *not* pure black.
- `--color-paper: #f7f6f3` — content surfaces, anything read closely (tables, records).
- `--color-paper-raised: #ffffff`, `--color-paper-sunken: #f0efed` — two steps off Paper for card/well distinction.
- `--color-ink-raised`, `--color-ink-hairline` — equivalent steps for chrome.
- `neutral-50…950` — linearly interpolated between Ink and Paper, used for all UI chrome/text hierarchy.

**Two semantic accent ramps, each with one meaning enforced everywhere:**
- **Signal** (`#D64545`, brick red) — *only* two meanings across the entire app: an unconfirmed AI detection waiting on a human, or a genuine error/danger state (destructive button, failed request, offline camera, suspended account, silent box). Never decorative.
- **Confirm** (`#3E7C6B`, muted teal-green) — human-verified state and trust actions. It also backs the global focus ring (`--ring: #3e7c6b`), a deliberate choice recorded in a code comment: *"Focus lives on Confirm, so Signal stays reserved for real detections."*

**Typography:** three families, each with one job —
- `General Sans` (display) — headings, used sparingly.
- `Inter` (body/sans) — everything a person wrote.
- `JetBrains Mono` (mono) — everything a machine reported: camera IDs, confidence scores, timestamps, invoice numbers. The README calls this out explicitly: *"the product is genuinely full of machine metadata, so the mono is functional, not decorative."* `.font-mono` additionally forces `font-variant-numeric: tabular-nums` globally so columns of numbers align.

All three fonts are **self-hosted** from `public/fonts/` (declared in `src/fonts.css`), specifically because "no third-party font requests at runtime... is a hard requirement for air-gapped and government deployments." Inter and JetBrains Mono ship as variable fonts split by `unicode-range` so a Latin-script session only downloads ~123KB of the vendored 323KB.

**Type scale:** a nine-step custom scale (`display-xl/lg/md/sm`, `title`, `body`, `meta`, `data`, `micro`), each with its own line-height and letter-spacing declared alongside the font-size — not just a size ramp, a fully specified typographic scale. `data` and `meta` share the same font-size (0.8125rem) but different letter-spacing, because one is prose and one is machine data set in mono.

A `.label-micro` utility class (mono, uppercase, wide tracking) is the recurring "eyebrow" style used for every section label, column header, and status caption across the whole app.

**A genuinely tricky bug fix lives in `lib/utils.ts`:** Tailwind-merge's default config has no visibility into the app's custom `text-*` size scale, so it categorized `text-meta`, `text-body`, `text-data` etc. as *color* utilities (the catch-all `text-*` group), which meant `cn('text-primary-foreground text-meta')` silently deleted the color class instead of merging correctly — buttons rendered their label in the inherited (invisible) color. The fix explicitly extends `tailwind-merge`'s `font-size` class group with the app's own scale names.

### 3.2 Motion & accessibility baked into the token layer

- `@media (prefers-reduced-motion: reduce)` at the CSS root flattens **all** animation/transition durations to near-zero globally — the default assumption every component can rely on without checking anything.
- Components that convey *meaning* through duration (only `HoldToConfirm`) additionally swap to a non-timed, explicit two-stage interaction rather than just "the same animation, faster" — because a duration cue that plays faster than intended is not the same signal, it's a broken one.
- `:focus-visible` is globally styled with a 2px outline in Confirm and `outline-offset: 2px`, and is never suppressed anywhere in the codebase (no `outline-none` without an explicit `focus-visible:outline-*` replacement — I checked every primitive).

### 3.3 shadcn/ui semantic layer

A second, thinner CSS-variable layer (`--background`, `--primary`, `--border`, `--ring`, etc.) maps shadcn/ui's expected variable names onto the tokens above, redefined per light/dark via `:root` and `.dark`. Chrome regions (headers, sidebars, the alert confirmation card) opt into the dark palette by wrapping their subtree in a `.dark` class, so shadcn primitives (`Label`, `Separator`) invert in place with zero chrome-specific component variants needed.

### 3.4 The style guide page (`/style-guide`, `src/pages/style-guide.tsx`, 770 lines)

A living internal design reference, publicly routed (unauthenticated, listed as a public route alongside login/signup) and explicitly labeled "internal style guide · foundation v0.1 · not for release." Five sections, each anchor-linked from a sticky sidebar (collapsing into the same drawer pattern as the real app shell below `lg`):

1. **Color** — the Ink/Paper/Signal/Confirm swatches with usage notes.
2. **Type scale** — every step of the scale rendered live.
3. **Buttons** — all variants and sizes.
4. **Data table** — the shared `Table` primitive with the horizontal-scroll-on-mobile pattern documented.
5. **Alert confirmation** — a fully live, interactive mockup of the `HoldToConfirm` control (both the default press-and-hold and the forced two-stage/reduced-motion variant, side by side, with a "Reset demo" button), plus a written list of interaction rules (1.4s hold, real elapsed-time fill via `requestAnimationFrame` not a CSS easing curve, released-early announces itself rather than resetting silently, key-repeat ignored so a stuck key can't fake a hold, reduced-motion becomes a self-disarming two-stage confirm, state changes announced via a polite live region, and "confirmation unlocks escalation, it does not perform it").

This page is genuinely the design contract the rest of the app is built against — nearly every visual/interaction rule described in this document traces back to something asserted here first.

---

## 4. Application shell & global structure

### 4.1 Bootstrapping (`src/main.tsx`)

The whole app is `<StrictMode><QueryClientProvider><RouterProvider /></QueryClientProvider></StrictMode>`. Nothing else. `queryClient` (`lib/query-client.ts`) is a single module-level singleton with the defaults above.

### 4.2 Signed-in shell (`components/app-shell/`)

`AppShell` is the layout every authenticated route renders inside (mounted once at the router's shell level, with `<Outlet/>` for the page). It composes:

- **`AppHeader`** — sticky Ink header. Shows: a hamburger toggle (mobile only, only if the person has a nav area at all), the Detecto wordmark, the current nav area's title + a derived "scope label" (which org/tenant is being looked at — `scopeLabel()` in `lib/auth/labels.ts` turns `org_northgate` into "Northgate" as a stand-in until the session carries a real display name; a super admin with no `orgId` reads "All tenants"), the signed-in email + role badge (hidden below `md`), and a sign-out button.
- **`SidebarNav`** — the actual nav list, shared verbatim between the desktop sticky sidebar and the mobile drawer so the two literally cannot show different items (same component, same `area.items` array, one is just rendered inside `<NavDrawer>`). Renders nothing for a route the person can't reach — items aren't disabled, they don't exist in the array at all (`navFor()` already filtered them).
- **`NavDrawer`** — the below-`lg` mobile nav. Built as a real modal dialog: traps focus with a manual Tab-cycle handler, closes on Escape, closes on backdrop click, locks `document.body.style.overflow`, and restores focus to whatever element opened it on close. The slide-in is a plain CSS animation that the global reduced-motion rule already flattens — no separate reduced-motion code path needed here.
- Route-change focus management: on every `location.pathname` change (skipping the very first render so initial load doesn't steal focus), the content wrapper (`tabIndex={-1}`) receives focus and the window scrolls to top — the same pattern independently reimplemented in the login flow, the signup wizard, and the camera-connect wizard (all four flows manage focus-on-step-change with the identical `useRef` + `isFirstRender` guard idiom).
- Below `lg`: `lg:grid lg:grid-cols-[15rem_1fr]` with the sidebar in the first column; above that breakpoint the sidebar is hidden entirely (`hasNav && ...`) and the drawer takes over.
- A "skip to content" link is the very first focusable element on every authenticated page (and independently on the style guide and signup pages).

`AppShell` returns `null` if there are no claims — but this is provably unreachable in practice because `RequireSession` (the router-level guard) already redirects before this component mounts; the `null` is a type-safety statement, not a real code path.

### 4.3 `AuthShell` (`components/auth-shell.tsx`)

The much simpler wrapper used by `/login` and `/forgot-password`: Ink header bar with the wordmark, a single centered lit Paper card (`max-w-md`), optional footer slot below the card (used for "No account yet? Create one" / "Remembered it? Sign in").

### 4.4 Page-level primitives (`components/app-shell/`)

- **`PageHeader`** — eyebrow label + `<h1>` + optional lead paragraph + optional right-aligned action slot. Owns the browser tab title via `useDocumentTitle` (sets `document.title = \`${title} · Detecto\`` on every mount, no cleanup — "a stale title is less confusing than a flash of the default one").
- **`PagePlaceholder`** — the pattern used for every route that exists in navigation but has no feature behind it yet: renders the real `PageHeader`, then a `Panel` labeled "Nothing to show yet" with a bulleted `coming` list of what will actually be built (specific, not generic — "a route that cannot describe what belongs on it probably should not be in the nav," per its own doc comment) and an optional trailing `note`.

---

## 5. Authentication & session model

### 5.1 Claims (`lib/auth/claims.ts`)

`Claims = { sub, email, role, permissions: string[], orgId: string|null, exp }`. `role` is one of exactly three values: `super_admin | org_admin | member`.

`decodeClaims(token)` **decodes** the JWT payload (base64url + `JSON.parse` with a runtime shape guard, `isClaims()`) — it explicitly does **not verify** a signature, and the code comment is blunt about it: *"The browser has no signing key and never will... Someone who forges a token gets a nicer-looking menu and a 403 on the first call it makes."* This is the single most important architectural statement in the codebase: **nothing about routing, nav-building, or permission gating in the frontend is a security boundary.** It decides what to *draw*; the backend is asserted (in every relevant module's doc comment) to re-check every permission on every request.

`can(claims, permission)` — the single authorization primitive used everywhere: super admins hold every grant implicitly (`role === 'super_admin'` short-circuits to `true`); everyone else must have the exact string in `claims.permissions`.

`isExpired(claims, now)` — pure `exp * 1000 <= now` check.

### 5.2 Auth store (`store/auth-store.ts`)

Deliberately **not** persisted (no Zustand `persist` middleware). The access token lives in memory only, for exactly one reason spelled out in the file's own comment: a refresh is expected to be recovered via an httpOnly refresh cookie the backend would set, which JavaScript cannot read — so nothing token-shaped is ever written to `localStorage`/`sessionStorage`. A page reload today drops the session and bounces to `/login`; the comment marks a specific "boot seam" for where a future refresh-on-load effect would go, and explicitly states this is not wired up yet because it depends on a backend that doesn't exist.

`signIn(token)` decodes and stores claims **and returns them synchronously**, specifically so the caller (the login form) can route immediately without waiting a render cycle for the Zustand subscription to fire.

### 5.3 Auth transport (`lib/auth/api.ts`)

Real endpoints defined and coded against a contract that doesn't exist yet: `POST /api/auth/login` (with `credentials: 'include'` so the backend can set an httpOnly refresh cookie), `POST /api/auth/password-reset`, `POST /api/auth/logout`. All three have a dev mock behind the `USE_MOCK` flag.

Notable real-transport details that are already correct even though there's no backend to hit yet:
- `401` on login covers *both* unknown email and wrong password — the backend is expected not to distinguish them, and neither does anything downstream (the login form shows one identical "Email or password is incorrect" message either way, to avoid leaking which emails have accounts).
- `429` maps to a `rate_limited` result carrying a `retryAfterSeconds` read from the `Retry-After` header (falling back to a 900s default if the header is missing/garbage).
- Password reset always returns `{ ok: true }` unless the request genuinely fails to reach the server — "any completed response is treated the same. The screen must not reveal whether an account exists."
- Logout never rejects; it's fire-and-forget from the caller's perspective because the local session is torn down regardless of what the server says.

**The dev mock** (`mockLogin`) is a small but complete fake identity provider: any email works, the only password that succeeds is `detecto-demo` (the one intentionally-known-fine "secret" in the repo, confirmed via a dedicated security scan before the first commit), and the **role and permission set are derived from the local-part of the typed email**:
- `super@...` → `super_admin`, no explicit permissions needed (implicit via role).
- `admin@...` → `org_admin` with the full org permission set hand-maintained in this file (`org:overview`, `cameras:view`, `modules:manage`, `alerts:view`, `alerts:confirm`, `history:view`, `users:manage`, `analytics:view`, `billing:manage`, `org:settings`, `audit:view`).
- `viewer@...` → `member` with only `cameras:view`.
- `nobody@...` → `member` with zero permissions (lands on `/no-access`).
- anything else → `member` with `alerts:view`, `alerts:confirm`, `cameras:view`.

A five-attempt lockout counter is simulated (`MOCK_ATTEMPT_LIMIT`), and the JWT itself is built by hand (`base64Url()` helper) with an unsigned `alg: none` header and a literal string `'mock-signature-not-verified'` in the signature slot — impossible to mistake for a real token if inspected.

### 5.4 Login flow (`pages/login/`)

`LoginPage` is architected as a step container (`LoginStep = 'credentials' | 'mfa'`) even though only one step is reachable today — this is a deliberate seam so a real MFA challenge can be dropped in later without restructuring the page. `MfaStep` exists and renders an honest "this isn't part of this build yet" dead end with the challenge ID shown, purely so that if a backend ever starts sending `mfa_required` early, the app doesn't render a blank card.

`CredentialsStep` — a fully built, production-quality form: client-side email/password presence + email-shape validation before any network call, a "Remember me" checkbox (explicitly stated to only extend a backend-issued cookie, never stored client-side), focus-management on failure (invalid field focused via `focusFirstInvalid`, or the alert region focused for transport/rate-limit errors, or the password field specifically re-focused on wrong-credentials since it's "the field most likely to need changing"), and distinct copy for each of the four failure modes (`generic`, `rate_limited` with a humanized wait time, `unavailable`, `mfa_required`).

### 5.5 Forgot-password flow (`pages/forgot-password/index.tsx`)

Two-stage local state machine (`form | sent`), same focus-on-stage-change pattern. The "sent" screen deliberately says "if that email has an account, we've sent a reset link" — never confirming existence — and states the link "works once and expires in 30 minutes," with the current password remaining valid until reset completes.

### 5.6 Signup flow (`pages/signup/`)

A four-step wizard (`store/signup-store.ts` drives it) fully independent of the authenticated app shell — its own Ink header, its own step container with fade+slide transitions.

**Steps:** 1) Account type (Home vs. Organization/Business — a fork, not a form; choosing advances immediately) → 2) Details (branches internally into `HomeDetails` — camera-count bucket + optional location label — or `OrgDetails` — org name, org type from a fixed list, camera/people counts via `NumberStepper`) → 3) Credentials (name, email, phone, password ≥10 chars) → 4) Plan & checkout (plan recommendation + card capture) → a `Confirmation` success screen.

**Store persistence is deliberately partial** (`store/signup-store.ts`): persisted to `sessionStorage` (tab-scoped, gone on tab close) via Zustand's `persist` middleware, but the `partialize` function explicitly **strips the password to an empty string** and **omits the entire `payment` object** before writing to storage — because both would otherwise sit in cleartext in a store any script on the origin can read, and a CVC must never be retained at all. A custom `merge` function then detects "we're on step 4 with an empty password" on rehydrate and force-rewinds to step 3 so nobody can reach checkout without having actually re-entered credentials.

**Plan step (`steps/plan.tsx`)** computes a recommendation via `recommendPlan()` (see §6) from the camera/people estimate just entered, shows it expanded with full "Includes" list and a "Recommended" badge, and collapses every other plan in the audience behind a "Show other plans (N)" toggle — which, once the person has explicitly picked a non-recommended plan, stays permanently expanded rather than re-collapsing ("collapsing it would hide the thing the customer actually selected"). Card capture is a real client-side-validated card form (Luhn-length check 13–19 digits, MM/YY expiry with a real "has this month already passed" check, 3–4 digit CVC, billing postcode) — **there is no payment processor behind it**; submitting calls `finish()` which just flips a `complete: true` flag in the store. This is confirmed both by the store code (`finish: () => set({ complete: true })`) and is the same honesty pattern applied everywhere real payment processing doesn't exist yet (see §12).

**Confirmation step** shows plan/price, camera-or-org-name, and people-or-detection-type as a three-column summary, then a "What happens next" numbered list (box ships in 2–3 days, plug it in, detection starts once connected — every flag still waits for confirmation). A "Start over" link resets the whole store.

### 5.7 `/no-access` (`pages/no-access.tsx`)

The destination for an authenticated account with zero navigable permissions. Deliberately framed as *not* an error: "Your account is active and signed in... That is a permissions decision, and it belongs to an administrator in your organisation." Shows the account email and user ID (mono, so it's easy to relay to an admin) and a sign-out button. States plainly that permissions are read at sign-in time, so the person needs to sign out/in again after being granted something.

---

## 6. Routing & area-isolation architecture

This is the single most consistently-enforced architectural discipline in the codebase, and it exists at three independent layers that all have to agree:

### 6.1 Layer 1 — `lib/auth/redirect.ts`: where a person lands

`landingPathFor(claims)` is the **one function** that decides where any signed-in person goes after login (and what `/` redirects to). Role takes priority (`super_admin` → `/admin/overview`, `org_admin` → `/org/overview`), then a cascading permission check for custom/scoped roles: `alerts:confirm` or `alerts:view` → `/alerts`, else `cameras:view` → `/cameras`, else (as of a fix made during this project) `audit:view` → `/org/audit-log`, else `/no-access`.

That `audit:view` branch is worth calling out specifically: it was a **discovered and fixed bug**, not an original design decision. `audit:view` has always existed as its own grant in the permission catalogue and the role builder has always been able to hand it out — but until this fix, anyone holding *only* that grant (a "compliance officer" role pattern explicitly requested by product) landed on `/no-access` because `landingPathFor` had no branch for it. It's placed *last* in the cascade specifically so someone who also watches alerts still lands on their queue first.

### 6.2 Layer 2 — `lib/auth/nav.ts`: what's visible and clickable

Three `NavArea`s are hardcoded (`admin`, `org`, `scoped`), each an ordered list of `{ to, label, icon, permission }`. `permission` can be a single string or an array (meaning "any one of these" — used for the scoped Alert queue item, reachable via `alerts:confirm` *or* `alerts:view`).

`navFor(claims)`:
1. Finds the person's area by locating which `NavArea` contains their `landingPathFor()` destination as one of its items — this is the deliberate coupling that keeps the sidebar and the login redirect from ever disagreeing about which area someone belongs to.
2. Filters that area's items down to only the ones `can()` allows.
3. Returns `null` if no area matches at all.

`canVisit(claims, path)` is just "is this path present in `navFor(claims)`'s filtered item list" — meaning **a route someone cannot click is definitionally the same route they cannot type into the address bar.** There is no second permission list to keep in sync.

`redirectAfterDenial(claims)` — where a refused visit bounces to. Deliberately never back to the page just refused (redirect loop) and never to a landing path the person also can't reach (also a loop) — falls through to `/no-access` as the guaranteed-reachable terminal.

Areas are stated to be **mutually exclusive by design** — a super admin holds every grant implicitly, and the only thing stopping the platform nav and an org's nav appearing simultaneously is this area-membership check, not a permission difference.

### 6.3 Layer 3 — `routes/guard.tsx`: the actual gate

`RequireSession` — no valid, non-expired claims → `<Navigate to="/login" />`. Every authenticated route sits under this.

`Guarded({ path, children })` — the per-route gate. Calls `canVisit`; if refused, redirects via `redirectAfterDenial` **before rendering `children` at all**. This "before rendering" detail is load-bearing: `children` is passed as an already-constructed React element, and — combined with `routes/lazy.ts`'s use of `React.lazy` rather than React Router's own route-level `lazy()` loader — a refused route's JS chunk is **never even requested**, let alone rendered-and-hidden. A member account literally cannot cause the admin bundle to download.

### 6.4 Route table (`routes/router.tsx`)

```
/                          → RootRedirect (asks landingPathFor)
/style-guide               → public
/signup                    → public
/login                     → public
/forgot-password           → public
── inside <RequireSession><AppShell/></RequireSession> ──
/admin/overview            } guarded('admin:overview')
/admin/tenants             } guarded('admin:tenants')
/admin/tenants/:id         } gated by '/admin/tenants'
/admin/billing             } guarded('admin:billing')
/admin/module-flags        } guarded('admin:modules')
/admin/system-health       } guarded('admin:health')
/admin/analytics           } guarded('admin:analytics')
/admin/support             } guarded('admin:support')

/org/overview              } guarded('org:overview')
/org/cameras               } guarded('cameras:view')
/org/cameras/connect       } gated by '/org/cameras'
/org/modules               } guarded('modules:manage')
/org/alerts                } guarded('alerts:view'/'alerts:confirm' — see nav item)
/org/alerts/:id            } gated by '/org/alerts'
/org/history               } guarded('history:view')
/org/users                 } guarded('users:manage')
/org/users/roles/new       } gated by '/org/users'
/org/users/roles/:id       } gated by '/org/users'
/org/analytics             } guarded('analytics:view')
/org/billing               } guarded('billing:manage')
/org/settings              } guarded('org:settings')
/org/settings/notifications} gated by '/org/settings'
/org/audit-log             } guarded('audit:view')

/alerts                    } guarded (scoped, member area)
/alerts/:id                } gated by '/alerts'
/cameras                   } guarded (scoped, member area)

/no-access                 → ungated intentionally (the guard's own destination)
*                          → NotFound
```

### 6.5 Layer 4 — code-splitting (`routes/lazy.ts`, `routes/areas/*.ts`)

Three barrel files — `areas/admin.ts`, `areas/org.ts`, `areas/scoped.ts` — each re-exporting every page in that area under one module. `lazy.ts` wraps each export in `React.lazy(() => admin().then(m => ({ default: m.X })))`. Because every page in an area is imported from the **same** dynamic-import call (`admin()`), the bundler emits exactly one chunk per area — confirmed by the actual build output showing separate `admin-*.js` (~90KB), `org-*.js` (~160KB, the largest area by page count), and an implicit scoped/member chunk. The alert-queue component is shared between `/alerts` (scoped) and `/org/alerts` (org admin) — same component, two routes — and the bundler is noted to correctly lift it into a chunk both areas share rather than duplicating it, without breaking area isolation (nothing *admin-only* is in that shared chunk).

The comment in `lazy.ts` explains precisely why `React.lazy` was chosen over React Router's native route-level `lazy()`: the router's own loader fires while the route match is being resolved, *before* any guard element renders — so the chunk would already be in flight over the network before `Guarded` gets a chance to refuse it. `React.lazy` instead only triggers on actual render, which is downstream of the guard.

### 6.6 Boundary tests as an enforced architectural invariant

This isn't just a design principle stated in comments — it's mechanically tested. `pages/admin/boundary.test.tsx` and `pages/org/billing/boundary.test.tsx` both implement a **static import-graph walker** (reading files off disk with Node's `fs`, following `import`/`export...from` specifiers transitively, resolving the `@/` alias and relative paths by hand) and assert things like:

- No `pages/admin/*` page's transitive import graph touches `lib/alerts/` or `lib/cameras/` (a super admin's bundle must be physically incapable of importing a tenant's camera/alert data layer).
- No `pages/org/billing` (a customer's own bill) transitively imports `lib/tenants`, `lib/billing`, `lib/health`, or `lib/module-flags` (the platform's revenue-oversight data layer) — and the reverse: `pages/admin/billing` must never import `lib/subscription` (a customer's own billing module).
- The walker itself is guarded against silently finding nothing (`it('the module walker actually finds things...')` asserts the graph has >10 files and specifically contains known-good imports) — so an empty result from a broken resolver can't make every other assertion pass for the wrong reason.
- A **positive counterexample** is included on purpose: `pages/org/analytics/index.tsx` is asserted to *cross into* `lib/alerts/`, proving the pattern-matcher can actually fail when it should.
- Beyond the import graph, these tests also **render** the pages against seeded query data and assert the resulting HTML string does not contain any of a hardcoded list of leak indicators: other tenants' names/ids (`Northgate Logistics`, `ten_castleford`, etc.), camera/zone names from the org-side mocks (`Main entrance`, `Loading bay`, `ALR-`, `handgun`, `altercation`), platform-only fields (`Support note`, `Monthly recurring revenue`), links into the other area (`/org/`, `/admin/`), and impersonation controls (`View as`, `Impersonate`, `Sign in as` — deliberately absent everywhere, on the stated principle that a super admin borrowing an org's session would defeat the entire area-isolation model).

This same boundary-test pattern is what caught the union-vs-intersection scoping bug in the notification-routing feature (see §9) — the discipline isn't decorative, it's actively load-bearing engineering.

---

## 7. State management

### 7.1 Server state — TanStack Query

Every feature module follows one convention: a `queries.ts` file exports one `use<Thing>()` query hook per read and one `use<Verb><Thing>()` mutation hook per write, all keyed off a single exported query-key constant (e.g. `TENANTS_KEY`, `MODULES_KEY`, `AUDIT_KEY`). Query functions never throw the raw transport error — they call the corresponding `lib/*/api.ts` function, check its `{ ok: boolean }` result shape, and `throw new Error(result.code)` on failure specifically so Query's own error state does the work, rather than every call site re-checking `ok`.

**Two deliberately different mutation philosophies coexist, chosen per-feature based on stated reasoning:**

- **Optimistic** (immediate UI update, rolled back on server failure) — used *only* where "a switch has to move under the finger": the per-camera module toggle (`useSetModule`) and nowhere else that matters to this product's core promise. It uses the full TanStack Query optimistic pattern: `onMutate` cancels in-flight refetches and snapshots the previous cache value, `onError` restores it, `onSettled` always refetches for the server's last word.
- **Non-optimistic** (UI waits for the server before claiming anything happened) — used for every mutation that's behind a confirm step and, most importantly, for **every alert decision** (`useDecision` in `lib/alerts/queries.ts`). The doc comment states the rule directly: *"this is the one place in the product where the interface must not claim something has happened until the server says it has."* Also applied to: role save/delete, person invite/role-change/deactivate, zone-wide module bulk changes, tenant suspend/reactivate, module-flag release/withdraw, notification routing/escalation changes, and subscription plan-change requests.

`ANALYTICS_KEY` is deliberately kept **outside** the `['alerts']` query-key prefix used by the live queue, specifically so a routine alert confirmation (which invalidates `['alerts']`) doesn't force an 8-week analytics window to re-fetch every time — "a report, not a monitor," with its own 5-minute `staleTime`. Conversely `HEALTH_KEY` is given a *short* 30s `staleTime` for the opposite reason: it's "the one page in the product that is a monitor rather than a report — a stale reading of whether boxes are talking is worse than no reading, because it looks current."

### 7.2 Client state — Zustand

Three stores, each scoped tightly to what it actually owns:

- **`auth-store`** — token + claims, in-memory only (§5.2).
- **`signup-store`** — the multi-step signup wizard, `sessionStorage`-persisted with password/card scrubbed before persistence (§5.6).
- **`ui-store`** — trivially small: just `navOpen` (mobile drawer state) + toggle/close actions. Its own doc comment states the governing rule for the whole state architecture: *"Light, ephemeral UI state only. Anything that comes from the API belongs in TanStack Query, not here."*

No Redux, no Context-based global state anywhere in the app — server state and client state are cleanly separated into exactly the two systems built for each.

---

## 8. The shared component library

### 8.1 `components/ui/` — primitives (shadcn-style, hand-authored to the token system)

| Component | Notable behavior |
|---|---|
| `Button` | `cva`-driven variants: `default`, `secondary`, `outline`, `ghost`, `destructive` (Signal, resting at `signal-600` rather than `-500` specifically so white text clears WCAG AA — 5.70:1 vs 4.38:1 — documented inline), `confirm` (Confirm green), `link`. Sizes `sm/default/lg/icon`. `asChild` via Radix `Slot`. |
| `Badge` | Variants are alert-status-specific (`unconfirmed`, `confirmed`, `dismissed`, `outline`) — explicitly **not** a general-purpose badge; `StatusWord` exists as the plain alternative for every other status in the app (see below) precisely so `Badge`'s meaning stays narrow. |
| `Panel` / `PanelBody` | The core content-grouping primitive used on every single page in the app. A bordered Paper-raised card with an optional hairline-separated label strip (a colored dot + `label-micro` heading + optional right-aligned action slot). `tone` prop (`neutral`/`signal`/`confirm`) colors only the dot. |
| `StatusWord` | The single most important small component in the app for consistency: a colored dot + word, where **the word itself only takes color when something needs a person's attention** ("signal" tone colors both dot and text; "confirm" and "neutral" color only the dot, text stays neutral gray). This one rule — enforced by convention across dozens of usages, never by a lint rule — is why the whole product reads as calm: a screen full of "fine" things stays visually quiet, and the one thing that isn't stands out immediately. |
| `Figure` | One big mono number + Inter label + optional note, used for every KPI-strip across the app (overview pages, analytics, health). Number is mono ("machine-reported"), label/note are Inter ("words a person wrote") — the same type-family division as everywhere else. |
| `Table` family | `Table/TableHeader/TableBody/TableRow/TableHead/TableCell/TableCaption` — wraps in `overflow-x-auto` so every data table in the app scrolls horizontally on narrow viewports instead of reflowing into unreadable stacked cards; this exact tradeoff is independently re-justified in a code comment on nearly every page that uses it ("operators compare rows against each other, so the column relationship has to survive a small screen"). |
| `Input`, `Textarea`, `NativeSelect`, `Checkbox`, `Switch`, `Label` | All native HTML controls wearing the design tokens rather than Radix re-implementations — the recurring justification is "the platform control needs no JS, is keyboard-operable for free, and cannot desynchronise from what it represents." `Switch` vs `Checkbox` is a deliberate semantic split: Switch means "this takes effect now" (module toggles), Checkbox means "this applies when you save" (forms). `Switch`'s "on" state is Ink, not Confirm — "a module being switched on is a setting, not a verdict." |
| `NumberStepper` | +/- buttons around a numeric text input, digit-sanitizing on type, clamped to min/max. Used in signup's org-details step. |
| `Field` | Wires a `Label` + hint/error text to a control via generated ids and `aria-describedby`/`aria-invalid`, via a render-prop child so any control can be dropped in — used by essentially every form in the app. |
| `Badge`, `Separator` | Radix-backed where Radix genuinely adds value (compound-component semantics for Separator's orientation). |

### 8.2 `components/chart/` — the entire charting system

There is **no charting library** in the dependency tree. `components/chart/bars.tsx` is the whole of it: `BarRows` (horizontal, for ranked comparisons like zones) and `BarColumns` (vertical, for time-series like hourly patterns), both built from `<div>` widths/heights, both respecting `prefers-reduced-motion` by driving growth via a `useGrown()` hook that either skips the animation entirely or staggers each segment's `transition-delay` for a single coherent "grow in" on first paint — read from JS as well as CSS specifically so bars never flash empty before the reduced-motion check resolves. Every bar is a `BarDatum` (label + array of `{ tone, value, label }` segments — a plain bar is just a one-segment stack), with a screen-reader-only readout string generated per bar (`"Front of house: 12 alerts — 8 confirmed, 4 dismissed"`) so the chart is fully described to assistive tech independent of the visual bars. `ChartLegend` is a separate, `aria-hidden` component (since each bar already speaks its own split aloud, a legend read aloud too would be redundant).

`NotEnoughData` (`components/chart/not-enough-data.tsx`) is the shared empty/insufficient-data state used across every analytics/health chart: it's explicitly *not* an apology or a blank rectangle — it always states what real counts are known (rendered as `children`) alongside a one-line explanation of what specific volume would make the *shape* (trend/rate/peak) trustworthy. The philosophy, stated in its own doc comment: "a single point stretched across a chart built for eight weeks of trend reads as a flat line, and a flat line is a claim — that nothing is changing — which nobody has the data to make."

### 8.3 `components/alert/` — the alert system's shared UI

- **`AlertQueue`** — one component mounted at two routes (`/alerts` for a member, `/org/alerts` for an org admin), which of these alerts come back being entirely the server's/session's decision, never a frontend branch. Segmented filter (`Awaiting human / Confirmed / False positive / All`, URL-synced via `useSearchParams` with `replace: true` so flicking segments doesn't spam the back button) using styled native radios. Sort rule: **unreviewed-first is not a tie-break, it's the point** — status sorts before recency so nothing waits on a person just because it happened on a quiet afternoon and got pushed down by already-handled items.
- **`AlertDetail`** — the confirmation card. Rendered on Ink chrome *inside* the Paper page specifically to visually separate "the one moment that carries responsibility" from the list that led there. Shows camera/zone/confidence/detected-time/model in a mono fact grid, embeds `HoldToConfirm`, and — critically — after a decision is made, shows an `Outcome` panel whose copy is the single most carefully-worded paragraph in the codebase, restated verbatim in multiple places: *"Detecto has not contacted anyone. Confirming records that a person took responsibility for this flag. Escalating it — telling a colleague, a guard, or an emergency service — is a separate action that a person still has to take, and it has not been taken."*
- **`HoldToConfirm`** (already covered in detail in §3.4) — the flagship interaction. Two interaction modes chosen via `prefersReduced || forceTwoStage`; a state machine (`idle → holding → armed|confirmed`) driven by `requestAnimationFrame` for the timed variant and explicit two-click arm/confirm with an 8-second self-disarm for the reduced/forced variant; full keyboard support (Space/Enter to hold, key-repeat explicitly ignored, Escape to disarm); an ARIA live region separate from the visible readout text so screen readers get a clean announcement (`"Detection confirmed at 14:32:07. Escalation unlocked."`) rather than reading the constantly-updating countdown.
- **`AlertStatus`** — the `StatusWord`-based status chip: only `unconfirmed` gets Signal.
- **`EvidenceFrame`** — a placeholder for the actual video/still frame the model would have flagged. No imagery pipeline exists yet; rather than fake a gray box, it renders styled corner-brackets (borrowed from the style guide's "evidence frame" motif) around a caption reading "Captured frame" — explicitly framed as "admits it is waiting for one rather than filling itself with grey."

### 8.4 `components/camera/`

- **`CameraFrame`** — same "no imagery yet, admit it" pattern as `EvidenceFrame`, smaller/muted variant for problem cameras during discovery.
- **`CameraStatus`** — `StatusWord`; a camera that's offline is treated as an active fault (Signal), not a neutral state, "because a camera nothing is receiving from is watching nobody."
- **`NoCamerasYet`** — the single shared empty-state component reused verbatim (only the opening `lead` sentence differs) by the camera list, the modules page, and the analytics/history pages — every one of those has the exact same actual precondition (no cameras connected), so rather than four different "no cameras" screens that could drift, there is one, with a "What you'll need" checklist and a CTA into the connect wizard.

### 8.5 `components/admin/tenant-status.tsx`

The platform-side equivalent of `AlertStatus`/`CameraStatus`: `active`/`trial` are neutral facts, `suspended` gets Signal (a customer's cameras being watched by nothing is a fault), and a trial with ≤3 days left (`TRIAL_ENDING_DAYS` in `lib/tenants/labels.ts`) also escalates to Signal since it's "a conversation somebody needs to have this week."

---

## 9. The `lib/` data layer, module by module

Every feature module in `lib/` follows one consistent shape, restated as a doc comment at the top of nearly every `api.ts` file: **one exported function per operation, a real `fetch`-based transport, and a dev-only in-memory mock**, switched by a per-module `VITE_<NAME>_MOCK` env flag that only has effect in `DEV` builds. Real transports never throw for expected failures — they return a discriminated-union `Result` type (`{ ok: true, ... } | { ok: false, code: '...' }`), with specific HTTP status codes mapped to specific `code`s (403→`forbidden`, 404→`not_found`, 409→`not_live`/`protected_role`, 429→`rate_limited`, etc.) so the UI can branch on meaning rather than status numbers. Every parser (`toX(value: unknown)`) treats the network response as fully untrusted `unknown` and validates every field defensively — an unrecognized enum value is never trusted forward as if it were a known-good state (the module-status parser explicitly treats an unrecognized status as `coming_soon` rather than `live`: "the failure has to fall on the side of offering less, not of offering something that does not exist").

### 9.1 `lib/plans.ts` — the shared plan catalogue

Not a transport module — a pure static data file, deliberately placed at `lib/` root (not nested) because it's imported by *both* areas' billing surfaces plus signup, and needs to be genuinely neutral, imported by nobody's private data layer. Defines `PLANS: Plan[]` (five plans: `home`, `home-extended` for Home accounts; `team`, `site`, `estate` for Org accounts), each with `monthly` price, `maxCameras`, `maxUsers`, `summary`, and an `includes[]` list. The Detecto Box is explicitly folded into `includes` on every plan rather than priced as a separate line item — "the customer is choosing a plan, not evaluating a hardware purchase" — a rule repeated verbatim in the billing pages' copy.

**This entire catalogue is explicitly, repeatedly flagged in code and on-screen as placeholder pricing nobody has signed off commercially** — the module-flags page, both billing pages, and the org billing "change plan" flow all independently carry the same warning sentence, deliberately kept consistent rather than left to drift.

`recommendPlan(audience, cameras, users)` — smallest plan in the audience whose `maxCameras`/`maxUsers` both cover the estimate; falls back to the largest plan with `overCapacity: true` if nothing fits. `formatPrice()` — whole-dollar formatting shared everywhere a plan price is shown.

### 9.2 `lib/roles/` — people & permissions

- **`permissions.ts`** — `PERMISSION_GROUPS`: the single catalogue of every grant an org can hand out, grouped (`Cameras`, `Alerts`, `Detection modules`, `Records and reporting`, `Running the organisation`), each with a checkbox label, a lowercase verb phrase (for composing summary sentences), a longer description, and an optional `note` reserved for the two grants that hand over something bigger than a screen (`alerts:confirm` — "the only permission that can begin an escalation" — and `users:manage` — "can change what everyone can do, including their own role"). **`admin:*` keys are deliberately absent from this catalogue** — those are Detecto's own platform grants and no org admin UI can issue them. A code comment flags that `cameras:manage` (distinct from `cameras:view`) doesn't exist as a claims-system key yet, so the role builder simply doesn't offer it — connecting/renaming cameras is gated by org-area membership alone today.
  - `summarisePermissions(keys)` turns a raw permission array into a plain sentence ("Can view cameras, confirm alerts and manage billing.") — used live in the role builder's "What you are about to grant" preview panel and in the role list, specifically so "whoever is handing out access has to be able to read what they are handing out" rather than parsing key strings.
  - `summariseScope(zones)` — `null` → "All cameras"; `[]` → "No zones — this role reaches no cameras"; else a joined list.
- **`api.ts`** — `Role { id, name, permissions[], zones: string[]|null, isDefault }`, `Person { id, name, email, roleId, status: active|invited|deactivated, invitedAt }`. `saveRole` (create/edit unified), `deleteRole(id, disposition)` where `disposition` is `{kind:'unassign'}|{kind:'reassign', roleId}` — deleting a role that people hold **requires an explicit disposition decision**, never a silent cascade. `invitePerson`, `setPersonRole`, `setPersonStatus` (active/deactivated only — **there is no delete-person operation**, because "a person's confirmations are part of the organisation's audit trail, and removing them would rewrite a record of who decided what"). The real transport's `saveRole` path strips unknown permission keys server-side-equivalently in the mock too, so the "no key nothing checks" guarantee doesn't depend on the browser being honest.
  - The dev mock seeds exactly **one** role (`Admin`, holding every permission) for a brand-new org — deliberately no invented tier ladder, because "Detecto does not know what your team looks like." Four seeded people cover every status (active, invited-yesterday, invited-11-days-ago/stale, deactivated).
- **Pages built on this:** `/org/users` (`PeopleList` + `RoleList`) and `/org/users/roles/new|:id` (`RoleBuilderPage`) — covered in §10.

### 9.3 `lib/cameras/` — camera connection & registry

`Camera { id, name, zone, online, lastSeen }`. `pairBox(code)`, `discoverCameras(boxId)`, `addCameras(cameras[])`, `listCameras()`. The pairing-code mock (`pairing.ts` for formatting, `api.ts` for the mock logic) is a deliberately rich state machine keyed on the first four characters of an 8-char code: `DEMO`→5 clean cameras, `HALF`→5 with 2 having problems (`needs_password`/`unreachable`), `NONE`→0 found, `DOWN`→pairs then the box goes silent mid-discovery, `GONE`→expired code, anything else→invalid code. Discovered cameras carry a `source: 'box'|'manual'` discriminator so manually-typed-in addresses (for cameras the box's network scan missed) flow through the same list. The camera list starts genuinely empty for a new account and only fills via the connect wizard — "what a new organisation actually sees."

`lib/cameras/pairing.ts` — pure formatting helpers: normalizes to 8 uppercase alnum chars, displays as `XXXX-XXXX`, deliberately does **not** attempt to fold visual look-alikes (`O`↔`0`, `I`↔`1`) because "that can only be done safely by whichever side generates the alphabet."

### 9.4 `lib/modules/` — detection module configuration (org-side)

`catalogue.ts` holds `MOCK_CATALOGUE: DetectionModule[]` — the six-module contract (`weapon`, `violence` live; `loitering`, `zone_intrusion`, `theft`, `forced_movement` coming-soon) — deliberately exported as a **mutable, shared** array specifically so the platform's `module-flags` mock and the org-side `modules` mock read/write the *same* records; two independent mock stores would let a demo show a module live on one page and coming-soon on the other, which is exactly the bug the shared catalogue prevents. `falsePositiveRate` is `null` for anything not live — "a plausible-looking one would be a fabrication."

`api.ts` — `getModuleConfig()`, `setCameraModule(cameraId, moduleId, enabled)` (rejects a non-live module with `not_live`, mirroring a real 409), `setZoneModule(zone, moduleId, enabled)` (bulk). The mock **deliberately fails every 5th write** (`FAIL_EVERY`) — a documented, deterministic (not random) failure injector, specifically so the optimistic-revert UI path is something a developer/reviewer actually encounters by using the page rather than something they have to take on faith.

### 9.5 `lib/alerts/` — the live queue & decisions

`Alert { id, cameraId, cameraName, zone, kind: weapon|violence, subtype, confidence, detectedAt, model, status: unconfirmed|confirmed|dismissed, decidedBy, decidedAt }`. `listAlerts`, `getAlert`, `confirmAlert`, `dismissAlert`. `parseAlert()` is exported specifically because the analytics module reads the *same* records over a longer window and must parse them identically — "a second parser would eventually disagree with this one."

The mock seeds against whatever cameras actually exist (falling back to four placeholder camera/zone names if none have been connected yet, so the queue and camera list can never show contradictory sets), and includes a deliberately curated seed set: three waiting (including one at confidence 0.62 — "the low end of the range is exactly where a human decision earns its place"), two confirmed, two dismissed — every branch the UI needs to draw, reachable without setup.

`lib/alerts/labels.ts` — `statusLabel` ("Awaiting human" rather than "Pending" — "what it is waiting for is the point"), `detectionLabel`, `detectionHeadline`, `confidenceLabel` (always 2 decimals, "a score that reads `0.6` hides whether it was 0.62").

### 9.6 `lib/analytics/` — org-side trend reporting

Fully covered in code detail in §11 below (`stats.ts` is pure, extensively tested arithmetic; `api.ts` provides a rich seeded 8-week mock with a `VITE_ANALYTICS_MOCK` switch offering `sparse`/`empty` states specifically to exercise the "not enough data" branches honestly). `export.ts` was refactored mid-project to delegate its CSV mechanics to the new shared `lib/csv.ts` (§9.11) rather than duplicating the formula-injection guard.

### 9.7 `lib/health/` — platform system health (super admin)

`getPlatformHealth()` returns fleet connectivity (per-tenant box counts, online/offline/never-connected, explicitly excluding suspended-account boxes from the "offline" fault count since "that is the suspension working, not a fault"), API latency/error-rate/uptime with hourly series, queue lag stats, and an infrastructure cost tracker. `lib/health/status.ts` centralizes every threshold used to color anything Signal on this page (`THRESHOLD.boxSilentMinutes: 15`, `boxOutageHours: 6`, `latencyP95Ms: 800`, `errorRate: 0.01`, `uptime: 0.999`, `queueLagSeconds: 60`) — a single reviewable place, with an explicit design rationale for having **no intermediate "warning" tier**: "a page that colours a quarter of itself amber every day is a page people stop reading."

### 9.8 `lib/tenants/` — the platform's account registry (super admin)

The most heavily-commented boundary statement in the codebase. `Tenant` carries only counts (`cameraCount`, `boxCount`, `userCount`) and a single `adminEmail` (billing contact) — **never** a camera list, alert list, or user directory, and the file's top comment states this is "a property of the *types*, not of the components that draw them." `PlatformSummary.alertsThisWeek` is asserted to be a scalar the backend's own metrics rollup produced, never derived client-side by fetching the alert records behind it — "the moment a count is derived by fetching the records behind it, the records are in the browser and the boundary is gone." Impersonation ("view as this tenant") is explicitly stated as *not deferred by oversight* but refused on principle: "a super admin borrowing an org's session would defeat the isolation the whole routing model is built on."

Nine seeded tenants deliberately span every state both the tenant list and detail pages need to draw (three plan tiers per audience, a trial with a week left and one with two days left, a suspension with a support note already attached, and — added during the billing-oversight build — a curated `MOCK_UNPAID` map producing three distinct payment-health states: declined-and-already-suspended, declined-but-still-in-terms, and past-due-with-zero-attempts).

`Invoice`/`InvoiceStatus` were **extracted out to `lib/invoice.ts`** (a neutral module, alongside `plans.ts` and `csv.ts`) specifically so this file and the org-side `lib/subscription/api.ts` could share one invoice shape and one status-label function without either importing the other's transport — the exact same "shared type, never shared transport" pattern used for the plan catalogue.

### 9.9 `lib/billing/` — platform revenue oversight (super admin, `/admin/billing`)

Deliberately split into two files reflecting **what the browser can compute itself vs. what only a real payment processor could know**:
- **`revenue.ts`** — pure MRR arithmetic: multiplies each active tenant's plan price by count, breaks it down per-plan, separately reports trial and suspended-account MRR (excluded from the headline figure — "not revenue until they convert" / "stopped when access was cut"), computes upcoming-renewal dates by deriving a 30-day cycle from each tenant's signup date (no real billing schedule exists), and computes plan-change deltas (upgrade/downgrade/cancellation) purely from the catalogue. Every function here carries the same placeholder-pricing warning as `plans.ts`.
- **`api.ts`** — the ledger: outstanding invoices (with processor-style detail like decline reason and attempt count that a browser genuinely cannot compute — sourced from a small seeded `PROCESSOR` map) and a plan-change log. **Exports exactly one function**, `getBillingLedger()` — no `retry`, `refund`, or `write-off` operation exists anywhere in this module, because there's no real payment processor connected to act on: "a control that hands out something nothing honours is a lie told with a checkbox," the same reasoning already established for `cameras:manage`.

### 9.10 `lib/subscription/` — an org's own subscription (`/org/billing`)

The customer-facing mirror of `lib/billing`, and — enforced by the boundary tests in §6.6 — **never** importing it. `getSubscription()` returns one org's plan, invoice history, and any `pendingChange`. `requestPlanChange(planId)` is deliberately named for what it *actually does*: it validates the target plan is in the same audience and isn't the current plan, then records a `PlanChangeRequest` with **exactly one possible status, `'requested'`** — the type comment explains that `'approved'`/`'scheduled'`/`'active'` are omitted on purpose because nothing in the current product could ever transition a request into them, and a status field with unreachable values would be "a promise the interface would make on the backend's behalf." `withdrawPlanChange()` is offered specifically because it *can* be honestly fulfilled without a processor.

`lib/subscription/usage.ts` is a small, carefully-designed pure module governing how camera-count-vs-plan-limit is presented: five states (`none/within/approaching/at/over`), an `APPROACHING` threshold of 0.8, and a `usageTone()` function that gives **Signal to `over` and nothing else** — `within`/`none` are Confirm, `approaching`/`at` are neutral. `needsSaying()` gates whether the section bothers to add explanatory prose at all — comfortably-inside-plan renders one quiet sentence ("Comfortably inside your plan. Nothing to do here.") and stops.

`lib/subscription/export.ts` — invoice-list CSV export, again through the shared `lib/csv.ts` writer, with its own honesty note that a CSV of invoice rows "is not a tax document" and a real per-invoice PDF is a server-side concern not attempted here.

### 9.11 `lib/csv.ts` — the shared export primitive (extracted mid-project)

Originally implemented once, inline, inside `lib/analytics/export.ts`. **Extracted into its own neutral module** the moment a second feature (the audit log) needed the same mechanics, specifically because the formula-injection guard is a security control and "a second implementation is a second thing to get wrong." Provides `csvField()` (quotes/escapes per RFC-ish CSV rules, and — the actual security-relevant part — prefixes any field starting with `=`, `+`, `-`, `@`, tab, or CR with a leading apostrophe **and** wraps it in quotes, specifically defeating CSV/Excel formula injection where a customer-typed camera name or zone like `=cmd|/c calc` could otherwise execute code on an auditor's machine when the exported file is opened in a spreadsheet), `csvRow()`, `toCsv()`, `csvFilename(name, date)` (produces `detecto-<name>-YYYY-MM-DD.csv`, date-stamped so exports never collide), and `saveCsv()` (creates a `Blob` with a UTF-8 BOM prefix — so Excel renders accented customer/camera names correctly instead of mojibake — builds an object URL, synthesizes a temporary `<a download>` click, and revokes the URL on the next tick rather than synchronously, since revoking immediately can race the download start). Three separate export features now share this: analytics (`lib/analytics/export.ts`), the audit log (`lib/audit/export.ts`), and the org subscription's invoice list (`lib/subscription/export.ts`) — each still owning its own column mapping, only the mechanics are centralized.

Every one of these exports carries the **same standing disclosure**, independently written into each feature's own file (and onto each page's UI, next to the export button): *this is a client-side-assembled file with no cryptographic provenance, cannot be signed/checksummed, and a real compliance-grade export needs a server-side job.* This is stated most forcefully in the audit-log export, which additionally notes that "exporting an audit log is itself an auditable event" that nothing currently records, because there's nothing to record it to.

### 9.12 `lib/module-flags/` — platform-side module rollout control

The platform-side counterpart to `lib/modules/` (org-side). `ModuleFlag` extends the base module contract with `planIds[]` (which plans include it) and `liveSince`. Deliberately imports the org-side `MOCK_CATALOGUE` directly (not through `lib/modules/api.ts`, which would drag a camera-module import into the platform bundle) so that flipping a module live on the platform mock is *immediately* visible to the org-side mock reading the same records — enforced by a co-located test (`api.test.ts`) that explicitly checks the two mocks agree on every module's status after a platform-side change. This page's "not built yet" panel is one of the earliest and most-referenced instances of the honesty-about-gaps pattern (see §12): it explicitly states there's **no staged rollout capability**, and *why* — no tenant-to-module allowlist field exists in the data model at all, and the org-side endpoint that would need to honor one "returns the whole catalogue to every caller and gates only on status," so "a rollout picker built today would record selections that nothing reads, which is worse than not having one."

### 9.13 `lib/notifications/` — alert routing & escalation config (org-side)

Built across two files reflecting the same real/mock-transport split as everywhere else, plus a third pure file:

- **`routing.ts`** — pure resolution logic answering "who is notified about zone X / detection-type Y." `hearsAlerts(role)` = holds `alerts:view` or `alerts:confirm`. `rolesFor(kind, target, override, roles)` resolves defaults differently per axis: a **zone** route defaults to every role whose `zones` scope actually reaches that zone; a **module/detection-type** route defaults to every alerts-capable role regardless of zone (since a detection isn't tied to a place). Critically — **and this was a bug caught and fixed mid-build via the project's own boundary-testing discipline** — zone *access scope* is enforced as a non-negotiable filter applied on top of *any* override, including an explicit one: naming a zone-restricted role as a recipient for a different zone cannot actually notify them about it, because "a role's `zones` is an access boundary, not a preference... a notification about something invisible is worse than none." `notifiedFor(zone, moduleId, routes, roles, people)` computes the **union**, not intersection, of the zone-route recipients and the module-route recipients — deliberately, because an intersection could let two individually-sensible narrowings combine into *nobody* being told about a real weapon detection, which the code calls "the one outcome that must not be reachable by accident." `coverageFor(person, ...)` is the inverse view (everything one person is currently told about), used to catch the case where an admin narrows several routes independently and inadvertently silences one person entirely without noticing while reading the routing table top-down.
- **`api.ts`** — `NotificationRoute { kind, target, roleIds: string[]|null }` (`null` = default, `[]` = explicitly narrowed-to-nobody — a real, distinct, storable state), `EscalationPolicy { enabled, afterMinutes: 5|15|30, roleIds[] }`. **The header comment is one of the most explicit "this is a decision surface, not a delivery mechanism" statements in the codebase**: there is no push registration, no mail sender, no telephony anywhere in this build, so nothing this module stores has ever caused a real notification — what's persisted is the *routing decision* the product will honor once delivery exists. `ESCALATION_DELAYS` is a fixed three-value enum (5/15/30 minutes) specifically **not** a freeform number field, because "the useful question is 'roughly how long', and a field accepting 7 would invite somebody to tune a number that nothing measures to that precision."
- Feeds the `/org/settings/notifications` page (§10).

### 9.14 `lib/audit/` — the org's activity log (`/org/audit-log`)

Three files: `api.ts` (types + transport + mock), `filter.ts` (pure filtering/search), `export.ts` (CSV, via the shared writer). This is the module with the most explicit and repeated honesty framing in the entire codebase, because it's the one surface a compliance-minded customer might mistake for a durable legal record. The header comment is blunt: **there is no audit-event backend anywhere in the product** — every feature (roles, cameras, modules, notifications, alerts) has its own API and none of them write an event anywhere. The mock assembles a feed from two sources: a hand-seeded list of seventeen plausible historical actions (role/person/camera/module/notification changes, including entries naming roles like "Rota lead" and "Night shift" that **have since been edited or deleted** from the live role directory — proving the point that the actor's role-at-the-time is a frozen string on the entry, never a live foreign-key lookup, "or the log would quietly rewrite what it says about the past"), plus **real** alert-confirm/dismiss entries derived by actually reading the live alert store (`listAlerts()`), never duplicated data — so an audit entry for a decision genuinely links to and agrees with the real alert record.

`AUDIT_ACTIONS` is a closed, sixteen-value enum (not a generic "activity" string) explicitly matching real product operations one-to-one (`role.created`, `person.deactivated`, `module.zone_bulk`, `notifications.escalation_changed`, `alert.confirmed`, etc.) — "adding a row here means somebody added a capability rather than a label." `filter.ts` groups those sixteen actions into six broad `ActionGroup`s for the filter UI, and provides `applyFilter()` (person/action-group/date-range/free-text, careful to treat dates in the *reader's local timezone* start-of-day/end-of-day, and to treat an unparseable half-typed date as "no bound" rather than emptying the table under the user mid-keystroke) plus `actorsIn()` (drawn from actual log entries, not the live directory, specifically so a deactivated or long-gone person can still be filtered by name — "they are frequently the reason somebody opened this page").

Read-only by construction: `getAuditLog()` is the module's **only** export besides the type/constant list — no write, no delete, ever. `Object.keys(auditApi)` is asserted in tests to be exactly `['AUDIT_ACTIONS', 'getAuditLog']`.

---

## 10. Page-by-page tour

This section walks every route, noting what's actually built vs. still a `PagePlaceholder`.

### 10.1 Super Admin (`/admin/*`)

| Route | State | Summary |
|---|---|---|
| `/admin/overview` | **Built** | Platform KPI strip (tenant counts by status, cameras connected, alerts raised this week vs. last, all counts — never content), a one-line system-health summary linking to the full health page, and a "recent signups" list. Closes with an explicit boundary statement in the page copy itself. |
| `/admin/tenants` | **Built** | Searchable (name or account-contact email), status-segmented (`All/Active/Trial/Suspended`, URL-synced) table of every tenant: plan, camera-count-vs-limit (flagged Signal at the plan ceiling), status, created date, contact email. |
| `/admin/tenants/:id` | **Built** | One tenant's full platform record: account facts, billing history (invoices table, via the shared `Invoice` shape), `AccountAccess` (suspend/reactivate behind a confirm panel that explicitly enumerates what suspension does — boxes stop syncing, detection stops, everyone's signed out — and what it does **not** do — nothing is deleted, billing is unaffected, it's a separate lever), and `SupportNote` (an internal-only free-text field the tenant can never see, with copy explicitly acknowledging it's still discoverable account data a customer could legally request). |
| `/admin/billing` | **Built** (multi-file feature: `revenue.tsx`, `payments.tsx`, `changes.tsx`, `account-link.tsx`, `index.tsx`) | Platform-wide MRR (with the placeholder-pricing warning inline, not in a footnote), per-plan revenue breakdown, three-way payment-health view (failed/past-due/upcoming-renewal, each drawing a clear line between "declined" and "past due" as genuinely different states), and a read-only plan-change history log. No retry/refund controls exist — explicitly refused, same reasoning as everywhere else. |
| `/admin/module-flags` | **Built** (`index.tsx`, `module-row.tsx`, `release.tsx`) | The module registry: live/coming-soon status per module, per-plan inclusion switches (each announcing its own consequence — "Estate added — 12 organisations can now enable this"), a measured false-positive-rate input field (validated 0–100%, framed explicitly as "a measurement, not a target"), and a release/withdraw action behind a confirm step stating the exact blast radius as a number of affected organizations (suspended accounts counted separately since nothing changes for them). Extensively documents its own gaps (no staged rollout, plan tiers not yet enforced org-side, catalogue is placeholder pricing). |
| `/admin/system-health` | **Built** (`index.tsx`, `fleet.tsx`, `api-health.tsx`, `queues.tsx`, `cost.tsx`) | A single up-front verdict line ("Everything is reporting normally" / "Something needs attention"), then four sections: box-fleet connectivity (sortable table, most-concerning-first by default), API latency/error/uptime with hourly bar charts, queue lag per queue with the same charts, and an infrastructure cost tracker (explicitly framed as proving Detecto's "costs almost nothing until scale forces it" architectural promise, not a general finance dashboard). Every chart independently checks `ENOUGH_HOURS` before drawing a trend and falls back to `NotEnoughData` otherwise. |
| `/admin/analytics` | **Placeholder** | `PagePlaceholder` describing detection volume/accuracy/response-time trends across the whole platform, aggregate-only. |
| `/admin/support` | **Placeholder** | `PagePlaceholder` describing a future ticket queue with tenant context surfaced alongside it; explicitly notes reaching a tenant's actual footage would require the tenant's own time-limited consent, logged to *their* audit log. |

### 10.2 Org Admin (`/org/*`)

| Route | State | Summary |
|---|---|---|
| `/org/overview` | **Placeholder** | Describes a future live-state dashboard (streaming/offline camera counts, unconfirmed queue, last-24h summary, coverage gaps). |
| `/org/cameras` | **Built** | Camera table (name, zone, online/offline, last-picture time) or, if empty, `NoCamerasYet` with a CTA into the connect wizard. |
| `/org/cameras/connect` | **Built** — full 4-step wizard (`index.tsx`, `progress.tsx`, `step-parts.tsx`, `steps/{pair,find,name,done}.tsx`) | Pair (8-char code, supports both manual entry and a QR-code deep-link that pre-fills the field via a URL search param), Find (network discovery with genuinely-built failure states: nothing found with three concrete reasons + retry + manual-add-by-address, some channels unreachable/password-protected listed with per-problem fixes, the box going silent mid-search), Name (bulk "apply this zone to every selected camera" plus per-camera name/zone fields, live review list before submit), Done (summary + "what happens next," explicitly stating detection is a **separate** step from connecting). |
| `/org/modules` | **Built** (`index.tsx`, `module-toggle.tsx`, `zone-bulk.tsx`) | Cameras grouped by zone, each row expandable to its per-module toggle list; a zone gets an "Apply to all" bulk action behind a light (non-hold) confirm step. Optimistic per-toggle writes with revert-on-failure (deliberately exercised by the mock's every-5th-write failure injector); zone-wide writes are deliberately non-optimistic. A camera with nothing running reads "Nothing running" in Signal — "the most useful thing this page can say without being opened." |
| `/org/alerts` | **Built** | `AlertQueue` scoped to the whole org (same component as the member `/alerts` route). |
| `/org/alerts/:id` | **Built** | `AlertDetail`, same component as the member route. |
| `/org/history` | **Placeholder** | Describes future searchable historical detections with clips, decisions, and single-incident export; notes retention follows plan (30/90 days). |
| `/org/users` | **Built** (`index.tsx`, `role-list.tsx`, `people-list.tsx`, `role-builder.tsx` at `/org/users/roles/new|:id`) | Full role-based access management: role list (with holder counts, permission summary sentence, notes for high-impact grants, delete behind a two-decision confirm — reassign holders or leave them roleless, default Admin role undeletable), people list (invite form, per-person role dropdown, deactivate behind a confirm that explicitly states nothing is erased — including a special warning if you're deactivating your own account), and the role builder (grouped permission checklist + zone-scope radio + live "what you are about to grant" sentence preview, shared between create and edit). |
| `/org/analytics` | **Built** (`index.tsx` + four section files, fully covered in §11) | Trend analytics over the last-8-weeks alert record: overview KPI strip, per-module accuracy (own-decisions-derived false-positive rate vs. published benchmark rate), incident pattern (by zone, by hour), response-time distribution. CSV export of the underlying detection rows, with the same client-side-provenance disclosure as every other export. Handles the "brand new account with almost no data" case as a genuinely different (not degraded) UI branch throughout, never drawing a chart through fewer points than its own stated threshold. |
| `/org/billing` | **Built** (`index.tsx`, `change-plan.tsx`, plus `billing.test.tsx`/`boundary.test.tsx`) | Current plan (price + includes + camera-usage-vs-limit), a dedicated quiet/informational usage section (§9.10), a change-plan flow that submits a *request* rather than performing a real upgrade (with a plain confirm step stating the price delta and explicitly "nothing is charged... a person will get in touch"), read-only invoice history + CSV export, and a payment-method section that **deliberately builds no card form at all**, stating exactly why (no PCI-compliant hosted field, no processor to send it to). Its own "Not built" panel additionally flags that `billing:manage` is currently the *only* billing-related permission — there's no separate view-only grant for a finance contact who should see invoices without being able to change the plan, and the page states this gap rather than working around it. |
| `/org/settings` | **Built** (index only) | An index page linking to the one settings sub-feature that's actually built (notification routing) and a placeholder list for the rest (sites/zones, org profile, escalation contacts). |
| `/org/settings/notifications` | **Built** (`index.tsx`, `route-row.tsx`, `escalation.tsx`, `channels.tsx`, fully covered in §9.13) | Per-zone and per-detection-type notification routing (default = everyone with an alerts grant whose scope reaches it; overridable to specific roles, with the resolved recipient list shown by name *before* saving, and a save blocked outright if it would resolve to zero recipients), a "when both apply" explainer panel stating the union rule plainly, a channels table (push-in-app only, explicitly stating no per-person channel preference field exists — no email/SMS option, because `Person` has no channel-preference or phone-number field at all, and the page refuses to draw controls for data that doesn't exist), and an escalation section (5/15/30 minute threshold, additional roles notified — never replacing the original recipients, only adding — behind a plain confirm step whose copy is checked, in tests, to explicitly repeat "this only ever notifies people in your organisation... It does not contact the police, a guard company, or any emergency service" at the exact point of agreeing, not just once at the top of the page). A prominent banner above everything states plainly that **nothing is actually delivered yet** — no push registration, no mail sender exists — so what's saved here is a stored decision, not a live notification pipeline. |
| `/org/audit-log` | **Built** (`index.tsx`, `filters.tsx`, fully covered in §9.14) | Filterable (person/action-group/date-range/search, all URL-synced) read-only log table, CSV export, and — leading the page, above the table — the most explicit "this is not the durable record" disclosure in the app. |

### 10.3 Member / scoped (`/alerts`, `/cameras`)

- `/alerts` — **Built**, `AlertQueuePage` (thin wrapper around the shared `AlertQueue` component, scoped to the signed-in person's own assignment).
- `/alerts/:id` — **Built**, shared `AlertDetail`.
- `/cameras` — **Placeholder** (a scoped operator's own camera list with live-view state, explicitly noting that changing what runs on a camera is an administrator's job and deliberately not offered here).

---

## 11. The analytics feature in detail — a case study in "honest about uncertainty"

`/org/analytics` deserves its own section because it's the clearest demonstration of a recurring principle across the whole codebase: **every derived figure states, and enforces in code, the minimum volume of underlying data required before it's shown as a trend at all**, rather than ever drawing a misleadingly confident chart through too few points.

`lib/analytics/stats.ts` is a pure module (no React, no fetching) with a single `ENOUGH` threshold table at its top, each value carrying an explicit rationale comment:
- `accuracyWeeks: 3` — the fewest points that show a direction rather than a pair.
- `accuracyRate: 12` — below a dozen decided alerts, one dismissal swings a false-positive rate by whole percentage points.
- `hourPattern: 24` — fewer than one alert per hourly bucket on average and "peak hour" is noise.
- `responseSpread: 10` — a distribution needs bodies to have a shape.
- `zonePattern: 8` — ranking zones against each other needs enough volume that the busiest isn't just whichever happened to get two.

Every section (`OverviewStrip`, `ModuleAccuracySection`, `IncidentPatternSection`, `ResponseTimeSection`) checks its relevant `ENOUGH` value and, below it, renders `NotEnoughData` with the *real* counts still shown (never hidden) plus a plain sentence about what volume would make the chart trustworthy — explicitly "more useful than a chart with three points on it."

Specific statistical choices worth noting: response time is reported as median + 90th-percentile + a flat count of anything over 4 hours, **never a mean**, because a mean would let a handful of overnight-unattended alerts disappear into an average — "and those are the ones worth knowing about." Alerts still waiting (not yet decided) are excluded from every response-time figure rather than averaged in with their current elapsed wait, because "an alert that has been waiting six hours has not 'taken six hours', it has taken at least six and counting." Module accuracy shows the organization's own observed false-positive rate (derived purely from what the org's own people confirmed vs. dismissed) *next to* the published, benchmark-measured rate — explicitly because a single number would either be "quoting a lab result at somebody standing in a car park" (published only) or leave "no way to tell a bad install from a bad model" (observed only).

The mock (`lib/analytics/api.ts`) supports a `VITE_ANALYTICS_MOCK` switch with **four modes** — unset (an established account, 8 weeks of realistic seeded data with a Mulberry32-seeded PRNG for reproducible demos, hour/day-of-week weighting shaped like real incident patterns, and a per-module improving-trend bend so the "false-positive rate over time" chart has a real shape to show), `sparse` (a brand-new account: only the live queue, nothing older), `empty` (cameras connected, nothing ever raised), and `false` (talk to the real endpoint). `sparse` is called out in comments as "the one worth opening... the case where a chart drawn anyway would be a lie."

---

## 12. The recurring "honesty about gaps" pattern

Across at least seven distinct features, the same discipline recurs and is worth naming as a single cross-cutting pattern, because it's arguably the defining engineering culture of this codebase: **when a control would have to invent data, permission keys, or backend capability that doesn't exist, the code refuses to build a working-looking version of it — it builds nothing, and states on-screen exactly what's missing and why**, rather than either faking success or silently omitting the feature without explanation.

Concrete instances:
1. **`cameras:manage`** doesn't exist as a claims key → the role builder only offers `cameras:view`; flagged in a code comment in `permissions.ts` and in the README.
2. **No tenant-to-module allowlist field** exists → no staged-rollout picker on `/admin/module-flags`; a full paragraph explains the specific missing data-model field and endpoint behavior that would need to change first.
3. **No payment processor anywhere in the product** → signup's card form validates and stores nothing real (`finish()` just flips a flag); the platform billing page has no retry/refund button; the org billing page's "change plan" submits a *request* rather than an upgrade and is careful never to imply a completed transaction; the org billing page's payment-method section builds **zero** form fields for a card, on the explicit reasoning that collecting real card data with nowhere compliant to send it would be actively dangerous, not merely incomplete.
4. **No channel-preference field on `Person`** → the notifications page's channel table states plainly that email/SMS options don't exist because there's no field for a preference, no consent record, and no phone number anywhere in the data model — refusing to draw switches that would write to nothing.
5. **No audit-event backend** → the entire `/org/audit-log` page opens with a disclosure that nothing shown is durably stored, assembled instead from whatever each individual feature's own (non-audit) API happens to expose.
6. **No delivery mechanism for notifications** (push/email) → `/org/settings/notifications` states routing decisions are recorded but nothing has ever actually notified anyone yet.
7. **No view-only billing permission** → `/org/billing` states that `billing:manage` is currently the only billing grant, so a finance-only role isn't expressible yet, rather than building a UI split the permission system can't actually back.
8. **No CSV export provenance** → every one of the three export features (analytics, audit, subscription invoices) states that a browser-assembled file can't be signed/checksummed and that a real compliance export needs a server-side job — this is the *one* gap repeated identically across three independent features rather than solved once, specifically because each is a genuinely separate risk surface worth restating.

This pattern is also why `PagePlaceholder` exists as a first-class, reused component rather than a TODO comment: an unbuilt route still gets a real, specific list of what will be there, "because a page that cannot describe what belongs on it probably should not be in the nav."

---

## 13. Accessibility patterns (cross-cutting, not a separate feature)

Rather than a bolt-on audit pass, accessibility is implemented as a set of repeated idioms used identically across every flow:

- **Focus management on step/route change**: every multi-step flow (login's MFA seam, signup's four steps, the camera-connect wizard's four steps, the app shell's route changes) uses the identical pattern — a `ref` on the new step's container with `tabIndex={-1}`, a `useEffect` keyed on the step value that calls `.focus()` and (for full page transitions) `window.scrollTo({top:0})`, guarded by an `isFirstRender` ref so the very first mount doesn't steal focus from wherever the user already was.
- **Skip-to-content links** on every full-page layout (`AppShell`, `AuthShell`'s pages independently, the style guide, the signup page).
- **Live regions used deliberately, not everywhere**: `role="status" aria-live="polite"` for non-urgent state changes (loading text, save confirmations, `HoldToConfirm`'s announcement span), `role="alert"` for anything that needs immediate announcement (form-level errors, decision failures). `HoldToConfirm` specifically keeps its ARIA-live announcement text **separate** from the constantly-updating visible countdown text, so a screen reader gets one clean sentence per state transition rather than a rereading of "3.2s... 3.1s... 3.0s...".
- **`aria-describedby`/`aria-invalid` wiring** is centralized in the `Field` component so every form field in the app gets consistent hint/error association without each form re-deriving ids by hand.
- **Modal dialog semantics done by hand, correctly**: `NavDrawer` implements `role="dialog" aria-modal="true"`, a manual focus-trap Tab-cycle handler, Escape-to-close, backdrop-click-to-close, body-scroll-lock, and focus restoration to the triggering element — all without a dialog library.
- **Data tables scroll instead of reflow** below their breakpoint, everywhere, on the stated principle that operators are reading a row's columns *against each other* and a card-stack layout would destroy that comparison — this exact justification is independently written into the doc comments of at least six different table-bearing components rather than being a single shared rule nobody explains twice.
- **Sort-state and filter-state announced via `aria-sort`** on sortable table headers (the system-health fleet table).
- **Every chart carries a full-sentence screen-reader readout per data point**, generated from the same `BarDatum` the visual bars are drawn from, so the accessible description can never drift out of sync with what's on screen.
- **Reduced motion is never an afterthought check**: the CSS-level global rule handles ordinary transitions; `HoldToConfirm` and the bar-chart "grow in" animation both additionally read the media query in JS (via `useReducedMotion`) specifically because they need to *skip a state* (start already-at-full-size, or switch interaction modes entirely) rather than merely play the same animation at zero duration.

---

## 14. Testing strategy

Test files are **co-located** with the code they test (`foo.ts` + `foo.test.ts` in the same directory), a convention followed with zero exceptions across the whole `lib/` tree and for every page/feature built past the initial foundation pass. Test file count observed: roughly 25 `.test.ts`/`.test.tsx` files, covering `lib/analytics`, `lib/audit`, `lib/billing`, `lib/health`, `lib/module-flags`, `lib/notifications`, `lib/subscription`, `lib/tenants`, and page-level suites for `admin/billing`, `admin/module-flags`, `admin/overview`, `admin/system-health`, `admin/tenants`, `org/analytics`, `org/audit-log`, `org/billing` (plus its dedicated `boundary.test.tsx`), and `org/settings/notifications`, in addition to the project-wide `pages/admin/boundary.test.tsx`.

**Test harness (`src/test/harness.tsx`)** is the shared infrastructure every page test uses: `renderPage(element, { path, route, seed })` wraps a page in a fresh `QueryClient` + `MemoryRouter` + a single matching `<Route>`, optionally pre-seeding the query cache directly (`seed: (client) => client.setQueryData(...)`) **rather than waiting on the mock's own artificial network delay** — the mocks under `lib/*/api.ts` deliberately `setTimeout` for realism in the actual dev server, and the harness comment states plainly that "a suite that waited for that would spend most of its time asleep to prove nothing extra"; those mocks get their own dedicated `lib/*/api.test.ts` suites instead, which *do* exercise the real async mock functions directly. Returns a wrapped view with `.text()` (whitespace-collapsed `textContent`, for copy assertions) and `.html()` (raw innerHTML, for structural/leak assertions) in addition to the normal Testing Library query methods. Also exports two ready-made claims fixtures, `SUPER_ADMIN` (every grant implicit) and `NO_GRANTS` (signed in, zero permissions — used to test every page's permission-refusal branch).

**Vitest config (`vite.config.ts`)** deliberately runs through the app's **actual** Vite config (not a separate test-only config), specifically so `import.meta.env.DEV` is true and the dev mocks behave in tests exactly as they do in the browser — "a test that had to be told how to resolve a module would be testing its own setup." `environment: 'happy-dom'` for a real DOM (effects run, `matchMedia` answers, which `useReducedMotion` needs). `isolate: true` — each test file gets a fresh module registry, specifically because the mock modules hold session-scoped mutable state (`let store: X | null = null`) the way a real backend would, and a suspended tenant or a saved note created in one test file must not leak into the next file's starting fixtures.

Recurring test idioms observed across the suite:
- **Boundary/leak assertions as "guard the test itself" patterns**: `expect(rendered.length).toBeGreaterThan(N)` before asserting a list of absences, specifically because an empty-string render (a bug elsewhere, like a gate returning too early) would make every "does not contain X" assertion pass for the wrong reason.
- **Deterministic-failure testing**: rather than mocking a random failure, features like the module-toggle "fail every 5th write" are tested by literally calling the mutation enough times to trigger it.
- **Copy-string assertions on the most safety-critical sentences** — e.g., notification-escalation tests assert the exact phrase "It does not contact the police, a guard company, or any emergency service" appears **at the point of agreeing**, not merely somewhere on the page, specifically to catch a future edit that removes the reminder from the confirm step while leaving it in the page's opening paragraph.
- **Cross-mock consistency tests** — e.g., the module-flags suite asserts the platform mock and the org-side mock agree on every module's live/coming-soon status after a platform-side change, since they're supposed to be reading the same underlying (shared, mutable) catalogue array.
- **Positive counterexamples in boundary tests** (see §6.6) to prove the leak-detection pattern can actually fail.

### CI (`.github/workflows/ci.yml`)

Triggers on every push to any branch and every pull request. Single `verify` job on `ubuntu-latest`: checkout → `actions/setup-node@v4` (Node 22, npm cache) → `npm ci` (not `install` — fails if the lockfile has drifted from `package.json`) → `npm run lint` (oxlint) → `npm run build` (`tsc -b && vite build` — three TypeScript project references checked, then the actual production bundle built) → `npm test` (`vitest run`, one-shot, not watch mode). As of this document, the workflow file has just been pushed to the remote for the first time and has not yet had a confirmed run observed against a live GitHub Actions environment.

---

## 15. Notable engineering micro-decisions worth recording

A handful of small, easy-to-miss details that recur or matter disproportionately to the app's correctness:

- **Query-key prefix relationships are used deliberately for cache invalidation.** `tenantKey(id)` is a suffix of `TENANTS_KEY`, so invalidating the list after a tenant write also refreshes an already-open detail view for free, in one call — the same trick is used for `alertKey(id)`/`ALERTS_KEY`.
- **Timestamps used for "now" are read once, from the query's own `dataUpdatedAt`, and threaded down as a prop — never read fresh via `Date.now()` inside a render.** This shows up in system health, analytics, and the escalation section's "how many alerts would this threshold have caught" preview. The stated reason: reading the clock during render would move every relative-time and threshold comparison a few milliseconds on every re-render, and would make the on-screen figures disagree with a CSV export taken from the same query snapshot at the same instant.
- **`formatRelative`/`formatShort`/`formatDate`/`formatDuration`/`formatTimestamp`/`formatHour` (`lib/time.ts`) are one shared module** used everywhere a date/duration appears, so "3 hours ago" phrasing, 24-hour clock formatting, and duration granularity (whole minutes below an hour, specifically because "the difference between a four-minute response and a fifty-minute one is the entire subject of the page that reads this") are consistent across every feature rather than locally reinvented.
- **Deleting is almost never offered; deactivating/withdrawing/suspending is.** People are deactivated, never deleted (their confirmations are part of the audit trail). Tenants are suspended, never deleted. Plan-change requests are withdrawn, never silently discarded without a record. Module flags are withdrawn (returned to coming-soon), not removed from the catalogue. This is a consistent product stance, not a per-feature accident.
- **Every "what happens next" numbered list (signup confirmation, camera-connect done screen) is copy that explicitly separates "this technical step happened" from "detection is now watching you" from "a human still decides"** — three distinct claims, never conflated into one sentence, because conflating "connected" with "protected" would misrepresent what actually changed.
- **The role builder's "what you are about to grant" panel re-renders the exact same `summarisePermissions()` sentence used everywhere else a role is displayed**, live as checkboxes are ticked — so what an admin previews before saving is guaranteed to be worded identically to what they'll see on the role list afterward.
- **No Redux, no Context API used for cross-cutting state anywhere.** The three-store Zustand + one-QueryClient TanStack Query split is total and consistently applied; there is not a single `React.createContext` in the codebase outside of what Radix primitives use internally.

---

## 16. Current overall completion snapshot

**Fully built, with real interaction logic, tests, and honest-gap documentation:** design system & style guide; auth (login + forgot-password, real transport + mock, MFA seam only); signup wizard; app shell + routing/area-isolation (all three layers); camera connect wizard; org camera list; org detection-module configuration; the shared alert queue + confirmation flow (member and org-scoped); org people & roles; org analytics; org billing (including change-plan-as-request and payment-method refusal); org notification routing & escalation; org audit log; super-admin tenant registry + detail; super-admin billing oversight; super-admin module-flag rollout control; super-admin system health.

**Still `PagePlaceholder` stubs, present in navigation with specific "coming" lists but no live data:** `/org/overview`, `/org/history`, `/cameras` (member's own live view), `/admin/analytics`, `/admin/support`.

**Explicitly out of scope until a real backend exists, and stated as such rather than faked:** any actual payment processing anywhere in the product; any actual push/email/SMS delivery of a notification; any actual audit-event persistence; any server-side CSV/PDF export job; session refresh across a page reload (the "boot seam" noted in `auth-store.ts`); MFA verification itself (only the seam for it exists).

Every one of the "still placeholder" or "explicitly out of scope" items above is documented **in the product itself** — either as a `PagePlaceholder`'s `coming[]` list or as an on-screen "Not built" panel with a stated reason — which is itself the most consistent single trait of this codebase: the gap between what's built and what's promised is never left implicit.
