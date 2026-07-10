const express = require('express');
const router = express.Router();
const { getMeta } = require('../ml/pipeline');

// Health + model status. Reads a live snapshot from the ML pipeline so it always
// reflects current load state. Intentionally does NOT expose internal ML
// thresholds/OOD config (security hardening).
router.get('/api/health', (req, res) => {
  const { civicModel, nsfwModel, ADVISORY_MODE, CIVIC_CLASSES, clipReady } = getMeta();
  res.json({
    ok: true,
    model_loaded: !!civicModel,
    nsfw_loaded: !!nsfwModel,
    classes: CIVIC_CLASSES,
    enforce_mode: !ADVISORY_MODE,
    clip_ready: clipReady,
    classifier: civicModel
      ? (ADVISORY_MODE
          ? 'custom-civic-4class-tfjs (advisory mode)'
          : 'custom-civic-4class-tfjs (enforce mode)')
      : 'no model loaded',
    content_moderation: nsfwModel ? 'active' : 'disabled',
  });
});

module.exports = router;
