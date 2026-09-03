#!/usr/bin/env python3
"""Socket.IO server that turns Phase 1's JSONL stream into frontend alerts.

Thin by design. It owns four jobs and nothing else:

  1. Run `inference/live_infer.py` as a subprocess and read its JSONL stdout.
  2. Drop every `Normal` window; translate the rest into the frontend's `Alert`
     shape (see `translate.py` -- the shape is copied from the frontend, not
     designed here).
  3. Emit each one on `alert:new` and log what went out.
  4. POST each one to the Node API (`detecto-backend/api`) so it durably
     exists in Postgres, not only in flight over the socket. Best-effort:
     see `Pipeline._persist` for why a failure here never takes the socket
     feed down with it.

No user authentication of its own. Cameras can be named at boot via
`DETECTO_CAMERAS` (or the single-camera DETECTO_* defaults) and also
started and stopped later via POST/DELETE /pipelines, which is how a
mid-session upload gets a subprocess without restarting this server.
The Node API is reached with a shared internal key (`DETECTO_API_KEY`),
not a user session -- see server/README.md.

The inference script is run as a subprocess rather than imported because it is
a CLI that owns its own capture loop and pacing, and because a crash in a model
forward pass then takes down a process we can see exit rather than the server.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aiohttp
import socketio
import uvicorn
from fastapi import Body, Depends, FastAPI, Header, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent))

from translate import (  # noqa: E402
    PIPELINE_STATUS,
    PIPELINE_STATUS_KEY,
    AlertIdSequence,
    IncidentGrouper,
    is_alertable,
    to_alert,
)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
INFER_SCRIPT = BACKEND / "inference" / "live_infer.py"
DEFAULT_VIDEO = BACKEND / "Detecto_Demo_Package" / "sample_outputs" / "test_video.mp4"
# Always the locked-in multi-head weights — never the previous 3-class
# softmax, even if live_infer.py's CLI default were pointed back at it.
MULTIHEAD_WEIGHTS = BACKEND / "inference" / "models" / "detecto-hackathon-final.pt"
WEAPON_LOCALIZER_WEIGHTS = BACKEND / "inference" / "models" / "weapon_localizer_yolov8.pt"

# The event name the frontend listens on. Namespaced so a second stream (say
# `camera:status`) can be added later without renaming this one.
ALERT_EVENT = "alert:new"
# Every window, including Normal — the live overlay, not the alert queue.
TICK_EVENT = "detection:tick"
TICK_HISTORY_EVENT = "detection:history"


def camera_room(camera_id: str) -> str:
    return f"camera:{camera_id}"


def _env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in ("0", "false", "no", "off", "")


def _flag_or(value: Any, default: bool) -> bool:
    """Same truthy-string parsing as `_env_flag`, but over a JSON value that
    may already be a real bool (JSON has one) instead of an env string."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ("0", "false", "no", "off", "")


@dataclass
class CameraConfig:
    """Everything one inference subprocess needs for one camera.

    However many of these `Config.cameras` holds, each gets its own
    subprocess, its own source, and its own identity in every event/alert it
    produces -- cameras never share state with each other. `infer_command()`
    is the one place a `CameraConfig` becomes an actual `live_infer.py`
    invocation; see `VideoSource`/`build_video_source()` there for the other
    half of this seam.
    """

    camera_id: str
    camera_name: str
    zone: str
    model: str
    source_type: str = "file"
    video: Path | None = None
    rtsp_url: str | None = None
    realtime: bool = True
    weapon_detector: bool = True
    frame_image: bool = True
    frame_max_px: int = 640
    frame_quality: int = 75
    max_events: int = 0

    def infer_command(self, *, python: str) -> list[str]:
        command = [
            python,
            str(INFER_SCRIPT),
            "--source-type", self.source_type,
            "--camera-id", self.camera_id,
            # ISO-8601 is what `Alert.detectedAt` is: an instant, not an offset.
            "--timestamp-mode", "iso8601",
            "--violence-model", str(MULTIHEAD_WEIGHTS),
            "--weapon-model", str(WEAPON_LOCALIZER_WEIGHTS),
        ]
        if self.source_type == "file":
            command += ["--video", str(self.video)]
        else:
            # RTSPVideoSource is a structural stub (see live_infer.py) --
            # this branch exists so selecting it is a config value, not a
            # code change, once it's real. It will fail loudly on launch.
            command += ["--rtsp-url", self.rtsp_url or ""]
        if not self.realtime:
            command.append("--no-realtime")
        if not self.weapon_detector:
            command.append("--no-weapon-detector")
        if self.frame_image:
            command += [
                "--include-frame",
                "--frame-max-px", str(self.frame_max_px),
                "--frame-quality", str(self.frame_quality),
            ]
        if self.max_events:
            command += ["--max-events", str(self.max_events)]
        return command


