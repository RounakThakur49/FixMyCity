'use strict';

/**
 * others_clip.js — Open-set "Others" classifier for FixMyCity (Owner F, IMPLEMENTATION_SPEC §5b).
 *
 * Pure-JS / WASM CLIP via @xenova/transformers (Xenova/clip-vit-base-patch32). No native deps.
 * Reads civic_exemplars.json (produced by build_others_exemplars.py, §5a) and scores an
 * incoming complaint (image + title) against per-category exemplar embeddings by cosine
 * similarity. Used by server.js for the Others routing path (§6.5).
 *
 * Contract (exact, consumed by server.js):
 *   module.exports = { load, classifyOthers, isReady };
 *   load(): Promise<boolean>            — true on success, false on any failure (CLIP disabled)
 *   isReady(): boolean
 *   classifyOthers({ imageBase64, title }): Promise<null | {
 *     suggestedClass, suggestedSubtype, scores, isCivic, oodScore, textScores, imageScores
 *   }>                                  — null on any failure (fail-open, never throws)
 *
 * Decode path is its own (jpeg-js -> RawImage), independent of server.js decodeImageToTensor.
 */

const fs = require('fs');
const path = require('path');

// ---- Frozen constants (SPEC §0) ---------------------------------------------
const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32';
const CLIP_EMBED_DIM = 512;
const CLIP_OOD_FLOOR_DEFAULT = 0.22; // overridden by civic_exemplars.json "ood_floor" if present

const EXEMPLARS_PATH = path.join(__dirname, 'civic_exemplars.json');
const CACHE_DIR = path.join(__dirname, '.cache');

// ---- Module state -----------------------------------------------------------
let _ready = false;
let _loading = null; // in-flight load() promise (dedupe concurrent calls)

let _tokenizer = null;
let _textModel = null;
let _processor = null;
let _visionModel = null;
let _transformers = null; // RawImage etc.
let _jpeg = null;

let _exemplars = null;    // parsed civic_exemplars.json
let _categories = [];     // ordered category keys
let _catToCivic = {};     // category -> human civic label
let _oodFloor = CLIP_OOD_FLOOR_DEFAULT;

// Precomputed per-category typed-array banks for fast cosine.
// _imageBank[c] = Float32Array[] (centroid + image_exemplars), each L2-normalized (len 512)
// _textBank[c]  = Float32Array[] (text_prompts[].vector),     each L2-normalized (len 512)
let _imageBank = {};
let _textBank = {};

// -----------------------------------------------------------------------------
// Math helpers
// -----------------------------------------------------------------------------

/** L2-normalize a plain array / typed array into a Float32Array (in place semantics). */
function l2normalize(vec) {
  const out = new Float32Array(vec.length);
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const norm = Math.sqrt(s) || 1;
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** Dot product of two equal-length (already L2-normalized) vectors == cosine similarity. */
function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Max cosine of query (normalized) against a bank of normalized vectors. */
function maxCosine(query, bank) {
  if (!query || !bank || bank.length === 0) return -Infinity;
  let best = -Infinity;
  for (let i = 0; i < bank.length; i++) {
    const c = dot(query, bank[i]);
    if (c > best) best = c;
  }
  return best;
}

// -----------------------------------------------------------------------------
// Exemplar loading
// -----------------------------------------------------------------------------

function loadExemplars() {
  if (!fs.existsSync(EXEMPLARS_PATH)) {
    console.warn('[others_clip] civic_exemplars.json not found — CLIP Others disabled.');
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(EXEMPLARS_PATH, 'utf8'));
  } catch (err) {
    console.warn('[others_clip] failed to parse civic_exemplars.json:', err.message);
    return false;
  }

  if (parsed.embedding_dim !== CLIP_EMBED_DIM) {
    console.warn(
      `[others_clip] embedding_dim mismatch (expected ${CLIP_EMBED_DIM}, got ${parsed.embedding_dim}) — disabled.`
    );
    return false;
  }

  if (parsed.model_id && parsed.model_id !== CLIP_MODEL_ID) {
    console.warn(
      `[others_clip] exemplar model_id "${parsed.model_id}" != runtime "${CLIP_MODEL_ID}" — ` +
      `embedding spaces differ, cosine scores would be meaningless. Disabled.`
    );
    return false;
  }

  const exemplars = parsed.exemplars || {};
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories
    : Object.keys(exemplars);

  if (categories.length === 0) {
    console.warn('[others_clip] no categories in civic_exemplars.json — disabled.');
    return false;
  }

  const imageBank = {};
  const textBank = {};

  for (const cat of categories) {
    const e = exemplars[cat];
    if (!e) continue;

    const imgVecs = [];
    if (Array.isArray(e.centroid) && e.centroid.length === CLIP_EMBED_DIM) {
      imgVecs.push(l2normalize(e.centroid));
    }
    if (Array.isArray(e.image_exemplars)) {
      for (const v of e.image_exemplars) {
        if (Array.isArray(v) && v.length === CLIP_EMBED_DIM) imgVecs.push(l2normalize(v));
      }
    }

    const txtVecs = [];
    if (Array.isArray(e.text_prompts)) {
      for (const tp of e.text_prompts) {
        if (tp && Array.isArray(tp.vector) && tp.vector.length === CLIP_EMBED_DIM) {
          txtVecs.push(l2normalize(tp.vector));
        }
      }
    }

    imageBank[cat] = imgVecs;
    textBank[cat] = txtVecs;
  }

  _exemplars = parsed;
  _categories = categories;
  _catToCivic = parsed.category_to_civic || {};
  _oodFloor =
    typeof parsed.ood_floor === 'number' ? parsed.ood_floor : CLIP_OOD_FLOOR_DEFAULT;
  _imageBank = imageBank;
  _textBank = textBank;

  return true;
}

