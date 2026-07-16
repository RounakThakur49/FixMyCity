# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Overview

FixMyCity is a civic complaint platform. Citizens register, file complaints about pothole / drainage / streetlight / other issues (with photo proof), and track status; admins review complaints, forward them to municipal departments, and resolve them. It has three independently-run components:

- **Frontend** (`frontend/`): Vite + TypeScript + Redux + MUI (Material UI) served on port **5173** in dev. Replaced the old Create React App frontend.
- **Backend** (`backend/`): Express + MongoDB (Mongoose) API on port **5000**, with JWT auth (Bearer tokens), bcrypt passwords, Brevo SMTP OTP for superadmin, and pure-JS TensorFlow.js + MobileNet image advisory.
- **ML Service** (`ml-service/`): Separate Python/FastAPI image classification service.

These are separate npm packages with separate `package.json` and `node_modules`. The Vite dev server proxies `/api/*` to `http://localhost:5000` via `frontend/vite.config.ts`.

## Commands

Frontend (run from `frontend/`):
```bash
cd frontend
npm install
npm run dev              # Vite dev server on :5173 (proxies /api/* → :5000)
npm run build            # TypeScript compile + Vite production build to /build
npm run preview          # Preview the production build locally
```

Backend (run from `backend/`):
```bash
cd backend
npm install
npm run dev               # nodemon, auto-reload
npm start                 # plain node server.js
```

Requires a reachable MongoDB. Connection comes from `backend/.env` (`MONGO_URI`, `PORT`); defaults to `mongodb://127.0.0.1:27017/FixMyCity` and port 5000 if unset. The reference deployment uses MongoDB Atlas.

Node version: **20 LTS** (use `nvm-windows` on Windows). Node 24 fails because TensorFlow.js native binding prebuilds don't exist for NAPI v10.

