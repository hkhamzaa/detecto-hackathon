# Detecto — inference

Standalone script that runs the trained models against a video file and emits
structured detection events as JSONL on stdout. No server, no socket, no GUI —
its only job is to turn video into events that something else can consume later.

## Setup

From the repo root:

```bash
cd detecto-backend

python -m venv .venv
source .venv/Scripts/activate      # Windows (Git Bash)
# .venv\Scripts\activate           # Windows (PowerShell)
# source .venv/bin/activate        # macOS / Linux

pip install --index-url https://download.pytorch.org/whl/cpu \
    torch==2.13.0 torchvision==0.28.0
pip install -r inference/requirements.txt
```

The first command installs CPU-only PyTorch, which is what everything here was
verified against. For a CUDA box, install the matching CUDA build from
<https://pytorch.org/get-started/locally/> instead and leave the rest unchanged.

Verified on Windows 11 / Python 3.13.7 / CPU with torch 2.13.0+cpu,
torchvision 0.28.0+cpu, opencv-python 5.0.0.93, ultralytics 8.4.135.

## Run

Defaults point at the bundled demo clip and both model files, so:

```bash
python inference/live_infer.py
```

Useful flags:

```bash
# Process as fast as possible instead of pacing to wall clock
python inference/live_infer.py --no-realtime

# Elapsed seconds instead of ISO-8601 timestamps
python inference/live_infer.py --timestamp-mode seconds

# Add window bounds, per-class probabilities and timings under a "debug" key
python inference/live_infer.py --include-debug-fields

# Different feed / camera identity
python inference/live_infer.py --video path/to/clip.mp4 --camera-id lobby-cam-3

# Violence classifier only
python inference/live_infer.py --no-weapon-detector
```

`--window-seconds` (default 2.0) and `--stride-seconds` (default 0.5) control
the sliding window. `python inference/live_infer.py --help` lists everything.

stdout is **only** JSONL — one event per line. All logging goes to stderr, so
piping is safe:

```bash
python inference/live_infer.py --no-realtime > events.jsonl
```

## Event schema

One object per window:

```json
{
  "timestamp": "2026-08-30T02:41:07.533Z",
  "camera_id": "demo-camera-1",
  "classification": "Normal",
  "confidence": 0.8123,
  "weapon_detected": true,
  "weapon_confidence": 0.4471,
  "weapon_note": "unverified"
}
```

| Field | Meaning |
| --- | --- |
| `timestamp` | ISO-8601 UTC at window end, or seconds elapsed with `--timestamp-mode seconds` |
| `camera_id` | Feed identifier, set via `--camera-id` |
| `classification` | `Normal` \| `Violence` \| `Weaponized` — from the violence classifier alone |
| `confidence` | Softmax probability of the reported class |
| `weapon_detected` | Whether the weapon detector fired on the window's middle frame |
| `weapon_confidence` | Highest-confidence weapon box, or `null` when nothing fired |
| `weapon_note` | Always `"unverified"` |

`--include-debug-fields` adds a `debug` object alongside these. It is off by
default so the emitted schema stays exactly as specified.

## Two constraints that are deliberate

**Fixed 12-frame sampling.** Every window is sampled down to exactly 12 frames,
spread evenly, regardless of how long the window is. SCVD clip duration alone
predicts class with 81.7% accuracy (Normal ~4s, Weaponized ~7s, Violence ~9s+),
so a variable frame count would let the model read duration instead of content.
Changing `--window-seconds` changes how much footage a window covers, never how
many frames the model sees. `NUM_SAMPLED_FRAMES` is a modelling decision, not a
tuning knob.

**The weapon detector never touches the alert.** It is metadata only.
`classification` and `confidence` come from the violence classifier and nothing
else. This is not an oversight to fix later: the detector fires on ~81% of
clips including most no-weapon Normal clips at similar confidence to true
positives, and naive fusion (auto-upgrading Violence → Weaponized on a
detection) dropped accuracy 80% → 76% and Violence-class F1 0.65 → 0.24. Every
weapon field is labelled `unverified` for the same reason.

## Assumptions worth verifying

The violence checkpoint is a bare `state_dict` — it stores no class mapping and
no preprocessing metadata, so two things had to be inferred and are worth
confirming against the original training script:

1. **Class order** — `("Normal", "Violence", "Weaponized")`, taken from the
   package README and matching the alphabetical directory order an
   ImageFolder-style loader produces. If training used a different order, every
   label is permuted. Fix `VIOLENCE_CLASSES` in `live_infer.py`; nothing else
   needs to change.

2. **Preprocessing** — standard torchvision Kinetics-400 video transform
   (resize to 128×171, centre-crop 112, Kinetics mean/std), on the basis that
   the backbone is Kinetics-pretrained. If fine-tuning resized straight to
   112×112 or used ImageNet statistics, confidences will be off. The constants
   sit at the top of `live_infer.py`.

Also note the bundled `demo_weaponized_clip.mp4` is a **rendered demo output**,
not raw footage — it already has an alert banner and detection boxes burned
into the frames. It is fine as a smoke test, but numbers from it are not
representative. Point `--video` at clean footage for anything meaningful.
