#!/bin/bash
# RADAR v2 — Oracle Cloud Deployment Script (Bash)
set -e

SSH_KEY="${HOME}/.ssh/oracle_official.key"
REMOTE_HOST="ubuntu@130.210.41.232"
REMOTE_DIR="/home/ubuntu/radar-local-v2"
COMMIT_MSG="${1:-Deploy update: $(date '+%Y-%m-%d %H:%M:%S')}"

echo "============================================================"
echo "       RADAR V2 — ORACLE CLOUD AUTOMATED DEPLOYMENT         "
echo "============================================================"
echo "Target Host  : ${REMOTE_HOST}"
echo "SSH Key      : ${SSH_KEY}"
echo "Remote Path  : ${REMOTE_DIR}"
echo "Live Service : http://130.210.41.232.sslip.io/"
echo "────────────────────────────────────────────────────────────"

if [ ! -f "${SSH_KEY}" ]; then
  echo "Error: SSH private key not found at: ${SSH_KEY}"
  exit 1
fi

echo "[1/4] Running local TypeScript typecheck..."
npx tsc --noEmit

echo "[2/4] Running local production build..."
npm run build

echo "[3/4] Checking and pushing Git changes to origin/main..."
if [ -n "$(git status --porcelain)" ]; then
  git add .
  git commit -m "${COMMIT_MSG}"
fi
git push origin main

echo "[4/4] Deploying to Oracle Cloud Server via SSH..."
ssh -o StrictHostKeyChecking=no -i "${SSH_KEY}" "${REMOTE_HOST}" \
  "cd ${REMOTE_DIR} && git fetch origin main && git reset --hard origin/main && npm install && npm run build && pm2 restart radar-v2 && pm2 status"

echo "============================================================"
echo "      DEPLOYMENT COMPLETE — SERVER RUNNING SUCCESSFULLY     "
echo "      Live URL: http://130.210.41.232.sslip.io/             "
echo "============================================================"
