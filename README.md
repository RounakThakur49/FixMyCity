# FixMyCity

Citizen-powered civic complaint platform. Residents report road / pothole / drainage / streetlight / miscellaneous issues with photo proof and live status tracking; admins triage, forward to municipal departments, and resolve.

Built for **SIH PS 25031** (Smart India Hackathon — Civic Issue Reporting).

FixMyCity is a **3-tier application**:

- **Frontend** (`frontend/`) — React 19 (CRA) SPA, deployed to Vercel. Talks only to the backend.
- **Backend** (`backend/`) — Express + MongoDB + JWT API. Lightweight (no ML deps); handles auth, CRUD, and proxies image validation to the ML service.
- **ML service** (`ml-service/`) — standalone Express inference service (EfficientNetV2S civic classifier + NSFW moderation + CLIP), deployed on an Oracle Cloud A1 VM (primary) or co-run inline on Render (fallback). Called server-to-server by the backend.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 (Create React App), framer-motion, lucide-react, Google Maps |
| Backend | Node.js 20 LTS, Express 4, Mongoose, bcryptjs, jsonwebtoken, helmet, express-rate-limit — **no ML deps** |
| Database | MongoDB (Atlas cluster or local) |
| ML service | Node.js 20 LTS, Express 4 + `@tensorflow/tfjs` (pure-JS), `nsfwjs`, `@xenova/transformers` (CLIP) |
| ML (training) | Python 3.11, TensorFlow/Keras, EfficientNetV2S backbone, scikit-learn |

The image validation pipeline runs a **custom 4-class civic model** (EfficientNetV2S, trained on ~5,500 images) that can block submissions when the photo doesn't match the declared category. NSFW content moderation blocks inappropriate uploads. An advisory mode degrades gracefully when model confidence is low. **These models now run in the separate `ml-service/` tier** — the backend calls it over HTTP and **fails open** (saves the complaint unchecked) if the service is unreachable.

---

## Architecture

```
   Browser
      │  (HTTPS, JWT Bearer on writes; reads public)
      ▼
┌─────────────┐        ┌──────────────────────┐        ┌───────────────────────┐
│  Frontend   │───────▶│      Backend         │───────▶│      ML service       │
│  React 19   │  REST  │  Express + JWT + CRUD │  HTTP  │  EfficientNetV2S +    │
│  (Vercel)   │◀───────│      (Render/HF)      │◀───────│  nsfwjs + CLIP        │
└─────────────┘        └──────────┬───────────┘ X-ML-KEY│  (HF Spaces, :7860)   │
                                  │                      └───────────────────────┘
                                  ▼
                         ┌────────────────┐
                         │  MongoDB Atlas │
                         └────────────────┘
```

- **Frontend → Backend** — all data + JWT auth. Base URL from `REACT_APP_API_URL` (baked at build time).
- **Backend → ML service** — server-to-server (no CORS), guarded by a shared `X-ML-KEY` secret. **Fails open**: if the ML service is down/unreachable, the complaint still saves without image validation.
- **Backend → MongoDB Atlas** — users, complaints, reviews.

Each tier runs and deploys independently. See [`DEPLOY.md`](./DEPLOY.md) for the full runbook.

---

## Prerequisites

