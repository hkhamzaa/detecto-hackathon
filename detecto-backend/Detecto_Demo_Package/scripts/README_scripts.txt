This folder should contain the following scripts, copy them in manually from the chat:

1. dataset_exploration.py — mounts Drive, unzips SCVD, prints class distribution + video stats
2. duration_baseline_check.py — proves the clip-duration confound (81.7% acc from duration alone)
3. train_r3d18_baseline.py — trains/loads the R3D-18 violence classifier (80.4% val acc)
4. weapon_cascade_eval.py — evaluates R3D-18 + weapon detector fusion (documents why naive fusion fails)
5. live_stream_demo.py — sliding-window live-camera-style demo with on-screen alert overlay

All scripts and their outputs are in the chat history — paste each into its own .py file here.
