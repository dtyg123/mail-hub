const bcrypt = require('bcryptjs');
const db = require('./db');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const express = require('express');
const path = require('path');
const mail = require('./mail');
const crypto = require('crypto');
const { encrypt, decrypt, isSeeded } = require('./secret');

const JWT_SECRET = process.env.JWT_SECRET || 'sms-code-web-secret-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: '尝试次数过多，请15分钟后再试' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: '请求过于频繁' } });

function generateToken(username) {
    return jwt.sign({ username, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
    try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '未授权' });
    const user = verifyToken(authHeader.slice(7));
    if (!user) return res.status(401).json({ error: 'Token无效或已过期' });
    req.user = user;
    next();
}

function publicAccount(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        imap_host: row.imap_host,
        imap_port: row.imap_port,
        imap_secure: !!row.imap_secure,
        username: row.username,
        color: row.color || '#6366f1',
        is_active: !!row.is_active,
        has_password: !!row.password,
        created_at: row.created_at
    };
}

/** 取出账号并解密密码（旧数据自动升级为种子加密） */
function privateAccount(id) {
    const row = db.get('SELECT * FROM email_accounts WHERE id = ?', [id]);
    if (!row) return null;
    const password = decrypt(row.password);
    if (password && row.password && !isSeeded(row.password)) {
        try {
            db.run('UPDATE email_accounts SET password = ? WHERE id = ?', [encrypt(password), id]);
        } catch { /* 升级失败不影响读取 */ }
    }
    return { ...row, password };
}

/** 恒定时间比较，避免通过响应耗时逐字猜答案 */
function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
    const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
    return crypto.timingSafeEqual(ha, hb);
}

function handleImapError(res, err) {
    const msg = String(err && err.message ? err.message : err);
    let friendly = msg;
    if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed|AUTHENTICATE failed/i.test(msg)) {
        friendly = '登录失败：邮箱地址或授权码不正确（多数邮箱需使用「授权码」而非登录密码）';
    } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
        friendly = '无法解析 IMAP 服务器地址，请检查服务器填写是否正确';
    } else if (/ETIMEDOUT|timeout|ECONNREFUSED|ECONNRESET/i.test(msg)) {
        friendly = '连接 IMAP 服务器超时或被拒绝，请检查地址、端口与网络';
    } else if (/certificate|self signed|SSL|TLS/i.test(msg)) {
        friendly = 'TLS/SSL 握手失败，请确认端口与加密方式是否匹配';
    }
    console.error('[IMAP]', msg);
    res.status(502).json({ error: friendly });
}

