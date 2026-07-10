"""
download_others_dataset.py
==========================
Downloads a diverse 'others' catch-all civic-issue image dataset using:
  PRIMARY : icrawler (BingImageCrawler + GoogleImageCrawler)

Sub-categories and targets:
  garbage_dumping       : 150 images
  graffiti              : 100 images
  fallen_trees          : 100 images
  construction_debris   : 100 images
  broken_sidewalk       : 100 images
  stray_animals         :  80 images
  broken_infrastructure :  80 images
  encroachment          :  80 images
  waterlogging_misc     :  80 images
  public_property_damage:  80 images
  Total target          : ~950 images

All images saved as JPEG to my_dataset/others/
Named: oth_<4-char-prefix>_NNNN.jpg
"""

import os
import sys
import shutil
import subprocess
from datetime import datetime
from pathlib import Path


# ---------------------------------------------------------------------------
# 0. Auto-install missing packages
# ---------------------------------------------------------------------------
def pip_install(*packages):
    for pkg in packages:
        mod = pkg.split("[")[0].replace("-", "_")
        try:
            __import__(mod)
        except ImportError:
            print(f"[INSTALL] Installing {pkg} ...")
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet", pkg]
            )


pip_install("icrawler", "imagehash", "Pillow")

from PIL import Image
import imagehash

# ---------------------------------------------------------------------------
# 1. Sub-category definitions
# ---------------------------------------------------------------------------
SUBCATEGORIES = {
    "garbage_dumping": {
        "prefix": "garb",
        "target": 150,
        "queries": [
            "illegal garbage dump footpath india",
            "waste pile public road india",
            "garbage littering india civic issue",
            "open garbage dump india residential",
            "litter public property india",
        ],
    },
    "graffiti": {
        "prefix": "graf",
        "target": 100,
        "queries": [
            "graffiti vandalism public wall india",
            "spray paint public property india",
            "vandalized wall india city",
            "defaced public signboard india",
        ],
    },
    "fallen_trees": {
        "prefix": "tree",
        "target": 100,
        "queries": [
            "fallen tree blocking road india",
            "uprooted tree road india storm",
            "broken tree branch road india",
            "tree fallen on road india after rain",
        ],
    },
    "construction_debris": {
        "prefix": "cons",
        "target": 100,
        "queries": [
            "construction debris blocking road india",
            "illegal construction waste footpath india",
            "building material dumped road india",
            "rubble blocking public road india",
        ],
    },
    "broken_sidewalk": {
        "prefix": "side",
        "target": 100,
        "queries": [
            "broken footpath tiles india city",
            "damaged sidewalk india civic",
            "cracked pavement footpath india",
            "uneven broken footpath india",
        ],
    },
    "stray_animals": {
        "prefix": "stra",
        "target": 80,
        "queries": [
            "stray dog menace road india city",
            "stray cattle blocking road india",
            "cow on road india urban",
            "stray animals public area india",
        ],
    },
    "broken_infrastructure": {
        "prefix": "infr",
        "target": 80,
        "queries": [
            "broken public bench india park",
            "damaged bus stop shelter india",
            "broken compound wall india civic",
            "damaged public infrastructure india",
        ],
    },
    "encroachment": {
        "prefix": "encr",
        "target": 80,
        "queries": [
            "footpath encroachment india shops",
            "illegal stall footpath india blocked",
            "vendors blocking footpath india",
            "encroachment public road india",
        ],
    },
    "waterlogging_misc": {
        "prefix": "wlog",
        "target": 80,
        "queries": [
            "waterlogged street india after rain",
            "road flooded after rain india",
            "standing water road india monsoon",
            "waterlogging india civic complaint",
        ],
    },
    "public_property_damage": {
        "prefix": "pubp",
        "target": 80,
        "queries": [
            "broken compound wall india road",
            "vandalized public signboard india",
            "damaged public property india",
            "broken wall india civic complaint",
        ],
    },
}

# ---------------------------------------------------------------------------
# 2. Global settings
# ---------------------------------------------------------------------------
OUTPUT_DIR = Path("my_dataset/others")
TEMP_BASE  = Path("_tmp_others_crawl")

