const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const database = require('./database');
const appSettingsRepo = require('./app-settings-repo');
const identity = require('../identity');

/**
 * @returns {boolean}
 */
function alreadyMigrated() {
    return appSettingsRepo.getAppSetting('json_migrated') === '1';
}

/**
 * @param {string} filePath
 * @returns {any}
 */
function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * @param {string} filePath
 */
function backup(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.renameSync(filePath, filePath + '.bak');
        }
    } catch {}
}

/**
 * @returns {Promise<void>}
 */
async function migrateJsonFiles() {
    if (alreadyMigrated()) return;

    const userData = app.getPath('userData');
    const serversPath = path.join(userData, 'servers.json');
    const settingsPath = path.join(userData, 'settings.json');
    const friendsPath = path.join(userData, 'friends.json');

    // 1. Migrate identities from legacy JSON
    const legacyIdentities = identity.loadLegacyIdentities();
    if (legacyIdentities && legacyIdentities.length > 0) {
        try {
            await identity.migrateLegacyIdentities(legacyIdentities);
            identity.backupLegacyFile();
        } catch (err) {
            console.error('[migrate] Identity migration failed:', err.stack || err);
        }
    }

    // 2. Migrate app-level settings
    const settings = readJson(settingsPath);
    if (settings) {
        if (settings.devMode !== undefined) appSettingsRepo.setAppSetting('devMode', settings.devMode ? '1' : '0');
        if (settings.updateChannel) appSettingsRepo.setAppSetting('updateChannel', settings.updateChannel);
        if (settings.updateNotifications !== undefined) appSettingsRepo.setAppSetting('updateNotifications', settings.updateNotifications ? '1' : '0');
    }

    // 3. Get identities to distribute data across
    const identities = appSettingsRepo.listIdentities();
    const defaultIdentity = identities[0];

    if (defaultIdentity) {
        // 4. Migrate servers into identity databases
        const servers = readJson(serversPath);
        if (servers && Array.isArray(servers)) {
            migrateServers(servers, identities, defaultIdentity);
        }

        // 5. Migrate friends
        const friends = readJson(friendsPath);
        if (friends && Array.isArray(friends)) {
            migrateFriends(friends, defaultIdentity);
        }

        // 6. Migrate per-identity settings (notificationMode, etc.)
        if (settings && settings.notificationMode) {
            for (const ident of identities) {
                const db = database.switchIdentity(ident.fingerprint);
                db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('notificationMode', settings.notificationMode);
            }
            database.logout();
        }
    }

    // 7. Backup old files
    backup(serversPath);
    backup(settingsPath);
    backup(friendsPath);

    // 8. Mark as migrated
    appSettingsRepo.setAppSetting('json_migrated', '1');

}

/**
 * @param {Array<object>} items
 * @param {Array<object>} identities
 * @param {object} defaultIdentity
 */
function migrateServers(items, identities, defaultIdentity) {
    const identityFpSet = new Set(identities.map((i) => i.fingerprint));

    const byIdentity = new Map();
    for (const ident of identities) {
        byIdentity.set(ident.fingerprint, []);
    }

    function assignServer(server, groupId) {
        const fp = server.identityFingerprint;
        const targetFp = fp && identityFpSet.has(fp) ? fp : defaultIdentity.fingerprint;
        byIdentity.get(targetFp).push({ server, groupId });
    }

    const groups = [];

    for (const item of items) {
        if (item.type === 'group') {
            const groupId = crypto.randomUUID();
            groups.push({ id: groupId, name: item.name || 'Group', expanded: item.expanded !== false });
            for (const server of item.servers || []) {
                assignServer(server, groupId);
            }
        } else {
            assignServer(item, null);
        }
    }

    for (const [fp, entries] of byIdentity) {
        if (entries.length === 0 && groups.length === 0) continue;
        const db = database.switchIdentity(fp);

        const groupsNeeded = new Set(entries.filter((e) => e.groupId).map((e) => e.groupId));
        for (const group of groups) {
            if (groupsNeeded.has(group.id)) {
                db.prepare('INSERT OR IGNORE INTO server_groups (id, name, expanded, position) VALUES (?, ?, ?, ?)')
                    .run(group.id, group.name, group.expanded ? 1 : 0, groups.indexOf(group));
            }
        }

        let position = 0;
        for (const { server, groupId } of entries) {
            db.prepare(
                'INSERT OR IGNORE INTO servers (id, group_id, address, nickname, auto_connect, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(
                crypto.randomUUID(),
                groupId,
                server.address,
                server.nickname || '',
                server.autoConnect ? 1 : 0,
                position++,
                Date.now()
            );
        }
    }

    database.logout();
}

/**
 * @param {Array<object>} friends
 * @param {object} defaultIdentity
 */
function migrateFriends(friends, defaultIdentity) {
    const db = database.switchIdentity(defaultIdentity.fingerprint);

    for (const friend of friends) {
        const fp = friend.fingerprint || friend.identityFingerprint;
        if (!fp) continue;
        db.prepare(
            'INSERT OR IGNORE INTO friends (fingerprint, nickname, public_key, added_at) VALUES (?, ?, ?, ?)'
        ).run(fp, friend.displayName || null, null, friend.addedAt || Date.now());
    }

    database.logout();
}

module.exports = { migrateJsonFiles };
