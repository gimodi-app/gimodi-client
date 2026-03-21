const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gimodi', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  db: {
    // --- Global (app.db) ---
    listIdentities: () => ipcRenderer.invoke('db:identities:list'),
    createIdentity: (name) => ipcRenderer.invoke('db:identities:create', name),
    deleteIdentity: (fp) => ipcRenderer.invoke('db:identities:delete', fp),
    renameIdentity: (fp, name) => ipcRenderer.invoke('db:identities:rename', fp, name),
    switchIdentity: (fp) => ipcRenderer.invoke('db:identities:switch', fp),
    getActiveIdentity: () => ipcRenderer.invoke('db:identities:active'),
    logout: () => ipcRenderer.invoke('db:identities:logout'),
    exportIdentity: (fp) => ipcRenderer.invoke('db:identities:export', fp),
    importIdentity: () => ipcRenderer.invoke('db:identities:import'),

    // App-level settings
    getAppSetting: (key) => ipcRenderer.invoke('db:app-setting:get', key),
    setAppSetting: (key, value) => ipcRenderer.invoke('db:app-setting:set', key, value),

    // --- Identity-scoped ---
    getSetting: (key) => ipcRenderer.invoke('db:setting:get', key),
    setSetting: (key, value) => ipcRenderer.invoke('db:setting:set', key, value),
    getSettings: () => ipcRenderer.invoke('db:settings:all'),

    // Servers
    listServers: () => ipcRenderer.invoke('db:servers:list'),
    listServersGrouped: () => ipcRenderer.invoke('db:servers:list-grouped'),
    saveServersGrouped: (items) => ipcRenderer.invoke('db:servers:save-grouped', items),
    addServer: (server) => ipcRenderer.invoke('db:servers:add', server),
    removeServer: (id) => ipcRenderer.invoke('db:servers:remove', id),
    reorderServer: (id, newPosition) => ipcRenderer.invoke('db:servers:reorder', id, newPosition),
    updateServer: (id, updates) => ipcRenderer.invoke('db:servers:update', id, updates),

    // Server groups
    listGroups: () => ipcRenderer.invoke('db:groups:list'),
    createGroup: (group) => ipcRenderer.invoke('db:groups:create', group),
    deleteGroup: (id) => ipcRenderer.invoke('db:groups:delete', id),
    updateGroup: (id, updates) => ipcRenderer.invoke('db:groups:update', id, updates),

    // Friends
    listFriends: () => ipcRenderer.invoke('db:friends:list'),
    addFriend: (friend) => ipcRenderer.invoke('db:friends:add', friend),
    removeFriend: (fp) => ipcRenderer.invoke('db:friends:remove', fp),
    updateFriend: (fp, updates) => ipcRenderer.invoke('db:friends:update', fp, updates),

    // Blocked/Ignored
    listBlocked: (type) => ipcRenderer.invoke('db:blocked:list', type),
    addBlocked: (fp, type) => ipcRenderer.invoke('db:blocked:add', fp, type),
    removeBlocked: (fp, type) => ipcRenderer.invoke('db:blocked:remove', fp, type),

    // DM Conversations
    listConversations: () => ipcRenderer.invoke('db:dm:conversations'),
    getConversation: (id) => ipcRenderer.invoke('db:dm:conversation:get', id),
    upsertConversation: (conv) => ipcRenderer.invoke('db:dm:upsert-conversation', conv),
    deleteConversation: (id) => ipcRenderer.invoke('db:dm:delete-conversation', id),
    updateConversation: (id, updates) => ipcRenderer.invoke('db:dm:update-conversation', id, updates),
    removeParticipant: (convId, fp) => ipcRenderer.invoke('db:dm:remove-participant', convId, fp),

    // DM Messages
    getMessages: (conversationId, opts) => ipcRenderer.invoke('db:dm:messages', conversationId, opts),
    getLastMessages: () => ipcRenderer.invoke('db:dm:last-messages'),
    saveMessage: (msg) => ipcRenderer.invoke('db:dm:save-message', msg),
    updateMessageStatus: (id, status) => ipcRenderer.invoke('db:dm:update-status', id, status),
    getMessage: (id) => ipcRenderer.invoke('db:dm:get-message', id),
    purgeMessage: (id) => ipcRenderer.invoke('db:dm:purge', id),
    purgeConversation: (conversationId) => ipcRenderer.invoke('db:dm:purge-conversation', conversationId),
    hasMessage: (conversationId, messageId) => ipcRenderer.invoke('db:dm:has-message', conversationId, messageId),

    // DM Reactions
    getReactions: (messageId) => ipcRenderer.invoke('db:dm:reactions', messageId),
    addReaction: (messageId, emoji) => ipcRenderer.invoke('db:dm:add-reaction', messageId, emoji),
    removeReaction: (messageId, emoji) => ipcRenderer.invoke('db:dm:remove-reaction', messageId, emoji),

    // Last Read
    getLastRead: (serverAddress) => ipcRenderer.invoke('db:last-read:get', serverAddress),
    setLastRead: (serverAddress, channelId, ts) => ipcRenderer.invoke('db:last-read:set', serverAddress, channelId, ts),

    // Crypto
    encrypt: (recipientPublicKeys, plaintext) => ipcRenderer.invoke('db:identity:encrypt', recipientPublicKeys, plaintext),
    decrypt: (armoredMessage) => ipcRenderer.invoke('db:identity:decrypt', armoredMessage),
    generateSessionKey: () => ipcRenderer.invoke('db:identity:generate-session-key'),
    encryptSessionKey: (base64Key, participants) => ipcRenderer.invoke('db:identity:encrypt-session-key', base64Key, participants),
    decryptSessionKey: (encryptedKey) => ipcRenderer.invoke('db:identity:decrypt-session-key', encryptedKey),
    encryptSymmetric: (base64Key, plaintext) => ipcRenderer.invoke('db:identity:encrypt-symmetric', base64Key, plaintext),
    decryptSymmetric: (base64Key, ciphertext) => ipcRenderer.invoke('db:identity:decrypt-symmetric', base64Key, ciphertext),

    // Events
    onIdentitySwitched: (cb) => ipcRenderer.on('identity:switched', (_, data) => cb(data)),
    onIdentityLoggedOut: (cb) => ipcRenderer.on('identity:logged-out', () => cb()),
  },
  windowControl: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  onMenuUpdate: (cb) => ipcRenderer.on('menu:update', (_, menu) => cb(menu)),
  menuAction: (action, data) => ipcRenderer.send('menu:action', action, data),
  onConnectServer: (cb) => ipcRenderer.on('menu:connect-server', (_, server) => cb(server)),
  removeConnectServerListener: () => ipcRenderer.removeAllListeners('menu:connect-server'),
  onMenuAction: (cb) => {
    ipcRenderer.on('server-admin:list-users', () => cb('list-users'));
    ipcRenderer.on('server-admin:manage-bans', () => cb('manage-bans'));
    ipcRenderer.on('server-admin:manage-tokens', () => cb('manage-tokens'));
    ipcRenderer.on('menu:redeem-token', () => cb('redeem-token'));
    ipcRenderer.on('server-admin:manage-roles', () => cb('manage-roles'));
    ipcRenderer.on('server-admin:server-settings', () => cb('server-settings'));
    ipcRenderer.on('server-admin:audit-log', () => cb('audit-log'));
  },
  onDisconnect: (cb) => ipcRenderer.on('menu:disconnect', () => cb()),
  onOpenUnifiedSettings: (cb) => ipcRenderer.on('menu:open-unified-settings', () => cb()),
  setDevMode: (enabled) => ipcRenderer.invoke('settings:set-dev-mode', enabled),
  setUpdateChannel: (channel) => ipcRenderer.invoke('settings:set-update-channel', channel),
  setUpdateNotifications: (enabled) => ipcRenderer.invoke('settings:set-update-notifications', enabled),
  removeMenuListeners: () => {
    ipcRenderer.removeAllListeners('server-admin:list-users');
    ipcRenderer.removeAllListeners('server-admin:manage-bans');
    ipcRenderer.removeAllListeners('server-admin:manage-tokens');
    ipcRenderer.removeAllListeners('menu:redeem-token');
    ipcRenderer.removeAllListeners('server-admin:manage-roles');
    ipcRenderer.removeAllListeners('server-admin:server-settings');
    ipcRenderer.removeAllListeners('server-admin:audit-log');
    // Note: menu:disconnect and menu:open-unified-settings
    // are registered once by app.js and must persist across reconnects.
    // Note: tray:toggle-mute, tray:toggle-deafen, tray:disconnect are managed
    // separately via removeTrayVoiceListeners to persist across server view switches.
  },
  removeTrayVoiceListeners: () => {
    ipcRenderer.removeAllListeners('tray:toggle-mute');
    ipcRenderer.removeAllListeners('tray:toggle-deafen');
    ipcRenderer.removeAllListeners('tray:disconnect');
  },
  setAdminStatus: (isAdmin, connected) => ipcRenderer.invoke('set-admin-status', isAdmin, connected),
  setVoiceActive: (active) => ipcRenderer.invoke('set-voice-active', active),
  setVoiceMuteState: (muted, deafened) => ipcRenderer.invoke('set-voice-mute-state', muted, deafened),
  onTrayToggleMute: (cb) => ipcRenderer.on('tray:toggle-mute', () => cb()),
  onTrayToggleDeafen: (cb) => ipcRenderer.on('tray:toggle-deafen', () => cb()),
  onTrayDisconnect: (cb) => ipcRenderer.on('tray:disconnect', () => cb()),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  downloadFile: (url, filename) => ipcRenderer.invoke('download-file', url, filename),
  wcPopout: {
    open: () => ipcRenderer.invoke('wcpopout:open'),
    close: () => ipcRenderer.send('wcpopout:close'),
    sendSignal: (data) => ipcRenderer.send('wcpopout:to-popout', data),
    onSignal: (cb) => {
      ipcRenderer.on('wcpopout:from-popout', (_, data) => cb(data));
    },
    onClosed: (cb) => {
      ipcRenderer.on('wcpopout:closed', () => cb());
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('wcpopout:from-popout');
      ipcRenderer.removeAllListeners('wcpopout:closed');
    },
  },
  popout: {
    open: () => ipcRenderer.invoke('popout:open'),
    close: () => ipcRenderer.send('popout:close'),
    sendSignal: (data) => ipcRenderer.send('popout:to-popout', data),
    onSignal: (cb) => {
      ipcRenderer.on('popout:from-popout', (_, data) => cb(data));
    },
    onClosed: (cb) => {
      ipcRenderer.on('popout:closed', () => cb());
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('popout:from-popout');
      ipcRenderer.removeAllListeners('popout:closed');
    },
  },
  screen: {
    onShowPicker: (cb) => ipcRenderer.on('screen:show-picker', (_, sources) => cb(sources)),
    selectSource: (choice) => ipcRenderer.send('screen:source-selected', choice),
    removePickerListener: () => ipcRenderer.removeAllListeners('screen:show-picker'),
    getPlatform: () => ipcRenderer.invoke('screen:get-platform'),
  },
  venmic: {
    isAvailable: () => ipcRenderer.invoke('venmic:is-available'),
    list: () => ipcRenderer.invoke('venmic:list'),
    start: (include, exclude) => ipcRenderer.invoke('venmic:start', include, exclude),
    startSystem: (exclude) => ipcRenderer.invoke('venmic:start-system', exclude),
    stop: () => ipcRenderer.invoke('venmic:stop'),
  },
  iconCache: {
    get: (address, hash) => ipcRenderer.invoke('icon-cache:get', address, hash),
    save: (address, hash, buffer) => ipcRenderer.invoke('icon-cache:save', address, hash, buffer),
    health: (address) => ipcRenderer.invoke('icon-cache:health', address),
    fetch: (address) => ipcRenderer.invoke('icon-cache:fetch', address),
    upload: (address, clientId, contentType, buffer) => ipcRenderer.invoke('icon-cache:upload', address, clientId, contentType, buffer),
    delete: (address, clientId) => ipcRenderer.invoke('icon-cache:delete', address, clientId),
  },
  onProtocolAddServer: (cb) => ipcRenderer.on('protocol:add-server', (_, data) => cb(data)),
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  onNotificationClicked: (cb) => ipcRenderer.on('notification:clicked', (_, action) => cb(action)),
  removeNotificationListener: () => ipcRenderer.removeAllListeners('notification:clicked'),
  setNotificationMode: (mode) => ipcRenderer.send('notification-mode:set', mode),
  onNotificationModeChanged: (cb) => ipcRenderer.on('notification-mode:changed', (_, mode) => cb(mode)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_, version) => cb(version)),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_, status) => cb(status)),
  onUpdateDownloadStart: (cb) => ipcRenderer.on('update:download-start', (_, version) => cb(version)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update:download-progress', (_, data) => cb(data)),
  downloadUpdate: (version) => ipcRenderer.invoke('update:download', version),
  cancelUpdate: () => ipcRenderer.invoke('update:cancel'),
});
