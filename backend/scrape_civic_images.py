"""
scrape_civic_images.py  — Download civic issue images via web search.

Uses icrawler (Bing + Google engine) with multiple targeted search queries
per category. Designed to replace gated Kaggle datasets.

Usage:
  python scrape_civic_images.py --category drainage --count 800
  python scrape_civic_images.py --category others   --count 1000
  python scrape_civic_images.py --all               (runs all categories needing refresh)

Output:
  Images copied into my_dataset/<category>/  as <prefix>_scrape_NNNN.jpg
"""

import argparse
import os
import shutil
import sys
import time
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "my_dataset"

# ---------------------------------------------------------------------------
# Targeted search queries per category
# The more specific the query, the better the signal-to-noise.
# ---------------------------------------------------------------------------

QUERIES = {
    "drainage": [
        # India-specific — actual civic drainage issues (NOT road flooding)
        "clogged storm drain road india",
        "blocked manhole cover overflowing india",
        "flooded gutter urban india civic",
        "sewer overflow blocked drain india",
        "open manhole road india hazard",
        "choked drain water stagnation india",
        "overflowing drainage ditch india",
        "broken manhole cover road india",
        "roadside gutter blocked india civic issue",
        "drain pipe burst road india",
        "sewage overflow road india city",
        "drain grill broken road india",
        "nullah blocked india civic complaint",
        "storm drain clogged urban india",
        "uncovered manhole road india danger",
        "waterlogged gutter india road blocked",
        "blocked drain water overflow india road",
        "street gutter overflow india civic",
        "manhole cover missing road india",
        "drain cover broken india road hazard",
        # International (visual diversity — actual drainage, not flooding)
        "clogged storm drain city road",
        "blocked drain manhole cover open",
        "broken drain cover street hazard",
        "overflowing street gutter urban",
        "sewer grate blocked debris road",
    ],
    "others": [
        # Graffiti / vandalism
        "graffiti vandalism wall public india",
        "spray paint public wall urban india",
        "defaced wall india city civic",
        "vandalized public property india",
        "spray graffiti bus shelter india",
        # Encroachment / illegal construction
        "illegal encroachment footpath india urban",
        "footpath blocked encroachment india shops",
        "hawkers blocking sidewalk india",
        "vendors footpath india blocked civic",
        # Fallen trees / storm debris
        "fallen tree road india after storm",
        "uprooted tree road india blocking",
        "broken branch road blockage india",
        "tree fallen on road india",
        "storm damage fallen tree street india",
        # Construction debris
        "construction debris road india civic",
        "building material dumped road india",
        "rubble blocking public road india",
        "sand road construction blockage india",
        # Garbage / dumping (diverse)
        "illegal garbage dump public land india",
        "waste pile footpath india civic issue",
        "garbage littering road india",
        "open garbage dump india residential area",
        # Broken infrastructure
        "broken bench public park india",
        "damaged footpath sidewalk india civic",
        "broken compound wall india road",
        "damaged bus stop shelter india",
        # Stray animals public nuisance
        "stray dog road india menace",
        "stray cattle road india blocking",
        "stray cow urban road india",
        # Noise pollution
        "loudspeaker pole india public nuisance",
        # Waterlogging misc (not drain-specific)
        "waterlogged road india after rain",
        "standing water road india monsoon",
        # Public property damage
        "broken signboard road india civic",
        "vandalized signboard india",
        "broken wall india civic complaint",
        # Others — catch-all civic
        "public infrastructure damage india city",
        "civic issue complaint india urban problem",
    ],
    "potholes": [
        "pothole road india city",
        "road crater pothole bangalore india",
        "deep pothole urban road india",
        "road damage pothole india monsoon",
        "pothole water filled road india",
        "bad road pothole india city",
        "road excavation hole india civic",
        "pothole damaged road india",
        "large pothole dangerous road india",
        "road surface damage pothole india",
    ],
    "streetlight": [
        "broken street light india dark road",
        "streetlight pole damaged india",
        "street lamp not working india",
        "dangling electric wire pole india",
        "broken lamp post india road",
        "street light not working india night",
        "damaged street light pole india city",
        "fused street light india dark road",
        "broken electric pole road india",
        "dark street no light india",
    ],
}

MIN_FILE_BYTES = 8000
TARGET_SIZE = (224, 224)


def install_if_needed(pkg):
    """Install a package if missing."""
    try:
        __import__(pkg.split("[")[0].replace("-", "_"))
    except ImportError:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", pkg, "-q"], check=True)


def filter_image(path: Path) -> bool:
    """Basic quality filter: minimum size and valid image."""
    if not path.exists():
        return False
    if path.stat().st_size < MIN_FILE_BYTES:
        return False
    try:
        from PIL import Image
        with Image.open(path) as img:
            w, h = img.size
            # Skip tiny thumbnails
            if w < 100 or h < 100:
                return False
            # Skip very wide/tall banners
            ratio = w / h
            if ratio > 5 or ratio < 0.2:
                return False
        return True
    except Exception:
        return False


