// mlInline.js — in-process ML adapter for co-run deployments.
//
// When ML_INLINE=true the backend and the ML pipeline run in ONE process (e.g.
// a single Render free service, to fit 750hr/month + 512MB). This module lazily
// loads the sibling ml-service pipeline exactly once and exposes:
//   initInline()  — load models (idempotent; safe to call at boot AND per request)
//   inlineInfer() — run one inference (verdict object)
//   inlineMeta()  — getMeta() snapshot for /api/health
//   ML_INLINE     — the mode flag
//
// The ml-service folder is a sibling of backend/ and carries its own
// node_modules + model artifacts; require paths resolve from backend/ → ../ml-service/.
// Set DISABLE_CLIP=true alongside ML_INLINE to keep RAM under 512MB.

const ML_INLINE = process.env.ML_INLINE === 'true';

let _infer = null;
let _pipeline = null;
let _ready = null; // Promise — the single in-flight/So-far load.

function initInline() {
  if (!ML_INLINE) return Promise.resolve(false);
  if (_ready) return _ready;
  _ready = (async () => {
    _pipeline = require('../ml-service/ml/pipeline');
    _infer = require('../ml-service/infer').infer;
    const { clipReady } = await _pipeline.loadAll();
    console.log(`[ml] In-process pipeline loaded (ML_INLINE=true). CLIP ${clipReady ? 'ready' : 'disabled'}.`);
    return true;
  })();
  return _ready;
}

async function inlineInfer(args) {
  await initInline();
  return _infer(args);
}

function inlineMeta() {
  if (!_pipeline) return null;
  return _pipeline.getMeta();
}

module.exports = { ML_INLINE, initInline, inlineInfer, inlineMeta };
