"""filter_dataset.py -- Smart dataset filtering before training.

Runs four passes on my_dataset/:
  Pass 1: Near-duplicate removal via perceptual hashing (imagehash)
  Pass 2: Minimum resolution enforcement (128x128 minimum)
  Pass 3: Civic relevance check -- rejects clearly non-outdoor/non-civic images
           using EfficientNetB0 ImageNet predictions
  Pass 4: Boundary confusion check -- rejects drainage/potholes images that
           are likely mislabelled or ambiguous (skip with --skip-boundary-check)

Usage:
  python filter_dataset.py                   # dry-run (show what would be removed)
  python filter_dataset.py --apply           # actually move rejected files
  python filter_dataset.py --category potholes --apply
  python filter_dataset.py --stats           # print detailed rejection stats
  python filter_dataset.py --skip-boundary-check  # skip Pass 4
"""
import argparse
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
import tensorflow as tf
from tensorflow.keras.applications import EfficientNetB0
from tensorflow.keras.applications.efficientnet import preprocess_input as eff_preprocess
from tensorflow.keras.applications.imagenet_utils import decode_predictions

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "my_dataset"
EXCESS_DIR = ROOT / "my_dataset_excess"

CATEGORIES = ["potholes", "drainage", "streetlight", "others"]

# Glob patterns covering all common image extensions (case variants)
IMAGE_GLOBS = ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG"]


def collect_images(directory: Path) -> list:
    """Return sorted list of all image paths in directory across all extensions."""
    seen = set()
    files = []
    for pattern in IMAGE_GLOBS:
        for f in directory.glob(pattern):
            if f not in seen:
                seen.add(f)
                files.append(f)
    return sorted(files)


# ---------------------------------------------------------------------------
# Civic positive concepts (what we expect to see in top-5 ImageNet preds)
# ---------------------------------------------------------------------------
CIVIC_POSITIVE_CONCEPTS = {
    "potholes": [
        "road", "street", "highway", "pavement", "asphalt", "gravel",
        "cobblestone", "tarmac", "concrete", "pothole", "crater", "hole",
        "pit", "ditch", "trench", "curb", "gutter", "sidewalk", "alley",
        "intersection", "lane", "bridge", "overpass", "tunnel",
    ],
    "drainage": [
        # Deliberately tight -- generic water/flood/puddle removed to avoid
        # confusion with potholes that collect water
        "manhole", "sewer", "drain", "gutter", "pipe", "plumbing",
        "overflow", "blockage", "culvert", "grate", "curb",
    ],
    "streetlight": [
        "street", "road", "pole", "lamp", "light", "lantern", "torch",
        "beacon", "spotlight", "lamppost", "highway", "pavement",
        "urban", "city", "night", "dusk", "bulb",
    ],
    "others": [
        # broad -- just needs to be outdoor/civic-ish
        "road", "street", "building", "wall", "fence", "sidewalk",
        "tree", "bush", "park", "garden", "outdoor", "field",
        "garbage", "trash", "waste", "bin", "debris", "rubble",
        "construction", "scaffold", "crane", "excavator",
        "water", "pipe", "manhole", "graffiti",
    ],
}

# If top-1 prediction matches one of these AND probability > threshold -> reject
CIVIC_NEGATIVE_STRONG = [
    "suit", "jersey", "dress", "shirt", "coat", "tie",
    "laptop", "computer", "keyboard", "monitor", "phone", "remote_control",
    "desk", "chair", "sofa", "table", "shelf", "cabinet",
    "restaurant", "kitchen", "bedroom", "bathroom", "classroom",
    "face", "portrait", "selfie",
    "bottle", "cup", "bowl", "plate", "fork", "spoon",
    "book", "magazine", "newspaper",
    "screen", "television", "projector",
]

# ---------------------------------------------------------------------------
# Pass 4: Boundary confusion concept lists
# ---------------------------------------------------------------------------
DRAINAGE_FALSE_CONCEPTS = ["pothole", "asphalt", "road_damage", "crack", "tarmac"]
DRAINAGE_ANCHOR_CONCEPTS = ["drain", "manhole", "sewer", "grate", "culvert", "gutter", "pipe"]

