// ml-service/server.js — standalone ML inference microservice.
//
// Wraps the civic image pipeline (EfficientNetV2S + nsfwjs + CLIP) behind one
// HTTP endpoint. The FixMyCity backend calls POST /api/infer per uploaded
// complaint photo; this service returns an accept/block verdict.
//
// Deploy target: Hugging Face Spaces (Docker, must listen on port 7860, 16GB
// RAM holds the full pipeline). Env:
//   PORT    — listen port (default 7860; HF requires 7860)
//   ML_KEY  — shared secret; when set, POST /api/infer requires header
//             `X-ML-KEY: <ML_KEY>`. Server-to-server only (no CORS involved).
//
// Fail-open: models load in the listen callback AFTER the server is already
// accepting connections, exactly like the old monolith. A model-load failure
// logs and continues; infer() itself degrades to 'accept' on any inference
// error, so a citizen is never blocked by an ML fault.

const express = require('express');
const helmet = require('helmet');

const pipeline = require('./ml/pipeline');
const { infer } = require('./infer');

const app = express();
const PORT = process.env.PORT || 7860;
const ML_KEY = process.env.ML_KEY || '';

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '12mb' }));

// Optional shared-secret guard. When ML_KEY is unset the endpoint is open
// (fine for local dev); in deployment set ML_KEY on BOTH this service and the
// backend so only the backend can reach the inference box.
function requireMlKey(req, res, next) {
  if (!ML_KEY) return next();
  const provided = req.headers['x-ml-key'];
  if (provided !== ML_KEY) {
    return res.status(401).json({ message: 'Invalid or missing ML service key.' });
  }
  return next();
}

// -----------------------------------------------------------------------------
// POST /api/infer  — body: { imageBase64, type, title }
// Returns the verdict object (see infer.js contract).
// -----------------------------------------------------------------------------
app.post('/api/infer', requireMlKey, async (req, res) => {
  try {
    const { imageBase64, type, title } = req.body || {};
    const verdict = await infer({ imageBase64, type, title });
    res.status(200).json(verdict);
  } catch (e) {
    // Even a total failure here must fail open — tell the backend to accept.
    console.error('[infer] Unexpected error — returning fail-open accept:', e.message);
    res.status(200).json({
      action: 'accept',
      httpStatus: 201,
      blockPayload: null,
      imageCheck: {
        model: 'none', matched: null, blocked: false, score: null,
        classProbs: null, note: 'ML service error — submission accepted without check.',
      },
    });
  }
});

// -----------------------------------------------------------------------------
// GET /health — pipeline snapshot (the backend proxies this into /api/health).
// -----------------------------------------------------------------------------
app.get('/health', (req, res) => {
  try {
    const { civicModel, nsfwModel, ADVISORY_MODE, CIVIC_CLASSES, clipReady } = pipeline.getMeta();
    res.status(200).json({
      status: 'ok',
      service: 'ml',
      model_loaded: !!civicModel,
      nsfw_loaded: !!nsfwModel,
      clip_ready: !!clipReady,
      enforce_mode: !ADVISORY_MODE,
      classes: CIVIC_CLASSES,
      classifier: 'custom-civic-4class-tfjs (EfficientNetV2S)',
      content_moderation: nsfwModel ? 'active' : 'disabled',
    });
  } catch (e) {
    res.status(200).json({ status: 'degraded', service: 'ml', error: e.message });
  }
});

app.get('/', (req, res) => res.status(200).json({ service: 'fixmycity-ml', endpoints: ['/api/infer', '/health'] }));

const server = app.listen(PORT, () => {
  console.log(`[ml] Inference service listening on port ${PORT}`);
  if (!ML_KEY) console.warn('[ml] ⚠️  ML_KEY not set — /api/infer is UNPROTECTED. Set ML_KEY in production.');
  pipeline.loadAll()
    .then(({ clipReady }) => {
      console.log(`[clip] Others open-set classifier ${clipReady ? 'ready.' : 'DISABLED (keyword fallback only).'}`);
      console.log('[ml] Pipeline load complete — ready to serve /api/infer.');
    })
    .catch(e => console.error('[ml] Model load error (continuing, fail-open):', e.message));
});

// Graceful shutdown.
function shutdown(sig) {
  console.log(`[ml] ${sig} received — shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (r) => console.error('[ml] Unhandled rejection:', r));
process.on('uncaughtException', (e) => console.error('[ml] Uncaught exception:', e));
