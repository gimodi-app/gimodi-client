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
 * @param {string} peerFingerprint
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.before]
 * @returns {Array<Object>}
 */
function getMessages(peerFingerprint, opts = {}) {
    const limit = opts.limit || 50;
    if (opts.before) {
        return db().prepare(
            'SELECT * FROM dm_messages WHERE peer_fingerprint = ? AND purged_at IS NULL AND timestamp < ? ORDER BY timestamp DESC LIMIT ?'
        ).all(peerFingerprint, opts.before, limit).reverse();
    }
    return db().prepare(
        'SELECT * FROM dm_messages WHERE peer_fingerprint = ? AND purged_at IS NULL ORDER BY timestamp DESC LIMIT ?'
    ).all(peerFingerprint, limit).reverse();
}

/**
 * @param {Object} msg
 */
function saveMessage(msg) {
    db().prepare(
        'INSERT OR REPLACE INTO dm_messages (id, peer_fingerprint, sender_fingerprint, content, timestamp, purged_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(msg.id, msg.peer_fingerprint, msg.sender_fingerprint, msg.content, msg.timestamp, msg.purged_at || null);
}

/**
 * @param {string} id
 */
function purgeMessage(id) {
    db().prepare('UPDATE dm_messages SET purged_at = ? WHERE id = ?').run(Date.now(), id);
}

/**
 * @returns {Array<Object>}
 */
function listConversations() {
    return db().prepare('SELECT * FROM dm_conversations ORDER BY last_message_at DESC').all();
}

/**
 * @param {Object} conv
 */
function upsertConversation(conv) {
    db().prepare(
        `INSERT INTO dm_conversations (peer_fingerprint, peer_nickname, last_message_at, unread_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(peer_fingerprint) DO UPDATE SET
           peer_nickname = COALESCE(excluded.peer_nickname, peer_nickname),
           last_message_at = COALESCE(excluded.last_message_at, last_message_at),
           unread_count = COALESCE(excluded.unread_count, unread_count)`
    ).run(conv.peer_fingerprint, conv.peer_nickname || null, conv.last_message_at || null, conv.unread_count ?? 0);
}

/**
 * @param {string} messageId
 * @returns {Array<{message_id: string, emoji: string}>}
 */
function getReactions(messageId) {
    return db().prepare('SELECT * FROM dm_reactions WHERE message_id = ?').all(messageId);
}

/**
 * @param {string} messageId
 * @param {string} emoji
 */
function addReaction(messageId, emoji) {
    db().prepare('INSERT OR IGNORE INTO dm_reactions (message_id, emoji) VALUES (?, ?)').run(messageId, emoji);
}

/**
 * @param {string} messageId
 * @param {string} emoji
 */
function removeReaction(messageId, emoji) {
    db().prepare('DELETE FROM dm_reactions WHERE message_id = ? AND emoji = ?').run(messageId, emoji);
}

/**
 * @param {string} serverAddress
 * @returns {Record<string, number>}
 */
function getLastRead(serverAddress) {
    const rows = db().prepare('SELECT channel_id, timestamp FROM last_read WHERE server_address = ?').all(serverAddress);
    const result = {};
    for (const row of rows) result[row.channel_id] = row.timestamp;
    return result;
}

/**
 * @param {string} serverAddress
 * @param {string} channelId
 * @param {number} timestamp
 */
function setLastRead(serverAddress, channelId, timestamp) {
    db().prepare(
        'INSERT OR REPLACE INTO last_read (server_address, channel_id, timestamp) VALUES (?, ?, ?)'
    ).run(serverAddress, channelId, timestamp);
}

module.exports = {
    getMessages,
    saveMessage,
    purgeMessage,
    listConversations,
    upsertConversation,
    getReactions,
    addReaction,
    removeReaction,
    getLastRead,
    setLastRead,
};
