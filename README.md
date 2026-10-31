# 邮箱验证工作台 MailVault

多邮箱账号统一收件 · TOTP 动态令牌 · 自定义多重登录验证 · 私密部署的单用户 Web 应用。

纯 Node.js + 原生 HTML/CSS/JS 实现，无前端框架，一条命令即可跑起来；提供 Docker 镜像一键部署。

## ✨ 功能

- **多邮箱聚合**：同时挂载任意多个 IMAP 邮箱（QQ / 163 / 126 / iCloud / Gmail / 自定义），三栏式邮件客户端，统一浏览、搜索、标记已读
- **TOTP 动态令牌**：内置验证器，支持手动添加 / 批量导入，实时刷新倒计时
- **多重登录验证**：除密码外可自由添加多个自定义验证项（姓名、年龄……），每多一项暴力破解难度成倍增加；验证项答案加密存储，服务端恒定时间比较，不泄露是哪一项答错
- **全量数据加密**：邮箱授权码、TOTP 密钥、验证项答案全部以 AES-256-GCM 加密入库，密钥派生自首次启动生成的随机种子文件（`seed.php`）
- **深色/浅色主题**、响应式布局、一键换肤

## 🚀 快速开始

### Docker（推荐）

````bash
docker compose up -d --build
````

访问 `http://localhost:80` 或 `http://localhost`，初始密码见 compose 中 `ADMIN_PASSWORD`（首次启动后请在网页「设置」中修改）。

### 直接运行

````bash
cd server
npm install
npm start
````

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `80` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `ADMIN_PASSWORD` | `admin123` | **仅首次启动**创建管理员时生效 |
| `JWT_SECRET` | 内置值 | JWT 签名密钥，请改成随机长字符串 |
| `DB_PATH` | `../db/codes.db` | SQLite 数据库路径 |
| `SEED_PATH` | `server/seed.php` | 加密种子路径，**容器部署必须指向持久化卷** |

## ⚠️ 备份警告

`seed.php` 是全站加密数据的唯一密钥：**丢失它 = 邮箱授权码、动态令牌密钥、验证项答案永久无法解密**。备份数据时必须连同种子文件一起备份。

## 🐳 部署到雨云云应用

已适配雨云 RCA 模板（环境变量 + 持久化卷 + 端口），详细参数见 [雨云部署指南.md](./雨云部署指南.md)。

[![通过雨云一键部署](https://rainyun-apps.cn-nb1.rains3.com/materials/deploy-on-rainyun-cn.svg)](https://app.rainyun.com/apps/rca/store/8121?ref=634485)

## 📁 结构

```
├─ client/          # 前端：原生 HTML/CSS/JS 三栏邮件客户端
├─ server/          # 后端：Express + sql.js(SQLite) + IMAP 连接池
├─ db/              # 运行数据（不入库）
├─ Dockerfile
└─ docker-compose.yml
```

## 📄 License

MIT

---

# 🇬🇧 English

## MailVault — Email Aggregation & TOTP Authenticator

A self-hosted, single-user web app for aggregating multiple email accounts and managing TOTP two-factor authentication tokens. All data is fully encrypted with AES-256-GCM.

**Features:**
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