function setupRoutes(app) {
    app.use(express.static(path.join(__dirname, '..', 'client')));

    // ===== 认证 =====
    // 登录页用（无需鉴权）：只返回标签，绝不返回答案
    app.get('/api/auth/fields', (req, res) => {
        res.json(db.getAll('SELECT id, label FROM auth_fields ORDER BY sort_order ASC, id ASC'));
    });

    app.post('/api/login', loginLimiter, (req, res) => {
        const { password, answers } = req.body || {};
        const fields = db.getAll('SELECT * FROM auth_fields ORDER BY sort_order ASC, id ASC');

        if (!password) return res.status(400).json({ error: '需要密码' });
        if (fields.length && (!Array.isArray(answers) || answers.length !== fields.length)) {
            db.run('INSERT INTO login_logs(username, ip, success) VALUES (?, ?, ?)', ['admin', req.ip, 0]);
            return res.status(401).json({ error: `请填写全部 ${fields.length} 项验证信息` });
        }

        const stored = db.get('SELECT value FROM config WHERE key = ?', ['admin_hash']);
        // 密码与所有验证项全部判定后再给结果，耗时不随哪一项答错而变化
        let passOk = !!stored && bcrypt.compareSync(password, stored.value);
        let fieldsOk = true;
        for (const field of fields) {
            const answer = answers.find(a => Number(a.id) === Number(field.id));
            const right = decrypt(field.value);
            if (!answer || !right || !safeEqual(String(answer.value ?? ''), right)) fieldsOk = false;
        }

        if (!passOk || !fieldsOk) {
            db.run('INSERT INTO login_logs(username, ip, success) VALUES (?, ?, ?)', ['admin', req.ip, 0]);
            return res.status(401).json({ error: '登录信息不正确' });
        }

        db.run('INSERT INTO login_logs(username, ip, success) VALUES (?, ?, ?)', ['admin', req.ip, 1]);
        res.json({ token: generateToken('admin'), message: '登录成功' });
    });

    // 自定义登录验证项管理（需鉴权）
    app.get('/api/auth/fields/manage', authMiddleware, (req, res) => {
        const rows = db.getAll('SELECT * FROM auth_fields ORDER BY sort_order ASC, id ASC');
        res.json(rows.map(r => ({ id: r.id, label: r.label, value: decrypt(r.value), created_at: r.created_at })));
    });

    app.post('/api/auth/fields', authMiddleware, (req, res) => {
        const label = String(req.body?.label || '').trim();
        const value = String(req.body?.value ?? '');
        if (!label || !value) return res.status(400).json({ error: '名称和答案都不能为空' });
        if (label.length > 30) return res.status(400).json({ error: '名称最多 30 个字' });
        if (value.length > 64) return res.status(400).json({ error: '答案最多 64 个字符' });
        const dup = db.get('SELECT id FROM auth_fields WHERE label = ?', [label]);
        if (dup) return res.status(400).json({ error: '已存在同名验证项' });
        db.run('INSERT INTO auth_fields(label, value) VALUES (?, ?)', [label, encrypt(value)]);
        res.json({ success: true, id: db.getLastInsertRowId() });
    });

    app.put('/api/auth/fields/:id', authMiddleware, (req, res) => {
        const id = Number(req.params.id);
        const row = db.get('SELECT * FROM auth_fields WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: '验证项不存在' });
        const label = req.body?.label !== undefined ? String(req.body.label).trim() : row.label;
        const value = req.body?.value !== undefined && String(req.body.value).length
            ? String(req.body.value) : decrypt(row.value);
        if (!label || !value) return res.status(400).json({ error: '名称和答案都不能为空' });
        db.run('UPDATE auth_fields SET label = ?, value = ? WHERE id = ?', [label, encrypt(value), id]);
        res.json({ success: true });
    });

    app.delete('/api/auth/fields/:id', authMiddleware, (req, res) => {
        db.run('DELETE FROM auth_fields WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    });

    app.get('/api/me', authMiddleware, (req, res) => res.json({ username: req.user.username }));

    app.post('/api/change-password', authMiddleware, (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) return res.status(400).json({ error: '需要新旧密码' });
        if (newPassword.length < 4) return res.status(400).json({ error: '新密码至少4位' });
        const stored = db.get('SELECT value FROM config WHERE key = ?', ['admin_hash']);
        if (!bcrypt.compareSync(oldPassword, stored.value)) return res.status(401).json({ error: '旧密码错误' });
        db.run('UPDATE config SET value = ? WHERE key = ?', [bcrypt.hashSync(newPassword, 10), 'admin_hash']);
        res.json({ message: '密码已修改' });
    });

    // ===== 邮箱账号 =====
    app.get('/api/accounts', authMiddleware, (req, res) => {
        const rows = db.getAll('SELECT * FROM email_accounts ORDER BY sort_order ASC, id ASC');
        res.json(rows.map(publicAccount));
    });

    app.post('/api/accounts', authMiddleware, async (req, res) => {
        const { name, email, imap_host, imap_port, imap_secure, username, password, color } = req.body || {};
        if (!email || !imap_host) return res.status(400).json({ error: '邮箱地址、IMAP 服务器为必填项' });
        if (!password) return res.status(400).json({ error: '请填写密码或授权码' });

        const row = {
            name: (name || email).trim(),
            email: email.trim(),
            imap_host: imap_host.trim(),
            imap_port: Number(imap_port) || 993,
            imap_secure: imap_secure === false || imap_secure === 0 ? 0 : 1,
            username: (username || email).trim(),
            color: color || '#6366f1'
        };

        // 可选：保存前先验证
        if (req.body.verify) {
            try {
                await mail.testConnection({ ...row, password });
            } catch (err) {
                return handleImapError(res, err);
            }
        }

        db.run(
            `INSERT INTO email_accounts(name, email, imap_host, imap_port, imap_secure, username, password, color)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.name, row.email, row.imap_host, row.imap_port, row.imap_secure, row.username, encrypt(password), row.color]
        );
        res.json({ success: true, account: publicAccount(privateAccount(db.getLastInsertRowId())) });
    });

    app.put('/api/accounts/:id', authMiddleware, async (req, res) => {
        const id = Number(req.params.id);
        const current = privateAccount(id);
        const raw = db.get('SELECT password FROM email_accounts WHERE id = ?', [id]);
        if (!current || !raw) return res.status(404).json({ error: '账号不存在' });

        const { name, email, imap_host, imap_port, imap_secure, username, password, color } = req.body || {};

        const next = {
            name: name !== undefined ? String(name).trim() : current.name,
            email: email !== undefined ? String(email).trim() : current.email,
            imap_host: imap_host !== undefined ? String(imap_host).trim() : current.imap_host,
            imap_port: imap_port !== undefined ? (Number(imap_port) || 993) : current.imap_port,
            imap_secure: imap_secure !== undefined ? (imap_secure === false || imap_secure === 0 ? 0 : 1) : current.imap_secure,
            username: username !== undefined ? String(username).trim() : current.username,
            color: color !== undefined ? color : current.color,
            password: password ? String(password) : current.password
        };

        if (req.body.verify) {
            try {
                await mail.testConnection(next);
            } catch (err) {
                return handleImapError(res, err);
            }
        }

        db.run(
            `UPDATE email_accounts SET name=?, email=?, imap_host=?, imap_port=?, imap_secure=?, username=?, password=?, color=?
             WHERE id=?`,
            [next.name, next.email, next.imap_host, next.imap_port, next.imap_secure, next.username,
                password ? encrypt(next.password) : raw.password, next.color, id]
        );
        mail.dropClient(id);
        res.json({ success: true, account: publicAccount(privateAccount(id)) });
    });

    app.delete('/api/accounts/:id', authMiddleware, (req, res) => {
        const id = Number(req.params.id);
        mail.dropClient(id);
        db.run('DELETE FROM email_accounts WHERE id = ?', [id]);
        res.json({ success: true });
    });

    app.post('/api/accounts/:id/test', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        try {
            const result = await mail.testConnection(account);
            res.json({ success: true, ...result });
        } catch (err) {
            handleImapError(res, err);
        }
    });

    // ===== 邮件 =====
    app.get('/api/accounts/:id/folders', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        try {
            res.json(await mail.listFolders(account));
        } catch (err) {
            handleImapError(res, err);
        }
    });

    app.get('/api/accounts/:id/messages', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        const folder = req.query.folder || 'INBOX';
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
        try {
            const data = await mail.listMessages(account, { folder, page, limit });
            res.json(data);
        } catch (err) {
            handleImapError(res, err);
        }
    });

    app.get('/api/accounts/:id/messages/:uid', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        const folder = req.query.folder || 'INBOX';
        try {
            const msg = await mail.getMessage(account, { folder, uid: req.params.uid });
            if (!msg) return res.status(404).json({ error: '邮件不存在' });
            res.json(msg);
        } catch (err) {
            handleImapError(res, err);
        }
    });

    app.post('/api/accounts/:id/messages/:uid/seen', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        try {
            await mail.setSeen(account, {
                folder: req.body?.folder || 'INBOX',
                uid: req.params.uid,
                seen: req.body?.seen !== false
            });
            res.json({ success: true });
        } catch (err) {
            handleImapError(res, err);
        }
    });

    app.delete('/api/accounts/:id/messages/:uid', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        try {
            await mail.deleteMessage(account, { folder: req.query.folder || 'INBOX', uid: req.params.uid });
            res.json({ success: true });
        } catch (err) {
            handleImapError(res, err);
        }
    });

    app.get('/api/accounts/:id/messages/:uid/attachments/:index', authMiddleware, async (req, res) => {
        const account = privateAccount(Number(req.params.id));
        if (!account) return res.status(404).json({ error: '账号不存在' });
        try {
            const att = await mail.getAttachment(account, {
                folder: req.query.folder || 'INBOX',
                uid: req.params.uid,
                index: req.params.index
            });
            if (!att) return res.status(404).json({ error: '附件不存在' });
            const encoded = encodeURIComponent(att.filename);
            res.setHeader('Content-Type', att.contentType);
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
            res.send(att.content);
        } catch (err) {
            handleImapError(res, err);
        }
    });

    // ===== TOTP =====
    app.post('/api/totp', authMiddleware, (req, res) => {
        const { name, secret, issuer, digits = 6, period = 30, algorithm = 'SHA1' } = req.body;
        if (!name || !secret) return res.status(400).json({ error: '需要名称和密钥' });
        db.run('INSERT INTO totp_secrets(name, secret, issuer, digits, period, algorithm) VALUES (?, ?, ?, ?, ?, ?)',
            [name, encrypt(secret.toUpperCase().replace(/\s/g, '')), issuer || '', digits, period, algorithm]);
        res.json({ success: true, id: db.getLastInsertRowId() });
    });

    app.get('/api/totp', authMiddleware, (req, res) => {
        const rows = db.getAll('SELECT * FROM totp_secrets ORDER BY created_at DESC');
        res.json(rows.map(r => {
            const secret = decrypt(r.secret);
            // 旧数据懒升级为种子加密
            if (r.secret && !isSeeded(r.secret)) {
                try { db.run('UPDATE totp_secrets SET secret = ? WHERE id = ?', [encrypt(secret), r.id]); } catch { }
            }
            return { ...r, secret };
        }));
    });

    app.delete('/api/totp/:id', authMiddleware, (req, res) => {
        db.run('DELETE FROM totp_secrets WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    });

    app.put('/api/totp/:id/toggle', authMiddleware, (req, res) => {
        const secret = db.get('SELECT is_active FROM totp_secrets WHERE id = ?', [req.params.id]);
        if (!secret) return res.status(404).json({ error: '不存在' });
        db.run('UPDATE totp_secrets SET is_active = ? WHERE id = ?', [secret.is_active ? 0 : 1, req.params.id]);
        res.json({ success: true });
    });

    app.post('/api/totp/import', authMiddleware, (req, res) => {
        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: '没有数据' });
        let imported = 0;
        for (const e of entries) {
            const { name, secret, issuer, digits, period } = e;
            if (!name || !secret) continue;
            db.run('INSERT INTO totp_secrets(name, secret, issuer, digits, period) VALUES (?, ?, ?, ?, ?)',
                [name, encrypt(secret.toUpperCase().replace(/\s/g, '')), issuer || '', digits || 6, period || 30]);
            imported++;
        }
        res.json({ success: true, imported, total: entries.length });
    });

    // ===== 健康检查 =====
    app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '2.0.0' }));

    // SPA 回退
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
    });
}

module.exports = { setupRoutes, authMiddleware };