ML retraining (Python, run from `backend/`):
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install tensorflow tensorflowjs scikit-learn pillow
python train_civic_model.py       # trains MobileNetV2 on my_dataset/, exports civic_model_tfjs/
python audit_dataset.py           # runs trained model against training set, flags mismatches
```

## Architecture

### State lives in App.js
`frontend/src/App.js` is the single source of truth for the entire frontend. It holds **all** state (session, complaints list, all form state, selection, `complaintError`) and **all** handlers (auth, complaint CRUD, image compression). Every component is presentational — they receive state and callbacks as props and render nothing on their own. There is no router, no global store, and no component-level data fetching. View switching is driven by `session.role`:

- no session → `Hero` (landing + login/register forms)
- `citizen` → `CitizenDashboard` (file + track complaints)
- `admin` → `AdminDashboard` (review, forward, resolve, delete)

When adding a feature, expect to add state + a handler in `App.js` and thread them down as props. Match this pattern rather than introducing local fetching or state in child components.

### Session is client-trusted (no tokens)
There is **no JWT or session token**. Login returns the user object, which is stored in `localStorage` under `fixmycity-session` and kept in React state. Role checks (`requiredRole === 'admin'`) happen client-side in `handleLogin`. The backend API endpoints are unauthenticated — any caller can hit `/api/complaints` and the status/delete routes directly. Keep this in mind: server-side authorization does not exist yet.

### Complaints use a human-facing string ID
Complaints are keyed throughout by a custom `id` field (`CMP-2401`, `CMP-2402`, …), **not** Mongo's `_id`. New IDs are generated in the create route as `CMP-${2401 + count}` with a uniqueness loop. All API routes (`/api/complaints/:id/status`, `DELETE /api/complaints/:id`) and all frontend lookups match on this `id`. Timestamps (`createdAt`, `updatedAt`, `updates[].at`) are stored as preformatted **strings** in `Asia/Kolkata` time (see `getFormattedDate`), not Date objects — sorting and display rely on the `YYYY-MM-DD HH:mm` lexical format.

### Status workflow + timeline
A complaint moves `Submitted → In Review → Forwarded → Resolved` (enum in `models/Complaint.js`). The status PATCH route auto-appends an entry to the `updates[]` array with a canned note per status; the frontend `Timeline` component renders this array. `forwardedTo` names a municipal department (`authorityOptions` in `App.js`).

### Civic image classifier (MobileNet ImageNet + keyword matching, advisory mode)
`POST /api/complaints` runs the uploaded photo through a classifier for **diagnostic metadata only — it never blocks submissions**. The pipeline:

1. **Load** — `@tensorflow-models/mobilenet` (v2, alpha=1.0) loaded from Google's CDN at boot via pure-JS `@tensorflow/tfjs`. No native bindings, no model files committed to repo.
2. **Classify** — image decoded with `jpeg-js`, fed to MobileNet, returns top-5 ImageNet labels with probabilities.
3. **Match** — `CATEGORY_KEYWORDS` maps each civic category (`potholes`, `drainage`, `streetlight`, `others`) to a list of ImageNet label substrings (e.g., potholes → `crater, pothole, asphalt, road, pavement, ...`). If any top-5 ImageNet label contains any keyword for the declared category, that's a match.
4. **Decide** — `decideBlock()` is currently hardcoded to `block: false`. The function still returns `reason: 'advisory_match' | 'advisory_no_match'` and the matched keyword/probability if any, which is stored on the complaint as `imageCheck.note`.

The classifier **fails open**: if MobileNet failed to load or inference throws, the complaint is still saved. The advisory text is stored on `imageCheck.note` and shown to admins on the detail view.

Why advisory and not blocking: a previous custom CNN trained on `my_dataset/` overfit (predicted `potholes` with ~1.0 confidence for almost every image due to ~350 images/class being too small for MobileNetV2 to generalize). ImageNet's 1000 classes are also mostly animals/food/household objects with weak coverage of civic damage, so keyword-match hits are partially coincidental. Advisory mode honestly reflects the ML reliability and avoids frustrating users with false blocks. The training pipeline and dataset are preserved for future re-experiments.

Images are sent inline as base64 in the JSON body (hence the `50mb` body limit); the frontend compresses them client-side in `compressImage` before upload.

### Database seeding
On connect, `seedDatabase()` inserts default users and complaints **only if the collections are empty**. Seeded credentials: admin `admin@fixmycity` / `admin123` (the admin's `phone` field holds the login ID); citizens `9876543210` and `9123456780`, both password `citizen123`. Passwords are bcrypt-hashed; `aadhar` is `sparse`-unique so the admin can omit it.

### ML files in `backend/`
- `civic_model.keras` — Keras source-of-truth model (output of `train_civic_model.py`).
- `civic_labels.json` — class index order (`['drainage','others','potholes','streetlight']`).
- `civic_model_tfjs/` — TFJS-converted model files (`model.json` + `.bin` shards). **Not used at runtime anymore** since we switched to ImageNet MobileNet via `@tensorflow-models/mobilenet`, but kept for reference / to allow swapping the loader back to the custom model.
- `my_dataset/{potholes,drainage,streetlight,others}/` — training images. Counts: ~400 / ~318 / ~340 / ~377.
- `audit_dataset.py` — runs the trained custom model against every training image; flags high-confidence folder/prediction mismatches into `audit_report.csv`.
- `download_datasets.py` / `clean_datasets.py` — used to source images from Kaggle + Bing scraping during dataset construction.

## Notes

- All API requests from the frontend send an `ngrok-skip-browser-warning: true` header — the app is intended to be tunneled via ngrok for demos. `API_BASE_URL` can be overridden with `REACT_APP_API_URL`.
- The MongoDB instance is local-standalone or Atlas; there is no migration tooling — schema changes take effect on next write.
- TFJS-Node native bindings are NOT used (Google killed the prebuilt CDN bucket and source-builds need VS Build Tools). Pure-JS tfjs is slower but works on any Node 20 environment without C++ toolchain.
- HTML5 `required` attributes block empty-field submission for Title / Location / Description. Note: the "Exact Location" label is missing its `*` asterisk despite being required (minor visual inconsistency).
- Admin actions: per-complaint Approve / Forward / Solve / Delete buttons live in the detail panel. Solve immediately bumps `resolved` counter and updates timeline. Forward requires a department selection (see `authorityOptions` in `App.js`).
