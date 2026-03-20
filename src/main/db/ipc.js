const { ipcMain, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const database = require('./database');
const appSettingsRepo = require('./app-settings-repo');
const settingsRepo = require('./settings-repo');
const serversRepo = require('./servers-repo');
const friendsRepo = require('./friends-repo');
const dmRepo = require('./dm-repo');
const identity = require('../identity');

/**
 * @param {function} sendToMain
 */
function registerIpcHandlers(sendToMain) {
    // --- Global (app.db) ---

    ipcMain.handle('db:identities:list', () => {
        return appSettingsRepo.listIdentities();
    });

    ipcMain.handle('db:identities:create', async (event, name) => {
        const result = await identity.createIdentity(name);
        database.createIdentityDb(result.fingerprint);
        return result;
    });

    ipcMain.handle('db:identities:delete', (event, fingerprint) => {
        const identities = appSettingsRepo.listIdentities();
        if (identities.length <= 1) {
            throw new Error('Cannot delete the last identity.');
        }
        database.deleteIdentityDb(fingerprint);
        appSettingsRepo.deleteIdentity(fingerprint);
    });

    ipcMain.handle('db:identities:rename', (event, fingerprint, name) => {
        appSettingsRepo.renameIdentity(fingerprint, name);
        const ident = appSettingsRepo.getIdentity(fingerprint);
        return { fingerprint: ident.fingerprint, name: ident.name, public_key: ident.public_key };
    });

    ipcMain.handle('db:identities:switch', (event, fingerprint) => {
        const ident = appSettingsRepo.getIdentity(fingerprint);
        if (!ident) throw new Error('Identity not found.');
        database.switchIdentity(fingerprint);
        const result = {
            fingerprint: ident.fingerprint,
            name: ident.name,
            public_key: ident.public_key,
        };
        sendToMain('identity:switched', result);
        return result;
    });

    ipcMain.handle('db:identities:active', () => {
        const fp = database.getActiveFingerprint();
        if (!fp) return null;
        const ident = appSettingsRepo.getIdentity(fp);
        if (!ident) return null;
        return {
            fingerprint: ident.fingerprint,
            name: ident.name,
            public_key: ident.public_key,
        };
    });

    ipcMain.handle('db:identities:logout', () => {
        database.logout();
        sendToMain('identity:logged-out');
    });

    ipcMain.handle('db:app-setting:get', (event, key) => {
        return appSettingsRepo.getAppSetting(key);
    });

    ipcMain.handle('db:app-setting:set', (event, key, value) => {
        appSettingsRepo.setAppSetting(key, value);
    });

    // Identity export/import
    ipcMain.handle('db:identities:export', async (event, fingerprint) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const ident = appSettingsRepo.getIdentity(fingerprint);
        if (!ident) throw new Error('Identity not found.');
        const data = {
            version: 1,
            name: ident.name,
            fingerprint: ident.fingerprint,
            publicKeyArmored: ident.public_key,
            privateKeyArmored: ident.private_key,
            createdAt: ident.created_at,
        };
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            title: 'Export Identity',
            defaultPath: `${data.name.replace(/[^a-z0-9_-]/gi, '_')}.gimodi-identity`,
            filters: [{ name: 'Gimodi Identity', extensions: ['gimodi-identity'] }],
        });
        if (canceled || !filePath) return { canceled: true };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return { canceled: false, filePath };
    });

    ipcMain.handle('db:identities:import', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            title: 'Import Identity',
            filters: [{ name: 'Gimodi Identity', extensions: ['gimodi-identity'] }],
            properties: ['openFile'],
        });
        if (canceled || !filePaths.length) return { canceled: true };
        const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
        const imported = await identity.importIdentity(raw);
        database.createIdentityDb(imported.fingerprint);
        return { canceled: false, identity: imported };
    });

    // --- Identity-scoped (requires active identity) ---

    ipcMain.handle('db:setting:get', (event, key) => {
        return settingsRepo.getSetting(key);
    });

    ipcMain.handle('db:setting:set', (event, key, value) => {
        settingsRepo.setSetting(key, value);
    });

    ipcMain.handle('db:settings:all', () => {
        return settingsRepo.getAllSettings();
    });

    // Servers
    ipcMain.handle('db:servers:list', () => {
        return serversRepo.listServers();
    });

    ipcMain.handle('db:servers:add', (event, server) => {
        return serversRepo.addServer(server);
    });

    ipcMain.handle('db:servers:remove', (event, id) => {
        serversRepo.removeServer(id);
    });

    ipcMain.handle('db:servers:reorder', (event, id, newPosition) => {
        serversRepo.reorderServer(id, newPosition);
    });

    ipcMain.handle('db:servers:update', (event, id, updates) => {
        serversRepo.updateServer(id, updates);
    });

    // Server groups
    ipcMain.handle('db:groups:list', () => {
        return serversRepo.listGroups();
    });

    ipcMain.handle('db:groups:create', (event, group) => {
        return serversRepo.createGroup(group);
    });

    ipcMain.handle('db:groups:delete', (event, id) => {
        serversRepo.deleteGroup(id);
    });

    ipcMain.handle('db:groups:update', (event, id, updates) => {
        serversRepo.updateGroup(id, updates);
    });

    // Friends
    ipcMain.handle('db:friends:list', () => {
        return friendsRepo.listFriends();
    });

    ipcMain.handle('db:friends:add', (event, friend) => {
        friendsRepo.addFriend(friend);
    });

    ipcMain.handle('db:friends:remove', (event, fingerprint) => {
        friendsRepo.removeFriend(fingerprint);
    });

    ipcMain.handle('db:friends:update', (event, fingerprint, updates) => {
        friendsRepo.updateFriend(fingerprint, updates);
    });

    // Blocked/Ignored
    ipcMain.handle('db:blocked:list', (event, type) => {
        return friendsRepo.listBlocked(type);
    });

    ipcMain.handle('db:blocked:add', (event, fingerprint, type) => {
        friendsRepo.addBlocked(fingerprint, type);
    });

    ipcMain.handle('db:blocked:remove', (event, fingerprint, type) => {
        friendsRepo.removeBlocked(fingerprint, type);
    });

    // DM Messages
    ipcMain.handle('db:dm:messages', (event, peerFp, opts) => {
        return dmRepo.getMessages(peerFp, opts);
    });

    ipcMain.handle('db:dm:save-message', (event, msg) => {
        dmRepo.saveMessage(msg);
    });

    ipcMain.handle('db:dm:purge', (event, id) => {
        dmRepo.purgeMessage(id);
    });

    // DM Conversations
    ipcMain.handle('db:dm:conversations', () => {
        return dmRepo.listConversations();
    });

    ipcMain.handle('db:dm:upsert-conversation', (event, conv) => {
        dmRepo.upsertConversation(conv);
    });

    // DM Reactions
    ipcMain.handle('db:dm:reactions', (event, messageId) => {
        return dmRepo.getReactions(messageId);
    });

    ipcMain.handle('db:dm:add-reaction', (event, messageId, emoji) => {
        dmRepo.addReaction(messageId, emoji);
    });

    ipcMain.handle('db:dm:remove-reaction', (event, messageId, emoji) => {
        dmRepo.removeReaction(messageId, emoji);
    });

    // Last Read
    ipcMain.handle('db:last-read:get', (event, serverAddress) => {
        return dmRepo.getLastRead(serverAddress);
    });

    ipcMain.handle('db:last-read:set', (event, serverAddress, channelId, ts) => {
        dmRepo.setLastRead(serverAddress, channelId, ts);
    });

    // Crypto (these stay on the identity module, independent of DB)
    ipcMain.handle('db:identity:encrypt', (event, recipientPublicKeys, plaintext) => {
        return identity.encryptMessage(recipientPublicKeys, plaintext);
    });

    ipcMain.handle('db:identity:decrypt', (event, armoredMessage) => {
        return identity.decryptMessage(armoredMessage);
    });

    ipcMain.handle('db:identity:generate-session-key', () => {
        return identity.generateSessionKey();
    });

    ipcMain.handle('db:identity:encrypt-session-key', (event, base64Key, participants) => {
        return identity.encryptSessionKeyForParticipants(base64Key, participants);
    });

    ipcMain.handle('db:identity:decrypt-session-key', (event, encryptedKey) => {
        return identity.decryptSessionKey(encryptedKey);
    });

    ipcMain.handle('db:identity:encrypt-symmetric', (event, base64Key, plaintext) => {
        return identity.encryptWithSessionKey(base64Key, plaintext);
    });

    ipcMain.handle('db:identity:decrypt-symmetric', (event, base64Key, ciphertext) => {
        return identity.decryptWithSessionKey(base64Key, ciphertext);
    });
}

module.exports = { registerIpcHandlers };
