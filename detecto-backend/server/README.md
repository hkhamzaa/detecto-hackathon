# Detecto — alert stream server

A thin Socket.IO server that runs the Phase 1 inference script, turns its
detection events into the shape the frontend's alert queue already expects,
pushes them to connected clients in real time, and durably saves each one
through the Node API (`detecto-backend/api`) so it survives a page reload.

It adds no intelligence of its own. Everything it emits was decided by
`inference/live_infer.py`; this layer only filters, renames, forwards, and
persists.

```
                                     ┌─"alert:new"──▶ browser (real time)
live_infer.py ──JSONL on stdout──▶ server
                                     └─POST /api/alerts──▶ Node API ──▶ Postgres
                                        (best-effort; never blocks the above)
```

The filtering — dropping every `Normal` window, collapsing a run of
same-class windows into one alert per incident (both described below) —
happens exactly as before, upstream of both arrows. Persistence is additive:
it never replaces or delays the socket emission.

## Scope

Deliberately not here: user authentication of its own, multiple cameras,
replay of missed alerts. One hardcoded feed, matching Phase 1. The live socket
feed is still in-flight-only — a client that connects late has missed whatever
came before it over the socket — but every alert now also exists in Postgres
via the Node API, reachable through the ordinary `GET /api/alerts` a client
that connected late (or reloaded) can call instead.

## Persistence, and the internal API key

Every alert this server emits is also `POST`ed to `detecto-backend/api`'s
`POST /api/alerts`, authenticated with a shared secret — not a user's JWT,
because there is no signed-in person behind a detection the model raised on
its own. Both services read the same value from their own environment:

| Here (`server/`) | There (`api/.env`) |
| --- | --- |
| `DETECTO_API_KEY` | `INTERNAL_API_KEY` |

They must be byte-for-byte identical. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

and set it in both places. This is a shared secret between two services
running on the same machine, not a substitute for real service-to-service
auth (mTLS, a rotating token, etc.) — acceptable because both processes are
local and neither is exposed beyond `127.0.0.1` in this setup. If either
service is ever deployed somewhere the other end of that connection isn't
trusted by default, this needs to become something stronger before that
happens.

**`DETECTO_CAMERA_ID` must be a real camera's id, not a made-up string.**
`alerts.camera_id` in the schema is a `uuid` foreign key to an actual row in
`cameras` — the API looks the camera up to find out which organization the
alert belongs to (see `api/src/routes/alerts.js`; the org is deliberately
never taken from anything this server sends). `db/seed.js` seeds a
"Demo camera 1" / "Demo feed" camera for exactly this purpose and prints its
id when you run it:

```bash
cd detecto-backend/db && npm run seed
# Demo camera id (for DETECTO_CAMERA_ID): <uuid>
```

Without a valid `DETECTO_CAMERA_ID`, the socket feed still works — the
frontend still sees alerts in real time — but every persist attempt fails
validation (`422 cameraId`) and is logged as a warning here. Persistence is
best-effort by design (see `Pipeline._persist` in `app.py`): a database or
network hiccup, or a misconfigured camera id, must never take the live feed
down with it. Check `alertsPersisted` / `persistFailures` on `GET /health` if
alerts seem to be arriving live but not surviving a reload.

## Setup

The server runs `live_infer.py` with the same interpreter, so both dependency
sets go in the same environment as the existing `inference/` setup:

```bash
cd detecto-backend

source .venv/Scripts/activate      # Windows (Git Bash)
# .venv\Scripts\activate           # Windows (PowerShell)
# source .venv/bin/activate        # macOS / Linux

pip install -r server/requirements.txt
```

If you have not set up `inference/` yet, do that first — see
[`../inference/README.md`](../inference/README.md). Without torch, torchvision,
opencv and the model weights, the subprocess exits on startup and the server
serves an empty stream.

## Run

The Node API (`detecto-backend/api`) must already be running, migrated and
seeded first — this server posts to it on every alert. `DETECTO_API_KEY` and
`DETECTO_CAMERA_ID` are both required; see "Persistence, and the internal API
key" above for where each comes from.

```bash
cd detecto-backend
DETECTO_API_KEY=<matches api's INTERNAL_API_KEY> \
DETECTO_CAMERA_ID=<uuid db/seed.js printed> \
python server/app.py
```

Listens on `http://127.0.0.1:8000`. The Socket.IO endpoint is the default
`/socket.io`, so the frontend needs no path configuration:

```ts
import { io } from 'socket.io-client'

const socket = io('http://127.0.0.1:8000')
socket.on('alert:new', (alert) => { /* ... */ })
```

