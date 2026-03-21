/**
 * Expands the DM schema to support the full conversation model:
 * - dm_conversations: adds type, name, creator, session key, purged_at
 * - dm_participants: new table for group conversation members
 * - dm_messages: adds conversation_id, direction, status, reply fields
 * @param {import('better-sqlite3').Database} db
 */
module.exports = function migrate(db) {
    db.transaction(() => {
        // Drop old tables (should be empty — DM data was in localStorage, not yet migrated)
        db.exec('DROP TABLE IF EXISTS dm_reactions');
        db.exec('DROP TABLE IF EXISTS dm_messages');
        db.exec('DROP TABLE IF EXISTS dm_participants');
        db.exec('DROP TABLE IF EXISTS dm_conversations');

        // Recreate with full schema
        db.exec(`
            CREATE TABLE dm_conversations (
                id                    TEXT PRIMARY KEY,
                type                  TEXT NOT NULL CHECK(type IN ('direct', 'group')),
                name                  TEXT,
                creator_fingerprint   TEXT NOT NULL,
                encrypted_session_key TEXT,
                last_message_at       INTEGER,
                unread_count          INTEGER NOT NULL DEFAULT 0,
                purged_at             INTEGER,
                created_at            INTEGER NOT NULL
            );

            CREATE TABLE dm_participants (
                conversation_id  TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
                fingerprint      TEXT NOT NULL,
                nickname         TEXT,
                public_key       TEXT,
                PRIMARY KEY (conversation_id, fingerprint)
            );

            CREATE TABLE dm_messages (
                id                 TEXT PRIMARY KEY,
                conversation_id    TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
                direction          TEXT NOT NULL CHECK(direction IN ('sent', 'received')),
                sender_fingerprint TEXT NOT NULL,
                content            TEXT NOT NULL,
                status             TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('pending', 'sent', 'delivered')),
                created_at         INTEGER NOT NULL,
                key_index          INTEGER DEFAULT 0,
                reply_to           TEXT,
                reply_to_nickname  TEXT,
                reply_to_content   TEXT,
                purged_at          INTEGER
            );

            CREATE INDEX idx_dm_messages_conversation
                ON dm_messages(conversation_id, created_at);

            CREATE TABLE dm_reactions (
                message_id  TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
                emoji       TEXT NOT NULL,
                PRIMARY KEY (message_id, emoji)
            );
        `);
    })();
};
