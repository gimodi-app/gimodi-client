CREATE TABLE IF NOT EXISTS identities (
    fingerprint  TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    public_key   TEXT NOT NULL,
    private_key  TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS icon_cache (
    server_address  TEXT PRIMARY KEY,
    hash            TEXT,
    cached_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
