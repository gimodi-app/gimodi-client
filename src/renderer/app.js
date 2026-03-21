import serverService from './services/server.js';
import connectionManager, { connKey } from './services/connectionManager.js';
import voiceService from './services/voice.js';
import notificationService from './services/notifications.js';
import { initConnectView, applyTheme, initSidebar, setActiveServer, clearActiveServer, renderSidebar as rerenderSidebar, removeServerByIdentity } from './views/connect.js';
import {
  initServerView,
  cleanup as cleanupServer,
  getCurrentChannelId,
  getFirstChannelId,
  setFeedbackVolume,
  isCurrentChannelModerated,
  hasVoiceGrant,
  showUnifiedAdminDialog,
  showRedeemTokenModal,
  switchChannel,
  saveState as saveServerState,
  restoreState as restoreServerState,
  syncLocalVoiceIndicators,
} from './views/server/server.js';
import {
  initChatView,
  cleanup as cleanupChat,
  switchChannel as switchChatChannel,
  appendSystemMessage,
  refreshTimestamps,
  setChatDisplayMode,
  setMediaEmbedPrivacy,
  setVoiceChannel,
  getChannelViewTabsState,
  restoreTabs,
  saveState as saveChatState,
  restoreState as restoreChatState,
  initUnreadState,
  getViewingChannelId,
  isServerChatActive,
} from './views/chat/chat.js';
import { initVoiceView, cleanup as cleanupVoice, setVoiceControlsVisible, setVoiceServerName, syncVoiceControlsUI } from './views/voice/voice.js';
import { setTimeFormat } from './services/timeFormat.js';
import { customAlert, customConfirm } from './services/dialogs.js';
import { initSidePanel } from './views/side-panel.js';
import { initDmView, updateDmServices, refreshDmView, openDmConversation } from './views/direct-messages/dm.js';
import { DmService } from './services/dm.js';
import { FriendsService } from './services/friends.js';
import ServerChatProvider from './services/chat-providers/server.js';
import { initSettingsModal, openSettings, closeSettings, stopMicLevelMeter } from './views/settings/settings-modal.js';
import { initIdentityLogin, showIdentityLogin, hideIdentityLogin } from './views/identity-login.js';
import { initIdentitySwitcher, setActiveIdentity } from './views/identity-switcher.js';

const log = (...args) => console.log('[app]', ...args);

// --- Custom Titlebar ---

document.getElementById('btn-win-minimize').addEventListener('click', () => window.gimodi.windowControl.minimize());
document.getElementById('btn-win-maximize').addEventListener('click', () => window.gimodi.windowControl.maximize());
document.getElementById('btn-win-close').addEventListener('click', () => window.gimodi.windowControl.close());

window.gimodi.getVersion().then((v) => {
  document.getElementById('titlebar-version').textContent = `v${v}`;
});

const titlebarMenu = document.getElementById('titlebar-menu');
let openMenuEl = null;
let menuHoverMode = false;

function closeAllMenus() {
  if (openMenuEl) {
    openMenuEl.classList.remove('open');
    const dd = openMenuEl.querySelector('.titlebar-dropdown');
    if (dd) {
      dd.remove();
    }
    openMenuEl = null;
  }
  menuHoverMode = false;
}

function buildDropdown(items) {
  const dd = document.createElement('div');
  dd.className = 'titlebar-dropdown';
  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'titlebar-dropdown-separator';
      dd.appendChild(sep);
      continue;
    }
    if (item.items) {
      // Submenu
      const sub = document.createElement('div');
      sub.className = 'titlebar-submenu';
      const trigger = document.createElement('div');
      trigger.className = 'titlebar-dropdown-item';
      trigger.textContent = item.label;
      sub.appendChild(trigger);
      const subDD = buildDropdown(item.items);
      subDD.style.display = 'none';
      sub.appendChild(subDD);
      sub.addEventListener('mouseenter', () => {
        subDD.style.display = '';
      });
      sub.addEventListener('mouseleave', () => {
        subDD.style.display = 'none';
      });
      dd.appendChild(sub);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'titlebar-dropdown-item';
    if (item.disabled) {
      el.classList.add('disabled');
    }
    if (item.type === 'radio') {
      const dot = document.createElement('span');
      dot.className = 'radio-dot' + (item.checked ? ' checked' : '');
      el.appendChild(dot);
    }
    const lbl = document.createElement('span');
    lbl.textContent = item.label;
    el.appendChild(lbl);
    if (item.action && !item.disabled) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        window.gimodi.menuAction(item.action, item.data);
        closeAllMenus();
      });
    }
    dd.appendChild(el);
  }
  return dd;
}

function renderMenu(menu) {
  titlebarMenu.innerHTML = '';
  for (const top of menu) {
    const el = document.createElement('div');
    el.className = 'titlebar-menu-item';
    el.textContent = top.label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openMenuEl === el) {
        closeAllMenus();
        return;
      }
      closeAllMenus();
      openMenuEl = el;
      el.classList.add('open');
      el.appendChild(buildDropdown(top.items));
      menuHoverMode = true;
    });
    el.addEventListener('mouseenter', () => {
      if (menuHoverMode && openMenuEl && openMenuEl !== el) {
        closeAllMenus();
        openMenuEl = el;
        el.classList.add('open');
        el.appendChild(buildDropdown(top.items));
        menuHoverMode = true;
      }
    });
    titlebarMenu.appendChild(el);
  }
}

