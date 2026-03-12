const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gimodi', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  history: {
    load: () => ipcRenderer.invoke('history:load'),
    save: (entries) => ipcRenderer.invoke('history:save', entries),
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    add: (server) => ipcRenderer.invoke('servers:add', server),
    remove: (address, nickname, identityFingerprint) => ipcRenderer.invoke('servers:remove', address, nickname, identityFingerprint),
    reorder: (fromIndex, toIndex) => ipcRenderer.invoke('servers:reorder', fromIndex, toIndex),
    save: (items) => ipcRenderer.invoke('servers:save', items),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  identity: {
    loadAll: () => ipcRenderer.invoke('identity:load-all'),
    create: (name) => ipcRenderer.invoke('identity:create', name),
    delete: (fingerprint) => ipcRenderer.invoke('identity:delete', fingerprint),
    rename: (fingerprint, newName) => ipcRenderer.invoke('identity:rename', fingerprint, newName),
    setDefault: (fingerprint) => ipcRenderer.invoke('identity:set-default', fingerprint),
    getDefault: () => ipcRenderer.invoke('identity:get-default'),
    encrypt: (recipientPublicKeys, plaintext) => ipcRenderer.invoke('identity:encrypt', recipientPublicKeys, plaintext),
    decrypt: (armoredMessage) => ipcRenderer.invoke('identity:decrypt', armoredMessage),
    export: (fingerprint) => ipcRenderer.invoke('identity:export', fingerprint),
    import: () => ipcRenderer.invoke('identity:import'),
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
    onSignal: (cb) => { ipcRenderer.on('wcpopout:from-popout', (_, data) => cb(data)); },
    onClosed: (cb) => { ipcRenderer.on('wcpopout:closed', () => cb()); },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('wcpopout:from-popout');
      ipcRenderer.removeAllListeners('wcpopout:closed');
    },
  },
  popout: {
    open: () => ipcRenderer.invoke('popout:open'),
    close: () => ipcRenderer.send('popout:close'),
    sendSignal: (data) => ipcRenderer.send('popout:to-popout', data),
    onSignal: (cb) => { ipcRenderer.on('popout:from-popout', (_, data) => cb(data)); },
    onClosed: (cb) => { ipcRenderer.on('popout:closed', () => cb()); },
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
