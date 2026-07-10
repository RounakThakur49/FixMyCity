# FixMyCity Civic Classifier — IMPLEMENTATION SPEC (v1, contract)

**Status:** authoritative. Parallel implementers MUST follow this exactly. Where a value is given (a number, a name, a key), it is a hard contract — do not "improve" it without changing this document first. All paths are relative to `backend/`.

**Deliverable rule (locked):** CODE + PLAN ONLY. No implementer runs training, downloads, or calibration. You only write/modify code and docs.

---

## 0. SHARED CONSTANTS (copy verbatim into every file that needs them)

These values appear in multiple files. They MUST be identical everywhere. There is **no shared module** (ownership is disjoint); each owner hard-codes these.

```
CLASS_ORDER            = ["drainage", "others", "potholes", "streetlight"]   # index 0..3, UNCHANGED
IMG_SIZE               = 224 x 224
PIXEL_RANGE            = [0, 255] float32, RGB, bilinear resize          # see §1
RESIZE_METHOD          = bilinear
VAL_SPLIT              = 0.25            # image_dataset_from_directory seed=42
SEED                   = 42
MIX_PROB               = 0.40           # fraction of Stage-2 batches that get mixup/cutmix
FOCAL_GAMMA            = 1.5
LABEL_SMOOTHING        = 0.0
DRAINAGE_ALPHA_BOOST   = 1.5            # drainage emphasis, folded into focal alpha ONLY
ACCEPT_MACRO_F1        = 0.55           # anti-collapse export gate
MIN_PER_CLASS_RECALL   = 0.05           # anti-collapse export gate
ADVISORY_MACRO_F1      = 0.55           # server boots advisory below this
PRECISION_MIN          = 0.70           # per-class threshold selection
RECALL_MIN             = 0.85           # per-class threshold selection
OOD_PERCENTILE         = 95
CLIP_MODEL_ID          = "Xenova/clip-vit-base-patch32"   # Node; Python uses openai/clip-vit-base-patch32 (same weights)
CLIP_EMBED_DIM         = 512
CLIP_OOD_FLOOR         = 0.22           # below this fused cosine = novel/open-set
BLOCKING_CLASSES       = ["drainage", "potholes", "streetlight"]   # "others" is NEVER a blocking class
```

The model keeps a **4-output head** in `CLASS_ORDER` (incl. `others`) so indices and `civic_labels.json` never change. `others` simply stops being a *blocking* class — its runtime decision is delegated to CLIP (§5–6).

---

## 1. PREPROCESSING CONTRACT (single canonical spec)

**There is exactly ONE preprocessing for the EfficientNetB0 path. train == infer == audit == calibration.**

| Property | Value |
|---|---|
| Decode | RGB only (drop alpha). JPEG via jpeg-js (Node) / PIL `convert("RGB")` (Py) |
| Resize | bilinear to 224×224 |
| Pixel range | **raw float32 `[0, 255]`** |
| External normalization | **NONE.** `efficientnet.preprocess_input` is a documented no-op; the Normalization/Rescaling is baked inside the Keras EfficientNetB0 graph. |
| Channel order | RGB |
| Batch dim | `[1, 224, 224, 3]` at inference; `[B, 224, 224, 3]` in batches |

**Rule:** never apply `/255`, never apply `/127.5 - 1`, never apply `mobilenet_v2.preprocess_input`. Feed raw `[0,255]`.

Per-site obligations:

- **train_civic_model.py** — already correct: `eff_preprocess` (no-op) on `[0,255]`. Keep. Only fix `GaussianNoise` scale (§2.8).
- **temperature_scaling.py** — already correct (`efficientnet.preprocess_input`). Keep.
- **audit_dataset.py** — FIX: delete `from ...mobilenet_v2 import preprocess_input` (L13) and the `arr = preprocess_input(arr)` (L62). Feed the raw `[0,255]` stack. Use `tf.keras.utils.load_img(path, target_size=(224,224), interpolation="bilinear")`.
- **validate_dataset.py** — FIX: change L161 `arr = np.array(img, dtype="float32") / 255.0` → `arr = np.array(img, dtype="float32")` (keep `[0,255]`). Resize must be bilinear: `Image.open(f).convert("RGB").resize((224,224), Image.Resampling.BILINEAR)`.
- **server.js** — `preprocessForCivicModel` already feeds `[0,255]`. Keep. Add the load-time self-test in §3/§6.

