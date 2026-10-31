/**
 * IMAP 邮箱读取模块
 * 连接按账号复用，空闲 5 分钟后自动断开
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const IDLE_MS = 5 * 60 * 1000;
const clients = new Map(); // accountId -> { client, timer }

function makeClient(account) {
    return new ImapFlow({
        host: account.imap_host,
        port: Number(account.imap_port) || 993,
        secure: !!account.imap_secure,
        auth: {
            user: account.username || account.email,
            pass: account.password
        },
        logger: false,
        tls: { rejectUnauthorized: false },
        socketTimeout: 30000,
        greetingTimeout: 15000,
        connectionTimeout: 15000
    });
}

async function getClient(account) {
    const key = account.id;
    const entry = clients.get(key);
    if (entry && entry.client && entry.client.usable) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => closeClient(key), IDLE_MS);
        entry.timer.unref?.();
        return entry.client;
    }
    if (entry) closeClient(key);

    const client = makeClient(account);
    await client.connect();
    const timer = setTimeout(() => closeClient(key), IDLE_MS);
    timer.unref?.();
    clients.set(key, { client, timer });
    return client;
}

function closeClient(key) {
    const entry = clients.get(key);
    if (!entry) return;
    clients.delete(key);
    clearTimeout(entry.timer);
    try { entry.client.logout(); } catch { /* ignore */ }
}

function dropClient(key) { closeClient(key); }

/** 测试连接 */
async function testConnection(account) {
    const client = makeClient(account);
    try {
        await client.connect();
        const mailboxes = await client.list();
        const inbox = mailboxes.find(m => (m.path || '').toUpperCase() === 'INBOX');
        let total = 0;
        if (inbox) {
            const lock = await client.getMailboxLock('INBOX');
            try { total = client.mailbox.exists; } finally { lock.release(); }
        }
        return { ok: true, folders: mailboxes.length, inboxTotal: total };
    } finally {
        try { await client.logout(); } catch { /* ignore */ }
    }
}

/** 文件夹列表 */
async function listFolders(account) {
    const client = await getClient(account);
    const list = await client.list();
    const special = client.listSpecialUseFlags ? null : null;
    return list
        .filter(m => m.path)
        .map(m => ({
            path: m.path,
            name: m.name || m.path,
            delimiter: m.delimiter,
            specialUse: m.specialUse || null,
            flags: m.flags ? Array.from(m.flags) : []
        }))
        .sort((a, b) => {
            const rank = p => (p === 'INBOX' ? 0 : p.toUpperCase().startsWith('INBOX') ? 1 : 2);
            const d = rank(a.path) - rank(b.path);
            return d !== 0 ? d : a.path.localeCompare(b.path, 'zh-CN');
        });
}

function parseAddressList(list) {
    if (!list || !list.length) return [];
    return list.map(a => ({
        name: a.name || '',
        address: a.address || ''
    })).filter(a => a.address || a.name);
}

/** 邮件列表（分页，最新在前） */
async function listMessages(account, { folder = 'INBOX', page = 1, limit = 30 } = {}) {
    const client = await getClient(account);
    const lock = await client.getMailboxLock(folder);
    try {
        const total = client.mailbox.exists || 0;
        if (!total) return { total: 0, page, limit, messages: [] };

        const end = total - (page - 1) * limit;
        const start = Math.max(1, end - limit + 1);
        if (end < 1) return { total, page, limit, messages: [] };

        const messages = [];
        for await (const msg of client.fetch(`${start}:${end}`, {
            envelope: true,
            flags: true,
            size: true,
            uid: true,
            bodyStructure: true
        }, { uid: false })) {
            const env = msg.envelope || {};
            const flags = msg.flags ? Array.from(msg.flags) : [];
            messages.push({
                uid: msg.uid,
                seq: msg.seq,
                subject: env.subject || '(无主题)',
                from: parseAddressList(env.from),
                to: parseAddressList(env.to),
                date: env.date ? new Date(env.date).toISOString() : null,
                size: msg.size || 0,
                seen: flags.includes('\\Seen'),
                flagged: flags.includes('\\Flagged'),
                hasAttachments: hasAttachmentParts(msg.bodyStructure)
            });
        }
        messages.reverse();
        return { total, page, limit, messages };
    } finally {
        lock.release();
    }
}

function hasAttachmentParts(node) {
    if (!node) return false;
    if (node.disposition === 'attachment') return true;
    if (Array.isArray(node.childNodes)) return node.childNodes.some(hasAttachmentParts);
    return false;
}

function collectAttachments(node, out = []) {
    if (!node) return out;
    if (node.disposition === 'attachment' || (node.disposition === 'inline' && node.dispositionParameters?.filename)) {
        out.push({
            part: node.part,
            filename: node.dispositionParameters?.filename || node.parameters?.name || `附件${out.length + 1}`,
            size: node.size || 0,
            type: node.type || 'application/octet-stream'
        });
    }
    if (Array.isArray(node.childNodes)) node.childNodes.forEach(n => collectAttachments(n, out));
    return out;
}

/** 邮件详情 */
async function getMessage(account, { folder = 'INBOX', uid }) {
    const client = await getClient(account);
    const lock = await client.getMailboxLock(folder);
    try {
        const msg = await client.fetchOne(String(uid), {
            envelope: true,
            flags: true,
            source: true,
            bodyStructure: true,
            size: true
        }, { uid: true });

        if (!msg) return null;

        const env = msg.envelope || {};
        const parsed = await simpleParser(msg.source);
        const flags = msg.flags ? Array.from(msg.flags) : [];

        return {
            uid: Number(uid),
            subject: env.subject || parsed.subject || '(无主题)',
            from: parseAddressList(env.from),
            to: parseAddressList(env.to),
            cc: parseAddressList(env.cc),
            date: env.date ? new Date(env.date).toISOString() : (parsed.date ? parsed.date.toISOString() : null),
            seen: flags.includes('\\Seen'),
            flagged: flags.includes('\\Flagged'),
            size: msg.size || 0,
            text: parsed.text || '',
            html: parsed.html || '',
            messageId: parsed.messageId || '',
            attachments: (parsed.attachments || []).map((a, i) => ({
                index: i,
                filename: a.filename || `附件${i + 1}`,
                size: a.size || 0,
                contentType: a.contentType || 'application/octet-stream'
            }))
        };
    } finally {
        lock.release();
    }
}

/** 下载附件 */
async function getAttachment(account, { folder = 'INBOX', uid, index }) {
    const client = await getClient(account);
    const lock = await client.getMailboxLock(folder);
    try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) return null;
        const parsed = await simpleParser(msg.source);
        const att = (parsed.attachments || [])[Number(index)];
        if (!att) return null;
        return {
            filename: att.filename || `attachment-${index}`,
            contentType: att.contentType || 'application/octet-stream',
            content: att.content
        };
    } finally {
        lock.release();
    }
}

/** 标记已读/未读 */
async function setSeen(account, { folder = 'INBOX', uid, seen = true }) {
    const client = await getClient(account);
    const lock = await client.getMailboxLock(folder);
    try {
        if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
        return true;
    } finally {
        lock.release();
    }
}

/** 删除邮件 */
async function deleteMessage(account, { folder = 'INBOX', uid }) {
    const client = await getClient(account);
    const lock = await client.getMailboxLock(folder);
    try {
        await client.messageDelete(String(uid), { uid: true });
        return true;
    } finally {
        lock.release();
    }
}

module.exports = {
    testConnection,
    listFolders,
    listMessages,
    getMessage,
    getAttachment,
    setSeen,
    deleteMessage,
    dropClient
};
