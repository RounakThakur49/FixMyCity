const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { complaintLimiter } = require('../middleware/security');
const { getFormattedDate } = require('../utils/datetime');
const {
  checkNSFW, classifyCivicImage, decideBlock,
  CATEGORY_TO_CLASS, othersClip, getCivicModel,
} = require('../ml/pipeline');

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
    // STEP 1 — Content moderation: block adult/explicit/inappropriate images
    // -------------------------------------------------------------------------
    if (isBase64) {
      try {
        const nsfwResult = await checkNSFW(activeImage);
        if (nsfwResult && nsfwResult.blocked) {
          console.warn(`[nsfw] BLOCKED upload: ${nsfwResult.category} (${(nsfwResult.score * 100).toFixed(0)}%)`);
          return res.status(422).json({
            blocked: true,
            reason: 'inappropriate_content',
            message: nsfwResult.message,
            suggestion: 'Please upload a clear photo of the civic issue you are reporting.',
            nsfwDetails: {
              flaggedCategory: nsfwResult.category,
              confidence: parseFloat((nsfwResult.score * 100).toFixed(1)),
              allScores: nsfwResult.allScores,
            },
          });
        }
      } catch (e) {
        console.error('[nsfw] Pre-screen error — continuing:', e.message);
      }
    }

    // -------------------------------------------------------------------------
    // STEP 2 — Image validation — only for base64 uploads from citizens
    // -------------------------------------------------------------------------
    if (isBase64 && CATEGORY_TO_CLASS[type]) {
      if (!getCivicModel()) {
        // Model not loaded — log and allow (never block citizens due to ML failure)
        imageCheck.note = 'AI validation unavailable — model not loaded. Submission accepted.';
        console.warn('[civic] Model not loaded — skipping image validation for', type);
      } else {
        try {
          const classProbs = await classifyCivicImage(activeImage);

          if (!classProbs) {
            imageCheck.note = 'AI validation returned no result — submission accepted.';
          } else {
            const actualProbs = classProbs.classProbs || classProbs;
            const logits = classProbs.logits || null;

            const probsStr = Object.entries(actualProbs)
              .sort(([, a], [, b]) => b - a)
              .map(([cls, p]) => `${cls}:${(p * 100).toFixed(0)}%`)
              .join(', ');

            if (type === 'Others') {
              // ---------------------------------------------------------------
              // OPEN-SET "Others": NEVER hard-blocked. CLIP (text+image
              // embedding similarity, others_clip.js) is authoritative for the
              // advisory suggestion. Keyword TITLE_ROUTES is only a fallback
              // when CLIP is unavailable. The civic model still ran above for
              // advisory classProbs, but its decision is ignored for blocking.
              // decideBlock is invoked with openSet:true so it can only emit
              // advisory metadata (no 422 path for Others).
              // ---------------------------------------------------------------
              const decision = decideBlock(actualProbs, 'Others', { logits, openSet: true });

              let advisoryNote = '';
              let clipScores = null;
              let clipSuggestion = null;
              let clipOodScore = null;

              let clip = null;
              if (othersClip.isReady()) {
                try {
                  clip = await othersClip.classifyOthers({ imageBase64: activeImage, title });
                } catch (clipErr) {
                  console.error('[clip] classifyOthers error — falling back to advisory:', clipErr.message);
                  clip = null;
                }
              }

              if (clip) {
                // CLIP authoritative advisory.
                clipScores = clip.scores || null;
                clipSuggestion = clip.suggestedClass || null;
                clipOodScore = typeof clip.oodScore === 'number'
                  ? parseFloat(clip.oodScore.toFixed(4)) : null;
                const simStr = typeof clip.oodScore === 'number' ? clip.oodScore.toFixed(2) : '?';

                if (clip.isCivic && clip.suggestedClass && clip.suggestedClass !== 'Others') {
                  advisoryNote = `Looks closest to "${clip.suggestedClass}" (sim ${simStr}) — you may want to re-categorize.`;
                } else if (clip.isCivic && clip.suggestedClass === 'Others') {
                  advisoryNote = `Recognized as a "${clip.suggestedSubtype || 'general'}" issue.`;
                } else {
                  advisoryNote = 'Accepted as a novel/open-set civic issue.';
                }
                console.log(
                  `[clip] Others "${title}" → suggested="${clip.suggestedClass}" ` +
                  `subtype="${clip.suggestedSubtype}" sim=${simStr} isCivic=${clip.isCivic}`
                );
              } else {
                // Fallback advisory: cheap keyword routing only. Never blocks.
                const t = (title || '').toLowerCase();
                let routedType = null;
                for (const route of TITLE_ROUTES) {
                  if (route.keywords.some(kw => t.includes(kw))) {
                    routedType = route.targetType;
                    break;
                  }
                }
                if (routedType) {
                  advisoryNote = `Based on the title, this may be a "${routedType}" issue — you may want to re-categorize.`;
                  console.log(`[civic] Others title "${title}" → keyword advisory "${routedType}" (CLIP unavailable)`);
                } else if (decision.suggestion) {
                  advisoryNote = decision.suggestion;
                } else {
                  advisoryNote = 'Accepted as an open-set civic issue.';
                }
              }

              console.log(
                `[civic] declared="Others" (open-set) probs=[${probsStr}] ` +
                `→ ✅ ACCEPT (${clip ? 'clip' : 'keyword/advisory'})`
              );

              imageCheck = {
                model: 'custom-civic-4class-tfjs',
                matched: true,
                blocked: false,
                score: decision.declaredProb,
                classProbs: actualProbs,
                note: advisoryNote,
                clipScores,
                clipSuggestion,
                clipOodScore,
                at: getFormattedDate(),
              };
              // Others is open-set: no hard-block / no 422 path.
            } else {
              // -------------------------------------------------------------
              // Specific declared category: the civic model decides on the
              // calibrated probabilities. decideBlock self-suppresses blocking
              // in ADVISORY_MODE or when the class is flagged unreliable.
              // -------------------------------------------------------------
              const decision = decideBlock(actualProbs, type, { logits });

              console.log(
                `[civic] declared="${type}" class="${decision.declaredClass}" ` +
                `declared_prob=${(decision.declaredProb * 100).toFixed(0)}% ` +
                `threshold=${(decision.threshold || 0) * 100 || '?'}% ` +
                `top="${decision.topClass}" top_prob=${(decision.topProb * 100).toFixed(0)}% ` +
                `→ ${decision.block ? '❌ BLOCK' : '✅ ACCEPT'} (${decision.reason})`
              );

              imageCheck = {
                model: 'custom-civic-4class-tfjs',
                matched: !decision.block,
                blocked: decision.block,
                score: decision.declaredProb,
                classProbs: actualProbs,
                note: decision.block ? decision.message : `✅ Image matches "${type}" (${(decision.declaredProb * 100).toFixed(0)}% confidence).`,
                at: getFormattedDate(),
              };

              // Block the submission — return 422 with user-friendly message
              if (decision.block) {
                return res.status(422).json({
                  blocked: true,
                  message: decision.message,
                  suggestion: decision.suggestion || '',
                  aiDetails: {
                    declaredCategory: type,
                    declaredClass: decision.declaredClass,
                    declaredConfidence: parseFloat((decision.declaredProb * 100).toFixed(1)),
                    topClass: decision.topClass,
                    topConfidence: parseFloat((decision.topProb * 100).toFixed(1)),
                    reason: decision.reason,
                  },
                });
              }
            }
          }
        } catch (inferenceErr) {
          // Inference error — log but NEVER block the citizen
          console.error('[civic] Inference error — allowing submission:', inferenceErr.message);
          const looksPng = (typeof activeImage === 'string' && /^data:image\/png/i.test(activeImage))
            || /PNG decoding/i.test(inferenceErr.message || '');
          imageCheck.note = looksPng
            ? 'png_unvalidated — image not screened by classifier'
            : 'AI validation error — submission accepted without check.';
        }
      }
    } else if (!isBase64) {
      imageCheck.note = 'URL or seed image — AI validation skipped.';
    } else if (!CATEGORY_TO_CLASS[type]) {
      imageCheck.note = `Unknown complaint type "${type}" — AI validation skipped.`;
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
