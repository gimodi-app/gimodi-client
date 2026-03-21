const { getAppDb } = require('./database');

/**
 * @param {string} key
 * @returns {string | null}
 */
function getAppSetting(key) {
    const row = getAppDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? row.value : null;
}

/**
 * @param {string} key
 * @param {string} value
 */
function setAppSetting(key, value) {
    getAppDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * @param {string} key
 */
function deleteAppSetting(key) {
    getAppDb().prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

/**
 * @returns {Array<{fingerprint: string, name: string, public_key: string, created_at: number}>}
 */
function listIdentities() {
    return getAppDb().prepare('SELECT fingerprint, name, public_key, created_at FROM identities ORDER BY created_at').all();
}

/**
 * @param {string} fingerprint
 * @returns {{fingerprint: string, name: string, public_key: string, private_key: string, created_at: number} | undefined}
 */
function getIdentity(fingerprint) {
    return getAppDb().prepare('SELECT * FROM identities WHERE fingerprint = ?').get(fingerprint);
}

/**
 * @param {{fingerprint: string, name: string, public_key: string, private_key: string, created_at: number}} identity
 */
function insertIdentity(identity) {
    getAppDb().prepare(
        'INSERT INTO identities (fingerprint, name, public_key, private_key, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(identity.fingerprint, identity.name, identity.public_key, identity.private_key, identity.created_at);
}

/**
 * @param {string} fingerprint
 */
function deleteIdentity(fingerprint) {
    getAppDb().prepare('DELETE FROM identities WHERE fingerprint = ?').run(fingerprint);
}

/**
 * @param {string} fingerprint
 * @param {string} name
 */
function renameIdentity(fingerprint, name) {
    getAppDb().prepare('UPDATE identities SET name = ? WHERE fingerprint = ?').run(name, fingerprint);
}

/**
 * @returns {Array<{fingerprint: string, private_key: string}>}
 */
function listIdentitiesWithPrivateKeys() {
    return getAppDb().prepare('SELECT fingerprint, private_key FROM identities').all();
}

module.exports = {
    getAppSetting,
    setAppSetting,
    deleteAppSetting,
    listIdentities,
    getIdentity,
    insertIdentity,
    deleteIdentity,
    renameIdentity,
    listIdentitiesWithPrivateKeys,
};
