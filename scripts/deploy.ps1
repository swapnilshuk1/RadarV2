# RADAR v2 — Oracle Cloud Deployment Script (PowerShell)
param(
    [string]$CommitMessage = "Deploy update: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
)

$ErrorActionPreference = "Stop"

$SSH_KEY = "$env:USERPROFILE\.ssh\oracle_official.key"
$REMOTE_HOST = "ubuntu@130.210.41.232"
$REMOTE_DIR = "/home/ubuntu/radar-local-v2"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       RADAR V2 — ORACLE CLOUD AUTOMATED DEPLOYMENT         " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Target Host  : $REMOTE_HOST"
Write-Host "SSH Key      : $SSH_KEY"
Write-Host "Remote Path  : $REMOTE_DIR"
Write-Host "Live Service : http://130.210.41.232.sslip.io/"
Write-Host "────────────────────────────────────────────────────────────`n"

if (!(Test-Path $SSH_KEY)) {
    Write-Error "SSH private key not found at: $SSH_KEY"
}

# 1. Local Typecheck & Build
Write-Host "[1/4] Running local TypeScript typecheck..." -ForegroundColor Yellow
npx tsc --noEmit

Write-Host "`n[2/4] Running local production build..." -ForegroundColor Yellow
npm run build

# 2. Git Commit and Push
Write-Host "`n[3/4] Checking and pushing Git changes to origin/main..." -ForegroundColor Yellow
$status = git status --porcelain
if ($status) {
    git add .
    git commit -m "$CommitMessage"
} else {
    Write-Host "Working tree clean. Pushing existing commits..." -ForegroundColor Green
}
git push origin main

# 3. Remote Server Pull & PM2 Restart
Write-Host "`n[4/4] Deploying to Oracle Cloud Server via SSH..." -ForegroundColor Yellow
$remoteCmd = "cd $REMOTE_DIR && git fetch origin main && git reset --hard origin/main && npm install && npm run build && pm2 restart radar-v2 && pm2 status"

ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" $REMOTE_HOST "$remoteCmd"

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "      DEPLOYMENT COMPLETE — SERVER RUNNING SUCCESSFULLY     " -ForegroundColor Green
Write-Host "      Live URL: http://130.210.41.232.sslip.io/             " -ForegroundColor Green
Write-Host "============================================================`n" -ForegroundColor Green