window.gimodi.onMenuUpdate((menu) => {
  renderMenu(menu);
});

document.addEventListener('click', (e) => {
  if (openMenuEl && !e.target.closest('.titlebar-menu-item')) {
    closeAllMenus();
  }
});

// Views
const viewConnect = document.getElementById('view-connect');
const viewServer = document.getElementById('view-server');
const viewDm = document.getElementById('view-dm');

/** @type {DmService|null} */
let dmService = null;
/** @type {FriendsService|null} */
let friendsService = null;
let dmViewInitialized = false;
const dmButton = document.getElementById('btn-dm-view');

/**
 * Shows or hides the unread indicator on the DM button.
 * Skips showing it when the DM view is already active.
 */
function setDmUnread() {
  if (viewDm.classList.contains('active')) {
    return;
  }
  dmButton.classList.add('has-unread');
}

/**
 * Clears the unread indicator on the DM button.
 */
function clearDmUnread() {
  dmButton.classList.remove('has-unread');
}

// Create channel modal
const modalCreateChannel = document.getElementById('modal-create-channel');
const btnConfirmCreate = document.getElementById('btn-confirm-create-channel');
const btnCancelCreate = document.getElementById('btn-cancel-create-channel');
const newChannelName = document.getElementById('new-channel-name');
const newChannelPassword = document.getElementById('new-channel-password');
const newChannelMaxUsers = document.getElementById('new-channel-max-users');
const newChannelParentId = document.getElementById('new-channel-parent-id');
const newChannelTemporary = document.getElementById('new-channel-temporary');

// Create group modal
const modalCreateGroup = document.getElementById('modal-create-group');
const btnConfirmCreateGroup = document.getElementById('btn-confirm-create-group');
const btnCancelCreateGroup = document.getElementById('btn-cancel-create-group');
const newGroupName = document.getElementById('new-group-name');

// Create placeholder modal
const modalCreatePlaceholder = document.getElementById('modal-create-placeholder');
const btnConfirmCreatePlaceholder = document.getElementById('btn-confirm-create-placeholder');
const btnCancelCreatePlaceholder = document.getElementById('btn-cancel-create-placeholder');
const newPlaceholderName = document.getElementById('new-placeholder-name');
const newPlaceholderParentId = document.getElementById('new-placeholder-parent-id');


// --- Settings persistence ---
let appSettings = {};

async function loadSettings() {
  const raw = await window.gimodi.db.getAppSetting('appSettings');
  const loaded = raw ? JSON.parse(raw) : {};
  Object.keys(appSettings).forEach((k) => { if (!(k in loaded)) delete appSettings[k]; });
  Object.assign(appSettings, loaded);
  notificationService.updateSettings(appSettings);
  if (appSettings.voiceActivationLevel !== null && appSettings.voiceActivationLevel !== undefined) {
    voiceService.setVoiceActivationLevel(appSettings.voiceActivationLevel);
  }
  if (appSettings.feedbackVolume !== null && appSettings.feedbackVolume !== undefined) {
    setFeedbackVolume(appSettings.feedbackVolume / 100);
  }
  if (appSettings.noiseSuppression !== null && appSettings.noiseSuppression !== undefined) {
    voiceService.setNoiseSuppression(appSettings.noiseSuppression);
  }
  if (appSettings.theme) {
    applyTheme(appSettings.theme);
  }
  if (appSettings.timeFormat) {
    setTimeFormat(appSettings.timeFormat);
  }
  setChatDisplayMode(appSettings.chatDisplay || 'default');
  setMediaEmbedPrivacy(appSettings.mediaEmbedPrivacy !== false);
  if (appSettings.micId) {
    voiceService.setMicrophone(appSettings.micId);
  }
  if (appSettings.cameraId) {
    voiceService.setCamera(appSettings.cameraId);
  }
  if (appSettings.speakerId) {
    voiceService.setSpeaker(appSettings.speakerId);
  }
  if (appSettings.pushToTalkEnabled) {
    voiceService.setPushToTalk(true, appSettings.pushToTalkKey || ' ');
  }
  // Restore persisted per-user volumes
  if (appSettings.userVolumes) {
    for (const [userId, vol] of Object.entries(appSettings.userVolumes)) {
      voiceService.setUserVolume(userId, vol);
    }
  }
  if (appSettings.sidebarWidth) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.width = appSettings.sidebarWidth + 'px';
  }
  if (appSettings.dmSidebarWidth) {
    const dmSidebar = document.querySelector('.dm-sidebar');
    if (dmSidebar) dmSidebar.style.width = appSettings.dmSidebarWidth + 'px';
  }
}

function saveSettings() {
  window.gimodi.db.setAppSetting('appSettings', JSON.stringify(appSettings));
  notificationService.updateSettings(appSettings);
}

