#!/usr/bin/env python3
"""Grab one live alert off the socket and write its captured frame to disk.

    python server/scripts/capture_frame.py --out frame.jpg

Prints the alert with the image field elided, then decodes the data URL and
saves the JPEG so it can actually be looked at.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
from pathlib import Path

import socketio

PREFIX = "data:image/jpeg;base64,"


async def capture(url: str, event: str, out: Path, timeout: float) -> int:
    client = socketio.AsyncClient()
    done = asyncio.Event()
    result: dict = {}

    @client.on(event)
    async def _(alert: dict) -> None:
        if result:
            return
        result.update(alert)
        done.set()

    await client.connect(url)
    print(f"[connected] {url}", file=sys.stderr)
    try:
        await asyncio.wait_for(done.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        print("[timeout] no alert", file=sys.stderr)
        return 1
    finally:
        await client.disconnect()

    image = result.pop("frameImage", None)
    print(json.dumps(result, indent=2))

    if not image:
        print("NO frameImage ON PAYLOAD", file=sys.stderr)
        return 1
    if not image.startswith(PREFIX):
        print(f"unexpected prefix: {image[:40]!r}", file=sys.stderr)
        return 1

    raw = base64.b64decode(image[len(PREFIX):])
    out.write_bytes(raw)
    print(f"\nframeImage: {len(image) / 1024:.1f} KB data url -> {len(raw) / 1024:.1f} KB jpeg")
    print(f"written to {out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--event", default="alert:new")
    parser.add_argument("--out", type=Path, default=Path("frame.jpg"))
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args()
    return asyncio.run(capture(args.url, args.event, args.out, args.timeout))


if __name__ == "__main__":
    raise SystemExit(main())
