"""validate_dataset.py -- Dataset health check and model confusion analysis.

Runs:
  1. Dataset health check (counts, corruptions, duplicates, class balance)
  2. Drainage/Potholes boundary confusion test (using current model)
  3. Others diversity check (color histogram clustering)
  4. Generates dataset_validation_report.json
  5. Prints actionable recommendations

Usage:
  python validate_dataset.py
  python validate_dataset.py --category drainage
  python validate_dataset.py --skip-model   # skip model-based checks (faster)
"""
import argparse
import json
import random
import sys
from pathlib import Path
from collections import defaultdict

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "my_dataset"
MODEL_PATH = ROOT / "civic_model.keras"
REPORT_PATH = ROOT / "dataset_validation_report.json"

CATEGORIES = ["potholes", "drainage", "streetlight", "others"]
IMAGE_GLOBS = ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG"]

MIN_IMAGES_WARN = 300
MAX_IMAGES_WARN = 2000
DUP_HAMMING_THRESHOLD = 8
CONFUSION_SAMPLE = 50

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


def c(color, text):
    """Wrap text in ANSI color codes."""
    return f"{color}{text}{RESET}"


def collect_images(directory: Path) -> list:
    """Return sorted list of all image paths in directory."""
    seen = set()
    files = []
    for pattern in IMAGE_GLOBS:
        for f in directory.glob(pattern):
            if f not in seen:
                seen.add(f)
                files.append(f)
    return sorted(files)


def check_health(category: str) -> dict:
    """
    Count images, detect corruptions, detect near-duplicates, and warn on
    class imbalance.
    """
    src_dir = DATA_DIR / category
    if not src_dir.exists():
        return {"category": category, "exists": False, "count": 0,
                "corrupted": 0, "duplicates": 0, "warnings": ["Directory missing"]}

    files = collect_images(src_dir)
    count = len(files)
    corrupted = []
    duplicates = []
    warnings = []

    if count < MIN_IMAGES_WARN:
        warnings.append(f"Low image count: {count} (recommend >= {MIN_IMAGES_WARN})")
    if count > MAX_IMAGES_WARN:
        warnings.append(f"Very high image count: {count} (> {MAX_IMAGES_WARN}) -- consider sub-sampling")

    valid_imgs = []
    for f in files:
        try:
            with Image.open(f) as im:
                im.verify()
            valid_imgs.append(f)
        except Exception:
            corrupted.append(f.name)

    if corrupted:
        warnings.append(f"{len(corrupted)} corrupted image(s) found")

    try:
        import imagehash
        hashes = {}
        for f in valid_imgs:
            try:
                with Image.open(f) as im:
                    h = imagehash.phash(im.convert("RGB"))
                is_dup = False
                for _, existing_h in hashes.items():
                    if (h - existing_h) < DUP_HAMMING_THRESHOLD:
                        duplicates.append(f.name)
                        is_dup = True
                        break
                if not is_dup:
                    hashes[f] = h
            except Exception:
                pass
        if duplicates:
            warnings.append(f"{len(duplicates)} near-duplicate image(s) found")
    except ImportError:
        warnings.append("imagehash not installed -- duplicate check skipped")

    return {
        "category": category,
        "exists": True,
        "count": count,
        "corrupted": corrupted,
        "duplicates": duplicates,
        "warnings": warnings,
    }


def select_probs(model, preds):
    """Return the softmax-probability output for single- or dual-head models.

    The civic model may be dual-output [logits, probs] (IMPLEMENTATION_SPEC.md
    §2.1) or a legacy single-softmax head. model.predict on a dual-output model
    returns a LIST [logits_arr, probs_arr]; pick the probs head so downstream
    argmax/indexing stays correct.
    """
    if isinstance(preds, (list, tuple)):
        names = list(getattr(model, "output_names", []) or [])
        if "probs" in names:
            return np.asarray(preds[names.index("probs")])
        for p in preds:
            arr = np.asarray(p)
            if arr.ndim == 2 and np.all(arr >= 0) and np.allclose(
                    arr.sum(axis=1), 1.0, atol=1e-2):
                return arr
        return np.asarray(preds[-1])
    return np.asarray(preds)


