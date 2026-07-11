# DEPLOY.md — FixMyCity Deployment Runbook

This is a step-by-step guide to deploying FixMyCity to **free** hosting — no credit card required anywhere. It assumes you're a teammate on the project, not a DevOps expert — every step is spelled out, and the copy-pasteable bits are marked. Follow the sections in order.

---

## 1. Overview

FixMyCity is architected as **three tiers**. The code keeps the ML pipeline as a clean, standalone folder (`ml-service/`) that *can* run on its own host — but for **free-tier hosting we co-locate the backend and the ML pipeline in ONE Render web service**, running the ML in-process. No second server, no HTTP hop, no credit card.

```
   ┌─────────────────┐         ┌────────────────────────────┐         ┌──────────────────┐
   │   FRONTEND       │  HTTPS  │   RENDER WEB SERVICE         │ Mongoose│  MongoDB Atlas    │
   │   React 19 (CRA) │ ──────► │   Express backend           │ ──────► │   (cluster)       │
   │   Vercel         │ ◄────── │   + in-process ML pipeline  │ ◄────── │                   │
   └─────────────────┘         │   (ML_INLINE=true)          │         └──────────────────┘
                               └────────────────────────────┘
```

**Why co-located?** The original plan hosted the ML on a separate box (Hugging Face Docker Space / Oracle Cloud). Both dead ends for a free, card-free deploy:

- **Hugging Face** went **paid** in 2026 — Docker Spaces now need **Pro ($9/mo)**. Free HF only offers **Static** (browser-only) spaces, which can't run a Node server.
- **Oracle Cloud** requires a **credit card** at signup.

**Render free** solves it: native Node runtime, **no card**, and it **renews every month** (it is NOT a one-time trial). But the free instance-hour budget is shared, so we run exactly **one** always-on service and put both halves inside it.

> ### 📦 The free-tier constraints we design around
> - **512 MB RAM**, **0.1 shared CPU**, **750 instance-hours/month per workspace** — shared across *all* your services, so you can afford **one** always-on process. That's why backend + ML co-run in a single process (`ML_INLINE=true`).
> - **512 MB fit:** we set `DISABLE_CLIP=true` to skip the ~150 MB CLIP model. Measured **peak RAM ≈ 280 MB** during inference — comfortable. The **civic 4-class classifier + NSFW moderation stay FULLY ACTIVE**; only the "Others" open-set path falls back to **keyword title routing**.
> - **Sleeps after 15 min idle** (30–60s cold start). We fix this with a free external uptime pinger (Step 2) so it never sleeps.
> - **No per-request timeout** once awake (persistent process), so slow tfjs inference (**~25–60s/image** on the shared CPU) completes fine. Slow-but-correct is acceptable here.

> ### 🏆 GOLDEN RULE — deploy in this order
> 1. **MongoDB Atlas ready** → you have a connection string.
> 2. **Render service (backend + ML)** → gives you the Render URL and does the AI checks in-process.
> 3. **Vercel frontend** → it needs `REACT_APP_API_URL` = the Render URL from step 2. **This value is baked into the JS bundle at build time, so after you set/change it you MUST redeploy.**
> 4. **Uptime pinger** → keep the Render service awake.
>
> Then go back and pin `CORS_ORIGIN` on the backend to the exact Vercel URL you got in step 3.

---

## 2. Prerequisites

Before you start, create/collect the following (all free, **no card needed**):

| Thing | What you need | Where |
|---|---|---|
| **MongoDB Atlas** | A cluster + a connection string (`mongodb+srv://...`) | https://cloud.mongodb.com |
| **Render account** | For the co-located backend + ML web service | https://render.com |
| **Vercel account** | For the frontend | https://vercel.com |
| **GitHub** | Repo pushed (your fork — see §9) | https://github.com |
| **Node 20 LTS** | For building/testing locally | https://nodejs.org |

Atlas notes:
- Create a database user (username + password) and a database (the app defaults to `FixMyCity`).
- Under **Network Access**, allow the hosts that will connect. Render free IPs rotate, so `0.0.0.0/0` (allow from anywhere) is the pragmatic choice for a demo. Lock this down for real production.
- Your connection string looks like:
  `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/FixMyCity?retryWrites=true&w=majority`

---

## 3. Step 1 — Deploy to Render via Blueprint

The repo ships a **`render.yaml` at the repo root**. Render's **Blueprint** flow reads it and configures everything (build + start commands + env var placeholders) for you.

