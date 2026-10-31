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

访问 `http://localhost:3600`，初始密码见 compose 中 `ADMIN_PASSWORD`（首次启动后请在网页「设置」中修改）。

### 直接运行

````bash
cd server
npm install
npm start
````

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3600` | 监听端口 |
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