POTHOLES_FALSE_CONCEPTS = ["water", "flooding", "flood", "puddle", "lake", "river", "pool"]
POTHOLES_ANCHOR_CONCEPTS = ["pothole", "road", "asphalt", "pavement", "street", "concrete",
                             "tarmac", "gravel", "highway", "pit", "crater", "hole"]

HASH_THRESHOLD = 8
MIN_SIZE = 128
CIVIC_NEG_THRESHOLD = 0.60
CIVIC_POS_MIN_PROB = 0.05

# Global stats accumulator
REJECTION_STATS: dict = defaultdict(lambda: defaultdict(list))


def load_imagenet_model():
    print("Loading EfficientNetB0 for civic relevance check...")
    model = EfficientNetB0(weights="imagenet", include_top=True)
    print("  EfficientNetB0 loaded.")
    return model


def phash(img):
    """Compute perceptual hash of an image."""
    try:
        import imagehash
        return imagehash.phash(img)
    except ImportError:
        small = img.resize((16, 16)).convert("L")
        arr = np.array(small)
        return arr > arr.mean()


def hashes_are_duplicate(h1, h2):
    """Check if two hashes represent near-duplicate images."""
    try:
        import imagehash
        return (h1 - h2) < HASH_THRESHOLD
    except (ImportError, TypeError):
        if isinstance(h1, np.ndarray) and isinstance(h2, np.ndarray):
            return np.sum(h1 != h2) < 20
        return False


def pass1_dedup(category, apply=False):
    """Remove near-duplicate images within a category."""
    src_dir = DATA_DIR / category
    files = collect_images(src_dir)
    print(f"\n[{category}] Pass 1 -- Dedup: checking {len(files)} files...")

    hashes = {}
    dups = []

    for f in files:
        try:
            img = Image.open(f).convert("RGB")
            h = phash(img)
            is_dup = False
            for existing_file, existing_hash in hashes.items():
                if hashes_are_duplicate(h, existing_hash):
                    dups.append(f)
                    is_dup = True
                    break
            if not is_dup:
                hashes[f] = h
        except Exception:
            dups.append(f)

    excess_dir = EXCESS_DIR / category
    excess_dir.mkdir(parents=True, exist_ok=True)

    for f in dups:
        if apply:
            shutil.move(str(f), str(excess_dir / ("dup_" + f.name)))
        else:
            print(f"  [DRY] would remove dup: {f.name}")
        REJECTION_STATS[category]["pass1_dedup"].append(f.name)

    print(f"  >> {len(dups)} duplicates {'moved' if apply else 'found (dry-run)'}")
    return len(dups)


def pass2_min_resolution(category, apply=False):
    """Remove images below minimum resolution."""
    src_dir = DATA_DIR / category
    files = collect_images(src_dir)
    print(f"\n[{category}] Pass 2 -- Min resolution ({MIN_SIZE}px): checking {len(files)} files...")

    small = []
    for f in files:
        try:
            img = Image.open(f)
            w, h = img.size
            if min(w, h) < MIN_SIZE:
                small.append((f, f"{w}x{h}"))
        except Exception:
            small.append((f, "unreadable"))

    excess_dir = EXCESS_DIR / category
    excess_dir.mkdir(parents=True, exist_ok=True)

    for f, reason in small:
        if apply:
            shutil.move(str(f), str(excess_dir / ("small_" + f.name)))
        else:
            print(f"  [DRY] would remove small ({f.name}) size={reason}")
        REJECTION_STATS[category]["pass2_resolution"].append(f"{f.name} [{reason}]")

    print(f"  >> {len(small)} small images {'moved' if apply else 'found (dry-run)'}")
    return len(small)