// Persist per-user volume changes (identity-based)
voiceService.addEventListener('user-volume-changed', (e) => {
  const { userId, volume } = e.detail;
  if (!appSettings.userVolumes) {
    appSettings.userVolumes = {};
  }
  if (volume === 100) {
    delete appSettings.userVolumes[userId];
  } else {
    appSettings.userVolumes[userId] = volume;
  }
  saveSettings();
});

// Init connect view and sidebar
initConnectView();
initSidebar();
loadSettings().then(() => {
  initSettingsModal({ appSettings, saveSettings });
});

/**
 * Starts the main app flow after an identity is active.
 * Initializes DM services and auto-connects to saved servers.
 * @param {{ fingerprint: string, name: string, public_key: string }} identity
 */
async function startApp(identity) {
  setActiveIdentity(identity);
  await ensureDmServices(identity.fingerprint);
  rerenderSidebar();
  const servers = (await window.gimodi.db.listServersGrouped()) || [];
  connectionManager.connectAll(
    servers.flatMap((s) => (s.type === 'group' ? s.servers : [s])),
    identity.public_key || undefined,
  );
}

/**
 * Tears down all active connections and services before switching identity or logging out.
 */
function teardownApp() {
  voiceService.cleanup();
  connectionManager.clearVoiceServer();
  connectionManager.disconnectAll();
  dmService = null;
  friendsService = null;
  dmViewInitialized = false;
  setActiveIdentity(null);
  clearActiveServer();
  showView('view-connect');
  rerenderSidebar();
}

/**
 * Switches to a different identity: tear down, switch DB, rebuild.
 * @param {string} fingerprint
 */
async function switchIdentity(fingerprint) {
  teardownApp();
  const identity = await window.gimodi.db.switchIdentity(fingerprint);
  await startApp(identity);
}

/**
 * Logs out the current identity: tear down, clear DB, show login.
 */
async function logoutIdentity() {
  teardownApp();
  await window.gimodi.db.logout();
  showIdentityLogin();
}

// Identity login screen — shown when no active identity
initIdentityLogin((identity) => {
  log('Identity selected:', identity.name);
  startApp(identity);
});

// Identity switcher in sidebar — switch or logout
initIdentitySwitcher({
  onSwitch: switchIdentity,
  onLogout: logoutIdentity,
});

// Check for active identity on startup
(async () => {
  const active = await window.gimodi.db.getActiveIdentity();
  if (active) {
    hideIdentityLogin();
    startApp(active);
  } else {
    showIdentityLogin();
  }
})();

// Menu: Disconnect (leave voice on the currently viewed server)
window.gimodi.onDisconnect(() => {
  const key = connectionManager.activeKey;
  log('Menu disconnect clicked, active:', key);
  if (key) {
    disconnectServer(key);
  }
});

// Menu: Open unified settings dialog (on General tab)
window.gimodi.onOpenUnifiedSettings(() => {
  openSettings('general');
});

// --- View switching ---

function showView(id) {
  viewConnect.classList.remove('active');
  viewServer.classList.remove('active');
  viewDm.classList.remove('active');
  document.getElementById(id).classList.add('active');
  if (id !== 'view-dm') {
    dmButton.classList.remove('active');
  }
}

// --- Multi-server helpers ---

function saveCurrentViewState(key) {
  if (!key) {
    return;
  }
  const serverState = saveServerState();
  const chatState = saveChatState();
  connectionManager.saveServerState(key, { server: serverState, chat: chatState });
}

async function switchToServer(key, options) {
  if (!connectionManager.isConnected(key)) {
    return;
  }

  const prevKey = connectionManager.activeKey;
  if (prevKey === key) {
    if (viewDm.classList.contains('active')) {
      if (isServerChatActive()) {
        setActiveServer(key);
        rerenderSidebar();
        showView('view-server');
      } else {
        cleanupChat();
        const saved = connectionManager.getServerState(key);
        if (saved?.chat) {
          restoreChatState(saved.chat, new ServerChatProvider(saved.chat.currentChannelId || null));
        } else {
          initChatView(null, new ServerChatProvider(null));
        }
        setActiveServer(key);
        rerenderSidebar();
        showView('view-server');
      }
    }
    return;
  }

  if (connectionManager.getMode(key) === 'observe') {
    try {
      const data = await connectionManager.upgrade(key);
      data._connKey = key;
      if (options?.autoJoin) {
        data.autoJoin = true;
      }
      window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
      rerenderSidebar();
    } catch (err) {
      appendSystemMessage(`Upgrade failed: ${err.message}`);
    }
    return;
  }

  // Save current view state
  if (prevKey && connectionManager.isConnected(prevKey)) {
    saveCurrentViewState(prevKey);
  }

  // Clean up current views (but keep voice alive if active on another server)
  const voiceActive = !!connectionManager.voiceKey;
  if (!voiceActive) {
    cleanupVoice();
  }
  cleanupChat();
  cleanupServer();
  if (!voiceActive) {
    stopMicLevelMeter();
  }

  // Switch active connection
  const oldConn = prevKey ? connectionManager.getConnection(prevKey) : null;
  const newConn = connectionManager.getConnection(key);
  connectionManager._rebindProxyListeners(oldConn, newConn);
  connectionManager.activeKey = key;

  // Restore saved state or fetch fresh data
  const saved = connectionManager.getServerState(key);
  if (saved) {
    restoreServerState(saved.server);
    restoreChatState(saved.chat, new ServerChatProvider(saved.chat?.currentChannelId || null));
    if (!voiceActive) {
      initVoiceView([]);
    }

    setActiveServer(key);
    rerenderSidebar();
    showView('view-server');

    window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'), true);
    updateAdminIconVisibility();

    setVoiceControlsVisible(!!connectionManager.voiceKey);
    if (connectionManager.voiceKey) {
      syncVoiceControlsUI();
      syncLocalVoiceIndicators();
    }

    log('Switched view to', key);
  } else {
    // No saved state (e.g. background-connected server clicked for first time)
    // Use cached connect data from background connection
    const connectData = connectionManager.getConnectData(key);
    if (connectData) {
      connectData._connKey = key;
      window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: connectData }));
    } else {
      // Fallback: init with minimal data, request channels separately
      const data = {
        _connKey: key,
        serverName: newConn.serverName,
        serverVersion: newConn.serverVersion,
        clientId: newConn.clientId,
        userId: newConn.userId,
        permissions: [...newConn.permissions],
        maxFileSize: newConn.maxFileSize,
        tempChannelDeleteDelay: newConn.tempChannelDeleteDelay,
        channels: [],
        clients: [],
      };
      window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
    }
  }
}

