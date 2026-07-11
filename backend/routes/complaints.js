const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { complaintLimiter } = require('../middleware/security');
const { getFormattedDate } = require('../utils/datetime');

// Image validation lives in a separate ML microservice (../ml-service). We call
// it over HTTP per uploaded photo instead of importing any ML code. Config:
//   ML_SERVICE_URL — base URL of the ML service (e.g. https://x.hf.space). Unset → skip.
//   ML_KEY         — shared secret sent as X-ML-KEY (must match the ML service).
//   ML_TIMEOUT_MS  — abort the call after this many ms (default 60000).
//
// NOTE the generous default: pure-JS @tensorflow/tfjs inference for the
// EfficientNetV2S model runs ~15-20s/image on CPU (no native bindings). The
// timeout only guards against a genuinely dead/hung service — it must sit WELL
// above real inference latency, or slow-but-working inferences fail open. A host
// with tfjs-node (native) is ~10x faster and can lower this.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || '';
const ML_KEY = process.env.ML_KEY || '';
const ML_TIMEOUT_MS = parseInt(process.env.ML_TIMEOUT_MS, 10) || 60000;

// Call the ML service's /api/infer. Returns the verdict object, or null on any
// failure (unset URL, network error, timeout, non-2xx) so the caller fails open.
async function callMlInfer({ imageBase64, type, title }) {
  if (!ML_SERVICE_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);
  try {
    const res = await fetch(`${ML_SERVICE_URL}/api/infer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ML_KEY ? { 'X-ML-KEY': ML_KEY } : {}),
      },
      body: JSON.stringify({ imageBase64, type, title }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[ml] infer returned HTTP ${res.status} — failing open.`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[ml] infer call failed — failing open:', e.name === 'AbortError' ? 'timeout' : e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/complaints
// -----------------------------------------------------------------------------
// Back-compat by design: with NO ?page/?limit query it returns the full array
// (exactly as before — the current frontend/Vercel build relies on this shape).
// With ?page and/or ?limit it returns a paginated envelope { data, page, limit,
// total, totalPages } + skips the field so large lists don't ship every base64
// image at once. Optional ?status filter uses the status index. This is the
// scalability path: new clients opt into pagination; old ones keep working.
router.get('/api/complaints', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    if (!paginated) {
      const complaints = await Complaint.find(filter).sort({ updatedAt: -1 });
      return res.status(200).json(complaints);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Complaint.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
      Complaint.countDocuments(filter),
    ]);

    res.status(200).json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    console.error('Get complaints error:', e);
    res.status(500).json({ message: 'Failed to retrieve complaints.' });
  }
});

