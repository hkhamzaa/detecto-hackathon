"""Translate Phase 1 inference events into the frontend's `Alert` shape.

The target shape is not invented here. It is the `Alert` type exported by
`detecto-frontend/src/lib/alerts/api.ts`, and specifically what `parseAlert()`
in that file will accept off the wire:

    id          string          required; rejected if empty
    cameraId    string          -> '' when missing
    cameraName  string          -> 'Unknown camera' when missing
    zone        string          -> '' when missing
    kind        'weapon' | 'violence'   required; anything else is rejected
    subtype     string | null
    confidence  number          0-1, unrounded
    detectedAt  string          required; ISO-8601
    model       string          -> 'unknown' when missing
    status      'unconfirmed' | 'confirmed' | 'dismissed'   required
    decidedBy   string | null
    decidedAt   string | null

Field names are camelCase and absent values are explicit `null`, never omitted.
No field here is made up; every key above appears in that file.

One key is added that the frontend does not yet declare -- see PIPELINE_STATUS.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# --------------------------------------------------------------------------
# The one field that is not in the frontend's schema
# --------------------------------------------------------------------------

# The frontend has no field for "this alert came from a pipeline we do not
# trust yet". The nearest candidate is `model`, but that field exists so a bad
# release can be traced to a build, and stuffing a status into it would make it
# useless for that. So this is a thirteenth key rather than an overload of an
# existing one, named in the schema's camelCase convention.
#
# NOTE FOR THE FRONTEND: `parseAlert()` rebuilds the alert key by key and drops
# anything it does not name, so this value reaches the browser over the socket
# but does not survive that parser. Reading it requires one line added there.
PIPELINE_STATUS_KEY = "pipelineStatus"
PIPELINE_STATUS = "beta"

# --------------------------------------------------------------------------
# Phase 1 -> frontend mappings
# --------------------------------------------------------------------------

# `classification` is one of Normal / Violence / Weaponized and comes from the
# violence classifier alone. `Normal` is not an alert and never becomes one --
# it is filtered out before this module is reached.
KIND_BY_CLASSIFICATION: dict[str, str] = {
    "Violence": "violence",
    "Weaponized": "weapon",
}

# Every alert arrives having been decided by nobody. That is the entire point
# of the queue, so this is a constant rather than a parameter.
INITIAL_STATUS = "unconfirmed"


class AlertIdSequence:
    """`ALR-0001`, `ALR-0002`, ... -- the format an operator can read aloud.

    Matches the frontend mock's `ALR-2291` shape. Per-process and not durable;
    persistence is explicitly out of scope for this server.
    """

    def __init__(self, prefix: str = "ALR", start: int = 1) -> None:
        self._prefix = prefix
        self._next = start

    def take(self) -> str:
        value = f"{self._prefix}-{self._next:04d}"
        self._next += 1
        return value


def is_alertable(event: dict[str, Any]) -> bool:
    """True only for classifications that represent something worth raising.

    `Normal` windows arrive every stride (0.5s by default) and are silently
    dropped. An alert system that fires on Normal is not an alert system.
    """
    return event.get("classification") in KIND_BY_CLASSIFICATION


class IncidentGrouper:
    """Collapses a run of consecutive same-class windows into one alert.

    The classifier reports on a sliding window every stride, so a single event
    lasting six seconds produces a dozen windows saying the same thing. Those
    are one incident, and raising twelve alerts for it would bury the operator
    while telling them nothing the first alert did not.

    The rule, deliberately the whole rule:

        raise, when the class differs from the run currently open
        raise, when a `Normal` window closed the previous run
        otherwise, stay quiet -- the incident is still the one already raised

    No confidence thresholds, no timers, no minimum run length. Those are
    tuning decisions that need real footage and a person who knows the domain
    to choose; a rule nobody can explain is worse than one that is merely
    coarse. What this does not do is worth stating plainly: an incident that
    escalates mid-run (Violence -> Weaponized) raises a second alert, because
    the class changed; an incident that grows more confident within one class
    does not, because nothing new was classified.
    """

    def __init__(self) -> None:
        # The class of the run currently open, or None when the last window
        # was Normal (or nothing has arrived yet) and the next detection
        # therefore starts a new incident.
        self.open_class: str | None = None
        # Windows folded into the currently open incident, first included.
        self.window_count = 0

    def observe(self, event: dict[str, Any]) -> bool:
        """Record one window. True if it should be raised as a new alert."""
        classification = event.get("classification")

        # Normal closes whatever run was open. The next detection, whenever it
        # comes, is a new incident rather than a continuation of this one.
        if classification not in KIND_BY_CLASSIFICATION:
            self.open_class = None
            self.window_count = 0
            return False

        if classification == self.open_class:
            self.window_count += 1
            return False

        self.open_class = classification
        self.window_count = 1
        return True


def _detected_at(timestamp: Any) -> str:
    """Phase 1's `timestamp` as an ISO-8601 string.

    `--timestamp-mode iso8601` (the default, and what this server asks for)
    already gives a string. `--timestamp-mode seconds` gives a float offset,
    which is not a wall-clock instant the frontend can render, so it falls back
    to now -- the moment the event reached us.
    """
    if isinstance(timestamp, str) and timestamp:
        return timestamp
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def to_alert(
    event: dict[str, Any],
    *,
    alert_id: str,
    camera_name: str,
    zone: str,
    model: str,
) -> dict[str, Any]:
    """One Phase 1 event -> one `Alert`, ready to emit.

    Caller must have checked `is_alertable()` first.
    """
    classification = event["classification"]

    alert: dict[str, Any] = {
        "id": alert_id,
        # Phase 1's `camera_id` is the same identity, snake_case on that side.
        "cameraId": event.get("camera_id") or "",
        # Phase 1 knows a camera's id but not its name or where it points --
        # that lives in the camera records, which this server does not read.
        # Both are configured on this side instead.
        "cameraName": camera_name,
        "zone": zone,
        "kind": KIND_BY_CLASSIFICATION[classification],
        # Always null. The schema documents null as "the model only had a
        # class", which is exactly Phase 1's situation: the only per-instance
        # label available is `weapon_label`, from the detector its own README
        # marks unverified and forbids from shaping the alert. An unverified
        # label displayed as `Weapon - handgun` would read as a finding.
        "subtype": None,
        # Softmax probability of the reported class, passed through unrounded.
        # The frontend rounds for display and says a score that reads 0.6 hides
        # whether it was 0.62 -- so rounding here would throw that away.
        "confidence": event.get("confidence", 0.0),
        "detectedAt": _detected_at(event.get("timestamp")),
        "model": model,
        "status": INITIAL_STATUS,
        "decidedBy": None,
        "decidedAt": None,
        PIPELINE_STATUS_KEY: PIPELINE_STATUS,
    }

    # The still the classifier actually saw, when the script was asked for one.
    # Absent rather than null when there is none, so a client can test for the
    # key and fall back to its own placeholder.
    frame_image = event.get("frame_image")
    if isinstance(frame_image, str) and frame_image:
        alert["frameImage"] = frame_image

    return alert