// Listen for view-switch requests from sidebar
window.addEventListener('gimodi:switch-server', (e) => {
  switchToServer(e.detail.connKey, { autoJoin: e.detail.autoJoin });
});

window.addEventListener('gimodi:disconnect-server', (e) => {
  disconnectServer(e.detail.connKey);
});

window.addEventListener('gimodi:remove-server', async (e) => {
  const { connKey: key, server } = e.detail;
  const conn = connectionManager.getConnection(key);
  if (conn) {
    conn.stopReconnect();
    disconnectServer(key);
  }
  if (server.id) {
    await window.gimodi.db.removeServer(server.id);
  }
  removeServerByIdentity(server.address, server.nickname, server.identityFingerprint);
  rerenderSidebar();
});

window.addEventListener('gimodi:auto-join-voice', () => {
  if (!getCurrentChannelId()) {
    const channelId = getFirstChannelId();
    if (channelId) {
      switchChannel(channelId);
    }
  }
});

function disconnectServer(key) {
  if (!key) {
    return;
  }
  const conn = connectionManager.getConnection(key);
  if (!conn) {
    return;
  }

  // Save tabs before cleanup
  const wasActive = connectionManager.activeKey === key;
  if (wasActive) {
    saveChannelTabs();
  }

  // If this server has voice, clean it up
  if (connectionManager.voiceKey === key) {
    voiceService.cleanup();
    connectionManager.clearVoiceServer();
    setVoiceChannel(null);
  }

  conn.disconnect();

  window.dispatchEvent(
    new CustomEvent('gimodi:disconnected', {
      detail: { connKey: key },
    }),
  );
}

// --- Connection events ---

let suppressTabSave = false;

function saveChannelTabs() {
  if (suppressTabSave) {
    return;
  }
  const key = connectionManager.activeKey;
  if (!key) {
    return;
  }
  if (!appSettings.channelTabs) {
    appSettings.channelTabs = {};
  }
  appSettings.channelTabs[key] = getChannelViewTabsState();
  saveSettings();
}

window.addEventListener('gimodi:channel-tabs-changed', saveChannelTabs);

