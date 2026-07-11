/**
 * Dataset cleaner: removes NSFW-flagged images from my_dataset/ using nsfwjs.
 * Quarantines flagged images to my_dataset_quarantine/ (safe, reversible).
 *
 * Usage:
 *   node nsfw_clean_dataset.js
 */
const fs   = require('fs');
const path = require('path');
const nsfwjs = require('nsfwjs');
const tf     = require('@tensorflow/tfjs');
const jpeg   = require('jpeg-js');

const DATASET  = path.join(__dirname, 'my_dataset');
const QUARANTINE = path.join(__dirname, 'my_dataset_quarantine');
const CLASSES  = ['potholes', 'drainage', 'streetlight', 'others'];
const LOG_FILE = path.join(__dirname, 'nsfw_scan_results.json');

// Thresholds for flagging (same as server.js)
const PORN_THR   = 0.40;
const HENTAI_THR = 0.40;
const SEXY_THR   = 0.70;

function decodeJpeg(filePath) {
  const buf = fs.readFileSync(filePath);
  const raw = jpeg.decode(buf, { useTArray: true });
  const numPx = raw.width * raw.height;
  const rgb = new Uint8Array(numPx * 3);
  for (let i = 0; i < numPx; i++) {
    rgb[i * 3]     = raw.data[i * 4];
    rgb[i * 3 + 1] = raw.data[i * 4 + 1];
    rgb[i * 3 + 2] = raw.data[i * 4 + 2];
  }
  return tf.tensor3d(rgb, [raw.height, raw.width, 3]);
}

async function main() {
  console.log('FixMyCity — Dataset NSFW Cleaner');
  console.log('==================================');
  console.log(`Dataset: ${DATASET}`);
  console.log(`Quarantine: ${QUARANTINE}\n`);

  // Ensure quarantine dirs exist
  for (const cat of CLASSES) {
    fs.mkdirSync(path.join(QUARANTINE, cat), { recursive: true });
  }

  console.log('Loading nsfwjs model...');
  const model = await nsfwjs.load();
  console.log('Model ready.\n');

  const results = {};
  let totalScanned = 0, totalFlagged = 0, totalRemoved = 0;

  for (const cat of CLASSES) {
    const dir = path.join(DATASET, cat);
    if (!fs.existsSync(dir)) { console.log(`[SKIP] ${cat}: folder not found`); continue; }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
    results[cat] = { scanned: files.length, flagged: [], clean: 0 };
    let catFlagged = 0;

    process.stdout.write(`Scanning ${cat} (${files.length} images)...`);

    for (const file of files) {
      const filePath = path.join(dir, file);
      totalScanned++;
      try {
        const t = decodeJpeg(filePath);
        const preds = await model.classify(t);
        t.dispose();

        const sc = {};
        preds.forEach(p => sc[p.className] = parseFloat(p.probability.toFixed(4)));

        const isFlagged = sc.Porn > PORN_THR || sc.Hentai > HENTAI_THR || sc.Sexy > SEXY_THR;

        if (isFlagged) {
          totalFlagged++;
          catFlagged++;
          results[cat].flagged.push({ file, scores: sc });

          // Move to quarantine instead of deleting
          const src  = filePath;
          const dest = path.join(QUARANTINE, cat, file);
          fs.renameSync(src, dest);
          totalRemoved++;
        } else {
          results[cat].clean++;
        }
      } catch (e) {
        // Skip unreadable images
        results[cat].flagged.push({ file, error: e.message });
      }
    }

    console.log(` done. Flagged: ${catFlagged}/${files.length}`);
  }

  // Write full report
  fs.writeFileSync(LOG_FILE, JSON.stringify(results, null, 2));

  console.log('\n==============================');
  console.log('  CLEANUP SUMMARY');
  console.log('==============================');
  for (const cat of CLASSES) {
    const r = results[cat];
    if (!r) continue;
    const pct = r.flagged.length / r.scanned * 100;
    console.log(`  ${cat.padEnd(14)} ${r.flagged.length.toString().padStart(3)} removed, ${r.clean.toString().padStart(3)} clean  (${pct.toFixed(1)}% contaminated)`);
  }
  console.log(`\n  Total scanned : ${totalScanned}`);
  console.log(`  Total flagged : ${totalFlagged}`);
  console.log(`  Total moved to quarantine: ${totalRemoved}`);
  console.log(`\n  Full report: nsfw_scan_results.json`);
  console.log(`  Quarantined: my_dataset_quarantine/`);
  console.log('\n  NEXT STEP: Retrain the model with the cleaned dataset:');
  console.log('  .venv\\Scripts\\python train_civic_model.py');
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
