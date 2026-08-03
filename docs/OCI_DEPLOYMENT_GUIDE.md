# Deploying RADAR v2 on Oracle Cloud Infrastructure (OCI) Always Free Tier

This step-by-step guide walks you through deploying **RADAR v2** on an **OCI Always Free Ampere A1 Compute instance** (ARM64, 4 OCPUs, 24 GB RAM, Ubuntu 22.04 LTS) using Node.js, PM2, Caddy/Nginx (reverse proxy with HTTPS), and Playwright headless scraper dependencies.

---

## 1. Create the OCI Compute Instance

1. Log into your **Oracle Cloud Console** at [cloud.oracle.com](https://cloud.oracle.com).
2. Go to **Compute** ➔ **Instances** ➔ **Create Instance**.
3. **Name**: `radar-v2-prod`
4. **Image and Shape**:
   - Click **Change Image**: Select **Ubuntu 22.04 LTS Minimal** (or Ubuntu 22.04 Minimal ARM64).
   - Click **Change Shape**: Select **Ampere (ARM64)** ➔ `VM.Standard.A1.Flex`.
   - Allocate: **4 OCPUs** and **24 GB Memory** (100% Always Free eligible).
5. **Networking**:
   - Select or create a Public Subnet in your default VCN.
   - Assign a **Public IPv4 address**.
6. **SSH Keys**:
   - Generate or upload your public SSH key (`id_rsa.pub`). Save the private key securely on your local computer.
7. Click **Create** and wait 1-2 minutes for the instance status to turn **Running**. Note your Public IP address (e.g. `132.145.x.x`).

---

## 2. Configure OCI VCN Ingress Rules (Ports 80 & 443)

Oracle Cloud blocks public web traffic by default. You must open HTTP (80) and HTTPS (443):

1. Go to **Networking** ➔ **Virtual Cloud Networks (VCN)**.
2. Click your VCN ➔ Click **Security Lists** ➔ Select **Default Security List**.
3. Under **Ingress Rules**, click **Add Ingress Rules**:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `80, 443`
   - **Description**: `HTTP and HTTPS web traffic for RADAR v2`
4. Click **Add Ingress Rules**.

---

## 3. Connect & Setup Ubuntu Server Environment

SSH into your Oracle Cloud VM:

```bash
ssh -i /path/to/your/private_key ubuntu@YOUR_OCI_PUBLIC_IP
```

### A. Open Ubuntu iptables firewall for Ports 80 & 443
Oracle Ubuntu images run `iptables` locally:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### B. Install Node.js 20 LTS, Git & PM2

```bash
# Update Ubuntu packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

# Install PM2 process manager globally
sudo npm install -g pm2

# Verify versions
node -v   # Should be v20.x.x
npm -v    # Should be v10.x.x
```

### C. Install Playwright Chromium & Anti-Bot Dependencies
To allow Playwright stealth scraping to run headlessly in cloud containers:

```bash
# Install Chromium system dependencies
sudo npx playwright install-deps chromium
```

---

## 4. Deploy RADAR v2 Codebase

### A. Clone Repository & Install Dependencies

```bash
cd ~
git clone https://github.com/swapnilshuk1/RadarV2.git radar-local-v2
cd radar-local-v2

# Install production & build dependencies
npm ci
```

### B. Configure Environment Variables (`.env`)

Create a `.env` file in the project root:

```bash
nano .env
```

Paste your environment variables (Turso database URL, authToken, session secret):

```env
NODE_ENV=production
PORT=3000

# Turso / LibSQL Database (or local radar.sqlite)
TURSO_DATABASE_URL=libsql://your-turso-db.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token

# Session / Auth Secret
SESSION_SECRET=your-random-32-character-secret
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 5. Build Production SSR Bundle & Database Migrations

```bash
# Apply SQLite / Turso schema migrations
npx tsx scripts/audit-lineage.ts

# Build Nitro SSR production bundle
npm run build
```

This compiles the SSR application into `.output/server/index.mjs`.

---

## 6. Start Application with PM2 Process Manager

Start RADAR v2 using PM2 so it automatically restarts on server reboot or crash:

```bash
# Start server with PM2
pm2 start .output/server/index.mjs --name "radar-v2"

# Save PM2 process list
pm2 save

# Setup PM2 startup script on system boot
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Verify status:

```bash
pm2 status
pm2 logs radar-v2 --lines 20
```

---

## 7. Configure Reverse Proxy & Free SSL HTTPS (Caddy)

Caddy automatically handles Let's Encrypt SSL certificates with zero manual renewal work:

### A. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

### B. Configure Caddyfile

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace contents with:

```caddy
# If using a domain name (e.g. radar.yourdomain.com):
radar.yourdomain.com {
    reverse_proxy localhost:3000
}

# OR if using raw IP address (HTTP only):
:80 {
    reverse_proxy localhost:3000
}
```

Restart Caddy:

```bash
sudo systemctl restart caddy
```

---

## 8. Verification & Live Status

1. Open your browser and navigate to `https://radar.yourdomain.com` (or `http://YOUR_OCI_PUBLIC_IP`).
2. Verify that **RADAR v2** loads with the dark-mode glassmorphic UI, Shortlist cards, and Executive Dossier views.
3. Verify live scraper execution:
   ```bash
   npx tsx scripts/scrape.ts
   ```

---

## Useful Maintenance Commands

```bash
# View live application logs
pm2 logs radar-v2

# Restart RADAR after pulling git updates
git pull origin main
npm run build
pm2 restart radar-v2

# Monitor server CPU/RAM usage
pm2 monit
```
