const { getIdentityDb } = require('./database');

/**
 * @returns {import('better-sqlite3').Database}
 * @throws {Error}
 */
function db() {
    const d = getIdentityDb();
    if (!d) throw new Error('No active identity');
    return d;
}

/**
 * @param {string} key
 * @returns {string | null}
 */
function getSetting(key) {
    const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
}

/**
 * @param {string} key
 * @param {string} value
 */
function setSetting(key, value) {
    db().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * @returns {Record<string, string>}
 */
function getAllSettings() {
    const rows = db().prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
}

module.exports = { getSetting, setSetting, getAllSettings };
