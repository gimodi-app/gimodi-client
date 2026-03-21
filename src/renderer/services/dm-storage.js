/**
 * DM storage layer backed by SQLite via IPC.
 * All functions are async and operate on the active identity's database.
 */

const db = window.gimodi.db;

// ── Conversations ────────────────────────────────────────────────────────

/**
 * Loads all conversations for the active identity from the database.
 * @returns {Promise<Array>}
 */
export async function loadConversations() {
    const rows = await db.listConversations();
    return (rows || []).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        creatorFingerprint: row.creator_fingerprint,
        participants: (row.participants || []).map((p) => ({
            fingerprint: p.fingerprint,
            nickname: p.nickname,
            publicKeyArmored: p.public_key,
        })),
        encryptedSessionKey: row.encrypted_session_key || null,
        sessionKey: null,
        purgedAt: row.purged_at || null,
        createdAt: row.created_at,
    }));
}

/**
 * Persists a single conversation to the database.
 * @param {Object} conv
 * @returns {Promise<void>}
 */
export async function saveConversation(conv) {
    await db.upsertConversation({
        id: conv.id,
        type: conv.type || 'direct',
        name: conv.name || null,
        creator_fingerprint: conv.creatorFingerprint,
        encrypted_session_key: conv.encryptedSessionKey || null,
        last_message_at: conv.lastMessageAt || null,
        unread_count: conv.unreadCount ?? 0,
        purged_at: conv.purgedAt || null,
        created_at: conv.createdAt || Date.now(),
        participants: (conv.participants || []).map((p) => ({
            fingerprint: p.fingerprint,
            nickname: p.nickname,
            publicKeyArmored: p.publicKeyArmored,
        })),
    });
}

/**
 * Deletes a conversation from the database.
 * @param {string} conversationId
 * @returns {Promise<void>}
 */
export async function deleteConversation(conversationId) {
    await db.deleteConversation(conversationId);
}

// ── Messages ─────────────────────────────────────────────────────────────

/**
 * Loads messages for a specific conversation from the database.
 * @param {string} conversationId
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.before]
 * @returns {Promise<Array>}
 */
export async function loadMessages(conversationId, opts) {
    const rows = await db.getMessages(conversationId, opts);
    return (rows || []).map(rowToMessage);
}

/**
 * Returns the last message for each conversation.
 * @returns {Promise<Map<string, Object>>}
 */
export async function getLastMessages() {
    const rows = await db.getLastMessages();
    const result = new Map();
    for (const row of rows || []) {
        result.set(row.conversation_id, rowToMessage(row));
    }
    return result;
}

/**
 * Saves a single message to the database.
 * @param {Object} msg
 * @returns {Promise<void>}
 */
export async function saveMessage(msg) {
    await db.saveMessage({
        id: msg.id,
        conversation_id: msg.conversationId,
        direction: msg.direction,
        sender_fingerprint: msg.senderFingerprint,
        content: msg.content,
        status: msg.status || 'sent',
        created_at: msg.createdAt,
        key_index: msg.keyIndex ?? 0,
        reply_to: msg.replyTo ?? null,
        reply_to_nickname: msg.replyToNickname ?? null,
        reply_to_content: msg.replyToContent ?? null,
    });
}

/**
 * Updates a message's status.
 * @param {string} id
 * @param {string} status
 * @returns {Promise<void>}
 */
export async function updateMessageStatus(id, status) {
    await db.updateMessageStatus(id, status);
}

/**
 * Gets a single message by ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getMessage(id) {
    const row = await db.getMessage(id);
    return row ? rowToMessage(row) : null;
}

/**
 * Checks if a message exists in a conversation.
 * @param {string} conversationId
 * @param {string} messageId
 * @returns {Promise<boolean>}
 */
export async function hasMessage(conversationId, messageId) {
    return db.hasMessage(conversationId, messageId);
}

/**
 * Purges all messages in a conversation, returns the purge timestamp.
 * @param {string} conversationId
 * @returns {Promise<number>}
 */
export async function purgeConversationMessages(conversationId) {
    return db.purgeConversation(conversationId);
}

// ── Reactions ────────────────────────────────────────────────────────────

/**
 * Gets reactions for a message.
 * @param {string} messageId
 * @returns {Promise<Array<{emoji: string}>>}
 */
export async function getReactions(messageId) {
    return db.getReactions(messageId);
}

/**
 * Adds a reaction to a message.
 * @param {string} messageId
 * @param {string} emoji
 * @returns {Promise<void>}
 */
export async function addReaction(messageId, emoji) {
    await db.addReaction(messageId, emoji);
}

/**
 * Removes a reaction from a message.
 * @param {string} messageId
 * @param {string} emoji
 * @returns {Promise<void>}
 */
export async function removeReaction(messageId, emoji) {
    await db.removeReaction(messageId, emoji);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a DB row to the in-memory DmMessage format.
 * @param {Object} row
 * @returns {Object}
 */
function rowToMessage(row) {
    return {
        id: row.id,
        conversationId: row.conversation_id,
        direction: row.direction,
        senderFingerprint: row.sender_fingerprint,
        content: row.content,
        status: row.status,
        createdAt: row.created_at,
        keyIndex: row.key_index ?? 0,
        replyTo: row.reply_to ?? null,
        replyToNickname: row.reply_to_nickname ?? null,
        replyToContent: row.reply_to_content ?? null,
    };
}