def pass3_civic_relevance(category, model, batch=32, apply=False):
    """Remove images that do not represent outdoor/civic scenes."""
    src_dir = DATA_DIR / category
    files = collect_images(src_dir)
    print(f"\n[{category}] Pass 3 -- Civic relevance (EfficientNetB0): checking {len(files)} files...")

    positive_concepts = CIVIC_POSITIVE_CONCEPTS.get(category, [])
    rejected = []
    buf, paths = [], []

    def flush():
        if not buf:
            return
        arr = np.stack([np.array(im.resize((224, 224))) for im in buf])
        arr = eff_preprocess(arr.astype("float32"))
        preds = model.predict(arr, verbose=0)
        top5_all = decode_predictions(preds, top=5)
        for p, top5 in zip(paths, top5_all):
            top1_name = top5[0][1].lower()
            top1_prob = float(top5[0][2])

            is_negative = any(neg in top1_name for neg in CIVIC_NEGATIVE_STRONG)
            if is_negative and top1_prob >= CIVIC_NEG_THRESHOLD:
                reason = f"negative:{top1_name}({top1_prob:.2f})"
                rejected.append((p, reason))
                REJECTION_STATS[category]["pass3_negative"].append(f"{p.name}: {reason}")
                continue

            has_positive = False
            for _, name, prob in top5:
                name_lower = name.lower()
                if float(prob) >= CIVIC_POS_MIN_PROB:
                    for concept in positive_concepts:
                        if concept in name_lower:
                            has_positive = True
                            break
                if has_positive:
                    break

            if not has_positive:
                top_str = ", ".join(f"{n}({float(pr):.2f})" for _, n, pr in top5[:3])
                reason = f"no_civic_concept:[{top_str}]"
                rejected.append((p, reason))
                REJECTION_STATS[category]["pass3_no_civic"].append(f"{p.name}: {reason}")

        buf.clear()
        paths.clear()

    for f in files:
        try:
            im = Image.open(f).convert("RGB")
            buf.append(im)
            paths.append(f)
            if len(buf) >= batch:
                flush()
        except Exception:
            rejected.append((f, "corrupt"))
            REJECTION_STATS[category]["pass3_corrupt"].append(f.name)
    flush()

    excess_dir = EXCESS_DIR / category
    excess_dir.mkdir(parents=True, exist_ok=True)

    for f, reason in rejected:
        if apply:
            shutil.move(str(f), str(excess_dir / ("irrelevant_" + f.name)))
        else:
            print(f"  [DRY] would remove: {f.name}  reason={reason}")

    print(f"  >> {len(rejected)} irrelevant images {'moved' if apply else 'found (dry-run)'}")
    return len(rejected)


def _top3_names(top5):
    """Extract lowercased name strings from top-3 decode_predictions entries."""
    return [entry[1].lower() for entry in top5[:3]]


def pass4_boundary_confusion(category, model, batch=32, apply=False):
    """
    Reject drainage/potholes images that appear mislabelled or strongly
    ambiguous with the neighbouring category.
    """
    if category not in ("drainage", "potholes"):
        return 0

    src_dir = DATA_DIR / category
    files = collect_images(src_dir)
    print(f"\n[{category}] Pass 4 -- Boundary confusion check: checking {len(files)} files...")

    if category == "drainage":
        false_concepts = DRAINAGE_FALSE_CONCEPTS
        anchor_concepts = DRAINAGE_ANCHOR_CONCEPTS
        reject_label = "pothole_cue_no_drain_anchor"
    else:
        false_concepts = POTHOLES_FALSE_CONCEPTS
        anchor_concepts = POTHOLES_ANCHOR_CONCEPTS
        reject_label = "water_primary_no_road_anchor"

    rejected = []
    buf, paths = [], []

    def flush():
        if not buf:
            return
        arr = np.stack([np.array(im.resize((224, 224))) for im in buf])
        arr = eff_preprocess(arr.astype("float32"))
        preds = model.predict(arr, verbose=0)
        top5_all = decode_predictions(preds, top=5)
        for p, top5 in zip(paths, top5_all):
            names = _top3_names(top5)
            has_false = any(any(fc in n for fc in false_concepts) for n in names)
            has_anchor = any(any(ac in n for ac in anchor_concepts) for n in names)
            if has_false and not has_anchor:
                top_str = ", ".join(
                    f"{entry[1]}({float(entry[2]):.2f})" for entry in top5[:3]
                )
                reason = f"{reject_label}:[{top_str}]"
                rejected.append((p, reason))
                REJECTION_STATS[category]["pass4_boundary"].append(f"{p.name}: {reason}")
        buf.clear()
        paths.clear()

    for f in files:
        try:
            im = Image.open(f).convert("RGB")
            buf.append(im)
            paths.append(f)
            if len(buf) >= batch:
                flush()
        except Exception:
            pass
    flush()

    excess_dir = EXCESS_DIR / category
    excess_dir.mkdir(parents=True, exist_ok=True)

    for f, reason in rejected:
        if apply:
            shutil.move(str(f), str(excess_dir / ("boundary_" + f.name)))
        else:
            print(f"  [DRY] would remove: {f.name}  reason={reason}")

    print(f"  >> {len(rejected)} boundary-confused images {'moved' if apply else 'found (dry-run)'}")
    return len(rejected)