PER_QUERY_LIMIT  = 30    # images per engine per query

MIN_WIDTH  = 100
MIN_HEIGHT = 100
MIN_FILE_SIZE_BYTES = 6 * 1024   # 6 KB
MIN_ASPECT = 0.2
MAX_ASPECT = 5.0
JPEG_QUALITY = 85
HASH_DISTANCE_THRESHOLD = 8     # hamming < 8 => duplicate (global across all sub-cats)


# ---------------------------------------------------------------------------
# 3. Helpers
# ---------------------------------------------------------------------------

def quality_ok(img_path: Path) -> bool:
    """Return True if image passes all quality gates."""
    try:
        if img_path.stat().st_size < MIN_FILE_SIZE_BYTES:
            return False
        with Image.open(img_path) as img:
            w, h = img.size
            if w < MIN_WIDTH or h < MIN_HEIGHT:
                return False
            ratio = w / h
            if not (MIN_ASPECT <= ratio <= MAX_ASPECT):
                return False
        return True
    except Exception:
        return False


def compute_phash(img_path: Path):
    try:
        with Image.open(img_path) as img:
            return imagehash.phash(img)
    except Exception:
        return None


def convert_to_jpeg(src: Path, dst: Path) -> bool:
    try:
        with Image.open(src) as img:
            img.convert("RGB").save(dst, "JPEG", quality=JPEG_QUALITY)
        return True
    except Exception:
        return False


def safe_rmtree(path: Path):
    try:
        if path.exists():
            shutil.rmtree(path)
    except Exception as e:
        print(f"  [WARN] Could not remove {path}: {e}")


# ---------------------------------------------------------------------------
# 4. Crawl with icrawler
# ---------------------------------------------------------------------------

