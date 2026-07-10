"""
retrain_pipeline.py -- Master ML retraining pipeline for FixMyCity.

NOTE: No dataset downloads run by default (locked user decision). The pipeline
operates on the existing my_dataset/ images, cleans contamination, retrains the
EfficientNetB0 dual-head model, calibrates on logits, audits, and builds the
CLIP Others-open-set exemplars.

Default ordered steps:
  1. validate_dataset.py                          # pre-check (corrected [0,255] preprocessing)
  2. clean_dataset_contamination.py --apply       # quarantine embedding-outlier / mislabeled images
  3. validate_dataset.py                          # post-clean check
  4. train_civic_model.py --batch 16              # dual-head [logits, probs]; EXIT 2 on collapse gate
  5. temperature_scaling.py                        # logits calibration + full ood block + thresholds
  6. audit_dataset.py                              # corrected-preprocessing audit (post-train)
  7. build_others_exemplars.py                     # CLIP exemplars for the Others open-set path

The TRAIN step has an anti-collapse export gate (see train_civic_model.py / IMPLEMENTATION_SPEC
§2.7): it exits with code 2 and leaves civic_model_tfjs/ untouched if macro-F1 < 0.55 or any
per-class recall < 0.05. When that happens this pipeline HARD-STOPS immediately (no prompt).

Optional download steps (download_drainage_dataset, download_others_dataset, filter_dataset)
are OFF by default; re-enable them with --with-download (they are inserted before the clean step).

Usage:
  python retrain_pipeline.py                  # Full default pipeline (no downloads)
  python retrain_pipeline.py --with-download  # Also run the old download/filter steps first
  python retrain_pipeline.py --only-train     # Train -> calibrate -> audit -> exemplars only
  python retrain_pipeline.py --dry-run        # Show plan only
  python retrain_pipeline.py --resume-from 4  # Start from step N (renumbered after assembly)
"""
import argparse
import datetime
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Exit code the train step uses to signal the anti-collapse export gate fired (§2.7).
COLLAPSE_EXIT_CODE = 2

# Optional, off-by-default download/filter steps (re-inserted before the clean step
# only when --with-download is passed).
DOWNLOAD_STEPS = [
    {"name": "download_drainage_dataset", "cmd": [sys.executable, "download_drainage_dataset.py"]},
    {"name": "download_others_dataset", "cmd": [sys.executable, "download_others_dataset.py"]},
    {"name": "filter_dataset --apply", "cmd": [sys.executable, "filter_dataset.py", "--apply", "--skip-relevance", "--skip-boundary-check"]},
]

# Core default pipeline (no downloads). Order is authoritative per IMPLEMENTATION_SPEC §8.1.
# Flags: "collapse_gate" -> exit code 2 means model collapse, hard-stop the pipeline.
#        "needs_dataset"  -> verify my_dataset/ exists before running.
CLEAN_STEP = {"name": "clean_dataset_contamination --apply", "cmd": [sys.executable, "clean_dataset_contamination.py", "--apply"]}

CORE_STEPS = [
    {"name": "validate_dataset (pre-check)", "cmd": [sys.executable, "validate_dataset.py"]},
    CLEAN_STEP,
    {"name": "validate_dataset (post-clean check)", "cmd": [sys.executable, "validate_dataset.py"]},
    {"name": "train_civic_model", "cmd": [sys.executable, "train_civic_model.py", "--batch", "16"], "collapse_gate": True, "needs_dataset": True},
    {"name": "temperature_scaling", "cmd": [sys.executable, "temperature_scaling.py"]},
    {"name": "audit_dataset (post-train)", "cmd": [sys.executable, "audit_dataset.py"]},
    {"name": "build_others_exemplars", "cmd": [sys.executable, "build_others_exemplars.py"]},
]


def build_steps(args):
    """Assemble and renumber the steps according to CLI flags."""
    steps = list(CORE_STEPS)

    if args.with_download:
        # Insert the download/filter steps just before the clean step (CLEAN_STEP).
        insert_at = steps.index(CLEAN_STEP)
        steps = steps[:insert_at] + list(DOWNLOAD_STEPS) + steps[insert_at:]

    # Assign sequential ids AFTER assembly so --resume-from is stable for a given invocation.
    steps = [dict(s, id=i + 1) for i, s in enumerate(steps)]

    if args.only_train:
        # Everything from the train step (the collapse_gate step) onward.
        train_idx = next((i for i, s in enumerate(steps) if s.get("collapse_gate")), 0)
        steps = steps[train_idx:]

    if args.resume_from:
        steps = [s for s in steps if s["id"] >= args.resume_from]

    return steps


def check_gpu():
    try:
        import tensorflow as tf
        gpus = tf.config.list_physical_devices('GPU')
        if not gpus:
            print("\n\033[93m[WARNING] No GPU detected. Training will be very slow!\033[0m\n")
        else:
            print(f"\n[INFO] Found GPU(s): {gpus}\n")
    except Exception as e:
        print(f"\n\033[93m[WARNING] Could not check GPU: {e}\033[0m\n")


