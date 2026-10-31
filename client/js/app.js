/**
 * 邮箱验证工作台 MailVault — 前端主逻辑
 */
const API = window.location.origin;
const LS_TOKEN = 'mailhub_token';
const LS_THEME = 'mailhub_theme';

const state = {
    token: localStorage.getItem(LS_TOKEN) || null,
    accounts: [],
    account: null,          // 当前选中账号
    folders: [],
    folder: 'INBOX',
    messages: [],
    page: 1,
    total: 0,
    loading: false,
    currentMsg: null,
    search: '',
    editingAccountId: null,
    editingColor: '#6366f1',
    loginFields: [],
    totp: [],
    totpTimer: null
};

const $ = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ============ 基础工具 ============ */

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function toast(message, type = '') {
    const box = $('toast');
    box.textContent = message;
    box.className = 'toast show ' + type;
    clearTimeout(box._t);
    box._t = setTimeout(() => { box.className = 'toast ' + type; }, 2400);
}

function formatBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toTimeString().slice(0, 5);
    if (d.getFullYear() === now.getFullYear()) {
        return `${d.getMonth() + 1}月${d.getDate()}日`;
    }
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatFullDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initials(name) {
    const s = String(name || '?').trim();
    if (!s) return '?';
    const m = s.match(/[\u4e00-\u9fa5]/);
    if (m) return s.slice(0, 1);
    return s.slice(0, 1).toUpperCase();
}

/* ============ API ============ */

async function api(path, options = {}) {
    const res = await fetch(API + path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
            ...(options.headers || {})
        }
    });
    if (res.status === 401) {
        logout();
        throw new Error('登录已过期');
    }
    let data = null;
    const text = await res.text();
    if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!res.ok) throw new Error((data && data.error) || `请求失败 (${res.status})`);
    return data;
}

/* ============ 主题 ============ */

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e1014' : '#f4f5f8');
}

function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

/* ============ 登录 ============ */

/** 登录页动态渲染验证项输入框 */
async function loadLoginFields() {
    const box = $('login-extra');
    try {
        const fields = await fetch(API + '/api/auth/fields').then(r => r.json());
        state.loginFields = Array.isArray(fields) ? fields : [];
    } catch {
        state.loginFields = [];
    }
    box.innerHTML = state.loginFields.map(f => `
        <div class="field">
            <input data-af-id="${f.id}" placeholder="${escapeHtml(f.label)}"
                   autocomplete="off" maxlength="64">
        </div>`).join('');
}

async function login(password) {
    const btn = $('login-btn');
    const err = $('login-error');
    btn.disabled = true;
    btn.textContent = '登录中…';
    err.textContent = '';
    try {
        const answers = els('#login-extra [data-af-id]').map(input => ({
            id: Number(input.dataset.afId),
            value: input.value
        }));
        const res = await fetch(API + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, answers })
        });
        const data = await res.json();
        if (!res.ok || !data.token) {
            err.textContent = data.error || '登录失败';
            return;
        }
        state.token = data.token;
        localStorage.setItem(LS_TOKEN, data.token);
        enterApp();
    } catch (e) {
        err.textContent = '网络错误，无法连接服务器';
    } finally {
        btn.disabled = false;
        btn.textContent = '登 录';
    }
}

function logout() {
    state.token = null;
    localStorage.removeItem(LS_TOKEN);
    if (state.totpTimer) clearInterval(state.totpTimer);
    $('main-page').classList.remove('active');
    $('login-page').classList.add('active');
    $('password-input').value = '';
    loadLoginFields();
}

function enterApp() {
    $('login-page').classList.remove('active');
    $('main-page').classList.add('active');
    loadAccounts();
    loadTOTP();
}

/* ============ 弹窗 ============ */

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

/* ============ 账号 ============ */

async function loadAccounts() {
    try {
        state.accounts = await api('/api/accounts');
        renderAccounts();
        renderSettingsAccounts();
        if (state.accounts.length) {
            const keep = state.account && state.accounts.find(a => a.id === state.account.id);
            if (keep) {
                state.account = keep;
                renderAccounts();
            } else {
                selectAccount(state.accounts[0]);
            }
        } else {
            state.account = null;
            renderFolders([]);
            renderMessages([]);
            $('list-title').textContent = '收件箱';
            $('list-subtitle').textContent = '请先添加邮箱账号';
            $('msg-list').innerHTML = `
                <div class="empty-state">
                    <div class="empty-emoji">📮</div>
                    <p class="empty-title">还没有邮箱账号</p>
                    <p class="empty-desc">添加 QQ / 163 / Gmail / Outlook 等任意 IMAP 邮箱</p>
                    <button class="btn btn-primary btn-sm" onclick="openAccountModal()">添加邮箱</button>
                </div>`;
        }
    } catch (e) {
        toast(e.message, 'error');
    }
}

