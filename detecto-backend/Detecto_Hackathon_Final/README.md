# Detecto — Final Model Package (Hackathon Lock-in)
Generated: 2026-09-03 05:12

## Load the model
```python
import torch, torch.nn as nn
from torchvision.models.video import r3d_18

class MultiHeadR3D18(nn.Module):
    def __init__(self):
        super().__init__()
        backbone = r3d_18(weights=None)
        backbone.fc = nn.Identity()
        self.backbone = backbone
        self.violence_head = nn.Sequential(nn.Linear(512, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, 1))
        self.weapon_head = nn.Sequential(nn.Linear(512, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, 1))
    def forward(self, x):
        f = self.backbone(x)
        return self.violence_head(f).squeeze(-1), self.weapon_head(f).squeeze(-1)

model = MultiHeadR3D18()
model.load_state_dict(torch.load('models/detecto_multihead_final.pt', map_location='cpu'))
model.eval()
# Output: violence_logit, weapon_logit -> apply torch.sigmoid() for probabilities
```

## What's in this package
- `models/detecto_multihead_final.pt` — the locked-in model. Violence AUC 0.999, Weapon AUC 0.911.
- `models/weapon_localizer_yolov8.pt` — separate object detector for drawing weapon bounding boxes in the live demo overlay ONLY. Does not feed the alert decision.
- `eval_results/detecto_*_split.csv` — the exact pinned data splits. ANY retraining or re-evaluation MUST use these, never rebuild from `os.listdir()` (a past bug caused silent train/val leakage — see RESULTS_SUMMARY.json).
- `RESULTS_SUMMARY.json` — machine-readable results + key findings.
- `docs/Literature_Review.md` — full research background and identified gap.

## Critical: input preprocessing (must match exactly)
- 12 uniformly-sampled frames per clip
- Aspect-ratio-preserving resize (short side to 128px) + center crop to 112x112
- Normalize with Kinetics mean/std: mean=[0.43216, 0.394666, 0.37645], std=[0.22803, 0.22145, 0.216989]

## Do NOT
- Rebuild train/val splits from scratch — always load the pinned CSVs.
- Reintroduce a hard-rule fusion cascade — proven to degrade accuracy in this project's own experiments.
- Present the weapon head's 0.911 AUC as object-localization accuracy — it is a clip-level contextual classifier.
