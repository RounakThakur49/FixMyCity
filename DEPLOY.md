# DEPLOY.md — FixMyCity Deployment Runbook

This is a step-by-step guide to deploying FixMyCity to free hosting. It assumes you're a teammate on the project, not a DevOps expert — every step is spelled out, and the copy-pasteable bits are marked. Follow the sections in order.

---

## 1. Overview

FixMyCity is now split into **three independent tiers** that are deployed separately and talk to each other over HTTP:

```
   ┌─────────────────┐        ┌──────────────────┐        ┌────────────────────┐
   │   FRONTEND       │  HTTP  │   BACKEND         │  HTTP  │   ML SERVICE        │
   │   React 19 (CRA) │ ─────► │   Express + JWT   │ ─────► │   Express inference │
   │   Vercel         │ ◄───── │   Render (light)  │ ◄───── │   HF Spaces (Docker)│
   └─────────────────┘        └────────┬─────────┘        └────────────────────┘
                                        │ Mongoose
                                        ▼
                               ┌──────────────────┐
                               │  MongoDB Atlas    │
                               └──────────────────┘
```

**Who talks to whom:**

- **Auth** — frontend ↔ backend directly. Writes carry a `Authorization: Bearer <JWT>`; reads are public.
- **ML (image check)** — frontend → backend → **ML service** → backend → frontend. The browser NEVER talks to the ML service. The backend→ML hop is **server-to-server** (so no CORS involved) and is guarded by a shared secret header `X-ML-KEY`.

> ### 🏆 GOLDEN RULE — deploy in this order
> The tiers depend on each other's URLs, so you must deploy **bottom-up**:
>
> 1. **ML service FIRST** → gives you the HF Space URL.
> 2. **Backend SECOND** → it needs `ML_SERVICE_URL` (the URL from step 1) and `CORS_ORIGIN` (the frontend URL — you can set this now and refine after step 3).
> 3. **Frontend LAST** → it needs `REACT_APP_API_URL` = the backend URL from step 2. **This value is baked into the JS bundle at build time, so after you set/change it you MUST redeploy.**
>
> Then go back and pin `CORS_ORIGIN` on the backend to the exact Vercel URL you got in step 3.

---

## 2. Prerequisites

Before you start, create/collect the following (all have free tiers):

| Thing | What you need | Where |
|---|---|---|
| **MongoDB Atlas** | A cluster + a connection string (`mongodb+srv://...`) | https://cloud.mongodb.com |
| **Hugging Face account** | For the ML Docker Space | https://huggingface.co |
| **Render account** | For the backend web service (or your chosen light host) | https://render.com |
| **Vercel account** | For the frontend | https://vercel.com |
| **Node 20 LTS** | For building/testing locally | https://nodejs.org |

Atlas notes:
- Create a database user (username + password) and a database (the app defaults to `FixMyCity`).
- Under **Network Access**, allow the hosts that will connect. For free cloud hosts whose IPs rotate, `0.0.0.0/0` (allow from anywhere) is the pragmatic choice for a demo. Lock this down for real production.
- Your connection string looks like:
  `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/FixMyCity?retryWrites=true&w=majority`

---

## 3. Step 1 — Deploy the ML service to Hugging Face Spaces

The ML service (`ml-service/`) runs the EfficientNetV2S civic classifier + nsfwjs + CLIP. It needs **~1GB RAM resident and is an always-on process** — it CANNOT run on Vercel/serverless. Hugging Face Spaces **free CPU Basic** (2 vCPU, 16GB RAM) holds the full pipeline comfortably.

1. On Hugging Face, click **New → Space**.
2. Choose:
   - **Space SDK: Docker** (the folder already has a `Dockerfile`).
   - **Hardware: CPU basic (free)**.
   - Visibility: your choice (Public is fine).
3. Push the contents of `ml-service/` into the Space repo. Either use the Space's git remote:
   ```bash
   # from the ml-service/ folder
   git init
   git remote add space https://huggingface.co/spaces/<your-user>/fixmycity-ml
   git add .
   git commit -m "Deploy ML service"
   git push space main
   ```
   …or drag-and-drop the files in the Space's web **Files** tab.

> ### ⚠️ Port 7860 is mandatory
> Hugging Face Docker Spaces route traffic to **port 7860**. The container MUST listen on 7860. The service reads `PORT` from env — set `PORT=7860` (see below) and keep the `Dockerfile`'s `EXPOSE 7860` as-is. If it listens on anything else the Space will look "running" but every request will hang/404.