function renderAccounts() {
    const list = $('account-list');
    if (!state.accounts.length) {
        list.innerHTML = `<div class="empty-desc" style="padding:6px 10px">暂无账号</div>`;
        return;
    }
    list.innerHTML = state.accounts.map(a => `
        <button class="account-item ${state.account && state.account.id === a.id ? 'active' : ''}" data-id="${a.id}">
            <span class="account-avatar" style="background:${escapeHtml(a.color)}">${escapeHtml(initials(a.name || a.email))}</span>
            <span class="account-text">
                <span class="account-name">${escapeHtml(a.name)}</span>
                <span class="account-mail">${escapeHtml(a.email)}</span>
            </span>
        </button>
    `).join('');
    els('.account-item', list).forEach(btn => {
        btn.addEventListener('click', () => {
            const acc = state.accounts.find(a => a.id === Number(btn.dataset.id));
            if (acc) selectAccount(acc);
            $('sidebar').classList.remove('show');
        });
    });
}

async function selectAccount(account) {
    state.account = account;
    state.folder = 'INBOX';
    state.currentMsg = null;
    state.search = '';
    $('search-input').value = '';
    renderAccounts();
    showReaderEmpty();
    $('list-title').textContent = '收件箱';
    $('list-subtitle').textContent = account.email;
    await loadFolders();
    await loadMessages(1);
}

async function loadFolders() {
    if (!state.account) return;
    try {
        state.folders = await api(`/api/accounts/${state.account.id}/folders`);
    } catch (e) {
        state.folders = [{ path: 'INBOX', name: '收件箱' }];
        toast(e.message, 'error');
    }
    renderFolders(state.folders);
}

function folderIcon(path) {
    const p = String(path || '').toUpperCase();
    if (p === 'INBOX') return '📥';
    if (p.includes('SENT') || p.includes('已发送')) return '📤';
    if (p.includes('DRAFT') || p.includes('草稿')) return '📝';
    if (p.includes('TRASH') || p.includes('DELETED') || p.includes('已删除')) return '🗑';
    if (p.includes('JUNK') || p.includes('SPAM') || p.includes('垃圾')) return '⚠';
    if (p.includes('ARCHIVE') || p.includes('归档')) return '🗄';
    return '📁';
}

function folderLabel(f) {
    const p = String(f.path || '').toUpperCase();
    const map = {
        'INBOX': '收件箱',
        'SENT': '已发送', 'SENT ITEMS': '已发送', 'SENT MESSAGES': '已发送',
        'DRAFTS': '草稿箱', 'TRASH': '垃圾箱', 'DELETED': '已删除', 'DELETED ITEMS': '已删除',
        'JUNK': '垃圾邮件', 'SPAM': '垃圾邮件', 'JUNK E-MAIL': '垃圾邮件',
        'ARCHIVE': '归档', 'ALL MAIL': '所有邮件'
    };
    return map[p] || f.name || f.path;
}

function renderFolders(folders) {
    const list = $('folder-list');
    if (!folders.length) { list.innerHTML = ''; return; }
    list.innerHTML = folders.map(f => `
        <button class="folder-item ${state.folder === f.path ? 'active' : ''}" data-path="${escapeHtml(f.path)}">
            <span class="folder-icon">${folderIcon(f.path)}</span>
            <span class="folder-name">${escapeHtml(folderLabel(f))}</span>
        </button>
    `).join('');
    els('.folder-item', list).forEach(btn => {
        btn.addEventListener('click', () => {
            state.folder = btn.dataset.path;
            state.currentMsg = null;
            state.search = '';
            $('search-input').value = '';
            renderFolders(state.folders);
            const current = state.folders.find(f => f.path === state.folder);
            $('list-title').textContent = folderLabel(current || { path: state.folder });
            showReaderEmpty();
            loadMessages(1);
            $('sidebar').classList.remove('show');
        });
    });
}

/* ============ 邮件列表 ============ */

