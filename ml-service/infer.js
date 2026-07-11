// infer.js — ML orchestration extracted verbatim from the old
// backend/routes/complaints.js POST handler (STEP 1 NSFW + STEP 2 civic/CLIP,
// former lines ~68-268). It runs the pipeline and returns a *verdict* the
// backend applies as-is. The backend no longer imports any ML code.
//
// Contract:
//   infer({ imageBase64, type, title }) -> {
//     action:     'accept' | 'block',
//     httpStatus: 201 | 422,
//     blockPayload: object | null,   // exact JSON body the backend returns on block
//     imageCheck:   object,          // subdoc the backend stores on the complaint
//   }
//
// NOTE on time: the old handler stamped imageCheck.at with getFormattedDate()
// (Asia/Kolkata). That responsibility stays on the BACKEND — this service
// returns imageCheck WITHOUT `at`; the backend adds it at save time so the
// stored string format + timezone authority never leaves the backend.
//
// Fail-open is preserved end-to-end: any inference error here degrades to an
// 'accept' verdict with an advisory note (never blocks the citizen). The
// backend ALSO fails open if this whole service is unreachable.

const {
  checkNSFW,
  classifyCivicImage,
  decideBlock,
  CATEGORY_TO_CLASS,
  othersClip,
  getCivicModel,
  TITLE_ROUTES,
} = require('./ml/pipeline');

async function infer({ imageBase64, type, title }) {
  const activeImage = imageBase64;
  const isBase64 = activeImage && activeImage.startsWith('data:image/');

  // Default advisory subdoc (no `at` — backend stamps).
  let imageCheck = {
    model: 'none',
    matched: null,
    blocked: false,
    score: null,
    classProbs: null,
    note: 'Image not checked.',
  };

  // ---------------------------------------------------------------------------
  // STEP 1 — Content moderation: block adult/explicit/inappropriate images
  // ---------------------------------------------------------------------------
  if (isBase64) {
    try {
      const nsfwResult = await checkNSFW(activeImage);
      if (nsfwResult && nsfwResult.blocked) {
        console.warn(`[nsfw] BLOCKED upload: ${nsfwResult.category} (${(nsfwResult.score * 100).toFixed(0)}%)`);
        return {
          action: 'block',
          httpStatus: 422,
          blockPayload: {
            blocked: true,
            reason: 'inappropriate_content',
            message: nsfwResult.message,
            suggestion: 'Please upload a clear photo of the civic issue you are reporting.',
            nsfwDetails: {
              flaggedCategory: nsfwResult.category,
              confidence: parseFloat((nsfwResult.score * 100).toFixed(1)),
              allScores: nsfwResult.allScores,
            },
          },
          imageCheck: {
            model: 'nsfwjs',
            matched: false,
            blocked: true,
            score: nsfwResult.score,
            classProbs: null,
            note: nsfwResult.message || 'Blocked by content moderation.',
          },
        };
      }
    } catch (e) {
      console.error('[nsfw] Pre-screen error — continuing:', e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 2 — Image validation — only for base64 uploads from citizens
  // ---------------------------------------------------------------------------
  if (isBase64 && CATEGORY_TO_CLASS[type]) {
    if (!getCivicModel()) {
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
            // -----------------------------------------------------------------
            // OPEN-SET "Others": NEVER hard-blocked. CLIP is authoritative for
            // the advisory suggestion; keyword TITLE_ROUTES is only a fallback
            // when CLIP is unavailable. (Formerly complaints.js:126-209.)
            // -----------------------------------------------------------------
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
            };
            // Others is open-set: no hard-block / no 422 path.
          } else {
            // -----------------------------------------------------------------
            // Specific declared category: the civic model decides on calibrated
            // probabilities. (Formerly complaints.js:210-251.)
            // -----------------------------------------------------------------
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
              note: decision.block
                ? decision.message
                : `✅ Image matches "${type}" (${(decision.declaredProb * 100).toFixed(0)}% confidence).`,
            };

            if (decision.block) {
              return {
                action: 'block',
                httpStatus: 422,
                blockPayload: {
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
                },
                imageCheck,
              };
            }
          }
        }
      } catch (inferenceErr) {
        // Inference error — log but NEVER block the citizen.
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

  return {
    action: 'accept',
    httpStatus: 201,
    blockPayload: null,
    imageCheck,
  };
}

module.exports = { infer };
