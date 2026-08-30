# Detecto — alert stream server

A thin Socket.IO server that runs the Phase 1 inference script, turns its
detection events into the shape the frontend's alert queue already expects, and
pushes them to connected clients.

It adds no intelligence of its own. Everything it emits was decided by
`inference/live_infer.py`; this layer only filters, renames and forwards.

```
live_infer.py ──JSONL on stdout──▶ server ──"alert:new"──▶ browser
                                     │
                                     ├─ drops every "Normal" window
                                     └─ collapses a run of same-class windows
                                        into one alert per incident
```

## Scope

Deliberately not here: authentication, persistence, multiple cameras, replay of
missed alerts. One hardcoded feed, matching Phase 1. Alerts exist only in
flight — a client that connects late has missed whatever came before it.

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

```bash
cd detecto-backend
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
DETECTO_VIDEO=path/to/clip.mp4 python server/app.py
```

`GET /health` reports whether inference is alive and how many windows have been
seen, skipped, merged into open incidents, and emitted.

### Watching the stream without the frontend

```bash
python server/scripts/capture_alerts.py --count 5
```

Connects as a real Socket.IO client and prints each alert as it arrives. This
reads what actually crossed the wire, rather than trusting the server's own log.

## Configuration

All environment variables, all optional.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DETECTO_VIDEO` | `Detecto_Demo_Package/sample_outputs/test_video.mp4` | Clip to run |
| `DETECTO_CAMERA_ID` | `demo-camera-1` | Passed to `--camera-id`, echoed as `cameraId` |
| `DETECTO_CAMERA_NAME` | `Demo camera 1` | `cameraName` — Phase 1 has no name to give |
| `DETECTO_ZONE` | `Demo feed` | `zone` — likewise |
| `DETECTO_MODEL` | `r3d18-scvd 0.1` | `model`, the build an alert is traced back to |
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
  "cameraId": "demo-camera-1",
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
| — | `id` | `ALR-0001`, `ALR-0002`, … Per-process; nothing is persisted |
| `camera_id` | `cameraId` | Straight through |
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
