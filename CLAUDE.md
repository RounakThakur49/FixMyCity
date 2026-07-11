# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FixMyCity is a civic complaint platform. Citizens register, file complaints about pothole / drainage / streetlight / other issues (with photo proof), and track status; admins review complaints, forward them to municipal departments, and resolve them. It has three independently-run tiers:

- **Frontend** (`frontend/`): Create React App (React 19) served on port 3000.
- **Backend** (`backend/`): Express + MongoDB (Mongoose) + JWT API on port 5000. **No ML dependencies of its own** — image validation is delegated to the ML pipeline. Two modes: (1) **HTTP** — call a separate `ml-service` over HTTP (`POST ${ML_SERVICE_URL}/api/infer`); (2) **in-process** (`ML_INLINE=true`) — load the sibling `ml-service` pipeline in the SAME process and call `infer()` directly, for a single co-run deploy (e.g. one Render free service). Fail-open either way if ML is unavailable.
- **ML service** (`ml-service/`): the entire multi-stage ML pipeline (custom EfficientNetV2S civic classifier + NSFW content moderation + CLIP open-set classifier) as a standalone folder. Runs as its own Express service on port 7860 (HTTP mode), OR is required in-process by the backend (`ML_INLINE` mode). `DISABLE_CLIP=true` skips the ~150MB CLIP model to fit memory-tight free tiers (512MB) — "Others" then uses keyword fallback; civic + NSFW stay active. Deploy targets: co-run on Render free (in-process), or a separate host (paid HF Docker Space / Oracle VM) in HTTP mode.

These are separate npm packages with separate `package.json` and `node_modules`. The CRA dev server proxies API calls to `http://localhost:5000` via the `"proxy"` field in `frontend/package.json`.

## Commands

Frontend (run from `frontend/`):
```bash
cd frontend
npm install
npm start                 # dev server on :3000
npm run build             # production build to /build
npm test                  # interactive Jest watch mode
npm test -- --watchAll=false src/App.test.js   # run a single test file once (CI-style)
```

Backend (run from `backend/`):
```bash
cd backend
npm install
npm run dev               # nodemon, auto-reload
npm start                 # plain node server.js
```

Requires a reachable MongoDB. Connection comes from `backend/.env` (`MONGO_URI`, `PORT`); defaults to `mongodb://127.0.0.1:27017/FixMyCity` and port 5000 if unset. The reference deployment uses MongoDB Atlas. To reach the ML service the backend also needs `ML_SERVICE_URL` (base URL, e.g. `http://localhost:7860`) and `ML_KEY` (shared secret) — if `ML_SERVICE_URL` is unset, image validation is skipped and complaints save unchecked (fail-open). See `backend/.env.example`.

