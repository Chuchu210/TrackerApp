#!/bin/bash
# One-shot fix — run: sudo bash fix-arthome-nginx-now.sh
set -e

echo "=== 1. Write track.arthome.ai ==="
cat > /etc/nginx/sites-available/track.arthome.ai <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name track.arthome.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name track.arthome.ai;

    ssl_certificate /etc/letsencrypt/live/track.arthome.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/track.arthome.ai/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Sans cette ligne, nginx transmet l'en-tête du client tel quel : avec `trust proxy = 1`, l'application
        # lit alors une adresse choisie par l'appelant, et l'étranglement des routes leads ne protège plus rien.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

echo "=== 2. Write admin.arthome.ai ==="
cat > /etc/nginx/sites-available/admin.arthome.ai <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name admin.arthome.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name admin.arthome.ai;

    ssl_certificate /etc/letsencrypt/live/track.arthome.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/track.arthome.ai/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Sans cette ligne, nginx transmet l'en-tête du client tel quel : avec `trust proxy = 1`, l'application
        # lit alors une adresse choisie par l'appelant, et l'étranglement des routes leads ne protège plus rien.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

echo "=== 3. Write arthome.ai ==="
cat > /etc/nginx/sites-available/arthome.ai <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name arthome.ai www.arthome.ai;
    return 301 https://admin.arthome.ai$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name arthome.ai www.arthome.ai;

    ssl_certificate /etc/letsencrypt/live/track.arthome.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/track.arthome.ai/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    return 301 https://admin.arthome.ai$request_uri;
}
NGINX

echo "=== 4. Enable sites (.conf required on Hostinger) ==="
ln -sf /etc/nginx/sites-available/track.arthome.ai /etc/nginx/sites-enabled/track.arthome.ai.conf
ln -sf /etc/nginx/sites-available/admin.arthome.ai /etc/nginx/sites-enabled/admin.arthome.ai.conf
ln -sf /etc/nginx/sites-available/arthome.ai /etc/nginx/sites-enabled/arthome.ai.conf
rm -f /etc/nginx/sites-enabled/track.arthome.ai
rm -f /etc/nginx/sites-enabled/admin.arthome.ai
rm -f /etc/nginx/sites-enabled/arthome.ai
rm -f /etc/nginx/sites-enabled/default.conf

echo "=== 5. Verify files exist and have server_name ==="
ls -la /etc/nginx/sites-enabled/
grep server_name /etc/nginx/sites-available/track.arthome.ai
grep server_name /etc/nginx/sites-available/admin.arthome.ai
grep server_name /etc/nginx/sites-available/arthome.ai

echo "=== 6. Test and reload nginx ==="
nginx -t
systemctl reload nginx

echo "=== 7. Local tests ==="
curl -sk https://127.0.0.1/health -H "Host: track.arthome.ai"
echo ""
curl -sI -H "Host: admin.arthome.ai" https://127.0.0.1/ -k | head -3
curl -sI -H "Host: arthome.ai" https://127.0.0.1/ -k | grep -i location

echo ""
echo "=== 8. External tests ==="
curl -s https://track.arthome.ai/health
echo ""
curl -sI https://admin.arthome.ai/ | head -3
