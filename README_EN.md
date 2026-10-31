# MailVault — Email Aggregation & TOTP Authenticator

A self-hosted, single-user web app for aggregating multiple email accounts and managing TOTP two-factor authentication tokens. All data is fully encrypted with AES-256-GCM.

[🇨🇳 中文 README](./README.md)

## Features

- **Multi-email aggregation** — Connect any number of IMAP accounts (QQ / 163 / 126 / iCloud / Gmail / custom), unified three-panel mail client
- **TOTP authenticator** — Built-in validator with manual add / batch import, real-time countdown refresh
- **Multi-factor login** — Add custom verification fields (name, age, etc.) beyond password; each field exponentially increases brute-force difficulty; answers are encrypted and compared server-side in constant time
- **Full data encryption** — Email auth codes, TOTP secrets, and verification answers are all stored encrypted via AES-256-GCM; key derived from a random seed file (`seed.php`) generated on first boot
- **Dark / light themes** — Responsive layout, one-click skin switch

## 🚀 Quick Start

### Docker (recommended)

````bash
docker compose up -d --build
````

Visit `http://localhost:80` or `http://localhost`. Initial password is in compose `ADMIN_PASSWORD` (change it after first login).

### Run directly

````bash
cd server
npm install
npm start
````

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `80` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `ADMIN_PASSWORD` | `admin123` | **Only effective on first startup** when creating the admin account |
| `JWT_SECRET` | built-in | JWT signing key — change to a random long string |
| `DB_PATH` | `../db/codes.db` | SQLite database path |
| `SEED_PATH` | `server/seed.php` | Encryption seed path — **must point to a persistent volume in container deployments** |

## ⚠️ Backup Warning

`seed.php` is the **only key** to all encrypted data on this site: **losing it = email auth codes, TOTP secrets, and verification answers become permanently unrecoverable**. Always back up the seed file together with your data.

## 📦 Deployment

### Rainyun Cloud App (雨云云应用)

Adapted for Rainyun RCA template (env vars + persistent volume + port). See [雨云部署指南.md](./雨云部署指南.md).

[![Deploy on Rainyun](https://rainyun-apps.cn-nb1.rains3.com/materials/deploy-on-rainyun-cn.svg)](https://app.rainyun.com/apps/rca/store/8121?ref=634485)

### Docker Hub / GHCR

````bash
# Docker Hub
docker pull dtyg123/mail-hub:main

# GitHub Container Registry
docker pull ghcr.io/dtyg123/mail-hub:main
````

## 📁 Project Structure

```
├─ client/          # Frontend: vanilla HTML/CSS/JS three-panel mail client
├─ server/          # Backend: Express + sql.js (SQLite) + IMAP connection pool
├─ db/              # Runtime data (not committed to repo)
├─ Dockerfile
└─ docker-compose.yml
```

## 📄 License

MIT
