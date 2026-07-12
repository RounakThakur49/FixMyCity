# Deploying FixMyCity on Oracle Cloud (Always Free) — primary, full-pipeline

This is the **recommended production-grade free deploy**: an Oracle Cloud **Ampere A1
(ARM64)** Always-Free VM runs **both** tiers (backend `:5000` + ML service `:7860`)
as a real **split** — the backend calls the ML service over `localhost`. The
frontend stays on Vercel; the database stays on MongoDB Atlas.

**Why Oracle over Render for the primary:**

| | Render Free | Oracle Ampere A1 (Always Free) |
|---|---|---|
| CPU | 0.1 shared vCPU | up to **4 OCPU** (dedicated ARM cores) |
| RAM | 512 MB | up to **24 GB** |
| Inference/photo | ~90–140 s | **~3–6 s** (pure-JS), sub-second with native TF |
| Full ML pipeline | ❌ CLIP + NSFW disabled to fit RAM | ✅ **civic + NSFW + CLIP all ON** |
| Sleep | sleeps after 15 min idle | **always-on**, no cold start |
| Monthly cap | 750 instance-hrs (shared) | **no cap** |
| Egress | limited | 10 TB/mo |
| Card at signup | not required | **required (identity only — Always-Free tier is $0, never charged)** |

> The Always-Free A1 tier is genuinely free forever. Oracle takes a card at signup
> for identity verification and *may* place a small temporary auth hold; it does
> **not** charge the Always-Free resources. You are only billed if you manually
> upgrade the account to "Pay As You Go" AND exceed Always-Free limits.