// -----------------------------------------------------------------------------
// load() — lazy-load CLIP (text + vision) and exemplars
// -----------------------------------------------------------------------------

/**
 * Lazy-loads Xenova/clip-vit-base-patch32 (vision + text) and civic_exemplars.json.
 * @returns {Promise<boolean>} true on success, false on any failure.
 */
async function load() {
  if (_ready) return true;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      // Read exemplars first — cheap, and pointless to load the model without them.
      if (!loadExemplars()) {
        return false;
      }

      // Dynamic import: @xenova/transformers is ESM-only.
      const transformers = await import('@xenova/transformers');
      _transformers = transformers;

      const {
        env,
        AutoTokenizer,
        CLIPTextModelWithProjection,
        AutoProcessor,
        CLIPVisionModelWithProjection,
      } = transformers;

      // Pure-JS/WASM only. Force the WASM execution provider so transformers.js
      // does NOT silently bind onnxruntime-node (native) when its prebuild is
      // present — that would reintroduce the prebuilt-ABI failure mode this
      // project abandoned tfjs-node for. Install with `npm install --omit=optional`
      // so onnxruntime-node is never fetched (see RUNBOOK.md).
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;
      env.cacheDir = CACHE_DIR;
      try {
        if (env.backends && env.backends.onnx) {
          // Pin WASM, disable any native/node provider preference.
          env.backends.onnx.wasm = env.backends.onnx.wasm || {};
          if (env.backends.onnx.node) env.backends.onnx.node = undefined;
        }
      } catch (_) { /* best effort */ }

      _jpeg = require('jpeg-js');

      // Load text + vision halves of CLIP.
      _tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL_ID);
      _textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID);
      _processor = await AutoProcessor.from_pretrained(CLIP_MODEL_ID);
      _visionModel = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL_ID);

      _ready = true;
      console.log(
        `[others_clip] ready — ${_categories.length} categories, ood_floor=${_oodFloor}, model=${CLIP_MODEL_ID}`
      );
      return true;
    } catch (err) {
      console.warn('[others_clip] load() failed (CLIP Others disabled):', err.message);
      _ready = false;
      return false;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

function isReady() {
  return _ready;
}

// -----------------------------------------------------------------------------
// Embedding helpers
// -----------------------------------------------------------------------------

/** Extract the first row of a CLIP projection output Tensor as a normalized Float32Array. */
function embedToVec(tensor) {
  // @xenova Tensor: .data is a typed array, shape [1, 512] for a single input.
  const data = tensor && tensor.data ? tensor.data : tensor;
  const arr = data.length > CLIP_EMBED_DIM ? Array.prototype.slice.call(data, 0, CLIP_EMBED_DIM) : data;
  return l2normalize(arr);
}

/** Embed a title string -> normalized Float32Array, or null. */
async function embedText(title) {
  const text = (title || '').trim();
  if (!text) return null;
  try {
    const inputs = await _tokenizer([text], { padding: true, truncation: true });
    const out = await _textModel(inputs);
    return embedToVec(out.text_embeds);
  } catch (err) {
    console.warn('[others_clip] text embed failed:', err.message);
    return null;
  }
}

/** Strip a data-URI prefix and return a Buffer of the image bytes, or null. */
function base64ToBuffer(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== 'string') return null;
  let b64 = imageBase64;
  const comma = b64.indexOf(',');
  if (b64.slice(0, 5) === 'data:' && comma !== -1) {
    b64 = b64.slice(comma + 1);
  }
  try {
    return Buffer.from(b64, 'base64');
  } catch (_) {
    return null;
  }
}

