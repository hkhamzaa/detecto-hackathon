# Detecto — Demo Package
Generated: 2026-08-29 14:54

## What's in this package

### /models
- `violence_classifier_r3d18.pt` — R3D-18 (Kinetics-400 pretrained, fine-tuned on SCVD).
  3-class output: Normal / Violence / Weaponized. **Val accuracy: 80.4%** (97 held-out clips).
- `weapon_detector_yolov8.pt` — YOLOv8, pretrained externally on a Roboflow weapon dataset
  (guns + knife classes). Source: github.com/JoaoAssalim/Weapons-and-Knives-Detector-with-YOLOv8

### /sample_outputs
- `demo_weaponized_clip.mp4` — sliding-window live-stream-style demo: alert banner updates in
  near-real-time as the clip plays, plus unverified weapon-detection boxes overlaid.

### /docs
- `Literature_Review_and_Gap_Analysis.md` — 60+ paper survey across weapon detection, violence
  detection, video anomaly detection, and the specific research gap this project targets
  (joint weapon+violence fusion — currently unsolved even by the SCVD dataset's own SOTA paper).

### /scripts
- Standalone Colab-ready scripts for each pipeline stage (see README_scripts.txt inside).

## Known results & honest limitations — READ BEFORE DEMOING

1. **Violence classifier (R3D-18): 80.4% val accuracy.** This is the reliable, working part
   of the system and should drive the main alert in any demo.

2. **Duration confound found and controlled for.** SCVD clip length alone (no visual content)
   predicts class with 81.7% accuracy — Normal clips run ~4s, Weaponized ~7s, Violence ~9s+.
   The classifier uses fixed 12-frame sampling specifically so it can't exploit this shortcut.
   **This confound is not mentioned in the original SCVD/SSIVD-Net paper — worth flagging as
   a novel finding if this becomes a paper.**

3. **Weapon-detection fusion does NOT currently improve results — do not present it as working.**
   Two independent attempts:
   - Generic COCO YOLOv8 (knife class only): fired 0 times on 97 CCTV clips — no usable signal.
   - Domain-specific weapon detector (guns+knife, surveillance-trained): fired on 81% of clips,
     including most Normal (no-weapon) clips at similar confidence to true weapon detections.
     Naive fusion (auto-upgrade Violence→Weaponized on detection) *hurt* accuracy (80%→76%),
     tanking Violence-class F1 from 0.65 to 0.24.
   - **Conclusion for demo purposes:** weapon detector boxes are shown on-screen labeled
     "possible weapon (unverified)" — informational only, does NOT drive the alert banner.
     This is intentional and matches the human-verification design principle, not a bug to fix
     before demoing.

4. **Validation set is small (97 clips: 50 Normal / 22 Violence / 25 Weaponized).**
   Precision/recall numbers, especially for Weaponized (60% recall), have wide error bars.
   K-fold cross-validation is a recommended next step before quoting these numbers externally.

## Research gap this project targets (for anyone extending this)
No existing model learns a *shared* representation of weapon-appearance and violent-motion —
every system found in the literature (including SCVD's own SOTA, SSIVD-Net) either treats
weapon and violence detection as fully separate systems, or collapses "weapon-violence" and
"violence" into one label rather than jointly modeling them. Our own experiments (point 3 above)
independently confirm this is a real, unsolved problem, not just a literature gap — a naive
late-fusion approach actively makes things worse. Building a true shared-backbone model
(one network, two heads: violence-temporal + weapon-localization, trained jointly) is the
recommended next research direction.

## Immediate next steps for whoever picks this up
1. K-fold cross-validation on the R3D-18 baseline for trustworthy metrics.
2. Fine-tune (not just use off-the-shelf) a weapon detector on SCVD-style CCTV footage —
   needs a small annotated subset (a few hundred frames), not full-dataset annotation.
3. Explore the joint/shared-backbone architecture described above.
4. Extend to gender-based-harassment/forced-movement module (see literature review §3.7a) —
   flagged as second-wave, not part of current MVP.
