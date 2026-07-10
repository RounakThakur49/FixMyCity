"""build_others_exemplars.py -- Offline CLIP exemplar embedding builder.

Owner: build_others_exemplars.py (IMPLEMENTATION_SPEC.md section 5a, owner E).
This file is NOT allowed to touch any other file. It only WRITES civic_exemplars.json.

WHAT IT DOES
------------
Builds per-category visual + textual exemplar embeddings used by the Node
open-set classifier (`others_clip.js`) to route "Others" complaints. For each
category it produces:

  * centroid          -- L2-normalized mean of all image embeddings
                         (falls back to the mean of text-prompt vectors when a
                         category has no source images)
  * image_exemplars   -- top-K image embeddings closest to the centroid
  * text_prompts      -- [{text, vector}] CLIP text embeddings of canonical
                         prompts for that category

All vectors are L2-normalized, length exactly CLIP_EMBED_DIM (512), emitted as
plain JSON arrays of floats. The output `civic_exemplars.json` schema is a
FROZEN CONTRACT consumed by others_clip.js -- do not change keys/shape here.

MODEL
-----
Python loads `openai/clip-vit-base-patch32` (HuggingFace transformers). These
weights are identical to the Node runtime model `Xenova/clip-vit-base-patch32`,
so embeddings built here are directly comparable to those produced in Node.
The emitted `model_id` field is the *Node* id (what the consumer loads).

SOURCES
-------
Each category is sourced from `<dataset>/<category>/` AND (if present)
`<extra>/<category>/`, image files combined. The three known civic classes
(drainage, potholes, streetlight) typically live under my_dataset/; the Others
sub-types (garbage, graffiti, ...) come from an optional internet_images/ dir.
A category with no images anywhere still gets a text-prompt-only centroid so it
remains scoreable (text-only) at runtime.

USAGE
-----
  python build_others_exemplars.py
  python build_others_exemplars.py --dataset my_dataset --extra internet_images
  python build_others_exemplars.py --top-k 16 --out civic_exemplars.json

DELIVERABLE RULE: this script is run by the USER per RUNBOOK.md step 6. We only
write the code here.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

# --- SHARED CONSTANTS (spec section 0; hard-coded, no shared module) ------------
CLIP_MODEL_ID_NODE = "Xenova/clip-vit-base-patch32"   # emitted in JSON (Node consumer)
CLIP_MODEL_ID_PY = "openai/clip-vit-base-patch32"     # weight-compatible, loaded here
CLIP_EMBED_DIM = 512
CLIP_OOD_FLOOR = 0.22

ROOT = Path(__file__).resolve().parent

# Categories (spec section 5a): 3 known civic classes + Others sub-types.
CATEGORIES = [
    "drainage", "potholes", "streetlight",
    "garbage", "graffiti", "tree", "encroachment",
    "stray_animal", "waterlogging", "footpath", "noise", "public_property",
]

# Maps each exemplar category to the human civic label server.js uses.
CATEGORY_TO_CIVIC = {
    "drainage": "Drainage problem",
    "potholes": "Potholes",
    "streetlight": "Broken street light problem",
    "garbage": "Others",
    "graffiti": "Others",
    "tree": "Others",
    "encroachment": "Others",
    "stray_animal": "Others",
    "waterlogging": "Others",
    "footpath": "Others",
    "noise": "Others",
    "public_property": "Others",
}

# Canonical CLIP text prompts per category. Kept civic/Indian-urban flavored to
# match the complaint TITLE vocabulary in server.js TITLE_ROUTES.
TEXT_PROMPTS = {
    "drainage": [
        "a photo of a blocked drain or sewer overflow",
        "an open manhole or clogged gutter on a street",
        "stagnant sewage water overflowing onto a road",
    ],
    "potholes": [
        "a photo of a pothole or crater in a road",
        "a damaged asphalt road surface full of holes",
        "a broken road with a deep pit",
    ],
    "streetlight": [
        "a photo of a broken or non-working street light",
        "a damaged lamp post or street lamp",
        "a dark street caused by a faulty street light",
    ],
    "garbage": [
        "a pile of garbage or trash dumped on the street",
        "an illegal waste dump on the roadside",
        "litter and rubbish scattered on a public road",
    ],
    "graffiti": [
        "graffiti or vandalism spray painted on a wall",
        "a defaced public wall covered in spray paint",
    ],
    "tree": [
        "a fallen or uprooted tree blocking the road",
        "a broken tree branch lying on the street",
    ],
    "encroachment": [
        "illegal encroachment or stalls blocking the footpath",
        "construction debris and rubble dumped on the road",
        "street vendors and hawkers blocking a public path",
    ],
    "stray_animal": [
        "stray cattle or dogs roaming on the road",
        "a stray cow or bull blocking traffic on a street",
        "stray animals creating a nuisance on a public road",
    ],
    "waterlogging": [
        "a waterlogged flooded street with standing water",
        "rainwater accumulated and stagnant on a road",
        "a flooded urban area after heavy rain",
    ],
    "footpath": [
        "a broken or damaged footpath or sidewalk",
        "cracked and broken pavement tiles on a footpath",
        "an uneven damaged sidewalk that is unsafe to walk on",
    ],
    "noise": [
        "loudspeakers causing noise pollution on a street",
        "a public sound system or DJ setup blasting on the road",
    ],
    "public_property": [
        "damaged public property such as a broken bench or bus stop",
        "a broken compound wall or fence in a public area",
        "a vandalized signboard or damaged public structure",
    ],
}

IMAGE_GLOBS = ["*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG", "*.webp", "*.bmp"]

# --- small console helpers -----------------------------------------------------
GREEN, YELLOW, RED, CYAN, BOLD, RESET = (
    "\033[92m", "\033[93m", "\033[91m", "\033[96m", "\033[1m", "\033[0m"
)


def c(color, text):
    return f"{color}{text}{RESET}"


def l2_normalize(arr: np.ndarray, axis=-1, eps=1e-12) -> np.ndarray:
    """Return a copy of arr L2-normalized along `axis`."""
    arr = np.asarray(arr, dtype="float32")
    norm = np.linalg.norm(arr, axis=axis, keepdims=True)
    norm = np.maximum(norm, eps)
    return arr / norm


def collect_images(directory: Path) -> list:
    """Return sorted, de-duplicated list of image paths in a directory (non-recursive)."""
    if not directory.exists() or not directory.is_dir():
        return []
    seen = set()
    files = []
    for pattern in IMAGE_GLOBS:
        for f in directory.glob(pattern):
            if f.is_file() and f not in seen:
                seen.add(f)
                files.append(f)
    return sorted(files)


def resolve_sources(category: str, dataset: Path, extra: Path | None) -> list:
    """Combine images from <dataset>/<category> and <extra>/<category>."""
    files = collect_images(dataset / category)
    if extra is not None:
        files += collect_images(extra / category)
    # de-dup while preserving order
    seen = set()
    out = []
    for f in files:
        key = f.resolve()
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


# --- CLIP wrapper --------------------------------------------------------------
class ClipEncoder:
    """Thin wrapper around HuggingFace CLIP for image + text embeddings."""

    def __init__(self, device: str | None = None, batch_size: int = 32):
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self.torch = torch
        self.batch_size = batch_size
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device

        print(c(CYAN, f"[clip] loading {CLIP_MODEL_ID_PY} on {device} ..."))
        self.model = CLIPModel.from_pretrained(CLIP_MODEL_ID_PY).to(device).eval()
        self.processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID_PY)

        dim = int(self.model.config.projection_dim)
        if dim != CLIP_EMBED_DIM:
            raise SystemExit(
                c(RED, f"[fatal] CLIP projection_dim={dim} but contract requires "
                       f"{CLIP_EMBED_DIM}. Wrong model variant.")
            )
        print(c(GREEN, f"[clip] ready (embedding_dim={dim})"))

    def embed_texts(self, texts: list) -> np.ndarray:
        """Return [N, 512] L2-normalized text embeddings."""
        from transformers import CLIPProcessor  # noqa: F401 (kept explicit)
        torch = self.torch
        inputs = self.processor(text=texts, return_tensors="pt",
                                padding=True, truncation=True).to(self.device)
        with torch.no_grad():
            feats = self.model.get_text_features(**inputs)
        feats = feats.cpu().numpy().astype("float32")
        return l2_normalize(feats, axis=1)

    def embed_images(self, paths: list, label: str = "") -> np.ndarray:
        """Return [M, 512] L2-normalized image embeddings; skips unreadable files."""
        from PIL import Image
        torch = self.torch

        vecs = []
        n = len(paths)
        for start in range(0, n, self.batch_size):
            batch_paths = paths[start:start + self.batch_size]
            imgs = []
            for p in batch_paths:
                try:
                    with Image.open(p) as im:
                        imgs.append(im.convert("RGB").copy())
                except Exception:
                    # unreadable / corrupt -> skip silently (counted via shortfall)
                    continue
            if not imgs:
                continue
            inputs = self.processor(images=imgs, return_tensors="pt").to(self.device)
            with torch.no_grad():
                feats = self.model.get_image_features(**inputs)
            vecs.append(feats.cpu().numpy().astype("float32"))
            done = min(start + self.batch_size, n)
            print(f"\r  [{label}] embedded {done}/{n} images", end="", flush=True)
        if label:
            print()
        if not vecs:
            return np.zeros((0, CLIP_EMBED_DIM), dtype="float32")
        return l2_normalize(np.concatenate(vecs, axis=0), axis=1)


# --- per-category exemplar construction ----------------------------------------
def build_category(name: str, img_vecs: np.ndarray, text_vecs: np.ndarray,
                   texts: list, top_k: int) -> dict:
    """Assemble one category's exemplar block (centroid, image_exemplars, text_prompts)."""
    n_images = int(img_vecs.shape[0])

    if n_images > 0:
        centroid = l2_normalize(img_vecs.mean(axis=0))
        # rank images by cosine to centroid (all normalized -> cosine == dot)
        sims = img_vecs @ centroid
        order = np.argsort(-sims)            # descending
        keep = order[:max(1, top_k)]
        image_exemplars = img_vecs[keep]
    else:
        # No source images: fall back to a text-prompt centroid so the category
        # stays usable (text-only) at runtime. image_exemplars left empty.
        centroid = l2_normalize(text_vecs.mean(axis=0))
        image_exemplars = np.zeros((0, CLIP_EMBED_DIM), dtype="float32")
        print(c(YELLOW, f"  [{name}] no source images -- using text-prompt centroid"))

    text_prompts = [
        {"text": t, "vector": vecs_to_list(text_vecs[i])}
        for i, t in enumerate(texts)
    ]

    return {
        "n_images": n_images,
        "centroid": vecs_to_list(centroid),
        "text_prompts": text_prompts,
        "image_exemplars": [vecs_to_list(v) for v in image_exemplars],
    }


