# Production deployment with WinSCP and PuTTY

This project has two parts:

- `backend`: Django API and admin panel.
- `frontend`: React static build.

Recommended server layout:

```text
/var/www/video-test/
  backend/
  frontend-build/
```

Replace `example.com` below with your domain or server IP.

## 1. Prepare files locally

Backend production settings are read from `backend/.env`.

Create `backend/.env` from `backend/.env.example` and set real values:

```env
DJANGO_SECRET_KEY=long-random-secret
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=example.com,www.example.com,SERVER_IP
CORS_ALLOW_ALL_ORIGINS=False
CORS_ALLOWED_ORIGINS=https://example.com
CSRF_TRUSTED_ORIGINS=https://example.com
```

For frontend create `frontend/.env.production` from `frontend/.env.production.example`:

```env
REACT_APP_API_URL=https://example.com/api
```

Build frontend:

```bash
cd frontend
npm install
npm run build
```

Upload with WinSCP:

- Upload `backend/` to `/var/www/video-test/backend/`.
- Upload contents of `frontend/build/` to `/var/www/video-test/frontend-build/`.
- Do not upload `frontend/node_modules/`.

## 2. Backend setup on server via PuTTY

```bash
cd /var/www/video-test/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

Check backend:

```bash
venv/bin/gunicorn video_test.wsgi:application --bind 127.0.0.1:8000
```

Open another PuTTY session and check:

```bash
curl http://127.0.0.1:8000/api/
```

Stop Gunicorn with `Ctrl+C` after the check.

## 3. systemd service

Create `/etc/systemd/system/video-test.service`:

```ini
[Unit]
Description=Video Test Django API
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/video-test/backend
EnvironmentFile=/var/www/video-test/backend/.env
ExecStart=/var/www/video-test/backend/venv/bin/gunicorn video_test.wsgi:application --workers 3 --bind 127.0.0.1:8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Start service:

```bash
sudo chown -R www-data:www-data /var/www/video-test
sudo systemctl daemon-reload
sudo systemctl enable --now video-test
sudo systemctl status video-test
```

## 4. Nginx config

Create `/etc/nginx/sites-available/video-test`:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;

    root /var/www/video-test/frontend-build;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        alias /var/www/video-test/backend/staticfiles/;
    }

    location /media/ {
        alias /var/www/video-test/backend/media/;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

Enable Nginx site:

```bash
sudo ln -s /etc/nginx/sites-available/video-test /etc/nginx/sites-enabled/video-test
sudo nginx -t
sudo systemctl reload nginx
```

## 5. HTTPS

After domain DNS points to the server:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

Then update `backend/.env`:

```env
SECURE_SSL_REDIRECT=True
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
CORS_ALLOWED_ORIGINS=https://example.com
CSRF_TRUSTED_ORIGINS=https://example.com
```

Restart:

```bash
sudo systemctl restart video-test
sudo systemctl reload nginx
```

## 6. Deployment checklist

- `DJANGO_DEBUG=False`.
- `DJANGO_SECRET_KEY` is changed.
- `DJANGO_ALLOWED_HOSTS` contains the real domain/IP.
- `REACT_APP_API_URL` matches the public backend URL.
- `python manage.py migrate` completed.
- `python manage.py collectstatic --noinput` completed.
- `sudo systemctl status video-test` is active.
- `sudo nginx -t` passes.
