"""
clean_dataset_contamination.py  (IMPLEMENTATION_SPEC.md §4 — owner: this file)

Embedding-outlier contamination detector for my_dataset/.

WHY THIS EXISTS
---------------
The drainage folder is suspected of contamination (road / pothole images
mislabelled as drainage), which is a likely cause of the trained model
"accepting" pothole images for the drainage class while rejecting real
drainage. This tool embeds every image in each target class folder, builds a
trusted per-class centroid, and flags images whose embedding looks like it
belongs to a different class (or is a low-similarity outlier). Flagged files
are MOVED (never deleted) to my_dataset/_quarantine/<class>/ so they are
excluded from training automatically (the quarantine dir is not a CLASS_ORDER
folder). Default is a dry run that only writes clean_report.csv.

Runs BEFORE training (see retrain_pipeline.py / RUNBOOK.md).

CLI (IMPLEMENTATION_SPEC.md §4.1)
--------------------------------
    python clean_dataset_contamination.py
        [--classes drainage,potholes,streetlight]   # default: all BLOCKING_CLASSES
        [--margin 0.05]        # flag if (own_sim - best_other_sim) < margin
        [--std-k 2.0]          # flag if own_sim < (class_mean - std_k*class_std)
        [--report clean_report.csv]
        [--apply]              # MOVE flagged files to my_dataset/_quarantine/<class>/
        [--model clip]         # clip (default, openai/clip-vit-base-patch32)
                               #   | efficientnet (penultimate GAP features)

This file exclusively owns clean_dataset_contamination.py and only ever creates
my_dataset/_quarantine/. It touches no other files.
"""

import os
import sys
import csv
import shutil
import argparse

import numpy as np

# ---------------------------------------------------------------------------
# SHARED CONSTANTS (IMPLEMENTATION_SPEC.md §0 — hard-coded, must match elsewhere)
# ---------------------------------------------------------------------------
CLASS_ORDER = ["drainage", "others", "potholes", "streetlight"]   # index 0..3, UNCHANGED
BLOCKING_CLASSES = ["drainage", "potholes", "streetlight"]        # "others" never blocks
IMG_SIZE = (224, 224)                                             # bilinear, [0,255] for EfficientNet
CLIP_MODEL_ID_PY = "openai/clip-vit-base-patch32"                 # weight-compatible w/ Xenova node id
CLIP_EMBED_DIM = 512

DATASET_DIR = "my_dataset"
# Quarantine MUST live OUTSIDE my_dataset/ — Keras image_dataset_from_directory
# treats every subdirectory of my_dataset/ as a class, so a nested _quarantine
# folder would become a bogus 5th class and break training.
QUARANTINE_DIR = "my_dataset_quarantine"
KERAS_MODEL_PATH = "civic_model.keras"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

# Trusted filename prefixes used to build an uncontaminated centroid per class.
# If a class has zero files matching its prefixes, ALL files are used (and
# trusted_n is reported so the user knows the centroid is not prefix-filtered).
TRUSTED_PREFIXES = {
    "drainage": ("drain_",),
    "potholes": ("kg_", "kag_"),
    "streetlight": ("kg_", "kag_"),
    "others": (),  # no trusted prefix -> use all files
}