async function loadMessages(page = 1) {
    if (!state.account || state.loading) return;
    state.loading = true;
    if (page === 1) {
        $('msg-list').innerHTML = Array.from({ length: 6 }).map(() => `
            <div class="msg-item"><div class="msg-avatar" style="background:var(--surface-3)"></div>
            <div class="msg-main">
                <div class="side-skeleton" style="height:12px;margin:2px 0 8px"></div>
                <div class="side-skeleton" style="height:10px;width:70%"></div>
            </div></div>`).join('');
    }
    try {
        const data = await api(
            `/api/accounts/${state.account.id}/messages?folder=${encodeURIComponent(state.folder)}&page=${page}&limit=30`
        );
        state.total = data.total;
        state.page = page;
        state.messages = page === 1 ? data.messages : state.messages.concat(data.messages);
        renderMessages(state.messages);
        $('list-subtitle').textContent = `${folderLabel({ path: state.folder })} · 共 ${data.total} 封`;
        $('list-foot').style.display = state.messages.length < state.total ? 'block' : 'none';
    } catch (e) {
        $('msg-list').innerHTML = `
            <div class="empty-state">
                <div class="empty-emoji">⚠️</div>
                <p class="empty-title">读取失败</p>
                <p class="empty-desc">${escapeHtml(e.message)}</p>
                <button class="btn btn-ghost btn-sm" onclick="loadMessages(1)">重试</button>
            </div>`;
    } finally {
        state.loading = false;
    }
}

function renderMessages(messages) {
    const list = $('msg-list');
    const q = state.search.trim().toLowerCase();
    const filtered = q
        ? messages.filter(m =>
            (m.subject || '').toLowerCase().includes(q) ||
            (m.from || []).some(f => (f.name || '').toLowerCase().includes(q) || (f.address || '').toLowerCase().includes(q)))
        : messages;

    if (!filtered.length) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-emoji">${q ? '🔍' : '📭'}</div>
                <p class="empty-title">${q ? '没有匹配的邮件' : '这个文件夹是空的'}</p>
                <p class="empty-desc">${q ? '换个关键词试试' : '暂时没有收到邮件'}</p>
            </div>`;
        return;
    }

    const color = (state.account && state.account.color) || '#6366f1';
    list.innerHTML = filtered.map(m => {
        const from = (m.from && m.from[0]) || { name: '', address: '' };
        const name = from.name || from.address || '未知发件人';
        return `
        <div class="msg-item ${m.seen ? '' : 'unread'} ${state.currentMsg && state.currentMsg.uid === m.uid ? 'active' : ''}"
             data-uid="${m.uid}">
            <div class="msg-avatar" style="background:${escapeHtml(color)}">${escapeHtml(initials(name))}</div>
            <div class="msg-main">
                <div class="msg-top">
                    <span class="msg-from">${escapeHtml(name)}</span>
                    <span class="msg-date">${escapeHtml(formatDate(m.date))}</span>
                </div>
                <div class="msg-subject">${escapeHtml(m.subject)}</div>
                <div class="msg-snippet">${escapeHtml(from.address || '')}</div>
            </div>
            <div class="msg-flags">
                ${m.hasAttachments ? '<span title="含附件">📎</span>' : ''}
                ${m.seen ? '' : '<span class="unread-dot"></span>'}
            </div>
        </div>`;
    }).join('');

    els('.msg-item', list).forEach(item => {
        item.addEventListener('click', () => openMessage(Number(item.dataset.uid)));
    });
}

/* ============ 邮件详情 ============ */

function showReaderEmpty() {
    $('reader').hidden = true;
    $('reader-empty').style.display = 'flex';
    $('reader-pane').classList.remove('show');
}

async function openMessage(uid) {
    const msg = state.messages.find(m => m.uid === uid);
    if (!msg) return;
    state.currentMsg = msg;
    renderMessages(state.messages);
    $('reader-pane').classList.add('show');
    $('reader-empty').style.display = 'none';
    $('reader').hidden = false;
    $('reader-subject').textContent = msg.subject;
    $('reader-from-name').textContent = (msg.from[0] && (msg.from[0].name || msg.from[0].address)) || '未知';
    $('reader-from-addr').textContent = (msg.from[0] && msg.from[0].address) || '';
    $('reader-to').textContent = msg.to && msg.to.length
        ? '收件人：' + msg.to.map(t => t.address || t.name).join(', ')
        : '';
    $('reader-date').textContent = formatFullDate(msg.date);
    $('reader-avatar').textContent = initials((msg.from[0] && (msg.from[0].name || msg.from[0].address)) || '?');
    $('reader-avatar').style.background = (state.account && state.account.color) || '#6366f1';
    $('reader-body').innerHTML = '<div class="side-skeleton" style="height:140px"></div>';
    $('reader-attachments').hidden = true;

    if (!msg.seen) {
        api(`/api/accounts/${state.account.id}/messages/${uid}/seen`, {
            method: 'POST',
            body: JSON.stringify({ folder: state.folder, seen: true })
        }).then(() => { msg.seen = true; renderMessages(state.messages); }).catch(() => {});
    }

    try {
        const detail = await api(
            `/api/accounts/${state.account.id}/messages/${uid}?folder=${encodeURIComponent(state.folder)}`
        );
        state.currentMsg = { ...msg, ...detail };
        renderReaderBody(detail);
        renderAttachments(detail);
    } catch (e) {
        $('reader-body').innerHTML = `<p class="form-error">${escapeHtml(e.message)}</p>`;
    }
}

function sanitizeHtml(html) {
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
        .replace(/javascript:/gi, '');
}

function renderReaderBody(detail) {
    const body = $('reader-body');
    if (detail.html) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
            <base target="_blank">
            <style>
                html,body{margin:0;padding:0;background:#fff;color:#1f2430;
                    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
                    font-size:14.5px;line-height:1.75;word-break:break-word;}
                img{max-width:100% !important;height:auto !important;}
                table{max-width:100% !important;}
                a{color:#4f46e5;}
                body{overflow-x:hidden;}
            </style></head><body>${sanitizeHtml(detail.html)}</body></html>`;
        body.innerHTML = '';
        body.appendChild(frame);
        frame.addEventListener('load', () => {
            try {
                const h = frame.contentDocument.body.scrollHeight;
                if (h) frame.style.height = Math.min(Math.max(h + 24, 200), 4000) + 'px';
            } catch { frame.style.height = '70vh'; }
        });
    } else if (detail.text) {
        body.innerHTML = `<pre>${escapeHtml(detail.text)}</pre>`;
    } else {
        body.innerHTML = '<p class="muted">（这封邮件没有正文内容）</p>';
    }
    $('reader-pane').scrollTop = 0;
}

