# FixMyCity Classifier — Retrain RUNBOOK

Exact, ordered commands to fix and redeploy the civic image classifier. Run everything from
`backend/` on **Node 20** with the **Python venv active**. This pipeline does **not** download
any datasets — it operates on the existing `my_dataset/` images.

Authoritative design: `IMPLEMENTATION_SPEC.md` (§8). The single-command equivalent of the steps
below is `python retrain_pipeline.py` (use that to run them all in order; it hard-stops on a
training collapse). The manual sequence is documented here so you can inspect each artifact.

---

## Prerequisites

- Node 20 LTS (TFJS pure-JS / WASM; **no** native tfjs-node, no C++ toolchain).
- Python 3.10+ with a virtualenv activated (`.\.venv\Scripts\Activate.ps1` on Windows).
- A trained model is NOT required to start — the point is to (re)train it.

---

## Commands (run in this exact order)

```bash
# backend/, Node 20 + Python venv active
cd backend

# 0. one-time: install new Node dep (CLIP runtime) and Python deps
#    --omit=optional skips onnxruntime-node (native). Without it, transformers.js
#    prefers the native binding over WASM and reintroduces the prebuilt-ABI
#    failure mode this project dropped tfjs-node for. (Note: `sharp` is a HARD
#    native dep of @xenova/transformers v2.x and is still installed — confirm a
#    sharp prebuild exists for your Node 20 platform, else the install fails.)
npm install --omit=optional
pip install transformers torch pillow scikit-learn scipy tensorflow tensorflowjs

# 1. clean contamination (dry-run first, then apply)
python clean_dataset_contamination.py                      # review clean_report.csv
python clean_dataset_contamination.py --apply              # quarantine flagged files

# 2. validate dataset health (corrected [0,255] preprocessing)
python validate_dataset.py

# 3. train (anti-collapse gate: aborts with exit 2 if macro-F1 < 0.55 or any class recall < 0.05)
python train_civic_model.py --batch 16
#    -> on success: civic_model.keras + civic_model_tfjs/ (dual-head [logits, probs]) exported

# 4. calibrate on logits (writes temperature + full ood block + per-class thresholds)
python temperature_scaling.py --target-recall 0.92
#    -> FAILS LOUD if temperature saturates a bound (model still broken)

# 5. corrected post-train audit (re-confirm drainage contamination on a real model)
python audit_dataset.py

# 6. build CLIP exemplars for the Others open-set path
python build_others_exemplars.py --extra internet_images

# 7. restart the API
npm run dev
```

> One-shot alternative: `python retrain_pipeline.py` runs steps 1–6 in order (clean uses
> `--apply`), hard-stops with exit 1 if training trips the collapse gate, then you run step 7.

---

## Acceptance gate (do NOT skip)

The previous run was broken (val_accuracy 0.31 ≈ random, temperature pinned at the bound 10.0,
drainage never predicted). Treat these as hard checkpoints — stop and fix if any fails:

1. **After step 1 (clean):** open `clean_report.csv`. Confirm drainage flagged files are genuinely
   contaminated (road/pothole images mislabeled as drainage) before trusting `--apply`. Quarantined
   files moved to `my_dataset/_quarantine/` are excluded from training; nothing is deleted.

2. **After step 3 (train):** do **not** proceed unless it printed a **passing macro-F1 (≥ 0.55)**
   with every per-class recall ≥ 0.05 **and** exported TFJS. If it exited with code **2**, the
   anti-collapse gate fired, `civic_model_tfjs/` was left untouched, and you must fix the
   data/recipe and retrain — downstream steps would be worthless.

3. **After step 4 (calibrate):** do **not** trust the result if `civic_thresholds.json` contains a
   non-null `calibration_warning` or if the script reported the temperature hit a bound. That means
   the model is still collapsed — go back to step 3.

4. **After step 7 (restart), check `/api/health`.** The system is only considered fixed when it shows:
   - `enforce_mode: true`
   - `has_logits_head: true`
   - `ood_method_active: "energy"`
   - `clip_ready: true`

If any of those is false, the classifier is running in advisory mode — inspect the server boot logs
and the two JSON artifacts (`civic_thresholds.json`, `civic_exemplars.json`).

---

## What each step produces / why it matters

| Step | Script | Output artifact | Purpose |
|------|--------|-----------------|---------|
| 1 | `clean_dataset_contamination.py` | `clean_report.csv`, `my_dataset/_quarantine/` | Remove mislabeled images (fixes "drainage accepts potholes") |
| 2 | `validate_dataset.py` | console health report | Confirm corrected `[0,255]` preprocessing & class balance |
| 3 | `train_civic_model.py` | `civic_model.keras`, `civic_model_tfjs/`, `training_confusion.json` | Retrain EfficientNetB0 dual-head with collapse gate |
| 4 | `temperature_scaling.py` | `civic_thresholds.json` (schema v2) | Logits calibration + energy OOD + per-class thresholds |
| 5 | `audit_dataset.py` | `audit_report.csv` | Confirm contamination really gone on the real model |
| 6 | `build_others_exemplars.py` | `civic_exemplars.json` | CLIP exemplars driving the Others open-set routing |
| 7 | `npm run dev` | — | Server loads the new model, thresholds, and CLIP exemplars |

---

## Notes & options

- **No downloads by default.** To re-run the legacy fetch/filter steps before cleaning, use
  `python retrain_pipeline.py --with-download`.
- **`internet_images/`** in step 6 is optional. If you have no extra images, run
  `python build_others_exemplars.py` (it falls back to `my_dataset/` exemplars only).
- **Inference is pure-JS / WASM only.** The Node CLIP runtime uses `@xenova/transformers`
  (`Xenova/clip-vit-base-patch32`). Install with `npm install --omit=optional` to force the WASM
  execution provider (no native `onnxruntime-node` binding). `others_clip.js` also disables the
  native ONNX provider at load. First boot downloads the CLIP weights into `backend/.cache` — allow
  network access once (air-gapped/ngrok demos: pre-warm or vendor `backend/.cache`).
- **Re-running:** `python retrain_pipeline.py --only-train` skips cleaning/validation and runs
  train → calibrate → audit → build-exemplars. `--resume-from N` and `--dry-run` are also available.