window.addEventListener('gimodi:connected', async (e) => {
  const data = e.detail;
  const key = data._connKey; // set by connect flow
  log('Connected to', data.serverName, 'as', data.clientId, 'key', key);

  // If we were viewing a different server, save its state first
  const prevKey = connectionManager.activeKey;
  if (prevKey && prevKey !== key && connectionManager.isConnected(prevKey)) {
    saveCurrentViewState(prevKey);
    if (!connectionManager.voiceKey) {
      cleanupVoice();
    }
    cleanupChat();
    cleanupServer();
  }

  // Set this as the active (viewed) server
  const prevConn = prevKey ? connectionManager.getConnection(prevKey) : null;
  const newConn = connectionManager.getConnection(key);
  connectionManager.activeKey = key;
  // Bind all proxy listeners (chatService, etc.) to the new connection
  connectionManager._rebindProxyListeners(prevConn, newConn);

  window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'), true);
  setActiveServer(key);
  rerenderSidebar();
  showView('view-server');

  initServerView(data);
  if (!connectionManager.voiceKey) {
    initVoiceView(data.clients, data.serverName);
  }

  // If the server has no admin yet, prompt the user to redeem the admin token
  if (data.hasAdmin === false) {
    showRedeemTokenModal();
  }

  // User starts in lobby (no channel) - they must double-click to join
  const channelId = null;

  log('Initial channel:', channelId, '(lobby)');
  const serverChatProvider = new ServerChatProvider(channelId);
  initChatView(channelId, serverChatProvider);
  initSidePanel(getViewingChannelId);
  initUnreadState(data.channels, serverService.address);

  // Auto-join channel: string = specific channel ID (reconnect rejoin), true = default channel (double-click)
  if (data.autoJoin) {
    if (typeof data.autoJoin === 'string') {
      const targetChannel = data.channels.find((c) => c.id === data.autoJoin);
      if (targetChannel) {
        switchChannel(targetChannel.id);
      }
    } else {
      const defaultChannel = data.channels.find((c) => c.isDefault && c.type !== 'group') || data.channels.find((c) => c.type !== 'group');
      if (defaultChannel) {
        switchChannel(defaultChannel.id);
      }
    }
  }

  suppressTabSave = true;

  const saved = appSettings.channelTabs?.[key];
  if (saved) {
    const validChannelIds = new Set(data.channels.map((c) => c.id));
    const channelNameMap = new Map(data.channels.map((c) => [c.id, c.name]));
    const cvTabs = (saved.tabs || [])
      .filter((t) => validChannelIds.has(t.channelId))
      .map((t) => ({ channelId: t.channelId, channelName: channelNameMap.get(t.channelId) || t.channelName, ...(t.password !== null && t.password !== undefined && { password: t.password }) }));
    const activeChannelId = saved.activeChannelId && validChannelIds.has(saved.activeChannelId) ? saved.activeChannelId : null;
    const savedTabOrder = saved.tabOrder || [];

    if (cvTabs.length > 0 || activeChannelId) {
      restoreTabs({ cvTabs, savedTabOrder, activeChannelId });
    }
  }
  suppressTabSave = false;
  saveChannelTabs();

  appendSystemMessage(`Connected to ${data.serverName}`);

  // Check client version compatibility
  if (data.supportedVersions) {
    const clientVersion = await window.gimodi.getVersion().catch(() => null);
    if (clientVersion) {
      const parse = (v) => {
        const parts = String(v).split('.');
        return { major: parseInt(parts[0], 10) || 0, minor: parseInt(parts[1], 10) || 0 };
      };
      const compare = (a, b) => {
        if (a.major !== b.major) {
          return a.major - b.major;
        }
        return a.minor - b.minor;
      };
      const client = parse(clientVersion);
      const min = parse(data.supportedVersions.minVersion);
      const max = parse(data.supportedVersions.maxVersion);

      if (compare(client, min) < 0) {
        appendSystemMessage(
          `⚠ Your client version (${clientVersion}) is older than what this server supports (${data.supportedVersions.minVersion}–${data.supportedVersions.maxVersion}). Some features may not work correctly.`,
        );
      } else if (compare(client, max) > 0) {
        appendSystemMessage(
          `⚠ Your client version (${clientVersion}) is newer than what this server supports (${data.supportedVersions.minVersion}–${data.supportedVersions.maxVersion}). The server may be outdated.`,
        );
      }
    }
  }
});

window.addEventListener('gimodi:disconnected', (e) => {
  const key = e.detail?.connKey;
  log('Disconnected from', key || 'unknown');
  try {
    // Save channel tabs before cleanup clears them
    saveChannelTabs();

    // If there are other connected servers, handle gracefully
    const remaining = [...connectionManager.connections.keys()].filter((k) => k !== key);
    if (remaining.length > 0) {
      const isActiveServer = connectionManager.activeKey === key;
      const isVoiceServer = connectionManager.voiceKey === key;

      if (isVoiceServer) {
        voiceService.cleanup();
        connectionManager.clearVoiceServer();
        setVoiceChannel(null);
        stopMicLevelMeter();
      }

      // Remove the disconnected connection
      connectionManager.connections.delete(key);
      connectionManager._serverStates?.delete(key);

      if (isActiveServer) {
        // Disconnected server was the one we're viewing - clean up and switch
        if (isVoiceServer || !connectionManager.voiceKey) {
          cleanupVoice();
        }
        cleanupChat();
        cleanupServer();
        connectionManager.activeKey = null;
        switchToServer(remaining[0]);
      }

      rerenderSidebar();
      return;
    }

    // No remaining connections - full cleanup
    window.gimodi.setAdminStatus(false, false);
    btnAdmin.classList.add('hidden');
    clearActiveServer();
    cleanupVoice();
    cleanupChat();
    cleanupServer();
    voiceService.cleanup();
    connectionManager.clearVoiceServer();
    setVoiceChannel(null);
    stopMicLevelMeter();
    // Hide any open modals
    modalCreateChannel.classList.add('hidden');
    modalCreateGroup.classList.add('hidden');
    closeSettings();
    // Close unified admin dialog if open
    const adminDialog = document.querySelector('.modal-admin-unified');
    if (adminDialog) {
      adminDialog.remove();
    }
    newChannelName.value = '';
    newChannelPassword.value = '';
    newChannelMaxUsers.value = '';
    newGroupName.value = '';
    connectionManager.activeKey = null;
    connectionManager.connections.delete(key);
    connectionManager._serverStates?.delete(key);
    rerenderSidebar();
  } catch (err) {
    console.error('Error during disconnect cleanup:', err);
  }
  showView('view-connect');
});