def check_boundary_confusion(model, categories=None) -> dict:
    """
    Run CONFUSION_SAMPLE random images from drainage and potholes through the
    civic_model.keras classifier and report cross-class confusion rates.
    """
    import tensorflow as tf

    if categories is None:
        categories = ["drainage", "potholes"]

    # CRITICAL: the model emits probs in the canonical civic_labels.json order
    # ["drainage","others","potholes","streetlight"], NOT the CATEGORIES order
    # declared at module top. Build label_map from the model's true class order
    # so argmax(pred) and own/other indices live in the SAME index space.
    CLASS_ORDER = ["drainage", "others", "potholes", "streetlight"]
    try:
        import json as _json
        _lbl_path = ROOT / "civic_labels.json"
        if _lbl_path.exists():
            _loaded = _json.loads(_lbl_path.read_text())
            if set(_loaded) == set(CLASS_ORDER):
                CLASS_ORDER = _loaded
    except Exception:
        pass
    assert set(CATEGORIES) == set(CLASS_ORDER), \
        f"CATEGORIES {CATEGORIES} != model classes {CLASS_ORDER}"
    label_map = {cat: i for i, cat in enumerate(CLASS_ORDER)}
    results = {}

    for cat in categories:
        if cat not in ("drainage", "potholes"):
            continue
        src_dir = DATA_DIR / cat
        if not src_dir.exists():
            results[cat] = {"error": "directory missing"}
            continue

        files = collect_images(src_dir)
        sample = random.sample(files, min(CONFUSION_SAMPLE, len(files)))
        confused = 0
        errors = 0

        other_cat = "potholes" if cat == "drainage" else "drainage"
        other_idx = label_map.get(other_cat, -1)
        own_idx = label_map.get(cat, -1)

        for f in sample:
            try:
                # CANONICAL PREPROCESSING CONTRACT (IMPLEMENTATION_SPEC.md §1):
                # raw float32 [0,255] RGB, bilinear resize to 224x224, NO /255 and
                # NO preprocess_input (EfficientNetB0 bakes normalization into its
                # graph). Applying /255 here caused train/infer/validate skew.
                img = Image.open(f).convert("RGB").resize(
                    (224, 224), Image.Resampling.BILINEAR)
                arr = np.array(img, dtype="float32")
                arr = np.expand_dims(arr, 0)
                pred = select_probs(model, model.predict(arr, verbose=0))[0]
                predicted_class = int(np.argmax(pred))
                if predicted_class == other_idx:
                    confused += 1
            except Exception:
                errors += 1

        total = len(sample) - errors
        confusion_rate = (confused / total * 100) if total > 0 else 0.0
        results[cat] = {
            "sampled": len(sample),
            "confused_with": other_cat,
            "confused_count": confused,
            "errors": errors,
            "confusion_rate_pct": round(confusion_rate, 2),
        }

    return results


def check_others_diversity(sample_size=100) -> dict:
    """
    Compute per-channel color histogram for random sample of 'others' images.
    Low variance across histograms = visually homogeneous dataset = warning.
    """
    src_dir = DATA_DIR / "others"
    if not src_dir.exists():
        return {"error": "others directory missing"}

    files = collect_images(src_dir)
    sample = random.sample(files, min(sample_size, len(files)))

    histograms = []
    for f in sample:
        try:
            img = Image.open(f).convert("RGB").resize((64, 64))
            arr = np.array(img)
            hist = []
            for ch in range(3):
                h, _ = np.histogram(arr[:, :, ch], bins=16, range=(0, 256))
                hist.extend(h.tolist())
            histograms.append(hist)
        except Exception:
            pass

    if not histograms:
        return {"error": "no valid images in others"}

    hist_arr = np.array(histograms, dtype="float32")
    row_sums = hist_arr.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1
    hist_arr /= row_sums

    variance_per_bin = hist_arr.var(axis=0)
    mean_variance = float(variance_per_bin.mean())

    diversity_score = round(mean_variance * 10000, 4)
    is_homogeneous = diversity_score < 1.0

    return {
        "sampled": len(histograms),
        "diversity_score": diversity_score,
        "is_homogeneous": is_homogeneous,
        "note": "Score < 1.0 indicates visually homogeneous dataset (potential issue)",
    }


def save_report(report: dict):
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to: {REPORT_PATH}")


def print_health(result: dict):
    cat = result["category"]
    if not result["exists"]:
        print(c(RED, f"  [{cat}] MISSING"))
        return
    count = result["count"]
    corrupted = len(result["corrupted"])
    dups = len(result["duplicates"])
    count_color = GREEN if MIN_IMAGES_WARN <= count <= MAX_IMAGES_WARN else YELLOW
    print(f"  {c(BOLD, cat):<20} images={c(count_color, str(count)):>6}  "
          f"corrupted={c(RED if corrupted else GREEN, str(corrupted))}  "
          f"dups={c(YELLOW if dups else GREEN, str(dups))}")
    for w in result["warnings"]:
        print(c(YELLOW, f"    [WARN]  {w}"))


