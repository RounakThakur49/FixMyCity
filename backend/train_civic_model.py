"""
train_civic_model.py  — FixMyCity 4-class civic image classifier (v3)
=======================================================================

Changes from v2 (EfficientNetB0-based):
  - Backbone: EfficientNetV2S (with fallback to EfficientNetB0 for older TF)
  - CutMix augmentation (50/50 mix with Mixup)
  - RandomTranslation(0.1, 0.1) added to augmentation pipeline
  - Drainage class weight boost (x1.5) and image oversampling in Stage 1 (--drainage-boost)
  - Stronger head: Dropout 0.5 after first Dense, extra Dense(256, swish)
  - Stage 1: 30 epochs, LR=1e-3, patience=8
  - Stage 2: 25 epochs, unfreeze top 60 layers, cosine LR from 3e-5, patience=8
  - Stage 3: 15 epochs, full fine-tune, LR=5e-6, patience=6
  - Tracks best val_acc across ALL stages; copies best checkpoint to civic_model.keras
  - sklearn classification report at end
  - All existing: FocalLoss, Mixup, class weights, confusion matrix, TFJS export

Stage 1: Freeze entire backbone, train head 30 epochs.
Stage 2: Unfreeze top 60 layers, cosine LR from 3e-5, 25 epochs.
Stage 3: Full unfreeze, LR=5e-6, 15 epochs -- optional.
Export: TFJS GraphModel (float16 quantized) to civic_model_tfjs/.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import os
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, optimizers, callbacks, losses

# ---------------------------------------------------------------------------
# Backbone selection: EfficientNetV2S first, fallback to EfficientNetB0
# ---------------------------------------------------------------------------
try:
    from tensorflow.keras.applications import EfficientNetV2S
    from tensorflow.keras.applications.efficientnet_v2 import preprocess_input as eff_preprocess
    BACKBONE_NAME = 'EfficientNetV2S'
except ImportError:
    from tensorflow.keras.applications import EfficientNetB0
    from tensorflow.keras.applications.efficientnet import preprocess_input as eff_preprocess
    BACKBONE_NAME = 'EfficientNetB0'

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "my_dataset"
OUT_KERAS = ROOT / "civic_model.keras"
OUT_SAVED_MODEL = ROOT / "civic_saved_model"
OUT_TFJS = ROOT / "civic_model_tfjs"
LABELS_JSON = ROOT / "civic_labels.json"
HISTORY_JSON = ROOT / "training_history.json"
CONFUSION_JSON = ROOT / "training_confusion.json"

IMG = 224
# Alphabetical order matches tf.keras.utils.image_dataset_from_directory default
CLASSES = ["drainage", "others", "potholes", "streetlight"]

# ---------------------------------------------------------------------------
# SHARED CONSTANTS (IMPLEMENTATION_SPEC.md §0 — frozen, copy-verbatim values).
# These MUST match temperature_scaling.py / server.js exactly.
# ---------------------------------------------------------------------------
VAL_SPLIT            = 0.25     # image_dataset_from_directory split, seed=42
SEED                 = 42
MIX_PROB             = 0.40     # fraction of Stage-2 batches that get mixup/cutmix
FOCAL_GAMMA          = 1.5
LABEL_SMOOTHING      = 0.0
DRAINAGE_ALPHA_BOOST = 1.5      # drainage emphasis, folded into focal alpha ONLY
ACCEPT_MACRO_F1      = 0.55     # anti-collapse export gate
MIN_PER_CLASS_RECALL = 0.05     # anti-collapse export gate

# Preprocessing identity (§1) — print at startup so train/infer/audit skew can
# never recur silently. EfficientNet: raw [0,255] RGB, bilinear 224, NO external
# normalization (Rescaling/Normalization is baked inside the Keras graph).
print("[preprocess] EfficientNet raw [0,255], bilinear 224")


# ---------------------------------------------------------------------------
# Dataset utilities
# ---------------------------------------------------------------------------

def get_class_counts():
    """Count images per class."""
    counts = {}
    for c in CLASSES:
        d = DATA_DIR / c
        n = 0
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG"):
            n += len(list(d.glob(ext))) if d.exists() else 0
        counts[c] = n
    return counts


def compute_class_weights(counts, drainage_boost=True):
    """Balanced inverse-frequency class weights, with optional drainage boost."""
    total = sum(counts.values())
    n_classes = len(counts)
    weights = {}
    for i, c in enumerate(CLASSES):
        count = counts[c]
        weights[i] = (total / (n_classes * count)) if count > 0 else 1.0
    if drainage_boost:
        weights[0] *= DRAINAGE_ALPHA_BOOST  # index 0 = drainage; ONLY drainage emphasis (folded into focal alpha)
        print(f"  [drainage-boost] Drainage weight boosted x{DRAINAGE_ALPHA_BOOST}")
    return weights


# ---------------------------------------------------------------------------
# Augmentation layers
# ---------------------------------------------------------------------------

def build_augmentation_pipeline():
    """Strong augmentation simulating real citizen phone-captured photos."""
    return tf.keras.Sequential([
        layers.RandomFlip("horizontal_and_vertical"),
        layers.RandomRotation(0.20),
        layers.RandomZoom(0.20),
        layers.RandomTranslation(0.1, 0.1),
        layers.RandomBrightness(0.25),
        layers.RandomContrast(0.25),
        # Saturation jitter (via random hue ≈ saturation shift)
        layers.Lambda(
            lambda x: tf.image.random_saturation(x, 0.6, 1.4),
            name="random_saturation"
        ),
        layers.Lambda(
            lambda x: tf.image.random_hue(x, 0.05),
            name="random_hue"
        ),
        # Gaussian noise layer (simulate compression artifacts in phone photos).
        # In Keras 3, stddev must be <= 1.0. For [0,255] scale, 1.0 is very mild.
        layers.GaussianNoise(1.0),
    ], name="augmentation")


def mixup(x, y, alpha=0.2):
    """Mixup augmentation: interpolate between pairs of images/labels."""
    batch_size = tf.shape(x)[0]
    lam = tf.clip_by_value(
        tf.random.uniform([batch_size], minval=alpha, maxval=1.0 - alpha),
        alpha, 1.0 - alpha
    )
    lam = tf.reshape(lam, [batch_size, 1, 1, 1])  # broadcast over H, W, C

    # Shuffle the batch
    indices = tf.random.shuffle(tf.range(batch_size))
    x_shuffled = tf.gather(x, indices)
    y_shuffled = tf.gather(y, indices)

    # Mix
    x_mixed = lam * x + (1.0 - lam) * x_shuffled
    lam_1d = tf.reshape(lam, [batch_size])
    y_one_hot = tf.one_hot(y, len(CLASSES))
    y_shuffled_one_hot = tf.one_hot(y_shuffled, len(CLASSES))
    y_mixed = lam_1d[:, tf.newaxis] * y_one_hot + (1.0 - lam_1d[:, tf.newaxis]) * y_shuffled_one_hot

    return x_mixed, y_mixed


def cutmix(x, y, alpha=1.0):
    """CutMix: cut a random rectangle from one image and paste into another."""
    batch_size = tf.shape(x)[0]
    # Sample lambda from uniform (Beta(alpha, alpha) approximation)
    lam = tf.random.uniform([], minval=0.3, maxval=0.7)

    # Random bounding box
    h = tf.shape(x)[1]
    w = tf.shape(x)[2]
    cut_h = tf.cast(tf.math.sqrt(1.0 - lam) * tf.cast(h, tf.float32), tf.int32)
    cut_w = tf.cast(tf.math.sqrt(1.0 - lam) * tf.cast(w, tf.float32), tf.int32)
    cx = tf.random.uniform([], 0, w, dtype=tf.int32)
    cy = tf.random.uniform([], 0, h, dtype=tf.int32)
    x1 = tf.clip_by_value(cx - cut_w // 2, 0, w)
    y1 = tf.clip_by_value(cy - cut_h // 2, 0, h)
    x2 = tf.clip_by_value(cx + cut_w // 2, 0, w)
    y2 = tf.clip_by_value(cy + cut_h // 2, 0, h)

    # Shuffle batch
    indices = tf.random.shuffle(tf.range(batch_size))
    x_shuffled = tf.gather(x, indices)
    y_shuffled = tf.gather(y, indices)

    # Create mask
    mask = tf.pad(
        tf.ones([y2 - y1, x2 - x1, 3]),
        [[y1, h - y2], [x1, w - x2], [0, 0]]
    )
    x_mixed = x * (1 - mask) + x_shuffled * mask

    # Compute actual lambda from box area
    actual_lam = 1.0 - tf.cast((y2 - y1) * (x2 - x1), tf.float32) / tf.cast(h * w, tf.float32)

    # Mix labels
    y_one_hot = tf.one_hot(y, len(CLASSES))
    y_shuffled_one_hot = tf.one_hot(y_shuffled, len(CLASSES))
    y_mixed = actual_lam * y_one_hot + (1.0 - actual_lam) * y_shuffled_one_hot

    return x_mixed, y_mixed


# ---------------------------------------------------------------------------
# Dataset builder
# ---------------------------------------------------------------------------

def build_datasets(batch, val_split=0.25):
    """Build augmented training and validation datasets."""
    common_kwargs = dict(
        labels="inferred",
        label_mode="int",
        class_names=CLASSES,
        validation_split=val_split,
        seed=42,
        image_size=(IMG, IMG),
        batch_size=batch,
    )
    train_raw = tf.keras.utils.image_dataset_from_directory(
        DATA_DIR, subset="training", **common_kwargs
    )
    val_raw = tf.keras.utils.image_dataset_from_directory(
        DATA_DIR, subset="validation", **common_kwargs
    )

    aug = build_augmentation_pipeline()
    AUTOTUNE = tf.data.AUTOTUNE

    def preprocess_train(x, y):
        x_aug = aug(x, training=True)
        x_pre = eff_preprocess(x_aug)  # EfficientNet uses [0,255] -> scaled internally
        return x_pre, y

    def preprocess_val(x, y):
        return eff_preprocess(x), y

    train = (
        train_raw
        .map(preprocess_train, num_parallel_calls=AUTOTUNE)
        .prefetch(AUTOTUNE)
    )
    val = (
        val_raw
        .map(preprocess_val, num_parallel_calls=AUTOTUNE)
        .prefetch(AUTOTUNE)
    )

    return train, val, train_raw  # train_raw for mixup/cutmix (we need int labels)


def build_drainage_boosted_dataset(batch, val_split=0.25):
    """
    DEAD CODE (§2.5) — NO LONGER CALLED. The old `cardinality()==-2 -> take(1)`
    path made this a no-op (it appended at most 1 sample). Drainage emphasis now
    lives ONLY in the focal-loss alpha (DRAINAGE_ALPHA_BOOST). Kept for reference.

    Build training dataset with drainage images repeated ~1.5x (oversampling).
    """
    aug = build_augmentation_pipeline()
    AUTOTUNE = tf.data.AUTOTUNE
    common_kwargs = dict(
        labels="inferred",
        label_mode="int",
        class_names=CLASSES,
        validation_split=val_split,
        seed=42,
        image_size=(IMG, IMG),
        batch_size=None,  # unbatched for concat
    )

    train_raw_unbatched = tf.keras.utils.image_dataset_from_directory(
        DATA_DIR, subset="training", **common_kwargs
    )

    # Filter drainage (class index 0) and repeat 0.5x extra (50% more)
    drainage_ds = train_raw_unbatched.filter(lambda x, y: tf.equal(y, 0))
    # Take roughly half the drainage samples to append
    drainage_card = tf.data.experimental.cardinality(drainage_ds).numpy()
    drainage_extra = drainage_ds.take(max(1, drainage_card // 2))

    # Concatenate original + extra drainage, shuffle, batch
    combined = train_raw_unbatched.concatenate(drainage_extra).shuffle(
        buffer_size=10000, seed=42
    ).batch(batch)

    def preprocess_train(x, y):
        x_aug = aug(x, training=True)
        x_pre = eff_preprocess(x_aug)
        return x_pre, y

    train_boosted = (
        combined
        .map(preprocess_train, num_parallel_calls=AUTOTUNE)
        .prefetch(AUTOTUNE)
    )
    return train_boosted


# ---------------------------------------------------------------------------
# Model builder
# ---------------------------------------------------------------------------

def build_model():
    """EfficientNet-based classifier with a stronger head."""
    if BACKBONE_NAME == 'EfficientNetV2S':
        base = EfficientNetV2S(
            include_top=False,
            weights="imagenet",
            input_shape=(IMG, IMG, 3),
        )
    else:
        base = EfficientNetB0(
            include_top=False,
            weights="imagenet",
            input_shape=(IMG, IMG, 3),
        )
    base.trainable = False

    inputs = layers.Input(shape=(IMG, IMG, 3))
    # BN stays frozen (training=False) so TFJS pure-JS inference uses stable
    # moving stats; Stage 2/3 also keep BN layers non-trainable (§2.6).
    x = base(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.5)(x)                       # upgraded from 0.4
    x = layers.Dense(512, activation="swish")(x)     # swish is EfficientNet's native activation
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.35)(x)
    x = layers.Dense(256, activation="swish")(x)     # additional Dense(256) layer
    x = layers.Dropout(0.25)(x)
    # Dual-output head (§2.1): raw logits (for calibration downstream) + softmax
    # probs (carries the loss). Output ORDER is [logits, probs]; names are exactly
    # "logits"/"probs" — server.js and temperature_scaling.py key off these names.
    logits = layers.Dense(len(CLASSES), activation=None, name="logits")(x)
    probs  = layers.Activation("softmax", name="probs")(logits)

    return models.Model(inputs, [logits, probs]), base


# ---------------------------------------------------------------------------
# Focal Loss
# ---------------------------------------------------------------------------

class FocalLoss(losses.Loss):
    """
    Focal Loss (Lin et al., 2017) to address class imbalance.

    FL(p_t) = -(1 - p_t)^gamma * log(p_t)

    gamma=0 -- standard cross-entropy
    gamma=2 -- standard focal (down-weights easy examples)

    Applied with label smoothing to prevent overconfidence.
    """
    def __init__(self, gamma=2.0, alpha=None, label_smoothing=0.1, **kwargs):
        super().__init__(**kwargs)
        self.gamma = gamma
        self.alpha = alpha  # per-class weight vector (np array, shape [n_classes])
        self.label_smoothing = label_smoothing

    def call(self, y_true, y_pred):
        # y_true: int labels [batch] OR soft labels [batch, n_classes] (from mixup/cutmix)
        n_classes = y_pred.shape[-1] or len(CLASSES)

        if len(y_true.shape) == 1:
            y_true_oh = tf.one_hot(tf.cast(y_true, tf.int32), n_classes)
        else:
            y_true_oh = tf.cast(y_true, tf.float32)

        # Label smoothing
        if self.label_smoothing > 0:
            y_true_oh = y_true_oh * (1.0 - self.label_smoothing) + (self.label_smoothing / n_classes)

        # Clip predictions
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1.0 - 1e-7)

        # Cross-entropy per class
        ce = -y_true_oh * tf.math.log(y_pred)

        # Focal weight
        p_t = tf.reduce_sum(y_true_oh * y_pred, axis=-1, keepdims=True)
        focal_weight = tf.pow(1.0 - p_t, self.gamma)

        # Apply alpha (class balance weights)
        if self.alpha is not None:
            alpha_t = tf.constant(self.alpha, dtype=tf.float32)
            # alpha_t shape: [n_classes], broadcast over batch
            focal_weight = focal_weight * tf.reduce_sum(y_true_oh * alpha_t, axis=-1, keepdims=True)

        loss = focal_weight * ce
        return tf.reduce_mean(tf.reduce_sum(loss, axis=-1))


def make_focal_loss(class_weights_dict=None, gamma=FOCAL_GAMMA, label_smoothing=LABEL_SMOOTHING):
    """Create FocalLoss with optional class weights."""
    if class_weights_dict:
        alpha = np.array([class_weights_dict[i] for i in range(len(CLASSES))], dtype=np.float32)
        alpha = alpha / alpha.mean()  # mean=1 -> preserve absolute loss scale (§2.4; NOT /alpha.sum())
    else:
        alpha = None
    return FocalLoss(gamma=gamma, alpha=alpha, label_smoothing=label_smoothing)


# ---------------------------------------------------------------------------
# Mixed augmentation (gated Mixup / CutMix) + target/dict helpers + macro-F1
# ---------------------------------------------------------------------------

def apply_mixed_augmentation(x, y, p_mix=MIX_PROB):
    """Gated Mixup/CutMix (§2.3). With prob p_mix apply CutMix or Mixup (soft
    labels [B,C]); otherwise emit clean one-hot [B,C] so the loss path stays
    uniform (FocalLoss always sees [B,C])."""
    if tf.random.uniform([]) < p_mix:
        if tf.random.uniform([]) > 0.5:
            return cutmix(x, y)        # soft labels [B,C]
        return mixup(x, y)             # soft labels [B,C]
    return x, tf.one_hot(tf.cast(y, tf.int32), len(CLASSES))  # clean one-hot [B,C]


def as_targets(x, y):
    """Wrap labels into the dual-output target tuple. y may be int [B] OR soft
    [B,C]; loss/metrics attach to the 'probs' head only (§2.2)."""
    return x, (y, y)


def to_clean_onehot(x, y):
    """Clean one-hot labels for the no-mixing stages (Stage 1 / Stage 3)."""
    return x, tf.one_hot(tf.cast(y, tf.int32), len(CLASSES))


class MacroF1(callbacks.Callback):
    """Per-epoch macro-F1 on a CLEAN int-labelled val set (§2.7). Logged as
    'val_macro_f1' so EarlyStopping/ModelCheckpoint can monitor it. Must be the
    FIRST callback so the metric exists when later callbacks read logs."""
    def __init__(self, val_ds):
        super().__init__()
        self.val_ds = val_ds

    def on_epoch_end(self, epoch, logs=None):
        logs = logs if logs is not None else {}
        from sklearn.metrics import f1_score
        yt, yp = [], []
        for x, y in self.val_ds:                       # val_ds yields (x, int_y)
            p = self.model.predict(x, verbose=0)
            p = p[1] if isinstance(p, (list, tuple)) else p   # probs head
            yt.extend(np.asarray(y).tolist())
            yp.extend(np.argmax(p, 1).tolist())
        f1 = f1_score(yt, yp, average="macro",
                      labels=list(range(len(CLASSES))), zero_division=0)
        logs["val_macro_f1"] = float(f1)
        print(f"  val_macro_f1={f1:.4f}")


# ---------------------------------------------------------------------------
# Training stages
# ---------------------------------------------------------------------------

def stage1_train(model, train, val, epochs, focal_loss, macro_f1_cb,
                 apply_aug=False):
    """Stage 1: Train head only. Backbone fully frozen. 30 epochs, LR=1e-3, patience=8.
    No mixing (clean one-hot) per §2.3 unless apply_aug is explicitly set."""
    print(f"\n  Backbone trainable params: 0 (frozen)")
    model.compile(
        optimizer=optimizers.Adam(1e-3),
        loss=[None, focal_loss],
        metrics=[None, ["accuracy"]],
    )
    cb = [
        macro_f1_cb,                                # FIRST: populates val_macro_f1
        callbacks.EarlyStopping(
            monitor="val_macro_f1", mode="max", patience=8,
            restore_best_weights=True, verbose=1
        ),
        callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=3,
            min_lr=1e-6, verbose=1
        ),
        callbacks.ModelCheckpoint(
            str(ROOT / "civic_model_stage1_best.keras"),
            monitor="val_macro_f1", mode="max", save_best_only=True, verbose=0
        ),
    ]

    if apply_aug:
        train_aug = train.map(apply_mixed_augmentation,
                              num_parallel_calls=tf.data.AUTOTUNE)
    else:
        # Clean one-hot labels (uniform [B,C] loss path).
        train_aug = train.map(to_clean_onehot, num_parallel_calls=tf.data.AUTOTUNE)
    train_aug = train_aug.map(as_targets).prefetch(tf.data.AUTOTUNE)
    # one-hot val labels so the per-output "accuracy" metric stays categorical
    # (uniform [B,C] with train); macro-F1 uses the raw int `val` separately.
    val_mapped = val.map(to_clean_onehot).map(as_targets).prefetch(tf.data.AUTOTUNE)

    hist = model.fit(
        train_aug, validation_data=val_mapped, epochs=epochs, callbacks=cb,
    )
    return hist.history


def stage2_finetune(model, base, train, val, epochs, focal_loss, macro_f1_cb,
                    unfreeze_top=60):
    """Stage 2: Unfreeze top N layers, cosine LR from 3e-5, 25 epochs, patience=8.
    Mixing gated at MIX_PROB (§2.3)."""
    base.trainable = True
    for layer in base.layers[:-unfreeze_top]:
        layer.trainable = False
    # Keep BatchNorm layers frozen to preserve ImageNet statistics (§2.6).
    for layer in base.layers:
        if isinstance(layer, layers.BatchNormalization):
            layer.trainable = False

    trainable_count = sum(1 for l in base.layers if l.trainable)
    print(f"\n  Unfroze top {unfreeze_top} layers ({trainable_count} backbone layers trainable)")

    steps_per_epoch = tf.data.experimental.cardinality(train).numpy()
    total_steps = max(1, steps_per_epoch) * epochs
    lr_schedule = optimizers.schedules.CosineDecay(
        initial_learning_rate=3e-5,
        decay_steps=total_steps,
        alpha=1e-7,
    )

    model.compile(
        optimizer=optimizers.Adam(lr_schedule),
        loss={"logits": None, "probs": focal_loss},
        metrics={"logits": None, "probs": ["accuracy"]},
    )
    cb = [
        macro_f1_cb,
        callbacks.EarlyStopping(
            monitor="val_macro_f1", mode="max", patience=8,
            restore_best_weights=True, verbose=1
        ),
        callbacks.ModelCheckpoint(
            str(ROOT / "civic_model_stage2_best.keras"),
            monitor="val_macro_f1", mode="max", save_best_only=True, verbose=0
        ),
    ]

    # Gated Mixup/CutMix at MIX_PROB (clean one-hot otherwise).
    train_aug = (
        train.map(apply_mixed_augmentation, num_parallel_calls=tf.data.AUTOTUNE)
             .map(as_targets)
             .prefetch(tf.data.AUTOTUNE)
    )
    val_mapped = val.map(to_clean_onehot).map(as_targets).prefetch(tf.data.AUTOTUNE)

    hist = model.fit(
        train_aug, validation_data=val_mapped, epochs=epochs, callbacks=cb,
    )
    return hist.history


def stage3_full_finetune(model, base, train, val, epochs, focal_loss, macro_f1_cb):
    """Stage 3 (optional): Full backbone unfreeze at very low LR. 15 epochs, patience=6.
    No mixing (clean one-hot, sharpen) per §2.3."""
    base.trainable = True
    # Keep BatchNorm frozen (§2.6).
    for layer in base.layers:
        if isinstance(layer, layers.BatchNormalization):
            layer.trainable = False

    print(f"\n  Full backbone unfrozen (BN layers kept frozen)")

    model.compile(
        optimizer=optimizers.Adam(5e-6),
        loss={"logits": None, "probs": focal_loss},
        metrics={"logits": None, "probs": ["accuracy"]},
    )
    cb = [
        macro_f1_cb,
        callbacks.EarlyStopping(
            monitor="val_macro_f1", mode="max", patience=6,
            restore_best_weights=True, verbose=1
        ),
        callbacks.ModelCheckpoint(
            str(ROOT / "civic_model_stage3_best.keras"),
            monitor="val_macro_f1", mode="max", save_best_only=True, verbose=0
        ),
    ]

    # No mixing: clean one-hot labels.
    train_aug = (
        train.map(to_clean_onehot, num_parallel_calls=tf.data.AUTOTUNE)
             .map(as_targets)
             .prefetch(tf.data.AUTOTUNE)
    )
    val_mapped = val.map(to_clean_onehot).map(as_targets).prefetch(tf.data.AUTOTUNE)

    hist = model.fit(
        train_aug, validation_data=val_mapped, epochs=epochs, callbacks=cb,
    )
    return hist.history


# ---------------------------------------------------------------------------
# Per-class confusion matrix + classification report
# ---------------------------------------------------------------------------

def compute_confusion_matrix(model, val):
    """Compute and return per-class confusion matrix on validation set."""
    all_true = []
    all_pred = []
    for x, y in val:
        preds = model.predict(x, verbose=0)
        preds = preds[1] if isinstance(preds, (list, tuple)) else preds  # probs head
        all_true.extend(y.numpy().tolist())
        all_pred.extend(np.argmax(preds, axis=1).tolist())

    n = len(CLASSES)
    matrix = [[0] * n for _ in range(n)]
    for t, p in zip(all_true, all_pred):
        matrix[t][p] += 1

    print("\n=== Confusion Matrix (rows=true, cols=pred) ===")
    header = f"{'':>12}" + "".join(f"{c:>12}" for c in CLASSES)
    print(header)
    for i, row in enumerate(matrix):
        row_str = f"{CLASSES[i]:>12}" + "".join(f"{v:>12}" for v in row)
        print(row_str)

    # Per-class precision, recall
    print("\n=== Per-class Metrics ===")
    results = {}
    for i, cls in enumerate(CLASSES):
        tp = matrix[i][i]
        total_true = sum(matrix[i])
        total_pred = sum(matrix[r][i] for r in range(n))
        recall = tp / total_true if total_true > 0 else 0
        precision = tp / total_pred if total_pred > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        results[cls] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "n_samples": total_true
        }
        print(f"  {cls:>12}: precision={precision:.3f}  recall={recall:.3f}  F1={f1:.3f}  (n={total_true})")

    # sklearn classification report
    try:
        from sklearn.metrics import classification_report
        print("\n=== sklearn Classification Report ===")
        report = classification_report(all_true, all_pred, target_names=CLASSES)
        print(report)
    except ImportError:
        print("  [WARN] sklearn not available; skipping classification report.")

    return matrix, results


# ---------------------------------------------------------------------------
# TFJS export
# ---------------------------------------------------------------------------

def _verify_tfjs_dual_output():
    """Post-export check (§2.9): confirm model.json exposes BOTH outputs.
    GraphModel avoids Keras 3 LayersModel JSON deserialization issues in tfjs."""
    model_json = OUT_TFJS / "model.json"
    if not model_json.exists():
        print("  [WARN] civic_model_tfjs/model.json not found; cannot verify outputs.")
        return
    try:
        spec = json.loads(model_json.read_text())
        if spec.get("format") == "graph-model":
            outputs = spec.get("signature", {}).get("outputs", {})
            names = list(outputs.keys())
            if len(names) >= 2:
                print(f"  [OK] TFJS graph model has {len(names)} outputs: {names}")
            else:
                print(f"  [WARN] TFJS graph model has {len(names)} output(s): {names}; "
                      f"expected 2 (logits + probs).")
        else:
            topo = spec.get("modelTopology", {})
            cfg = topo.get("model_config", topo).get("config", {})
            out_layers = cfg.get("output_layers", [])
            names = [ol[0] for ol in out_layers] if out_layers else []
            if len(out_layers) >= 2:
                print(f"  [OK] TFJS layers model has {len(out_layers)} output layers: {names}")
            else:
                print(f"  [WARN] TFJS layers model has {len(out_layers)} output layer(s): {names}; "
                      f"expected 2 (logits + probs).")
    except Exception as e:
        print(f"  [WARN] Could not verify TFJS output layers: {e}")


def export_tfjs():
    """Export trained Keras model to TensorFlow.js GraphModel format."""
    OUT_TFJS.mkdir(exist_ok=True)
    if OUT_SAVED_MODEL.exists():
        shutil.rmtree(OUT_SAVED_MODEL)

    model = tf.keras.models.load_model(
        str(OUT_KERAS),
        custom_objects={"FocalLoss": FocalLoss},
        compile=False,
    )
    try:
        model.export(str(OUT_SAVED_MODEL))
    except AttributeError:
        tf.saved_model.save(model, str(OUT_SAVED_MODEL))

    try:
        import tensorflowjs
        from tensorflowjs.converters import converter
        converter.convert([
            "--input_format=tf_saved_model",
            "--output_format=tfjs_graph_model",
            str(OUT_SAVED_MODEL),
            str(OUT_TFJS),
            "--quantize_float16",          # ~50% smaller, negligible accuracy loss
        ])
        print(f"[OK] Exported TFJS to {OUT_TFJS}")
    except Exception as e:
        print(f"Python API export failed ({e}); trying CLI", file=sys.stderr)
        try:
            subprocess.run([
                sys.executable, "-m", "tensorflowjs.converters.converter",
                "--input_format=tf_saved_model",
                "--output_format=tfjs_graph_model",
                str(OUT_SAVED_MODEL), str(OUT_TFJS),
                "--quantize_float16",
            ], check=True)
        except Exception as e2:
            print(f"CLI export also failed: {e2}", file=sys.stderr)
            # Fallback: try without quantization
            try:
                from tensorflowjs.converters import converter as conv2
                conv2.convert([
                    "--input_format=tf_saved_model",
                    "--output_format=tfjs_graph_model",
                    str(OUT_SAVED_MODEL), str(OUT_TFJS),
                ])
                print(f"[OK] Exported TFJS (no quantization) to {OUT_TFJS}")
            except Exception as e3:
                print(f"All export methods failed: {e3}", file=sys.stderr)
                print("  Model saved as Keras (.keras). Run tensorflowjs_converter manually.")
                return
    _verify_tfjs_dual_output()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def to_serializable(obj):
    """Recursively convert numpy floats to Python floats for JSON."""
    if isinstance(obj, dict):
        return {k: to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_serializable(v) for v in obj]
    try:
        return float(obj)
    except (TypeError, ValueError):
        return obj


def copy_best_model(best_stage_path, out_path):
    """Copy the best stage checkpoint to the final output path."""
    if best_stage_path.exists():
        shutil.copy2(str(best_stage_path), str(out_path))
        print(f"[OK] Copied best model from {best_stage_path.name} -> {out_path.name}")
    else:
        print(f"[WARN] Best stage file not found: {best_stage_path}; saving current weights.")


def main():
    ap = argparse.ArgumentParser(
        description=f"Train 4-class civic image classifier ({BACKBONE_NAME})"
    )
    ap.add_argument("--epochs",          type=int,   default=30,   help="Stage 1 epochs (default: 30)")
    ap.add_argument("--finetune-epochs", type=int,   default=25,   help="Stage 2 epochs (default: 25)")
    ap.add_argument("--full-epochs",     type=int,   default=15,   help="Stage 3 full fine-tune epochs (default: 15)")
    ap.add_argument("--batch",           type=int,   default=32)
    ap.add_argument("--no-stage3",       action="store_true",       help="Skip Stage 3 full fine-tune")
    ap.add_argument("--no-class-weight", action="store_true")
    ap.add_argument("--gamma",           type=float, default=FOCAL_GAMMA,     help="Focal loss gamma (default: 1.5)")
    ap.add_argument("--label-smoothing", type=float, default=LABEL_SMOOTHING, help="Label smoothing epsilon (default: 0.0)")
    ap.add_argument("--stage2-unfreeze", type=int,   default=60,    help="Top N backbone layers to unfreeze in Stage 2 (default: 60)")
    ap.add_argument("--drainage-boost",  action="store_true", default=True,
                    help="Boost drainage focal-alpha x1.5 (default: True). Oversampling removed (§2.5).")
    ap.add_argument("--no-drainage-boost", dest="drainage_boost", action="store_false",
                    help="Disable drainage focal-alpha boost")
    args = ap.parse_args()

    print("=" * 60)
    print(f"FixMyCity Civic Classifier v3 -- {BACKBONE_NAME}")
    print("=" * 60)
    print(f"Classes: {CLASSES}")
    print(f"Data dir: {DATA_DIR}")
    print(f"Stage 2 unfreeze top: {args.stage2_unfreeze} layers")
    print(f"Drainage boost: {args.drainage_boost}")

    # Check class counts
    counts = get_class_counts()
    print("\n=== Class counts ===")
    for c, n in counts.items():
        status = "[OK]" if n >= 300 else ("[WARN]" if n >= 100 else "[ERR]")
        print(f"  {status} {c}: {n} images")

    if min(counts.values()) == 0:
        print("\n[ERR] One or more classes have 0 images. Run download scripts first.")
        sys.exit(1)

    if min(counts.values()) < 100:
        print(f"\n[WARN] Some classes have very few images (<100). Model may overfit.")

    # Class weights
    class_weights = None
    if not args.no_class_weight:
        class_weights = compute_class_weights(counts, drainage_boost=args.drainage_boost)
        print("\n=== Class weights (inverse-frequency, with drainage boost) ===")
        for i, c in enumerate(CLASSES):
            print(f"  {c}: {class_weights[i]:.3f}")

    # Focal loss with optional class weights
    focal_loss = make_focal_loss(class_weights, gamma=args.gamma, label_smoothing=args.label_smoothing)
    print(f"\nUsing FocalLoss(gamma={args.gamma}, label_smoothing={args.label_smoothing})")

    # Datasets
    train, val, _ = build_datasets(args.batch)
    model, base = build_model()

    # Realized per-class histogram (§2.5) — drainage oversampling removed.
    print("\n=== Realized per-class image histogram ===")
    for c in CLASSES:
        print(f"  {c}: {counts[c]}")

    print(f"\nModel backbone: {BACKBONE_NAME} (pretrained ImageNet)")
    print(f"Total params: {model.count_params():,}")

    # Macro-F1 callback (§2.7) — evaluated on the CLEAN, int-labelled val set
    # (the raw `val` BEFORE as_targets). Reused across all stages.
    macro_f1_cb = MacroF1(val)

    all_history = {}

    # Best model tracking across all stages — on val_macro_f1 (§2.7), NOT accuracy.
    best_macro_f1 = 0.0
    best_stage_model_path = None

    def _stage_best_f1(hist):
        return max(hist.get("val_macro_f1", [0.0]))

    # ---- Stage 1: head training (no mixing, clean one-hot) ----
    print("\n" + "=" * 40)
    print("Stage 1: Head training (backbone frozen)")
    print("=" * 40)

    h1 = stage1_train(model, train, val, args.epochs, focal_loss, macro_f1_cb,
                      apply_aug=False)
    all_history["stage1"] = h1
    f1_s1 = _stage_best_f1(h1)
    print(f"\n  Best val_macro_f1 Stage 1: {f1_s1:.4f}")

    if f1_s1 > best_macro_f1:
        best_macro_f1 = f1_s1
        best_stage_model_path = ROOT / "civic_model_stage1_best.keras"
        print(f"  [NEW BEST] Stage 1 is current best ({best_macro_f1:.4f})")

    # ---- Stage 2: top-N fine-tune (gated mixing) ----
    print("\n" + "=" * 40)
    print(f"Stage 2: Fine-tune top {args.stage2_unfreeze} {BACKBONE_NAME} layers")
    print("=" * 40)
    h2 = stage2_finetune(model, base, train, val, args.finetune_epochs,
                         focal_loss, macro_f1_cb, unfreeze_top=args.stage2_unfreeze)
    all_history["stage2"] = h2
    f1_s2 = _stage_best_f1(h2)
    print(f"\n  Best val_macro_f1 Stage 2: {f1_s2:.4f}")

    if f1_s2 > best_macro_f1:
        best_macro_f1 = f1_s2
        best_stage_model_path = ROOT / "civic_model_stage2_best.keras"
        print(f"  [NEW BEST] Stage 2 is current best ({best_macro_f1:.4f})")

    # ---- Stage 3: full fine-tune (optional, no mixing) ----
    f1_s3 = None
    if not args.no_stage3:
        print("\n" + "=" * 40)
        print("Stage 3: Full fine-tune (very low LR)")
        print("=" * 40)
        h3 = stage3_full_finetune(model, base, train, val, args.full_epochs,
                                  focal_loss, macro_f1_cb)
        all_history["stage3"] = h3
        f1_s3 = _stage_best_f1(h3)
        print(f"\n  Best val_macro_f1 Stage 3: {f1_s3:.4f}")

        if f1_s3 > best_macro_f1:
            best_macro_f1 = f1_s3
            best_stage_model_path = ROOT / "civic_model_stage3_best.keras"
            print(f"  [NEW BEST] Stage 3 is current best ({best_macro_f1:.4f})")

    # ---- Save best model across all stages ----
    print(f"\n[BEST] Overall best val_macro_f1: {best_macro_f1:.4f}")
    if best_stage_model_path is not None:
        copy_best_model(best_stage_model_path, OUT_KERAS)
        # Reload best weights into current model for confusion matrix
        try:
            best_model = tf.keras.models.load_model(
                str(OUT_KERAS),
                custom_objects={"FocalLoss": FocalLoss}
            )
            print(f"[OK] Reloaded best model for evaluation.")
        except Exception as e:
            print(f"[WARN] Could not reload best model ({e}); using current in-memory model.")
            best_model = model
            best_model.save(OUT_KERAS)
    else:
        best_model = model
        best_model.save(OUT_KERAS)

    # ---- Confusion matrix ----
    print("\n=== Computing confusion matrix on validation set ===")
    matrix, per_class_metrics = compute_confusion_matrix(best_model, val)

    # ---- Save labels + history + confusion ----
    LABELS_JSON.write_text(json.dumps(CLASSES))
    HISTORY_JSON.write_text(json.dumps(to_serializable(all_history), indent=2))
    CONFUSION_JSON.write_text(json.dumps({
        "classes": CLASSES,
        "confusion_matrix": matrix,
        "per_class_metrics": per_class_metrics,
        "val_macro_f1_stage1": f1_s1,
        "val_macro_f1_stage2": f1_s2,
        "val_macro_f1_stage3": f1_s3,
        "best_macro_f1": best_macro_f1,
    }, indent=2))

    print(f"\n[OK] Saved Keras model:       {OUT_KERAS}")
    print(f"[OK] Saved labels:            {LABELS_JSON}")
    print(f"[OK] Saved training history:  {HISTORY_JSON}")
    print(f"[OK] Saved confusion matrix:  {CONFUSION_JSON}")

    # ---- Anti-collapse export gate (§2.7) ----
    # Refuse to overwrite civic_model_tfjs/ with a degenerate/collapsed model.
    recalls = [per_class_metrics[c]["recall"] for c in CLASSES]
    if best_macro_f1 < ACCEPT_MACRO_F1 or min(recalls) < MIN_PER_CLASS_RECALL:
        print(f"\n[ABORT] collapse guard: macro_f1={best_macro_f1:.3f} "
              f"(need >= {ACCEPT_MACRO_F1}), min recall={min(recalls):.3f} "
              f"(need >= {MIN_PER_CLASS_RECALL}). "
              f"NOT exporting TFJS; civic_model_tfjs/ left untouched.")
        sys.exit(2)

    # ---- TFJS export (only on passing the collapse gate) ----
    print("\n=== Export TFJS ===")
    export_tfjs()

    # ---- Summary ----
    print("\n" + "=" * 60)
    print("=== Training Complete ===")
    print(f"  Backbone:                 {BACKBONE_NAME}")
    print(f"  Stage 1 best val_macro_f1: {f1_s1:.4f}")
    print(f"  Stage 2 best val_macro_f1: {f1_s2:.4f}")
    if f1_s3 is not None:
        print(f"  Stage 3 best val_macro_f1: {f1_s3:.4f}")
    print(f"  Overall best val_macro_f1: {best_macro_f1:.4f}")
    print("\nNext step: python temperature_scaling.py --target-recall 0.92")


if __name__ == "__main__":
    main()