class Config:
    """Everything tunable, read once at startup."""

    def __init__(self) -> None:
        self.python = os.environ.get("DETECTO_PYTHON", sys.executable)

        self.host = os.environ.get("DETECTO_HOST", "127.0.0.1")
        self.port = int(os.environ.get("DETECTO_PORT", "8000"))
        self.cors_origins = [
            origin.strip()
            for origin in os.environ.get(
                "DETECTO_CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5176,http://127.0.0.1:5176",
            ).split(",")
            if origin.strip()
        ]
        self.log_level = os.environ.get("DETECTO_LOG_LEVEL", "INFO").upper()

        # Where the Node API (detecto-backend/api) listens, and the shared
        # secret it checks on POST /api/alerts. Required, not defaulted to
        # an empty string: a server that would silently POST with no key
        # (and get a uniform 401 from every alert, forever) is a worse
        # failure mode than one that refuses to start and says why.
        self.api_url = os.environ.get("DETECTO_API_URL", "http://127.0.0.1:4000")
        self.api_key = os.environ.get("DETECTO_API_KEY")
        self.api_timeout_seconds = float(os.environ.get("DETECTO_API_TIMEOUT_SECONDS", "5"))

        self.cameras = self._load_cameras()

    def _load_cameras(self) -> list[CameraConfig]:
        """N independently-configured cameras, one inference subprocess each.

        `DETECTO_CAMERAS`, if set, is a JSON array of camera objects --
        adding a second camera (a second test video today; a second real
        RTSP feed once that exists) is then a config change: append an
        object, restart this process. No field is required on an entry;
        anything omitted falls back to this server's own DETECTO_* env
        defaults below, so a fleet-wide default (weapon detector on, frame
        images on, etc.) still only needs setting once, not once per camera.

        Unset (the default), this returns exactly one camera built from the
        same DETECTO_CAMERA_ID/_NAME/_ZONE/DETECTO_VIDEO/... env vars this
        server has always read -- today's single-camera behavior is just
        the N=1 case of this, byte-for-byte unchanged.

        An explicit empty array (`DETECTO_CAMERAS=[]`) is the other
        deliberate case: no cameras at boot. Pipelines can then be started
        later via POST /pipelines, which is how a mid-session upload gets a
        subprocess without restarting this server.
        """
        raw = os.environ.get("DETECTO_CAMERAS")
        if not raw:
            return [self._camera_from_dict({})]

        try:
            entries = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"[error] DETECTO_CAMERAS is not valid JSON: {exc}")
        if not isinstance(entries, list):
            raise SystemExit("[error] DETECTO_CAMERAS must be a JSON array")
        return [self._camera_from_dict(entry) for entry in entries]

    def _camera_from_dict(self, entry: dict[str, Any]) -> CameraConfig:
        source_type = entry.get("sourceType", "file")
        video = entry.get("video") or os.environ.get("DETECTO_VIDEO", str(DEFAULT_VIDEO))
        return CameraConfig(
            camera_id=entry.get("id", os.environ.get("DETECTO_CAMERA_ID", "demo-camera-1")),
            # Phase 1 knows an id, not a name or a place -- both are set here,
            # same as the single-camera build always did.
            camera_name=entry.get("name", os.environ.get("DETECTO_CAMERA_NAME", "Demo camera 1")),
            zone=entry.get("zone", os.environ.get("DETECTO_ZONE", "Demo feed")),
            # What `Alert.model` reports: "the model build that raised it, so
            # a bad release can be traced".
            model=entry.get("model", os.environ.get("DETECTO_MODEL", "detecto-hackathon-final")),
            source_type=source_type,
            video=Path(video) if source_type == "file" else None,
            rtsp_url=entry.get("rtspUrl"),
            # Realtime pacing on by default: a wall-clock-paced stream is
            # what a real feed looks like. Turn it off to chew through a
            # file fast.
            realtime=_flag_or(entry.get("realtime"), _env_flag("DETECTO_REALTIME", True)),
            weapon_detector=_flag_or(
                entry.get("weaponDetector"), _env_flag("DETECTO_WEAPON_DETECTOR", True)
            ),
            # On by default here, unlike in the script: an alert on screen
            # wants a picture of what was seen. Only alerting windows are
            # ever captured.
            frame_image=_flag_or(entry.get("frameImage"), _env_flag("DETECTO_FRAME_IMAGE", True)),
            frame_max_px=int(entry.get("frameMaxPx", os.environ.get("DETECTO_FRAME_MAX_PX", "640"))),
            frame_quality=int(entry.get("frameQuality", os.environ.get("DETECTO_FRAME_QUALITY", "75"))),
            max_events=int(entry.get("maxEvents", os.environ.get("DETECTO_MAX_EVENTS", "0"))),
        )


config = Config()

