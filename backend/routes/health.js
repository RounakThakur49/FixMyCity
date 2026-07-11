const express = require('express');
const router = express.Router();

// Health. The ML pipeline now lives in a separate service, so model status is
// fetched best-effort over HTTP from ${ML_SERVICE_URL}/health. The backend's own
// liveness never depends on the ML service being reachable.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || '';
const ML_HEALTH_TIMEOUT_MS = parseInt(process.env.ML_HEALTH_TIMEOUT_MS, 10) || 4000;

router.get('/api/health', async (req, res) => {
  const base = { ok: true, service: 'backend' };

  if (!ML_SERVICE_URL) {
    return res.json({ ...base, ml_service: 'not_configured' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_HEALTH_TIMEOUT_MS);
  try {
    const r = await fetch(`${ML_SERVICE_URL}/health`, { signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ml = await r.json();
    // Surface the ML fields without re-exposing internal thresholds/OOD config.
    return res.json({
      ...base,
      ml_service: 'reachable',
      model_loaded: !!ml.model_loaded,
      nsfw_loaded: !!ml.nsfw_loaded,
      clip_ready: !!ml.clip_ready,
      enforce_mode: !!ml.enforce_mode,
      classes: ml.classes,
      classifier: ml.classifier || 'unknown',
      content_moderation: ml.content_moderation || (ml.nsfw_loaded ? 'active' : 'disabled'),
    });
  } catch (e) {
    return res.json({ ...base, ml_service: 'unreachable', ml_error: e.name === 'AbortError' ? 'timeout' : e.message });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
