#!/bin/bash
#
# Deploy RADAR v2 to Oracle Cloud Server
# Target: http://130.210.41.232.sslip.io/
#

set -e

echo "=== RADAR v2 P3 Deployment ==="
echo "Target Server: 130.210.41.232.sslip.io"
echo ""

# Configuration
SERVER_IP="130.210.41.232"
SERVER_USER="ubuntu"  # Adjust if different
DEPLOY_DIR="/opt/radar"
BACKUP_DIR="/opt/radar-backup-$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Creating deployment package...${NC}"
# Build should already be done locally
if [ ! -d ".output" ]; then
    echo -e "${RED}Error: .output directory not found. Run 'npm run build' first.${NC}"
    exit 1
fi

# Create deployment archive
tar -czf radar-deploy.tar.gz \
    .output/ \
    package.json \
    package-lock.json \
    radar.sqlite \
    src/data/ontology/ \
    src/data/live-scraped.json \
    --exclude='node_modules' \
    --exclude='.git' \
    2>/dev/null || true

echo -e "${GREEN}✓ Deployment package created: radar-deploy.tar.gz${NC}"
echo ""

echo -e "${YELLOW}Step 2: Deployment Instructions${NC}"
echo ""
echo "Since automated SSH deployment is not configured, please run these commands manually:"
echo ""
echo "# 1. Copy deployment package to server:"
echo "scp radar-deploy.tar.gz ${SERVER_USER}@${SERVER_IP}:~/"
echo ""
echo "# 2. SSH into server:"
echo "ssh ${SERVER_USER}@${SERVER_IP}"
echo ""
echo "# 3. On the server, run:"
cat << 'SERVER_COMMANDS'
# Stop existing service
sudo systemctl stop radar || true

# Backup existing deployment
if [ -d /opt/radar ]; then
    sudo mv /opt/radar /opt/radar-backup-$(date +%Y%m%d-%H%M%S)
fi

# Create new deployment directory
sudo mkdir -p /opt/radar
sudo tar -xzf ~/radar-deploy.tar.gz -C /opt/radar
sudo chown -R www-data:www-data /opt/radar

# Install dependencies
cd /opt/radar
npm ci --production

# Restart service
sudo systemctl restart radar

# Verify deployment
curl -s http://localhost:3000/ | head -1
SERVER_COMMANDS

echo ""
echo -e "${GREEN}=== Deployment package ready ===${NC}"
echo ""
echo "Alternative: If you have a different deployment method configured,"
echo "please use that instead (e.g., Docker, PM2, etc.)"
