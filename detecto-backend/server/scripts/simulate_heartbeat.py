#!/usr/bin/env python3
"""Stand in for a real Detecto Box's heartbeat and camera reports, since no
real box exists yet.

Sends `POST /api/boxes/<id>/heartbeat` on a fixed interval, forever, until
interrupted (Ctrl+C) or `--count` is reached. Each call is exactly what a
real box's firmware would eventually do -- authenticated as THAT SPECIFIC
BOX, with the credential `POST /api/boxes/pair` issues at pairing time (its
`boxSecret` field), sent as `X-Box-Secret`. This used to be the shared
`X-Internal-Api-Key` -- see boxes.js's own note on why that was a flagged
placeholder; this script now exercises the real thing, not a stand-in for it.

Also reports the box's camera list on every cycle (`POST
/api/boxes/<id>/cameras`, same auth), same as a real box's firmware would
alongside its own heartbeat -- unless `--no-cameras` is given. Two fake
cameras are reported by default so the script demos camera auto-registration
with zero extra flags; `--camera` (repeatable) overrides that.

    python server/scripts/simulate_heartbeat.py \\
        --box-id <uuid POST /api/boxes/pair returned> \\
        --box-secret <boxSecret POST /api/boxes/pair returned>

    python server/scripts/simulate_heartbeat.py --box-id ... --box-secret ... \\
        --camera "rtsp://10.0.0.5:554/ch1=Front door" \\
        --camera "rtsp://10.0.0.5:554/ch2=Back dock"

Stdlib only (urllib) -- this is a standalone demo/test tool, not part of the
running pipeline, so it deliberately doesn't need aiohttp or any other
project dependency installed to be useful on its own.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


def post_json(url: str, box_secret: str, body: dict, timeout: float) -> tuple[int, str]:
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        method="POST",
        data=payload,
        headers={
            "X-Box-Secret": box_secret,
            "Content-Type": "application/json",
            "Content-Length": str(len(payload)),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def send_heartbeat(url: str, box_id: str, box_secret: str, timeout: float) -> tuple[int, str]:
    request = urllib.request.Request(
        f"{url}/api/boxes/{box_id}/heartbeat",
        method="POST",
        headers={"X-Box-Secret": box_secret, "Content-Length": "0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def send_camera_report(
    url: str, box_id: str, box_secret: str, cameras: list[dict], timeout: float
) -> tuple[int, str]:
    return post_json(
        f"{url}/api/boxes/{box_id}/cameras", box_secret, {"cameras": cameras}, timeout
    )


def default_cameras(box_id: str) -> list[dict]:
    """Two plausible-looking fake channels off the box's own id, so a
    fresh run is immediately reproducible without hand-picking URIs, and a
    second run against the same box always reports the same `sourceUri`s
    -- exercising the update-not-duplicate path, not just creation."""
    return [
        {"sourceUri": f"rtsp://box-{box_id}.local:554/ch1", "label": "Channel 1"},
        {"sourceUri": f"rtsp://box-{box_id}.local:554/ch2", "label": "Channel 2"},
    ]


def parse_camera_arg(raw: str) -> dict:
    source_uri, _, label = raw.partition("=")
    camera = {"sourceUri": source_uri}
    if label:
        camera["label"] = label
    return camera


def run(args: argparse.Namespace) -> int:
    sent = 0
    log = lambda msg: print(msg, file=sys.stderr, flush=True)  # noqa: E731

    cameras = args.cameras if args.report_cameras else []
    log(
        f"[start] heartbeating box={args.box_id} to {args.url} "
        f"every {args.interval}s (Ctrl+C to stop)"
    )
    if cameras:
        log(f"[start] reporting {len(cameras)} camera(s) each cycle: "
            + ", ".join(c["sourceUri"] for c in cameras))

    try:
        while args.count == 0 or sent < args.count:
            status, body = send_heartbeat(args.url, args.box_id, args.box_secret, args.timeout)
            sent += 1
            if status == 200:
                try:
                    at = json.loads(body).get("lastHeartbeatAt")
                except json.JSONDecodeError:
                    at = None
                log(f"[{sent}] heartbeat ok lastHeartbeatAt={at}")
            elif status == 0:
                log(f"[{sent}] heartbeat request failed: {body}")
            else:
                log(f"[{sent}] heartbeat HTTP {status}: {body[:200]}")

            if cameras:
                cstatus, cbody = send_camera_report(
                    args.url, args.box_id, args.box_secret, cameras, args.timeout
                )
                if cstatus == 200:
                    try:
                        reported = json.loads(cbody).get("cameras", [])
                    except json.JSONDecodeError:
                        reported = []
                    summary = ", ".join(
                        f"{c['name']} ({c['reviewStatus']})" for c in reported
                    )
                    log(f"[{sent}] cameras ok: {summary}")
                elif cstatus == 0:
                    log(f"[{sent}] cameras request failed: {cbody}")
                else:
                    log(f"[{sent}] cameras HTTP {cstatus}: {cbody[:200]}")

            if args.count and sent >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        log("[stopped] interrupted")

    log(f"[done] sent {sent} heartbeat(s)")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument("--box-id", required=True, help="uuid POST /api/boxes/pair returned.")
    parser.add_argument("--url", default="http://127.0.0.1:4000", help="Node API base URL.")
    parser.add_argument(
        "--box-secret", default=None,
        help=(
            "This box's own credential -- the `boxSecret` POST /api/boxes/pair "
            "(or the reissue endpoint) returned for THIS box id. Falls back to "
            "$DETECTO_BOX_SECRET. Not the same value as INTERNAL_API_KEY/"
            "DETECTO_API_KEY -- see the module docstring."
        ),
    )
    parser.add_argument("--interval", type=float, default=60.0, help="Seconds between heartbeats.")
    parser.add_argument(
        "--count", type=int, default=0,
        help="Stop after N heartbeats (0 = run until interrupted).",
    )
    parser.add_argument("--timeout", type=float, default=5.0, help="HTTP request timeout, seconds.")
    parser.add_argument(
        "--camera", dest="camera_args", action="append", default=[],
        metavar="SOURCE_URI[=LABEL]",
        help=(
            "A camera this box reports, repeatable. Omit entirely to report "
            "two default fake channels; pass --no-cameras to report none."
        ),
    )
    parser.add_argument(
        "--no-cameras", dest="report_cameras", action="store_false",
        help="Don't call POST /:id/cameras at all -- heartbeat only, like prompt #3's original script.",
    )
    parser.set_defaults(report_cameras=True)
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    if not args.box_secret:
        args.box_secret = os.environ.get("DETECTO_BOX_SECRET")
    if not args.box_secret:
        print(
            "[error] --box-secret not given and $DETECTO_BOX_SECRET not set. "
            "This is the boxSecret POST /api/boxes/pair returned for --box-id, "
            "not INTERNAL_API_KEY/DETECTO_API_KEY.",
            file=sys.stderr,
        )
        return 1
    args.cameras = (
        [parse_camera_arg(raw) for raw in args.camera_args]
        if args.camera_args
        else default_cameras(args.box_id)
    )
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