router.post('/api/complaints', requireAuth, complaintLimiter, async (req, res) => {
  try {
    const {
      citizenName, citizenPhone, citizenLocation,
      title, type, location, description,
      images, image, latitude, longitude
    } = req.body;

    if (!citizenName || !citizenPhone || !title || !type || !location || !description) {
      return res.status(400).json({ message: 'Required fields are missing.' });
    }

    const activeImage = image || (images && images[0]);
    const isBase64 = activeImage && activeImage.startsWith('data:image/');

    // Default advisory subdoc. The `at` timestamp is stamped here (backend owns
    // time authority + the Asia/Kolkata string format); the ML service returns
    // imageCheck without `at`.
    let imageCheck = {
      model: 'none',
      matched: null,
      blocked: false,
      score: null,
      classProbs: null,
      note: 'Image not checked.',
      at: getFormattedDate(),
    };

    // -------------------------------------------------------------------------
    // Image validation — delegated to the ML microservice (NSFW + civic + CLIP).
    // The service returns a verdict we apply verbatim:
    //   action:'block' → return its httpStatus (422) + blockPayload to the client
    //   action:'accept' → store its imageCheck on the complaint (we re-stamp `at`)
    // FAIL-OPEN: if the service is unset/unreachable/times-out, callMlInfer()
    // returns null and the complaint is saved unchecked (same guarantee the old
    // in-process pipeline gave when a model failed to load).
    // -------------------------------------------------------------------------
    if (isBase64) {
      const verdict = await callMlInfer({ imageBase64: activeImage, type, title });
      if (verdict) {
        if (verdict.action === 'block') {
          return res.status(verdict.httpStatus || 422).json(verdict.blockPayload || {
            blocked: true, message: 'Image rejected by validation.',
          });
        }
        // action === 'accept' — adopt the service's imageCheck, stamp our time.
        imageCheck = { ...(verdict.imageCheck || {}), at: getFormattedDate() };
      } else {
        // Fail-open: ML service unavailable.
        imageCheck.note = 'AI validation unavailable — submission accepted.';
      }
    } else {
      imageCheck.note = 'URL or seed image — AI validation skipped.';
    }

    // -------------------------------------------------------------------------
    // Create and save the complaint.
    //
    // Serial is derived from the HIGHEST existing CMP id (not countDocuments),
    // so deletions can't make the serial collide with a surviving doc. The save
    // is wrapped in a retry loop: under concurrent submissions two requests can
    // still pick the same serial, in which case the unique index rejects the
    // loser with E11000 — we bump the serial and retry rather than 500.
    // -------------------------------------------------------------------------
    const nextSerial = async () => {
      // NOTE: a Mongo sort on the string `id` (e.g. {id:-1}) is LEXICAL, so
      // "CMP-9999" sorts AFTER "CMP-10000" and the serial would freeze in the
      // 4-digit range once we cross CMP-9999. Compute the TRUE numeric maximum
      // server-side by parsing the serial out of each id, independent of digit
      // count. The E11000 retry loop below still guards concurrent inserts.
      let maxSerial = 2400;
      try {
        const agg = await Complaint.aggregate([
          { $match: { id: /^CMP-\d+$/ } },
          { $project: { serial: { $toInt: { $arrayElemAt: [{ $split: ['$id', '-'] }, 1] } } } },
          { $sort: { serial: -1 } },
          { $limit: 1 },
        ]);
        if (agg.length && Number.isFinite(agg[0].serial)) {
          maxSerial = Math.max(maxSerial, agg[0].serial);
        }
      } catch (e) {
        // Fallback: parse a bounded recent window if aggregation is unavailable.
        const recent = await Complaint.find({ id: /^CMP-\d+$/ })
          .sort({ updatedAt: -1 }).limit(500).select('id').lean();
        for (const doc of recent) {
          const parsed = parseInt(String(doc.id).replace('CMP-', ''), 10);
          if (!Number.isNaN(parsed)) maxSerial = Math.max(maxSerial, parsed);
        }
      }
      return maxSerial + 1;
    };

    const timestamp = getFormattedDate();
    let serial = await nextSerial();
    let saved = null;

    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      const complaintId = `CMP-${serial}`;
      const newComplaint = new Complaint({
        id: complaintId, citizenName, citizenPhone,
        citizenLocation: citizenLocation || '',
        title, type, location, description,
        status: 'Submitted', forwardedTo: '',
        image: image || '', images: images || [],
        updates: [{ label: 'Submitted', note: 'Complaint registered by citizen.', at: timestamp }],
        imageCheck,
        createdAt: timestamp, updatedAt: timestamp,
        latitude: typeof latitude === 'number' ? latitude : null,
        longitude: typeof longitude === 'number' ? longitude : null,
      });
      try {
        saved = await newComplaint.save();
      } catch (saveErr) {
        // Duplicate id from a concurrent insert — bump the serial and retry.
        if (saveErr && saveErr.code === 11000) {
          serial = Math.max(serial + 1, await nextSerial());
          continue;
        }
        throw saveErr;
      }
    }

    if (!saved) {
      console.error('Create complaint error: exhausted id-generation retries.');
      return res.status(503).json({ message: 'Could not allocate a complaint ID, please retry.' });
    }
    res.status(201).json(saved);

  } catch (e) {
    console.error('Create complaint error:', e);
    res.status(500).json({ message: 'Failed to submit complaint.' });
  }
});

// Validate complaint ID format
const COMPLAINT_ID_RE = /^CMP-\d+$/;

router.patch('/api/complaints/:id/status', requireAdmin, async (req, res) => {
  try {
    if (!COMPLAINT_ID_RE.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid complaint ID format.' });
    }
    const { status, forwardedTo } = req.body;
    if (!status) return res.status(400).json({ message: 'Status field is required.' });
    const VALID_STATUSES = ['Submitted', 'In Review', 'Forwarded', 'Resolved'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const complaint = await Complaint.findOne({ id: req.params.id });
    if (!complaint) return res.status(404).json({ message: 'Complaint not found.' });

    const timestamp = getFormattedDate();
    let note = '';
    switch (status) {
      case 'In Review': note = 'Area inspection requested by admin.'; break;
      case 'Forwarded': note = `Issue forwarded to ${forwardedTo || 'respective department'}.`; break;
      case 'Resolved':  note = 'Complaint resolved successfully.'; break;
      default:          note = `Status updated to ${status}.`;
    }

    complaint.status = status;
    if (forwardedTo !== undefined && forwardedTo !== '') complaint.forwardedTo = forwardedTo;
    complaint.updatedAt = timestamp;
    complaint.updates.push({ label: status, note, at: timestamp });
    await complaint.save();
    res.status(200).json(complaint);
  } catch (e) {
    console.error('Update status error:', e);
    res.status(500).json({ message: 'Failed to update complaint status.' });
  }
});

router.delete('/api/complaints/:id', requireAdmin, async (req, res) => {
  try {
    if (!COMPLAINT_ID_RE.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid complaint ID format.' });
    }
    const r = await Complaint.findOneAndDelete({ id: req.params.id });
    if (!r) return res.status(404).json({ message: 'Complaint not found.' });
    res.status(200).json({ message: 'Complaint deleted successfully.', id: req.params.id });
  } catch (e) {
    console.error('Delete complaint error:', e);
    res.status(500).json({ message: 'Failed to delete complaint.' });
  }
});

module.exports = router;
