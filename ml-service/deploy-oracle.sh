#!/usr/bin/env bash
# =============================================================================
# FixMyCity — Oracle Cloud Always Free VM setup (Ubuntu 22.04, ARM64 Ampere A1)
# -----------------------------------------------------------------------------
# Installs Node 20 + pm2, then runs BOTH the ml-service (:7860) and the backend
# (:5000) on this single VM. back->ml is a localhost call. Only :5000 is exposed
# publicly (see the firewall step at the bottom + Oracle Security List).
#
# Run ONCE on a fresh VM, from the repo root, after `git clone`:
#   chmod +x ml-service/deploy-oracle.sh && ./ml-service/deploy-oracle.sh
#
# Set these env values in ml-service/.env and backend/.env BEFORE running (the
# script sources them via pm2). See .env.example in each folder.
# =============================================================================
set -euo pipefail

echo "==> [1/6] System update + build essentials"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential ca-certificates

echo "==> [2/6] Node 20 LTS (NodeSource, arm64)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v && npm -v

echo "==> [3/6] pm2 process manager (keeps services running + auto-start on reboot)"
sudo npm install -g pm2

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "==> repo root: $REPO_ROOT"

echo "==> [4/6] Install deps"
( cd "$REPO_ROOT/ml-service" && npm install --omit=dev )
( cd "$REPO_ROOT/backend"    && npm install --omit=dev )

echo "==> [5/6] Start both services under pm2"
# ml-service reads its .env for PORT + ML_KEY; backend reads its .env for
# MONGO_URI/JWT_SECRET/CORS_ORIGIN + ML_SERVICE_URL/ML_KEY.
cd "$REPO_ROOT"
pm2 delete fixmycity-ml fixmycity-backend 2>/dev/null || true
( cd "$REPO_ROOT/ml-service" && pm2 start server.js --name fixmycity-ml --time )
( cd "$REPO_ROOT/backend"    && pm2 start server.js --name fixmycity-backend --time )
pm2 save
# Make pm2 resurrect both on VM reboot:
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | bash || true
pm2 save

echo "==> [6/6] Open the backend port (5000) in the VM firewall (iptables)"
# Oracle Ubuntu images ship restrictive iptables — this is the #1 gotcha.
# NOTE: also add an Ingress rule for TCP 5000 in the Oracle Console Security List.
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5000 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || (sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save)

echo ""
echo "=============================================================="
echo " DONE. Check status:   pm2 status"
echo " Logs:                 pm2 logs fixmycity-ml"
echo "                       pm2 logs fixmycity-backend"
echo " Local health:         curl http://localhost:7860/health"
echo "                       curl http://localhost:5000/api/health"
echo " Public backend:       http://<VM_PUBLIC_IP>:5000/api/health"
echo "=============================================================="
