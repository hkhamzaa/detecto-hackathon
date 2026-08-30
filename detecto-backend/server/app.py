#!/usr/bin/env python3
"""Socket.IO server that turns Phase 1's JSONL stream into frontend alerts.

Thin by design. It owns three jobs and nothing else:

  1. Run `inference/live_infer.py` as a subprocess and read its JSONL stdout.
  2. Drop every `Normal` window; translate the rest into the frontend's `Alert`
     shape (see `translate.py` -- the shape is copied from the frontend, not
     designed here).
  3. Emit each one on `alert:new` and log what went out.

No authentication, no persistence, no multi-camera fan-out. One hardcoded feed,
matching Phase 1. Alerts exist only in flight: a client that connects late has
missed whatever came before it.

The inference script is run as a subprocess rather than imported because it is
a CLI that owns its own capture loop and pacing, and because a crash in a model
forward pass then takes down a process we can see exit rather than the server.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import socketio
import uvicorn
from fastapi import FastAPI

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

# The event name the frontend listens on. Namespaced so a second stream (say
# `camera:status`) can be added later without renaming this one.
ALERT_EVENT = "alert:new"


def _env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in ("0", "false", "no", "off", "")


class Config:
    """Everything tunable, read once at startup."""

    def __init__(self) -> None:
        self.video = Path(os.environ.get("DETECTO_VIDEO", str(DEFAULT_VIDEO)))
        self.python = os.environ.get("DETECTO_PYTHON", sys.executable)

        # Single hardcoded camera. Phase 1 stamps the id into every event; the
        # name and zone have nowhere to come from on that side, so they are set
        # here. The id is passed through to the script so both sides agree.
        self.camera_id = os.environ.get("DETECTO_CAMERA_ID", "demo-camera-1")
        self.camera_name = os.environ.get("DETECTO_CAMERA_NAME", "Demo camera 1")
        self.zone = os.environ.get("DETECTO_ZONE", "Demo feed")

        # What `Alert.model` reports: "the model build that raised it, so a bad
        # release can be traced".
        self.model = os.environ.get("DETECTO_MODEL", "r3d18-scvd 0.1")

        self.host = os.environ.get("DETECTO_HOST", "127.0.0.1")
        self.port = int(os.environ.get("DETECTO_PORT", "8000"))
        self.cors_origins = [
            origin.strip()
            for origin in os.environ.get(
                "DETECTO_CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        ]

        # Realtime pacing on by default: a wall-clock-paced stream is what a
        # real feed looks like. Turn it off to chew through a file fast.
        self.realtime = _env_flag("DETECTO_REALTIME", True)
        self.weapon_detector = _env_flag("DETECTO_WEAPON_DETECTOR", True)

        # On by default here, unlike in the script: an alert on screen wants a
        # picture of what was seen. Only alerting windows are ever captured.
        self.frame_image = _env_flag("DETECTO_FRAME_IMAGE", True)
        self.frame_max_px = int(os.environ.get("DETECTO_FRAME_MAX_PX", "640"))
        self.frame_quality = int(os.environ.get("DETECTO_FRAME_QUALITY", "75"))
        self.max_events = int(os.environ.get("DETECTO_MAX_EVENTS", "0"))
        self.log_level = os.environ.get("DETECTO_LOG_LEVEL", "INFO").upper()

    def infer_command(self) -> list[str]:
        command = [
            self.python,
            str(INFER_SCRIPT),
            "--video", str(self.video),
            "--camera-id", self.camera_id,
            # ISO-8601 is what `Alert.detectedAt` is: an instant, not an offset.
            "--timestamp-mode", "iso8601",
        ]
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


# --------------------------------------------------------------------------
# The pipeline
# --------------------------------------------------------------------------

class Pipeline:
    """Owns the inference subprocess and the two tasks draining its pipes."""

    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.tasks: list[asyncio.Task[None]] = []
        self.ids = AlertIdSequence()
        self.incidents = IncidentGrouper()
        self.seen = 0
        self.skipped = 0
        self.merged = 0
        self.emitted = 0

    def _tally(self) -> str:
        return (
            f"{self.seen} window(s) seen, {self.skipped} Normal skipped, "
            f"{self.merged} merged into open incidents, "
            f"{self.emitted} alert(s) emitted"
        )

    async def start(self) -> None:
        command = config.infer_command()
        log.info("starting inference: %s", " ".join(command))
        log.info(
            "camera=%s (%s / %s) model=%s realtime=%s",
            config.camera_id, config.camera_name, config.zone,
            config.model, config.realtime,
        )

        self.process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(BACKEND),
        )
        self.tasks = [
            asyncio.create_task(self._read_events(), name="infer-stdout"),
            asyncio.create_task(self._read_diagnostics(), name="infer-stderr"),
        ]

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        log.info("stopped: %s", self._tally())

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
            await self._handle(event)

        code = await self.process.wait() if self.process else None
        log.info("inference finished (exit=%s): %s", code, self._tally())

    async def _read_diagnostics(self) -> None:
        """stderr is the script's own logging. Surfaced, never parsed."""
        assert self.process and self.process.stderr
        async for raw in self.process.stderr:
            message = raw.decode("utf-8", "replace").rstrip()
            if message:
                infer_log.info("%s", message)

    async def _handle(self, event: dict[str, Any]) -> None:
        self.seen += 1

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
            camera_name=config.camera_name,
            zone=config.zone,
            model=config.model,
        )
        await sio.emit(ALERT_EVENT, alert)
        self.emitted += 1

        # The frame is tens of kilobytes of base64 and would bury every other
        # line, so the log carries its size instead of its contents.
        loggable = dict(alert)
        frame = loggable.pop("frameImage", None)
        if frame is not None:
            loggable["frameImage"] = f"<{len(frame) // 1024}KB jpeg data url>"

        log.info(
            "%s -> %d client(s) | %s",
            ALERT_EVENT, len(_clients), json.dumps(loggable, separators=(",", ":")),
        )


pipeline = Pipeline()


# --------------------------------------------------------------------------
# ASGI app
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI):
    for path in (INFER_SCRIPT, config.video):
        if not path.exists():
            raise SystemExit(f"[error] missing file: {path}")
    await pipeline.start()
    try:
        yield
    finally:
        await pipeline.stop()


api = FastAPI(title="Detecto alert stream", lifespan=lifespan)


@api.get("/health")
async def health() -> dict[str, Any]:
    running = pipeline.process is not None and pipeline.process.returncode is None
    return {
        "ok": True,
        "inferenceRunning": running,
        "clients": len(_clients),
        "windowsSeen": pipeline.seen,
        "normalSkipped": pipeline.skipped,
        "mergedIntoIncidents": pipeline.merged,
        "alertsEmitted": pipeline.emitted,
        "event": ALERT_EVENT,
        PIPELINE_STATUS_KEY: PIPELINE_STATUS,
    }


asgi = socketio.ASGIApp(sio, other_asgi_app=api)


def main() -> int:
    log.info("listening on http://%s:%d (socket.io path /socket.io)", config.host, config.port)
    log.info("cors origins: %s", ", ".join(config.cors_origins) or "(none)")
    uvicorn.run(asgi, host=config.host, port=config.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
