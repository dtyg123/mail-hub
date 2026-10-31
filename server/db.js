const initSqlJs = require('sql.js').default;
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'codes.db');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db = null;
let SQL = null;
let lastId = 0;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS email_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL DEFAULT 993,
        imap_secure INTEGER NOT NULL DEFAULT 1,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS totp_secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        secret TEXT NOT NULL,
        issuer TEXT DEFAULT '',
        digits INTEGER DEFAULT 6,
        period INTEGER DEFAULT 30,
        algorithm TEXT DEFAULT 'SHA1',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS login_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        ip TEXT NOT NULL,
        success INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS auth_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`;

async function init() {
    SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buf = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buf);
    } else {
        db = new SQL.Database();
    }
    db.run(SCHEMA);
    save();
}

function save() {
    if (!db) return;
    const buf = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(buf));
}

function run(sql, params = []) {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    // 必须在 save() 之前读取，导出会重置 last_insert_rowid
    const idStmt = db.prepare('SELECT last_insert_rowid() AS id');
    if (idStmt.step()) lastId = Number(idStmt.getAsObject().id) || 0;
    idStmt.free();
    save();
}

function get(sql, params = []) {
    if (!db) return null;
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
}

function getAll(sql, params = []) {
    if (!db) return [];
    const stmt = db.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function getLastInsertRowId() {
    return lastId;
}

module.exports = { run, get, getAll, getLastInsertRowId, save, init, DB_PATH };