- **Node.js 20 LTS** — verify with `node -v`. Install via [nvm-windows](https://github.com/coreybutler/nvm-windows) (Windows) or [nvm](https://github.com/nvm-sh/nvm) (mac/Linux).
- **MongoDB** — either a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (recommended) or a local `mongod` instance.
- **Git**
- **(Optional) Python 3.9+** + venv — only needed to retrain the classifier on your own dataset.

> Node 24 will fail. TensorFlow.js native prebuilts don't ship for NAPI v10, so stay on Node 20.

---

## Quick start

### 1. Clone

```bash
git clone <repo-url> FixMyCity
cd FixMyCity
```

### 2. MongoDB

**Option A — MongoDB Atlas (recommended):**

1. Create a free cluster at https://cloud.mongodb.com/
2. Database Access → add user with password.
3. Network Access → add IP `0.0.0.0/0` (or your IP).
4. Cluster → Connect → Drivers → copy the connection string.

**Option B — local MongoDB:**

Install MongoDB Community Server and run it. Default URI: `mongodb://127.0.0.1:27017/FixMyCity`.

### 3. ML service

Start the inference tier **first** — the backend calls it during complaint uploads (and fails open if it's down). In its own terminal:

```bash
cd ml-service
npm install
node server.js
```

Listens on **`http://localhost:7860`**. Optionally create `ml-service/.env` (see `ml-service/.env.example`):

```env
PORT=7860
ML_KEY=           # leave blank for local dev; set the same value on the backend to lock down /api/infer
```

First boot loads the tfjs + nsfwjs + CLIP models (several seconds). Endpoints: `POST /api/infer` (guarded by `X-ML-KEY` when `ML_KEY` is set) and `GET /health`.

### 4. Backend

```bash
cd backend
npm install
```

Create `backend/.env` (see `backend/.env.example` for all options):

```env
MONGO_URI=mongodb+srv://your_user:your_pass@cluster.xxxxx.mongodb.net/FixMyCity?retryWrites=true&w=majority
PORT=5000
JWT_SECRET=change-me-to-a-long-random-string
CORS_ORIGIN=http://localhost:3000
ML_SERVICE_URL=http://localhost:7860
ML_KEY=           # must MATCH the ml-service ML_KEY (blank both for local dev)
```

> **`JWT_SECRET` is required for real auth.** If unset, the server falls back to an insecure dev value and warns at boot — fine for local dev, never for a deployed build. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
>
> **`ML_SERVICE_URL`** points at the ML service (step 3). If unset or unreachable, image validation is skipped and complaints save unchecked (**fail-open**).

Start backend:

```bash
npm run dev
```

Expected boot output:

```
Express server running on port 5000
Connected to MongoDB.
[ml] Image validation delegated to ML service: http://localhost:7860
```

### 5. Frontend

In a **new terminal**:

```bash
cd frontend
npm install
npm start
```

App opens at `http://localhost:3000`. The frontend reads the backend URL from `REACT_APP_API_URL` (see `frontend/.env.example`; defaults to `http://localhost:5000`).

### 6. Log in

Default users are seeded on first connect (only if the DB is empty), defined in
`backend/db/seed.js`. The seeded **citizen** demo login is:

| Role | Username | Password |
|------|----------|----------|
| Citizen | `9876543210` | `citizen123` |

The admin account is also seeded there. **Change the seeded admin credentials in
`backend/db/seed.js` before any public deployment** — do not ship the demo admin
password. Passwords are bcrypt-hashed; each user needs a distinct Aadhaar.

> **Auth (July 2026):** login/register return a signed **JWT**. The frontend stores it in the `session` object and sends `Authorization: Bearer <token>` on all writes. Reads (`GET`) stay public. Server-side middleware enforces roles — a citizen token cannot hit admin routes (status/delete). A 401 on any write forces a clean re-login.

---

## Health check

```bash
curl http://localhost:5000/api/health   # backend (proxies ML service /health)
curl http://localhost:7860/health        # ML service directly
```

---

## Environment variables

Each tier has its own `.env.example` — copy it to `.env` for local dev, or set the values in your host's dashboard for deployment.

**Frontend** (`frontend/.env.example`):

| Var | Purpose |
|-----|---------|
| `REACT_APP_API_URL` | Base URL of the backend API. **Baked at build time** — redeploy after changing. Defaults to `http://localhost:5000`. |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | (Optional) Google Maps key; without it the map falls back to geolocation-only. |

**Backend** (`backend/.env.example`):

| Var | Purpose |
|-----|---------|
| `MONGO_URI` | MongoDB connection string (Atlas or local). Falls back to local `mongod`. |
| `JWT_SECRET` | JWT signing secret. **Set a strong random value in production** (unset → insecure dev fallback + boot warning). |
| `CORS_ORIGIN` | Comma-separated allowed browser origins. Defaults to `http://localhost:3000`. |
| `ML_SERVICE_URL` | Base URL of the ML service. Unset/unreachable → image validation skipped (fail-open). |
| `ML_KEY` | Shared secret sent as `X-ML-KEY` to the ML service. Must **match** the ML service's `ML_KEY`. |
| `PORT` | Backend listen port (default 5000). |

**ML service** (`ml-service/.env.example`):

| Var | Purpose |
|-----|---------|
| `PORT` | Listen port. Default **7860**; on Oracle it's the localhost bind (backend calls `http://localhost:7860`). |
| `ML_KEY` | Shared secret. When set, `POST /api/infer` requires header `X-ML-KEY: <ML_KEY>`. Blank → endpoint open (local dev only). |

---

## Deployment

**Primary (recommended, full pipeline, free forever):**

- **Oracle Cloud Ampere A1 Always-Free VM** (ARM64, up to 4 OCPU / 24 GB, always-on) runs **both** backend `:5000` + ML service `:7860` as a real split (back→ml over localhost), with **civic + NSFW + CLIP all ON** and inference in a few seconds. Card required at signup for ID only (tier is $0). See **[`ORACLE_DEPLOY.md`](./ORACLE_DEPLOY.md)** + the ready `ml-service/deploy-oracle.sh`.
- **Frontend** → Vercel.

**Fallback (no card, but RAM-constrained):**

- **Backend + ML co-run on one Render free service** (in-process, `ML_INLINE=true`) — the repo-root **`render.yaml`** blueprint is provided. Render's 512 MB forces `DISABLE_CLIP=true` (and optionally `DISABLE_NSFW=true`), so only the civic classifier stays active and inference is slow (~90–140 s on 0.1 vCPU). See **[`DEPLOY.md`](./DEPLOY.md)**.
- Also possible: ML service on a separate host (Docker) in HTTP mode.

Both deploys are decoupled by env — nothing in code is host-specific.

> **Gotcha:** CRA bakes `REACT_APP_*` into the JS bundle at **build time**. After changing `REACT_APP_API_URL` on Vercel you must trigger a **redeploy** — a plain env edit does nothing until the next build.

---

## Testing (E2E)

Playwright suite in `tests/e2e/complaints.spec.js` (UI structure, health/model, ML accept/block, input validation, **JWT auth/authorization, Aadhaar Verhoeff validation**).

```bash
# With ml-service (node server.js), backend (npm run dev), and frontend running:
DISABLE_RATE_LIMIT=true npx playwright test
```

- The ML accept/block assertions require the **ML service** running and `ML_SERVICE_URL` set on the backend (otherwise the backend fails open and never blocks).
- `DISABLE_RATE_LIMIT=true` (backend env, **dev/test only**) bypasses the 5/min complaint limiter so the suite's rapid POSTs don't 429. Never set in production.
- The suite logs in once as a seeded citizen in `beforeAll` and attaches the JWT to every `POST /api/complaints` (complaint creation now requires auth). Reads need no token.
- The image-picking helper skips known-contaminated dataset prefixes (`scrape_`/`drain_`/`bing_`) so ACCEPT assertions run on clean images.
- HTML report: `playwright-report/`.

---

## Project structure

```
FixMyCity/
├── backend/                        # LIGHT Express app — auth + CRUD, no ML deps
│   ├── server.js                   # thin composition root (~115 lines)
│   ├── config/db.js                # connectDB(): mongoose connect + seed
│   ├── db/seed.js                  # default users/complaints seeding
│   ├── middleware/
│   │   ├── security.js             # helmet, cors, rate limiters
│   │   └── auth.js                 # JWT issue/verify, requireAuth/requireAdmin
│   ├── routes/                     # health, stats, auth, complaints, reviews
│   ├── utils/                      # datetime, aadhaar mask
│   ├── aadhaar.js                  # Verhoeff validation (shared w/ frontend)
│   ├── models/                     # Mongoose schemas (User, Admin, Complaint, Review)
│   ├── .env.example                # MONGO_URI, JWT_SECRET, CORS_ORIGIN, ML_SERVICE_URL, ML_KEY
│   ├── train_civic_model.py        # EfficientNetV2S 3-stage training
│   ├── temperature_scaling.py      # Post-training threshold calibration
│   ├── audit_dataset.py            # Dataset quality audit
│   ├── civic_model.keras           # Keras source-of-truth model
│   ├── civic_labels.json           # Class order
│   └── my_dataset/                 # Training images (gitignored)
│       ├── potholes/   (~1,578)
│       ├── streetlight/ (~1,640)
│       ├── drainage/   (~1,101)
│       └── others/     (~1,235)
├── ml-service/                     # STANDALONE inference microservice
│   ├── server.js                   # Express: POST /api/infer (X-ML-KEY), GET /health
│   ├── infer.js                    # per-image pipeline entrypoint (decode-once)
│   ├── ml/pipeline.js              # NSFW + civic classifier + OOD + CLIP + TF_BACKEND
│   ├── others_clip.js              # CLIP open-set classifier for "Others"
│   ├── civic_model_tfjs/           # TFJS-converted model (loaded at runtime)
│   ├── civic_thresholds.json       # Calibrated thresholds + OOD config
│   ├── civic_exemplars.json        # CLIP exemplar embeddings for "Others"
│   ├── Dockerfile                  # container build (port 7860)
│   ├── deploy-oracle.sh            # Oracle A1 one-shot split setup (Node 20 + pm2)
│   ├── .env.example                # PORT=7860, ML_KEY
│   └── README.md                   # ML service docs
├── frontend/
│   ├── .env.example                # REACT_APP_API_URL, Google Maps key
│   ├── src/
│   │   ├── App.js                  # Single source of truth — all state + handlers
│   │   ├── aadhaar.js              # Verhoeff validation (mirror of backend)
│   │   ├── App.css                 # Styles
│   │   └── components/
│   │       ├── Hero.jsx            # Landing page + auth forms
│   │       ├── CitizenDashboard.jsx
│   │       ├── AdminDashboard.jsx
│   │       ├── ComplaintForm.jsx
│   │       ├── ComplaintDetail.jsx
│   │       ├── GoogleMap.jsx
│   │       ├── Header.jsx
│   │       └── Timeline.jsx
│   └── public/
├── tests/e2e/                      # Playwright suite
├── render.yaml                     # Render blueprint (fallback deploy, repo root)
├── ORACLE_DEPLOY.md                # PRIMARY deploy runbook (Oracle A1, full pipeline)
├── DEPLOY.md                       # Render/fallback deployment runbook
├── CLAUDE.md                       # AI assistant instructions + roadmap
└── README.md                       # This file
```

---

## AI Image Validation Pipeline

The **ML service** (`ml-service/`) runs a multi-stage pipeline on every complaint photo. The backend forwards the image to `POST /api/infer` (guarded by `X-ML-KEY`) and applies the verdict; if the service is unreachable the backend **fails open** and saves the complaint unchecked.

### Stage 1: NSFW Content Moderation
`nsfwjs` checks for adult/explicit content. Porn/Hentai >40% or Sexy >70% → **hard-block** (HTTP 422).

### Stage 2: Civic Category Classification
Custom **EfficientNetV2S** model (4 classes: drainage, potholes, streetlight, others) trained on ~5,500 images with:
- 3-stage progressive unfreezing (head → top-60 layers → full backbone)
- Focal Loss with class weights + drainage boost
- CutMix/Mixup augmentation
- Dual-output head (logits + softmax) for proper calibration

### Stage 3: Decision Logic
Temperature-calibrated probabilities feed three blocking rules:
- **OOD detection**: Energy-based (logits) or entropy (softmax) — rejects non-civic images
- **Low confidence**: Declared category below calibrated threshold → block
- **Category mismatch**: Different category is ahead by a margin → block

### Stage 4: Open-set "Others"
CLIP (`@xenova/transformers`, Xenova/clip-vit-base-patch32) scores image+title against per-category exemplar embeddings. Never blocks — advisory only.

### Current model performance (EfficientNetV2S, July 2026 retrain)
| Metric | Value |
|--------|-------|
| val_macro_f1 | 0.952 |
| val_accuracy | 96.8% |
| Temperature | 0.5736 |
| OOD | energy-based (threshold −2.296) |

| Class | Precision | Recall | F1 | Threshold |
|-------|-----------|--------|----|-----------|
| drainage | 0.70 | 0.99 | 0.82 | 0.063 |
| potholes | 0.70 | 1.00 | 0.82 | 0.0 |
| streetlight | 0.70 | 1.00 | 0.82 | 0.0 |

> `potholes`/`streetlight` thresholds are **0.0 by design** — RULE1 (low-confidence block) is disabled for them (high-recall); RULE0 (OOD) and RULE2 (category-mismatch) still guard. `others` is open-set and never blocked. P≈0.70 across classes ⇒ ~30% inter-class false-accept, an accepted tradeoff to avoid rejecting genuine citizen photos.

The classifier **fails open** — ML errors never block citizen submissions.

---

## Retraining the model

### Step 1 — Python environment

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1    # PowerShell on Windows
# or: source .venv/bin/activate  (macOS / Linux)
pip install tensorflow tensorflowjs scikit-learn pillow
```

### Step 2 — Prepare dataset

Place images in `backend/my_dataset/{potholes,drainage,streetlight,others}/`. Recommended: 1,000+ images per class. Mix lighting, angles, urban/rural, day/night. JPG/PNG, any resolution — training resizes to 224×224.

> **WARNING — Dataset contamination (July 2026 audit):** ~30% of the original dataset was junk (NSFW anime, fashion photos, TV posters, puppies, cricket screenshots) from a broken web scraper. The Colab notebook (`FixMyCity_Colab_Train.ipynb`) automatically cleans these before training. **Do not train on the raw dataset without running cleanup first.**
>
> Contaminated prefixes (quarantined, not deleted): `drain_*`, `scrape_*`, `bing_*` (drainage); `scrape_*`, `oth_*`, `kag_*` (others). The "others" category is empty after cleanup — rebuild with TACO (trash dataset, CC BY 4.0) + manual civic issue photos.

### Step 3 — Train

```bash
python train_civic_model.py
```

3-stage training: head (30 epochs) → top-60 fine-tune (25 epochs) → full fine-tune (15 epochs). Anti-collapse gate blocks export if macro-F1 < 0.55.

### Training on Google Colab (recommended for speed)

If you have a Google account with Colab access:

1. Zip your `my_dataset/` folder: `cd backend && zip -r my_dataset.zip my_dataset/`
2. Upload to Google Drive folder named `FixMyCity`:
   - `my_dataset.zip`
   - `train_civic_model.py`
   - `civic_labels.json`
   - `temperature_scaling.py`
3. Open `backend/FixMyCity_Colab_Train.ipynb` in Colab
4. Set runtime to **T4 GPU** (or A100 on Colab Pro)
5. Run all cells — training takes ~15-30 min on T4
6. Download `civic_artifacts.zip` and unzip into `backend/`
7. Run `python temperature_scaling.py` and `npm run dev`

The notebook includes JPEG compression artifact simulation to close the domain gap between training images and real citizen phone photos.

### Step 4 — Calibrate thresholds

```bash
python temperature_scaling.py
```

Outputs `civic_thresholds.json` with calibrated temperature, per-class thresholds, OOD config, and reliability flags.

### Step 5 — Audit dataset quality

```bash
python audit_dataset.py
```

Flags images whose folder label disagrees with model prediction. Review `audit_report.csv`, fix misplaced images, retrain.

### Step 6 — Deploy the new model to the ML service

Training runs in `backend/` (Python), but the runtime model lives in `ml-service/`. Copy the newly-trained TFJS model + calibration artifacts into `ml-service/` (`civic_model_tfjs/`, `civic_thresholds.json`, `civic_labels.json`), then restart the ML service:

```bash
cd ml-service
node server.js
```

---

## API Routes

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/api/health` | Health + model status | public |
| POST | `/api/auth/register` | Register citizen (Aadhaar Verhoeff-validated) → returns JWT | public |
| POST | `/api/auth/login` | Login (citizen or admin) → returns JWT | public |
| GET | `/api/stats` | Complaint + user counts | public |
| GET | `/api/complaints` | List complaints. No params → full array (back-compat). `?page&limit&status` → paginated `{data,page,limit,total,totalPages}` | public |
| POST | `/api/complaints` | Create complaint (runs ML pipeline) | **citizen+** |
| PATCH | `/api/complaints/:id/status` | Update status | **admin** |
| DELETE | `/api/complaints/:id` | Delete complaint | **admin** |
| GET | `/api/reviews` | List reviews | public |
| POST | `/api/reviews` | Submit review | **auth** |
| PATCH | `/api/auth/update-profile` | Update own profile (identity from token) | **auth** |

### Security

- **JWT auth** — login/register issue a signed token (`jsonwebtoken`, `JWT_SECRET` env, 7d expiry). `requireAuth` gates writes, `requireAdmin` gates status/delete. Reads public. `update-profile` derives identity from the token (`req.auth.sub`) — you can only edit your own profile.
- **Aadhaar validation** — registration runs offline Verhoeff checksum + first-digit (2–9) rule + 12-digit format (`backend/aadhaar.js`). Rejects typos/fakes. Format-valid only, not UIDAI identity proof.
- **Password never serialized** — `select: false` on `User`/`Admin.password`; opted in only for `bcrypt.compare` / save.
- **Helmet** — security headers (CSP, X-Frame-Options, HSTS, X-Content-Type-Options)
- **Rate limiting** — login (10/15min), complaint creation (5/min), global (300/15min)
- **CORS** — restricted to `localhost:3000`; override via `CORS_ORIGIN` env var (comma-separated origins)
- **Aadhar masking** — API never exposes full 12-digit national ID (returns `XXXX XXXX 1234`)
- **Input validation** — maxlength on all string fields, complaint ID format validation, status enum validation, NoSQL-injection guards
- **Password** — minimum 8 characters, bcrypt hashed (10 rounds)

**Remaining gaps:** JWT lives in `localStorage` (XSS-readable — prefer httpOnly cookie + CSRF for production); no token refresh (7d hard expiry); Aadhaar stored plaintext at rest. See CLAUDE.md "Security posture → Known gaps".

---

## Roadmap (gov-grade production readiness)

Prioritized in CLAUDE.md → "Future work roadmap". Highlights:

- **Shipped (July 2026):** JWT auth + role middleware, Aadhaar Verhoeff validation, edit-profile fix, live-GPS fix, backend **pagination** (`?page&limit&status`, back-compat), Timeline animation fix, **modular backend** (`server.js` 1610→115 lines; concerns split into `config/ db/ middleware/ ml/ routes/ utils/`).
- **Next (coordinated FE+BE):** wire the frontend to consume pagination; offload base64 images from MongoDB to **GridFS/S3** with a serving route + one-time migration (must ship with a frontend deploy — base64 rendering changes to URLs).
- **Then:** `React.memo`/`useCallback` pass, CSS consolidation (3 design systems → 1 token set), keyboard a11y + focus traps (WCAG AA), replace `alert()/confirm()` with the `Toast` component, `controllers/` layer, request-validation middleware, Aadhaar encryption at rest.

---

## Common issues

| Problem | Fix |
|---------|-----|
| `npm install` fails on `@tensorflow/tfjs-node` | This project uses pure-JS tfjs. Run `npm uninstall @tensorflow/tfjs-node` |
| `MongoServerError: bad auth` | Wrong MONGO_URI user/password. URL-encode special characters. |
| `MongooseError: Could not connect` | Atlas Network Access doesn't include your IP. Add `0.0.0.0/0` for dev. |
| Frontend shows "Could not connect to server" | Backend not running or wrong port. Check `http://localhost:5000/api/health`. Also verify `REACT_APP_API_URL`. |
| Node 24 errors | Use Node 20 LTS. TFJS native prebuilts don't exist for NAPI v10. |
| `[civic] civic_model_tfjs/model.json not found` (ML service) | Train the model first (`python train_civic_model.py`) and copy `civic_model_tfjs/` into `ml-service/`. |
| Complaints save but images never blocked | ML service down/unreachable, or `ML_SERVICE_URL` unset — backend fails open. Start `ml-service` and set `ML_SERVICE_URL`. |
| ML service returns 401/403 | `ML_KEY` mismatch between backend and ml-service. Set the **same** value on both. |
| External images fail classification | Domain gap — retrain with real-world photos. See Colab notebook section. |
| PNG upload fails | Fixed in latest — `pngjs` handles real PNG images. Run `npm install` to get the dependency. |

---

## Production

Build the frontend:

```bash
cd frontend && npm run build    # output in frontend/build/
```

For a hosted deployment (Vercel + Render + Hugging Face Spaces), follow **[`DEPLOY.md`](./DEPLOY.md)**. For a self-managed setup, keep `backend` (`npm start`) and `ml-service` (`node server.js`) alive with `pm2` or `systemd`.

---

## License

Internal SIH project.

## Credits

Built for Smart India Hackathon PS 25031.
