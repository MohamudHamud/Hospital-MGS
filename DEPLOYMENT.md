# Deployment Guide

This guide takes MediCircle HMS from a developer PC to a real server.

## 1. Before you go live: checklist

- [ ] Use a **dedicated MySQL user**, not `root` (`deploy/create-db-user.sql`)
- [ ] Set a long random `JWT_SECRET` (32+ characters)
- [ ] `NODE_ENV=production` and `DEMO_MODE=false`
- [ ] Run **migrations only** (`npm run migrate`), not `npm run setup`, which loads demo data
- [ ] Create your admin with `npm run create-admin`, then create the staff accounts in the app
- [ ] Set hospital name, address and currency in **Settings**
- [ ] Add departments, doctors (with fees), lab tests, medicines, services and suppliers
- [ ] Enter opening balances in **Chart of Accounts** (cash in hand, bank balances, capital)
- [ ] Serve over **HTTPS** (nginx + certbot, or your hosting provider)
- [ ] Schedule **daily backups** (`npm run backup`) and copy them off the server
- [ ] Open only ports 80/443 to the internet; keep MySQL (3306) private

## 2. Database migrations

The schema is versioned in `migrations/`:

| File | What it does |
|---|---|
| `001_initial_schema.sql` | Patients, appointments, visits, lab, pharmacy, inventory, billing |
| `002_accounting.js` | Chart of accounts, journals, accounting columns, backfill of existing records |
| `003_default_settings.sql` | Default settings for a new installation |

```bash
npm run migrate          # apply pending migrations (creates the database if allowed)
npm run migrate:status   # see what is applied / pending
```

- Applied migrations are recorded in the `schema_migrations` table, and each one runs only once.
- The server also applies pending migrations at start-up (`AUTO_MIGRATE=true`).
- **Never edit a migration that has already run in production.** To change the schema, add a new file such as `004_add_ward_beds.sql` and deploy it.
- Existing databases created before migrations existed are safe: every migration is idempotent.

## 3. Option A: Linux server (Ubuntu) with PM2 + nginx

```bash
# Node 20 + MySQL + nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs mysql-server nginx
sudo npm i -g pm2

# Code
git clone https://github.com/MohamudHamud/Hospital-MGS.git
cd Hospital-MGS
npm ci --omit=dev

# Database user (edit the password inside the file first)
sudo mysql < deploy/create-db-user.sql

# Configuration
cp .env.example .env
nano .env        # set JWT_SECRET, DB_USER, DB_PASSWORD, DEMO_MODE=false

# Schema + first admin
npm run migrate
npm run create-admin

# Run forever
pm2 start ecosystem.config.js
pm2 save && pm2 startup

# nginx + HTTPS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/hospital
sudo nano /etc/nginx/sites-available/hospital   # set your domain
sudo ln -s /etc/nginx/sites-available/hospital /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your-domain.com
```

### Updating to a new version

```bash
cd Hospital-MGS
npm run backup
git pull
npm ci --omit=dev
npm run migrate
pm2 restart medicircle-hms
```

## 4. Option B: Docker

```bash
cp .env.example .env     # set JWT_SECRET, DB_PASSWORD; add MYSQL_ROOT_PASSWORD=...
docker compose up -d --build
docker compose exec app npm run create-admin
```

Data is kept in the `db_data` volume. Back it up with:

```bash
docker compose exec db sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" hospital_mgs' > backup.sql
```

## 5. Option C: Windows server (local hospital network)

1. Install Node.js 20 LTS and MySQL 8.
2. Copy or clone the project, then run `npm ci --omit=dev`.
3. Create `.env` from `.env.example`.
4. Run `npm run migrate` and then `npm run create-admin`.
5. Keep it running: `npm i -g pm2 pm2-windows-startup`, then `pm2 start ecosystem.config.js`, `pm2 save`, `pm2-startup install`.
6. Other PCs open `http://SERVER-IP:3000/app/`. Allow port 3000 in Windows Firewall.
7. Back up nightly with Task Scheduler running `npm run backup` (set `MYSQLDUMP` to the full path of `mysqldump.exe`).

## 6. Backups and restore

```bash
npm run backup                                   # writes backups/hospital_mgs-YYYYMMDD-HHMM.sql
mysql -u hms_app -p hospital_mgs < backups/hospital_mgs-20261110-0200.sql   # restore
```

Keep at least 7 daily copies and store some **off the server** (cloud drive or external disk).

## 7. Monitoring

- `GET /api/health` returns `{"ok":true,"db":"up"}`. Point an uptime monitor at it.
- Logs: `pm2 logs medicircle-hms`, or `logs/` when using `ecosystem.config.js`.
- **Admin → Audit Log** shows who did what.

## 8. Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` on live servers |
| `PORT` | HTTP port (default 3000) |
| `JWT_SECRET` | Signs login sessions. Long and random. Changing it logs everyone out |
| `DEMO_MODE` | `true` shows demo login buttons. Keep `false` in production |
| `AUTO_MIGRATE` | Apply migrations when the server starts (default `true`) |
| `TRUST_PROXY` | Proxy setting for correct client IPs behind nginx (default `loopback`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `MYSQLDUMP` | Full path to `mysqldump` for `npm run backup` if it is not on PATH |