def print_confusion(results: dict):
    print(f"\n{c(BOLD, '  Boundary Confusion (drainage <-> potholes):')}")
    for cat, r in results.items():
        if "error" in r:
            print(c(RED, f"    [{cat}] {r['error']}"))
            continue
        rate = r["confusion_rate_pct"]
        col = GREEN if rate < 10 else (YELLOW if rate < 25 else RED)
        print(f"    [{cat}] {r['sampled']} sampled, "
              f"{r['confused_count']} confused as {r['confused_with']} "
              f"-> {c(col, f'{rate:.1f}%')} confusion rate")


def print_recommendations(health_results, confusion_results, diversity_result):
    recs = []

    counts = {r["category"]: r.get("count", 0) for r in health_results}
    max_c = max(counts.values()) if counts else 1
    for cat, cnt in counts.items():
        if max_c > 0 and cnt < max_c * 0.5:
            recs.append(f"Class imbalance: '{cat}' has {cnt} images vs max {max_c}. "
                        f"Consider augmenting or downloading more.")

    for r in health_results:
        if r.get("corrupted"):
            recs.append(f"Remove {len(r['corrupted'])} corrupted images from '{r['category']}'")

    for cat, r in confusion_results.items():
        if "error" not in r and r.get("confusion_rate_pct", 0) >= 20:
            recs.append(f"High confusion ({r['confusion_rate_pct']:.1f}%) between "
                        f"'{cat}' and '{r['confused_with']}'. Run filter_dataset.py --category {cat} "
                        f"and review boundary images.")

    if diversity_result.get("is_homogeneous"):
        recs.append("'others' class appears visually homogeneous. "
                    "Add more diverse civic images (graffiti, garbage, construction, etc.)")

    print(f"\n{c(BOLD, '  Recommendations:')}")
    if not recs:
        print(c(GREEN, "  \u2713 No issues found. Dataset looks healthy!"))
    else:
        for i, rec in enumerate(recs, 1):
            print(c(YELLOW, f"  {i}. {rec}"))


def main():
    ap = argparse.ArgumentParser(description="Dataset health check and model confusion analysis")
    ap.add_argument("--category", choices=CATEGORIES + ["all"], default="all")
    ap.add_argument("--skip-model", action="store_true",
                    help="Skip model-based checks (boundary confusion test)")
    args = ap.parse_args()

    cats = CATEGORIES if args.category == "all" else [args.category]

    print(c(BOLD, "\n=== FixMyCity Dataset Validation ==="))

    print(c(BOLD, "\n[1] Health Check"))
    print(f"  {'Category':<20} {'Images':>7}  Corrupted  Dups")
    print("  " + "-" * 50)
    health_results = []
    for cat in cats:
        r = check_health(cat)
        health_results.append(r)
        print_health(r)

    confusion_results = {}
    model = None
    if not args.skip_model:
        if MODEL_PATH.exists():
            print(c(BOLD, "\n[2] Loading civic_model.keras..."))
            try:
                import tensorflow as tf
                model = tf.keras.models.load_model(str(MODEL_PATH))
                print(c(GREEN, "  Model loaded."))
                print("[preprocess] EfficientNet raw [0,255], bilinear 224")

                confusion_cats = [cat for cat in cats if cat in ("drainage", "potholes")]
                if confusion_cats:
                    print(c(BOLD, "\n[2] Boundary Confusion Test"))
                    confusion_results = check_boundary_confusion(model, confusion_cats)
                    print_confusion(confusion_results)
                else:
                    print(c(YELLOW, "  Skipping confusion test (neither drainage nor potholes selected)"))
            except Exception as e:
                print(c(RED, f"  ERROR loading model: {e}"))
        else:
            print(c(YELLOW, f"\n[2] civic_model.keras not found at {MODEL_PATH} -- skipping model checks"))
    else:
        print(c(YELLOW, "\n[2] Model checks skipped (--skip-model)"))

    diversity_result = {}
    if "others" in cats:
        print(c(BOLD, "\n[3] Others Diversity Check"))
        diversity_result = check_others_diversity()
        score = diversity_result.get("diversity_score", "N/A")
        homogeneous = diversity_result.get("is_homogeneous", False)
        col = RED if homogeneous else GREEN
        print(f"  Diversity score: {c(col, str(score))} "
              f"({'HOMOGENEOUS - needs more variety' if homogeneous else 'DIVERSE - looks good'})")
        print(f"  ({diversity_result.get('note', '')})")
    else:
        print(c(YELLOW, "\n[3] Others diversity check skipped (not in selected categories)"))

    print_recommendations(health_results, confusion_results, diversity_result)

    report = {
        "health": health_results,
        "confusion": confusion_results,
        "diversity": diversity_result,
    }
    save_report(report)


if __name__ == "__main__":
    main()
