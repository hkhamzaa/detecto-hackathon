#!/usr/bin/env python3
"""Create/reuse N load-test camera rows and print a DETECTO_CAMERAS JSON blob.

Load-test-only. Inserts directly with psycopg-free plain SQL via `psql` is
awkward from Python without a driver, so this shells out to `node` isn't
available either -- instead this uses the `pg` driver indirectly by calling
a tiny inline node script would add a dependency. Simplest: use psql via
subprocess, since psql is already confirmed on PATH.

Usage:
    python server/scripts/seed_load_test_cameras.py --count 10
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

ORG_NAME = "Northgate Logistics"
VIDEO = "Detecto_Demo_Package/sample_outputs/test_video.mp4"


def psql(sql: str) -> str:
    result = subprocess.run(
        ["psql", "-h", "localhost", "-U", "postgres", "-d", "detecto_dev", "-t", "-A", "-c", sql],
        env={**os.environ, "PGPASSWORD": "postgres"},
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip().splitlines()[0].strip() if result.stdout.strip() else ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, required=True)
    args = parser.parse_args()

    org_id = psql(f"SELECT id FROM organizations WHERE name = '{ORG_NAME}' LIMIT 1;")
    if not org_id:
        print("[error] seed org not found -- run `npm run seed` in db/ first", file=sys.stderr)
        return 1

    cameras = []
    for i in range(1, args.count + 1):
        name = f"Load Test Camera {i}"
        zone = f"Load Test Zone {i}"
        existing = psql(f"SELECT id FROM cameras WHERE org_id = '{org_id}' AND name = '{name}';")
        if existing:
            cam_id = existing
        else:
            cam_id = psql(
                f"INSERT INTO cameras (org_id, name, zone, online, source_type, source_uri) "
                f"VALUES ('{org_id}', '{name}', '{zone}', false, 'file', '{VIDEO}') RETURNING id;"
            )
        cameras.append({
            "id": cam_id,
            "name": name,
            "zone": zone,
            "video": VIDEO,
            "model": "r3d18-scvd 0.1",
        })

    print(json.dumps(cameras), file=sys.stderr)  # human-visible on stderr
    print(json.dumps(cameras))  # machine-parseable on stdout
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
