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

-- DM tables are created/managed by migrations (002-expand-dm-schema.js)
-- Do not define them here to avoid conflicts with migration-managed schema.

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