def vecs_to_list(vec: np.ndarray) -> list:
    """512-length L2-normalized float list, rounded for compact JSON."""
    vec = np.asarray(vec, dtype="float32").reshape(-1)
    if vec.shape[0] != CLIP_EMBED_DIM:
        raise ValueError(f"vector length {vec.shape[0]} != {CLIP_EMBED_DIM}")
    return [round(float(x), 6) for x in vec.tolist()]


def write_atomic(out_path: Path, payload: dict):
    """Write JSON atomically (temp file in same dir + os.replace)."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".civic_exemplars_", suffix=".tmp",
                               dir=str(out_path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, out_path)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def main():
    ap = argparse.ArgumentParser(
        description="Build CLIP per-category exemplars (civic_exemplars.json) "
                    "for the Others open-set classifier.")
    ap.add_argument("--dataset", default="my_dataset",
                    help="root dir of labelled class folders (default: my_dataset)")
    ap.add_argument("--extra", default="internet_images",
                    help="optional dir of supplementary <category>/ image folders "
                         "(default: internet_images; skipped if absent)")
    ap.add_argument("--top-k", type=int, default=16,
                    help="number of image exemplars kept per category (default: 16)")
    ap.add_argument("--out", default="civic_exemplars.json",
                    help="output JSON path (default: civic_exemplars.json)")
    ap.add_argument("--max-images", type=int, default=0,
                    help="optional cap on images embedded per category (0 = no cap)")
    ap.add_argument("--batch-size", type=int, default=32,
                    help="CLIP image batch size (default: 32)")
    ap.add_argument("--device", default=None,
                    help="torch device (default: cuda if available else cpu)")
    args = ap.parse_args()

    # Resolve paths relative to the backend dir unless absolute.
    dataset = Path(args.dataset)
    if not dataset.is_absolute():
        dataset = ROOT / dataset
    extra = None
    if args.extra:
        extra_path = Path(args.extra)
        if not extra_path.is_absolute():
            extra_path = ROOT / extra_path
        if extra_path.exists():
            extra = extra_path
        else:
            print(c(YELLOW, f"[info] --extra dir not found ({extra_path}); "
                            f"using --dataset only"))

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = ROOT / out_path

    print(c(BOLD, "\n=== FixMyCity CLIP Exemplar Builder ==="))
    print(f"[preprocess] CLIP {CLIP_MODEL_ID_PY} native processor "
          f"(separate from the EfficientNet [0,255] path)")
    print(f"  dataset = {dataset}")
    print(f"  extra   = {extra if extra else '(none)'}")
    print(f"  top_k   = {args.top_k}   out = {out_path}")

    if not dataset.exists():
        raise SystemExit(c(RED, f"[fatal] dataset dir not found: {dataset}"))

    encoder = ClipEncoder(device=args.device, batch_size=args.batch_size)

    exemplars = {}
    total_imgs = 0
    missing = []
    for cat in CATEGORIES:
        texts = TEXT_PROMPTS[cat]
        text_vecs = encoder.embed_texts(texts)

        paths = resolve_sources(cat, dataset, extra)
        if args.max_images and len(paths) > args.max_images:
            # deterministic subset: evenly strided sample
            idx = np.linspace(0, len(paths) - 1, args.max_images).astype(int)
            paths = [paths[i] for i in idx]

        if paths:
            print(c(CYAN, f"\n[{cat}] {len(paths)} candidate image(s)"))
        else:
            print(c(CYAN, f"\n[{cat}] 0 candidate images (text-only)"))
            missing.append(cat)

        img_vecs = encoder.embed_images(paths, label=cat) if paths else \
            np.zeros((0, CLIP_EMBED_DIM), dtype="float32")
        total_imgs += int(img_vecs.shape[0])

        exemplars[cat] = build_category(cat, img_vecs, text_vecs, texts, args.top_k)

    payload = {
        "model_id": CLIP_MODEL_ID_NODE,
        "embedding_dim": CLIP_EMBED_DIM,
        "normalized": True,
        "ood_floor": CLIP_OOD_FLOOR,
        "categories": CATEGORIES,
        "category_to_civic": CATEGORY_TO_CIVIC,
        "exemplars": exemplars,
    }

    write_atomic(out_path, payload)

    # --- summary ---------------------------------------------------------------
    print(c(BOLD, "\n=== Summary ==="))
    for cat in CATEGORIES:
        e = exemplars[cat]
        flag = c(YELLOW, " (text-only)") if e["n_images"] == 0 else ""
        print(f"  {cat:<16} images={e['n_images']:>5}  "
              f"exemplars={len(e['image_exemplars']):>3}  "
              f"prompts={len(e['text_prompts'])}{flag}")
    print(f"\n  total images embedded : {total_imgs}")
    if missing:
        print(c(YELLOW, f"  categories without images: {', '.join(missing)}"))
        print(c(YELLOW, "  -> add folders under --extra (internet_images/<category>/) "
                        "for stronger image-based matching."))
    size_kb = out_path.stat().st_size / 1024.0
    print(c(GREEN, f"\n[done] wrote {out_path} ({size_kb:.0f} KB)"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(c(RED, "\n[abort] interrupted"))
        sys.exit(130)