# Canonical text prompts per class (IMPLEMENTATION_SPEC.md §4.2 step 3).
# Used only in CLIP mode (EfficientNet has no text encoder). All four classes
# are included as text routing targets so an image can be flagged as belonging
# to a non-target class (e.g. an "others"-looking image inside drainage).
TEXT_PROMPTS = {
    "drainage": [
        "a photo of a blocked drain, sewer, manhole, or gutter overflow",
        "a photo of stagnant dirty water from a clogged drain or sewer",
    ],
    "potholes": [
        "a photo of a pothole or crater in a road",
        "a photo of a damaged asphalt road surface with holes",
    ],
    "streetlight": [
        "a photo of a broken or non-working street light or lamp post",
        "a photo of a street lamp or light pole against the sky",
    ],
    "others": [
        "a photo of an unrelated object, person, garbage, building, or scenery",
        "a random everyday photo that is not a road, drain, or street light",
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def list_class_images(folder_path):
    """Non-recursive list of image files in a class folder (matches audit_dataset.py)."""
    if not os.path.isdir(folder_path):
        return []
    return sorted(
        f for f in os.listdir(folder_path)
        if f.lower().endswith(IMAGE_EXTS)
        and os.path.isfile(os.path.join(folder_path, f))
    )


def l2_normalize(mat):
    """L2-normalize rows of a 2D array; safe against zero vectors."""
    mat = np.asarray(mat, dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def trusted_mask(filenames, cls):
    """Boolean mask of files whose name starts with a trusted prefix for `cls`."""
    prefixes = TRUSTED_PREFIXES.get(cls, ())
    if not prefixes:
        return np.zeros(len(filenames), dtype=bool)
    return np.array([f.startswith(prefixes) for f in filenames], dtype=bool)


# ---------------------------------------------------------------------------
# Embedding backends
# ---------------------------------------------------------------------------
class ClipBackend:
    """CLIP image+text encoder via HuggingFace transformers (openai/clip-vit-base-patch32)."""

    def __init__(self):
        try:
            import torch
            from transformers import CLIPModel, CLIPProcessor
        except Exception as e:
            print(f"ERROR: CLIP mode needs `torch` + `transformers`: {e}")
            print("       pip install transformers torch pillow   (or use --model efficientnet)")
            sys.exit(1)
        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[clean] loading CLIP {CLIP_MODEL_ID_PY} on {self.device} ...")
        self.model = CLIPModel.from_pretrained(CLIP_MODEL_ID_PY).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID_PY)
        print("[preprocess] CLIP processor (model-native resize/normalize)")
        self.has_text = True
        self.dim = CLIP_EMBED_DIM

    def _load_pil(self, path):
        from PIL import Image
        return Image.open(path).convert("RGB")

    def embed_images(self, paths, batch=32):
        from PIL import Image  # noqa: F401  (used via _load_pil)
        feats = []
        for i in range(0, len(paths), batch):
            chunk = paths[i:i + batch]
            imgs = []
            keep = []
            for p in chunk:
                try:
                    imgs.append(self._load_pil(p))
                    keep.append(True)
                except Exception as e:
                    print(f"  skip (decode) {os.path.basename(p)}: {e}")
                    keep.append(False)
            if not imgs:
                # whole chunk failed -> emit zero vectors so indexing stays aligned
                feats.append(np.zeros((len(chunk), self.dim), dtype=np.float32))
                continue
            inputs = self.processor(images=imgs, return_tensors="pt").to(self.device)
            with self.torch.no_grad():
                f = self.model.get_image_features(**inputs).cpu().numpy()
            # re-expand to full chunk size, filling failed slots with zeros
            full = np.zeros((len(chunk), self.dim), dtype=np.float32)
            full[np.array(keep)] = f
            feats.append(full)
            print(f"  embedded {min(i + batch, len(paths))}/{len(paths)}")
        return l2_normalize(np.concatenate(feats, axis=0)) if feats else np.zeros((0, self.dim), np.float32)

    def embed_texts(self, texts):
        inputs = self.processor(text=list(texts), return_tensors="pt", padding=True).to(self.device)
        with self.torch.no_grad():
            f = self.model.get_text_features(**inputs).cpu().numpy()
        return l2_normalize(f)


class EfficientNetBackend:
    """Penultimate GAP features from civic_model.keras (image-only; no text encoder)."""

    def __init__(self):
        if not os.path.exists(KERAS_MODEL_PATH):
            print(f"ERROR: {KERAS_MODEL_PATH} not found; cannot use --model efficientnet.")
            print("       Train the model first, or use --model clip.")
            sys.exit(1)
        try:
            import tensorflow as tf
        except Exception as e:
            print(f"ERROR: efficientnet mode needs tensorflow: {e}")
            sys.exit(1)
        self.tf = tf
        print(f"[clean] loading {KERAS_MODEL_PATH} for penultimate GAP features ...")
        keras_model = tf.keras.models.load_model(KERAS_MODEL_PATH, compile=False)
        feat_layer = self._find_feature_layer(keras_model)
        if feat_layer is None:
            print("ERROR: could not locate a GlobalAveragePooling layer in civic_model.keras.")
            print("       Use --model clip instead.")
            sys.exit(1)
        self.extractor = tf.keras.Model(keras_model.input, feat_layer.output)
        self.dim = int(feat_layer.output.shape[-1])
        self.has_text = False
        # CANONICAL EfficientNet preprocessing (IMPLEMENTATION_SPEC.md §1): raw [0,255].
        print("[preprocess] EfficientNet raw [0,255], bilinear 224")

    @staticmethod
    def _find_feature_layer(model):
        # Prefer the last GlobalAveragePooling2D; fall back to a rank-2 'pool'/'avg' layer.
        import tensorflow as tf
        gap = None
        for layer in model.layers:
            if isinstance(layer, tf.keras.layers.GlobalAveragePooling2D):
                gap = layer
        if gap is not None:
            return gap
        for layer in reversed(model.layers):
            name = layer.name.lower()
            try:
                rank = len(layer.output.shape)
            except Exception:
                rank = None
            if rank == 2 and ("avg" in name or "pool" in name or "global" in name):
                return layer
        return None

    def embed_images(self, paths, batch=32):
        tf = self.tf
        feats = []
        for i in range(0, len(paths), batch):
            chunk = paths[i:i + batch]
            arrs = []
            keep = []
            for p in chunk:
                try:
                    img = tf.keras.utils.load_img(p, target_size=IMG_SIZE, interpolation="bilinear")
                    arrs.append(tf.keras.utils.img_to_array(img))  # raw [0,255]
                    keep.append(True)
                except Exception as e:
                    print(f"  skip (decode) {os.path.basename(p)}: {e}")
                    keep.append(False)
            full = np.zeros((len(chunk), self.dim), dtype=np.float32)
            if arrs:
                stack = np.stack(arrs, axis=0)  # raw [0,255], NO preprocess_input (§1)
                f = self.extractor.predict(stack, verbose=0)
                full[np.array(keep)] = np.asarray(f, dtype=np.float32)
            feats.append(full)
            print(f"  embedded {min(i + batch, len(paths))}/{len(paths)}")
        return l2_normalize(np.concatenate(feats, axis=0)) if feats else np.zeros((0, self.dim), np.float32)

    def embed_texts(self, texts):
        raise NotImplementedError("EfficientNet backend has no text encoder.")


def build_backend(name):
    if name == "clip":
        return ClipBackend()
    if name == "efficientnet":
        return EfficientNetBackend()
    print(f"ERROR: unknown --model '{name}' (expected 'clip' or 'efficientnet').")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Core detection
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        description="Embedding-outlier contamination detector; quarantines (moves) flagged images."
    )
    ap.add_argument("--classes", default=",".join(BLOCKING_CLASSES),
                    help="comma-separated class folders to scan (default: drainage,potholes,streetlight)")
    ap.add_argument("--margin", type=float, default=0.05,
                    help="flag if (own_sim - best_other_sim) < margin")
    ap.add_argument("--std-k", type=float, default=2.0, dest="std_k",
                    help="flag if own_sim < (class_mean - std_k * class_std)")
    ap.add_argument("--report", default="clean_report.csv", help="output CSV path")
    ap.add_argument("--apply", action="store_true",
                    help="MOVE flagged files to my_dataset/_quarantine/<class>/ (default: dry run)")
    ap.add_argument("--model", default="clip", choices=["clip", "efficientnet"],
                    help="embedding backend (default: clip)")
    ap.add_argument("--aggressive", action="store_true",
                    help="quarantine on ANY flag incl. weak text_mismatch/low_margin "
                         "(default: only image-space nearest_mismatch/outlier_lowsim are moved)")
    args = ap.parse_args()

    target_classes = [c.strip() for c in args.classes.split(",") if c.strip()]
    unknown = [c for c in target_classes if c not in CLASS_ORDER]
    if unknown:
        print(f"ERROR: unknown class(es) {unknown}; valid: {CLASS_ORDER}")
        sys.exit(1)

    backend = build_backend(args.model)
    use_text = getattr(backend, "has_text", False)

    # --- Phase 1: embed every image in each target class folder -------------
    class_files = {}      # cls -> [filename, ...]
    class_paths = {}      # cls -> [abspath, ...]
    class_embed = {}      # cls -> Nx D L2-normalized embeddings
    centroids = {}        # cls -> D centroid (L2-normalized)
    trusted_counts = {}   # cls -> (trusted_n, total)

    for cls in target_classes:
        folder = os.path.join(DATASET_DIR, cls)
        files = list_class_images(folder)
        if not files:
            print(f"WARN: no images in {folder} — skipping class '{cls}'.")
            continue
        paths = [os.path.join(folder, f) for f in files]
        print(f"\n[{cls}] embedding {len(files)} images ...")
        emb = backend.embed_images(paths)

        # Trusted-subset centroid (IMPLEMENTATION_SPEC.md §4.2 step 2)
        mask = trusted_mask(files, cls)
        trusted_n = int(mask.sum())
        if trusted_n == 0:
            subset = emb
            note = f"no trusted prefix {TRUSTED_PREFIXES.get(cls, ())} -> centroid from ALL {len(files)} files"
        else:
            subset = emb[mask]
            note = f"centroid from trusted_n={trusted_n}/{len(files)} (prefix {TRUSTED_PREFIXES.get(cls, ())})"
        centroid = l2_normalize(subset.mean(axis=0, keepdims=True))[0]

        class_files[cls] = files
        class_paths[cls] = paths
        class_embed[cls] = emb
        centroids[cls] = centroid
        trusted_counts[cls] = (trusted_n, len(files))
        print(f"  {note}")

    scanned = [c for c in target_classes if c in centroids]
    if not scanned:
        print("Nothing to scan. Exiting.")
        sys.exit(0)

    # --- Phase 2: text prompt embeddings (CLIP only) ------------------------
    # text_nearest can route to ANY of the 4 classes (incl. non-target ones).
    text_emb = {}  # cls -> Mx D
    if use_text:
        for cls in CLASS_ORDER:
            prompts = TEXT_PROMPTS.get(cls)
            if prompts:
                text_emb[cls] = backend.embed_texts(prompts)

    centroid_matrix_classes = scanned                      # image-centroid comparison set
    centroid_stack = np.stack([centroids[c] for c in centroid_matrix_classes], axis=0)

    # --- Phase 3: per-image scoring + flagging ------------------------------
    # First, own_sim per class to derive class_mean / class_std for outlier rule.
    own_sim = {}  # cls -> 1D array of cosine(img, own centroid)
    for cls in scanned:
        own_sim[cls] = class_embed[cls] @ centroids[cls]

    class_stats = {}
    for cls in scanned:
        s = own_sim[cls]
        class_stats[cls] = (float(s.mean()), float(s.std()))

    rows = []                       # flagged rows for CSV
    summary = {}                    # cls -> (total, flagged)
    flagged_paths = []              # (path, cls) to (optionally) move

    for cls in scanned:
        emb = class_embed[cls]
        files = class_files[cls]
        paths = class_paths[cls]
        cmean, cstd = class_stats[cls]
        total = len(files)
        flagged = 0
        moved = 0

        # cosine of each image to every scanned class centroid
        sims = emb @ centroid_stack.T        # [N, n_scanned]

        # text nearest (CLIP): max prompt cosine per class, argmax over classes
        if use_text and text_emb:
            txt_classes = list(text_emb.keys())
            # [N, n_txt_classes] of max-over-prompts similarity (prompt counts may differ per class)
            per_class_max = np.stack(
                [(emb @ text_emb[tc].T).max(axis=1) for tc in txt_classes], axis=1
            )
            text_nearest_idx = per_class_max.argmax(axis=1)
        else:
            txt_classes = []
            text_nearest_idx = None

        for j, fname in enumerate(files):
            o = float(own_sim[cls][j])
            # best other = max sim to any OTHER scanned centroid
            row_sims = sims[j]
            nearest_idx = int(row_sims.argmax())
            nearest_class = centroid_matrix_classes[nearest_idx]
            other_idx = [k for k in range(len(centroid_matrix_classes))
                         if centroid_matrix_classes[k] != cls]
            if other_idx:
                best_other = float(row_sims[other_idx].max())
            else:
                best_other = None  # single-class scan: no cross comparison
            margin = (o - best_other) if best_other is not None else None

            if text_nearest_idx is not None:
                text_nearest = txt_classes[int(text_nearest_idx[j])]
            else:
                text_nearest = ""

            reasons = []
            if nearest_class != cls:
                reasons.append("nearest_mismatch")
            if margin is not None and margin < args.margin:
                reasons.append("low_margin")
            if cstd > 0 and o < (cmean - args.std_k * cstd):
                reasons.append("outlier_lowsim")
            if use_text and text_nearest and text_nearest != cls:
                reasons.append("text_mismatch")

            # Quarantine policy: only IMAGE-SPACE evidence moves a file. CLIP
            # image->text similarity is biased (generic "others" prompts attract
            # legit drainage/civic images), and low_margin alone fires on the
            # natural drainage<->others visual overlap. Treat text_mismatch and
            # low_margin as ADVISORY (kept in the report, not moved) unless
            # --aggressive is set. Real contamination = the image embeds nearest
            # to a different class (nearest_mismatch) or is a low-sim outlier.
            HARD_REASONS = {"nearest_mismatch", "outlier_lowsim"}
            is_hard = bool(set(reasons) & HARD_REASONS)
            do_move = bool(reasons) if args.aggressive else is_hard

            if reasons:
                flagged += 1
                rows.append({
                    "path": paths[j],
                    "folder": cls,
                    "nearest_class": nearest_class,
                    "text_nearest": text_nearest,
                    "own_sim": round(o, 4),
                    "best_other_sim": ("" if best_other is None else round(best_other, 4)),
                    "margin": ("" if margin is None else round(margin, 4)),
                    "flag_reason": "|".join(reasons),
                    "action": ("quarantine" if do_move else "advisory"),
                })
                if do_move:
                    moved += 1
                    flagged_paths.append((paths[j], cls))

        summary[cls] = (total, flagged, moved)

    # --- Write report CSV (IMPLEMENTATION_SPEC.md §4.3) ---------------------
    fieldnames = ["path", "folder", "nearest_class", "text_nearest",
                  "own_sim", "best_other_sim", "margin", "flag_reason", "action"]
    with open(args.report, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    # --- Console summary ----------------------------------------------------
    print("\n" + "=" * 64)
    print("CONTAMINATION SUMMARY")
    print("=" * 64)
    print(f"backend={args.model}  margin<{args.margin}  std_k={args.std_k}  "
          f"text_rule={'on' if use_text else 'off'}  policy={'aggressive' if args.aggressive else 'image-space'}")
    print(f"{'class':<14}{'total':>8}{'flagged':>10}{'quarant':>10}{'q%':>7}{'trusted_n':>12}")
    total_flagged = 0
    total_moved = 0
    for cls in scanned:
        total, flagged, moved = summary[cls]
        tn, tt = trusted_counts[cls]
        pct = (moved / total * 100) if total else 0.0
        total_flagged += flagged
        total_moved += moved
        print(f"{cls:<14}{total:>8}{flagged:>10}{moved:>10}{pct:>6.1f}%{f'{tn}/{tt}':>12}")
    print("-" * 64)
    print(f"report written to {args.report}  ({total_flagged} flagged rows, "
          f"{total_moved} marked quarantine, {total_flagged - total_moved} advisory-only)")

    # --- Move semantics (IMPLEMENTATION_SPEC.md §4.4) ----------------------
    if not args.apply:
        print(f"\nDRY RUN — {total_moved} files would be quarantined "
              f"to {QUARANTINE_DIR}/<class>/  (re-run with --apply to move them)")
        return
    applied = 0
    for path, cls in flagged_paths:
        dest_dir = os.path.join(QUARANTINE_DIR, cls)
        os.makedirs(dest_dir, exist_ok=True)
        base = os.path.basename(path)
        dest = os.path.join(dest_dir, base)
        # On name clash append _1, _2, ...
        if os.path.exists(dest):
            stem, ext = os.path.splitext(base)
            k = 1
            while os.path.exists(os.path.join(dest_dir, f"{stem}_{k}{ext}")):
                k += 1
            dest = os.path.join(dest_dir, f"{stem}_{k}{ext}")
        try:
            shutil.move(path, dest)   # MOVE, never delete
            applied += 1
        except Exception as e:
            print(f"  WARN: could not move {path}: {e}")

    print(f"\nAPPLIED — moved {applied}/{total_moved} quarantined files to {QUARANTINE_DIR}/<class>/")
    print("These files are now excluded from training (quarantine is not a CLASS_ORDER folder).")
    print("Nothing was deleted; review the quarantine folder and restore any false positives.")


if __name__ == "__main__":
    main()