window.addEventListener('gimodi:channel-changed', async (e) => {
  const { channelId } = e.detail;
  log('Channel changed to:', channelId);
  switchChatChannel(channelId);

  // If voice is active on a different server, disconnect from that server first
  const activeKey = connectionManager.activeKey;
  const voiceKey = connectionManager.voiceKey;
  if (voiceKey && voiceKey !== activeKey) {
    log('Voice active on different server, disconnecting from', voiceKey);
    disconnectServer(voiceKey);
  }

  // Set this server as the voice server
  connectionManager.setVoiceServer(activeKey);
  const serverName = document.getElementById('server-name')?.textContent || '';
  setVoiceServerName(serverName);
  setVoiceChannel(channelId);
  await setupVoice();
});

async function setupVoice() {
  try {
    const channelId = getCurrentChannelId();
    if (!channelId) {
      log('setupVoice: no channel');
      return;
    }

    log('setupVoice: starting for channel', channelId);
    voiceService.cleanup();

    // 1. Get router RTP capabilities
    log('Step 1: get-rtp-capabilities');
    const { rtpCapabilities } = await serverService.request('voice:get-rtp-capabilities', {});
    log('Step 1 done, codecs:', rtpCapabilities?.codecs?.length);

    // 2. Load device
    log('Step 2: setup device');
    await voiceService.setupDevice(rtpCapabilities);

    // 3. Send client capabilities
    log('Step 3: send client rtp-capabilities');
    await serverService.request('voice:rtp-capabilities', {
      rtpCapabilities: voiceService.device.rtpCapabilities,
    });

    // 4. Create transports
    log('Step 4: create transports');
    await voiceService.createTransports();

    // 5. Start mic (skip in moderated channels unless user has bypass_moderation permission or voice-granted)
    const moderated = isCurrentChannelModerated();
    const canSpeak = !moderated || serverService.hasPermission('channel.bypass_moderation') || hasVoiceGrant(serverService.clientId);
    if (canSpeak) {
      log('Step 5: start microphone');
      await voiceService.startMicrophone();
    } else {
      log('Step 5: skipping microphone (moderated channel, no voice permission)');
    }

    log('setupVoice: complete');
  } catch (e) {
    console.error('[app] setupVoice FAILED:', e);
    appendSystemMessage(`Voice failed: ${e.message}`);
  }
}

// --- Voice moderation events ---

window.addEventListener('gimodi:voice-granted', async () => {
  log('Voice granted - starting microphone');
  try {
    await voiceService.startMicrophone();
  } catch (e) {
    console.error('[app] Failed to start mic after voice grant:', e);
    appendSystemMessage(`Failed to start mic: ${e.message}`);
  }
});

window.addEventListener('gimodi:voice-revoked', () => {
  log('Voice revoked - stopping microphone');
  voiceService.stopMicrophone();
  appendSystemMessage('Your voice permission has been revoked.');
});

window.addEventListener('gimodi:channel-moderated-changed', async (e) => {
  const { moderated } = e.detail;
  if (!moderated) {
    // Channel became unmoderated - start mic if not already producing
    log('Channel unmoderated - starting microphone');
    try {
      await voiceService.startMicrophone();
    } catch (e) {
      console.error('[app] Failed to start mic after unmoderate:', e);
    }
  } else {
    // Channel became moderated - stop mic if no bypass_moderation permission and not granted
    if (!serverService.hasPermission('channel.bypass_moderation') && !hasVoiceGrant(serverService.clientId)) {
      log('Channel moderated - stopping microphone');
      voiceService.stopMicrophone();
      appendSystemMessage('Channel is now moderated. Right-click your name to request voice.');
    }
  }
});

// --- Create channel modal ---

btnConfirmCreate.addEventListener('click', async () => {
  const name = newChannelName.value.trim();
  if (!name) {
    return;
  }

  const payload = {
    name,
    password: newChannelPassword.value || undefined,
  };
  const maxUsers = parseInt(newChannelMaxUsers.value);
  if (maxUsers > 0) {
    payload.maxUsers = maxUsers;
  }
  if (newChannelParentId.value) {
    payload.parentId = newChannelParentId.value;
  }
  if (newChannelTemporary.checked) {
    payload.temporary = true;
  }

  try {
    await serverService.request('channel:create', payload);
    modalCreateChannel.classList.add('hidden');
    newChannelName.value = '';
    newChannelPassword.value = '';
    newChannelMaxUsers.value = '';
    newChannelParentId.value = '';
    newChannelTemporary.checked = false;
  } catch (e) {
    await customAlert(e.message);
  }
});

btnCancelCreate.addEventListener('click', () => {
  modalCreateChannel.classList.add('hidden');
  newChannelName.value = '';
  newChannelPassword.value = '';
  newChannelMaxUsers.value = '';
  newChannelParentId.value = '';
  newChannelTemporary.checked = false;
});

// --- Create group modal ---

