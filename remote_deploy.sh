sudo systemctl stop radar || true
if [ -d /opt/radar ]; then
    sudo mv /opt/radar /opt/radar-backup-$(date +%Y%m%d-%H%M%S)
fi
sudo mkdir -p /opt/radar
sudo tar -xzf ~/radar-deploy.tar.gz -C /opt/radar
sudo chown -R www-data:www-data /opt/radar
cd /opt/radar
sudo npm install --production
sudo systemctl restart radar || true