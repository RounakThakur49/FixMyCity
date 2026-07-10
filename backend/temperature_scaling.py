"""temperature_scaling.py -- Post-training confidence calibration (logits-based).

Calibration is performed on the model's RAW LOGITS (the linear pre-softmax head),
NOT on softmax probabilities. The previous version treated softmax outputs as
logits (np.log(probs)/T then re-softmax), which clipped at 1e-7 and is what drove
the degenerate T=10 ceiling on a near-collapsed model. This file fits a single
scalar temperature T on the logits via NLL minimization, and FAILS LOUD if T
saturates an optimizer bound (a sign the underlying model is broken, not a real
calibration result).

It then writes a complete schema-v2 civic_thresholds.json consumed by server.js:
  - temperature (logits scale)
  - ood block with BOTH energy_threshold and entropy_threshold
  - per-class precision-constrained acceptance thresholds for BLOCKING classes
    only (drainage, potholes, streetlight). 'others' is open-set / never blocks.
  - reliable[] flags + calibration_warning gate when the model is below the
    macro-F1 advisory floor.

Handles BOTH model shapes:
  - dual-output head  Model(inputs, [logits, probs])  (output names "logits"/"probs")
  - legacy single-output softmax model (pseudo-logits derived as log(probs);
    temperature scaling is shift-invariant so this is valid, with reduced energy
    fidelity -- a warning is printed).

Preprocessing identity: EfficientNet raw [0,255], bilinear 224 (see IMPLEMENTATION_SPEC §1).

Usage:
  python temperature_scaling.py
  python temperature_scaling.py --val-split 0.25       # must match training split
  python temperature_scaling.py --target-recall 0.92   # accepted for CLI compat

Output:
  civic_thresholds.json -- schema v2, read by server.js loadThresholds().
"""
import json
import os
import sys
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "my_dataset"
MODEL_PATH = ROOT / "civic_model.keras"
LABELS_PATH = ROOT / "civic_labels.json"
THRESHOLDS_PATH = ROOT / "civic_thresholds.json"
IMG_SIZE = (224, 224)

# ---------------------------------------------------------------------------
# SHARED CONSTANTS (IMPLEMENTATION_SPEC §0 -- hard contract, keep identical
# across files). No shared module by design; each owner hard-codes these.
# ---------------------------------------------------------------------------
CLASS_ORDER = ["drainage", "others", "potholes", "streetlight"]   # index 0..3, UNCHANGED
BLOCKING_CLASSES = ["drainage", "potholes", "streetlight"]        # 'others' NEVER blocks
PRECISION_MIN = 0.70
RECALL_MIN = 0.85
ADVISORY_MACRO_F1 = 0.55      # below this -> reliable[*]=false + calibration_warning
OOD_PERCENTILE = 95
try:
    from tensorflow.keras.applications.efficientnet_v2 import preprocess_input as _dummy
    MODEL_BACKBONE = "EfficientNetV2S"
except ImportError:
    MODEL_BACKBONE = "EfficientNetB0"
SCHEMA_VERSION = 2

# Temperature optimizer bounds (in log space) and saturation guard.
T_LOG_LO = np.log(0.05)
T_LOG_HI = np.log(20.0)
T_SAT_LO = 0.06
T_SAT_HI = 19.0

# Default safe thresholds if calibration cannot run (server merges over these;
# server already has 'others' default, so 'others' is intentionally absent here).
DEFAULT_THRESHOLDS = {
    "drainage":    0.40,
    "potholes":    0.45,
    "streetlight": 0.40,
}


# ---------------------------------------------------------------------------
# Data loading (preprocessing identity: EfficientNet raw [0,255], bilinear 224)
# ---------------------------------------------------------------------------
def load_val_data(labels, val_split=0.25, batch=32):
    """Load validation set matching training configuration (raw [0,255] RGB)."""
    import tensorflow as tf
    # efficientnet.preprocess_input is a documented NO-OP; normalization is baked
    # inside the Keras EfficientNetB0 graph. Feed raw [0,255]. NEVER /255 or /127.5-1.
    try:
        from tensorflow.keras.applications.efficientnet_v2 import preprocess_input as eff_preprocess
    except ImportError:
        from tensorflow.keras.applications.efficientnet import preprocess_input as eff_preprocess

    val_ds = tf.keras.utils.image_dataset_from_directory(
        DATA_DIR,
        labels="inferred",
        label_mode="int",
        class_names=labels,
        validation_split=val_split,
        subset="validation",
        seed=42,                       # SPEC §0 SEED
        image_size=IMG_SIZE,
        interpolation="bilinear",      # SPEC §1 RESIZE_METHOD
        batch_size=batch,
    )
    AUTOTUNE = tf.data.AUTOTUNE
    val_ds = val_ds.map(
        lambda x, y: (eff_preprocess(x), y),
        num_parallel_calls=AUTOTUNE
    ).prefetch(AUTOTUNE)
    return val_ds