Every site MUST print a one-line preprocessing identity at startup, e.g. `print("[preprocess] EfficientNet raw [0,255], bilinear 224")`, so skew can never recur silently.

---

## 2. TRAINING RECIPE FIX — `train_civic_model.py` (owner: train_civic_model.py)

Keep **EfficientNetB0**. Keep `CLASSES`/`civic_labels.json` order unchanged. Apply the following exact changes.

### 2.1 Dual-output head (logits + softmax)
Replace the single-softmax output in `build_model()` (L301) with:

```python
x = layers.Dense(256, activation="swish")(x)
x = layers.Dropout(0.25)(x)
logits = layers.Dense(len(CLASSES), activation=None, name="logits")(x)   # raw, linear
probs  = layers.Activation("softmax", name="probs")(logits)               # calibrated downstream
model  = models.Model(inputs, [logits, probs])
return model, base
```

**Output order is `[logits, probs]`.** Names are exactly `"logits"` and `"probs"`. server.js and temperature_scaling.py key off these names.

### 2.2 Loss on `probs` only; logits carries no loss
Every `model.compile(...)` (Stages 1–3) becomes:

```python
model.compile(
    optimizer=<stage optimizer>,
    loss={"probs": focal_loss},                 # logits omitted -> no loss on logits
    metrics={"probs": ["accuracy"]},
)
```

Targets must be a dict. Add a final `.map` on every train/val pipeline that feeds `.fit`:

```python
def as_targets(x, y):           # y may be int [B] OR soft [B,C]
    return x, {"probs": y}
```

Apply `as_targets` to `train_aug` and to `val` immediately before `model.fit`. `model.fit(..., validation_data=val_mapped)`. **Remove `class_weight=` from ALL three `model.fit` calls** (incompatible with soft labels + double-counts alpha).

### 2.3 Mixup/CutMix gated, not 100%
Replace `apply_mixed_augmentation` (L374-380) with a probability gate that emits one-hot in the clean branch (uniform loss path):

```python
def apply_mixed_augmentation(x, y, p_mix=MIX_PROB):
    if tf.random.uniform([]) < p_mix:
        if tf.random.uniform([]) > 0.5:
            return cutmix(x, y)        # soft labels [B,C]
        return mixup(x, y)             # soft labels [B,C]
    return x, tf.one_hot(tf.cast(y, tf.int32), len(CLASSES))   # clean one-hot [B,C]
```

Mixing schedule (hard contract):
- **Stage 1 (head warmup):** NO mixing. Call `stage1_train(..., apply_aug=False)`. Clean one-hot labels — convert via `train.map(lambda x,y:(x, tf.one_hot(tf.cast(y,tf.int32),len(CLASSES))))`.
- **Stage 2:** mixing gated at `MIX_PROB=0.40`.
- **Stage 3 (fine-tune sharpen):** NO mixing. Clean one-hot (same as Stage 1).

### 2.4 Single imbalance lever = focal alpha (mean-normalized)
In `make_focal_loss` (L360-367) change normalization from sum=1 to **mean=1**:

```python
alpha = np.array([class_weights_dict[i] for i in range(len(CLASSES))], dtype=np.float32)
alpha = alpha / alpha.mean()          # preserve absolute loss scale (NOT /alpha.sum())
```

`FocalLoss(gamma=FOCAL_GAMMA=1.5, alpha=alpha, label_smoothing=LABEL_SMOOTHING=0.0)`. `compute_class_weights` keeps `drainage_boost` (×`DRAINAGE_ALPHA_BOOST`=1.5) — this is now the ONLY drainage emphasis. Update CLI default `--label-smoothing 0.0`, `--gamma 1.5`.

### 2.5 Drainage oversampling removed (was a no-op)
Delete usage of `build_drainage_boosted_dataset` in Stage 1 (the `cardinality()==-2 → take(1)` bug). Stage 1 uses the normal clean `train`. You MAY delete the function body or leave it dead, but it must not be called. After datasets are built, print the realized per-class histogram of one training batch sweep (or `get_class_counts()`).