logging.basicConfig(
    level=getattr(logging, config.log_level, logging.INFO),
    format="%(asctime)s %(levelname)-5s %(name)s | %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("detecto.server")
infer_log = logging.getLogger("detecto.infer")

# --------------------------------------------------------------------------
# Socket.IO
# --------------------------------------------------------------------------

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=config.cors_origins,
    logger=False,
    engineio_logger=False,
)

_clients: set[str] = set()


@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: Any = None) -> None:
    _clients.add(sid)
    log.info("client connected sid=%s (%d connected)", sid, len(_clients))


@sio.event
async def disconnect(sid: str, reason: str | None = None) -> None:
    _clients.discard(sid)
    log.info("client disconnected sid=%s (%d connected)", sid, len(_clients))


@sio.event
async def watch_camera(sid: str, data: Any = None) -> None:
    """Replay ticks already classified for this camera, then keep emitting live.

    The live page plays an uploaded file from t=0; inference may already be
    ahead. History lets the overlay look up a score by video.currentTime
    instead of only showing whatever arrived after the page opened.
    """
    camera_id = ""
    if isinstance(data, dict):
        camera_id = str(data.get("cameraId") or data.get("camera_id") or "")
    # One room per camera so a Watch-live page never receives another
    # pipeline's ticks (broadcast used to send every camera to every client).
    for room in sio.rooms(sid):
        if isinstance(room, str) and room.startswith("camera:"):
            await sio.leave_room(sid, room)
    if camera_id:
        await sio.enter_room(sid, camera_room(camera_id))
    pipeline = registry.get(camera_id) if camera_id else None
    ticks = list(pipeline.ticks) if pipeline else []
    await sio.emit(
        TICK_HISTORY_EVENT,
        {"cameraId": camera_id, "ticks": ticks},
        to=sid,
    )


# --------------------------------------------------------------------------
# The pipeline
# --------------------------------------------------------------------------

# Retry schedule for a camera whose subprocess exits with a nonzero code --
# see Pipeline._supervise(). Exponential, capped, never gives up: a real
# camera can come back online at any point in the future, and there is no
# "permanently failed" state a human hasn't chosen (stop()) that this code
# should invent on a camera's behalf.
RETRY_INITIAL_SECONDS = 2.0
RETRY_MULTIPLIER = 2.0
RETRY_MAX_SECONDS = 60.0


