#!/usr/bin/env python3
"""Run the Detecto models over a video file and emit structured detection events.

This is a data-producing script, not a demo GUI. It reads a video sequentially
(simulating a live camera feed), classifies each sliding window with the
locked-in multi-head R3D-18 (`detecto-hackathon-final`), and writes one JSON
object per window to stdout as JSONL.

The classifier is two independent sigmoid heads on a shared R3D-18 backbone —
a violence score and a weapon score, each in [0, 1], with no 3-class softmax
and no hard-rule fusion. A YOLOv8 weapon *localizer* still runs as visual
metadata only and MUST NOT influence either score.

Design rules:

    * Overlay / live path for the locked-in multi-head model uses 12
      *consecutive* frames (stride 4) — the Colab live recipe. A 2.0s
      linspace window mixes later incident frames into an empty hallway
      and the overlay then prints that clip's score on the wrong picture.
      Spatial sample count is still exactly 12; never pad a short buffer.
      The old 3-class path still linspace-samples a 2.0s window.

    * Spatial preprocessing MUST match training: short side to 128, centre-crop
      112x112, Kinetics-400 mean/std. Stretching to a fixed WxH is the
      aspect-ratio bug this project already paid for once.

    * The YOLO localizer is INFORMATIONAL ONLY. Hard-rule fusion of a box
      detector into the class decision measurably hurt accuracy; the two
      classifier heads are independent for the same reason.

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
from typing import Any, Iterator, NamedTuple, Sequence

import cv2
import numpy as np
import torch
import torch.nn as nn
from torchvision.models.video import r3d_18

# --------------------------------------------------------------------------
# Model constants
# --------------------------------------------------------------------------

# Labels the existing alert pipeline still understands. They are NOT a softmax
# class order: the locked-in model has two independent binary heads, and these
# strings are derived from those scores (see `heads_to_classification`).
VIOLENCE_CLASSES: tuple[str, ...] = ("Normal", "Violence", "Weaponized")

# The class that is the absence of an alert. Named rather than indexed so the
# meaning survives if the order above is ever corrected.
NORMAL_CLASS = "Normal"

# Colab / training threshold on each independent sigmoid head.
HEAD_THRESHOLD = 0.5

# Fixed temporal sample count. See module docstring -- this is a modelling
# decision, not a tuning knob.
NUM_SAMPLED_FRAMES = 12
# Live overlay for the multi-head checkpoint: 12 consecutive frames, hop 4.
# ~0.4s at 30fps — local to the picture on screen, not a 2s mash-up.
MULTIHEAD_STRIDE_FRAMES = 4

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

class MultiHeadR3D18(nn.Module):
    """Shared R3D-18 backbone, two independent 1-logit heads.

    Matches Detecto_Hackathon_Final exactly: Linear(512, 128) -> ReLU ->
    Dropout(0.3) -> Linear(128, 1) per head. Forward returns
    (violence_logit, weapon_logit), each squeezed to shape (B,). Apply
    sigmoid for probabilities; do not softmax across heads.
    """

    def __init__(self) -> None:
        super().__init__()
        backbone = r3d_18(weights=None)
        backbone.fc = nn.Identity()
        self.backbone = backbone
        self.violence_head = nn.Sequential(
            nn.Linear(512, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, 1)
        )
        self.weapon_head = nn.Sequential(
            nn.Linear(512, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, 1)
        )

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.backbone(x)
        return (
            self.violence_head(features).squeeze(-1),
            self.weapon_head(features).squeeze(-1),
        )


def _strip_prefix(state: dict[str, Any], prefix: str) -> dict[str, Any]:
    if all(k.startswith(prefix) for k in state):
        return {k[len(prefix):]: v for k, v in state.items()}
    return state


def _unwrap_state(checkpoint: Any, weights: Path) -> dict[str, Any]:
    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model"):
            inner = checkpoint.get(key)
            if isinstance(inner, dict):
                checkpoint = inner
                break
    if not isinstance(checkpoint, dict):
        raise TypeError(f"{weights} did not contain a state_dict")
    return _strip_prefix(dict(checkpoint), "module.")


def load_multihead_model(weights: Path, device: torch.device) -> MultiHeadR3D18:
    """Load detecto-hackathon-final (two independent sigmoid heads)."""
    checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
    state = _unwrap_state(checkpoint, weights)

    if "violence_head.0.weight" not in state or "weapon_head.0.weight" not in state:
        raise KeyError(
            f"{weights} is not a multi-head checkpoint (missing violence_head / "
            "weapon_head). The old 3-class r3d18 lives in Detecto_Demo_Package."
        )
    v_out = state["violence_head.3.weight"]
    w_out = state["weapon_head.3.weight"]
    if tuple(v_out.shape) != (1, 128) or tuple(w_out.shape) != (1, 128):
        raise ValueError(
            f"{weights} head output shapes are violence={tuple(v_out.shape)} "
            f"weapon={tuple(w_out.shape)}; expected (1, 128) each (one logit "
            "per head, sigmoid — not a 3-class softmax)."
        )

    model = MultiHeadR3D18()
    model.load_state_dict(state, strict=True)
    model.eval().to(device)
    return model


def load_violence_model(weights: Path, device: torch.device) -> torch.nn.Module:
    """Build r3d_18 with a 3-class head and load the previous fine-tuned weights.

    Kept so pointing `--violence-model` at the old Detecto_Demo_Package
    checkpoint still works. Default load path is the multi-head model.
    """
    checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
    state = _unwrap_state(checkpoint, weights)

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


def load_classifier(weights: Path, device: torch.device) -> torch.nn.Module:
    """Pick the architecture from the checkpoint keys, not from the filename."""
    checkpoint = torch.load(weights, map_location="cpu", weights_only=True)
    state = _unwrap_state(checkpoint, weights)
    if "violence_head.0.weight" in state:
        model = MultiHeadR3D18()
        model.load_state_dict(state, strict=True)
        return model.eval().to(device)
    return load_violence_model(weights, device)


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
    window: Sequence[np.ndarray],
    device: torch.device,
    *,
    consecutive: bool = False,
) -> torch.Tensor:
    """BGR frames -> normalized (1, C, T, H, W) tensor for r3d_18."""
    if consecutive:
        if len(window) < NUM_SAMPLED_FRAMES:
            raise ValueError(
                f"need {NUM_SAMPLED_FRAMES} consecutive frames, got {len(window)}"
            )
        frames = list(window)[-NUM_SAMPLED_FRAMES:]
    else:
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

class WindowScores(NamedTuple):
    classification: str
    confidence: float
    violence_score: float
    weapon_score: float
    violence_logit: float
    weapon_logit: float


def heads_to_classification(violence: float, weapon: float) -> tuple[str, float]:
    """Independent heads -> the one label the existing alert queue understands.

    Not a fusion cascade: both heads can be high at once, and when they are
    the stronger score is reported as the primary class rather than one head
    upgrading the other. `confidence` is that head's sigmoid, not a softmax.
    """
    is_violence = violence >= HEAD_THRESHOLD
    is_weapon = weapon >= HEAD_THRESHOLD
    if not is_violence and not is_weapon:
        return NORMAL_CLASS, float(1.0 - max(violence, weapon))
    if is_violence and not is_weapon:
        return "Violence", violence
    if is_weapon and not is_violence:
        return "Weaponized", weapon
    if weapon >= violence:
        return "Weaponized", weapon
    return "Violence", violence


@torch.inference_mode()
def classify_window(
    model: torch.nn.Module, window: Sequence[np.ndarray], device: torch.device
) -> WindowScores:
    consecutive = isinstance(model, MultiHeadR3D18)
    output = model(preprocess_window(window, device, consecutive=consecutive))
    if isinstance(output, tuple):
        v_logit, w_logit = output
        v_logit_f = float(v_logit.reshape(-1)[0])
        w_logit_f = float(w_logit.reshape(-1)[0])
        violence = float(torch.sigmoid(v_logit).reshape(-1)[0])
        weapon = float(torch.sigmoid(w_logit).reshape(-1)[0])
        classification, confidence = heads_to_classification(violence, weapon)
        return WindowScores(
            classification, confidence, violence, weapon, v_logit_f, w_logit_f
        )

    # Rollback path: old 3-class softmax r3d18.
    probs = torch.softmax(output, dim=1)[0].float().cpu().numpy()
    best = int(probs.argmax())
    violence = float(probs[VIOLENCE_CLASSES.index("Violence")])
    weapon = float(probs[VIOLENCE_CLASSES.index("Weaponized")])
    return WindowScores(
        VIOLENCE_CLASSES[best], float(probs[best]), violence, weapon, 0.0, 0.0
    )


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
# Video sources
#
# The extension point this refactor exists for: everything below `run()`'s
# frame loop already only ever touched raw BGR frames + an fps number, never
# `cv2.VideoCapture` itself, so pulling that out behind an interface changes
# nothing about the pacing/windowing/inference logic -- it only names the
# seam so a real capture source can be dropped in later without touching any
# of that logic again.
# --------------------------------------------------------------------------

class VideoSource:
    """A sequential source of BGR frames, plus the fps to pace them by.

    Three methods, deliberately the whole contract: `open()` to acquire
    whatever resource backs it, `frames()` to iterate it once, `fps` to
    report a pacing rate (0 if unknown -- callers apply their own
    fallback, same as the fixed behavior before this existed), `close()` to
    release it. Nothing about `run()`'s loop depends on there being a file,
    or on which subclass is in play.
    """

    def open(self) -> None:
        raise NotImplementedError

    def frames(self) -> Iterator[tuple[np.ndarray, float]]:
        raise NotImplementedError

    @property
    def fps(self) -> float:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError


class FileVideoSource(VideoSource):
    """Reads a video file sequentially via OpenCV.

    Today's only real, working source -- this is exactly what `run()` did
    inline before this refactor, moved behind the interface above without
    any change in behavior.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._capture: cv2.VideoCapture | None = None

    def open(self) -> None:
        capture = cv2.VideoCapture(str(self._path))
        if not capture.isOpened():
            raise RuntimeError(f"could not open video: {self._path}")
        self._capture = capture

    @property
    def fps(self) -> float:
        assert self._capture is not None, "open() not called"
        return self._capture.get(cv2.CAP_PROP_FPS) or 0.0

    def frames(self) -> Iterator[tuple[np.ndarray, float]]:
        assert self._capture is not None, "open() not called"
        index = 0
        fps = self.fps or 30.0
        last_pts = 0.0
        while True:
            ok, frame = self._capture.read()
            if not ok:
                return
            # Presentation time from the container — the same clock HTML5
            # video.currentTime uses. index/fps drifts on VFR phone footage
            # and puts a real model score on the wrong moment in the file.
            pts_ms = float(self._capture.get(cv2.CAP_PROP_POS_MSEC) or 0.0)
            pts = pts_ms / 1000.0 if pts_ms > 0 else (index + 1) / fps
            if pts < last_pts:
                pts = last_pts
            last_pts = pts
            index += 1
            yield frame, pts

    def close(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None


class RTSPVideoSource(VideoSource):
    """NOT IMPLEMENTED -- a structural stub, not a working source.

    This exists so `cameras.source_type = 'rtsp'` has somewhere real to
    route to in the code, matching the value the schema can already hold
    (see detecto-backend/db's camera-source migration) -- selecting a
    source is meant to become a config change, not a code change, once real
    hardware exists. It is deliberately NOT a working implementation:
    connecting to and pacing a real RTSP stream (reconnect-on-drop, no
    fixed frame count the way a file has, backpressure when inference falls
    behind a live feed) needs real hardware to build and test against,
    which this project does not have. Faking it "working" here (e.g.
    quietly falling back to a file, or returning empty frames) would be
    exactly the dishonesty this whole task exists to avoid -- so every
    method fails loudly instead.
    """

    def __init__(self, url: str) -> None:
        self._url = url

    def _not_implemented(self) -> NotImplementedError:
        return NotImplementedError(
            f"RTSPVideoSource is not implemented (url={self._url!r}). "
            "This is a structural stub for real-hardware integration -- "
            "see its own docstring in inference/live_infer.py."
        )

    def open(self) -> None:
        raise self._not_implemented()

    @property
    def fps(self) -> float:
        raise self._not_implemented()

    def frames(self) -> Iterator[tuple[np.ndarray, float]]:
        raise self._not_implemented()
        yield  # pragma: no cover -- makes this a generator function; never reached.

    def close(self) -> None:
        pass


def build_video_source(*, source_type: str, video: Path | None, rtsp_url: str | None) -> VideoSource:
    """Config/CLI-driven selection -- the one place a source type turns into
    a class. Adding a third source type later means adding one branch here
    and one subclass above, nothing else in this file."""
    if source_type == "file":
        if video is None:
            raise ValueError("source_type='file' requires --video")
        return FileVideoSource(video)
    if source_type == "rtsp":
        if not rtsp_url:
            raise ValueError("source_type='rtsp' requires --rtsp-url")
        return RTSPVideoSource(rtsp_url)
    raise ValueError(f"unknown source_type: {source_type!r}")


def build_event(
    *,
    timestamp: str | float,
    offset_s: float,
    window_start_s: float,
    window_end_s: float,
    camera_id: str,
    scores: WindowScores,
    weapon: dict[str, Any],
    debug: dict[str, Any] | None,
    frame_image: str | None = None,
) -> dict[str, Any]:
    """Assemble the event.

    `classification`/`confidence` are derived from the two independent heads
    so the existing alert pipeline can still debounce Violence / Weaponized.
    `violence_score` / `weapon_score` are the raw sigmoid outputs — the live
    overlay reads those, not the derived label. YOLO fields sit alongside
    and stay unverified; nothing here reads them when deciding the class.
    `window_start_s` / `window_end_s` are the clip the model actually saw,
    so playback can look up the score for the current time instead of
    guessing.
    """
    event: dict[str, Any] = {
        "timestamp": timestamp,
        "offset_s": round(offset_s, 3),
        "window_start_s": round(window_start_s, 3),
        "window_end_s": round(window_end_s, 3),
        "camera_id": camera_id,
        "classification": scores.classification,
        "confidence": round(scores.confidence, 4),
        "violence_score": round(scores.violence_score, 4),
        "weapon_score": round(scores.weapon_score, 4),
        "violence_logit": round(scores.violence_logit, 4),
        "weapon_logit": round(scores.weapon_logit, 4),
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
    classifier = load_classifier(args.violence_model, device)
    kind = "multi-head" if isinstance(classifier, MultiHeadR3D18) else "3-class-softmax"
    log(f"[init] classifier loaded ({kind}): {args.violence_model.name}")

    weapon_model = None
    if not args.no_weapon_detector:
        weapon_model = load_weapon_model(args.weapon_model, device)
        log(f"[init] weapon detector loaded: {args.weapon_model.name} (informational only)")

    source = build_video_source(
        source_type=args.source_type, video=args.video, rtsp_url=args.rtsp_url
    )
    try:
        source.open()
    except (RuntimeError, NotImplementedError, ValueError) as exc:
        log(f"[error] {exc}")
        return 1

    fps = source.fps or 0.0
    if fps <= 0:
        fps = args.fallback_fps
        log(f"[warn] source reports no FPS; assuming {fps}")

    if isinstance(classifier, MultiHeadR3D18):
        # 12 consecutive frames, hop 4. Do not feed a 2s linspace clip:
        # that mixes later incident frames into an empty hallway.
        window_frames = NUM_SAMPLED_FRAMES
        stride_frames = MULTIHEAD_STRIDE_FRAMES
        log(
            f"[init] fps={fps:g} multi-head consecutive={window_frames}f "
            f"stride={stride_frames}f kind={kind} realtime={not args.no_realtime}"
        )
    else:
        window_frames = max(NUM_SAMPLED_FRAMES, int(round(args.window_seconds * fps)))
        stride_frames = max(1, int(round(args.stride_seconds * fps)))
        log(
            f"[init] fps={fps:g} window={window_frames}f ({args.window_seconds}s) "
            f"stride={stride_frames}f ({args.stride_seconds}s) "
            f"sampled={NUM_SAMPLED_FRAMES}f/window kind={kind} "
            f"realtime={not args.no_realtime}"
        )

    session_start = datetime.now(timezone.utc)
    buffer: deque[tuple[np.ndarray, float]] = deque(maxlen=window_frames)
    next_emit_index = window_frames - 1
    emitted = 0
    stream_start = time.perf_counter()

    try:
        for index, (frame, pts) in enumerate(source.frames()):
            # Pace to wall clock so timing behaviour matches a real feed.
            if not args.no_realtime:
                elapsed = time.perf_counter() - stream_start
                if elapsed < pts:
                    time.sleep(pts - elapsed)

            buffer.append((frame, pts))
            if len(buffer) < window_frames or index < next_emit_index:
                continue

            window = [item[0] for item in buffer]
            window_start_s = buffer[0][1]
            window_end_s = buffer[-1][1]
            if len(window) < NUM_SAMPLED_FRAMES:
                log(
                    f"[skip] t={window_end_s:.3f}s only {len(window)} frames "
                    f"(need {NUM_SAMPLED_FRAMES}; no padding)"
                )
                next_emit_index = index + stride_frames
                continue
            began = time.perf_counter()

            # Sole driver of the alert label: two independent sigmoid heads
            # (or the old 3-class softmax, if that checkpoint was passed).
            scores = classify_window(classifier, window, device)
            log(
                f"[score] {window_start_s:.3f}-{window_end_s:.3f}s n={len(window)} "
                f"logit_v={scores.violence_logit:.4f} logit_w={scores.weapon_logit:.4f} "
                f"sig_v={scores.violence_score:.4f} sig_w={scores.weapon_score:.4f} "
                f"class={scores.classification}"
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
            if args.include_frame and scores.classification != NORMAL_CLASS:
                frame_image = encode_frame(
                    window[-1], args.frame_max_px, args.frame_quality
                )

            if args.timestamp_mode == "seconds":
                timestamp: str | float = round(window_end_s, 3)
            else:
                timestamp = (
                    session_start + timedelta(seconds=window_end_s)
                ).isoformat().replace("+00:00", "Z")

            debug = None
            if args.include_debug_fields:
                debug = {
                    "window_start_s": round(window_start_s, 3),
                    "window_end_s": round(window_end_s, 3),
                    "frame_index": index,
                    "class_probabilities": {
                        "violence": round(scores.violence_score, 4),
                        "weapon": round(scores.weapon_score, 4),
                    },
                    "weapon_label": weapon["label"],
                    "weapon_box_count": weapon["count"],
                    "inference_ms": round((time.perf_counter() - began) * 1000, 1),
                }

            print(
                json.dumps(
                    build_event(
                        timestamp=timestamp,
                        offset_s=window_end_s,
                        window_start_s=window_start_s,
                        window_end_s=window_end_s,
                        camera_id=args.camera_id,
                        scores=scores,
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
        source.close()

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
        "--source-type", default="file", choices=("file", "rtsp"),
        help=(
            "Where frames come from. 'file' is the only implemented source "
            "today; 'rtsp' is a structural stub -- see RTSPVideoSource -- "
            "and will fail loudly if selected."
        ),
    )
    parser.add_argument(
        "--video", type=Path,
        default=package / "sample_outputs" / "demo_weaponized_clip.mp4",
        help="Input video file. Used when --source-type=file.",
    )
    parser.add_argument(
        "--rtsp-url", default=None,
        help="RTSP stream URL. Used when --source-type=rtsp (not yet implemented).",
    )
    parser.add_argument(
        "--violence-model", type=Path,
        default=here / "models" / "detecto-hackathon-final.pt",
        help=(
            "Classifier weights. Default is the locked-in multi-head model. "
            "Pass Detecto_Demo_Package/models/violence_classifier_r3d18.pt to "
            "roll back to the previous 3-class softmax head."
        ),
    )
    parser.add_argument(
        "--weapon-model", type=Path,
        default=here / "models" / "weapon_localizer_yolov8.pt",
        help="YOLOv8 weapon localizer weights (visual overlay only; not the alert).",
    )
    parser.add_argument("--camera-id", default="demo-camera-1", help="Camera identifier in events.")
    parser.add_argument("--window-seconds", type=float, default=2.0, help="Sliding window length.")
    parser.add_argument("--stride-seconds", type=float, default=0.5, help="Hop between windows.")
    parser.add_argument("--weapon-conf", type=float, default=0.5, help="Weapon localizer confidence threshold.")
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
    if args.source_type == "rtsp" and not args.rtsp_url:
        print("[error] --source-type rtsp requires --rtsp-url", file=sys.stderr)
        return 1
    # Only the file source has a path to check ahead of time -- rtsp's
    # "does this even exist" question is answered by build_video_source()
    # raising, not by a file-exists check that has nothing to check.
    paths = (args.video, args.violence_model) if args.source_type == "file" else (args.violence_model,)
    for path in paths:
        if not path.exists():
            print(f"[error] missing file: {path}", file=sys.stderr)
            return 1
    if not args.no_weapon_detector and not args.weapon_model.exists():
        print(f"[error] missing file: {args.weapon_model}", file=sys.stderr)
        return 1
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