btnConfirmCreateGroup.addEventListener('click', async () => {
  const name = newGroupName.value.trim();
  if (!name) {
    return;
  }

  try {
    await serverService.request('channel:create', { name, type: 'group' });
    modalCreateGroup.classList.add('hidden');
    newGroupName.value = '';
  } catch (e) {
    await customAlert(e.message);
  }
});

btnCancelCreateGroup.addEventListener('click', () => {
  modalCreateGroup.classList.add('hidden');
  newGroupName.value = '';
});

btnConfirmCreatePlaceholder.addEventListener('click', async () => {
  const name = newPlaceholderName.value.trim();
  if (!name) {
    return;
  }

  const parentId = newPlaceholderParentId.value || undefined;
  try {
    await serverService.request('channel:create', { name, type: 'placeholder', parentId });
    modalCreatePlaceholder.classList.add('hidden');
    newPlaceholderName.value = '';
    newPlaceholderParentId.value = '';
  } catch (e) {
    await customAlert(e.message);
  }
});

btnCancelCreatePlaceholder.addEventListener('click', () => {
  modalCreatePlaceholder.classList.add('hidden');
  newPlaceholderName.value = '';
  newPlaceholderParentId.value = '';
});

// --- Notification click handler ---

window.gimodi.onNotificationClicked((action) => {
  if (action.type === 'channel') {
    // Navigate to channel (trigger join via chat view)
    window.dispatchEvent(new CustomEvent('gimodi:navigate-channel', { detail: { channelId: action.channelId } }));
  }
});

// --- Admin icon (next to server name) ---

const btnAdmin = document.getElementById('btn-admin');

// Show/hide admin icon based on permissions (on connect)
window.addEventListener('gimodi:connected', () => {
  updateAdminIconVisibility();
});

serverService.addEventListener('server:permissions-changed', (e) => {
  // Permissions are updated in server.js onPermissionsChanged; use event data here
  const perms = new Set(e.detail?.permissions || []);
  btnAdmin.classList.toggle('hidden', !perms.has('server.admin_menu'));
});

function updateAdminIconVisibility() {
  const adminPerms = ['server.admin_menu'];
  const hasAny = adminPerms.some((p) => serverService.hasPermission(p));
  btnAdmin.classList.toggle('hidden', !hasAny);
}

btnAdmin.addEventListener('click', () => {
  showUnifiedAdminDialog();
});

// Re-render sidebar when voice server changes (to update voice-active indicator)
connectionManager.addEventListener('voice-server-changed', () => {
  rerenderSidebar();
  window.gimodi.setVoiceActive(!!connectionManager.voiceKey);
  setVoiceControlsVisible(!!connectionManager.voiceKey);
});

/** @type {Map<string, string>} Stores the voice channel ID per connection key for rejoin after reconnect. */
const _pendingVoiceRejoin = new Map();

// Handle unexpected connection loss from connectionManager
connectionManager.addEventListener('connection-lost', (e) => {
  const { key, reason, hadVoice, willReconnect } = e.detail;
  log('Connection lost:', key, reason, 'willReconnect:', willReconnect);

  if (willReconnect) {
    if (hadVoice && connectionManager.activeKey === key) {
      const channelId = getCurrentChannelId();
      if (channelId) {
        _pendingVoiceRejoin.set(key, channelId);
      }
      voiceService.cleanup();
      connectionManager.clearVoiceServer();
      setVoiceChannel(null);
      stopMicLevelMeter();
    }
    appendSystemMessage(`Connection lost. Reconnecting...`);
    rerenderSidebar();
    return;
  }

  // Kick/ban/intentional - dispatch full disconnected event
  window.dispatchEvent(
    new CustomEvent('gimodi:disconnected', {
      detail: { connKey: key, reason },
    }),
  );

  if (reason) {
    appendSystemMessage(reason);
  }
});

// Handle successful reconnection
connectionManager.addEventListener('reconnected', (e) => {
  const { key, data } = e.detail;
  log('Reconnected to', key);
  rerenderSidebar();

  const rejoinChannelId = _pendingVoiceRejoin.get(key);
  _pendingVoiceRejoin.delete(key);

  if (connectionManager.activeKey === key) {
    if (rejoinChannelId) {
      data.autoJoin = rejoinChannelId;
    }
    data._connKey = key;
    window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
  }
  appendSystemMessage('Reconnected to server.');
});

// Handle background connections (auto-connect on startup)
connectionManager.addEventListener('background-connected', (e) => {
  const { key, data, server } = e.detail;
  log('Background connected:', key, data.serverName);

  const fpIdx = key.indexOf('\0');
  if (fpIdx >= 0 && !dmService) {
    ensureDmServices(key.slice(fpIdx + 1));
  }

  if (data.serverName && data.serverName !== server.name) {
    server.name = data.serverName;
    window.gimodi.db.addServer(server);
  }

  const conn = connectionManager.getConnection(key);
  if (conn && data.mode === 'observe') {
    conn.addEventListener('notify:mention', (ev) => {
      const d = ev.detail;
      const sName = conn.serverName || server.name || server.address;
      notificationService.show(`Mention in ${sName}`, `${d.nickname} in #${d.channelName}: ${d.content}`);
      rerenderSidebar();
    });
    conn.addEventListener('server:poked', (ev) => {
      const d = ev.detail;
      const sName = conn.serverName || server.name || server.address;
      notificationService.show(`Poke from ${sName}`, d.message || 'You were poked.');
    });
  }

  rerenderSidebar();
});