function renderAttachments(detail) {
    const box = $('reader-attachments');
    if (!detail.attachments || !detail.attachments.length) {
        box.hidden = true;
        box.innerHTML = '';
        return;
    }
    box.hidden = false;
    box.innerHTML = detail.attachments.map(a => `
        <a class="attachment" href="#" data-index="${a.index}">
            <span>📎</span>
            <span>${escapeHtml(a.filename)}</span>
            <span class="att-size">${formatBytes(a.size)}</span>
        </a>`).join('');
    els('.attachment', box).forEach(link => {
        link.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const index = link.dataset.index;
            try {
                const res = await fetch(
                    `${API}/api/accounts/${state.account.id}/messages/${detail.uid}/attachments/${index}?folder=${encodeURIComponent(state.folder)}`,
                    { headers: { Authorization: `Bearer ${state.token}` } }
                );
                if (!res.ok) throw new Error('附件下载失败');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = detail.attachments.find(x => String(x.index) === String(index))?.filename || 'attachment';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);
            } catch (e) {
                toast(e.message, 'error');
            }
        });
    });
}

async function markUnread() {
    if (!state.currentMsg) return;
    try {
        await api(`/api/accounts/${state.account.id}/messages/${state.currentMsg.uid}/seen`, {
            method: 'POST',
            body: JSON.stringify({ folder: state.folder, seen: false })
        });
        const m = state.messages.find(x => x.uid === state.currentMsg.uid);
        if (m) m.seen = false;
        renderMessages(state.messages);
        toast('已标为未读', 'ok');
        showReaderEmpty();
    } catch (e) { toast(e.message, 'error'); }
}

async function deleteMessage() {
    if (!state.currentMsg) return;
    if (!confirm('确定删除这封邮件吗？')) return;
    try {
        await api(`/api/accounts/${state.account.id}/messages/${state.currentMsg.uid}?folder=${encodeURIComponent(state.folder)}`, {
            method: 'DELETE'
        });
        state.messages = state.messages.filter(m => m.uid !== state.currentMsg.uid);
        state.total = Math.max(0, state.total - 1);
        state.currentMsg = null;
        renderMessages(state.messages);
        showReaderEmpty();
        toast('邮件已删除', 'ok');
    } catch (e) { toast(e.message, 'error'); }
}

/* ============ 账号弹窗 ============ */

function openAccountModal(account = null) {
    state.editingAccountId = account ? account.id : null;
    state.editingColor = account ? account.color : '#6366f1';
    $('account-modal-title').textContent = account ? '编辑邮箱' : '添加邮箱';
    $('acc-name').value = account ? account.name : '';
    $('acc-email').value = account ? account.email : '';
    $('acc-host').value = account ? account.imap_host : '';
    $('acc-port').value = account ? account.imap_port : 993;
    $('acc-secure').value = account ? (account.imap_secure ? '1' : '0') : '1';
    $('acc-username').value = account ? account.username : '';
    $('acc-password').value = '';
    $('acc-password').placeholder = account ? '留空表示不修改' : 'QQ/163 等需使用授权码';
    $('account-error').textContent = '';
    $('account-error').className = 'form-error';
    $('btn-save-account').disabled = false;
    $('btn-save-account').textContent = '保存';
    els('#preset-row .preset').forEach(b => b.classList.remove('active'));
    $('acc-hint').textContent = '';
    $('acc-hint').className = 'preset-hint';
    syncColorSwatches();
    openModal('account-modal');
    setTimeout(() => $('acc-email').focus(), 120);
}

