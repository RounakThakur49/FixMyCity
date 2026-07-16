# FixMyCity — ML Inference Service

Standalone microservice that runs the FixMyCity civic-image validation pipeline.
The backend calls it over HTTP per uploaded complaint photo; this service returns
an **accept / block** verdict. Extracted from the backend so the backend stays
light (no ML deps) and this heavy pipeline (~1GB RAM) can be hosted + scaled +
swapped independently.

## Pipeline

1. **NSFW pre-screen** (`nsfwjs`) — blocks adult/explicit uploads.
2. **Custom civic classifier** — 4-class EfficientNetV2S (`civic_model_tfjs/`,
   pure-JS `@tensorflow/tfjs`), temperature-calibrated + energy-based OOD.
3. **Decision** (`decideBlock`) — OOD / low-confidence / category-mismatch rules.
4. **"Others" open-set** — CLIP (`@xenova/transformers`, exemplars in
   `civic_exemplars.json`) scores image+title; never blocks.

**Fails open**: any model-load or inference error degrades to `accept` — a
citizen is never blocked by an ML fault.

## API

### `POST /api/infer`
Guarded by header `X-ML-KEY: <ML_KEY>` when `ML_KEY` is set.

Request:
```json
{ "imageBase64": "data:image/jpeg;base64,...", "type": "Potholes", "title": "big pothole" }
```
Response:
```json
{
  "action": "accept" | "block",
  "httpStatus": 201 | 422,
  "blockPayload": { ... } | null,
  "imageCheck": { "model": "...", "matched": true, "blocked": false, "note": "...", ... }
}
```
The backend applies this verbatim: on `block` it returns `httpStatus` + `blockPayload`
to the frontend; otherwise it stores `imageCheck` on the complaint (stamping its
own `at` timestamp — this service intentionally omits time).

### `GET /health`
Pipeline snapshot (model loaded, nsfw loaded, clip ready, classes). The backend
proxies this into its own `/api/health`.

## Run locally

```bash
cd ml-service
npm install
node server.js          # boots on :7860, loads models in the listen callback
```
Test:
```bash
curl http://localhost:7860/health
curl -X POST http://localhost:7860/api/infer \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"data:image/jpeg;base64,...","type":"Potholes","title":"pothole"}'
```

> **Node 20 required.** `@tensorflow/tfjs` native prebuilts don't ship for
> Node 24 (NAPI v10). Use `nvm` to pin 20 LTS.

## Deploy — Hugging Face Spaces (Docker)

1. Create a new **Docker** Space (free CPU Basic = 2 vCPU / 16GB RAM).
2. Push the contents of `ml-service/` to the Space repo.
3. In Space **Settings → Secrets**, set `ML_KEY` (same value you set on the backend).
4. HF requires the container to listen on **port 7860** — the `Dockerfile` already does.
5. First boot downloads the CLIP model (~149MB) unless pre-seeded (the Dockerfile
   attempts a build-time pre-seed). Watch build logs; test `GET https://<space>.hf.space/health`.

> Free CPU Basic **sleeps after 48h idle** and auto-wakes on the next request
> (cold-start delay). Fine for demo/submission; upgrade to paid for 24/7.

See the repo-root `DEPLOY.md` for the full 3-tier deploy runbook.

## Env

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `7860` | HF Spaces requires 7860. |
| `ML_KEY` | *(unset)* | When set, `/api/infer` requires `X-ML-KEY`. Match the backend. |

## Files

| Path | Role |
|------|------|
| `server.js` | Express wrapper — `/api/infer`, `/health`, key guard, boot load |
| `infer.js` | Orchestration (NSFW → civic → CLIP → verdict) |
| `ml/pipeline.js` | The pipeline (models, calibration, OOD, decideBlock) |
| `others_clip.js` | CLIP open-set classifier for "Others" |
| `civic_model_tfjs/` | 4-class EfficientNetV2S weights (model.json + 10 shards) |
| `civic_thresholds.json` | Calibrated thresholds / temperature / OOD config |
| `civic_exemplars.json` | CLIP exemplar embeddings for "Others" |
| `nsfw_clean_dataset.js` | Offline dev CLI (dataset cleaning) — not part of the service |