ML service (run from `ml-service/`):
```bash
cd ml-service
npm install
node server.js            # inference service on :7860 (loads civic + nsfw + CLIP models in the listen callback)
```
Needs `PORT` (default 7860; HF Spaces requires 7860) and `ML_KEY` (must match the backend's `ML_KEY`; when set, `POST /api/infer` requires header `X-ML-KEY`). See `ml-service/.env.example`. This is the only tier with the heavy ML deps (`@tensorflow/tfjs`, `nsfwjs`, `@xenova/transformers`, `jpeg-js`, `pngjs`, `@tensorflow-models/mobilenet`).

Node version: **20 LTS** (use `nvm-windows` on Windows). Node 24 fails because TensorFlow.js native binding prebuilds don't exist for NAPI v10.

### DB connection note (Atlas)
The reference deployment uses a friend's MongoDB Atlas cluster; `backend/.env` holds `MONGO_URI`. Boot with `npm run dev` (nodemon) or `npm start`. Falls back to `mongodb://127.0.0.1:27017/FixMyCity` if `MONGO_URI` is unset.

> **Boot-time connect hardening:** `serverSelectionTimeoutMS` is set to **45000** on the initial Mongoose connect. This was originally to survive the event-loop block from loading pure-JS tfjs+nsfw models synchronously in the `app.listen` callback; that ML load has since moved out to `ml-service`, but the generous timeout is kept as durable headroom (a healthy server still connects in <1s; mongoose does NOT retry a failed *initial* connect, so a short timeout there would leave every request buffering). If Atlas is ever unreachable again (e.g. the `0.0.0.0/0` Network Access whitelist gets disabled), fix access on the Atlas side rather than pointing the app elsewhere.

### Testing (E2E)
```bash
# From repo root, with backend (npm run dev) + frontend (npm start) both running:
DISABLE_RATE_LIMIT=true npx playwright test    # tests/e2e/complaints.spec.js
```
`DISABLE_RATE_LIMIT=true` (backend env, dev/test only) bypasses the 5/min complaint limiter so the suite's rapid POSTs don't 429. The E2E helper skips known-contaminated dataset prefixes (`scrape_`/`drain_`/`bing_`) so ACCEPT assertions run on clean images.

ML retraining (Python, run from `backend/`):
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install tensorflow tensorflowjs scikit-learn pillow
python train_civic_model.py       # trains EfficientNetV2S on my_dataset/, exports civic_model_tfjs/
python temperature_scaling.py     # calibrates thresholds, writes civic_thresholds.json
python audit_dataset.py           # runs trained model against training set, flags mismatches
```

## Architecture

### Backend module layout (modular since July 2026 refactor)
`backend/server.js` is a **thin composition root** (~115 lines): global middleware → mount routers → error handler → `connectDB()` at boot (it only logs `ML_SERVICE_URL`, or warns if unset — the ML pipeline no longer loads in-process). Concerns live in dedicated modules — **route paths are unchanged** (each router declares its own full `/api/...` path, mounted at `/`), so the API contract and the live Vercel frontend are byte-for-byte compatible with the old monolith.

```
backend/
  server.js            # composition root — wires middleware + routers + boot
  config/db.js         # connectDB(): mongoose.connect (45s SST) + seed
  db/seed.js           # seedDatabase() — default admin/citizens/complaints
  middleware/
    security.js        # helmet, cors (CORS_ORIGIN), 3 rate limiters, DISABLE_RATE_LIMIT
    auth.js            # issueToken, requireAuth, requireAdmin, JWT_SECRET
  routes/
    health.js          # GET /api/health (best-effort fetch of ${ML_SERVICE_URL}/health)
    stats.js           # GET /api/stats
    auth.js            # register / login / update-profile
    complaints.js      # GET (paginated, back-compat) / POST (calls ML service) / PATCH status / DELETE
    reviews.js         # GET / POST reviews
  utils/
    datetime.js        # getFormattedDate (Asia/Kolkata string)
    mask.js            # maskAadhar
  aadhaar.js           # Verhoeff validation (shared with frontend copy)
  models/              # User, Admin, Complaint, Review (Mongoose)
  server.monolith.bak.js  # pre-refactor backup for rollback — DELETE once stable
```

**The ML pipeline is no longer in `backend/`** — it moved to the standalone `ml-service/` (see the "ML service" section below). The backend has zero ML dependencies; it reaches the pipeline over HTTP via `callMlInfer()` in `routes/complaints.js`.

The July 2026 module refactor was verbatim-slice (code moved byte-identical, only require/export glue hand-written) and verified: server boots clean, **28/28 API tests pass** identically to the monolith.

### ML service (`ml-service/`, split out July 2026)
A standalone Express inference service (port 7860) holding the **entire** ML pipeline. It was carved out of the backend so the API tier stays light (no tfjs/CLIP deps) and the heavy models can be deployed/scaled on their own box (Hugging Face Spaces, Docker).

```
ml-service/
  server.js            # Express :7860 — POST /api/infer, GET /health, GET /,
                       #   X-ML-KEY guard, helmet, 12mb JSON. Models load in the
                       #   listen callback (fail-open, exactly like the monolith).
  infer.js             # infer({imageBase64,type,title}) → verdict. The NSFW+civic+
                       #   CLIP orchestration moved VERBATIM out of the old
                       #   complaints.js POST handler (STEP 1 + STEP 2).
  ml/pipeline.js       # the pipeline module (checkNSFW, classifyCivicImage,
                       #   decideBlock, othersClip, TITLE_ROUTES, getMeta, loadAll…)
  others_clip.js       # CLIP open-set classifier (@xenova/transformers)
  civic_model_tfjs/    # TFJS civic model (~41MB, model.json + .bin shards)
  civic_thresholds.json, civic_exemplars.json
  nsfw_clean_dataset.js  # offline dev CLI (moved from backend)
  Dockerfile           # node:20, EXPOSE 7860 (HF Spaces)
  package.json         # ML deps ONLY
  .env.example, README.md
```

**Preserved-layout path note:** the internal layout was kept intact on purpose — `pipeline.js` stays in an `ml/` subdir (so its `ROOT_DIR = path.join(__dirname, '..')` still resolves to the service root) and `others_clip.js` + the JSON/model artifacts sit at the service root (so their `__dirname` paths resolve unchanged). **Zero path edits** were needed to move the code.

**`POST /api/infer` contract:**
- Request: `{ imageBase64, type, title }`
- Response: `{ action: 'accept'|'block', httpStatus: 201|422, blockPayload: object|null, imageCheck: object }`

The backend applies the verdict as-is: `block` → `res.status(verdict.httpStatus).json(verdict.blockPayload)`; `accept` → store `verdict.imageCheck` on the complaint. **Time authority stays on the backend** — `infer()` returns `imageCheck` *without* an `at` field; the backend stamps it with `getFormattedDate()` (Asia/Kolkata) at save time.

**Fail-open across the network boundary (two layers):**
1. Inside the service — any model-load failure or inference error degrades to an `accept` verdict with an advisory note; a citizen is never blocked by an ML fault.
2. In the backend — `callMlInfer()` returns `null` if `ML_SERVICE_URL` is unset, or if the fetch throws / times out (`AbortController`, `ML_TIMEOUT_MS` default 20000) / returns non-2xx. On `null`, the complaint is saved with note `'AI validation unavailable — submission accepted.'` The CMP-id generation + E11000 save-retry loop is unchanged.

**`X-ML-KEY` guard:** when `ML_KEY` is set, `POST /api/infer` requires header `X-ML-KEY: <ML_KEY>`; the backend sends it. This is server-to-server (no browser, **no CORS** involved) — set the same `ML_KEY` on both tiers in deployment so only the backend can reach the inference box. `GET /health` returns a pipeline snapshot (`model_loaded`, `nsfw_loaded`, `clip_ready`, `enforce_mode`, `classes`) which the backend proxies into `/api/health`.

**In-process mode (`ML_INLINE=true`, `backend/mlInline.js`):** for a single co-run deploy (e.g. one Render free service — 750hr/mo + 512MB), the backend loads the sibling `ml-service` pipeline into its OWN process (`require('../ml-service/ml/pipeline')` + `require('../ml-service/infer')`) and calls `infer()` directly — no HTTP hop, no `ML_KEY`. `server.js` warms the models at boot (`initInline()`); `routes/complaints.js` and `routes/health.js` route through `mlInline.js` instead of HTTP. Pair with `DISABLE_CLIP=true` (measured peak ≈280MB combined, well under 512MB). The `render.yaml` (repo root — NOT `rootDir:backend`, which would hide the sibling `ml-service` folder from the require) installs both folders' deps and sets `ML_INLINE=true DISABLE_CLIP=true`. This is the free-tier default; the standalone HTTP service (`ml-service/server.js`) is still used for separate-host deploys.

### State lives in App.js
`frontend/src/App.js` is the single source of truth for the entire frontend. It holds **all** state (session, complaints list, all form state, selection, `complaintError`) and **all** handlers (auth, complaint CRUD, image compression). Every component is presentational — they receive state and callbacks as props and render nothing on their own. There is no router, no global store, and no component-level data fetching. View switching is driven by `session.role`:

- no session → `Hero` (landing + login/register forms)
- `citizen` → `CitizenDashboard` (file + track complaints)
- `admin` → `AdminDashboard` (review, forward, resolve, delete)

When adding a feature, expect to add state + a handler in `App.js` and thread them down as props. Match this pattern rather than introducing local fetching or state in child components.

### Session + JWT auth (server-enforced since July 2026)
Login/register return a signed **JWT** (`token`) alongside the user object. The frontend keeps both in the `session` object, persisted to `localStorage` under `fixmycity-session`. On every **write** the frontend attaches `Authorization: Bearer <token>` (see `authHeaders()` in `App.js`); **reads stay public**. The backend verifies the token in `requireAuth`/`requireAdmin` middleware (`server.js`) — role checks are now server-side, not just the client-side `requiredRole` gate. `update-profile` trusts only `req.auth.sub` for identity (never a body `id`/`userId`). A 401 on any write clears the session and forces re-login (`handleExpiredSession`). Set `JWT_SECRET` in the host env. See "Security posture → Applied hardening" for the full route matrix.

### Complaints list — pagination (back-compat, July 2026)
`GET /api/complaints` (`routes/complaints.js`) is **back-compat by design**: with no query params it returns the full array (the shape the current frontend/Vercel build depends on). With `?page`/`?limit` it returns a paginated envelope `{ data, page, limit, total, totalPages }` (limit capped at 200, default 50); `?status=<enum>` filters via the status index. This is the scalability path — the deployed frontend still uses the array response; new/updated clients opt into pagination. Wiring the frontend to consume pages is the next step (see roadmap).

### Complaints use a human-facing string ID
Complaints are keyed throughout by a custom `id` field (`CMP-2401`, `CMP-2402`, …), **not** Mongo's `_id`. New IDs are generated in the create route by parsing the max existing CMP-XXXX serial and incrementing, with an E11000 retry loop for race-condition safety. All API routes (`/api/complaints/:id/status`, `DELETE /api/complaints/:id`) and all frontend lookups match on this `id`. Timestamps (`createdAt`, `updatedAt`, `updates[].at`) are stored as preformatted **strings** in `Asia/Kolkata` time (see `getFormattedDate`), not Date objects — sorting and display rely on the `YYYY-MM-DD HH:mm` lexical format.

### Status workflow + timeline
A complaint moves `Submitted → In Review → Forwarded → Resolved` (enum in `models/Complaint.js`). The status PATCH route auto-appends an entry to the `updates[]` array with a canned note per status; the frontend `Timeline` component renders this array. `forwardedTo` names a municipal department (`authorityOptions` in `App.js`).

### Civic image classifier (custom EfficientNetV2S, 4-class)
`POST /api/complaints` delegates the uploaded photo to the **ML service** (`callMlInfer()` → `POST ${ML_SERVICE_URL}/api/infer`); the pipeline below **executes in `ml-service/`, not in the backend process**. The stages and technical details are unchanged by the split:

1. **NSFW pre-screen** — `nsfwjs` detects adult/explicit content. Porn/Hentai >40% or Sexy >70% → hard-block the upload with 422.
2. **Custom civic classifier** — A 4-class EfficientNetV2S model trained on `my_dataset/` (~5,500 images across drainage/others/potholes/streetlight). Loaded from `civic_model_tfjs/` at boot via pure-JS `@tensorflow/tfjs`. The model has a dual-output head (logits + softmax probs) enabling:
   - **Temperature-calibrated probabilities** (T from `civic_thresholds.json`)
   - **Energy-based OOD detection** (out-of-distribution images flagged)
   - **Per-class confidence thresholds** with reliability flags
3. **Decision logic** (`decideBlock()`) applies three rules:
   - RULE 0 (OOD): Image doesn't resemble any known civic issue → block
   - RULE 1: Declared category confidence below calibrated threshold → block
   - RULE 2: Another category is ahead by more than a margin → block (tighter margin for potholes↔drainage pair)
4. **Advisory mode** — Triggered when macro-F1 < 0.55 or calibration warning exists. In advisory mode, the classifier annotates but never blocks.
5. **"Others" open-set path** — Never blocked. CLIP (`others_clip.js` via `@xenova/transformers`) scores the image+title against per-category exemplar embeddings from `civic_exemplars.json`. Falls back to keyword title routing when CLIP is unavailable.

The classifier **fails open at two layers** (see the ML service section): the service degrades to `accept` on any model/inference fault, and the backend saves the complaint anyway if the service is unreachable. Advisory text is stored on the `imageCheck` subdocument (the backend stamps its `at` timestamp) and shown to admins.

Images are sent inline as base64 in the JSON body (hence the `50mb` body limit); the frontend compresses them client-side in `compressImage` (800×800, JPEG 70% quality) before upload.

### Database seeding
On connect, `seedDatabase()` inserts default users and complaints **only if the collections are empty**. Seeded credentials: admin `admin@fixmycity` / `rounak123`; citizens `9876543210` and `9123456780`, both password `citizen123`. Passwords are bcrypt-hashed; `aadhar` is unique so each user must have a distinct one.

### Database indexes
`Complaint` model has indexes on `updatedAt` (desc), `status`, and `citizenPhone` to support the common query patterns (list sorted by recent, filter by status, lookup by citizen). `Review` model indexes `createdAt` (desc). Without these, MongoDB would full-scan + in-memory sort, hitting the 32MB sort cap past ~tens of thousands of documents.

### ML files
The **Python training pipeline stays in `backend/`** (offline dev tooling); the **runtime inference artifacts moved to `ml-service/`** in the July 2026 split.

In `backend/` (training/offline):
- `train_civic_model.py` — 3-stage progressive training (head → top-60 unfreeze → full fine-tune) with EfficientNetV2S backbone, Focal Loss, CutMix/Mixup augmentation, anti-collapse export gate.
- `temperature_scaling.py` — Post-training calibration. Fits temperature on logits, computes per-class thresholds, writes `civic_thresholds.json`.
- `audit_dataset.py` — Runs trained model against every training image; flags high-confidence folder/prediction mismatches into `audit_report.csv`.
- `civic_model.keras` — Keras source-of-truth model (output of `train_civic_model.py`).
- `civic_labels.json` — Class index order (`['drainage','others','potholes','streetlight']`).
- `my_dataset/{potholes,drainage,streetlight,others}/` — Training images. Counts: ~1,578 / ~1,101 / ~1,640 / ~1,235 (~5,554 total).

In `ml-service/` (runtime, loaded by the inference service):
- `others_clip.js` — CLIP-based open-set classifier for the "Others" category. Uses `@xenova/transformers` (Xenova/clip-vit-base-patch32) with exemplar embeddings from `civic_exemplars.json`.
- `civic_thresholds.json` — Calibrated thresholds, temperature, OOD config, reliability flags (produced by `backend/temperature_scaling.py`).
- `civic_exemplars.json` — CLIP exemplar embeddings for the Others open-set path.
- `civic_model_tfjs/` — TFJS-converted model files (`model.json` + `.bin` shards, ~41MB). Loaded at boot by `ml-service/server.js`.
- `nsfw_clean_dataset.js` — offline dev CLI (moved from `backend/`).

> When retraining, copy the regenerated `civic_thresholds.json` / `civic_exemplars.json` / `civic_model_tfjs/` from `backend/` into `ml-service/` (or re-export directly there).

### Current model performance (V2S retrain, July 2026)
- val_macro_f1: 0.952 (up from 0.8976 on the previous B0 model)
- val_accuracy: 96.8% (calibrated == uncalibrated)
- Backbone: EfficientNetV2S (10 TFJS weight shards; graph-model, dual-output head)
- Temperature: 0.5736
- OOD: energy-based (energy_threshold −2.296, p95); entropy fallback for softmax-only models
- Calibrated thresholds: drainage=0.063, potholes=0.0, streetlight=0.0 (`others` has no threshold — open-set, never blocked). potholes/streetlight are 0.0 by design (high-recall; RULE1 disabled for them, RULE0 OOD + RULE2 mismatch still guard).
- Per-class: drainage F1=0.82 (weakest), potholes F1=0.82, streetlight F1=0.82 (all P≈0.70 → ~30% inter-class false-accept by design)

> **CRITICAL FIX (July 2026):** `decideBlock()` read thresholds with `||`, which treats a calibrated `0.0` as falsy and silently reverted potholes/streetlight to stale `0.45/0.40` defaults — hard-blocking the exact domain-gap citizen photos the V2S retrain set `0.0` to accept. Fixed to `??` in `decideBlock()`'s RULE1 (`declaredProb`/`threshold` lookups; now in `ml-service/ml/pipeline.js`). Verified: correct-category clean images now accept (201); junk/cross-category still block (422).

### Known ML limitations
- **Dataset contamination (CRITICAL, found July 2026)**: ~30% of training images are junk — NSFW anime, fashion photos, TV posters, puppies, cricket matches, video game screenshots. Contaminated prefixes: `drain_*` (193), `scrape_*` (1086 across drainage+others), `bing_*` (20 drainage), `oth_*` (all ~350), `kag_*` (12 others). Clean sources: `nst_dr_image_*` (drainage), `kag_*`/`kg_potholes_*`/`nst_ph_*` (potholes), `kg_streetlight_*`/`nst_sl_*` (streetlight). **Must run cleanup before retraining** — see `FixMyCity_Colab_Train.ipynb` cell 4b.
- **"Others" category empty after cleanup**: All 1,235 images were junk. Rebuilt from TACO trash dataset (CC BY 4.0) + manual curation needed. Target: 400+ real civic issue images (garbage, broken benches, fallen trees, debris).
- **Domain gap**: Training images from Kaggle/Bing may not fully represent citizen phone photos (different lighting, angles, compression). **Mitigation**: Colab notebook includes JPEG compression artifact simulation augmentation; add 100-200 diverse phone photos per category before retraining.
- **Drainage weakness**: Lowest F1 (0.78) due to visual similarity with potholes (road/asphalt textures). Tightened RULE2 margin for potholes↔drainage pair (0.05 vs global 0.12).
- **Double compression**: Frontend JPEG 70% → backend decode creates artifacts not present in training. **Mitigation**: Colab notebook now re-saves 30% of training images with JPEG quality 50-80% to simulate.
- **PNG support**: Fixed. `pngjs` now handles real PNG images (was previously broken — jpeg-js can't decode actual PNG files).

### Verified public datasets for supplementing training
- **RDD2022** (India subset, 9,665 images) — real dashcam/phone pothole photos. CC BY-SA 4.0. Figshare ID 21431547.
- **TACO** (1,500 images, 60 trash classes) — real mobile phone garbage photos. CC BY 4.0. GitHub pedropro/TACO.
- **DataCluster Potholes** — crowdsourced phone photos from 2,000+ Indian locations. Free Kaggle sample, full set paid.
- **Flood Classification** (9,296 flood images) — ground-level urban flooding for drainage. Kaggle.
- **Roboflow Street Light** (1,232 images) — streetlight object detection. CC BY 4.0.

## Security posture

### Applied hardening
- Public model file serving removed (was `/model` static route)
- Health endpoint trimmed to not expose internal ML thresholds/config
- Raw logits and full class probability arrays stripped from 422 error responses
- **Helmet** security headers added (CSP, X-Frame-Options, HSTS, X-Content-Type-Options)
- **Rate limiting** added via `express-rate-limit`: login/register (10/15min), complaint creation (5/min), global (300/15min)
- **CORS locked down** — restricted to `localhost:3000` + configurable via `CORS_ORIGIN` env var
- **Aadhar masking** — API responses return `XXXX XXXX 1234` format, never full 12-digit number
- **Input validation** — maxlength on Mongoose schema string fields (Complaint, Review), complaint ID format validation (`/^CMP-\d+$/`), status enum validation before processing
- **Password complexity** — registration requires minimum 8 characters
- **User enumeration fixed** — login returns generic "Invalid credentials" (401) for both bad user and bad password
- **Body limit reduced** — 10MB (from 50MB), sufficient for compressed 800x800 JPEG photos
- **Update profile route added** — `PATCH /api/auth/update-profile` (was called by frontend but missing from backend)
- **PNG decoding fixed** — proper `pngjs` support instead of broken jpeg-js fallback
- **NoSQL injection guards (July 2026)** — login/register/update-profile reject non-string body fields (`identifier`, `password`, `userId`, etc.) so a `{"$ne":null}` operator object can't reach `findOne`/`findById`.
- **Decompression-bomb cap (July 2026)** — `jpeg.decode` bounded with `maxResolutionInMP:40` + `maxMemoryUsageInMB:512` so a tiny JPEG declaring huge dimensions can't balloon into GBs of RGBA before the 3-model pipeline.
- **Schema enums (July 2026)** — `Complaint.type` (4 categories), `User.role`/`Admin.role` constrained via Mongoose `enum`; `Complaint.images` capped at 6 to protect the 16MB BSON limit.
- **JWT server-side auth (July 2026)** — the former #1 gap is closed. `POST /api/auth/login` and `/register` now return a signed JWT (`jsonwebtoken`, `JWT_SECRET` env, 7d expiry, payload `{sub,role,name}`). Middleware in `server.js`: `requireAuth` (any logged-in user) gates `POST /api/complaints`, `POST /api/reviews`, `PATCH /api/auth/update-profile`; `requireAdmin` gates `PATCH /api/complaints/:id/status` and `DELETE /api/complaints/:id`. **Reads stay public** (`GET /api/complaints|stats|reviews`, health). `update-profile` derives the target user from `req.auth.sub` (token), never from the body — a caller can only edit their own profile. Frontend stores the token in the `session` object (localStorage) and sends `Authorization: Bearer` on all writes (`authHeaders()` in `App.js`); a 401 triggers `handleExpiredSession()` (clean re-login). **Set `JWT_SECRET` in the host/Vercel env — an unset secret falls back to an insecure dev value and warns at boot.**
- **Password hash never serialized (July 2026)** — `User.password`/`Admin.password` are `select: false`; only `login` and `update-profile` opt in with `.select('+password')` (needed for `bcrypt.compare` / `.save()` validation).
- **Aadhaar Verhoeff validation (July 2026)** — registration now runs full offline format validation (`backend/aadhaar.js`, mirrored client-side in `frontend/src/aadhaar.js`): 12 digits + first-digit 2–9 rule (UIDAI reserves 0/1) + Verhoeff checksum. Rejects typos/random fakes like a government portal. **Format-valid only, NOT identity proof** — genuine verification needs UIDAI's OTP-consented AUA/KUA API (licensed, out of scope). Aadhaar is now immutable post-registration (Edit Profile shows it read-only).
- **ML service isolation + `X-ML-KEY` (July 2026)** — the ML pipeline runs in a separate service (`ml-service/`, port 7860). The backend calls it **server-to-server** (`POST ${ML_SERVICE_URL}/api/infer`) — **no browser, no CORS** — guarded by an `X-ML-KEY` shared secret (`ML_KEY`, sent by the backend, enforced by the service when set). Model weights, thresholds, OOD config, and CLIP exemplars no longer sit in the public-facing API tier. **Set `ML_KEY` identically on both tiers in deployment**, and never expose `ml-service` directly to the internet without it. Env vars: backend needs `ML_SERVICE_URL` + `ML_KEY` (alongside `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT`); the service needs `PORT=7860` + `ML_KEY`. See `backend/.env.example`, `ml-service/.env.example`, `frontend/.env.example`, and the root `DEPLOY.md` (+ `backend/render.yaml`).

### Known gaps (architectural — require design decisions)
- **JWT stored in localStorage** — the token lives in the `session` object in `localStorage` (XSS-readable). Acceptable for the current demo; for production prefer an httpOnly cookie + CSRF token. No token refresh/rotation yet (7d hard expiry → re-login).
- **No CSRF protection** — moot while the token is a `Bearer` header (not a cookie); revisit if moving to cookie auth.
- **CORS wide open for non-browser clients** — the JWT now provides real per-request auth, but API keys are still advisable for machine clients.
- **Aadhar (national ID) still stored in plaintext in DB** — consider encrypting at rest.
- **Base64 images stored in MongoDB BSON** — 16MB document limit; consider GridFS or S3 for production.

## Notes

- All API requests from the frontend send an `ngrok-skip-browser-warning: true` header — the app is intended to be tunneled via ngrok for demos. `API_BASE_URL` can be overridden with `REACT_APP_API_URL`.
- The MongoDB instance is local-standalone or Atlas; there is no migration tooling — schema changes take effect on next write.
- TFJS-Node native bindings are NOT used. Pure-JS tfjs is slower but works on any Node 20 environment without C++ toolchain.
- HTML5 `required` attributes block empty-field submission for Title / Location / Description.
- Admin actions: per-complaint Approve / Forward / Solve / Delete buttons live in the detail panel. Solve immediately bumps `resolved` counter and updates timeline. Forward requires a department selection (see `authorityOptions` in `App.js`).
- Frontend CSS has three layered design systems in App.css (~7,700 lines) — a consolidation pass is needed. See UI/UX audit notes.
- Toast component exists but is unused; frontend still uses `alert()`/`confirm()`.
- User dropdown (sign out, edit profile) is hover-only — no keyboard/touch access. (Profile-edit modal itself now closes on Escape + has `role="dialog"`/`aria-modal`; dropdown trigger still needs keyboard support.)

### Bug fixes (July 2026)
- **Edit Profile was fully broken** — `Header.jsx` sent `{id, aadhar, ...}` but the route read `userId`, and it re-validated the *masked* `XXXX XXXX 1234` aadhar against `/^\d{12}$/` → every save 400'd before reaching the server. Fixed: identity now comes from the JWT (no id in body), aadhar is immutable/read-only (not sent, not validated). Payload is `{name, phone, email}`.
- **Live GPS location never stored** — `GoogleMap.handleGeolocate` only called `onChangeLocation` *inside* `if (isLoaded)`, so with a missing/invalid Maps API key (e.g. on Vercel) the SDK never loaded, coords were captured but never propagated to state → `latitude`/`longitude` saved as `null`. Fixed: coordinates now propagate unconditionally (reverse-geocoded address is best-effort on top); geolocation timeout raised 5s→15s.
- **`TITLE_ROUTES` was a swallowed `ReferenceError` (fixed for free by the ML split)** — the Others keyword-fallback path used `TITLE_ROUTES` in the old `backend/routes/complaints.js`, but that constant was defined-and-unexported in `pipeline.js` and never imported into the route → it threw a `ReferenceError` that the fail-open catch silently absorbed (keyword advisory never actually ran). The orchestration now lives in `ml-service/infer.js`, which **imports `TITLE_ROUTES` from `./ml/pipeline`** (pipeline.js now exports it) → the keyword fallback works.

## Frontend UI/UX audit findings (July 2026)

### CSS architecture debt
- **Three layered design systems in App.css (~7,700 lines)**:
  1. Lines 1-2400: "Glassmorphism" — `Plus Jakarta Sans`, teal brand, `backdrop-filter: blur()`, `.card-panel-modern` classes
  2. Lines 3600-4800: "Landing Dark Navy" — `Barlow` font, navy/orange/yellow palette, `.landing-*` classes
  3. Lines 4800-7700: "Admin/Dashboard Flat" — overrides System 1 with `!important`, cream `#F4EFE4` background, `*-new` suffix classes
- ~1,000 lines dead CSS from System 1 (never referenced in JSX)
- 15+ `!important` overrides for specificity conflicts
- Three different font families (`Plus Jakarta Sans`, `Barlow`, `DM Mono`)

### Accessibility blockers (P0)
- Dropdown is **hover-only** (`Header.jsx:122`) — no keyboard focus, no `aria-expanded`, no `aria-haspopup`
- **No focus trap** in auth modal (`Hero.jsx:840-1169`) or profile edit modal
- Form labels not linked to inputs (missing `htmlFor`/`id` pairs)
- Category cards and feed items are clickable divs without `role="button"` or `onKeyDown`
- Tab panels missing `role="tabpanel"` and `aria-labelledby`
- Color contrast concerns: `rgba(255,255,255,0.85)` and `rgba(26,36,56,0.7)` may fail WCAG AA

### UX gaps (P1)
- **No loading states** on form submission (double-submit risk on login, register, complaint creation)
- **No Error Boundary** — component crash = white screen
- `alert()`/`confirm()` used in 7 places (`App.js:469,479,497,509,526,542`, `GoogleMap.jsx:311,351`) — Toast component exists at `Toast.jsx` but is never imported
- No optimistic updates on status changes or deletions

### Component architecture concerns (P2)
- `Hero.jsx` is 1,172 lines — handles landing page + auth modal + feed + testimonials + footer
- Identical code duplicated: `statusOptions`/filtering in both `ComplaintList.jsx` and `AdminDashboard.jsx`; lightbox overlay duplicated in `CitizenDashboard.jsx` and `AdminDashboard.jsx`
- No `React.memo` on any component — full re-render tree on every state change
- `Hero.jsx:126-149` runs 4x `.filter()` on complaints array without `useMemo`
- Base64 images stored in React state cause large prop re-renders

### Animation concerns
- `framer-motion` used in 7 of 10 components — `layoutId` on complaint list items forces layout recalculation on filter changes
- ~~`Timeline.jsx` runs infinite `scale`+`opacity` animation on every dot~~ **FIXED (July 2026)** — only the latest/current dot pulses now (`isCurrent` gate); older dots are static. Was N perpetual loops per open complaint (CPU/battery drain on citizen phones).
- Hero stagger animations fire on every page load

### Google Maps
- Well-structured with 3 modes (form/detail/overview)
- API key exposed in `<script>` URL — acceptable for client-side Maps SDK
- Memory leak potential: map event listeners not cleaned up in useEffect cleanup

## Future work roadmap (gov-grade robustness — prioritized, July 2026 audit)

Ordered by impact-to-risk. Items marked ✅ shipped this session; the rest are the concrete next steps for production/citizen rollout.

**Scalability (P0)**
1. ✅ **Backend pagination** — `GET /api/complaints?page&limit&status` (back-compat array when no params). Shipped.
2. ✅ **ML service split** — the entire ML pipeline moved to a standalone inference service (`ml-service/`, port 7860, HF Spaces Docker); the backend is now ML-dep-free and calls it over HTTP (`POST /api/infer`, `X-ML-KEY`, fail-open). Shipped this session.
3. **Wire frontend to pagination** — `App.js` still fetches ALL complaints on mount + holds them (with inline base64) in React state. Switch admin/citizen lists to page through `?page` + infinite-scroll/pager, keep a lightweight count for stats. Removes the single biggest memory/payload risk. *Contained frontend change; back-compat backend already in place.*
4. **Image offload (base64 → GridFS/S3)** — `Complaint.images` stores full base64 inline in the BSON doc (16MB/doc cap; every list query ships every image). Target: store bytes in **GridFS** (no new infra — lives in the same Atlas cluster) or S3; persist only an `imageId`/URL on the complaint; add `GET /api/complaints/:id/image/:n` serving route; frontend `<img src=URL>` instead of base64. **Coordinated FE+BE + one-time migration of existing docs** — must ship together or the deployed frontend's base64 rendering breaks. Not done this session precisely to avoid a half-migrated live deploy.

**Frontend performance (P1)**
4. `React.memo` on presentational components + `useCallback` on the handlers threaded from `App.js` — currently every state change re-renders the whole tree including base64-heavy nodes.
5. Replace `framer-motion` `layoutId` on list items (forces layout recalc on every filter) with cheaper enter/exit transitions.
6. Clean up Google Maps event listeners in `useEffect` cleanup (leak on repeated form opens).

**Design / accessibility (P1 — gov compliance)**
7. **CSS consolidation** — collapse the 3 layered design systems (~7,700 lines, ~1,000 dead) into one token set. The dark-modal-on-cream clash just fixed in the profile modal is the same class of bug lurking elsewhere.
8. **Keyboard a11y** — user dropdown is hover-only (`Header.jsx`); add `aria-expanded`/`aria-haspopup` + focus/keyboard open. Add focus-trap to modals. Link form labels (`htmlFor`/`id`). Audit contrast for WCAG AA.
9. Replace `alert()`/`confirm()` (7 sites) with the existing unused `Toast` component + a proper confirm dialog.

**Backend / architecture (P2)**
10. Extract inline route handlers into a `controllers/` layer (routes = wiring only) now that the module split exists.
11. Add request-validation middleware (e.g. `zod`/`joi`) instead of hand-rolled per-route checks.
12. Encrypt Aadhaar at rest (currently plaintext in DB).
13. Move JWT from `localStorage` to httpOnly cookie + CSRF token for production; add token refresh/rotation.
14. Delete `backend/server.monolith.bak.js` once the modular structure is confirmed stable in the deployment.

