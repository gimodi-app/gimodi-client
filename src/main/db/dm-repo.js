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

// ── Conversations ────────────────────────────────────────────────────────

/**
 * @returns {Array<Object>}
 */
function listConversations() {
    const convs = db().prepare('SELECT * FROM dm_conversations ORDER BY last_message_at DESC').all();
    for (const conv of convs) {
        conv.participants = db().prepare(
            'SELECT fingerprint, nickname, public_key FROM dm_participants WHERE conversation_id = ?'
        ).all(conv.id);
    }
    return convs;
}

/**
 * @param {string} conversationId
 * @returns {Object|null}
 */
function getConversation(conversationId) {
    const conv = db().prepare('SELECT * FROM dm_conversations WHERE id = ?').get(conversationId);
    if (!conv) {return null;}
    conv.participants = db().prepare(
        'SELECT fingerprint, nickname, public_key FROM dm_participants WHERE conversation_id = ?'
    ).all(conv.id);
    return conv;
}

/**
 * @param {Object} conv
 */
function upsertConversation(conv) {
    db().prepare(
        `INSERT INTO dm_conversations (id, type, name, creator_fingerprint, encrypted_session_key, last_message_at, unread_count, purged_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, name),
           encrypted_session_key = COALESCE(excluded.encrypted_session_key, encrypted_session_key),
           last_message_at = COALESCE(excluded.last_message_at, last_message_at),
           unread_count = COALESCE(excluded.unread_count, unread_count),
           purged_at = COALESCE(excluded.purged_at, purged_at)`
    ).run(
        conv.id,
        conv.type || 'direct',
        conv.name || null,
        conv.creator_fingerprint,
        conv.encrypted_session_key || null,
        conv.last_message_at || null,
        conv.unread_count ?? 0,
        conv.purged_at || null,
        conv.created_at || Date.now()
    );

    if (conv.participants && conv.participants.length > 0) {
        const upsert = db().prepare(
            `INSERT INTO dm_participants (conversation_id, fingerprint, nickname, public_key)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(conversation_id, fingerprint) DO UPDATE SET
               nickname = COALESCE(excluded.nickname, nickname),
               public_key = COALESCE(excluded.public_key, public_key)`
        );
        for (const p of conv.participants) {
            upsert.run(conv.id, p.fingerprint, p.nickname || null, p.public_key || p.publicKeyArmored || null);
        }
    }
}

/**
 * @param {string} conversationId
 */
function deleteConversation(conversationId) {
    db().prepare('DELETE FROM dm_conversations WHERE id = ?').run(conversationId);
}

/**
 * @param {string} conversationId
 * @param {Object} updates
 */
