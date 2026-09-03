#!/usr/bin/env python3
"""Load-test instrument: connects as a Socket.IO client, records wall-clock
receipt time for every alert, and on exit queries Postgres directly for each
alert's `created_at` to compute detection -> DB and detection -> socket
latency. Load-test-only, not part of the shipped server.

Usage:
    python server/scripts/loadtest_capture.py --duration 75 --out run.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import socketio


def parse_iso(ts: str) -> float:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()


async def capture(url: str, event: str, duration: float) -> list[dict]:
    client = socketio.AsyncClient()
    received: list[dict] = []

    @client.on(event)
    async def _(alert: dict) -> None:
        received.append({"alert": alert, "recv_wall": time.time()})

    await client.connect(url)
    print(f"[connected] {url}", file=sys.stderr)
    await asyncio.sleep(duration)
    await client.disconnect()
    return received


def psql_created_at(camera_id: str, detected_at_iso: str) -> str | None:
    # alerts.id is now 32 random bits per alert (see translate.py's
    # AlertIdSequence), so matching on id alone would be fine today -- this
    # still matches on camera_id + detected_at instead so results captured
    # against an older server build (the zero-padded per-process counter
    # this replaced, which really could collide with an unrelated row from a
    # totally different run) stay correct too.
    result = subprocess.run(
        ["psql", "-h", "localhost", "-U", "postgres", "-d", "detecto_dev", "-t", "-A",
         "-c", f"SELECT created_at FROM alerts WHERE camera_id = '{camera_id}' "
               f"AND detected_at = '{detected_at_iso}';"],
        env={**os.environ, "PGPASSWORD": "postgres"},
        capture_output=True, text=True,
    )
    out = result.stdout.strip().splitlines()[0].strip() if result.stdout.strip() else ""
    return out or None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--event", default="alert:new")
    parser.add_argument("--duration", type=float, default=75.0)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    received = asyncio.run(capture(args.url, args.event, args.duration))

    rows = []
    for item in received:
        alert = item["alert"]
        detected_at = parse_iso(alert["detectedAt"])
        socket_latency = item["recv_wall"] - detected_at
        db_created_at_str = psql_created_at(alert["cameraId"], alert["detectedAt"])
        db_latency = None
        db_latency_since_socket = None
        if db_created_at_str:
            db_created_at = parse_iso(db_created_at_str.replace(" ", "T"))
            db_latency = db_created_at - detected_at
            # Isolates the DB write itself (HTTP POST + INSERT) from the
            # inference backlog baked into detectedAt vs. wall clock -- see
            # the Step 1 report on why detectedAt alone conflates the two.
            db_latency_since_socket = db_created_at - item["recv_wall"]
        rows.append({
            "id": alert["id"],
            "cameraId": alert["cameraId"],
            "detectedAt": alert["detectedAt"],
            "socket_latency_s": round(socket_latency, 3),
            "db_latency_s": round(db_latency, 3) if db_latency is not None else None,
            "db_latency_since_socket_s": (
                round(db_latency_since_socket, 3) if db_latency_since_socket is not None else None
            ),
            "persisted": db_created_at_str is not None,
        })

    with open(args.out, "w") as f:
        json.dump(rows, f, indent=2)

    print(f"[done] {len(rows)} alerts captured, written to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