### 2.6 BN freeze policy (document, keep)
Keep `base(inputs, training=False)` (L291) and the BN-frozen loops in Stage 2/3. Add a comment that BN stays frozen so TFJS pure-JS inference uses stable moving stats. No behavioral change.

### 2.7 Best-model selection on macro-F1 + anti-collapse gate
Add a callback (before training) and use it everywhere:

```python
class MacroF1(callbacks.Callback):
    def __init__(self, val_ds): self.val_ds = val_ds
    def on_epoch_end(self, epoch, logs=None):
        from sklearn.metrics import f1_score
        yt, yp = [], []
        for x, y in self.val_ds:                       # val_ds yields (x, int_y)
            p = self.model.predict(x, verbose=0)
            p = p[1] if isinstance(p, list) else p     # probs head
            yt.extend(np.asarray(y).tolist()); yp.extend(np.argmax(p,1).tolist())
        f1 = f1_score(yt, yp, average="macro", labels=list(range(len(CLASSES))), zero_division=0)
        logs["val_macro_f1"] = float(f1)
        print(f"  val_macro_f1={f1:.4f}")
```

- All `EarlyStopping` and `ModelCheckpoint` use `monitor="val_macro_f1", mode="max"`.
- Cross-stage best selection (L726-763) compares `val_macro_f1` (max over each stage's `history["val_macro_f1"]`), not `val_accuracy`.
- Pass a **clean, int-labelled** val dataset (the raw `val` before `as_targets`) to `MacroF1`.

**Anti-collapse export gate** — after the confusion matrix, BEFORE `export_tfjs()`:

```python
recalls = [per_class_metrics[c]["recall"] for c in CLASSES]
if best_macro_f1 < ACCEPT_MACRO_F1 or min(recalls) < MIN_PER_CLASS_RECALL:
    print(f"[ABORT] collapse guard: macro_f1={best_macro_f1:.3f} (need >= {ACCEPT_MACRO_F1}), "
          f"min recall={min(recalls):.3f} (need >= {MIN_PER_CLASS_RECALL}). "
          f"NOT exporting TFJS; civic_model_tfjs/ left untouched.")
    sys.exit(2)
```

Write `best_macro_f1` into `training_confusion.json`. Only on pass does `export_tfjs()` run and overwrite `civic_model_tfjs/`.

### 2.8 GaussianNoise scale fix
`layers.GaussianNoise(0.02)` → `layers.GaussianNoise(5.0)` (stddev on `[0,255]` scale).

### 2.9 TFJS export keeps both heads
`export_tfjs` is unchanged structurally, but verify the converted `model.json` `output_layers` lists both `logits` and `probs`. Add a post-export assertion that reads `civic_model_tfjs/model.json` and confirms 2 output layers; print a WARN if not.

---

## 3. CALIBRATION FIX — `temperature_scaling.py` (owner: temperature_scaling.py)

Operate on **logits**, write a complete `ood` block, precision-constrained per-class thresholds for blocking classes only.

### 3.1 Collect logits (not softmax)
Replace `get_softmax_output`/`get_logits_and_labels` with logits collection keyed by output name:

```python
def get_logits_and_labels(model, val_ds):
    li = model.output_names.index("logits")     # dual-output model
    Z, Y = [], []
    for x, y in val_ds:
        out = model(x, training=False)
        z = out[li].numpy()
        Z.append(z); Y.append(y.numpy())
    return np.concatenate(Z), np.concatenate(Y)
```
Also collect `probs` (index of `"probs"`) for the uncalibrated baseline accuracy. If the model is single-output (legacy), `sys.exit` with a clear message: "model has no logits head; retrain with §2.1".

### 3.2 Temperature on logits, fail on bound-hit
```python
def fit_temperature(Z, y):
    from scipy.optimize import minimize_scalar
    def nll(u):
        T = np.exp(u)
        s = Z / T
        lse = np.log(np.exp(s - s.max(1, keepdims=True)).sum(1)) + s.max(1)
        return float(np.mean(lse - s[np.arange(len(y)), y]))
    r = minimize_scalar(nll, bounds=(np.log(0.05), np.log(20.0)), method="bounded")
    T = float(np.exp(r.x))
    warn = None
    if T <= 0.06 or T >= 19.0:        # saturated => model broken, not a calibration result
        warn = f"temperature hit bound (T={T:.3f}); model likely collapsed — calibration not trusted"
        T = 1.0
    return T, warn
```

### 3.3 Calibrated probs, energy, entropy
```python
def softmax_T(Z, T):
    s = Z / T; s -= s.max(1, keepdims=True); e = np.exp(s); return e / e.sum(1, keepdims=True)
def energy(Z, T):                    # higher = more OOD
    s = Z / T; lse = np.log(np.exp(s - s.max(1,keepdims=True)).sum(1)) + s.max(1)
    return -T * lse
```
- `cal = softmax_T(Z, T)`
- `entropies = -sum(cal*log cal, axis=1)`; `entropy_threshold = percentile(entropies, 95)`
- `energies = energy(Z, T)`; `energy_threshold = percentile(energies, 95)`

### 3.4 Per-class thresholds — precision-constrained, blocking classes only
For `cls in BLOCKING_CLASSES` (drainage, potholes, streetlight; **skip `others`**):
sweep candidate thresholds `t` over `np.unique(cal[:, i])`; pick the smallest `t` with `precision(t) >= PRECISION_MIN(0.70)` AND `recall(t) >= RECALL_MIN(0.85)`, where precision/recall computed over the FULL val set (off-class included) using `predicted = cal[:,i] >= t`. If none satisfies both: set `thresholds[cls] = 0.50` and `reliable[cls] = false`; else `reliable[cls] = true`. Drop `OTHERS_MAX_THRESHOLD`/`DRAINAGE_MIN_THRESHOLD` hacks entirely.

### 3.5 Calibration gate
If `baseline_macro_f1 < ADVISORY_MACRO_F1 (0.55)`: still write the file but set every `reliable[*]=false` and add top-level `"calibration_warning": "model below macro-F1 floor; thresholds advisory only"`. Compute `baseline_macro_f1` with sklearn over argmax of uncalibrated probs.

### 3.6 Exact `civic_thresholds.json` schema (CONTRACT — server.js reads this)
```json
{
  "schema_version": 2,
  "model_backbone": "EfficientNetB0",
  "class_order": ["drainage", "others", "potholes", "streetlight"],
  "temperature": 1.83,
  "calibration_warning": null,
  "val_accuracy_uncalibrated": 0.81,
  "val_accuracy_calibrated": 0.81,
  "val_macro_f1": 0.78,
  "thresholds": { "drainage": 0.41, "potholes": 0.47, "streetlight": 0.44 },
  "reliable":   { "drainage": true, "potholes": true, "streetlight": true },
  "ood": {
    "method": "energy",
    "temperature": 1.83,
    "energy_threshold": -4.21,
    "entropy_threshold": 0.92,
    "percentile": 95,
    "energy_in_dist_mean": -6.10,
    "energy_in_dist_std": 1.04,
    "entropy_in_dist_mean": 0.40,
    "entropy_in_dist_max": 1.21
  },
  "per_class_metrics": {
    "drainage":    { "threshold": 0.41, "precision": 0.74, "recall": 0.88, "f1": 0.80, "n_samples": 380 },
    "potholes":    { "threshold": 0.47, "precision": 0.79, "recall": 0.86, "f1": 0.82, "n_samples": 430 },
    "streetlight": { "threshold": 0.44, "precision": 0.81, "recall": 0.87, "f1": 0.84, "n_samples": 420 }
  },
  "expected_probs": { "fixture": "civic_fixture.jpg", "probs": [0.05, 0.10, 0.80, 0.05] }
}
```
Notes for compatibility with current server `loadThresholds()`:
- `thresholds` MUST NOT contain `others` (server merges over `DEFAULT_THRESHOLDS` which already has `others:0.30`; Others never blocks anyway).
- `ood.method="energy"`, `ood.temperature`, `ood.energy_threshold`, `ood.entropy_threshold` MUST all be present so the server energy path activates when logits exist.
- `expected_probs` is OPTIONAL; if you emit it, also commit `civic_fixture.jpg` (one in-distribution image) so server can self-test (§6.2). If omitted, server skips the self-test.

---

## 4. DATA CLEANER — NEW `clean_dataset_contamination.py` (owner: clean_dataset_contamination.py)

Embedding-outlier detector. **Runs BEFORE training.** Default = dry-run (report only). Moves (never deletes) flagged files only with `--apply`.

### 4.1 CLI
```
python clean_dataset_contamination.py
    [--classes drainage,potholes,streetlight]   # default: all of BLOCKING_CLASSES
    [--margin 0.05]        # flag if (own_sim - best_other_sim) < margin
    [--std-k 2.0]          # flag if own_sim < (class_mean - std_k*class_std)
    [--report clean_report.csv]
    [--apply]              # MOVE flagged files to my_dataset/_quarantine/<class>/
    [--model clip]         # clip (default, openai/clip-vit-base-patch32) | efficientnet (penultimate features)
```

### 4.2 Algorithm
1. Embed every image in each target class folder with CLIP image encoder (`openai/clip-vit-base-patch32` via `transformers`/`open_clip`, L2-normalized 512-dim). (efficientnet mode = penultimate GAP features from `civic_model.keras`.)
2. Per class, compute the **trusted-subset centroid**: prefer files whose name starts with a trusted prefix (`drain_*` for drainage; `kg_*`/`kag_*` for potholes/streetlight). If no trusted prefix exists, use all files (and note `trusted_n` in the report header).
3. Also embed canonical **text prompts** per class (e.g. drainage: `"a photo of a blocked drain, sewer, manhole, or gutter overflow"`; potholes: `"a photo of a pothole or crater in a road"`; streetlight: `"a photo of a broken or non-working street light or lamp post"`).
4. For each image compute: `own_sim` = cosine to own centroid; `best_other_sim` = max cosine to any other class centroid; `nearest_class` = argmax over all centroids; `text_nearest` = argmax over text prompts.
5. **Flag** if ANY: `nearest_class != folder` OR `(own_sim - best_other_sim) < margin` OR `own_sim < class_mean - std_k*class_std` OR `text_nearest != folder`.

### 4.3 Output CSV `clean_report.csv`
Columns (exact order):
```
path,folder,nearest_class,text_nearest,own_sim,best_other_sim,margin,flag_reason
```
`flag_reason` ∈ `{nearest_mismatch, low_margin, outlier_lowsim, text_mismatch}` (join multiple with `|`). Print a per-class summary (total, flagged, %).

### 4.4 Move semantics
With `--apply`: for each flagged file, `shutil.move(path, my_dataset/_quarantine/<folder>/<filename>)` (create dir; on name clash append `_1`, `_2`). Without `--apply`: print "DRY RUN — N files would be quarantined" and write the CSV only. `_quarantine/` is excluded from training automatically because it is not under a `CLASS_ORDER` folder. Never delete.

---

## 5. OTHERS OPEN-SET via CLIP

### 5a. Offline builder — NEW `build_others_exemplars.py` (owner: build_others_exemplars.py)
Python, `transformers` CLIP `openai/clip-vit-base-patch32` (weight-compatible with Node `Xenova/clip-vit-base-patch32`). Builds per-category exemplars from `my_dataset/<cat>/` plus an optional `internet_images/<cat>/` folder.

CLI:
```
python build_others_exemplars.py
    [--dataset my_dataset] [--extra internet_images]
    [--top-k 16]            # image exemplars kept per category
    [--out civic_exemplars.json]
```

Categories = the 3 known civic classes PLUS the `Others` sub-types (drawn from server's existing Others vocabulary): `drainage, potholes, streetlight, garbage, graffiti, tree, encroachment, stray_animal, waterlogging, footpath, noise, public_property`. Each category needs a source folder (under `--dataset` or `--extra`) and a text prompt list.

For each category: L2-normalize all image embeddings; `centroid` = normalized mean; `image_exemplars` = top-K closest-to-centroid vectors; `text_prompts` = list of `{text, vector}`.

**Exact `civic_exemplars.json` schema (CONTRACT — others_clip.js reads this):**
```json
{
  "model_id": "Xenova/clip-vit-base-patch32",
  "embedding_dim": 512,
  "normalized": true,
  "ood_floor": 0.22,
  "categories": ["drainage","potholes","streetlight","garbage","graffiti","tree","encroachment","stray_animal","waterlogging","footpath","noise","public_property"],
  "category_to_civic": {
    "drainage": "Drainage problem", "potholes": "Potholes", "streetlight": "Broken street light problem",
    "garbage": "Others", "graffiti": "Others", "tree": "Others", "encroachment": "Others",
    "stray_animal": "Others", "waterlogging": "Others", "footpath": "Others",
    "noise": "Others", "public_property": "Others"
  },
  "exemplars": {
    "drainage": {
      "n_images": 412,
      "centroid": [0.013, -0.041, "... 512 floats ..."],
      "text_prompts": [ { "text": "a photo of a blocked drain or sewer overflow", "vector": ["... 512 ..."] } ],
      "image_exemplars": [ ["... 512 ..."], ["... 512 ..."] ]
    }
  }
}
```
All vectors L2-normalized, length exactly 512, plain JSON arrays of floats. Write atomically.

### 5b. Node runtime — NEW `others_clip.js` (owner: others_clip.js)
Pure-JS / WASM via `@xenova/transformers`. No native deps. Fail-open everywhere.

**Exported API (CONTRACT — server.js calls exactly this):**
```js
// others_clip.js
module.exports = { load, classifyOthers, isReady };

// Lazy-loads Xenova/clip-vit-base-patch32 (vision+text) and civic_exemplars.json.
// Returns true on success, false on any failure (server treats false as "CLIP disabled").
async function load(): Promise<boolean>

function isReady(): boolean

// imageBase64: data-URI or raw base64 (may be null). title: string (may be "").
// Returns null on any failure (fail-open). Never throws.
async function classifyOthers({ imageBase64, title }): Promise<null | {
  suggestedClass:   string | null,   // human civic label, e.g. "Drainage problem" or "Others"
  suggestedSubtype: string | null,   // exemplar category key, e.g. "garbage"
  scores:           { [category: string]: number },  // fused cosine sim per category, 0..1
  isCivic:          boolean,         // bestFused >= CLIP_OOD_FLOOR (0.22)
  oodScore:         number,          // bestFused similarity
  textScores:       { [category: string]: number },
  imageScores:      { [category: string]: number }
}>
```

**Behavior:**
- `load()`: `pipeline`/`AutoModel` for CLIP. Set `env.allowLocalModels`/cache as needed; cache model under `backend/.cache`. Read `civic_exemplars.json`; if missing → return false. Assert `embedding_dim===512`.
- Embedding: text via CLIP text encoder; image via CLIP vision encoder; L2-normalize both.
- **Decode path (own, not server's):** decode `imageBase64` with `jpeg-js` (already a dependency) to RGBA → build `new RawImage(rgbaUint8, width, height, 4)` from `@xenova/transformers`, call `.rgb()`, then the CLIP image processor. Do NOT depend on server.js `decodeImageToTensor` (that returns a tf tensor, incompatible). If decode fails → treat image as absent (text-only).
- **Per category score:** `imageSim[c]` = max cosine( imgVec, {centroid ∪ image_exemplars} ); `textSim[c]` = max cosine( titleVec, text_prompts[c] ).
- **Fusion:** if both image and title present: `fused = 0.5*imageSim + 0.5*textSim`. If only title: `fused = textSim`. If only image: `fused = imageSim`.
- `suggestedSubtype = argmax_c fused`; `suggestedClass = category_to_civic[suggestedSubtype]`; `oodScore = max fused`; `isCivic = oodScore >= ood_floor`.
- Wrap everything in try/catch → return `null` on failure.

---

## 6. SERVER.JS INTEGRATION (owner: server.js)

### 6.1 Wiring & boot
- Add `const othersClip = require('./others_clip');` and call `await`-style `othersClip.load()` inside `app.listen` callback (after `loadCivicModel()`), logging readiness. Non-blocking; never crash boot.
- Add module-scope `let ADVISORY_MODE = false;`.

### 6.2 Load-time integrity + self-test (in `loadCivicModel` / `loadThresholds`)
After thresholds load, read `civic_thresholds.json`:
- If `val_macro_f1 < ADVISORY_MACRO_F1 (0.55)` OR `calibration_warning` set → `ADVISORY_MODE = true` and log a loud warning.
- Detect logits head: after warm-up predict on the dummy, if `Array.isArray(output)` and length≥2 → `HAS_LOGITS = true`. Store module-scope `HAS_LOGITS`.
- If `expected_probs` present and `civic_fixture.jpg` exists: classify it; if max abs diff to `expected_probs.probs` > 0.05 → log ERROR and set `ADVISORY_MODE = true` (preprocessing/model skew tripwire). If fixture absent, skip silently.

### 6.3 `classifyCivicImage` — apply calibration
After obtaining `logitsArr`/`probsArr`: if `logitsArr` present and `OOD_CONFIG.temperature` set, compute calibrated probs `softmax(logits / T)` and return THOSE as `classProbs` (also return `rawProbs` and `logits`). If no logits, return raw softmax as before. Return shape becomes `{ classProbs, rawProbs, logits }`. Thresholds in `decideBlock` are thus enforced on calibrated probs, matching §3.

### 6.4 `decideBlock` changes
- Keep RULE 0 (OOD energy/entropy), RULE 1 (low confidence), RULE 2 (class-aware margin).
- **DELETE RULE 3** (`category_dominance`, L511-525) — dead/subsumed by RULE 2 (0.15 > 0.12).
- `isOutOfDistribution` already prefers energy when `OOD_CONFIG.method==='energy' && logits && energy_threshold!=null`; with §3 output this now activates. No code change needed there beyond §6.2 wiring.
- Honor `reliable`: load `RELIABLE` from `civic_thresholds.json`. In `decideBlock`, if `RELIABLE[declaredClass] === false`, force `block:false` (advisory) — that class is not trustworthy enough to reject citizens.
- If `ADVISORY_MODE`, `decideBlock` returns `block:false` for ALL paths (compute reason/suggestion as advisory only).

### 6.5 Others routing — CLIP authoritative, never block
In `POST /api/complaints`, the `type === 'Others'` branch (L837-939):
- **Always `openSet = true` for Others. Others is NEVER hard-blocked** (remove the `validationType` reassignment to Potholes/Drainage/Streetlight that could feed a blocking decision).
- Call `const clip = await othersClip.classifyOthers({ imageBase64: activeImage, title });` when `othersClip.isReady()`.
  - If `clip` non-null: set advisory note from `clip.suggestedClass` and `clip.isCivic`:
    - `isCivic && suggestedClass!=='Others'` → note: `Looks closest to "<suggestedClass>" (sim X.XX) — you may want to re-categorize.`
    - `isCivic && suggestedClass==='Others'` → note: `Recognized as a "<suggestedSubtype>" issue.`
    - `!isCivic` → note: `Accepted as a novel/open-set civic issue.`
  - Store `clip.scores`, `clip.suggestedClass`, `clip.oodScore` on `imageCheck` (new fields `clipScores`, `clipSuggestion`, `clipOodScore`).
- Keyword `TITLE_ROUTES` is retained ONLY as a cheap fallback advisory **when CLIP is unavailable** (`!othersClip.isReady()` or `clip===null`): it may set the advisory suggestion text, but MUST NOT set `openSet=false` and MUST NOT trigger a block. Effectively, for Others, `decideBlock` is always called with `{ openSet: true }` (or skipped entirely) so it can only produce advisory metadata.
- The civic model still runs on the image for advisory `classProbs` display, but its decision is ignored for blocking when `type==='Others'`.

### 6.6 Minor fixes
- 422 block response (L986): change `allScores: classProbs` → `allScores: actualProbs` (use the probability map, not the `{classProbs, logits}` wrapper). Add `logits` as a separate debug field if desired.
- PNG: keep fail-open, but when `isPng` decode fails, set `imageCheck.note = 'png_unvalidated — image not screened by classifier'` (distinct from generic error). (Optional: add `pngjs` decode — not required by this spec.)

### 6.7 `/api/health` additions
Add fields: `model_backbone` (from thresholds JSON or `'EfficientNetB0'`), `has_logits_head: HAS_LOGITS`, `ood_method_active: OOD_CONFIG.method` (effective), `clip_ready: othersClip.isReady()`, `enforce_mode: !ADVISORY_MODE`.

---

## 7. package.json (owner: package.json)
Add to `dependencies`:
```json
"@xenova/transformers": "^2.17.2"
```
(Keep everything else. `jpeg-js` already present and reused by others_clip.js. No native build.) User runs `npm install` per the runbook.

---

## 8. RETRAIN PLAN — `retrain_pipeline.py` + NEW `RUNBOOK.md` (owner: retrain_pipeline.py + RUNBOOK.md)

### 8.1 `retrain_pipeline.py` STEPS (replace the list)
No downloads (user decision). New ordered steps:
```
1  validate_dataset.py                                   # pre-check (corrected [0,255])
2  clean_dataset_contamination.py --apply                # quarantine contaminated images
3  validate_dataset.py                                   # post-clean check
4  train_civic_model.py --batch 16                       # exits non-zero on collapse gate (§2.7)
5  temperature_scaling.py                                # logits calibration + full ood block
6  audit_dataset.py                                      # corrected preprocessing audit (post-train)
7  build_others_exemplars.py                             # CLIP exemplars for Others open-set
```
- Add `--with-download` flag that re-inserts the old download steps before step 2 (off by default).
- **Hard stop on collapse:** if step 4 returns exit code 2, abort the pipeline immediately (do NOT prompt to continue) and print the collapse message. Other failures keep the existing y/N prompt.
- Update the module docstring to reflect the new order.

### 8.2 `RUNBOOK.md` (NEW) — exact ordered commands the USER runs
Include, verbatim:
```bash
# backend/, Node 20 + Python venv active
cd backend

# 0. one-time: install new Node dep (CLIP runtime) and Python deps
npm install
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
Document the **acceptance gate**: do not proceed past step 3 unless it printed a passing macro-F1 and exported TFJS; do not trust step 4 if it printed a `calibration_warning`; `/api/health` must show `enforce_mode: true`, `has_logits_head: true`, `ood_method_active: "energy"`, `clip_ready: true` before the system is considered fixed.

---

## 9. FILE OWNERSHIP TABLE (disjoint — one owner per row)

| # | Owner files (exclusive) | Sections | Must NOT touch |
|---|---|---|---|
| A | `train_civic_model.py` | §1 (train site), §2 | server.js, temperature_scaling.py |
| B | `temperature_scaling.py` | §1 (calib site), §3 | train_civic_model.py, server.js |
| C | `audit_dataset.py` **and** `validate_dataset.py` | §1 (audit/validate sites) | model/training logic |
| D | `clean_dataset_contamination.py` (NEW) | §4 | dataset folders except `_quarantine/` creation |
| E | `build_others_exemplars.py` (NEW) | §5a | Node files |
| F | `others_clip.js` (NEW) | §5b | server.js |
| G | `server.js` | §6 | others_clip.js internals, Python files |
| H | `retrain_pipeline.py` **and** `RUNBOOK.md` (NEW) | §8 | all step-target scripts' internals |
| I | `package.json` | §7 | code files |

**Cross-owner contracts (frozen by this doc, do not renegotiate unilaterally):**
- `civic_thresholds.json` schema → produced by **B**, consumed by **G**. (§3.6)
- `civic_exemplars.json` schema → produced by **E**, consumed by **F**. (§5a)
- `others_clip.js` exported API → implemented by **F**, called by **G**. (§5b)
- Model output names `["logits","probs"]` + 4-class `CLASS_ORDER` → produced by **A**, consumed by **B** and **G**.
- Preprocessing identity `[0,255] RGB bilinear 224` → **A, B, C, G** all identical. (§1)
- `civic_labels.json` / `CLASS_ORDER` order is **unchanged** by everyone.
```
```
