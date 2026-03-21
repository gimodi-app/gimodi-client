const crypto = require('crypto');
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
 * @returns {Array<Object>}
 */
function listServers() {
    return db().prepare('SELECT * FROM servers ORDER BY position').all();
}

/**
 * @returns {Array<Object>}
 */
function listGroups() {
    return db().prepare('SELECT * FROM server_groups ORDER BY position').all();
}

/**
 * @param {Object} server
 * @returns {Object}
 */
function addServer(server) {
    const id = server.id || crypto.randomUUID();
    const maxPos = db().prepare('SELECT MAX(position) as max FROM servers').get();
    const position = server.position ?? ((maxPos?.max ?? 0) + 1);
    db().prepare(
        'INSERT OR REPLACE INTO servers (id, group_id, address, nickname, auto_connect, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, server.group_id || null, server.address, server.nickname, server.auto_connect ? 1 : 0, position, server.created_at || Date.now());
    return { ...server, id, position };
}

/**
 * @param {string} id
 */
function removeServer(id) {
    db().prepare('DELETE FROM servers WHERE id = ?').run(id);
}

/**
 * @param {string} id
 * @param {Object} updates
 */
function updateServer(id, updates) {
    const allowed = ['group_id', 'address', 'nickname', 'auto_connect', 'position'];
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key)) continue;
        sets.push(`${key} = ?`);
        values.push(key === 'auto_connect' ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return;
    values.push(id);
    db().prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * @param {string} id
 * @param {number} newPosition
 */
function reorderServer(id, newPosition) {
    db().prepare('UPDATE servers SET position = ? WHERE id = ?').run(newPosition, id);
}

/**
 * @param {Object} group
 * @returns {Object}
 */
function createGroup(group) {
    const id = group.id || crypto.randomUUID();
    const maxPos = db().prepare('SELECT MAX(position) as max FROM server_groups').get();
    const position = group.position ?? ((maxPos?.max ?? 0) + 1);
    db().prepare(
        'INSERT INTO server_groups (id, name, expanded, position) VALUES (?, ?, ?, ?)'
    ).run(id, group.name, group.expanded !== undefined ? (group.expanded ? 1 : 0) : 1, position);
    return { ...group, id, position };
}

/**
 * @param {string} id
 */
function deleteGroup(id) {
    db().prepare('UPDATE servers SET group_id = NULL WHERE group_id = ?').run(id);
    db().prepare('DELETE FROM server_groups WHERE id = ?').run(id);
}

/**
 * @param {string} id
 * @param {Object} updates
 */
function updateGroup(id, updates) {
    const allowed = ['name', 'expanded', 'position'];
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (!allowed.includes(key)) continue;
        sets.push(`${key} = ?`);
        values.push(key === 'expanded' ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return;
    values.push(id);
    db().prepare(`UPDATE server_groups SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Returns servers in the grouped format expected by the sidebar:
 * [ { type:'group', id, name, expanded, servers:[...] }, { address, nickname, ... }, ... ]
 * Ordered by position. Ungrouped servers and groups are interleaved by position.
 */
function listGrouped() {
    const allServers = db().prepare('SELECT * FROM servers ORDER BY position').all();
    const allGroups = db().prepare('SELECT * FROM server_groups ORDER BY position').all();

    const groupMap = new Map();
    for (const g of allGroups) {
        groupMap.set(g.id, {
            type: 'group',
            id: g.id,
            name: g.name,
            expanded: g.expanded === 1,
            position: g.position,
            servers: [],
        });
    }

    const ungrouped = [];
    for (const s of allServers) {
        if (s.group_id && groupMap.has(s.group_id)) {
            groupMap.get(s.group_id).servers.push(s);
        } else {
            ungrouped.push(s);
        }
    }

    const items = [...ungrouped, ...groupMap.values()];
    items.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return items;
}

/**
 * Replaces all servers and groups with the given list.
 * Accepts the sidebar format: [ { type:'group', ... }, { address, ... }, ... ]
 * @param {Array<Object>} items
 */
function saveGrouped(items) {
    const d = db();
    d.transaction(() => {
        d.prepare('DELETE FROM servers').run();
        d.prepare('DELETE FROM server_groups').run();

        let pos = 0;
        for (const item of items) {
            if (item.type === 'group') {
                const gid = item.id || crypto.randomUUID();
                d.prepare('INSERT INTO server_groups (id, name, expanded, position) VALUES (?, ?, ?, ?)')
                    .run(gid, item.name, item.expanded !== false ? 1 : 0, pos);
                for (const s of (item.servers || [])) {
                    pos += 0.001;
                    d.prepare('INSERT INTO servers (id, group_id, address, nickname, auto_connect, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                        .run(s.id || crypto.randomUUID(), gid, s.address, s.nickname, s.auto_connect ? 1 : 0, pos, s.created_at || Date.now());
                }
            } else {
                d.prepare('INSERT INTO servers (id, group_id, address, nickname, auto_connect, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .run(item.id || crypto.randomUUID(), null, item.address, item.nickname, item.auto_connect ? 1 : 0, pos, item.created_at || Date.now());
            }
            pos++;
        }
    })();
}

module.exports = {
    listServers,
    listGroups,
    listGrouped,
    saveGrouped,
    addServer,
    removeServer,
    updateServer,
    reorderServer,
    createGroup,
    deleteGroup,
    updateGroup,
};