def crawl_query(query: str, out_dir: Path, num: int):
    """Run Bing + Google crawlers for one query into out_dir."""
    from icrawler.builtin import BingImageCrawler, GoogleImageCrawler

    out_dir.mkdir(parents=True, exist_ok=True)
    half = max(1, num // 2)

    for engine_name, CrawlerClass in [("Bing", BingImageCrawler), ("Google", GoogleImageCrawler)]:
        try:
            crawler = CrawlerClass(
                storage={"root_dir": str(out_dir)},
                feeder_threads=1,
                parser_threads=1,
                downloader_threads=4,
                log_level=50,   # CRITICAL - suppress icrawler noise
            )
            crawler.crawl(
                keyword=query,
                max_num=half,
                min_size=(MIN_WIDTH, MIN_HEIGHT),
                file_idx_offset="auto",
            )
        except Exception as e:
            print(f"      [{engine_name}] Error: {e}")


# ---------------------------------------------------------------------------
# 5. Process a raw directory for a specific sub-category
# ---------------------------------------------------------------------------

def process_raw_dir(
    raw_dir: Path,
    prefix: str,
    seen_hashes: list,
    cat_counter: list,
    target: int,
    source: str = "crawl",
):
    """
    Walk raw_dir, apply quality + dedup filters, copy to OUTPUT_DIR.
    Files are named: oth_<prefix>_NNNN.jpg
    cat_counter[0] tracks current count for THIS sub-category.
    seen_hashes is GLOBAL across all sub-categories to prevent cross-cat dups.
    """
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"}
    candidates = [
        p for p in raw_dir.rglob("*")
        if p.suffix.lower() in exts and p.is_file()
    ]

    accepted = rq = rd = 0

    for img_path in candidates:
        if cat_counter[0] >= target:
            break

        # Quality filter
        if not quality_ok(img_path):
            rq += 1
            continue

        # Perceptual dedup
        ph = compute_phash(img_path)
        if ph is None:
            continue
        if any(abs(ph - h) < HASH_DISTANCE_THRESHOLD for h in seen_hashes):
            rd += 1
            continue

        # Convert & save
        n = cat_counter[0] + 1
        dst = OUTPUT_DIR / f"oth_{prefix}_{n:04d}.jpg"
        if convert_to_jpeg(img_path, dst):
            seen_hashes.append(ph)
            cat_counter[0] = n
            accepted += 1

    print(
        f"      [{source}] +{accepted} accepted | "
        f"-{rq} quality | -{rd} dup"
    )


# ---------------------------------------------------------------------------
# 6. Backup existing others/ before clearing
# ---------------------------------------------------------------------------

def backup_existing_others():
    if not OUTPUT_DIR.exists() or not any(OUTPUT_DIR.iterdir()):
        return  # nothing to back up

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = OUTPUT_DIR.parent / f"others_backup_{ts}"
    print(f"\n[BACKUP] Existing others/ -> {backup_path}")
    try:
        shutil.copytree(str(OUTPUT_DIR), str(backup_path))
        print(f"  [BACKUP] Done: {backup_path}")
    except Exception as e:
        print(f"  [BACKUP] Failed: {e}")


# ---------------------------------------------------------------------------
# 7. Main
# ---------------------------------------------------------------------------

def main():
    total_target = sum(v["target"] for v in SUBCATEGORIES.values())
    print("=" * 70)
    print(f"  Others Dataset Downloader - {len(SUBCATEGORIES)} sub-categories")
    print(f"  Total target: ~{total_target} images")
    print("=" * 70)

    # Backup and clear
    backup_existing_others()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_BASE.mkdir(parents=True, exist_ok=True)

    # Global perceptual hash list to prevent cross-category duplicates
    seen_hashes: list = []

    grand_total = 0

    for cat_idx, (cat_name, cat_cfg) in enumerate(SUBCATEGORIES.items(), 1):
        prefix  = cat_cfg["prefix"]
        target  = cat_cfg["target"]
        queries = cat_cfg["queries"]

        print(f"\n{'='*70}")
        print(f"  [{cat_idx}/{len(SUBCATEGORIES)}] Sub-category: {cat_name}")
        print(f"  Prefix: oth_{prefix}_NNNN.jpg | Target: {target} images")
        print(f"{'='*70}")

        cat_counter = [0]   # per-sub-category count

        for q_idx, query in enumerate(queries, 1):
            if cat_counter[0] >= target:
                print(f"  [DONE] Reached target for '{cat_name}' early.")
                break

            print(f"\n  [{q_idx}/{len(queries)}] Query: '{query}'")
            print(f"  Progress [{cat_name}]: {cat_counter[0]}/{target}")

            slug = f"{prefix}_{query.replace(' ', '_')[:30]}"
            raw_dir = TEMP_BASE / f"c{cat_idx:02d}q{q_idx:02d}_{slug}"

            crawl_query(query, raw_dir, PER_QUERY_LIMIT)
            process_raw_dir(
                raw_dir, prefix, seen_hashes, cat_counter, target,
                source=f"{cat_name}-q{q_idx}"
            )
            safe_rmtree(raw_dir)

            print(f"  Running [{cat_name}]: {cat_counter[0]}/{target}")

        grand_total += cat_counter[0]
        pct = int(cat_counter[0] / target * 100) if target > 0 else 0
        print(f"\n  [{cat_name}] COMPLETE: {cat_counter[0]}/{target} images ({pct}%)")

    # Cleanup
    safe_rmtree(TEMP_BASE)
    print("\n[CLEANUP] Temp directories removed.")

    # Final summary
    final_files = list(OUTPUT_DIR.glob("oth_*.jpg"))
    print("\n" + "=" * 70)
    print(f"  DONE - {len(final_files)} total images saved to: {OUTPUT_DIR.resolve()}")
    print(f"  Target was: ~{total_target}")

    # Per-category breakdown
    print("\n  Per-category breakdown:")
    for cat_name, cat_cfg in SUBCATEGORIES.items():
        prefix = cat_cfg["prefix"]
        count  = len(list(OUTPUT_DIR.glob(f"oth_{prefix}_*.jpg")))
        target = cat_cfg["target"]
        pct    = int(count / target * 100) if target > 0 else 0
        status = "OK" if count >= target else "LOW"
        print(f"    [{status}] {cat_name:<25} {count:>4}/{target} ({pct}%)")

    print("=" * 70)


if __name__ == "__main__":
    main()