def scrape_bing(query: str, dest: Path, count: int = 50):
    """Scrape images using icrawler's Bing engine."""
    from icrawler.builtin import BingImageCrawler
    dest.mkdir(parents=True, exist_ok=True)
    try:
        crawler = BingImageCrawler(
            storage={"root_dir": str(dest)},
            log_level=40,  # ERROR only
        )
        crawler.crawl(
            keyword=query,
            max_num=count,
            min_size=(100, 100),
            file_idx_offset="auto",
        )
    except Exception as e:
        print(f"    Bing crawl failed for '{query}': {e}")


def scrape_google(query: str, dest: Path, count: int = 50):
    """Scrape images using icrawler's Google engine."""
    from icrawler.builtin import GoogleImageCrawler
    dest.mkdir(parents=True, exist_ok=True)
    try:
        crawler = GoogleImageCrawler(
            storage={"root_dir": str(dest)},
            log_level=40,
        )
        crawler.crawl(
            keyword=query,
            max_num=count,
            file_idx_offset="auto",
        )
    except Exception as e:
        print(f"    Google crawl failed for '{query}': {e}")


def scrape_category(category: str, target_count: int, prefix: str = "scrape"):
    """Scrape images for a single category using all search queries."""
    queries = QUERIES.get(category, [])
    if not queries:
        print(f"[WARN] No queries defined for category '{category}'")
        return

    out_dir = DATA_DIR / category
    out_dir.mkdir(parents=True, exist_ok=True)

    # Temp directory for raw downloads
    temp_dir = ROOT / f"temp_scrape_{category}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    # How many images to request per query (distribute evenly + buffer for rejections)
    per_query = max(20, int(target_count * 1.5 / len(queries)))

    print(f"\n[{category.upper()}] Target: {target_count} images | {len(queries)} queries | {per_query}/query")

    query_temp_dirs = []
    for i, query in enumerate(queries):
        q_dir = temp_dir / f"q{i:02d}"
        print(f"  [{i+1}/{len(queries)}] Bing: '{query}' ...")
        scrape_bing(query, q_dir, count=per_query)

        # Also try Google for first half of queries
        if i < len(queries) // 2:
            q_dir_g = temp_dir / f"q{i:02d}_g"
            print(f"  [{i+1}/{len(queries)}] Google: '{query}' ...")
            scrape_google(query, q_dir_g, count=min(30, per_query))
            query_temp_dirs.append(q_dir_g)

        query_temp_dirs.append(q_dir)
        time.sleep(0.5)  # polite delay

    # Collect and filter all downloaded images
    all_images = []
    for d in query_temp_dirs:
        if d.exists():
            for ext in ("jpg", "jpeg", "png", "JPG", "JPEG", "PNG"):
                all_images.extend(d.glob(f"*.{ext}"))

    print(f"\n  Raw downloaded: {len(all_images)} images")

    # Filter quality
    accepted = [p for p in all_images if filter_image(p)]
    print(f"  After quality filter: {len(accepted)} images")

    # Deduplicate by file size (rough dedup)
    seen_sizes = set()
    deduped = []
    for p in accepted:
        sz = p.stat().st_size
        if sz not in seen_sizes:
            seen_sizes.add(sz)
            deduped.append(p)
    print(f"  After dedup: {len(deduped)} images")

    # Shuffle and select
    random.seed(42)
    random.shuffle(deduped)
    selected = deduped[:target_count]

    # Check existing count to continue numbering
    existing = sorted([
        f for f in out_dir.iterdir()
        if f.suffix.lower() in (".jpg", ".jpeg", ".png")
    ])
    start_idx = len(existing)

    # Copy to final directory
    copied = 0
    for j, src in enumerate(selected):
        suffix = src.suffix.lower()
        if suffix not in (".jpg", ".jpeg", ".png"):
            suffix = ".jpg"
        dest_path = out_dir / f"{prefix}_{start_idx + j:04d}{suffix}"
        try:
            # Convert to JPEG for consistency
            from PIL import Image
            with Image.open(src) as img:
                rgb = img.convert("RGB")
                dest_jpg = out_dir / f"{prefix}_{start_idx + j:04d}.jpg"
                rgb.save(dest_jpg, "JPEG", quality=85)
                copied += 1
        except Exception:
            try:
                shutil.copy2(src, dest_path)
                copied += 1
            except Exception as e:
                pass

    print(f"  [OK] Copied {copied} images to {out_dir}")

    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)

    # Final count
    final = sum(1 for f in out_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
    print(f"  Total in {category}/: {final} images")
    return copied


def main():
    ap = argparse.ArgumentParser(description="Scrape civic images via Bing/Google image search")
    ap.add_argument("--category", choices=list(QUERIES.keys()),
                    help="Category to scrape (single)")
    ap.add_argument("--count", type=int, default=600,
                    help="Target number of NEW images to add (default: 600)")
    ap.add_argument("--all", action="store_true",
                    help="Scrape drainage and others (the categories needing refresh)")
    args = ap.parse_args()

    if not args.category and not args.all:
        ap.print_help()
        sys.exit(1)

    install_if_needed("icrawler")
    install_if_needed("Pillow")

    if args.all:
        categories = ["drainage", "others"]
    else:
        categories = [args.category]

    print(f"Scraping categories: {categories}")
    print(f"Target per category: {args.count} new images\n")

    for cat in categories:
        scrape_category(cat, args.count, prefix="scrape")

    print("\n=== Scraping Complete ===")
    print("Next steps:")
    print("  python train_civic_model.py")


if __name__ == "__main__":
    main()