function updateConversation(conversationId, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
        if (key === 'participants') {continue;}
        fields.push(`${key} = ?`);
        values.push(val);
    }
    if (fields.length > 0) {
        values.push(conversationId);
        db().prepare(`UPDATE dm_conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    if (updates.participants) {
        const upsert = db().prepare(
            `INSERT INTO dm_participants (conversation_id, fingerprint, nickname, public_key)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(conversation_id, fingerprint) DO UPDATE SET
               nickname = COALESCE(excluded.nickname, nickname),
               public_key = COALESCE(excluded.public_key, public_key)`
        );
        for (const p of updates.participants) {
            upsert.run(conversationId, p.fingerprint, p.nickname || null, p.public_key || p.publicKeyArmored || null);
        }
    }
}

/**
 * @param {string} conversationId
 * @param {string} fingerprint
 */
function removeParticipant(conversationId, fingerprint) {
    db().prepare('DELETE FROM dm_participants WHERE conversation_id = ? AND fingerprint = ?').run(conversationId, fingerprint);
}

// ── Messages ─────────────────────────────────────────────────────────────

/**
 * @param {string} conversationId
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.before]
 * @returns {Array<Object>}
 */
function getMessages(conversationId, opts = {}) {
    const limit = opts.limit || 50;
    if (opts.before) {
        return db().prepare(
            'SELECT * FROM dm_messages WHERE conversation_id = ? AND purged_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?'
        ).all(conversationId, opts.before, limit).reverse();
    }
    return db().prepare(
        'SELECT * FROM dm_messages WHERE conversation_id = ? AND purged_at IS NULL ORDER BY created_at DESC LIMIT ?'
    ).all(conversationId, limit).reverse();
}

/**
 * @param {string} conversationId
 * @returns {Object|null}
 */
function getLastMessage(conversationId) {
    return db().prepare(
        'SELECT * FROM dm_messages WHERE conversation_id = ? AND purged_at IS NULL ORDER BY created_at DESC LIMIT 1'
    ).get(conversationId) || null;
}

/**
 * @returns {Array<{conversation_id: string, last_msg: Object}>}
 */
function getLastMessages() {
    const convs = db().prepare('SELECT id FROM dm_conversations').all();
    const results = [];
    for (const conv of convs) {
        const msg = getLastMessage(conv.id);
        if (msg) {results.push({ conversation_id: conv.id, ...msg });}
    }
    return results;
}

/**
 * @param {Object} msg
 */
function saveMessage(msg) {
    db().prepare(
        `INSERT OR REPLACE INTO dm_messages
         (id, conversation_id, direction, sender_fingerprint, content, status, created_at, key_index, reply_to, reply_to_nickname, reply_to_content, purged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        msg.id,
        msg.conversation_id || msg.conversationId,
        msg.direction,
        msg.sender_fingerprint || msg.senderFingerprint,
        msg.content,
        msg.status || 'sent',
        msg.created_at || msg.createdAt,
        msg.key_index ?? msg.keyIndex ?? 0,
        msg.reply_to ?? msg.replyTo ?? null,
        msg.reply_to_nickname ?? msg.replyToNickname ?? null,
        msg.reply_to_content ?? msg.replyToContent ?? null,
        msg.purged_at ?? null
    );
}

/**
 * @param {string} id
 * @param {string} status
 */
function updateMessageStatus(id, status) {
    db().prepare('UPDATE dm_messages SET status = ? WHERE id = ?').run(status, id);
}

/**
 * @param {string} id
 * @returns {Object|null}
 */
function getMessage(id) {
    return db().prepare('SELECT * FROM dm_messages WHERE id = ?').get(id) || null;
}

/**
 * @param {string} id
 */
function purgeMessage(id) {
    db().prepare('UPDATE dm_messages SET purged_at = ? WHERE id = ?').run(Date.now(), id);
}

/**
 * @param {string} conversationId
 * @returns {number}
 */
function purgeConversationMessages(conversationId) {
    const purgedAt = Date.now();
    const result = db().prepare(
        'UPDATE dm_messages SET purged_at = ? WHERE conversation_id = ? AND purged_at IS NULL'
    ).run(purgedAt, conversationId);
    db().prepare(
        'UPDATE dm_conversations SET purged_at = ? WHERE id = ?'
    ).run(purgedAt, conversationId);
    return purgedAt;
}

/**
 * @param {string} conversationId
 * @param {string} messageId
 * @returns {boolean}
 */
function hasMessage(conversationId, messageId) {
    return !!db().prepare('SELECT 1 FROM dm_messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
}

// ── Reactions ────────────────────────────────────────────────────────────

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

// ── Last Read ────────────────────────────────────────────────────────────

/**
 * @param {string} serverAddress
 * @returns {Record<string, number>}
 */
function getLastRead(serverAddress) {
    const rows = db().prepare('SELECT channel_id, timestamp FROM last_read WHERE server_address = ?').all(serverAddress);
    const result = {};
    for (const row of rows) {result[row.channel_id] = row.timestamp;}
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
    listConversations,
    getConversation,
    upsertConversation,
    deleteConversation,
    updateConversation,
    removeParticipant,
    getMessages,
    getLastMessage,
    getLastMessages,
    saveMessage,
    updateMessageStatus,
    getMessage,
    purgeMessage,
    purgeConversationMessages,
    hasMessage,
    getReactions,
    addReaction,
    removeReaction,
    getLastRead,
    setLastRead,
};
