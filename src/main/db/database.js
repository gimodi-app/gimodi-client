const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let appDb;
let identityDb;
let activeFingerprint;

/**
 * @returns {string}
 */
function getIdentitiesDir() {
    return path.join(app.getPath('userData'), 'identities');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} schemaPath
 */
function applySchema(db, schemaPath) {
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(sql);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} migrationsDir
 */
function runMigrations(db, migrationsDir) {
    if (!fs.existsSync(migrationsDir)) {return;}
    const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.js'))
        .sort();
    const applied = new Set(
        db.prepare('SELECT name FROM migrations').all().map((r) => r.name)
    );
    for (const file of files) {
        if (applied.has(file)) {continue;}
        const migrate = require(path.join(migrationsDir, file));
        const fn = typeof migrate === 'function' ? migrate : migrate.default || migrate;
        fn(db);
        db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    }
}

/**
 * @returns {import('better-sqlite3').Database}
 */
function openAppDb() {
    const dbPath = path.join(app.getPath('userData'), 'app.db');
    appDb = new Database(dbPath);
    appDb.pragma('journal_mode = WAL');
    appDb.pragma('foreign_keys = ON');
    const schemaPath = path.join(__dirname, 'app-schema.sql');
    applySchema(appDb, schemaPath);
    runMigrations(appDb, path.join(__dirname, 'migrations', 'app'));
    return appDb;
}

/**
 * @param {string} fingerprint
 * @returns {import('better-sqlite3').Database}
 */
function switchIdentity(fingerprint) {
    if (identityDb) {identityDb.close();}
    const dir = getIdentitiesDir();
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, `${fingerprint}.db`);
    identityDb = new Database(dbPath);
    identityDb.pragma('journal_mode = WAL');
    identityDb.pragma('foreign_keys = ON');
    const schemaPath = path.join(__dirname, 'identity-schema.sql');
    applySchema(identityDb, schemaPath);
    runMigrations(identityDb, path.join(__dirname, 'migrations', 'identity'));
    activeFingerprint = fingerprint;
    appDb.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('activeIdentity', fingerprint);
    return identityDb;
}

/**
 * @param {string} fingerprint
 */
function createIdentityDb(fingerprint) {
    const dir = getIdentitiesDir();
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, `${fingerprint}.db`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const schemaPath = path.join(__dirname, 'identity-schema.sql');
    applySchema(db, schemaPath);
    runMigrations(db, path.join(__dirname, 'migrations', 'identity'));
    db.close();
}

/**
 * @param {string} fingerprint
 */
function deleteIdentityDb(fingerprint) {
    if (activeFingerprint === fingerprint) {
        logout();
    }
    const dbPath = path.join(getIdentitiesDir(), `${fingerprint}.db`);
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
}

function logout() {
    if (identityDb) {identityDb.close();}
    identityDb = null;
    activeFingerprint = null;
    appDb.prepare('DELETE FROM app_settings WHERE key = ?').run('activeIdentity');
}

/**
 * @returns {import('better-sqlite3').Database}
 */
function getAppDb() {
    return appDb;
}

/**
 * @returns {import('better-sqlite3').Database | null}
 */
function getIdentityDb() {
    return identityDb;
}

/**
 * @returns {string | null}
 */
function getActiveFingerprint() {
    return activeFingerprint;
}

function closeAll() {
    if (identityDb) {identityDb.close();}
    identityDb = null;
    activeFingerprint = null;
    if (appDb) {appDb.close();}
    appDb = null;
}

module.exports = {
    openAppDb,
    switchIdentity,
    createIdentityDb,
    deleteIdentityDb,
    logout,
    getAppDb,
    getIdentityDb,
    getActiveFingerprint,
    closeAll,
};
