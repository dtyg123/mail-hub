require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { setupRoutes } = require('./routes');

const app = express();
const PORT = process.env.PORT || 3600;
const HOST = process.env.HOST || '0.0.0.0';

// 经反向代理（雨云云应用网关）部署时，取 X-Forwarded-For 中的真实客户端 IP，
// 否则登录日志与暴力破解限流会把所有人算作同一个 IP
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (!req.path.startsWith('/api/health')) {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    }
    next();
});

(async () => {
    const db = require('./db');
    await db.init();

    const bcrypt = require('bcryptjs');
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    const existing = db.get('SELECT value FROM config WHERE key = ?', ['admin_hash']);
    if (!existing) {
        db.run('INSERT INTO config(key, value) VALUES (?, ?)', ['admin_hash', bcrypt.hashSync(ADMIN_PASSWORD, 10)]);
    }

    setupRoutes(app);

    app.listen(PORT, HOST, () => {
        console.log('========================================');
        console.log('  邮箱聚合中心 运行中');
        console.log(`  本机访问: http://localhost:${PORT}`);
        console.log(`  局域网访问: http://<本机IP>:${PORT}`);
        // 只在首次创建管理员时打印初始密码，避免每次启动都泄露到日志
        if (!existing) console.log(`  初始密码: ${ADMIN_PASSWORD}（登录后请在设置中修改）`);
        console.log('========================================');
    });
})();