def _softmax_np(z):
    z = np.asarray(z, dtype=np.float64)
    s = z - z.max(axis=1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(axis=1, keepdims=True)


def _pick_softmax_output(outputs):
    """From a list of model outputs, return the one that looks like a softmax
    distribution (rows in [0,1] summing to ~1). Fallback: last output."""
    for out in outputs:
        arr = np.asarray(out)
        if arr.ndim == 2 and arr.min() >= -1e-6 and arr.max() <= 1.0 + 1e-6:
            if np.allclose(arr.sum(axis=1), 1.0, atol=0.05):
                return np.clip(arr, 0.0, 1.0)
    return np.asarray(outputs[-1])


def collect_logits_and_labels(model, val_ds):
    """Collect logits, softmax probs and integer labels from the val set.

    Returns (Z, P, Y, logits_source):
      Z  -> [N, C] logits (real logits head, or pseudo-logits = log(probs))
      P  -> [N, C] uncalibrated softmax probs (for baseline accuracy / macro-F1)
      Y  -> [N]    integer labels
      logits_source -> "head" | "pseudo_log_softmax"
    """
    names = list(getattr(model, "output_names", []) or [])
    has_logits_head = "logits" in names
    li = names.index("logits") if has_logits_head else None
    pi = names.index("probs") if "probs" in names else None

    Z, P, Y = [], [], []
    logits_source = "head" if has_logits_head else "pseudo_log_softmax"

    for x, y in val_ds:
        out = model(x, training=False)
        if isinstance(out, (list, tuple)):
            if has_logits_head:
                z = np.asarray(out[li].numpy() if hasattr(out[li], "numpy") else out[li])
                if pi is not None:
                    p = np.asarray(out[pi].numpy() if hasattr(out[pi], "numpy") else out[pi])
                else:
                    p = _softmax_np(z)
            else:
                # Multi-output but no named logits -> derive pseudo-logits from softmax.
                p = _pick_softmax_output([o.numpy() if hasattr(o, "numpy") else o for o in out])
                z = np.log(np.clip(p, 1e-7, 1.0))
        else:
            # Legacy single-output softmax model.
            p = np.asarray(out.numpy() if hasattr(out, "numpy") else out)
            z = np.log(np.clip(p, 1e-7, 1.0))

        Z.append(np.asarray(z, dtype=np.float64))
        P.append(np.asarray(p, dtype=np.float64))
        Y.append(np.asarray(y.numpy() if hasattr(y, "numpy") else y))

    return (np.concatenate(Z), np.concatenate(P),
            np.concatenate(Y).astype(int), logits_source)


# ---------------------------------------------------------------------------
# Temperature scaling on LOGITS (SPEC §3.2)
# ---------------------------------------------------------------------------
def fit_temperature(Z, y):
    """Fit T = exp(u) minimizing NLL of softmax(Z/T). Fail to T=1.0 on bound-hit."""
    try:
        from scipy.optimize import minimize_scalar
    except ImportError:
        print("  scipy not available -- skipping temperature scaling, using T=1.0")
        return 1.0, "scipy unavailable; temperature not fit (T=1.0)"

    idx = np.arange(len(y))

    def nll(u):
        T = np.exp(u)
        s = Z / T
        m = s.max(axis=1, keepdims=True)
        lse = np.log(np.exp(s - m).sum(axis=1)) + m[:, 0]
        return float(np.mean(lse - s[idx, y]))

    r = minimize_scalar(nll, bounds=(T_LOG_LO, T_LOG_HI), method="bounded")
    T = float(np.exp(r.x))
    warn = None
    if T <= T_SAT_LO or T >= T_SAT_HI:
        warn = (f"temperature hit bound (T={T:.3f}); model likely collapsed "
                f"-- calibration not trusted")
        print(f"  [WARN] {warn}")
        T = 1.0
    print(f"  Temperature T = {T:.4f}  (NLL@T=1: {nll(0.0):.4f}, NLL@T: {nll(np.log(T)):.4f})")
    return T, warn


def softmax_T(Z, T):
    """Calibrated softmax of logits at temperature T."""
    s = Z / T
    s = s - s.max(axis=1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(axis=1, keepdims=True)


def energy(Z, T):
    """Free-energy score (higher == more out-of-distribution)."""
    s = Z / T
    m = s.max(axis=1, keepdims=True)
    lse = np.log(np.exp(s - m).sum(axis=1)) + m[:, 0]
    return -T * lse


def entropy_of(probs):
    p = np.clip(probs, 1e-12, 1.0)
    return -np.sum(p * np.log(p), axis=1)


# ---------------------------------------------------------------------------
# Per-class precision-constrained thresholds, BLOCKING classes only (SPEC §3.4)
# ---------------------------------------------------------------------------
def select_class_threshold(cal, labels, i, precision_min, recall_min):
    """Smallest threshold t s.t. precision(t) >= precision_min AND recall(t) >= recall_min,
    computed over the FULL val set with predicted = cal[:, i] >= t.

    Returns (threshold, precision, recall, f1, n_pos, reliable).
    """
    pos = labels == i
    n_pos = int(pos.sum())

    def metrics_at(t):
        pred = cal[:, i] >= t
        tp = int(np.sum(pred & pos))
        fp = int(np.sum(pred & ~pos))
        fn = int(np.sum(~pred & pos))
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        return prec, rec, f1

    # np.unique returns ascending; first satisfying candidate is the smallest t.
    for t in np.unique(cal[:, i]):
        prec, rec, f1 = metrics_at(float(t))
        if prec >= precision_min and rec >= recall_min:
            return float(t), prec, rec, f1, n_pos, True

    # No threshold satisfies both -> not reliable; report metrics at the 0.50 default.
    prec, rec, f1 = metrics_at(0.50)
    return 0.50, prec, rec, f1, n_pos, False


def _macro_f1(y_true, y_pred, n_classes):
    try:
        from sklearn.metrics import f1_score
        return float(f1_score(y_true, y_pred, average="macro",
                              labels=list(range(n_classes)), zero_division=0))
    except Exception:
        f1s = []
        for c in range(n_classes):
            tp = int(np.sum((y_pred == c) & (y_true == c)))
            fp = int(np.sum((y_pred == c) & (y_true != c)))
            fn = int(np.sum((y_pred != c) & (y_true == c)))
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1s.append(2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0)
        return float(np.mean(f1s))


def _write_json_atomic(path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2))
    tmp.replace(path)


def _write_fallback(message):
    """Write a minimal but schema-v2-valid file so server.js can always load."""
    out = {
        "schema_version": SCHEMA_VERSION,
        "model_backbone": MODEL_BACKBONE,
        "class_order": CLASS_ORDER,
        "temperature": 1.0,
        "calibration_warning": message,
        "val_accuracy_uncalibrated": None,
        "val_accuracy_calibrated": None,
        "val_macro_f1": None,
        "thresholds": dict(DEFAULT_THRESHOLDS),
        "reliable": {c: False for c in BLOCKING_CLASSES},
        "ood": {
            "method": "energy",
            "temperature": 1.0,
            "energy_threshold": None,
            "entropy_threshold": None,
            "percentile": OOD_PERCENTILE,
        },
        "per_class_metrics": {},
    }
    _write_json_atomic(THRESHOLDS_PATH, out)
    print(f"   Written fallback thresholds to {THRESHOLDS_PATH}")


# ---------------------------------------------------------------------------
def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--val-split", type=float, default=0.25,
                    help="Validation split (must match training, default: 0.25)")
    ap.add_argument("--target-recall", type=float, default=0.92,
                    help="Accepted for CLI compat; thresholds are precision-constrained "
                         "(PRECISION_MIN=0.70, RECALL_MIN=0.85).")
    ap.add_argument("--ood-percentile", type=float, default=float(OOD_PERCENTILE),
                    help="Percentile of in-distribution scores for OOD thresholds (default: 95)")
    args = ap.parse_args()

    print("[preprocess] EfficientNet raw [0,255], bilinear 224")

    if not MODEL_PATH.exists():
        print(f"[ERR] Model not found: {MODEL_PATH}")
        print("   Run train_civic_model.py first.")
        _write_fallback("model not found; thresholds advisory only")
        sys.exit(0)

    if not LABELS_PATH.exists():
        print(f"[ERR] Labels not found: {LABELS_PATH}")
        sys.exit(1)

    import tensorflow as tf
    labels = json.loads(LABELS_PATH.read_text())
    print(f"Classes: {labels}")
    if labels != CLASS_ORDER:
        print(f"[WARN] civic_labels.json order {labels} != frozen CLASS_ORDER "
              f"{CLASS_ORDER}; using file order for indexing.")
    n_classes = len(labels)

    print("\nLoading model...")
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)

    print("Loading validation data...")
    val_ds = load_val_data(labels, val_split=args.val_split)

    print("Running inference on validation set (collecting logits)...")
    Z, P, y, logits_source = collect_logits_and_labels(model, val_ds)
    print(f"  Collected {len(Z)} validation samples (logits_source={logits_source})")
    if logits_source != "head":
        print("  [WARN] No 'logits' output head found -- using pseudo-logits = log(probs). "
              "Temperature scaling remains valid (shift-invariant), but energy-OOD "
              "fidelity is reduced. Retrain with the dual-output head (SPEC §2.1) for "
              "a true logits path.")

    # Baseline (uncalibrated) accuracy + macro-F1 -- argmax is unchanged by T.
    pred = np.argmax(P, axis=1)
    baseline_acc = float(np.mean(pred == y))
    baseline_macro_f1 = _macro_f1(y, pred, n_classes)
    print(f"\nBaseline val accuracy   (T=1.0): {baseline_acc:.4f}")
    print(f"Baseline val macro-F1   (T=1.0): {baseline_macro_f1:.4f}")

    # Temperature scaling on logits.
    print("\nFitting temperature scalar on logits...")
    T, temp_warn = fit_temperature(Z, y)

    cal = softmax_T(Z, T)
    cal_pred = np.argmax(cal, axis=1)
    cal_acc = float(np.mean(cal_pred == y))
    print(f"Calibrated val accuracy (T={T:.4f}): {cal_acc:.4f}")

    # OOD thresholds: BOTH energy and entropy at the chosen percentile.
    pct = int(args.ood_percentile)
    energies = energy(Z, T)
    entropies = entropy_of(cal)
    energy_threshold = float(np.percentile(energies, pct))
    entropy_threshold = float(np.percentile(entropies, pct))
    print(f"\nOOD thresholds (p{pct}):")
    print(f"  energy_threshold  = {energy_threshold:.6f}  "
          f"(mean={float(np.mean(energies)):.4f}, std={float(np.std(energies)):.4f})")
    print(f"  entropy_threshold = {entropy_threshold:.6f}  "
          f"(mean={float(np.mean(entropies)):.4f}, max={float(np.max(entropies)):.4f})")

    # Per-class precision-constrained thresholds (BLOCKING classes only).
    print(f"\nComputing per-class thresholds "
          f"(precision>={PRECISION_MIN}, recall>={RECALL_MIN}) for blocking classes...")
    thresholds = {}
    reliable = {}
    per_class_metrics = {}
    for cls in BLOCKING_CLASSES:
        i = labels.index(cls)
        t, prec, rec, f1, n_pos, ok = select_class_threshold(
            cal, y, i, PRECISION_MIN, RECALL_MIN)
        thresholds[cls] = round(t, 3)
        reliable[cls] = bool(ok)
        per_class_metrics[cls] = {
            "threshold": round(t, 3),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "n_samples": int(n_pos),
        }
        flag = "" if ok else "  [UNRELIABLE -> advisory only]"
        print(f"  {cls}: threshold={t:.3f} | precision={prec:.3f} | "
              f"recall={rec:.3f} | F1={f1:.3f} | n_true={n_pos}{flag}")

    # Calibration gate (SPEC §3.5): below macro-F1 floor -> advisory, all unreliable.
    calibration_warning = None
    if baseline_macro_f1 < ADVISORY_MACRO_F1:
        calibration_warning = "model below macro-F1 floor; thresholds advisory only"
        for cls in reliable:
            reliable[cls] = False
        print(f"\n[GATE] baseline macro-F1 {baseline_macro_f1:.3f} < "
              f"{ADVISORY_MACRO_F1} -> all classes marked UNRELIABLE (advisory).")
    elif temp_warn is not None:
        # Temperature saturated (model broken) even if macro-F1 nominally passed.
        calibration_warning = temp_warn
        for cls in reliable:
            reliable[cls] = False
        print(f"\n[GATE] {temp_warn} -> all classes marked UNRELIABLE (advisory).")

    output = {
        "schema_version": SCHEMA_VERSION,
        "model_backbone": MODEL_BACKBONE,
        "class_order": labels,
        "temperature": round(T, 4),
        "calibration_warning": calibration_warning,
        "val_accuracy_uncalibrated": round(baseline_acc, 4),
        "val_accuracy_calibrated": round(cal_acc, 4),
        "val_macro_f1": round(baseline_macro_f1, 4),
        "logits_source": logits_source,
        "thresholds": thresholds,          # blocking classes only; NO 'others'
        "reliable": reliable,
        "ood": {
            "method": "energy",
            "temperature": round(T, 4),
            "energy_threshold": round(energy_threshold, 6),
            "entropy_threshold": round(entropy_threshold, 6),
            "percentile": pct,
            "energy_in_dist_mean": round(float(np.mean(energies)), 6),
            "energy_in_dist_std": round(float(np.std(energies)), 6),
            "entropy_in_dist_mean": round(float(np.mean(entropies)), 6),
            "entropy_in_dist_max": round(float(np.max(entropies)), 6),
        },
        "per_class_metrics": per_class_metrics,
    }

    _write_json_atomic(THRESHOLDS_PATH, output)
    print(f"\n[OK] Saved thresholds to {THRESHOLDS_PATH}")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
