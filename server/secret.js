/**
 * 敏感数据加解密（AES-256-GCM）
 *
 * 密钥派生链：
 *   server/seed.php（首次启动自动生成的随机种子，PHP 语法）
 *        └─ sha256() ─→ 256 位 AES 密钥
 *
 * 说明：
 *  - 种子文件用 PHP 语法书写：即使被当成静态文件下载也只会看到源码，
 *    被 PHP 解释器执行时只是 return 一个字符串，不输出任何内容。
 *  - 旧数据使用 v1 前缀（由 JWT_SECRET 派生），仍可解密，读取时自动升级为 v2。
 *  - 删除 seed.php 会导致已用 v2 加密的数据无法恢复 —— 请勿删除。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 容器部署（雨云云应用）时通过 SEED_PATH 指向持久化卷，如 /data/seed.php
const SEED_PATH = process.env.SEED_PATH || path.join(__dirname, 'seed.php');

const SEED_TEMPLATE = `<?php
/**
 * 邮箱聚合中心 · 数据加密种子
 * 由程序在首次启动时自动生成 —— 请勿修改、备份到安全位置
 * 删除本文件将导致已加密数据（邮箱授权码、动态令牌密钥）永久无法解密
 */
return '%s';
`;

function loadSeed() {
    if (fs.existsSync(SEED_PATH)) {
        try {
            const text = fs.readFileSync(SEED_PATH, 'utf8');
            const m = text.match(/return\s+'([A-Za-z0-9+/=]+)'/);
            if (m && m[1].length >= 32) return m[1];
            console.error('[seed] seed.php 格式异常，无法读取种子');
        } catch (e) {
            console.error('[seed] 读取 seed.php 失败:', e.message);
        }
    }

    // 首次启动：生成 256 位随机种子并写入 PHP 文件
    const seed = crypto.randomBytes(32).toString('base64');
    fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true });
    fs.writeFileSync(SEED_PATH, SEED_TEMPLATE.replace('%s', seed), { flag: 'wx', mode: 0o600 });
    console.log('[seed] 已生成种子文件:', SEED_PATH);
    return seed;
}

const SEED = loadSeed();

/** 新密钥：由 seed.php 派生 */
const KEY_V2 = crypto.createHash('sha256').update('mailhub:' + SEED).digest();
/** 旧密钥：由 JWT_SECRET 派生（兼容历史数据） */
const KEY_V1 = crypto.createHash('sha256')
    .update(process.env.JWT_SECRET || 'sms-code-web-secret-change-in-production')
    .digest();

function cipher(version, key, plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return `${version}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decipher(key, payload) {
    const [, ivB64, tagB64, dataB64] = payload.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
}

/** 加密（始终使用新种子密钥） */
function encrypt(plain) {
    if (plain === null || plain === undefined) return '';
    return cipher('v2', KEY_V2, plain);
}

/** 解密：按前缀选择密钥，无法解密返回 '' */
function decrypt(payload) {
    if (!payload) return '';
    if (payload.startsWith('v2:')) {
        try { return decipher(KEY_V2, payload); } catch { return ''; }
    }
    if (payload.startsWith('v1:')) {
        try { return decipher(KEY_V1, payload); } catch { return ''; }
    }
    return payload; // 历史明文数据
}

/** 是否已经是新种子加密的数据 */
function isSeeded(payload) {
    return typeof payload === 'string' && payload.startsWith('v2:');
}

/** 懒迁移：旧格式读出来后重新用种子加密并返回 */
function upgrade(payload) {
    if (!payload || isSeeded(payload)) return payload;
    const plain = decrypt(payload);
    return plain ? encrypt(plain) : payload;
}

module.exports = { encrypt, decrypt, isSeeded, upgrade, SEED_PATH };
