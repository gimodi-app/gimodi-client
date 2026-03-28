const { getIdentityDb } = require('./database');

/**
 * @returns {import('better-sqlite3').Database}
 * @throws {Error}
 */
function db() {
    const d = getIdentityDb();
    if (!d) {throw new Error('No active identity');}
    return d;
}

/**
 * @returns {Array<Object>}
 */
function listFriends() {
    return db().prepare('SELECT * FROM friends ORDER BY added_at').all();
}

/**
 * @param {Object} friend
 */
function addFriend(friend) {
    db().prepare(
        'INSERT OR REPLACE INTO friends (fingerprint, nickname, public_key, added_at) VALUES (?, ?, ?, ?)'
    ).run(friend.fingerprint, friend.nickname || null, friend.public_key || null, friend.added_at || Date.now());
}

/**
 * @param {string} fingerprint
 */
function removeFriend(fingerprint) {
    db().prepare('DELETE FROM friends WHERE fingerprint = ?').run(fingerprint);
}

/**
 * @param {string} fingerprint
 * @param {Object} updates
 */
function updateFriend(fingerprint, updates) {
    const allowed = ['nickname', 'public_key'];
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key)) {continue;}
        sets.push(`${key} = ?`);
        values.push(value);
    }
    if (sets.length === 0) {return;}
    values.push(fingerprint);
    db().prepare(`UPDATE friends SET ${sets.join(', ')} WHERE fingerprint = ?`).run(...values);
}

/**
 * @param {'blocked' | 'ignored'} [type]
 * @returns {Array<Object>}
 */
function listBlocked(type) {
    if (type) {
        return db().prepare('SELECT * FROM blocked_contacts WHERE type = ? ORDER BY created_at').all(type);
    }
    return db().prepare('SELECT * FROM blocked_contacts ORDER BY created_at').all();
}

/**
 * @param {string} fingerprint
 * @param {'blocked' | 'ignored'} type
 */
function addBlocked(fingerprint, type) {
    db().prepare(
        'INSERT OR REPLACE INTO blocked_contacts (fingerprint, type, created_at) VALUES (?, ?, ?)'
    ).run(fingerprint, type, Date.now());
}

/**
 * @param {string} fingerprint
 * @param {'blocked' | 'ignored'} type
 */
function removeBlocked(fingerprint, type) {
    db().prepare('DELETE FROM blocked_contacts WHERE fingerprint = ? AND type = ?').run(fingerprint, type);
}

module.exports = {
    listFriends,
    addFriend,
    removeFriend,
    updateFriend,
    listBlocked,
    addBlocked,
    removeBlocked,
};
