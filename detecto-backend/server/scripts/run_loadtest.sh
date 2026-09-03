#!/usr/bin/env bash
# Load-test runner: launches the python alert server with the first N cameras
# from cams12.json, samples system resources, captures socket alerts, waits
# for the run to finish, tears the server down, and leaves artifacts in $OUT.
#
# Usage: run_loadtest.sh <N> <out_dir> [duration_seconds]
set -euo pipefail
cd "$(dirname "$0")/../.."   # detecto-backend/

N="$1"
OUT="$2"
DURATION="${3:-72}"
SAMPLE_DURATION=$((DURATION + 8))
mkdir -p "$OUT"

CAMS_FILE="${CAMS_FILE:-$SCRATCH/cams12.json}"
API_KEY="$(grep INTERNAL_API_KEY api/.env | cut -d= -f2)"

CAMERAS_JSON=$(.venv/Scripts/python.exe -c "
import json
d = json.load(open(r'$CAMS_FILE'))[:${N}]
print(json.dumps(d))
")

echo "[run_loadtest] N=$N -> $OUT"
echo "$CAMERAS_JSON" > "$OUT/cameras.json"

# alerts.id is now 32 random bits per alert (see translate.py's
# AlertIdSequence) rather than a per-process counter, so this is no longer
# working around a guaranteed collision -- it's just keeping the table from
# accumulating this test's own disposable rows across repeated runs. Leaves
# alone anything audit_log still references (TRUNCATE/DELETE-all would fail
# a FK over that).
PGPASSWORD=postgres psql -h localhost -U postgres -d detecto_dev -c \
  "DELETE FROM alerts WHERE id NOT IN (SELECT alert_id FROM audit_log WHERE alert_id IS NOT NULL);" >/dev/null

# Start resource sampler in background (75s covers the 55.7s video + startup slack)
powershell -NoProfile -File server/scripts/loadtest_sample.ps1 -DurationSeconds "$SAMPLE_DURATION" -IntervalSeconds 2 -OutCsv "$OUT/sample.csv" &
SAMPLER_PID=$!

# Start the python server
DETECTO_API_KEY="$API_KEY" \
DETECTO_CAMERAS="$CAMERAS_JSON" \
DETECTO_PORT=8000 \
.venv/Scripts/python.exe server/app.py > "$OUT/server.log" 2>&1 &
SERVER_PID=$!

sleep 4  # let uvicorn + subprocesses spin up before we start capturing

# Capture alerts for the run duration
.venv/Scripts/python.exe server/scripts/loadtest_capture.py --duration "$DURATION" --out "$OUT/alerts.json"

sleep 2
curl -s http://127.0.0.1:8000/health > "$OUT/health.json" || true

wait "$SAMPLER_PID" || true


# Kill the server's whole process tree (uvicorn + N live_infer.py children).
# $SERVER_PID from bash's `&` doesn't reliably match the real Windows PID
# under MSYS/git-bash, so find the actual PID bound to DETECTO_PORT instead
# and kill *that* tree -- never a blanket /IM python.exe, which would kill
# unrelated python processes elsewhere on the machine.
REAL_PID=$(netstat -ano | grep "127.0.0.1:8000" | grep LISTENING | awk '{print $NF}' | head -1)
if [ -n "$REAL_PID" ]; then
  taskkill //PID "$REAL_PID" //T //F >/dev/null 2>&1 || true
else
  taskkill //PID "$SERVER_PID" //T //F >/dev/null 2>&1 || true
fi
sleep 1

echo "[run_loadtest] done: $OUT"