// Update sidebar when connection status changes
connectionManager.addEventListener('connection-status-changed', () => {
  rerenderSidebar();
});

// --- Menu: connect to server from history ---

window.gimodi.onConnectServer(async (server) => {
  log('Menu connect-server:', server.address, server.nickname);
  try {
    const key = connKey(server.address, server.identityFingerprint);
    // If already connected to this server, just switch view
    if (connectionManager.isConnected(key)) {
      switchToServer(key);
      return;
    }

    const activeIdentity = await window.gimodi.db.getActiveIdentity();
    const publicKey = activeIdentity?.public_key || undefined;

    const data = await connectionManager.connect(key, server.address, server.nickname, server.password || undefined, publicKey);

    data._connKey = key;
    window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
  } catch (err) {
    log('Menu connect-server failed:', err.message);
    appendSystemMessage(`Connection failed: ${err.message}`);
  }
});


// --- Sidebar resize ---

{
  const sidebar = document.querySelector('.sidebar');
  const handle = document.querySelector('.sidebar-resize-handle');
  if (sidebar && handle) {
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (e) => {
        const newWidth = Math.min(500, Math.max(180, startWidth + e.clientX - startX));
        sidebar.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        appSettings.sidebarWidth = Math.round(sidebar.getBoundingClientRect().width);
        saveSettings();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

{
  const dmSidebar = document.querySelector('.dm-sidebar');
  const dmHandle = document.querySelector('.dm-sidebar-resize-handle');
  if (dmSidebar && dmHandle) {
    let startX, startWidth;

    dmHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = dmSidebar.getBoundingClientRect().width;
      dmHandle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (e) => {
        const newWidth = Math.min(480, Math.max(160, startWidth + e.clientX - startX));
        dmSidebar.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        dmHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        appSettings.dmSidebarWidth = Math.round(dmSidebar.getBoundingClientRect().width);
        saveSettings();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

// --- Direct Messages ---

/**
 * Initializes or reinitializes the DM and Friends services for the given fingerprint.
 * @param {string} fingerprint
 */
async function ensureDmServices(fingerprint) {
  if (dmService?._fingerprint === fingerprint) {
    return;
  }

  const identity = await window.gimodi.db.getActiveIdentity();
  const publicKey = identity?.public_key ?? '';
  dmService = new DmService(fingerprint, publicKey);
  friendsService = new FriendsService(fingerprint);
  dmService.addEventListener('message-received', setDmUnread);
  dmService.addEventListener('conversation-invite', setDmUnread);
  friendsService.addEventListener('friend:request-received', setDmUnread);
  if (!dmViewInitialized) {
    initDmView(dmService, friendsService);
    dmViewInitialized = true;
  } else {
    updateDmServices(dmService, friendsService);
  }
  dmService.fetchConversations().catch(() => {});
}

dmButton.addEventListener('click', () => {
  if (!dmService) {
    customAlert('Connect to a server with an identity to use Direct Messages.');
    return;
  }
  const activeKey = connectionManager.activeKey;
  if (activeKey) {
    saveCurrentViewState(activeKey);
  }
  clearDmUnread();
  refreshDmView();
  showView('view-dm');
  dmButton.classList.add('active');
  setActiveServer(null);
  rerenderSidebar();
});

window.addEventListener('gimodi:open-dm', (e) => {
  const { fingerprint } = e.detail;
  if (!dmService) {
    customAlert('Connect to a server with an identity to use Direct Messages.');
    return;
  }
  const activeKey = connectionManager.activeKey;
  if (activeKey) {
    saveCurrentViewState(activeKey);
  }
  clearDmUnread();
  showView('view-dm');
  dmButton.classList.add('active');
  setActiveServer(null);
  rerenderSidebar();
  openDmConversation(fingerprint);
});

window.addEventListener('gimodi:add-friend', async (e) => {
  const { fingerprint, nickname } = e.detail;
  if (!friendsService) {
    customAlert('Connect with an identity to add friends.');
    return;
  }
  try {
    await friendsService.sendRequest(fingerprint);
    console.log('[app] Friend request sent successfully to', fingerprint);
  } catch (err) {
    console.warn('[app] Friend request failed, falling back to local add:', err);
    friendsService.addFriend(fingerprint, nickname);
  }
});


/**
 * DevTools utilities. Callable via gimodiDebug.clearAllFriends() in the console.
 */
window.gimodiDebug = {
  /**
   * Resets in-memory DM and friends state, re-fetches from server.
   */
  clearAllFriends() {
    if (dmService) {
      dmService._conversations.clear();
      dmService._saveConversationsToStorage();
      dmService.fetchConversations().catch(() => {});
    }
    if (friendsService) {
      friendsService._pendingRequests.clear();
    }
    console.log('[gimodi] Reset friends/DM state.');
  },
};
