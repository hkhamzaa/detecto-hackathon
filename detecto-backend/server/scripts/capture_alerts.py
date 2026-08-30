#!/usr/bin/env python3
"""Connect to the alert server as a real Socket.IO client and print what arrives.

This is the honest way to check the server: it reads what actually crosses the
wire, not what the server says it sent. Same protocol the frontend's
socket.io-client speaks.

    python server/scripts/capture_alerts.py --count 5

Prints one JSON object per received alert to stdout, then exits.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import socketio


async def capture(url: str, event: str, count: int, timeout: float) -> int:
    client = socketio.AsyncClient()
    received: list[dict] = []
    done = asyncio.Event()

    @client.on(event)
    async def _(alert: dict) -> None:
        received.append(alert)
        print(json.dumps(alert, indent=2), flush=True)
        if len(received) >= count:
            done.set()

    await client.connect(url)
    print(f"[connected] {url} listening for {count}x '{event}'", file=sys.stderr)

    try:
        await asyncio.wait_for(done.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        print(
            f"[timeout] {len(received)}/{count} after {timeout}s",
            file=sys.stderr,
        )
    finally:
        await client.disconnect()

    return 0 if len(received) >= count else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--event", default="alert:new")
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=600.0)
    args = parser.parse_args()
    return asyncio.run(capture(args.url, args.event, args.count, args.timeout))


if __name__ == "__main__":
    raise SystemExit(main())
