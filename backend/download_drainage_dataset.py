"""
download_drainage_dataset.py
============================
Downloads a high-quality drainage-specific image dataset using:
  PRIMARY  : icrawler (BingImageCrawler + GoogleImageCrawler)
  FALLBACK : Kaggle datasets
Applies strict quality filters, perceptual deduplication, and saves
all images as JPEG to  my_dataset/drainage/drain_NNNN.jpg
"""

import os
import sys
import shutil
import subprocess
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


pip_install("icrawler", "imagehash", "Pillow", "kaggle")

from PIL import Image
import imagehash

# ---------------------------------------------------------------------------
# 1. Configuration
# ---------------------------------------------------------------------------
OUTPUT_DIR = Path("my_dataset/drainage")
TEMP_BASE  = Path("_tmp_drain_crawl")

TARGET_TOTAL = 800
PER_QUERY_LIMIT = 60          # images to request per query per engine

MIN_WIDTH  = 100
MIN_HEIGHT = 100
MIN_FILE_SIZE_BYTES = 8 * 1024   # 8 KB
MIN_ASPECT = 0.2
MAX_ASPECT = 5.0
JPEG_QUALITY = 85
HASH_DISTANCE_THRESHOLD = 8      # hamming distance < 8 => duplicate

SEARCH_QUERIES = [
    "blocked drain overflowing india road",
    "choked manhole cover road india",
    "open manhole hazard india civic",
    "sewer overflow blocked gutter india",
    "storm drain clogged street india",
    "broken manhole cover india road",
    "waterlogged gutter road india drainage",
    "clogged storm drain city street",
    "manhole open uncovered urban road",
    "flooded drain blocked sewer",
    "drainage pipe burst road civic",
    "sewage overflow road india",
    "drain grill broken india city",
    "water stagnation blocked drain india",
    "nullah blocked india flood",
]

ACCEPT_KEYWORDS = {"drain", "sewer", "manhole", "gutter", "overflow"}
REJECT_KEYWORDS = {"pothole", "crack", "car", "vehicle", "traffic", "face", "person"}

KAGGLE_FALLBACK_DATASETS = [
    ("niharikachede", "urban-drainage-system-images"),
    ("sovitrath",     "road-damage-dataset"),
]

# ---------------------------------------------------------------------------
# 2. Helpers
# ---------------------------------------------------------------------------

def keyword_ok(path: str) -> bool:
    """Reject images whose filename paths contain any reject keyword."""
    lp = path.lower()
    if any(k in lp for k in REJECT_KEYWORDS):
        return False
    return True


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
# 3. Crawl with icrawler (PRIMARY)
# ---------------------------------------------------------------------------

def crawl_query(query: str, out_dir: Path, num: int):
    """Run Bing + Google crawlers for a single query, save raw images to out_dir."""
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
            print(f"    [{engine_name}] Error for '{query}': {e}")


# ---------------------------------------------------------------------------
# 4. Kaggle fallback (SECONDARY)
# ---------------------------------------------------------------------------

def try_kaggle_fallback(needed: int, seen_hashes: list, counter: list):
    print(f"\n[KAGGLE] Attempting fallback - need {needed} more images ...")
    try:
        import kaggle
        kaggle.api.authenticate()
    except Exception as e:
        print(f"  [KAGGLE] Not available ({e}) - skipping.")
        return

    for owner, dataset in KAGGLE_FALLBACK_DATASETS:
        if counter[0] >= TARGET_TOTAL:
            break
        dl_dir = TEMP_BASE / f"kaggle_{owner}_{dataset}"
        dl_dir.mkdir(parents=True, exist_ok=True)
        try:
            print(f"  [KAGGLE] Downloading {owner}/{dataset} ...")
            kaggle.api.dataset_download_files(
                f"{owner}/{dataset}", path=str(dl_dir), unzip=True, quiet=True
            )
            process_raw_dir(dl_dir, seen_hashes, counter, source="kaggle")
        except Exception as e:
            print(f"  [KAGGLE] Failed {owner}/{dataset}: {e}")
        finally:
            safe_rmtree(dl_dir)


# ---------------------------------------------------------------------------
# 5. Process a raw directory of downloaded images
# ---------------------------------------------------------------------------

def process_raw_dir(raw_dir: Path, seen_hashes: list, counter: list, source: str = "crawl"):
    """Walk raw_dir, apply quality + keyword + dedup filters, and copy to OUTPUT_DIR."""
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"}
    candidates = [
        p for p in raw_dir.rglob("*")
        if p.suffix.lower() in exts and p.is_file()
    ]

    accepted = rq = rk = rd = 0

    for img_path in candidates:
        if counter[0] >= TARGET_TOTAL:
            break

        # 1. Keyword filter
        if not keyword_ok(str(img_path)):
            rk += 1
            continue

        # 2. Quality filter
        if not quality_ok(img_path):
            rq += 1
            continue

        # 3. Perceptual dedup (imagehash)
        ph = compute_phash(img_path)
        if ph is None:
            continue
        if any(abs(ph - h) < HASH_DISTANCE_THRESHOLD for h in seen_hashes):
            rd += 1
            continue

        # 4. Convert & save
        n = counter[0] + 1
        dst = OUTPUT_DIR / f"drain_{n:04d}.jpg"
        if convert_to_jpeg(img_path, dst):
            seen_hashes.append(ph)
            counter[0] = n
            accepted += 1

    print(
        f"    [{source}] +{accepted} accepted | "
        f"-{rq} quality | -{rk} keyword | -{rd} dup"
    )


# ---------------------------------------------------------------------------
# 6. Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 65)
    print(f"  Drainage Dataset Downloader - TARGET: {TARGET_TOTAL} images")
    print("=" * 65)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_BASE.mkdir(parents=True, exist_ok=True)

    seen_hashes: list = []
    counter: list = [0]   # wrapped in list so closures can mutate it

    # ---- PRIMARY: icrawler per query -----------------------------------
    for idx, query in enumerate(SEARCH_QUERIES, 1):
        if counter[0] >= TARGET_TOTAL:
            print(f"\n[DONE] Reached target of {TARGET_TOTAL} images early.")
            break

        print(f"\n[{idx}/{len(SEARCH_QUERIES)}] Query: '{query}'")
        print(f"  Progress: {counter[0]}/{TARGET_TOTAL}")

        slug = query.replace(" ", "_")[:40]
        raw_dir = TEMP_BASE / f"q{idx:02d}_{slug}"

        crawl_query(query, raw_dir, PER_QUERY_LIMIT)
        process_raw_dir(raw_dir, seen_hashes, counter, source=f"crawl-q{idx}")
        safe_rmtree(raw_dir)

        print(f"  Running total: {counter[0]}/{TARGET_TOTAL}")

    # ---- FALLBACK: Kaggle ----------------------------------------------
    if counter[0] < TARGET_TOTAL:
        try_kaggle_fallback(TARGET_TOTAL - counter[0], seen_hashes, counter)

    # ---- Cleanup -------------------------------------------------------
    safe_rmtree(TEMP_BASE)
    print("\n[CLEANUP] Temp directories removed.")

    # ---- Summary -------------------------------------------------------
    final_count = len(list(OUTPUT_DIR.glob("drain_*.jpg")))
    print("\n" + "=" * 65)
    print(f"  DONE - {final_count} images saved to: {OUTPUT_DIR.resolve()}")
    if final_count < TARGET_TOTAL:
        print(f"  [WARN] Target {TARGET_TOTAL}; collected {final_count}.")
        print("         Try running again or expanding queries/limits.")
    print("=" * 65)


if __name__ == "__main__":
    main()