1. On Render, click **New → Blueprint**.
2. **Connect your GitHub repo** (your fork — see §9). Render finds `render.yaml` at the root and shows you the service it will create.
3. Set the **three secret env vars** in the dashboard (they're declared `sync: false` in `render.yaml`, so Render prompts you for them — they are never committed):

   | Var | Value |
   |---|---|
   | `MONGO_URI` | your Atlas connection string |
   | `JWT_SECRET` | a long random string (see callout) |
   | `CORS_ORIGIN` | your Vercel frontend URL (set now, refine after §5) |

   The rest are already baked into `render.yaml`: `ML_INLINE=true`, `DISABLE_CLIP=true`, `ML_TIMEOUT_MS=120000`, `NODE_VERSION=20`.
4. Click **Apply** and wait for the build (**~5–10 min**). It runs the blueprint's build command:
   ```
   cd backend && npm install && cd ../ml-service && npm install --omit=dev
   ```
   …then starts with `cd backend && npm start`. This installs **both** backend and ml-service deps plus the model artifacts.

> ### 🧩 Why no Root Directory / why the `cd`s
> `render.yaml` uses **no `rootDir`** — the service runs from the **repo root**. That's deliberate: Render makes files **outside** `rootDir` unavailable, so setting `rootDir: backend` would **hide the sibling `ml-service/` folder** from the in-process `require`. Instead the commands `cd` into each folder. **Don't add a Root Directory in the dashboard** — it breaks the co-located require.

> ### 🔐 Always set JWT_SECRET
> If `JWT_SECRET` is unset the backend falls back to an **insecure dev value** and warns at boot. Anyone who knows that fallback can forge tokens. Set a real random secret.

5. **First boot loads the ML models in-process** (a few seconds of blocked event loop — expected). When it's up, test:
   ```bash
   curl https://<your-service>.onrender.com/api/health
   ```
   Expect the co-located signature:
   ```json
   { "ml_service": "in_process", "model_loaded": true, "clip_ready": false }
   ```
   `clip_ready: false` is **correct** — CLIP is intentionally off (`DISABLE_CLIP=true`) to fit 512 MB. `model_loaded: true` means the civic classifier + NSFW moderation are live.

---

## 4. Step 2 — Keep it awake (free uptime pinger)

Render free **spins down after ~15 minutes of no traffic**, and the next request pays a **30–60s cold start**. For a demo that "won't close itself after deployment," ping it on a schedule so it never idles out.

1. Sign up at **https://cron-job.org** (free, no card).
2. Create a cron job:
   - **URL:** `https://<your-service>.onrender.com/api/health`
   - **Method:** GET
   - **Schedule:** every **14 minutes** (just under the 15-min sleep window).
3. Save and enable it.

> ### 💤 Why 14 minutes
> The pinger's GET keeps the instance "recently used" so Render never spins it down — as long as pings land inside every 15-minute window, users never hit a cold start. `/api/health` is public and cheap, so this costs almost nothing against your instance-hours.

---

## 5. Step 3 — Deploy the frontend to Vercel

1. On Vercel, **Add New → Project** and import your repo (your fork — see §9).
2. Configure:
   - **Root Directory:** `frontend`
   - Framework preset: Create React App (Vercel usually auto-detects).
3. Add the environment variable:

   | Var | Value |
   |---|---|
   | `REACT_APP_API_URL` | your Render URL, e.g. `https://<your-service>.onrender.com` |

4. Deploy. Vercel gives you a URL like `https://your-fork-abc123.vercel.app`.

> ### 🚨 CRITICAL — `REACT_APP_API_URL` is baked in at BUILD time
> Create React App inlines `REACT_APP_*` variables into the static JS bundle **when it builds**. Editing the env var in the Vercel dashboard does **nothing** to an already-built site. **After you add or change `REACT_APP_API_URL` you MUST trigger a redeploy** (Vercel → Deployments → ⋯ → Redeploy) so a fresh bundle is built with the new value. This is the single most common "why is prod broken" cause on this project.

> ### 🪝 Escape hatch: re-point WITHOUT rebuilding
> There's a runtime override — `localStorage['fixmycity-api-url']` **beats** the baked-in value. So you can re-point a deployed site at a different backend without rebuilding — useful for quick testing. (The build-time value is still the real fix for a permanent deploy.)

---

## 6. Step 4 — Wire CORS + verify end-to-end

1. Go back to the **Render** service env and set `CORS_ORIGIN` to the **exact** Vercel URL from Step 3 (scheme + host, no trailing slash), e.g.:
   ```
   CORS_ORIGIN=https://your-fork-abc123.vercel.app
   ```
   You can list several comma-separated origins (e.g. a preview URL + the production URL). Redeploy the backend so it picks up the change.

2. Open your Vercel site and run the smoke test:
   - **Register** a new citizen → should succeed.
   - **Login** → should return a token and land you in the dashboard.
   - **File a complaint** with a valid category photo → expect **201** plus an AI check note. The image runs through the **in-process ML** (`~25–60s` on the shared CPU — be patient, no timeout will fire).
   - **File a cross-category / junk photo** → expect the ML block: **422**.
   - Open **F12 → Network** and confirm the API calls hit your **Render URL**, not `localhost:5000`. If you see `localhost`, the frontend bundle was built without `REACT_APP_API_URL` — redeploy (§5 callout).

---

## 7. Env var reference

### Frontend (Vercel)

| Var | Example | Required | Notes |
|---|---|---|---|
| `REACT_APP_API_URL` | `https://fixmycity.onrender.com` | ✅ | Render base URL. **Baked at build time — redeploy after changing.** Runtime override: `localStorage['fixmycity-api-url']`. |

### Backend + ML (Render — one service)

| Var | Example | Required | Notes |
|---|---|---|---|
| `MONGO_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/FixMyCity` | ✅ | Atlas connection string. Set in dashboard (`sync: false`). |
| `JWT_SECRET` | `a-long-random-string` | ✅ | Sign key. Insecure dev fallback + boot warning if unset. Set in dashboard. |
| `CORS_ORIGIN` | `https://your-fork-abc123.vercel.app` | ✅ | Comma-separated allowed browser origins. Set to the Vercel URL(s). Set in dashboard. |
| `ML_INLINE` | `true` | ✅ | Runs the ML pipeline **in-process** — no separate service. Baked in `render.yaml`. |
| `DISABLE_CLIP` | `true` | ✅ | Skips the ~150 MB CLIP model to fit 512 MB. "Others" falls back to keyword routing. Baked in `render.yaml`. |
| `ML_TIMEOUT_MS` | `120000` | ⬜ | Inference budget ceiling. Baked in `render.yaml`. |
| `PORT` | (provided by Render) | ⬜ | Host-injected; the app reads it. |

> Because the ML co-runs in-process on this tier, there is **no separate ML host and no `ML_SERVICE_URL`/`ML_KEY`** to set. Those only apply to the split-host mode in §8.

---

## 8. Other hosting options

The architecture is still a **clean split** — `ml-service/` is a standalone folder with its own `Dockerfile`. The `ML_INLINE` flag is the only switch. We co-locate it on Render to fit the free tier, but the code also supports running the ML on its **own host**:

**Mode 1 — separate ML service.** Deploy `ml-service/` on its own box, then point the backend at it:
- Hosts: a **paid HF Docker Space** ($9/mo Pro), or an **Oracle Cloud VM** via `ml-service/deploy-oracle.sh` (needs a card at Oracle signup).
- On the backend, set **`ML_SERVICE_URL`** (the ML host's base URL) + **`ML_KEY`** (a shared secret sent as `X-ML-KEY`; must match on both sides). Leave `ML_INLINE` unset/false.
- **Tradeoff:** two hosts to run and keep awake, plus a server-to-server HTTP hop — but the ML box gets its **own RAM**, so you can re-enable **CLIP** (`DISABLE_CLIP` off) for full "Others" open-set classification, and the backend stays light.

**Notes:**
- **Render free renews monthly** — it's not a one-time trial, so the co-located deploy runs free indefinitely (within the 750 shared instance-hours).
- **CLIP can be re-enabled** on any host with more than ~512 MB headroom by dropping `DISABLE_CLIP`.

---

## 9. Fork → PR → deploy workflow

You forked your teammate's repo and deploy **independently** — your Render + Vercel are entirely your own, so you can test the full flow before anything merges.

- **Test on your OWN Render + Vercel first.** Import your fork into your own dashboards, set the env vars (your `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, and a `REACT_APP_API_URL` pointing at *your* Render service), and verify the full flow (§6).
- Your deploy is **completely independent** of your teammate's — separate URLs, separate env, delete anytime without touching his.
- When your teammate later **merges your PR**, he **sets his own env vars** (`MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, `REACT_APP_API_URL`) on **his** Render + Vercel and redeploys. Remember the build-time bake gotcha (§5) applies to his Vercel too.

> ### ✅ Recommendation
> Get the whole chain green on your own deploys **before** you open the PR. That way the teammate just adds his secrets and redeploys — no debugging on his side.

---

## 10. Troubleshooting

**Login works locally but fails in production.**
→ `REACT_APP_API_URL` is unset or wrong on Vercel. Open F12 → Network and check where the login request goes. If it's hitting `localhost:5000` or a placeholder, the bundle was built without the right value. Set it and **redeploy** (§5). Quick workaround: set `localStorage['fixmycity-api-url']` via the in-app override.

**CORS error in the browser console** (`blocked by CORS policy`).
→ The Render service's `CORS_ORIGIN` doesn't include your frontend's exact origin. Set `CORS_ORIGIN` to the exact Vercel URL (scheme + host, no trailing slash), redeploy the backend (§6). Multiple origins are comma-separated.

**Complaints save fine but there's no AI check note.**
→ The ML pipeline **fails open by design** — if the models are still loading or inference errored, the complaint is still saved without a check. Hit `GET /api/health` and confirm `model_loaded: true`. If it's still `false`, the models haven't finished loading (give first boot a moment) or an artifact failed to install (check the Render build log).

**First request is very slow or times out.**
→ Cold start. Render free spun the service down after 15 min idle and is booting (30–60s). Set up the **cron-job.org pinger** (§4) so it never sleeps. Note: once awake there's **no per-request timeout**, so a slow (~25–60s) inference will still complete — it only *feels* like a hang.

**Build fails on Render.**
→ Confirm **`render.yaml` is at the repo root** (not inside `backend/`), and that `NODE_VERSION=20` is set (Node 24 breaks the tfjs prebuilds). Check the build log for which `npm install` failed — the build command installs `backend` then `ml-service` (`--omit=dev`); a failure in either stops the deploy.