def print_stats():
    print(f"\n{'='*65}")
    print("  DETAILED REJECTION STATS")
    print(f"{'='*65}")
    if not REJECTION_STATS:
        print("  No rejections recorded.")
        return
    for category, passes in REJECTION_STATS.items():
        total = sum(len(v) for v in passes.values())
        print(f"\n  [{category}] -- {total} total rejections")
        for pass_name, items in passes.items():
            print(f"    {pass_name}: {len(items)} rejected")
            for item in items[:10]:
                print(f"      - {item}")
            if len(items) > 10:
                print(f"      ... and {len(items) - 10} more")


def main():
    ap = argparse.ArgumentParser(
        description="Smart dataset filter: dedup + resolution + civic relevance + boundary check"
    )
    ap.add_argument("--category", choices=CATEGORIES + ["all"], default="all")
    ap.add_argument("--apply", action="store_true",
                    help="Actually move rejected files (default: dry-run only)")
    ap.add_argument("--skip-dedup", action="store_true", help="Skip Pass 1 dedup")
    ap.add_argument("--skip-rescheck", action="store_true", help="Skip Pass 2 resolution check")
    ap.add_argument("--skip-relevance", action="store_true", help="Skip Pass 3 civic relevance")
    ap.add_argument("--skip-boundary-check", action="store_true",
                    help="Skip Pass 4 boundary confusion check (drainage/potholes only)")
    ap.add_argument("--stats", action="store_true",
                    help="Print detailed per-pass rejection stats after filtering")
    args = ap.parse_args()

    if args.apply:
        print("=== APPLY MODE -- files will be moved to my_dataset_excess/ ===\n")
    else:
        print("=== DRY RUN MODE -- no files will be moved (use --apply to apply) ===\n")

    cats = CATEGORIES if args.category == "all" else [args.category]

    model = None
    needs_model = not args.skip_relevance or not args.skip_boundary_check
    if needs_model:
        model = load_imagenet_model()

    summary = {}
    for c in cats:
        print(f"\n{'='*55}")
        print(f"  Filtering: {c}")
        print(f"{'='*55}")

        before = len(collect_images(DATA_DIR / c))
        d = r = s = b = 0

        if not args.skip_dedup:
            d = pass1_dedup(c, apply=args.apply)
        if not args.skip_rescheck:
            r = pass2_min_resolution(c, apply=args.apply)
        if not args.skip_relevance and model is not None:
            s = pass3_civic_relevance(c, model, apply=args.apply)
        if not args.skip_boundary_check and model is not None:
            b = pass4_boundary_confusion(c, model, apply=args.apply)

        after = len(collect_images(DATA_DIR / c))
        summary[c] = {
            "before": before,
            "after": after,
            "dedup": d,
            "resolution": r,
            "relevance": s,
            "boundary": b,
            "removed": d + r + s + b,
        }

    print(f"\n{'='*70}")
    print("  SUMMARY")
    print(f"{'='*70}")
    print(f"{'Category':<14} {'Before':>7} {'Dedup':>6} {'Resol':>6} {'Relev':>6} {'Bound':>6} {'After':>7}")
    print("-" * 70)
    for c, s in summary.items():
        print(
            f"  {c:<14} {s['before']:>5}"
            f"  {s['dedup']:>4}"
            f"  {s['resolution']:>4}"
            f"  {s['relevance']:>4}"
            f"  {s['boundary']:>4}"
            f"  {s['after']:>5}"
        )

    if args.stats:
        print_stats()

    if not args.apply:
        print("\n[DRY RUN -- run with --apply to actually filter]")
    else:
        print("\nFiltering complete.")


if __name__ == "__main__":
    main()
