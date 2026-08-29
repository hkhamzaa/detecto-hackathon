# Detecto — frontend

AI weapon and violence detection layered onto a customer's existing CCTV. Every
detection waits for a human confirmation before it can escalate; nothing is
reported to authorities on the model's word alone.

This repo has the **design foundation, the auth flow, the signed-in app shell**,
the **camera connection flow**, the **alert review queue**, **module
configuration**, and **people and roles**. Every route in the product exists and
sits in the right place in the navigation; the remaining pages are placeholders
that say what will be on them.

```bash
npm install
npm run dev     # http://localhost:5173 — redirects to /login
npm run build
npm run lint
```

`/` is not a page. It asks `landingPathFor` the same question login does and
sends you wherever your claims belong. The style guide is still at
[/style-guide](http://localhost:5173/style-guide).

While `/api/auth` does not exist, `npm run dev` runs a mock: any email, password
`detecto-demo`, and the part before the `@` picks the role —
`super@…` is a super admin, `admin@…` an org admin, `viewer@…` sees cameras
only, `nobody@…` has no grants and lands on `/no-access`. Anything else is a
member with alerts and cameras.

## Stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| App shell      | React 19 + Vite (SPA — login-gated, no SEO surface)  |
| Styling        | Tailwind v4 (CSS-first `@theme`) + shadcn/ui         |
| Server state   | TanStack Query                                       |
| UI state       | Zustand                                              |
| Routing        | React Router, lazy per route                         |
| Real-time      | `socket.io-client` (installed, not yet wired)        |

## Design tokens

Defined in [src/index.css](src/index.css) under `@theme`, so they are available
both as Tailwind utilities and as raw custom properties.

| Token     | Value     | Use                                                       |
| --------- | --------- | --------------------------------------------------------- |
| Ink       | `#14181F` | Chrome — sidebar, header, alert shells. Not pure black.    |
| Paper     | `#F7F6F3` | Content surfaces — tables, records, anything read closely. |
| Signal    | `#D64545` | Unconfirmed detections on alert surfaces; the error and danger color elsewhere. |
| Confirm   | `#3E7C6B` | Human-verified state, trust actions, and the focus ring.   |
| `neutral-50…950` | interpolated Ink→Paper | All UI chrome.                         |

Type: **General Sans** (display, used sparingly) · **Inter** (body) ·
**JetBrains Mono** (camera IDs, confidence scores, timestamps — the product is
genuinely full of machine metadata, so the mono is functional, not decorative).

All three are self-hosted from [public/fonts/](public/fonts/) and declared in
[src/fonts.css](src/fonts.css) — no third-party font requests at runtime, which
is a hard requirement for air-gapped and government deployments. Inter and
JetBrains Mono are variable fonts (weights 400–600 in one file) split by
`unicode-range`, so a browser fetches only the subsets it needs; General Sans
ships as one file per weight. 323 KB is vendored in total, of which a
Latin-script session loads ~123 KB.

The scale is `display-xl/lg/md/sm`, `title`, `body`, `meta`, `data`, `micro`.

shadcn/ui semantic variables (`--background`, `--primary`, …) are mapped onto
these tokens. Chrome regions opt in by wrapping in `.dark`, so primitives invert
in place rather than needing chrome-specific variants.

## People and roles

[/org/users](src/pages/org/users/index.tsx) is where an org admin invites people
and builds roles from a permission checklist rather than picking from fixed
tiers. A corner shop has one person who does everything; a hospital has night
staff who confirm alerts and never touch billing. Both are expressible, and
neither had to be anticipated.

**The catalogue only offers keys the app actually checks.**
[permissions.ts](src/lib/roles/permissions.ts) is the single list, and every key
in it is one `can()` is asked about elsewhere. A role builder that could hand out
a permission nothing enforces would be a lie told with a checkbox. `admin:*` is
absent — those are Detecto's own platform grants, and no org admin can issue
them. `saveRole` strips unknown keys server-side too, so the guarantee does not
depend on the browser.

> **Gap flagged.** The brief asked for *Cameras: view / manage*. The claims
> system has `cameras:view` and no `cameras:manage`, so only view is offered.
> Connecting and renaming cameras is currently gated by being in the org area at
> all. When a `cameras:manage` key exists it belongs in the Cameras group, and
> the comment at the top of `permissions.ts` says so.

**Permissions are shown as sentences, never as keys.** `summarisePermissions`
turns a set into *"Can view cameras, see the alert queue and confirm alerts."* —
because whoever is handing out access has to be able to read what they are
handing out, and `cameras:view, alerts:confirm` is not something an office
manager can check before pressing save. The role builder shows the same sentence
live as you tick, under **What you are about to grant**.

Two grants carry a note that follows them everywhere the role is shown, rather
than sitting inside a checklist somebody has to reopen: `alerts:confirm` (the
only permission that can begin an escalation) and `users:manage` (someone with
it can change what everyone can do, including their own role, and can hand the
same permission on). No extra friction on save — just legibility where the
decision is made.

**Deleting a role somebody holds is two decisions, not one.** The role goes, and
something has to happen to the people who had it — so the page asks: move them
to another role, or leave them without one, spelled out ("They keep their account
and everything they have ever confirmed. They will not be able to see anything
until somebody gives them a role"). No silent cascade. The default Admin role
cannot be deleted at all: an organisation that removes the role granting
`users:manage` has locked itself out, and no dialogue makes that recoverable.

**Deactivating is not deletion, and says so.** Access stops; the account and
every confirmation they ever made stay exactly as they are. Those confirmations
are the organisation's record of who decided what, and that is not an
administrator's to rewrite.

Status uses `StatusWord` under the same restraint rule: active, invited and
deactivated are all just facts and stay neutral. An invite nobody has answered in
seven days is the one that takes Signal.

Nothing on this page is optimistic. A module toggle is, because a switch has to
move under the finger — but saving a role, deleting one, inviting somebody and
turning off their access are deliberate acts behind a button, and every one
changes what a real person can see.

## Detection modules

[/org/modules](src/pages/org/modules/index.tsx) is where an org admin chooses
which detections run on which cameras. Cameras are grouped by the zone captured
during setup, each camera row expands to its module list, and each zone carries
an **Apply to all** action so a forty-camera site is not configured one at a
time.

`module_status` is a frozen field in the backend's contract, and
[src/lib/modules/api.ts](src/lib/modules/api.ts) treats it as one. A `live`
module can be switched on; a `coming_soon` module is rendered in full — name,
description, a plain **Coming soon** label — with its switch disabled and no
styling that makes it look broken. It is a roadmap being shown honestly, not a
dead control. Two rules enforce that:

- An **unrecognised status is read as `coming_soon`, never as `live`.** If the
  contract grows a state this build has not heard of, the failure falls on the
  side of offering less rather than offering something that does not exist.
- **`falsePositiveRate` is null for anything not live.** A module that has never
  run has no measured rate, and a plausible-looking number would be a
  fabrication. Live rates come off the module record, never recomputed in the
  component that draws them.

The backend refuses a non-live module too (`409` → `not_live`), and the mock
does the same — the disabled switch is a courtesy, not the enforcement.

**Toggling is optimistic; failure is not.** A switch has to move under the
finger, so the cache is updated straight away — but if the write fails, the
switch goes back where it was and the row says plainly that it didn't save. The
interface never keeps showing a state the server did not agree to. That is the
alert confirmation's rule, applied to a much smaller decision. The zone-wide
action is deliberately *not* optimistic: it sits behind a confirm step, so
nobody is waiting on a switch, and guessing at forty rows only to put them all
back would be worse than a moment's wait.

The confirm step is the light version of the same seriousness — a sentence
saying exactly what is about to happen and a button to agree. Press-and-hold
stays where it belongs, on the one decision that puts a person's name against a
threat.

A camera with nothing running reads **Nothing running** in Signal, the same way
the camera list reads an offline one. It is the most useful thing this page can
say without being opened: that camera is watching nobody.

With no cameras connected, the page shows
[NoCamerasYet](src/components/camera/no-cameras-yet.tsx) — the same component the
camera list uses, with a different opening line. Cameras are the actual
precondition, so the two pages have one version of that conversation rather than
two that can drift.

Permissions use the existing `modules:manage` grant that already gates the route
in [nav.ts](src/lib/auth/nav.ts) — no new key. The check is repeated against the
controls anyway, so the page stays correct if that gate is ever widened.

## The alert queue

[src/components/alert/alert-queue.tsx](src/components/alert/alert-queue.tsx) and
[alert-detail.tsx](src/components/alert/alert-detail.tsx) are one page mounted at
two routes: `/alerts` for a member's own watch, `/org/alerts` for an org admin's
whole estate. Which rows come back is the session's business, decided on the
server — there is no second implementation for the view-only case either. The
`alerts:confirm` grant disables the control and gives a reason; it does not
change the page.

Two ordering and colour rules carry most of the meaning:

- **Unreviewed first, then newest first.** Status is not a tie-break; it is the
  point. Nothing should sit waiting on a person because it was raised on a quiet
  afternoon and got pushed down the page by things already dealt with.
- **Colour the word only when something needs a person.** `Awaiting human` takes
  Signal, `Confirmed` takes a Confirm dot with neutral text, `False positive`
  goes quiet. That rule is now in
  [status-word.tsx](src/components/ui/status-word.tsx), shared with the camera
  list, and stays clear of `Badge` — whose variants mean alert states
  specifically.

An empty **Awaiting human** queue is the good outcome, and the copy says so
rather than apologising for having nothing to show. It is the one empty state in
the product that is worth reaching.

The detail view is Ink inside a Paper page, because the style guide designs the
confirmation card as control-room chrome — the change of ground separates the
one moment on the page that carries responsibility from the list that led there.
It reuses [HoldToConfirm](src/components/alert/hold-to-confirm.tsx) unchanged
apart from one additive prop, `disabledReason`, which replaces the hint when the
control is disabled so it never tells someone to press and hold something they
cannot use — and because the hint is what `aria-describedby` points at, the
reason is announced with the button.

Nothing about a decision is optimistic. This is the one place in the product
where the interface must not claim something has happened until the server says
it has: a decision that fails resets the control (the style guide's own
`resetKey` trick) and says plainly that nothing was recorded and the alert is
still waiting.

## The confirmation interaction

[src/components/alert/hold-to-confirm.tsx](src/components/alert/hold-to-confirm.tsx)
is the one interaction in the app allowed to feel heavy. The operator presses
and holds for 1.4s; the fill is driven by real elapsed time via `requestAnimationFrame`,
releasing early aborts loudly, and key repeat is ignored so a stuck key cannot
fake a hold. Under `prefers-reduced-motion` it becomes an explicit two-stage
confirm that disarms after 8s, rather than the same animation played faster.

Everything else in the app should stay quiet around it.

## Routing and role splitting

Routes are grouped by role area, and each area is exactly one chunk:

| Area          | Routes                                  | Chunk                                    |
| ------------- | --------------------------------------- | ---------------------------------------- |
| Super admin   | `/admin/*` — 7 pages                    | [src/routes/areas/admin.ts](src/routes/areas/admin.ts) |
| Org admin     | `/org/*` — 10 pages, plus the camera flow | [src/routes/areas/org.ts](src/routes/areas/org.ts)   |
| Member        | `/alerts`, `/cameras`                   | [src/routes/areas/scoped.ts](src/routes/areas/scoped.ts) |

The alert queue is reached from both the org and member areas, so the bundler
lifts it into a chunk they share rather than shipping it twice. Area isolation
is unaffected: it is still true that nothing an admin-only area contains reaches
a lower-permission account.

The guard runs *before* the chunk is requested, not after: a lower-permission
account never downloads a higher-permission area's code. That is why the pages
sit behind `React.lazy` rather than React Router's route-level `lazy` — a
route's `lazy()` runs while the match resolves, which would fetch the chunk and
only then refuse it. See [src/routes/lazy.ts](src/routes/lazy.ts).

Which routes a person can reach is decided in one place,
[src/lib/auth/nav.ts](src/lib/auth/nav.ts):

- their **area** is read off `landingPathFor` — whichever area owns the path
  they land on after signing in, so the login redirect and the sidebar cannot
  drift apart;
- the **items inside it** are filtered by `can()`, grant by grant.

`canVisit` answers both the sidebar and the route guard, so a route someone
cannot click is the same route they cannot reach by typing — it is not rendered
and disabled, it is not there. A flow that lives under a nav item rather than
being one — `/org/cameras/connect` — is admitted by the item it sits beneath,
via the `gate` argument in `router.tsx`, so the rule is still written once. Areas are mutually exclusive: a super admin holds
every grant implicitly, and that separation is what keeps a tenant's surfaces
from appearing beside the platform's.

None of this is security. The backend authorises every request; this decides
what to draw. See the note in [src/lib/auth/claims.ts](src/lib/auth/claims.ts).

## Connecting cameras

[/org/cameras](src/pages/org/cameras/index.tsx) is the camera list, and
[/org/cameras/connect](src/pages/org/cameras/connect/index.tsx) is the four-step
flow that fills it: pair the box, look for cameras, name and confirm, done.

The wizard reuses the signup wizard's shape — progress rules, one step at a
time, focus moved to each new step — with the heading dropped a level, since it
sits on a page that already owns an `h1`. It holds its state in the page rather
than a store: signup persists to sessionStorage because a customer can refresh
mid-checkout, but here a refresh drops the access token and ends the session, so
anything stored could never be resumed.

Every state the flow can actually reach is built, including the ones that are
nobody's fault: **nothing found** (with the three reasons it usually happens, a
retry, and adding a camera by hand), **some channels failed** (listed
separately, with what to do about each), and **the box went quiet between
pairing and looking**. Finding zero cameras is a real outcome of a working
system, not an error, and it is not a dead end.

The mock's pairing code decides which of those you get — the first block is the
switch, and the field shows the list in dev:

| Code        | What happens                                        |
| ----------- | --------------------------------------------------- |
| `DEMO-1234` | Pairs, finds five cameras, all of them ready         |
| `HALF-1234` | Pairs, finds five — two it can't get a picture from  |
| `NONE-1234` | Pairs, finds nothing                                 |
| `DOWN-1234` | Pairs, then the box stops answering                  |
| `GONE-1234` | The code has expired                                 |
| anything else | No such box                                        |

The camera list starts empty, which is what a new organisation actually sees.
Running the flow fills it; a reload empties it again. The modules mock fails
**every fifth write** on purpose, so the revert path is something you meet by
using the page rather than something you have to take on trust — deterministic,
because a random failure cannot be demonstrated twice.

Copy keeps to the customer's vocabulary throughout. A recorder has *channels*, a
camera has a *picture*, and an address is an address — the protocol names are in
the box's firmware and in this repo's URLs, and nowhere on screen.

## The app shell

[src/components/app-shell/](src/components/app-shell/) — Ink sidebar and header
around a Paper content surface, the same split the style guide establishes.
Below `lg` the sidebar is not narrowed but put away into a drawer: a
control-room nav squeezed into a 320px gutter is unusable, and a bottom bar
cannot hold ten items without abbreviating them into guesswork. The drawer
traps focus, closes on Escape, and returns focus to the control that opened it.
A route change moves focus to the top of the new page, the same way the login
and signup step containers do.

## Adding components

`components.json` is configured, so the CLI works as normal:

```bash
npx shadcn@latest add dialog
```

New primitives inherit the tokens above with no extra wiring.