const PRESETS = {
    qq: {
        host: 'imap.qq.com', port: 993, secure: true,
        hint: 'QQ邮箱：先到 mail.qq.com → 设置 → 账号与安全，开启「IMAP/SMTP 服务」，再生成 16 位授权码。密码框填授权码，不是 QQ 密码。'
    },
    163: {
        host: 'imap.163.com', port: 993, secure: true,
        hint: '163邮箱：网页版 设置 → POP3/SMTP/IMAP，开启 IMAP 服务并设置「客户端授权码」，密码框填授权码。'
    },
    126: {
        host: 'imap.126.com', port: 993, secure: true,
        hint: '126邮箱：网页版 设置 → POP3/SMTP/IMAP，开启 IMAP 服务并设置「客户端授权码」，密码框填授权码。'
    },
    gmail: {
        host: 'imap.gmail.com', port: 993, secure: true,
        hint: 'Gmail：开启两步验证后生成「应用专用密码」，并在 Gmail 设置中启用 IMAP。注意国内网络通常无法直连 imap.gmail.com。'
    },
    icloud: {
        host: 'imap.mail.me.com', port: 993, secure: true,
        hint: 'iCloud：在 appleid.apple.com → 登录与安全 → App 专用密码 生成密码，用户名填完整 Apple ID。'
    },
    custom: {
        hint: '手动填写 IMAP 服务器地址、端口与加密方式。注意：Outlook / Hotmail 已停用密码登录，暂不支持。'
    }
};

function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    els('#preset-row .preset').forEach(b => b.classList.toggle('active', b.dataset.preset === key));
    const hint = $('acc-hint');
    hint.textContent = p.hint || '';
    hint.className = 'preset-hint' + (p.warn ? ' warn' : '');
    if (p.host) {
        $('acc-host').value = p.host;
        $('acc-port').value = p.port;
        $('acc-secure').value = p.secure ? '1' : '0';
    }
}

function syncColorSwatches() {
    els('#color-row .swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === state.editingColor);
    });
}