class Pipeline:
    """Owns one camera's inference subprocess and the two tasks draining its
    pipes. Independent of every other `Pipeline` -- its own process, its own
    HTTP session, its own counters, its own `IncidentGrouper` (debouncing
    must never see across cameras) -- with exactly one deliberate exception:
    `ids`. See the constructor's own note on why that one is shared rather
    than per-instance.

    Also independent in the way that matters for this phase: `_supervise()`
    is this camera's own retry loop, running in its own `asyncio.Task`. A
    subprocess crashing, a source that never existed, or an exception inside
    this Pipeline's own event handling all stay contained to this one
    Pipeline -- see `_read_events()`'s inner try/except for the last of
    those. Nothing here is awaited inline by `start()`/`lifespan()`, so one
    camera's failure (or its retry backoff, however long) can never block or
    propagate to any other camera or to the server itself.
    """

    def __init__(self, camera: CameraConfig, *, ids: AlertIdSequence, cpu_threads: int) -> None:
        self.camera = camera
        self.process: asyncio.subprocess.Process | None = None
        self.tasks: list[asyncio.Task[None]] = []
        self.supervisor_task: asyncio.Task[None] | None = None
        # Set by stop() so _supervise() knows a dead subprocess means "the
        # server is shutting down", not "go retry this camera again".
        self._stopping = asyncio.Event()
        # The honest status this camera currently reports -- see /health.
        # 'starting': first launch attempt, outcome not known yet.
        # 'running': subprocess alive and presumed healthy.
        # 'retrying': the last attempt failed (nonzero exit); backing off
        #   before the next one -- see `next_retry_at`.
        # 'stopped': either a deliberate shutdown, or the source finished
        #   cleanly (exit 0) and there is nothing left to retry.
        self.status = "starting"
        self.consecutive_failures = 0
        self.last_exit_code: int | None = None
        # The most recent stderr line this camera's subprocess ever printed
        # -- not cleared on a later clean run, so it stays available as "the
        # last thing that went wrong" even after recovery. Read alongside
        # `status`, not instead of it: a healthy `status: 'running'` camera
        # can still show an old `lastError` from a prior failed attempt.
        self.last_error: str | None = None
        self.next_retry_at: datetime | None = None
        # Shared across every Pipeline rather than one per camera -- purely
        # for simplicity, not correctness: `AlertIdSequence.take()` stamps
        # each alert with 32 random bits (see translate.py), so a per-camera
        # instance would be just as collision-safe as this one shared
        # instance. (It used to matter: a per-camera *counter* would have had
        # every camera's first alert collide on the same "ALR-0001" -- see
        # the Step 1 report on load testing for why that scheme was replaced
        # entirely, not just made per-camera.)
        self.ids = ids
        # NOT shared -- the opposite of `ids` above. Camera A's incident
        # state must never suppress or merge into camera B's; each Pipeline
        # keeps its own run of "what class is currently open".
        self.incidents = IncidentGrouper()
        # How many CPU threads this camera's subprocess should ask
        # BLAS/OpenMP/OpenCV for -- see `start()`. Divided across however
        # many cameras are configured so N concurrent subprocesses don't
        # each independently claim every core and contend with each other.
        self.cpu_threads = cpu_threads
        self.seen = 0
        self.skipped = 0
        self.merged = 0
        self.emitted = 0
        self.persisted = 0
        self.persist_failed = 0

        # One session for the process's lifetime, not one per POST -- reuses
        # the connection pool rather than paying a new TCP+TLS-less handshake
        # per alert.
        self.http: aiohttp.ClientSession | None = None
        # Persist calls are fired without awaiting them inline (see
        # `_handle`), so the pipeline doesn't stall on an HTTP round trip
        # between one alert and the next. Tracked here so `stop()` can wait
        # for whatever is still in flight instead of cancelling it mid-POST.
        self.persist_tasks: set[asyncio.Task[None]] = set()
        # Every window this run has classified, including Normal. The live
        # playback page asks for this on subscribe so a late join still has
        # scores to overlay against video.currentTime.
        self.ticks: list[dict[str, Any]] = []

    def _tally(self) -> str:
        return (
            f"{self.seen} window(s) seen, {self.skipped} Normal skipped, "
            f"{self.merged} merged into open incidents, "
            f"{self.emitted} alert(s) emitted, "
            f"{self.persisted} persisted, {self.persist_failed} persist failure(s)"
        )

    def _timeline_path(self) -> Path | None:
        video = self.camera.video
        if video is None:
            return None
        return video.with_name(f"{video.stem}.detections.json")

    def _persist_timeline(self, *, complete: bool) -> None:
        """Write the scored timeline next to the file so Watch live can
        look up a moment after this process has finished (or restarted).
        """
        path = self._timeline_path()
        if path is None:
            return
        try:
            path.write_text(
                json.dumps({"complete": complete, "ticks": self.ticks}),
                encoding="utf-8",
            )
        except OSError:
            log.exception("[%s] could not write detection timeline %s", self.camera.camera_id, path)

    async def start(self) -> None:
        self.http = aiohttp.ClientSession(
            headers={"X-Internal-Api-Key": config.api_key},
            timeout=aiohttp.ClientTimeout(total=config.api_timeout_seconds),
        )
        log.info(
            "[%s] camera=%s (%s / %s) source=%s model=%s realtime=%s",
            self.camera.camera_id, self.camera.camera_id, self.camera.camera_name,
            self.camera.zone, self.camera.source_type, self.camera.model, self.camera.realtime,
        )
        log.info("[%s] persisting alerts to %s/api/alerts", self.camera.camera_id, config.api_url)
        log.info(
            "[%s] capping subprocess to %d CPU thread(s) (of %d available)",
            self.camera.camera_id, self.cpu_threads, os.cpu_count() or self.cpu_threads,
        )
        # The retry loop itself, running detached in its own task -- `start()`
        # returns as soon as it's scheduled, so whoever called it (boot-time
        # `lifespan()`, or POST /pipelines) is not blocked by this camera's
        # launch, retries, or backoff.
        self.supervisor_task = asyncio.create_task(
            self._supervise(), name=f"supervise-{self.camera.camera_id}"
        )

    async def _supervise(self) -> None:
        """This camera's entire retry loop: spawn, wait for exit, decide
        whether that was a real failure or a deliberate stop, back off, and
        try again -- forever, unless `stop()` was called. Runs as its own
        task so nothing about it can block or crash any other Pipeline or
        the server itself; see the class docstring.
        """
        delay = RETRY_INITIAL_SECONDS
        while not self._stopping.is_set():
            self.status = "starting" if self.consecutive_failures == 0 else "retrying"
            try:
                exit_code = await self._spawn_and_wait()
            except Exception:
                # A bug in the supervising code itself (not the subprocess) --
                # e.g. failing to even launch it. Still must not crash the
                # server or touch any other Pipeline; log loudly, count it as
                # a failure, and let the same backoff below handle it.
                log.exception("[%s] supervisor error launching inference", self.camera.camera_id)
                exit_code = -1

            if self._stopping.is_set():
                self.status = "stopped"
                return

            self.last_exit_code = exit_code
            if exit_code == 0:
                # A clean, deliberate stop from inside live_infer.py itself
                # (hit --max-events, or a file source simply finished) --
                # not a failure. Retrying would just immediately reproduce
                # the exact same "clean exit", forever, for no benefit -- see
                # the Step 1 report on why exit code is the honest signal to
                # key this off, not anything cv2 exposes about *why* frames
                # stopped coming.
                self.status = "stopped"
                self.consecutive_failures = 0
                self._persist_timeline(complete=True)
                log.info(
                    "[%s] finished cleanly (exit=0); not retrying", self.camera.camera_id
                )
                return

            self.consecutive_failures += 1
            self.status = "retrying"
            self.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
            log.error(
                "[%s] inference failed (exit=%s, failure #%d) -- retrying in %.0fs",
                self.camera.camera_id, exit_code, self.consecutive_failures, delay,
            )
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass  # backoff elapsed; loop around and try again
            delay = min(delay * RETRY_MULTIPLIER, RETRY_MAX_SECONDS)

        self.status = "stopped"

    async def _spawn_and_wait(self) -> int:
        """One attempt: launch the subprocess, drain its pipes until it
        exits, return its exit code. Never raises for anything the
        subprocess itself does wrong (a bad source, a crash, being killed)
        -- those all just come back as a nonzero exit code, same as any
        other. Only a genuine bug in launching or draining it propagates,
        and `_supervise()` catches that too.
        """
        command = self.camera.infer_command(python=config.python)
        log.info("[%s] starting inference: %s", self.camera.camera_id, " ".join(command))
        self.ticks = []

        # PyTorch/OpenMP/MKL each default to claiming every logical core for
        # their own intra-op thread pool -- fine for one subprocess, but N
        # concurrent camera subprocesses would each make that same claim and
        # contend with each other instead of running genuinely in parallel.
        # These env vars are how OpenMP/MKL/OpenCV pick their thread count on
        # startup; setting them here (rather than inside live_infer.py) keeps
        # the split a server-level scheduling decision, not something the
        # inference script needs to know N for.
        subprocess_env = {
            **os.environ,
            "OMP_NUM_THREADS": str(self.cpu_threads),
            "MKL_NUM_THREADS": str(self.cpu_threads),
            "OPENCV_NUM_THREADS": str(self.cpu_threads),
        }
        self.process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(BACKEND),
            env=subprocess_env,
        )
        # stop() could have run while the line above was awaiting the OS to
        # actually spawn the process -- close that narrow a window rather
        # than leave a subprocess started after shutdown was already signaled
        # with nothing left to terminate it.
        if self._stopping.is_set():
            self.process.terminate()
            return await self.process.wait()

        self.tasks = [
            asyncio.create_task(self._read_events(), name="infer-stdout"),
            asyncio.create_task(self._read_diagnostics(), name="infer-stderr"),
        ]
        self.status = "running"

        # Both drain tasks finish once their pipe closes, which happens when
        # the process exits -- awaiting them is how this knows the process
        # is really done, not just that stdout went quiet.
        await asyncio.gather(*self.tasks, return_exceptions=True)
        exit_code = await self.process.wait()
        log.info(
            "[%s] inference finished (exit=%s): %s",
            self.camera.camera_id, exit_code, self._tally(),
        )
        return exit_code

    async def stop(self) -> None:
        self._stopping.set()
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.supervisor_task:
            try:
                await asyncio.wait_for(self.supervisor_task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self.supervisor_task.cancel()

        # Let whatever POSTs are still in flight finish rather than cancelling
        # them -- an alert that made it onto the socket deserves its best shot
        # at also making it into Postgres before the process exits.
        if self.persist_tasks:
            await asyncio.gather(*self.persist_tasks, return_exceptions=True)
        if self.http:
            await self.http.close()

        log.info("[%s] stopped: %s", self.camera.camera_id, self._tally())

    async def _read_events(self) -> None:
        """stdout is pure JSONL -- one detection window per line."""
        assert self.process and self.process.stdout
        async for raw in self.process.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                # Phase 1 promises stdout is only JSONL. If that ever stops
                # being true, say so loudly rather than dropping it silently.
                log.warning("non-JSON line on inference stdout: %r", line[:200])
                continue
            try:
                await self._handle(event)
            except Exception:
                # A bug in handling THIS window (a malformed event, sio.emit
                # erroring, whatever) must not silently kill the rest of this
                # camera's stream -- with nothing awaiting this task inline,
                # an uncaught exception here would otherwise just vanish into
                # asyncio's own "Task exception was never retrieved" warning,
                # invisible next to this server's actual logging, while the
                # subprocess itself kept running with nobody left reading its
                # output. Log it clearly and keep draining the next window.
                log.exception(
                    "[%s] error handling window #%d -- continuing",
                    self.camera.camera_id, self.seen,
                )

    async def _read_diagnostics(self) -> None:
        """stderr is the script's own logging. Surfaced, never parsed --
        except for keeping the last line around as `last_error`, so a
        failed camera's `/health` entry carries an actual reason (live_infer
        prints its own `[error] ...` line right before exiting on a bad
        source) rather than only a bare exit code."""
        assert self.process and self.process.stderr
        async for raw in self.process.stderr:
            message = raw.decode("utf-8", "replace").rstrip()
            if message:
                infer_log.info("[%s] %s", self.camera.camera_id, message)
                self.last_error = message

    async def _handle(self, event: dict[str, Any]) -> None:
        self.seen += 1

        tick = {
            "cameraId": event.get("camera_id") or self.camera.camera_id,
            "offsetS": event.get("offset_s"),
            "startS": event.get("window_start_s"),
            "endS": event.get("window_end_s"),
            "timestamp": event.get("timestamp"),
            "classification": event.get("classification"),
            "violence": event.get("violence_score"),
            "weapon": event.get("weapon_score"),
        }
        self.ticks.append(tick)
        self._persist_timeline(complete=False)
        await sio.emit(TICK_EVENT, tick, room=camera_room(self.camera.camera_id))

        # Every window is offered to the grouper, Normal included -- a Normal
        # window is what closes an open incident, so it carries information
        # even though it never becomes an alert.
        starts_incident = self.incidents.observe(event)

        # Normal is the absence of an alert, and it arrives every stride
        # (0.5s by default). Emitting it would make the socket a firehose of
        # nothing happening and teach the queue to ignore itself.
        if not is_alertable(event):
            self.skipped += 1
            log.debug(
                "skip #%d classification=%s confidence=%s",
                self.seen, event.get("classification"), event.get("confidence"),
            )
            return

        # A detection that continues an incident already raised. The operator
        # has been told; telling them again every 0.5s is noise, not urgency.
        if not starts_incident:
            self.merged += 1
            log.debug(
                "merge #%d into open %s incident (window %d, confidence=%s)",
                self.seen, self.incidents.open_class,
                self.incidents.window_count, event.get("confidence"),
            )
            return

        alert = to_alert(
            event,
            alert_id=self.ids.take(),
            camera_name=self.camera.camera_name,
            zone=self.camera.zone,
            model=self.camera.model,
        )
        await sio.emit(ALERT_EVENT, alert)
        self.emitted += 1

        # Fired, not awaited: persistence must never add HTTP latency to the
        # gap between one alert reaching the socket and the next one being
        # able to. See `_persist` for why a failure here is swallowed rather
        # than raised.
        task = asyncio.create_task(self._persist(alert), name=f"persist-{alert['id']}")
        self.persist_tasks.add(task)
        task.add_done_callback(self.persist_tasks.discard)

        # The frame is tens of kilobytes of base64 and would bury every other
        # line, so the log carries its size instead of its contents.
        loggable = dict(alert)
        frame = loggable.pop("frameImage", None)
        if frame is not None:
            loggable["frameImage"] = f"<{len(frame) // 1024}KB jpeg data url>"

        log.info(
            "[%s] %s -> %d client(s) | %s",
            self.camera.camera_id, ALERT_EVENT, len(_clients),
            json.dumps(loggable, separators=(",", ":")),
        )

    async def _persist(self, alert: dict[str, Any]) -> None:
        """POSTs one alert to the Node API so it durably exists in Postgres.

        Best-effort by design: this server's one job before this task was
        keeping the socket feed alive, and a database (or network, or API
        process) hiccup must not take that down with it. Every failure here
        is logged and counted, never raised -- the socket emission above has
        already happened by the time this runs, so the operator still sees
        the alert either way, with persistence failure visible only in this
        server's own logs and its `/health` tally.
        """
        assert self.http
        try:
            async with self.http.post(f"{config.api_url}/api/alerts", json=alert) as response:
                if response.status == 201:
                    self.persisted += 1
                    return

                # A 409 means the id this alert was stamped with already
                # named a row in Postgres -- with ids now 32 bits of random
                # hex (see AlertIdSequence), that is no longer the expected
                # outcome of a routine restart, it is a genuine anomaly: this
                # alert did NOT get a new row written for it, whatever
                # actually caused the clash. /health must never call that
                # "persisted" -- see the Step 1 report on load testing this
                # exact gap (persisted++ on 409 silently dropped real alerts
                # while claiming success). Counted and logged the same as any
                # other persist failure below.
                body = await response.text()
                self.persist_failed += 1
                log.warning(
                    "failed to persist %s: HTTP %d %s",
                    alert["id"], response.status, body[:300],
                )
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            self.persist_failed += 1
            log.warning("failed to persist %s: %s: %s", alert["id"], type(exc).__name__, exc)


class PipelineExistsError(Exception):
    """POST /pipelines named a cameraId that already has a Pipeline."""

    def __init__(self, camera_id: str) -> None:
        super().__init__(camera_id)
        self.camera_id = camera_id


class PipelineRegistry:
    """Owns every Pipeline in this process, whether it came from boot-time
    `config.cameras` or from a later POST /pipelines.

    The point of this object is that adding a camera after `lifespan()` has
    already yielded is not a second code path. `start()` constructs the
    same `Pipeline` class, with the same shared `AlertIdSequence`, the same
    per-camera `IncidentGrouper`, and the same CPU-thread split the boot
    list used to compute once at import -- so a dynamically-started
    pipeline is indistinguishable from a boot-time one in /health, in
    retry behaviour, and in how it dies.
    """

    def __init__(self) -> None:
        self._pipelines: dict[str, Pipeline] = {}
        self._lock = asyncio.Lock()
        # Shared across every Pipeline -- see Pipeline.__init__'s own note
        # on why `ids` (unlike `incidents`) must not be per-camera.
        self._ids = AlertIdSequence()

    def get(self, camera_id: str) -> Pipeline | None:
        return self._pipelines.get(camera_id)

    def snapshot(self) -> list[Pipeline]:
        return list(self._pipelines.values())

    def _cpu_threads_for_next(self) -> int:
        # Same formula the module-level list used, evaluated at launch
        # time rather than import time so a camera added later is capped
        # against however many are already running, not against however
        # many happened to be in the env at boot.
        n = len(self._pipelines) + 1
        return max(1, (os.cpu_count() or 4) // n)

    async def start(self, camera: CameraConfig) -> Pipeline:
        async with self._lock:
            if camera.camera_id in self._pipelines:
                raise PipelineExistsError(camera.camera_id)
            pipeline = Pipeline(
                camera,
                ids=self._ids,
                cpu_threads=self._cpu_threads_for_next(),
            )
            self._pipelines[camera.camera_id] = pipeline
        await pipeline.start()
        return pipeline

    async def stop(self, camera_id: str) -> bool:
        """Stop one pipeline and drop it from the registry.

        Returns False if nothing was running under that id. The entry stays
        in the map until `Pipeline.stop()` finishes so a concurrent POST of
        the same cameraId cannot spawn a second subprocess alongside the
        one that is still terminating -- it gets PipelineExistsError
        instead, and can retry once this returns.
        """
        async with self._lock:
            pipeline = self._pipelines.get(camera_id)
        if pipeline is None:
            return False
        await pipeline.stop()
        async with self._lock:
            if self._pipelines.get(camera_id) is pipeline:
                del self._pipelines[camera_id]
        return True

    async def stop_all(self) -> None:
        async with self._lock:
            pipelines = list(self._pipelines.values())
            self._pipelines.clear()
        if pipelines:
            await asyncio.gather(*(pipeline.stop() for pipeline in pipelines))


registry = PipelineRegistry()


# --------------------------------------------------------------------------
# ASGI app
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Only checks that apply to every camera identically belong here.
    # `INFER_SCRIPT` missing and `api_key` unset are real deployment
    # misconfigurations -- nothing can run without either, so failing the
    # whole server at boot is the honest answer for both.
    #
    # A single camera's own file being missing or unreadable is NOT one of
    # these -- it used to be checked here too (`raise SystemExit` per
    # camera), which meant one bad camera config took the entire fleet down
    # before any of them got to run (see the Step 1 report). That check is
    # gone: a bad source is now exactly what Pipeline._supervise()'s own
    # first launch attempt discovers and retries, the same as a source that
    # goes bad after a clean start. One mechanism, not two.
    if not INFER_SCRIPT.exists():
        raise SystemExit(f"[error] missing file: {INFER_SCRIPT}")
    if not MULTIHEAD_WEIGHTS.exists():
        raise SystemExit(f"[error] missing new model: {MULTIHEAD_WEIGHTS}")
    if not WEAPON_LOCALIZER_WEIGHTS.exists():
        raise SystemExit(f"[error] missing weapon localizer: {WEAPON_LOCALIZER_WEIGHTS}")
    if not config.api_key:
        raise SystemExit(
            "[error] DETECTO_API_KEY is not set. It must match INTERNAL_API_KEY "
            "in detecto-backend/api's environment -- see server/README.md."
        )
    # Boot-time cameras (including "none" -- DETECTO_CAMERAS=[]) go through
    # the same registry.start() a later POST /pipelines will, so the two
    # are not different kinds of Pipeline.
    if config.cameras:
        await asyncio.gather(*(registry.start(camera) for camera in config.cameras))
    try:
        yield
    finally:
        await registry.stop_all()


api = FastAPI(title="Detecto alert stream", lifespan=lifespan)


@api.get("/health")
async def health() -> dict[str, Any]:
    def camera_health(pipeline: Pipeline) -> dict[str, Any]:
        running = pipeline.process is not None and pipeline.process.returncode is None
        return {
            "cameraId": pipeline.camera.camera_id,
            "sourceType": pipeline.camera.source_type,
            "inferenceRunning": running,
            # The honest state a status page or camera list should actually
            # render, not just infer from `inferenceRunning` -- 'stopped'
            # covers both "camera finished cleanly" and "server is shutting
            # down", which `inferenceRunning: false` alone cannot tell apart
            # from "this camera is broken" (see the Step 1 report -- this is
            # exactly the gap that caused). 'retrying' is the one that must
            # never be silently folded into either "running" or "stopped".
            "status": pipeline.status,
            "consecutiveFailures": pipeline.consecutive_failures,
            "lastExitCode": pipeline.last_exit_code,
            "nextRetryAt": (
                pipeline.next_retry_at.isoformat() if pipeline.next_retry_at else None
            ),
            "lastError": pipeline.last_error,
            "windowsSeen": pipeline.seen,
            "normalSkipped": pipeline.skipped,
            "mergedIntoIncidents": pipeline.merged,
            "alertsEmitted": pipeline.emitted,
            "alertsPersisted": pipeline.persisted,
            "persistFailures": pipeline.persist_failed,
        }

    cameras = [camera_health(pipeline) for pipeline in registry.snapshot()]
    total = lambda key: sum(camera[key] for camera in cameras)  # noqa: E731

    return {
        "ok": True,
        "clients": len(_clients),
        "cameras": cameras,
        # Aggregates across every configured camera, kept at the top level
        # for anything that only ever knew the single-camera shape -- with
        # one camera configured (today's default), these numbers are that
        # camera's own, unchanged from before this refactor.
        "inferenceRunning": any(camera["inferenceRunning"] for camera in cameras),
        "windowsSeen": total("windowsSeen"),
        "normalSkipped": total("normalSkipped"),
        "mergedIntoIncidents": total("mergedIntoIncidents"),
        "alertsEmitted": total("alertsEmitted"),
        "alertsPersisted": total("alertsPersisted"),
        "persistFailures": total("persistFailures"),
        "event": ALERT_EVENT,
        "tickEvent": TICK_EVENT,
        PIPELINE_STATUS_KEY: PIPELINE_STATUS,
    }


async def require_internal_key(
    x_internal_api_key: str | None = Header(default=None, alias="X-Internal-Api-Key"),
) -> None:
    """Same shared secret POST /api/alerts uses (`DETECTO_API_KEY`).

    These pipeline controls are an internal demo-mode surface, not a public
    API -- they still must not be wide open on the port. Timing-safe compare
    matches detecto-backend/api's requireInternalKey; a length mismatch is
    itself a miss, not padded into a comparison that would hide it.
    """
    expected = config.api_key
    if not isinstance(x_internal_api_key, str) or not expected:
        raise HTTPException(status_code=401, detail="unauthorized")
    given = x_internal_api_key.encode("utf-8")
    want = expected.encode("utf-8")
    if len(given) != len(want) or not hmac.compare_digest(given, want):
        raise HTTPException(status_code=401, detail="unauthorized")


@api.post("/pipelines", status_code=201, dependencies=[Depends(require_internal_key)])
async def create_pipeline(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    """Launch a Pipeline for one camera, after boot.

    Body is the same shape as one `DETECTO_CAMERAS` entry -- `id`, `name`,
    `zone`, `video`, `sourceType`, `realtime`, and the rest -- so a caller
    does not have to learn a second config language. Missing fields fall
    through `Config._camera_from_dict` to the same DETECTO_* defaults boot
    uses.
    """
    camera = config._camera_from_dict(body)
    try:
        pipeline = await registry.start(camera)
    except PipelineExistsError:
        raise HTTPException(status_code=409, detail="pipeline_exists")
    log.info("[%s] pipeline started on request", camera.camera_id)
    return {
        "ok": True,
        "cameraId": camera.camera_id,
        "status": pipeline.status,
    }


@api.delete("/pipelines/{camera_id}", dependencies=[Depends(require_internal_key)])
async def delete_pipeline(camera_id: str) -> dict[str, Any]:
    """Stop one Pipeline the same way process shutdown does, then drop it.

    After this returns, POST /pipelines of the same cameraId is a new
    Pipeline -- new IncidentGrouper, new counters -- not a resume of the
    one that just died.
    """
    stopped = await registry.stop(camera_id)
    if not stopped:
        raise HTTPException(status_code=404, detail="not_found")
    log.info("[%s] pipeline stopped on request", camera_id)
    return {"ok": True, "cameraId": camera_id}


asgi = socketio.ASGIApp(sio, other_asgi_app=api)


def main() -> int:
    log.info("listening on http://%s:%d (socket.io path /socket.io)", config.host, config.port)
    log.info("cors origins: %s", ", ".join(config.cors_origins) or "(none)")
    uvicorn.run(asgi, host=config.host, port=config.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
