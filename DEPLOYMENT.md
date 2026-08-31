# RADAR v2 — Oracle Cloud Deployment Guide

This document contains the single source of truth for deploying RADAR v2 to the live Oracle Cloud Server and pushing to GitHub.

---

## 1. Quick Deploy (Automated 1-Command)

Run from the project root (`c:\Users\swapn\Downloads\radar-local-v2`):

```bash
# Recommended standard deployment:
npm run deploy

# Or with custom commit message:
npx tsx scripts/deploy.ts "Commit message"

# Or via PowerShell script:
.\scripts\deploy.ps1 "Commit message"
```

What this does automatically:
1. Validates TypeScript types (`npx tsc --noEmit`).
2. Runs local production build (`npm run build`).
3. Commits any modified files and pushes to GitHub (`git push origin main`).
4. Connects to Oracle VM over SSH using `C:\Users\swapn\.ssh\oracle_official.key`.
5. Pulls latest code, runs `npm install`, `npm run build`, and restarts PM2 (`pm2 restart radar-v2`).

---

## 2. Infrastructure & Connection Details

| Property | Value | Notes |
| :--- | :--- | :--- |
| **Server IP** | `130.210.41.232` | Oracle Cloud VM |
| **Domain URL** | `http://130.210.41.232.sslip.io/` | Live public application |
| **SSH User** | `ubuntu` | Standard Ubuntu user |
| **SSH Private Key** | `C:\Users\swapn\.ssh\oracle_official.key` | **Never use `.pub` file for private key!** |
| **SSH Host Alias** | `oracle-radar` | Saved in `~/.ssh/config` |
| **Remote Directory** | `/home/ubuntu/radar-local-v2` | Cloned repository on server |
| **Process Manager** | `pm2` | Process name: `radar-v2` |
| **Git Remote** | `origin` (`https://github.com/swapnilshuk1/RadarV2.git`) | Branch: `main` |
| **Database** | Turso Cloud (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`) | Dual cloud/local SQLite |

---

## 3. Manual SSH & Management Commands

### Connect to Server:
```bash
# Using SSH config alias:
ssh oracle-radar

# Or direct with key flag:
ssh -o StrictHostKeyChecking=no -i "C:\Users\swapn\.ssh\oracle_official.key" ubuntu@130.210.41.232
```

### Server PM2 Service Commands:
```bash
# Check status
pm2 status

# View live logs
pm2 logs radar-v2 --lines 100

# Restart application
pm2 restart radar-v2

# Stop / Start
pm2 stop radar-v2
pm2 start radar-v2
```

---

## 4. SSH Configuration Reference (`~/.ssh/config`)

Ensure `C:\Users\swapn\.ssh\config` contains:
```ssh-config
Host oracle-radar 130.210.41.232 130.210.41.232.sslip.io
    HostName 130.210.41.232
    User ubuntu
    IdentityFile C:\Users\swapn\.ssh\oracle_official.key
    StrictHostKeyChecking no
    IdentitiesOnly yes
```

---

## 5. Operational Topology & Single-Instance Scraper Limitation (ADR-003)

Until the distributed `scrape_runs` state machine and `BlobStore` object storage layer are deployed (specified in `docs/architecture/ADR-003-multi-tenant-scrape-runs-and-blob-storage.md`):

1. **Host-Colocated Execution**: Live Playwright browser scraping must run as a single-instance process hosted on the production server (`130.210.41.232`).
2. **Local Snapshot Storage**: Scraped card HTML payloads and snapshots reside on the host filesystem under `.radar/artifacts/snapshots/`.
3. **Colocated Worker Leases**: The background enrichment worker daemon (`scripts/enrich.ts` / `EvaluationWorker`) must run on the same server instance as the scraper so that `snapshot_path` references remain resolvable.
4. **Tenant Scoping Boundary**: Tenant and candidate isolation is strictly enforced across user authentication, active search plan selection, evaluation contexts, and keyset serving queries. Run progress observation and cancellation controls operate on the local host instance until ADR-003 is shipped.