async function saveAccount() {
    const payload = {
        name: $('acc-name').value.trim(),
        email: $('acc-email').value.trim(),
        imap_host: $('acc-host').value.trim(),
        imap_port: Number($('acc-port').value) || 993,
        imap_secure: $('acc-secure').value === '1',
        username: $('acc-username').value.trim(),
        password: $('acc-password').value,
        color: state.editingColor,
        verify: $('acc-verify').checked
    };
    const errBox = $('account-error');
    if (!payload.email || !payload.imap_host) {
        errBox.textContent = '邮箱地址和 IMAP 服务器为必填项';
        return;
    }
    if (!state.editingAccountId && !payload.password) {
        errBox.textContent = '请填写密码或授权码';
        return;
    }

    const btn = $('btn-save-account');
    btn.disabled = true;
    btn.textContent = payload.verify ? '正在验证…' : '保存中…';
    errBox.textContent = '';
    try {
        if (state.editingAccountId) {
            await api(`/api/accounts/${state.editingAccountId}`, {
                method: 'PUT', body: JSON.stringify(payload)
            });
        } else {
            await api('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
        }
        closeModal('account-modal');
        toast('已保存', 'ok');
        const savedId = state.editingAccountId;
        await loadAccounts();
        if (!savedId && state.accounts.length) {
            const newest = state.accounts[state.accounts.length - 1];
            selectAccount(newest);
        }
    } catch (e) {
        errBox.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = '保存';
    }
}

/* ============ 自定义登录验证项管理 ============ */

async function loadAuthFields() {
    const box = $('auth-fields-list');
    const msg = $('af-msg');
    msg.textContent = '';
    try {
        const fields = await api('/api/auth/fields/manage');
        if (!fields.length) {
            box.innerHTML = '<p class="muted small">还没有验证项，登录只需密码。添加后登录需要全部答对。</p>';
            return;
        }
        box.innerHTML = fields.map(f => `
            <div class="auth-field-row">
                <span class="grow">
                    <div>${escapeHtml(f.label)}</div>
                    <div class="mail">答案：${escapeHtml(f.value)}</div>
                </span>
                <button class="mini-btn" data-af-del="${f.id}" title="删除">🗑</button>
            </div>`).join('');
        els('[data-af-del]', box).forEach(b => b.addEventListener('click', async () => {
            if (!confirm('删除该验证项后，登录将不再需要回答它。确定删除吗？')) return;
            try {
                await api('/api/auth/fields/' + b.dataset.afDel, { method: 'DELETE' });
                toast('已删除', 'ok');
                loadAuthFields();
            } catch (e) {
                toast(e.message, 'error');
            }
        }));
    } catch (e) {
        box.innerHTML = `<p class="muted small">加载失败：${escapeHtml(e.message)}</p>`;
    }
}

async function addAuthField() {
    const label = $('af-label').value.trim();
    const value = $('af-value').value;
    const msg = $('af-msg');
    if (!label || !value) {
        msg.textContent = '名称和答案都不能为空';
        msg.className = 'form-error';
        return;
    }
    try {
        await api('/api/auth/fields', {
            method: 'POST',
            body: JSON.stringify({ label, value })
        });
        $('af-label').value = '';
        $('af-value').value = '';
        msg.textContent = '✓ 已添加，下次登录需回答该项';
        msg.className = 'form-error ok';
        loadAuthFields();
    } catch (e) {
        msg.textContent = e.message;
        msg.className = 'form-error';
    }
}

function renderSettingsAccounts() {
    const box = $('settings-accounts');
    if (!state.accounts.length) {
        box.innerHTML = '<p class="muted small">还没有添加邮箱</p>';
        return;
    }
    box.innerHTML = state.accounts.map(a => `
        <div class="settings-account">
            <span class="account-avatar" style="background:${escapeHtml(a.color)};width:26px;height:26px;flex-basis:26px;font-size:12px;border-radius:8px">${escapeHtml(initials(a.name || a.email))}</span>
            <span class="grow">
                <div>${escapeHtml(a.name)}</div>
                <div class="mail">${escapeHtml(a.email)} · ${escapeHtml(a.imap_host)}:${a.imap_port}</div>
            </span>
            <button class="mini-btn" data-test="${a.id}" title="测试连接">⟳</button>
            <button class="mini-btn" data-edit="${a.id}" title="编辑">✎</button>
            <button class="mini-btn" data-del="${a.id}" title="删除">🗑</button>
        </div>`).join('');

    els('[data-test]', box).forEach(b => b.addEventListener('click', async () => {
        b.textContent = '…';
        try {
            const r = await api(`/api/accounts/${b.dataset.test}/test`, { method: 'POST' });
            toast(`连接正常 · ${r.folders} 个文件夹 · 收件箱 ${r.inboxTotal} 封`, 'ok');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            b.textContent = '⟳';
        }
    }));
    els('[data-edit]', box).forEach(b => b.addEventListener('click', () => {
        const acc = state.accounts.find(a => a.id === Number(b.dataset.edit));
        if (acc) { closeModal('settings-modal'); openAccountModal(acc); }
    }));
    els('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
        const acc = state.accounts.find(a => a.id === Number(b.dataset.del));
        if (!acc || !confirm(`确定删除账号 ${acc.email} 吗？`)) return;
        try {
            await api(`/api/accounts/${acc.id}`, { method: 'DELETE' });
            if (state.account && state.account.id === acc.id) { state.account = null; state.messages = []; }
            await loadAccounts();
            toast('已删除', 'ok');
        } catch (e) { toast(e.message, 'error'); }
    }));
}

/* ============ TOTP ============ */

async function loadTOTP() {
    try {
        state.totp = await api('/api/totp');
        renderTOTP();
        $('totp-badge').textContent = state.totp.length;
        if (state.totpTimer) clearInterval(state.totpTimer);
        state.totpTimer = setInterval(updateTOTPCodes, 1000);
    } catch (e) {
        toast(e.message, 'error');
    }
}