/** Embed a base64 image -> normalized Float32Array, or null (treats failure as absent image). */
async function embedImage(imageBase64) {
  const buf = base64ToBuffer(imageBase64);
  if (!buf || buf.length === 0) return null;

  let decoded;
  try {
    // jpeg-js: RGBA Uint8Array, 4 channels. (PNG/other formats throw -> text-only fallback.)
    decoded = _jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
  } catch (err) {
    return null;
  }
  if (!decoded || !decoded.data || !decoded.width || !decoded.height) return null;

  try {
    const { RawImage } = _transformers;
    // Build an RGBA RawImage from jpeg-js output, then collapse alpha to RGB for the processor.
    let image = new RawImage(
      new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length),
      decoded.width,
      decoded.height,
      4
    );
    image = image.rgb(); // 3-channel

    const inputs = await _processor(image);
    const out = await _visionModel(inputs);
    return embedToVec(out.image_embeds);
  } catch (err) {
    console.warn('[others_clip] image embed failed:', err.message);
    return null;
  }
}

// -----------------------------------------------------------------------------
// classifyOthers() — the public scoring entry point
// -----------------------------------------------------------------------------

/**
 * @param {{ imageBase64?: string|null, title?: string }} input
 * @returns {Promise<null | {
 *   suggestedClass: string|null,
 *   suggestedSubtype: string|null,
 *   scores: Object<string, number>,
 *   isCivic: boolean,
 *   oodScore: number,
 *   textScores: Object<string, number>,
 *   imageScores: Object<string, number>
 * }>}
 */
async function classifyOthers({ imageBase64, title } = {}) {
  if (!_ready) return null;

  try {
    const imgVec = await embedImage(imageBase64);
    const txtVec = await embedText(title);

    // Nothing usable to score against -> fail-open.
    if (!imgVec && !txtVec) return null;

    const scores = {};
    const textScores = {};
    const imageScores = {};

    let bestCat = null;
    let bestFused = -Infinity;

    for (const cat of _categories) {
      const imgBank = _imageBank[cat] || [];
      const txtBank = _textBank[cat] || [];

      const imageSim = imgVec ? maxCosine(imgVec, imgBank) : -Infinity;
      const textSim = txtVec ? maxCosine(txtVec, txtBank) : -Infinity;

      const haveImage = imgVec && imgBank.length > 0;
      const haveText = txtVec && txtBank.length > 0;

      let fused;
      if (haveImage && haveText) {
        fused = 0.5 * imageSim + 0.5 * textSim;
      } else if (haveText) {
        fused = textSim;
      } else if (haveImage) {
        fused = imageSim;
      } else {
        fused = -Infinity; // no comparable bank for this category
      }

      // Expose per-modality scores (0 when that modality is absent/unavailable).
      imageScores[cat] = haveImage ? imageSim : 0;
      textScores[cat] = haveText ? textSim : 0;
      scores[cat] = fused === -Infinity ? 0 : fused;

      if (fused > bestFused) {
        bestFused = fused;
        bestCat = cat;
      }
    }

    if (bestCat === null || bestFused === -Infinity) return null;

    const suggestedSubtype = bestCat;
    const suggestedClass =
      _catToCivic[bestCat] !== undefined ? _catToCivic[bestCat] : 'Others';
    const oodScore = bestFused;
    const isCivic = oodScore >= _oodFloor;

    return {
      suggestedClass,
      suggestedSubtype,
      scores,
      isCivic,
      oodScore,
      textScores,
      imageScores,
    };
  } catch (err) {
    console.warn('[others_clip] classifyOthers failed:', err.message);
    return null;
  }
}

module.exports = { load, classifyOthers, isReady };
