# Simple Release Guide (Build on the Server)

This is the simplest way to deploy this repo. It builds on the server,
starts the two containers (`app` and `sidecar`), and puts Nginx in front
for HTTPS.

## What you need
- A Hetzner VM (Ubuntu 22.04 or 24.04 recommended).
- One subdomain pointing to the VM: `app.yourdomain.dk`.
- Your repo URL.

## 1) Create the server
1. In Hetzner Cloud, create a new server.
2. Choose Ubuntu 22.04 or 24.04.
3. Add your SSH key when prompted.
4. Create the server and note its public IP.

## 2) Point your domain to the server
Create one A record:
- `app.yourdomain.dk -> <server-ip>`

## 3) Log into the server
```bash
ssh root@<server-ip>
```

## 4) Create a non-root user
```bash
adduser deploy
usermod -aG sudo deploy
```
Re-login as the new user:
```bash
ssh deploy@<server-ip>
```

## 5) Install required packages
```bash
sudo apt update
sudo apt install -y git nginx docker.io docker-compose-plugin
```
Enable Docker:
```bash
sudo systemctl enable --now docker
```
Allow your user to run Docker without sudo:
```bash
sudo usermod -aG docker deploy
newgrp docker
```

## 6) Clone the repo
```bash
git clone <your-repo-url> /opt/aula-insights
cd /opt/aula-insights
```

## 7) Create the environment file
Create a `.env` file with your secrets:
```bash
cat > .env <<'EOF'
# 32 bytes hex (64 chars). Generate with: openssl rand -hex 32
AULA_ENC_KEY=REPLACE_WITH_64_HEX_CHARS
AULA_AUTH_METHOD=APP
EOF
chmod 600 .env
```

## 8) Build and start the containers
```bash
docker compose -f docker-compose.yml -f docker-compose.host-nginx.yml up --build -d
```
Check that containers are running:
```bash
docker ps
```

## 9) Configure Nginx (host)
Create a site config:
```bash
sudo tee /etc/nginx/sites-available/aula-insights >/dev/null <<'EOF'
server {
    listen 80;
    server_name app.yourdomain.dk;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF
```
Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/aula-insights /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 10) Enable HTTPS (Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.yourdomain.dk
```

## 11) Verify the app
Open your browser:
- `https://app.yourdomain.dk`

If you want to test locally on the server:
```bash
curl http://127.0.0.1:3000
```

## 12) Updates (when you change code)
```bash
cd /opt/aula-insights
git pull
docker compose -f docker-compose.yml -f docker-compose.host-nginx.yml up --build -d
```

## 13) Where data is stored
- Local persistent data is in `/opt/aula-insights/data`.
- Back up that folder if you care about historical data.

## 14) Troubleshooting
- Check logs:
  ```bash
  docker logs <container-id>
  ```
- Restart everything:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.host-nginx.yml down
  docker compose -f docker-compose.yml -f docker-compose.host-nginx.yml up --build -d
  sudo systemctl restart nginx
  ```