def run_step(step, log_file):
    print(f"\n{'='*60}")
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Executing Step {step['id']}: {step['name']}")
    print(f"Command: {' '.join(step['cmd'])}")
    print(f"{'='*60}")

    start_time = time.time()

    with open(log_file, "a", encoding="utf-8") as f:
        f.write(f"\n\n{'='*60}\n")
        f.write(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Step {step['id']}: {step['name']}\n")
        f.write(f"Command: {' '.join(step['cmd'])}\n")
        f.write(f"{'='*60}\n\n")

    # Pipe stdout/stderr to screen AND to log via Popen.
    process = subprocess.Popen(
        step['cmd'],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=ROOT,
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    with open(log_file, "a", encoding="utf-8") as f:
        for line in process.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            f.write(line)

    process.wait()
    duration = time.time() - start_time
    returncode = process.returncode

    if returncode != 0:
        print(f"\n\033[91m[ERROR] Step {step['id']} failed with exit code {returncode}!\033[0m")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"\n[ERROR] Step {step['id']} failed with exit code {returncode}!\n")
        return False, duration, returncode

    print(f"\n\033[92m[SUCCESS] Step {step['id']} completed in {duration:.1f}s\033[0m")
    return True, duration, returncode


def main():
    parser = argparse.ArgumentParser(description="Master ML retraining pipeline for FixMyCity")
    parser.add_argument("--with-download", action="store_true",
                        help="Also run the old download/filter steps before cleaning (OFF by default)")
    parser.add_argument("--only-train", action="store_true",
                        help="Only train -> calibrate -> audit -> build exemplars")
    parser.add_argument("--dry-run", action="store_true", help="Show plan only")
    parser.add_argument("--resume-from", type=int, help="Start from step N (numbered as shown in the plan)")
    args = parser.parse_args()

    steps_to_run = build_steps(args)

    print("\n\033[1m=== Execution Plan ===\033[0m")
    for s in steps_to_run:
        gate = "  [anti-collapse gate: exit 2 hard-stops]" if s.get("collapse_gate") else ""
        print(f"  Step {s['id']}: {s['name']}{gate}")
    print("========================\n")
    if not args.with_download:
        print("(downloads disabled — pass --with-download to re-enable the old fetch/filter steps)\n")

    if args.dry_run:
        print("Dry run complete.")
        return

    check_gpu()

    log_file = ROOT / f"pipeline_run_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    print(f"Logging to: {log_file.name}")

    results = []
    aborted = False

    for step in steps_to_run:
        # Prerequisite: training needs the dataset present.
        if step.get("needs_dataset"):
            dataset_dir = ROOT / "my_dataset"
            if not dataset_dir.exists():
                print(f"\n\033[91m[ERROR] my_dataset/ not found! Cannot train.\033[0m")
                sys.exit(1)

        success, duration, returncode = run_step(step, log_file)
        results.append({
            "step": step['id'],
            "name": step['name'],
            "status": "Success" if success else f"Failed (exit {returncode})",
            "duration": f"{duration:.1f}s"
        })

        if not success:
            # Hard stop, no prompt, if the training collapse gate fired (exit code 2).
            if step.get("collapse_gate") and returncode == COLLAPSE_EXIT_CODE:
                print("\n\033[91m" + "=" * 70)
                print("[ABORT] Training hit the anti-collapse export gate (exit code 2).")
                print("        macro-F1 < 0.55 or a per-class recall < 0.05 — the model collapsed.")
                print("        civic_model_tfjs/ was left UNTOUCHED; nothing downstream is trustworthy.")
                print("        Fix the data/recipe (review clean_report.csv, drainage contamination,")
                print("        mixup/focal settings) and re-run. Pipeline aborted — NO prompt.")
                print("=" * 70 + "\033[0m")
                aborted = True
                break

            # Any other failure keeps the original y/N prompt.
            ans = input("\nStep failed. Continue pipeline? (y/N): ")
            if ans.lower() != 'y':
                print("Pipeline aborted.")
                aborted = True
                break

    print(f"\n{'='*70}")
    print("\033[1m  PIPELINE SUMMARY\033[0m")
    print(f"{'='*70}")
    print(f"{'Step':<5} | {'Status':<16} | {'Duration':<10} | {'Name'}")
    print("-" * 70)
    for r in results:
        color = "\033[92m" if r['status'] == 'Success' else "\033[91m"
        print(f"{r['step']:<5} | {color}{r['status']:<16}\033[0m | {r['duration']:<10} | {r['name']}")
    print(f"{'='*70}\n")
    print(f"Full log available at: {log_file}")

    if aborted:
        sys.exit(1)


if __name__ == "__main__":
    main()