Render stays a **documented fallback** — see [§9](#9-fallback-to-render). Nothing in
the codebase is Oracle-specific; the switch is purely deploy config + env vars.

---

## 0. What actually changes vs Render

Nothing in code. Two differences, both env:

1. **Split, not inline.** On Render the backend loads the ML pipeline *in its own
   process* (`ML_INLINE=true`) to fit one free service. On Oracle you run the ML
   service as its own process and the backend calls it over HTTP at
   `http://localhost:7860`. So on Oracle you **do NOT set `ML_INLINE`**.
2. **Full pipeline.** Render sets `DISABLE_CLIP=true` (and you had `DISABLE_NSFW=true`)
   to fit 512 MB. On Oracle you **omit both** → NSFW + CLIP load (24 GB has room).

Everything else (JWT, CORS, Atlas, fail-open, the `X-ML-KEY` guard) is identical.

---

## 1. Prerequisites

- Oracle Cloud account (free signup, card for ID verification).
- Your MongoDB Atlas connection string (`MONGO_URI`).
- Your GitHub fork: `https://github.com/debmalyo-hub07/FixMyCity.git`.
- A Vercel-deployed frontend URL (for `CORS_ORIGIN`).
- A long random `ML_KEY` and `JWT_SECRET` (generate with `openssl rand -hex 24`).

---

## 2. Create the A1 instance

1. Oracle Console → **Compute → Instances → Create instance**.
2. **Image & shape → Change shape → Ampere → `VM.Standard.A1.Flex`**.
   Pick e.g. **2 OCPU / 12 GB** (plenty) or **4 OCPU / 24 GB** (max free).
3. **Image:** Canonical **Ubuntu 22.04 (aarch64/ARM64)**.
4. **SSH keys:** upload your public key (or let Oracle generate + download the private key).
5. Create. Note the **public IPv4** once it boots.

> **A1 capacity tip:** free A1 is popular and a region can return *"Out of host
> capacity."* Retry (the console has a retry), try a different Availability Domain,
> or pick a less-busy home region at signup. This is the single most common friction.
> A used A1 (running a real workload) is **not reclaimed** — unlike the idle AMD micro shape.

---

## 3. Networking — open port 5000 only

The backend (`:5000`) is public; the ML service (`:7860`) stays **private** (localhost).

1. **Oracle Security List** (VCN → your subnet → Security List → Ingress Rules):
   add **Ingress: source `0.0.0.0/0`, IP protocol TCP, destination port `5000`**.
   Do **not** add 7860.
2. **In-VM firewall** — Oracle Ubuntu images ship a restrictive `iptables`. The
   setup script ([§6](#6-run-the-split)) opens 5000 for you; if you skip the script,
   run it manually:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5000 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. Optional (recommended for real use): ports **80/443** if you add nginx + HTTPS ([§8](#8-https-strongly-recommended)).

---

## 4. SSH in

```bash
ssh -i /path/to/private_key ubuntu@<VM_PUBLIC_IP>
```

---

## 5. Clone the repo + set env vars

```bash
cd ~
git clone https://github.com/debmalyo-hub07/FixMyCity.git
cd FixMyCity
```

Create **`ml-service/.env`** (CLIP + NSFW ON — just omit the DISABLE flags):

```bash
cat > ml-service/.env <<'EOF'
PORT=7860
ML_KEY=<same-secret-as-backend>
# TF_BACKEND=wasm   # optional; falls back to cpu on this fused graph-model
# NO DISABLE_CLIP / NO DISABLE_NSFW → full pipeline loads (24 GB has room)
EOF
```

Create **`backend/.env`** (split mode — no `ML_INLINE`):

```bash
cat > backend/.env <<'EOF'
PORT=5000
MONGO_URI=<your-atlas-connection-string>
JWT_SECRET=<long-random-string>
CORS_ORIGIN=https://<your-vercel-app>.vercel.app
ML_SERVICE_URL=http://localhost:7860
ML_KEY=<same-secret-as-ml-service>
# DO NOT set ML_INLINE (leaving it unset = real split → uses ML_SERVICE_URL)
# DO NOT set DISABLE_CLIP / DISABLE_NSFW
EOF
```

> **Footgun:** if `ML_INLINE=true` is set on the backend, `callMlInfer()` takes the
> in-process branch first and **silently ignores `ML_SERVICE_URL`**. For the split,
> `ML_INLINE` must be unset. (`ML_KEY` must be **identical** on both tiers, or the
> ML service returns 401 and the backend fails open — accepting every image unchecked.)

---

## 6. Run the split

A ready script installs Node 20 + pm2 and starts both services:

```bash
chmod +x ml-service/deploy-oracle.sh
./ml-service/deploy-oracle.sh
```

It: updates apt + build tools → installs Node 20 (NodeSource arm64) → installs pm2 →
`npm install --omit=dev` in both folders → `pm2 start` `fixmycity-ml` (:7860) and
`fixmycity-backend` (:5000) → `pm2 save` + `pm2 startup` (resurrect on reboot) →
opens iptables port 5000.

> **Node 20 only.** tfjs prebuilds don't exist for Node 24 (NAPI v10). The script
> pins 20.

---

## 7. Verify

```bash
pm2 status                                 # both online
curl http://localhost:7860/health          # ML: expect model_loaded, nsfw_loaded:true, clip_ready:true
curl http://localhost:5000/api/health      # backend: ml_service:"reachable", clip_ready:true
curl http://<VM_PUBLIC_IP>:5000/api/health # public reachability
pm2 logs fixmycity-ml                       # watch model load ("Pipeline load complete")
```

The win vs Render: `/health` now shows **`clip_ready:true` and `nsfw_loaded:true`**
(both were `false` on Render). Inference completes in a few seconds, not ~90 s.

Then point the frontend at the backend and redeploy Vercel:

- Vercel → project → Settings → Environment Variables →
  `REACT_APP_API_URL = http://<VM_PUBLIC_IP>:5000` (or your HTTPS domain — see §8).
- **Redeploy** (the URL is baked at build time).
- Confirm `CORS_ORIGIN` in `backend/.env` matches the exact Vercel origin, then
  `pm2 restart fixmycity-backend`.

**MongoDB Atlas:** the Oracle VM has a **static public IP** — add it to Atlas
Network Access (tighter than Render's `0.0.0.0/0`, which was needed for Render's
rotating IPs).

---

## 8. HTTPS (strongly recommended)

A Vercel HTTPS frontend calling a plain `http://<IP>:5000` backend triggers
**mixed-content blocking** in the browser — the API calls silently fail. For a real
deploy you need TLS on the backend:

- Point a domain/subdomain at `<VM_PUBLIC_IP>`.
- Open ingress 80 + 443 (Security List + iptables).
- Install nginx, reverse-proxy `:5000`, and run Certbot (Let's Encrypt).
- Set `REACT_APP_API_URL=https://api.yourdomain.com` and redeploy Vercel.

(Cloudflare in front is an alternative that also gives you free TLS.)

For a quick demo without a domain, run the frontend over `http://localhost:3000`
against `http://<IP>:5000`, or use the `localStorage['fixmycity-api-url']` runtime
override — but production needs §8.

---

## 9. Fallback to Render

If the A1 VM is ever lost (capacity reclaim after prolonged idle, account issue),
fall straight back to the Render blueprint — **no code change**:

- `render.yaml` (repo root) already pins the inline single-service config
  (`ML_INLINE=true`, `DISABLE_CLIP=true`) that fits Render's 512 MB.
- Render → New → Blueprint → this repo → set `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`.
- See [DEPLOY.md](DEPLOY.md) for the full Render runbook.

On Render the trade-off returns (slow inference, CLIP + optionally NSFW off) — it's
a safety net, not the primary. The two deploys are fully decoupled: their env scopes
never touch, so running Oracle does not affect a Render instance and vice-versa.

---

## 10. Optional: native TensorFlow for sub-second inference

The default runs pure-JS tfjs (already fast on 4 dedicated cores). To go further,
`@tensorflow/tfjs-node` (native libtensorflow) is **5–10× faster again** and natively
handles the model's fused-conv ops. Caveat: **there is no prebuilt tfjs-node binary
for linux-arm64** — you must build from source (`build-essential` + `python3`,
`npm rebuild @tensorflow/tfjs-node --build-from-source`, ~2–3 h compile; bake into a
Docker image so it's one-time). Only worth it if you need sub-second latency; the
plain A1 deploy is already a ~20–40× improvement over Render on its own.
