#!/usr/bin/env python3
"""Run the Detecto models over a video file and emit structured detection events.

This is a data-producing script, not a demo GUI. It reads a video sequentially
(simulating a live camera feed), classifies each sliding window with the R3D-18
violence classifier, and writes one JSON object per window to stdout as JSONL.

Design rules carried over from Detecto_Demo_Package/README.md:

  * The violence classifier uses FIXED 12-frame sampling per window. The frame
    count is deliberately independent of window duration so the model cannot
    exploit the SCVD clip-duration confound (clip length alone predicts class
    with 81.7% accuracy). Do not make the sample count depend on window length.

  * The weapon detector is INFORMATIONAL ONLY. It fires on ~81% of clips
    including most no-weapon Normal clips, and naive fusion (auto-upgrading
    Violence -> Weaponized on a detection) measurably hurt accuracy
    (80% -> 76%, Violence F1 0.65 -> 0.24). Weapon fields are therefore emitted
    as separate, explicitly unverified metadata and MUST NOT influence
    `classification` or `confidence`.

stdout carries only JSONL events. All diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import sys
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence

import cv2
import numpy as np
import torch
from torchvision.models.video import r3d_18

# --------------------------------------------------------------------------
# Model constants
# --------------------------------------------------------------------------

# Index -> label mapping for the classifier head.
#
# WARNING: the checkpoint is a bare state_dict and stores NO class mapping, so
# this order cannot be verified from the weights themselves. It follows the
# order documented in Detecto_Demo_Package/README.md ("Normal / Violence /
# Weaponized"), which is also the alphabetical directory order an
# ImageFolder-style loader produces for SCVD. If the training script used a
# different order, correct this list -- nothing else needs to change.
VIOLENCE_CLASSES: tuple[str, ...] = ("Normal", "Violence", "Weaponized")

# The class that is the absence of an alert. Named rather than indexed so the
# meaning survives if the order above is ever corrected.
NORMAL_CLASS = "Normal"

# Fixed temporal sample count. See module docstring -- this is a modelling
# decision, not a tuning knob.
NUM_SAMPLED_FRAMES = 12

# Kinetics-400 preprocessing for torchvision's r3d_18. The backbone was
# Kinetics-pretrained, so these are the statistics the features expect.
KINETICS_MEAN = (0.43216, 0.394666, 0.37645)
KINETICS_STD = (0.22803, 0.22145, 0.216989)
# Resize so the SHORTER side becomes 128, preserving aspect ratio, then
# centre-crop 112x112. Resizing to a fixed WxH instead would stretch anything
# that is not already ~4:3: a 576x1024 portrait clip came out stretched 2.37x
# horizontally, which is not a shape the model was trained on.
RESIZE_SHORT_SIDE = 128        # torchvision VideoClassification resize_size
CROP_SIZE = 112                # torchvision VideoClassification crop_size

WEAPON_NOTE = "unverified"


# --------------------------------------------------------------------------
# Model loading
# --------------------------------------------------------------------------

def _strip_prefix(state: dict[str, Any], prefix: str) -> dict[str, Any]:
    if all(k.startswith(prefix) for k in state):
        return {k[len(prefix):]: v for k, v in state.items()}
    return state


def load_violence_model(weights: Path, device: torch.device) -> torch.nn.Module:
    """Build r3d_18 with a 3-class head and load the fine-tuned weights."""
    checkpoint = torch.load(weights, map_location="cpu", weights_only=True)

    # The shipped file is a bare state_dict, but tolerate common wrappers.
    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model"):
            inner = checkpoint.get(key)
            if isinstance(inner, dict):
                checkpoint = inner
                break
    if not isinstance(checkpoint, dict):
        raise TypeError(f"{weights} did not contain a state_dict")

    state = _strip_prefix(dict(checkpoint), "module.")

    fc_weight = state.get("fc.weight")
    if fc_weight is None:
        raise KeyError(f"{weights} has no fc.weight -- unexpected checkpoint layout")
    num_classes = int(fc_weight.shape[0])
    if num_classes != len(VIOLENCE_CLASSES):
        raise ValueError(
            f"checkpoint head has {num_classes} classes but VIOLENCE_CLASSES "
            f"lists {len(VIOLENCE_CLASSES)}: {VIOLENCE_CLASSES}"
        )

    model = r3d_18(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, num_classes)
    model.load_state_dict(state, strict=True)
    model.eval().to(device)
    return model


def load_weapon_model(weights: Path, device: torch.device):
    """Load the YOLOv8 weapon detector. Import is lazy so ultralytics is only
    required when weapon detection is actually enabled."""
    # Ultralytics chatters on stdout and stdout must stay pure JSONL. The
    # import itself prints (it writes a settings banner on first ever run), so
    # the redirect has to cover the import, not just the calls.
    with contextlib.redirect_stdout(sys.stderr):
        from ultralytics import YOLO
        from ultralytics.utils import LOGGER

        LOGGER.setLevel("ERROR")
        model = YOLO(str(weights))
        model.to(device)
    return model


# --------------------------------------------------------------------------
# Preprocessing
# --------------------------------------------------------------------------

def sample_fixed_frames(window: Sequence[np.ndarray], count: int) -> list[np.ndarray]:
    """Pick `count` frames spread evenly across the window.

    Always returns exactly `count` frames regardless of how many raw frames the
    window holds -- this is what makes window duration uninformative to the
    classifier.
    """
    idx = np.linspace(0, len(window) - 1, count).round().astype(int)
    return [window[i] for i in idx]


def preprocess_window(
    window: Sequence[np.ndarray], device: torch.device
) -> torch.Tensor:
    """BGR frames -> normalized (1, C, T, H, W) tensor for r3d_18."""
    frames = sample_fixed_frames(window, NUM_SAMPLED_FRAMES)

    processed = []
    for frame in frames:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Aspect-preserving resize of the shorter side, then centre crop.
        height, width = rgb.shape[:2]
        scale = RESIZE_SHORT_SIDE / min(height, width)
        new_w = max(CROP_SIZE, round(width * scale))
        new_h = max(CROP_SIZE, round(height * scale))
        resized = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        top = (new_h - CROP_SIZE) // 2
        left = (new_w - CROP_SIZE) // 2
        cropped = resized[top:top + CROP_SIZE, left:left + CROP_SIZE]
        processed.append(cropped)

    clip = np.stack(processed).astype(np.float32) / 255.0      # (T, H, W, C)
    clip = (clip - np.array(KINETICS_MEAN, np.float32)) / np.array(KINETICS_STD, np.float32)
    clip = clip.transpose(3, 0, 1, 2)                          # (C, T, H, W)
    return torch.from_numpy(clip).unsqueeze(0).to(device)      # (1, C, T, H, W)


# --------------------------------------------------------------------------
# Inference
# --------------------------------------------------------------------------

@torch.inference_mode()
def classify_window(
    model: torch.nn.Module, window: Sequence[np.ndarray], device: torch.device
) -> tuple[str, float, list[float]]:
    logits = model(preprocess_window(window, device))
    probs = torch.softmax(logits, dim=1)[0].float().cpu().numpy()
    best = int(probs.argmax())
    return VIOLENCE_CLASSES[best], float(probs[best]), [float(p) for p in probs]


def encode_frame(frame: np.ndarray, max_px: int, quality: int) -> str | None:
    """One BGR frame -> a `data:` URL holding a JPEG, or None if encoding fails.

    Downscaled on the LONGEST side, not the width: the demo footage is 576x1024
    portrait, and capping width alone would leave a 1024px tall image and a
    payload several times bigger than intended.

    Only ever called for windows that are about to raise an alert. Encoding
    every Normal window would spend most of its work on frames nobody will see.
    """
    height, width = frame.shape[:2]
    scale = max_px / max(height, width)
    if scale < 1.0:
        # INTER_AREA is the right filter for shrinking; it averages rather than
        # sampling, so thin detail does not alias into noise.
        frame = cv2.resize(
            frame,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )

    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def detect_weapon(model, frame: np.ndarray, conf: float) -> dict[str, Any]:
    """Run the weapon detector on a single frame.

    Returns metadata only. The caller must not let any of this reach the
    `classification` / `confidence` fields.
    """
    with contextlib.redirect_stdout(sys.stderr):
        results = model.predict(frame, conf=conf, verbose=False)

    boxes = results[0].boxes
    if boxes is None or len(boxes) == 0:
        return {"detected": False, "confidence": None, "label": None, "count": 0}

    confidences = boxes.conf.cpu().numpy()
    best = int(confidences.argmax())
    label = results[0].names.get(int(boxes.cls[best].item()))
    return {
        "detected": True,
        "confidence": round(float(confidences[best]), 4),
        "label": label,
        "count": int(len(boxes)),
    }


# --------------------------------------------------------------------------
# Streaming
# --------------------------------------------------------------------------

def iter_frames(capture: cv2.VideoCapture) -> Iterator[np.ndarray]:
    while True:
        ok, frame = capture.read()
        if not ok:
            return
        yield frame


def build_event(
    *,
    timestamp: str | float,
    camera_id: str,
    classification: str,
    confidence: float,
    weapon: dict[str, Any],
    debug: dict[str, Any] | None,
    frame_image: str | None = None,
) -> dict[str, Any]:
    """Assemble the event.

    Note the separation: `classification`/`confidence` come only from the
    violence classifier; weapon fields sit alongside them and are marked
    unverified. Nothing here reads weapon state when deciding the class.
    """
    event: dict[str, Any] = {
        "timestamp": timestamp,
        "camera_id": camera_id,
        "classification": classification,
        "confidence": round(confidence, 4),
        "weapon_detected": weapon["detected"],
        "weapon_confidence": weapon["confidence"],
        "weapon_note": WEAPON_NOTE,
    }
    # Off by default and absent rather than null when off, so the documented
    # schema is unchanged for anyone who did not ask for a frame.
    if frame_image is not None:
        event["frame_image"] = frame_image
    if debug is not None:
        event["debug"] = debug
    return event


def run(args: argparse.Namespace) -> int:
    device = torch.device(
        args.device if args.device != "auto"
        else ("cuda" if torch.cuda.is_available() else "cpu")
    )
    log = lambda msg: print(msg, file=sys.stderr, flush=True)  # noqa: E731

    log(f"[init] device={device}")
    violence_model = load_violence_model(args.violence_model, device)
    log(f"[init] violence classifier loaded: {args.violence_model.name}")

    weapon_model = None
    if not args.no_weapon_detector:
        weapon_model = load_weapon_model(args.weapon_model, device)
        log(f"[init] weapon detector loaded: {args.weapon_model.name} (informational only)")

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        log(f"[error] could not open video: {args.video}")
        return 1

    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    if fps <= 0:
        fps = args.fallback_fps
        log(f"[warn] video reports no FPS; assuming {fps}")

    window_frames = max(NUM_SAMPLED_FRAMES, int(round(args.window_seconds * fps)))
    stride_frames = max(1, int(round(args.stride_seconds * fps)))
    log(
        f"[init] fps={fps:g} window={window_frames}f ({args.window_seconds}s) "
        f"stride={stride_frames}f ({args.stride_seconds}s) "
        f"sampled={NUM_SAMPLED_FRAMES}f/window realtime={not args.no_realtime}"
    )

    session_start = datetime.now(timezone.utc)
    buffer: deque[np.ndarray] = deque(maxlen=window_frames)
    next_emit_index = window_frames - 1
    emitted = 0
    stream_start = time.perf_counter()

    try:
        for index, frame in enumerate(iter_frames(capture)):
            # Pace to wall clock so timing behaviour matches a real feed.
            if not args.no_realtime:
                target = index / fps
                elapsed = time.perf_counter() - stream_start
                if elapsed < target:
                    time.sleep(target - elapsed)

            buffer.append(frame)
            if len(buffer) < window_frames or index < next_emit_index:
                continue

            window = list(buffer)
            began = time.perf_counter()

            # Sole driver of the alert.
            classification, confidence, probs = classify_window(
                violence_model, window, device
            )

            # Independent, informational. Middle frame is representative of the
            # window without biasing toward either boundary.
            if weapon_model is not None:
                weapon = detect_weapon(
                    weapon_model, window[len(window) // 2], args.weapon_conf
                )
            else:
                weapon = {"detected": False, "confidence": None, "label": None, "count": 0}

            # Evidence, captured only for windows that will actually raise an
            # alert. The LAST frame of the window, because `timestamp` below is
            # the window's end -- a middle frame would be a picture of a
            # different moment than the one the alert claims.
            frame_image = None
            if args.include_frame and classification != NORMAL_CLASS:
                frame_image = encode_frame(
                    window[-1], args.frame_max_px, args.frame_quality
                )

            window_end_s = (index + 1) / fps
            if args.timestamp_mode == "seconds":
                timestamp: str | float = round(window_end_s, 3)
            else:
                timestamp = (
                    session_start + timedelta(seconds=window_end_s)
                ).isoformat().replace("+00:00", "Z")

            debug = None
            if args.include_debug_fields:
                debug = {
                    "window_start_s": round((index + 1 - window_frames) / fps, 3),
                    "window_end_s": round(window_end_s, 3),
                    "frame_index": index,
                    "class_probabilities": dict(
                        zip(VIOLENCE_CLASSES, (round(p, 4) for p in probs))
                    ),
                    "weapon_label": weapon["label"],
                    "weapon_box_count": weapon["count"],
                    "inference_ms": round((time.perf_counter() - began) * 1000, 1),
                }

            print(
                json.dumps(
                    build_event(
                        timestamp=timestamp,
                        camera_id=args.camera_id,
                        classification=classification,
                        confidence=confidence,
                        weapon=weapon,
                        debug=debug,
                        frame_image=frame_image,
                    )
                ),
                flush=True,
            )

            emitted += 1
            if args.max_events and emitted >= args.max_events:
                log(f"[done] reached --max-events={args.max_events}")
                break

            next_emit_index = index + stride_frames
    except KeyboardInterrupt:
        log("[done] interrupted")
    finally:
        capture.release()

    log(f"[done] emitted {emitted} event(s)")
    return 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    here = Path(__file__).resolve().parent
    package = here.parent / "Detecto_Demo_Package"

    parser = argparse.ArgumentParser(
        description="Emit structured detection events (JSONL on stdout) for a video file.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--video", type=Path,
        default=package / "sample_outputs" / "demo_weaponized_clip.mp4",
        help="Input video file.",
    )
    parser.add_argument(
        "--violence-model", type=Path,
        default=package / "models" / "violence_classifier_r3d18.pt",
        help="R3D-18 violence classifier weights.",
    )
    parser.add_argument(
        "--weapon-model", type=Path,
        default=package / "models" / "weapon_detector_yolov8.pt",
        help="YOLOv8 weapon detector weights (informational overlay only).",
    )
    parser.add_argument("--camera-id", default="demo-camera-1", help="Camera identifier in events.")
    parser.add_argument("--window-seconds", type=float, default=2.0, help="Sliding window length.")
    parser.add_argument("--stride-seconds", type=float, default=0.5, help="Hop between windows.")
    parser.add_argument("--weapon-conf", type=float, default=0.25, help="Weapon detector confidence threshold.")
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"), help="Inference device.")
    parser.add_argument(
        "--timestamp-mode", default="iso8601", choices=("iso8601", "seconds"),
        help="ISO-8601 wall clock, or seconds elapsed from stream start.",
    )
    parser.add_argument("--max-events", type=int, default=0, help="Stop after N events (0 = no limit).")
    parser.add_argument("--fallback-fps", type=float, default=30.0, help="FPS to assume if the container reports none.")
    parser.add_argument(
        "--no-realtime", action="store_true",
        help="Disable wall-clock pacing and process as fast as possible.",
    )
    parser.add_argument(
        "--no-weapon-detector", action="store_true",
        help="Skip the weapon detector; weapon fields are emitted as false/null.",
    )
    parser.add_argument(
        "--include-debug-fields", action="store_true",
        help="Add a non-schema 'debug' object (window bounds, class probabilities, timings).",
    )
    parser.add_argument(
        "--include-frame", action="store_true",
        help=(
            "Add a non-schema 'frame_image' field (JPEG data URL) to alerting "
            "windows only. Never added to Normal windows."
        ),
    )
    parser.add_argument(
        "--frame-max-px", type=int, default=640,
        help="Longest side of the captured frame, in pixels, before encoding.",
    )
    parser.add_argument(
        "--frame-quality", type=int, default=75,
        help="JPEG quality for the captured frame (1-100).",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    for path in (args.video, args.violence_model):
        if not path.exists():
            print(f"[error] missing file: {path}", file=sys.stderr)
            return 1
    if not args.no_weapon_detector and not args.weapon_model.exists():
        print(f"[error] missing file: {args.weapon_model}", file=sys.stderr)
        return 1
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