4. In the Space **Settings → Variables and secrets**, add:
   - `PORT` = `7860`
   - `ML_KEY` = a long random string (a shared secret — you'll give the backend the **same** value). Add this as a **Secret**, not a plain variable.
5. Wait for the build to finish (watch the **Logs** tab).

> ### ⏳ First boot is slow
> On first boot the service downloads the **~149MB CLIP model** unless it's pre-seeded into the Docker image. The build/first request can take a few minutes. Later boots are faster (but see the 48h-sleep note in Troubleshooting).

6. Test it once it's live:
   ```bash
   curl https://<your-user>-fixmycity-ml.hf.space/health
   ```
   Expect a healthy JSON response. **Copy the base URL** (`https://<your-user>-fixmycity-ml.hf.space`) — the backend needs it as `ML_SERVICE_URL`.

---

## 4. Step 2 — Deploy the backend (Render free web service)

The backend (`backend/`) is now **light** — no ML dependencies. It fits a free Render web service.

1. On Render, click **New → Web Service** and connect your GitHub repo (your fork — see §8).
2. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
3. Add the environment variables (Render **Environment** tab):

   | Var | Value |
   |---|---|
   | `MONGO_URI` | your Atlas connection string |
   | `JWT_SECRET` | a long random string (see callout) |
   | `CORS_ORIGIN` | your Vercel frontend URL (set now, refine after §5) |
   | `ML_SERVICE_URL` | the HF Space base URL from Step 1 |
   | `ML_KEY` | the **same** secret you set on the ML Space |
   | `PORT` | Render provides this automatically — the app reads it |

> ### 🔐 Always set JWT_SECRET
> If `JWT_SECRET` is unset the backend falls back to an **insecure dev value** and warns at boot. Anyone who knows that fallback can forge tokens. Set a real random secret in the host env.

> ### 🔑 ML_KEY must match on both sides
> The backend sends `X-ML-KEY: <ML_KEY>` to the ML service on every inference call. If the backend's `ML_KEY` doesn't equal the Space's `ML_KEY`, the ML service rejects the call — image checks silently stop working (the complaint still saves, because the pipeline **fails open**).

4. Deploy. When it's up, test:
   ```bash
   curl https://<your-backend>.onrender.com/api/health
   ```

> ### 💤 Render free tier sleeps
> The free web service **spins down after ~15 minutes of no traffic**, and the next request pays a **~50s cold start**. That's normal for the free tier — the first login/complaint after idle will feel slow, then it's fast again.

---

## 5. Step 3 — Deploy the frontend to Vercel

1. On Vercel, **Add New → Project** and import your repo (your fork — see §8).
2. Configure:
   - **Root Directory:** `frontend`
   - Framework preset: Create React App (Vercel usually auto-detects).
3. Add the environment variable:

   | Var | Value |
   |---|---|
   | `REACT_APP_API_URL` | your backend URL, e.g. `https://<your-backend>.onrender.com` |

4. Deploy. Vercel gives you a URL like `https://your-fork-abc123.vercel.app`.

> ### 🚨 CRITICAL — `REACT_APP_API_URL` is baked in at BUILD time
> Create React App inlines `REACT_APP_*` variables into the static JS bundle **when it builds**. Editing the env var in the Vercel dashboard does **nothing** to an already-built site. **After you add or change `REACT_APP_API_URL` you MUST trigger a redeploy** (Vercel → Deployments → ⋯ → Redeploy) so a fresh bundle is built with the new value. This is the single most common "why is prod broken" cause on this project.

> ### 🪝 Escape hatch: re-point WITHOUT rebuilding
> There's a runtime override — `localStorage['fixmycity-api-url']` **beats** the baked-in value. The app has an in-app "change API URL" prompt that sets it. So you can re-point a deployed site at a different backend without rebuilding — useful for quick testing. (The build-time value is still the real fix for a permanent deploy.)

---

## 6. Step 4 — Wire CORS + verify end-to-end

1. Go back to the **backend** (Render) env and set `CORS_ORIGIN` to the **exact** Vercel URL from Step 3 (scheme + host, no trailing slash), e.g.:
   ```
   CORS_ORIGIN=https://your-fork-abc123.vercel.app
   ```
   You can list several comma-separated origins (e.g. a preview URL + the production URL). Redeploy the backend so it picks up the change.

2. Open your Vercel site and run the smoke test:
   - **Register** a new citizen → should succeed.
   - **Login** → should return a token and land you in the dashboard.
   - **File a complaint** with a valid category photo → expect **201** plus an AI check note.
   - **File a cross-category / junk photo** → expect the ML block: **422**.
   - Open **F12 → Network** and confirm the API calls hit your **backend URL**, not `localhost:5000`. If you see `localhost`, the frontend bundle was built without `REACT_APP_API_URL` — redeploy (§5 callout).

---

## 7. Env var reference

### Frontend (Vercel)

| Var | Example | Required | Notes |
|---|---|---|---|
| `REACT_APP_API_URL` | `https://fixmycity-backend.onrender.com` | ✅ | Backend base URL. **Baked at build time — redeploy after changing.** Runtime override: `localStorage['fixmycity-api-url']`. |

### Backend (Render)

| Var | Example | Required | Notes |
|---|---|---|---|
| `MONGO_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/FixMyCity` | ✅ | Atlas connection string. |
| `JWT_SECRET` | `a-long-random-string` | ✅ | Sign key. Insecure dev fallback + boot warning if unset. |
| `CORS_ORIGIN` | `https://your-fork-abc123.vercel.app` | ✅ | Comma-separated allowed browser origins. Set to the Vercel URL(s). |
| `ML_SERVICE_URL` | `https://your-user-fixmycity-ml.hf.space` | ⬜ | Base URL of the ML service. If unset/unreachable, image checks are skipped (**fails open** — complaint still saves). |
| `ML_KEY` | `same-secret-as-ml-space` | ⬜ | Sent as `X-ML-KEY` to the ML service. Must match the Space's `ML_KEY`. |
| `PORT` | (provided by Render) | ⬜ | Host-injected; the app reads it. |

### ML service (Hugging Face Spaces)

| Var | Example | Required | Notes |
|---|---|---|---|
| `PORT` | `7860` | ✅ | **Must be 7860** — HF Docker Spaces route to this port. |
| `ML_KEY` | `same-secret-as-backend` | ⬜ | When set, `POST /api/infer` requires header `X-ML-KEY` to match. Must equal the backend's `ML_KEY`. |

**ML service endpoints:** `POST /api/infer` (guarded by `X-ML-KEY` when `ML_KEY` is set) and `GET /health` (unguarded).

---

## 8. Fork → PR → deploy workflow

Here's how the repos and deploys relate, so you don't step on your teammate's work:

- **Upstream:** `github.com/RounakThakur49/FixMyCity` — the shared repo. Work lands here via **PR to `main`**.
- **Your fork:** `github.com/debmalyo-hub07/FixMyCity` — where you push branches and open PRs from.

**Your own test deploy is completely independent of your teammate's.**

- You can import **your fork** into **your own** Vercel dashboard. That gives you a **separate deploy URL** with **your own** `REACT_APP_API_URL`. You can test freely there and delete it anytime — your teammate's deploy is untouched.
- Your teammate's live site (`fix-my-city-c24e.vercel.app`) is imported from the **upstream** repo into **his** Vercel account. Right now it's **broken** because `REACT_APP_API_URL` was never set — the deployed bundle baked in `localhost:5000` + a placeholder `your-backend.onrender.com`, so every API call fails and only the static landing page renders.
- When your teammate later **merges your PR**, **sets `REACT_APP_API_URL` on his Vercel**, and **redeploys**, his URL will work too — pointing at the **same backend** as yours.

> ### ✅ Recommendation
> **Test on your OWN Vercel deploy first.** Import your fork, set `REACT_APP_API_URL` to your backend, verify the full flow (§6), then open the PR. Remember the build-time bake gotcha (§5) applies to every Vercel deploy — yours and your teammate's.

---

## 9. Troubleshooting

**Login works locally but fails in production.**
→ `REACT_APP_API_URL` is unset or wrong on Vercel. Open F12 → Network and check where the login request goes. If it's hitting `localhost:5000` or `your-backend.onrender.com`, the bundle was built without the right value. Set it and **redeploy** (§5). Quick workaround: use the in-app "change API URL" prompt (sets `localStorage['fixmycity-api-url']`).

**CORS error in the browser console** (`blocked by CORS policy`).
→ The backend's `CORS_ORIGIN` doesn't include your frontend's exact origin. Set `CORS_ORIGIN` to the exact Vercel URL (scheme + host, no trailing slash), redeploy the backend (§6). Multiple origins are comma-separated.

**Complaints save fine but there's no AI check note.**
→ The backend can't reach the ML service — `ML_SERVICE_URL` is unset/wrong/unreachable, or `ML_KEY` doesn't match. The pipeline **fails open by design** (the complaint is still saved), so this is a soft failure. Check `ML_SERVICE_URL`, confirm the Space is awake (`GET /health`), and confirm `ML_KEY` is identical on both the backend and the Space.

**First ML request after a while is very slow or the Space looks asleep.**
→ HF free Spaces **sleep after ~48h idle** and auto-wake on the next visit (a few seconds to boot). Also, the **first** boot downloads the ~149MB CLIP model, which is slower. Hit `GET /health` once to warm it before demoing. (Separately, the Render backend cold-starts after 15 min idle — see §4.)

**Everything is slow on the first click after a break.**
→ Both free tiers idle down: Render backend (~15 min → ~50s cold start) and the HF Space (~48h → wake). Warm them up before a live demo by hitting `GET /api/health` and the Space `GET /health` first.
