# FixMyCity ML service — Hugging Face Spaces Docker image.
#
# HF Spaces requires the container to listen on port 7860. The pipeline
# (EfficientNetV2S + nsfwjs + CLIP) needs ~1GB RAM resident; the free CPU Basic
# tier (2 vCPU / 16GB) holds it comfortably.
#
# node:20 (NOT slim/alpine) — @tensorflow/tfjs pure-JS + @xenova/transformers
# (onnxruntime-node) pull prebuilt native binaries that expect a full glibc
# toolchain; slim/alpine miss shared libs and break the install.
FROM node:20

WORKDIR /app

# Install deps first for layer caching. Only package files invalidate this layer.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App code + ML artifacts (model shards, thresholds, exemplars).
COPY . .

# Pre-seed the CLIP model (~149MB) into the image so the first /api/infer
# request doesn't stall on a cold download. Best-effort: if the download fails
# at build time the service still boots and downloads at runtime (fail-open).
ENV TRANSFORMERS_CACHE=/app/.cache
RUN node -e "import('@xenova/transformers').then(async(t)=>{t.env.cacheDir='/app/.cache';t.env.allowRemoteModels=true;await t.AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32').catch(()=>{});await t.CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32').catch(()=>{});await t.CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32').catch(()=>{});console.log('CLIP pre-seed done');}).catch(e=>console.warn('CLIP pre-seed skipped:',e.message));" || true

ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