Point it at a different clip:

```bash
DETECTO_VIDEO=path/to/clip.mp4 DETECTO_API_KEY=... DETECTO_CAMERA_ID=... python server/app.py
```

`GET /health` reports whether inference is alive, how many windows have been
seen, skipped, merged into open incidents, and emitted, and how many of those
were persisted to Postgres vs. failed to persist
(`alertsPersisted`/`persistFailures`).

### Watching the stream without the frontend

```bash
python server/scripts/capture_alerts.py --count 5
```

Connects as a real Socket.IO client and prints each alert as it arrives. This
reads what actually crossed the wire, rather than trusting the server's own log.

## Configuration

All environment variables, all optional **except `DETECTO_API_KEY`**, which
the server refuses to start without.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DETECTO_VIDEO` | `Detecto_Demo_Package/sample_outputs/test_video.mp4` | Clip to run |
| `DETECTO_CAMERA_ID` | `demo-camera-1` | Passed to `--camera-id`, echoed as `cameraId`. **Must be a real camera's uuid for persistence to succeed** — see above; the literal string default is not one, and only the socket transport will work with it |
| `DETECTO_CAMERA_NAME` | `Demo camera 1` | `cameraName` — Phase 1 has no name to give |
| `DETECTO_ZONE` | `Demo feed` | `zone` — likewise |
| `DETECTO_MODEL` | `r3d18-scvd 0.1` | `model`, the build an alert is traced back to |
| `DETECTO_API_URL` | `http://127.0.0.1:4000` | Where `detecto-backend/api` listens |
| `DETECTO_API_KEY` | *(none — required)* | Must equal `INTERNAL_API_KEY` in `api/.env` exactly |
| `DETECTO_API_TIMEOUT_SECONDS` | `5` | Per-request timeout for the persist POST |
| `DETECTO_HOST` / `DETECTO_PORT` | `127.0.0.1` / `8000` | Bind address |
| `DETECTO_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated; Vite's dev server |
| `DETECTO_REALTIME` | `1` | `0` disables wall-clock pacing (`--no-realtime`) |
| `DETECTO_WEAPON_DETECTOR` | `1` | `0` passes `--no-weapon-detector` |
| `DETECTO_FRAME_IMAGE` | `1` | Capture a JPEG still for each alert. `0` omits `frameImage` |
| `DETECTO_FRAME_MAX_PX` | `640` | Longest side of the captured still, before encoding |
| `DETECTO_FRAME_QUALITY` | `75` | JPEG quality, 1–100 |
| `DETECTO_MAX_EVENTS` | `0` | Stop the subprocess after N windows (0 = no limit) |
| `DETECTO_LOG_LEVEL` | `INFO` | `DEBUG` also logs each skipped `Normal` and each window merged into an open incident |
| `DETECTO_PYTHON` | current interpreter | Interpreter used for the subprocess |

Note that `DETECTO_REALTIME=0` makes the video finish in a few seconds, so a
client that has not connected yet will miss the whole run.

## What goes out

Event name: **`alert:new`**. Payload is one `Alert`, matching the type in
`detecto-frontend/src/lib/alerts/api.ts`:

```json
{
  "id": "ALR-0001",
  "cameraId": "13d32327-a694-4ef8-8c00-3ebc951fce68",
  "cameraName": "Demo camera 1",
  "zone": "Demo feed",
  "kind": "weapon",
  "subtype": null,
  "confidence": 0.962,
  "detectedAt": "2026-08-30T12:52:06.591684Z",
  "model": "r3d18-scvd 0.1",
  "status": "unconfirmed",
  "decidedBy": null,
  "decidedAt": null,
  "pipelineStatus": "beta",
  "frameImage": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA…"
}
```

### How Phase 1's fields become these

| Phase 1 | `Alert` | |
| --- | --- | --- |
| — | `id` | `ALR-0001`, `ALR-0002`, … Generated per-process (resets on restart), but now persisted through the API — see "Persistence" above for what a restart's colliding ids mean |
| `camera_id` | `cameraId` | Straight through — must be a real camera's uuid; see `DETECTO_CAMERA_ID` above |
| — | `cameraName`, `zone` | From config. Phase 1 knows an id, not a place |
| `classification` | `kind` | `Violence` → `violence`, `Weaponized` → `weapon` |
| — | `subtype` | Always `null` — see below |
| `confidence` | `confidence` | Straight through, unrounded |
| `timestamp` | `detectedAt` | ISO-8601, requested via `--timestamp-mode iso8601` |
| — | `model` | From config |
| — | `status` | Always `unconfirmed`. Nobody has decided yet |
| — | `decidedBy`, `decidedAt` | Always `null`, for the same reason |
| — | `pipelineStatus` | Always `"beta"` — see below |
| `frame_image` | `frameImage` | JPEG `data:` URL of the flagged still; absent when not captured |

`weapon_detected`, `weapon_confidence` and `weapon_note` are **not** forwarded.
The frontend schema has nowhere to put them, and inventing fields for them would
put unverified detector output on screen next to a real confidence score.

## Decisions worth knowing about

**`Normal` never becomes an alert.** Phase 1 emits a window every 0.5s and most
of them are `Normal`. Those are dropped silently — `Normal` is the absence of an
alert, and a queue that fills with them is a queue people stop reading. Only
`Violence` and `Weaponized` cross the socket. Run with `DETECTO_LOG_LEVEL=DEBUG`
to watch the ones being dropped.

**One incident raises one alert.** The classifier reports on a sliding window,
so a single six-second event produces a dozen windows all saying the same
thing. `IncidentGrouper` in `translate.py` collapses them. The whole rule:

- the class differs from the run currently open → raise
- a `Normal` window closed the previous run → the next detection raises
- otherwise → stay quiet, the incident already has an alert

There are deliberately no confidence thresholds, no timers and no minimum run
length. Those need real footage and someone who knows the domain to choose, and
a rule nobody can explain is worse than one that is merely coarse.

Two consequences, stated rather than hidden. An incident that escalates mid-run
(`Violence` → `Weaponized`) raises a second alert, because the class changed. And
a single `Normal` window inside an otherwise continuous event splits it in two,
because the rule has no notion of how long a gap has to be to count. On
`test_video.mp4` that is not hypothetical: two of the six alerts come from runs
separated by exactly one `Normal` window. Tolerating one-window gaps would take
the count to four. That is the first knob to reach for, and it needs footage to
justify a number.

**Stills are captured only for alerting windows.** `live_infer.py --include-frame`
encodes the window's *last* frame — matching `timestamp`, which is the window's
end, so the picture is of the moment the alert claims. `Normal` windows are never
encoded: they are ~34% of the stream and nobody will ever look at them. At the
640px/quality-75 default a still is ~29KB of JPEG, ~38KB once base64'd into the
payload, which at six alerts per run is ~230KB total.

The flag is off by default in `live_infer.py`, so Phase 1's documented schema is
unchanged for anyone not asking for a frame. The server turns it on.

**`subtype` is always `null`.** The schema documents `null` as *"the model only
had a class"*, which is exactly the situation. The only per-instance label Phase
1 could offer is `weapon_label` from the YOLO detector — the one its own README
marks `unverified`, notes fires on ~81% of clips including most no-weapon Normal
ones, and forbids from influencing the alert. Rendering that as `Weapon ·
handgun` would present a guess as a finding.

**`pipelineStatus: "beta"` is a field the frontend does not have yet.** There is
no existing field for *"this came from a pipeline we do not trust yet"*. The
nearest candidate is `model`, but that exists so a bad release can be traced to
a build, and overloading it would cost that. So this is a thirteenth key,
camelCase to match the schema's conventions.

The frontend now carries it: `Alert` declares `pipelineStatus?: 'beta'` and
`parseAlert()` attaches it when — and only when — the payload claims exactly
`"beta"`. It is optional rather than `string | null` because every other field
on `Alert` is a fact each alert has, while this one is a claim only an untrusted
pipeline makes; absence is the normal case. Nothing else in the frontend was
touched, and nothing reads the field yet — displaying it is still to do.

## Known open question

Every alert this server has produced from `test_video.mp4` is `Weaponized`;
`Violence` has never fired. That is consistent with a weapon-heavy clip and
equally consistent with `VIOLENCE_CLASSES` in `live_infer.py` being in the wrong
order — the checkpoint is a bare `state_dict` and stores no class mapping, so
the order was inferred rather than read. See "Assumptions worth verifying" in
[`../inference/README.md`](../inference/README.md).

This is **not** to be fixed by guessing a different order. It needs verification
against the original training script, which is pending DL specialist
availability. Until then, treat the `kind` on every alert as unconfirmed —
which is, in fairness, exactly what `pipelineStatus: "beta"` is there to say.

## Layout

```
server/
├── app.py                    server, subprocess supervision, Socket.IO
├── translate.py              Phase 1 event -> Alert, plus incident grouping
├── requirements.txt
└── scripts/
    ├── capture_alerts.py     Socket.IO client for checking the wire
    └── capture_frame.py      Saves one alert's captured still to a .jpg
```
