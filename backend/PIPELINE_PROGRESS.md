# Retrain Pipeline — Progress (resume notes)

Last session paused mid-pipeline. Run everything from `backend/` with venv active:
`.\.venv\Scripts\Activate.ps1`

## DONE ✅

- **Env fixed.** Installed `torch 2.12.1+cpu`. **Pinned `transformers==4.44.2`** (5.x
  broke `CLIPModel.get_image_features` → returned 768-dim pre-projection output instead of
  the 512-dim projected embedding). CLIP weights cached at `~/.cache/huggingface`.
  Do NOT upgrade transformers past 4.x or CLIP embeddings break.
- **Step 1 — contamination clean APPLIED.** 146 files quarantined (35 drainage / 71
  potholes / 40 streetlight) to `my_dataset_quarantine/<class>/` (212 total incl. older runs).
  Nothing deleted — reversible.
- **Step 2 — validate health PASSED.** 0 corrupted, 0 dups, others diversity 9.83 (diverse).

### Cleaned dataset counts (in `my_dataset/`)
| class | count |
|---|---|
| potholes | 1019 |
| others | 1235 |
| streetlight | 794 |
| drainage | 606 |

## CODE CHANGES this session (already saved)

`clean_dataset_contamination.py`:
1. **Quarantine policy rewrite.** `text_mismatch` + `low_margin` were nuking ~430 genuine
   drainage images (CLIP image→text bias + natural drainage/others visual overlap). Now only
   IMAGE-SPACE evidence (`nearest_mismatch` / `outlier_lowsim`) moves a file; weak signals are
   advisory-only. New CSV `action` column. Added `--aggressive` to restore old behavior.
   Result: 909 flagged → only 146 quarantined.
2. **`QUARANTINE_DIR` moved OUT of `my_dataset/`** → `my_dataset_quarantine`. A nested
   `_quarantine` folder became a bogus 5th class and crashed Keras `image_dataset_from_directory`.
   The 146 files were relocated to the sibling dir; `my_dataset/` now holds exactly the 4 classes.

## SESSION 2 UPDATE — moved to Colab GPU training ▶️

- **Dataset flattened.** Nested dumps removed: `drainage/Dataset/images`, `potholes/annotated-images`,
  `streetlight/final light poles` flattened into top-level class dirs (prefix `nst_ph_`/`nst_sl_`).
  Segmentation-mask label dirs moved out to `my_dataset_nested_raw/`. `my_dataset/` now 4 FLAT dirs.
- **Re-clean applied** on expanded set. potholes/streetlight quarantine kept (184/141, centroids
  healthy: trusted 1018/793). **Drainage cleaning REVERTED** — trusted centroid built from only 185
  `drain_`-prefix files (other drainage prefixes excluded) → flagged genuine drainage as outliers
  (450/1046 = 43% false-positive storm, same bug as before). All drainage restored.
- **Final clean counts:** drainage 1101 / others 1235 / potholes 1578 / streetlight 1640.
- **Colab notebook written:** `FixMyCity_Colab_Train.ipynb`. Train moved to Colab T4 GPU
  (~15-30min vs many CPU hours). `my_dataset.zip` being produced for upload.

### Colab flow
1. Upload to Drive folder `FixMyCity`: `my_dataset.zip`, `train_civic_model.py`, `civic_labels.json`.
2. Open notebook in Colab, set T4 GPU, run all cells. Downloads `civic_artifacts.zip`.
3. Unzip into `backend/` (overwrite `civic_model.keras` + `civic_model_tfjs/`).
4. Then local Steps 4-7 below (calibrate → audit → exemplars → restart).

## NEXT — resume here ▶️

```bash
# Step 3 — TRAIN (long on CPU, anti-collapse gate exits 2 on failure)
python train_civic_model.py --batch 16
#   was just launching when paused; dataset loads clean now (4 classes only).
#   GATE: do NOT proceed unless macro-F1 >= 0.55, every class recall >= 0.05, TFJS exported.

# Step 4 — calibrate
python temperature_scaling.py --target-recall 0.92
#   GATE: civic_thresholds.json must have null calibration_warning + temperature not at a bound.

# Step 5 — post-train audit
python audit_dataset.py

# Step 6 — CLIP exemplars for Others open-set
python build_others_exemplars.py --extra internet_images
#   (or no --extra if no internet_images/)

# Step 7 — restart API, check /api/health:
#   enforce_mode:true, has_logits_head:true, ood_method_active:"energy", clip_ready:true
npm run dev
```

Acceptance gates in full: `RUNBOOK.md`.
