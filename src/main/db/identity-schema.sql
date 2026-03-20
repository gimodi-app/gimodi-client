CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
    id            TEXT PRIMARY KEY,
    group_id      TEXT REFERENCES server_groups(id) ON DELETE SET NULL,
    address       TEXT NOT NULL,
    nickname      TEXT NOT NULL,
    auto_connect  INTEGER NOT NULL DEFAULT 0,
    position      REAL NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_groups (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    expanded  INTEGER NOT NULL DEFAULT 1,
    position  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS friends (
    fingerprint  TEXT PRIMARY KEY,
    nickname     TEXT,
    public_key   TEXT,
    added_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_contacts (
    fingerprint  TEXT NOT NULL,
    type         TEXT NOT NULL CHECK(type IN ('blocked', 'ignored')),
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (fingerprint, type)
);

CREATE TABLE IF NOT EXISTS dm_messages (
    id                 TEXT PRIMARY KEY,
    peer_fingerprint   TEXT NOT NULL,
    sender_fingerprint TEXT NOT NULL,
    content            TEXT NOT NULL,
    timestamp          INTEGER NOT NULL,
    purged_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_peer
    ON dm_messages(peer_fingerprint, timestamp);

CREATE TABLE IF NOT EXISTS dm_conversations (
    peer_fingerprint  TEXT PRIMARY KEY,
    peer_nickname     TEXT,
    last_message_at   INTEGER,
    unread_count      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dm_reactions (
    message_id  TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    PRIMARY KEY (message_id, emoji)
);

CREATE TABLE IF NOT EXISTS last_read (
    server_address  TEXT NOT NULL,
    channel_id      TEXT NOT NULL,
    timestamp       INTEGER NOT NULL,
    PRIMARY KEY (server_address, channel_id)
);

CREATE TABLE IF NOT EXISTS migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