function renderTOTP() {
    const list = $('totp-list');
    if (!state.totp.length) {
        list.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <div class="empty-emoji">🔑</div>
                <p class="empty-title">暂无动态令牌</p>
                <p class="empty-desc">支持 Google / GitHub / Steam 等任意 TOTP 服务</p>
                <button class="btn btn-primary btn-sm" onclick="openModal('totp-add-modal')">添加密钥</button>
            </div>`;
        return;
    }
    list.innerHTML = state.totp.map(t => `
        <div class="totp-card ${t.is_active ? '' : 'inactive'}" data-id="${t.id}">
            <div class="totp-tools">
                <button class="mini-btn" data-toggle="${t.id}" title="${t.is_active ? '停用' : '启用'}">${t.is_active ? '⏸' : '▶'}</button>
                <button class="mini-btn" data-del="${t.id}" title="删除">🗑</button>
            </div>
            <div class="totp-head">
                <span class="totp-name">${escapeHtml(t.name)}</span>
                ${t.issuer ? `<span class="totp-issuer">${escapeHtml(t.issuer)}</span>` : ''}
            </div>
            <div class="totp-code-row">
                <span class="totp-code" data-code="${t.id}" title="点击复制">------</span>
                <span class="totp-ring" data-ring="${t.id}" data-left="--" style="--p:100"></span>
            </div>
        </div>`).join('');

    els('[data-toggle]', list).forEach(b => b.addEventListener('click', async () => {
        try {
            await api(`/api/totp/${b.dataset.toggle}/toggle`, { method: 'PUT' });
            await loadTOTP();
        } catch (e) { toast(e.message, 'error'); }
    }));
    els('[data-del]', list).forEach(b => b.addEventListener('click', async () => {
        if (!confirm('确定删除这个密钥吗？')) return;
        try {
            await api(`/api/totp/${b.dataset.del}`, { method: 'DELETE' });
            await loadTOTP();
            toast('已删除', 'ok');
        } catch (e) { toast(e.message, 'error'); }
    }));
    els('.totp-code', list).forEach(codeEl => {
        codeEl.addEventListener('click', () => {
            const text = codeEl.textContent.replace(/\s/g, '');
            if (!/^\d+$/.test(text)) return;
            copyText(text).then(() => {
                codeEl.classList.add('copied');
                setTimeout(() => codeEl.classList.remove('copied'), 900);
                toast('验证码已复制', 'ok');
            });
        });
    });

    updateTOTPCodes();
}

async function updateTOTPCodes() {
    for (const t of state.totp) {
        if (!t.is_active) continue;
        const codeEl = document.querySelector(`[data-code="${t.id}"]`);
        const ringEl = document.querySelector(`[data-ring="${t.id}"]`);
        if (!codeEl) continue;
        try {
            const code = await TOTPGenerator.generate(t.secret, t.digits || 6, t.period || 30);
            if (!code) { codeEl.textContent = '密钥无效'; continue; }
            codeEl.textContent = code.replace(/(\d{3})(?=\d)/g, '$1 ');
            const remaining = TOTPGenerator.getRemaining(t.digits || 6, t.period || 30);
            const pct = (remaining / (t.period || 30)) * 100;
            if (ringEl) {
                ringEl.style.setProperty('--p', pct.toFixed(0));
                ringEl.dataset.left = remaining;
            }
        } catch {
            codeEl.textContent = '密钥无效';
        }
    }
}

async function addTOTP() {
    const name = $('totp-name').value.trim();
    const secret = $('totp-secret').value.trim().replace(/\s/g, '');
    const issuer = $('totp-issuer').value.trim();
    const digits = Number($('totp-digits').value) || 6;
    const period = Number($('totp-period').value) || 30;
    const err = $('totp-error');
    if (!name || !secret) { err.textContent = '名称和密钥为必填项'; return; }
    err.textContent = '';
    try {
        await api('/api/totp', { method: 'POST', body: JSON.stringify({ name, secret, issuer, digits, period }) });
        $('totp-name').value = '';
        $('totp-secret').value = '';
        $('totp-issuer').value = '';
        closeModal('totp-add-modal');
        await loadTOTP();
        toast('已添加', 'ok');
    } catch (e) { err.textContent = e.message; }
}

/* ============ 导入 ============ */

function parseOtpauth(text) {
    const entries = [];
    const lines = String(text).split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('otpauth://')) {
            try {
                const url = new URL(line);
                const secret = url.searchParams.get('secret');
                if (!secret) continue;
                let label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
                let issuer = url.searchParams.get('issuer') || '';
                let name = label;
                if (label.includes(':')) {
                    const [a, b] = label.split(':');
                    if (!issuer) issuer = a.trim();
                    name = (b || a).trim();
                }
                entries.push({
                    name,
                    secret,
                    issuer,
                    digits: Number(url.searchParams.get('digits')) || 6,
                    period: Number(url.searchParams.get('period')) || 30
                });
            } catch { /* 跳过非法行 */ }
        }
    }
    return entries;
}

function previewImport(text) {
    const entries = parseOtpauth(text);
    const box = $('import-preview');
    if (!entries.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<div class="muted small" style="margin-bottom:6px">识别到 ${entries.length} 个密钥</div>` +
        entries.map(e => `<div class="import-row">
            <span class="name">${escapeHtml(e.name)}</span>
            <span class="secret">${escapeHtml(e.secret.slice(0, 6))}…</span>
            ${e.issuer ? `<span class="muted small">${escapeHtml(e.issuer)}</span>` : ''}
        </div>`).join('');
}

async function doImport() {
    const entries = parseOtpauth($('import-textarea').value);
    if (!entries.length) { toast('没有识别到有效的 otpauth 链接', 'error'); return; }
    try {
        const r = await api('/api/totp/import', { method: 'POST', body: JSON.stringify({ entries }) });
        closeModal('import-modal');
        $('import-textarea').value = '';
        $('import-preview').hidden = true;
        await loadTOTP();
        toast(`成功导入 ${r.imported} 个密钥`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
}

/* ============ 剪贴板 ============ */

async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch { /* fallthrough */ }
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
}

/* ============ 事件绑定 ============ */

function bindEvents() {
    $('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        login($('password-input').value);
    });

    $('btn-logout').addEventListener('click', logout);
    $('btn-theme').addEventListener('click', toggleTheme);
    $('btn-settings').addEventListener('click', () => {
        renderSettingsAccounts();
        loadAuthFields();
        openModal('settings-modal');
    });
    $('btn-add-auth-field').addEventListener('click', addAuthField);
    $('btn-refresh').addEventListener('click', () => { if (state.account) loadMessages(1); });
    $('btn-add-account').addEventListener('click', () => openAccountModal());
    $('btn-add-account-2').addEventListener('click', () => openAccountModal());
    $('btn-save-account').addEventListener('click', saveAccount);
    $('btn-load-more').addEventListener('click', () => loadMessages(state.page + 1));

    $('btn-drawer').addEventListener('click', () => $('sidebar').classList.toggle('show'));
    $('btn-reader-back').addEventListener('click', showReaderEmpty);
    $('btn-mark-unread').addEventListener('click', markUnread);
    $('btn-delete-msg').addEventListener('click', deleteMessage);

    $('search-input').addEventListener('input', (e) => {
        state.search = e.target.value;
        renderMessages(state.messages);
    });

    $('btn-totp').addEventListener('click', () => { renderTOTP(); openModal('totp-modal'); });
    $('btn-totp-add').addEventListener('click', () => { openModal('totp-add-modal'); setTimeout(() => $('totp-name').focus(), 120); });
    $('btn-save-totp').addEventListener('click', addTOTP);
    $('btn-totp-import').addEventListener('click', () => openModal('import-modal'));
    $('btn-do-import').addEventListener('click', doImport);
    $('import-textarea').addEventListener('input', (e) => previewImport(e.target.value));

    $('btn-import-file').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            $('import-textarea').value = reader.result;
            previewImport(reader.result);
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    $('btn-import-paste').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            $('import-textarea').value = text;
            previewImport(text);
        } catch {
            toast('无法读取剪贴板，请手动粘贴', 'error');
        }
    });

    $('btn-change-password').addEventListener('click', async () => {
        const oldPassword = $('old-password').value;
        const newPassword = $('new-password').value;
        const msg = $('password-msg');
        if (!oldPassword || !newPassword) { msg.textContent = '请填写完整'; msg.className = 'form-error'; return; }
        if (newPassword.length < 4) { msg.textContent = '新密码至少4位'; msg.className = 'form-error'; return; }
        try {
            await api('/api/change-password', {
                method: 'POST',
                body: JSON.stringify({ oldPassword, newPassword })
            });
            msg.textContent = '✓ 密码修改成功';
            msg.className = 'form-error ok';
            $('old-password').value = '';
            $('new-password').value = '';
        } catch (e) {
            msg.textContent = e.message;
            msg.className = 'form-error';
        }
    });

    els('#color-row .swatch').forEach(s => s.addEventListener('click', () => {
        state.editingColor = s.dataset.color;
        syncColorSwatches();
    }));

    els('#preset-row .preset').forEach(btn => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));

    els('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));

    els('.modal').forEach(modal => {
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) modal.classList.remove('open');
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            els('.modal.open').forEach(m => m.classList.remove('open'));
            showReaderEmpty();
        }
    });
}

/* ============ 启动 ============ */

(function boot() {
    applyTheme(localStorage.getItem(LS_THEME) ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    bindEvents();
    if (state.token) {
        api('/api/me')
            .then(enterApp)
            .catch(() => {
                state.token = null;
                localStorage.removeItem(LS_TOKEN);
                loadLoginFields();
            });
    } else {
        loadLoginFields();
    }
})();
