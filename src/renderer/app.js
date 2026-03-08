import serverService from './services/server.js';
import connectionManager from './services/connectionManager.js';
import voiceService from './services/voice.js';
import notificationService from './services/notifications.js';
import { initConnectView, applyTheme, initSidebar, setActiveServer, clearActiveServer, renderSidebar as rerenderSidebar } from './views/connect.js';
import { initServerView, cleanup as cleanupServer, getCurrentChannelId, getFirstChannelId, setFeedbackVolume, isCurrentChannelModerated, hasVoiceGrant, showUnifiedAdminDialog, showRedeemTokenModal, switchChannel, saveState as saveServerState, restoreState as restoreServerState } from './views/server.js';
import { initChatView, cleanup as cleanupChat, switchChannel as switchChatChannel, appendSystemMessage, refreshTimestamps, setChatDisplayMode, openChannelViewTab, getChannelViewTabsState, restoreChannelViewTabs, saveState as saveChatState, restoreState as restoreChatState, initUnreadState } from './views/chat.js';
import { initVoiceView, cleanup as cleanupVoice, setVoiceControlsVisible, setVoiceServerName } from './views/voice.js';
import { setTimeFormat } from './services/timeFormat.js';
import { customAlert, customConfirm } from './services/dialogs.js';

const log = (...args) => console.log('[app]', ...args);

// --- Custom Titlebar ---

document.getElementById('btn-win-minimize').addEventListener('click', () => window.gimodi.windowControl.minimize());
document.getElementById('btn-win-maximize').addEventListener('click', () => window.gimodi.windowControl.maximize());
document.getElementById('btn-win-close').addEventListener('click', () => window.gimodi.windowControl.close());

window.gimodi.getVersion().then(v => {
  document.getElementById('titlebar-version').textContent = `v${v}`;
});

const titlebarMenu = document.getElementById('titlebar-menu');
let openMenuEl = null;
let menuHoverMode = false;

function closeAllMenus() {
  if (openMenuEl) {
    openMenuEl.classList.remove('open');
    const dd = openMenuEl.querySelector('.titlebar-dropdown');
    if (dd) dd.remove();
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
      sub.addEventListener('mouseenter', () => { subDD.style.display = ''; });
      sub.addEventListener('mouseleave', () => { subDD.style.display = 'none'; });
      dd.appendChild(sub);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'titlebar-dropdown-item';
    if (item.disabled) el.classList.add('disabled');
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
      if (openMenuEl === el) { closeAllMenus(); return; }
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

// Settings modal elements
const modalSettings = document.getElementById('modal-settings');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
// Tab nav
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const settingsPanels = document.querySelectorAll('.settings-panel');
// General tab
const themeGrid = document.getElementById('theme-grid');
const checkboxDevMode = document.getElementById('checkbox-dev-mode');
const selectNotificationMode = document.getElementById('select-notification-mode');
const updateChannelGroup = document.getElementById('update-channel-group');
const selectUpdateChannel = document.getElementById('select-update-channel');
const btnCheckUpdates = document.getElementById('btn-check-updates');
// Audio/Video tab
const selectMic = document.getElementById('select-mic');
const selectCamera = document.getElementById('select-camera');
const selectSpeaker = document.getElementById('select-speaker');
const rangeVoiceActivation = document.getElementById('range-voice-activation');
const voiceActivationValue = document.getElementById('voice-activation-value');
const rangeFeedbackVolume = document.getElementById('range-feedback-volume');
const feedbackVolumeValue = document.getElementById('feedback-volume-value');
const checkboxNoiseSuppression = document.getElementById('checkbox-noise-suppression');
const checkboxPushToTalk = document.getElementById('checkbox-push-to-talk');
const cameraPreviewVideo = document.getElementById('camera-preview-video');
const cameraPreviewPlaceholder = document.getElementById('camera-preview-placeholder');
const cameraPreviewContainer = document.getElementById('camera-preview-container');
const btnTestCamera = document.getElementById('btn-test-camera');
const btnTestMic = document.getElementById('btn-test-mic');
const inputPTTKey = document.getElementById('input-ptt-key');
const pttKeyConfig = document.getElementById('ptt-key-config');
const micLevelFill = document.getElementById('mic-level-fill');
let micLevelRAF = null;
// Identities tab
const identityStatus = document.getElementById('identity-status');
const identityCreateForm = document.getElementById('identity-create-form');
const inputIdentityName = document.getElementById('input-identity-name');
const btnIdentityCreateConfirm = document.getElementById('btn-identity-create-confirm');
const btnIdentityCreateCancel = document.getElementById('btn-identity-create-cancel');
const settingsIdentityList = document.getElementById('settings-identity-list');
const btnIdentityNew = document.getElementById('btn-identity-new');
const btnIdentityImport = document.getElementById('btn-identity-import');

const THEMES = [
  { id: 'default', name: 'Deep Ocean', bg: '#0f111a', secondary: '#0f111a', accent: '#82aaff' },
  { id: 'classic-dark', name: 'Classic Dark', bg: '#111111', secondary: '#181818', accent: '#ffffff' },
  { id: 'deeper-blue', name: 'Deeper Blue', bg: '#060d18', secondary: '#0a1525', accent: '#3b82f6' },
  { id: 'deep-ocean', name: 'Space', bg: '#0a1628', secondary: '#0f1f3a', accent: '#4a9eff' },
  { id: 'midnight-purple', name: 'Midnight Purple', bg: '#150f1e', secondary: '#1c1528', accent: '#b388ff' },
  { id: 'forest', name: 'Forest', bg: '#0e1510', secondary: '#141e16', accent: '#66bb6a' },
  { id: 'light', name: 'Light', bg: '#f5f5f5', secondary: '#ffffff', accent: '#1a1a1a' },
];

let _micMeterStream = null;
let _micMeterCtx = null;
let _micMeterAnalyser = null;

async function startMicLevelMeter() {
  stopMicLevelMeter();

  // Open an independent mic stream for monitoring
  try {
    const micId = selectMic.value || undefined;
    const constraints = { audio: micId ? { deviceId: { exact: micId } } : true };
    _micMeterStream = await navigator.mediaDevices.getUserMedia(constraints);

    _micMeterCtx = new AudioContext();
    const source = _micMeterCtx.createMediaStreamSource(_micMeterStream);
    _micMeterAnalyser = _micMeterCtx.createAnalyser();
    _micMeterAnalyser.fftSize = 256;
    source.connect(_micMeterAnalyser);
  } catch (e) {
    console.warn('[app] Mic level meter: could not open mic stream:', e);
  }

  function update() {
    let pct = 0;
    if (_micMeterAnalyser) {
      const data = new Uint8Array(_micMeterAnalyser.frequencyBinCount);
      _micMeterAnalyser.getByteFrequencyData(data);
      pct = Math.min(100, data.reduce((a, b) => a + b, 0) / data.length);
    }
    micLevelFill.style.width = pct + '%';
    micLevelRAF = requestAnimationFrame(update);
  }
  micLevelRAF = requestAnimationFrame(update);
}

function stopMicLevelMeter() {
  if (micLevelRAF) {
    cancelAnimationFrame(micLevelRAF);
    micLevelRAF = null;
  }
  if (_micMeterStream) {
    _micMeterStream.getTracks().forEach(t => t.stop());
    _micMeterStream = null;
  }
  if (_micMeterCtx) {
    _micMeterCtx.close().catch(() => { });
    _micMeterCtx = null;
    _micMeterAnalyser = null;
  }
  micLevelFill.style.width = '0%';
}

// --- Settings persistence ---
let appSettings = {};

async function loadSettings() {
  appSettings = await window.gimodi.settings.load() || {};
  notificationService.updateSettings(appSettings);
  if (appSettings.voiceActivationLevel != null) {
    voiceService.setVoiceActivationLevel(appSettings.voiceActivationLevel);
  }
  if (appSettings.feedbackVolume != null) {
    setFeedbackVolume(appSettings.feedbackVolume / 100);
  }
  if (appSettings.noiseSuppression != null) {
    voiceService.setNoiseSuppression(appSettings.noiseSuppression);
  }
  if (appSettings.theme) {
    applyTheme(appSettings.theme);
  }
  if (appSettings.timeFormat) {
    setTimeFormat(appSettings.timeFormat);
  }
  setChatDisplayMode(appSettings.chatDisplay || 'default');
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
}

function saveSettings() {
  window.gimodi.settings.save(appSettings);
  notificationService.updateSettings(appSettings);
}

// Persist per-user volume changes (identity-based)
voiceService.addEventListener('user-volume-changed', (e) => {
  const { userId, volume } = e.detail;
  if (!appSettings.userVolumes) appSettings.userVolumes = {};
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
loadSettings();

// Menu: Disconnect (disconnects the currently viewed server)
window.gimodi.onDisconnect(() => {
  const addr = connectionManager.activeAddress;
  log('Menu disconnect clicked, active:', addr);
  if (addr) {
    disconnectServer(addr);
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
  document.getElementById(id).classList.add('active');
}

// --- Multi-server helpers ---

function saveCurrentViewState(address) {
  if (!address) return;
  const serverState = saveServerState();
  const chatState = saveChatState();
  connectionManager.saveServerState(address, { server: serverState, chat: chatState });
}

function switchToServer(address) {
  if (!connectionManager.isConnected(address)) return;

  const prevAddress = connectionManager.activeAddress;
  if (prevAddress === address) return;

  // Save current view state
  if (prevAddress && connectionManager.isConnected(prevAddress)) {
    saveCurrentViewState(prevAddress);
  }

  // Clean up current views (but keep voice alive if active on another server)
  const voiceActive = !!connectionManager.voiceAddress;
  if (!voiceActive) {
    cleanupVoice();
  }
  cleanupChat();
  cleanupServer();
  if (!voiceActive) {
    stopMicLevelMeter();
  }

  // Switch active connection
  const oldConn = prevAddress ? connectionManager.getConnection(prevAddress) : null;
  const newConn = connectionManager.getConnection(address);
  connectionManager._rebindProxyListeners(oldConn, newConn);
  connectionManager.activeAddress = address;

  // Restore saved state or re-init
  const saved = connectionManager.getServerState(address);
  if (saved) {
    restoreServerState(saved.server);
    restoreChatState(saved.chat);
    if (!voiceActive) {
      initVoiceView([]);
    }
  }

  setActiveServer(address);
  rerenderSidebar();
  showView('view-server');

  // Update admin icon
  window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'), true);
  updateAdminIconVisibility();

  // Always show voice controls when viewing a connected server
  setVoiceControlsVisible(true);

  log('Switched view to', address);
}

// Listen for view-switch requests from sidebar
window.addEventListener('gimodi:switch-server', (e) => {
  switchToServer(e.detail.address);
});

window.addEventListener('gimodi:disconnect-server', (e) => {
  disconnectServer(e.detail.address);
});

window.addEventListener('gimodi:auto-join-voice', () => {
  if (!getCurrentChannelId()) {
    const channelId = getFirstChannelId();
    if (channelId) switchChannel(channelId);
  }
});

function disconnectServer(address) {
  if (!address) return;
  const conn = connectionManager.getConnection(address);
  if (!conn) return;

  // Save tabs before cleanup
  const wasActive = connectionManager.activeAddress === address;
  if (wasActive) saveChannelTabs();

  // If this server has voice, clean it up
  if (connectionManager.voiceAddress === address) {
    voiceService.cleanup();
    connectionManager.clearVoiceServer();
  }

  conn.disconnect();

  window.dispatchEvent(new CustomEvent('gimodi:disconnected', {
    detail: { address },
  }));
}

// --- Connection events ---

let suppressTabSave = false;

function saveChannelTabs() {
  if (suppressTabSave) return;
  const address = serverService.address;
  if (!address) return;
  if (!appSettings.channelTabs) appSettings.channelTabs = {};
  appSettings.channelTabs[address] = getChannelViewTabsState();
  saveSettings();
}

window.addEventListener('gimodi:channel-tabs-changed', saveChannelTabs);

window.addEventListener('gimodi:connected', async (e) => {
  const data = e.detail;
  const address = data._address; // set by connect flow
  log('Connected to', data.serverName, 'as', data.clientId, 'at', address);

  // If we were viewing a different server, save its state first
  const prevAddress = connectionManager.activeAddress;
  if (prevAddress && prevAddress !== address && connectionManager.isConnected(prevAddress)) {
    saveCurrentViewState(prevAddress);
    if (!connectionManager.voiceAddress) {
      cleanupVoice();
    }
    cleanupChat();
    cleanupServer();
  }

  // Set this as the active (viewed) server
  const prevConn = prevAddress ? connectionManager.getConnection(prevAddress) : null;
  const newConn = connectionManager.getConnection(address);
  connectionManager.activeAddress = address;
  // Bind all proxy listeners (chatService, etc.) to the new connection
  connectionManager._rebindProxyListeners(prevConn, newConn);

  window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'), true);
  setActiveServer(address);
  rerenderSidebar();
  showView('view-server');

  initServerView(data);
  if (!connectionManager.voiceAddress) {
    initVoiceView(data.clients, data.serverName);
  }

  // If the server has no admin yet, prompt the user to redeem the admin token
  if (data.hasAdmin === false) {
    showRedeemTokenModal();
  }

  // User starts in lobby (no channel) - they must double-click to join
  const channelId = null;

  log('Initial channel:', channelId, '(lobby)');
  initChatView(channelId);
  initUnreadState(data.channels, address);

  // Auto-join first channel when connecting via double-click
  if (data.autoJoin) {
    const lobby = data.channels.find(c => c.type !== 'group');
    if (lobby) switchChannel(lobby.id);
  }

  // Suppress auto-saves until all tabs (initial + restored) are open,
  // otherwise openChannelViewTab fires gimodi:channel-tabs-changed and
  // overwrites appSettings.channelTabs[address] before we read it below.
  suppressTabSave = true;

  // Restore persisted channel-view tabs for this server
  const saved = appSettings.channelTabs?.[address];
  if (saved?.tabs?.length) {
    const validChannelIds = new Set(data.channels.map(c => c.id));
    // Use current channel names from server in case they changed
    const channelNameMap = new Map(data.channels.map(c => [c.id, c.name]));
    const tabsToRestore = saved.tabs
      .filter(t => validChannelIds.has(t.channelId))
      .map(t => ({ channelId: t.channelId, channelName: channelNameMap.get(t.channelId) || t.channelName, ...(t.password != null && { password: t.password }) }));
    const activeChannelId = saved.activeChannelId && validChannelIds.has(saved.activeChannelId)
      ? saved.activeChannelId : null;
    if (tabsToRestore.length > 0 || activeChannelId) {
      restoreChannelViewTabs(tabsToRestore, activeChannelId);
    }
  }
  suppressTabSave = false;
  // Single save with the full state (initial tab + all restored tabs)
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
        if (a.major !== b.major) return a.major - b.major;
        return a.minor - b.minor;
      };
      const client = parse(clientVersion);
      const min = parse(data.supportedVersions.minVersion);
      const max = parse(data.supportedVersions.maxVersion);

      if (compare(client, min) < 0) {
        appendSystemMessage(`⚠ Your client version (${clientVersion}) is older than what this server supports (${data.supportedVersions.minVersion}–${data.supportedVersions.maxVersion}). Some features may not work correctly.`);
      } else if (compare(client, max) > 0) {
        appendSystemMessage(`⚠ Your client version (${clientVersion}) is newer than what this server supports (${data.supportedVersions.minVersion}–${data.supportedVersions.maxVersion}). The server may be outdated.`);
      }
    }
  }
});

window.addEventListener('gimodi:disconnected', (e) => {
  const address = e.detail?.address;
  log('Disconnected from', address || 'unknown');
  try {
    // Save channel tabs before cleanup clears them
    saveChannelTabs();

    // If there are other connected servers, handle gracefully
    const remaining = [...connectionManager.connections.keys()].filter(a => a !== address);
    if (remaining.length > 0) {
      const isActiveServer = connectionManager.activeAddress === address;
      const isVoiceServer = connectionManager.voiceAddress === address;

      if (isVoiceServer) {
        voiceService.cleanup();
        connectionManager.clearVoiceServer();
        stopMicLevelMeter();
      }

      // Remove the disconnected connection
      connectionManager.connections.delete(address);
      connectionManager._serverStates?.delete(address);

      if (isActiveServer) {
        // Disconnected server was the one we're viewing - clean up and switch
        if (isVoiceServer || !connectionManager.voiceAddress) {
          cleanupVoice();
        }
        cleanupChat();
        cleanupServer();
        connectionManager.activeAddress = null;
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
    stopMicLevelMeter();
    // Hide any open modals
    modalCreateChannel.classList.add('hidden');
    modalCreateGroup.classList.add('hidden');
    closeSettings();
    // Close unified admin dialog if open
    const adminDialog = document.querySelector('.modal-admin-unified');
    if (adminDialog) adminDialog.remove();
    newChannelName.value = '';
    newChannelPassword.value = '';
    newChannelMaxUsers.value = '';
    newGroupName.value = '';
    connectionManager.activeAddress = null;
    connectionManager.connections.delete(address);
    connectionManager._serverStates?.delete(address);
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
  const activeAddr = connectionManager.activeAddress;
  const voiceAddr = connectionManager.voiceAddress;
  if (voiceAddr && voiceAddr !== activeAddr) {
    log('Voice active on different server, disconnecting from', voiceAddr);
    disconnectServer(voiceAddr);
  }

  // Set this server as the voice server
  connectionManager.setVoiceServer(activeAddr);
  const serverName = document.getElementById('server-name')?.textContent || '';
  setVoiceServerName(serverName);
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
  if (!name) return;

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
  if (!name) return;

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

// --- Settings modal ---

function renderThemeGrid() {
  themeGrid.innerHTML = '';
  const current = document.documentElement.getAttribute('data-theme') || 'default';
  for (const theme of THEMES) {
    const card = document.createElement('div');
    card.className = 'theme-card' + (theme.id === current ? ' active' : '');
    card.innerHTML = `
      <div class="theme-card-preview" style="background: ${theme.bg}">
        <span class="preview-dot" style="background: ${theme.accent}"></span>
        <span class="preview-line" style="background: ${theme.secondary}"></span>
        <span class="preview-line" style="background: ${theme.accent}; flex: 0.5; opacity: 0.5"></span>
      </div>
      <div class="theme-card-name">${theme.name}</div>
    `;
    card.addEventListener('click', () => {
      applyTheme(theme.id);
      appSettings.theme = theme.id;
      saveSettings();
      renderThemeGrid();
    });
    themeGrid.appendChild(card);
  }
}

function switchSettingsTab(tab) {
  settingsNavItems.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  settingsPanels.forEach(p => p.classList.toggle('active', p.id === `settings-panel-${tab}`));
  if (tab === 'audio') {
    populateDeviceSelectors();
    startMicLevelMeter();
  } else {
    stopMicLevelMeter();
    stopCameraPreview();
  }
  if (tab === 'identities') {
    loadSettingsIdentities();
  }
}

settingsNavItems.forEach(t => {
  t.addEventListener('click', () => switchSettingsTab(t.dataset.tab));
});

async function openSettings(tab = 'audio') {
  // Populate all values before showing
  renderThemeGrid();
  document.getElementById('select-time-format').value = appSettings.timeFormat || 'locale';
  document.getElementById('select-chat-display').value = appSettings.chatDisplay || 'default';
  checkboxDevMode.checked = !!appSettings.devMode;
  updateChannelGroup.classList.toggle('hidden', !appSettings.devMode);
  selectUpdateChannel.value = appSettings.updateChannel || 'stable';
  selectNotificationMode.value = appSettings.notificationMode || 'mentions';

  rangeVoiceActivation.value = voiceService.voiceActivationLevel;
  voiceActivationValue.textContent = voiceService.voiceActivationLevel === 0 ? 'Off' : voiceService.voiceActivationLevel;
  const fbVol = appSettings.feedbackVolume ?? 100;
  rangeFeedbackVolume.value = fbVol;
  feedbackVolumeValue.textContent = fbVol;
  checkboxNoiseSuppression.checked = !!appSettings.noiseSuppression;
  checkboxPushToTalk.checked = !!appSettings.pushToTalkEnabled;
  inputPTTKey.value = appSettings.pushToTalkKey || ' ';
  pttKeyConfig.style.display = checkboxPushToTalk.checked ? '' : 'none';

  switchSettingsTab(tab);
  modalSettings.classList.remove('hidden');
}

function closeSettings() {
  modalSettings.classList.add('hidden');
  stopMicLevelMeter();
  stopCameraPreview();
  stopTestTone();
  stopMicLoopback();
  identityCreateForm.classList.add('hidden');
  inputIdentityName.value = '';
  identityStatus.textContent = '';
}

btnSettings.addEventListener('click', () => openSettings('audio'));

btnCloseSettings.addEventListener('click', closeSettings);

modalSettings.addEventListener('click', (e) => {
  if (e.target === modalSettings) closeSettings();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalSettings.classList.contains('hidden')) closeSettings();
});

// General tab handlers
document.getElementById('select-time-format').addEventListener('change', (e) => {
  const fmt = e.target.value;
  setTimeFormat(fmt);
  appSettings.timeFormat = fmt;
  saveSettings();
  refreshTimestamps();
});

document.getElementById('select-chat-display').addEventListener('change', (e) => {
  const mode = e.target.value;
  setChatDisplayMode(mode);
  appSettings.chatDisplay = mode;
  saveSettings();
});

checkboxDevMode.addEventListener('change', () => {
  appSettings.devMode = checkboxDevMode.checked;
  saveSettings();
  window.gimodi.setDevMode(checkboxDevMode.checked);
  updateChannelGroup.classList.toggle('hidden', !checkboxDevMode.checked);
});

selectUpdateChannel.addEventListener('change', () => {
  appSettings.updateChannel = selectUpdateChannel.value;
  saveSettings();
  window.gimodi.setUpdateChannel(selectUpdateChannel.value);
});

btnCheckUpdates.addEventListener('click', () => {
  window.gimodi.menuAction('check-updates');
});

selectNotificationMode.addEventListener('change', () => {
  appSettings.notificationMode = selectNotificationMode.value;
  saveSettings();
});

// Identities tab handlers
async function loadSettingsIdentities() {
  identityStatus.textContent = '';
  settingsIdentityList.innerHTML = '';
  const identities = await window.gimodi.identity.loadAll() || [];
  if (identities.length === 0) {
    identityStatus.textContent = 'No identities yet. Create one to get started.';
    return;
  }
  for (const id of identities) {
    const item = document.createElement('div');
    item.className = 'settings-identity-item';
    const info = document.createElement('div');
    info.className = 'identity-info';
    const name = document.createElement('div');
    name.className = 'identity-name';
    name.textContent = id.name;
    if (id.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'identity-default-badge';
      badge.textContent = ' ✓ Default';
      name.appendChild(badge);
    }
    const fp = document.createElement('div');
    fp.className = 'identity-fingerprint';
    fp.textContent = id.fingerprint;
    info.appendChild(name);
    info.appendChild(fp);
    const actions = document.createElement('div');
    actions.className = 'identity-actions';
    if (!id.isDefault) {
      const btnDefault = document.createElement('button');
      btnDefault.className = 'btn-secondary';
      btnDefault.textContent = 'Set Default';
      btnDefault.addEventListener('click', async () => {
        await window.gimodi.identity.setDefault(id.fingerprint);
        loadSettingsIdentities();
      });
      actions.appendChild(btnDefault);
    }
    const btnExport = document.createElement('button');
    btnExport.className = 'btn-secondary';
    btnExport.textContent = 'Export';
    btnExport.addEventListener('click', async () => {
      await window.gimodi.identity.export(id.fingerprint);
    });
    actions.appendChild(btnExport);
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', async () => {
      if (!await customConfirm(`Delete identity "${id.name}"? This cannot be undone.`)) return;
      await window.gimodi.identity.delete(id.fingerprint);
      loadSettingsIdentities();
    });
    actions.appendChild(btnDelete);
    item.appendChild(info);
    item.appendChild(actions);
    settingsIdentityList.appendChild(item);
  }
}

btnIdentityNew.addEventListener('click', () => {
  identityCreateForm.classList.remove('hidden');
  inputIdentityName.focus();
});

btnIdentityCreateCancel.addEventListener('click', () => {
  identityCreateForm.classList.add('hidden');
  inputIdentityName.value = '';
});

btnIdentityCreateConfirm.addEventListener('click', async () => {
  const name = inputIdentityName.value.trim();
  if (!name) return;
  btnIdentityCreateConfirm.disabled = true;
  identityStatus.textContent = 'Creating...';
  try {
    await window.gimodi.identity.create(name);
    identityCreateForm.classList.add('hidden');
    inputIdentityName.value = '';
    identityStatus.textContent = '';
    loadSettingsIdentities();
  } catch (e) {
    identityStatus.textContent = `Error: ${e.message}`;
  } finally {
    btnIdentityCreateConfirm.disabled = false;
  }
});

inputIdentityName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnIdentityCreateConfirm.click();
  if (e.key === 'Escape') btnIdentityCreateCancel.click();
});

btnIdentityImport.addEventListener('click', async () => {
  identityStatus.textContent = 'Importing...';
  try {
    const result = await window.gimodi.identity.import();
    if (!result.canceled) {
      identityStatus.textContent = `Imported: ${result.identity.name}`;
      loadSettingsIdentities();
    } else {
      identityStatus.textContent = '';
    }
  } catch (e) {
    identityStatus.textContent = `Error: ${e.message}`;
  }
});

selectMic.addEventListener('change', () => {
  voiceService.setMicrophone(selectMic.value || null);
  appSettings.micId = selectMic.value || null;
  saveSettings();
  // Restart mic level meter with the newly selected device
  startMicLevelMeter();
  // If mic loopback is active, restart with newly selected device
  if (_micLoopbackStream) startMicLoopback();
});

selectCamera.addEventListener('change', () => {
  voiceService.setCamera(selectCamera.value || null);
  appSettings.cameraId = selectCamera.value || null;
  saveSettings();
  // If preview is active, restart with newly selected device
  if (_cameraPreviewStream) startCameraPreview();
});

selectSpeaker.addEventListener('change', () => {
  voiceService.setSpeaker(selectSpeaker.value || null);
  appSettings.speakerId = selectSpeaker.value || null;
  saveSettings();
});

// --- Speaker test tone ---

const btnTestSpeaker = document.getElementById('btn-test-speaker');
let _testToneAudio = null;

btnTestSpeaker.addEventListener('click', async () => {
  // If already playing, stop it
  if (_testToneAudio) {
    stopTestTone();
    return;
  }

  try {
    _testToneAudio = new Audio('../../assets/test-tone.wav');
    _testToneAudio.volume = 0.1;

    // Route to selected speaker if supported
    const speakerId = selectSpeaker.value;
    if (speakerId && typeof _testToneAudio.setSinkId === 'function') {
      await _testToneAudio.setSinkId(speakerId);
    }

    btnTestSpeaker.classList.add('playing');
    btnTestSpeaker.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';

    _testToneAudio.addEventListener('ended', stopTestTone);
    _testToneAudio.addEventListener('error', (e) => {
      console.error('[app] Test tone error:', e);
      stopTestTone();
    });

    await _testToneAudio.play();
  } catch (e) {
    console.error('[app] Failed to play test tone:', e);
    stopTestTone();
  }
});

function stopTestTone() {
  if (_testToneAudio) {
    _testToneAudio.pause();
    _testToneAudio.currentTime = 0;
    _testToneAudio.removeEventListener('ended', stopTestTone);
    _testToneAudio = null;
  }
  btnTestSpeaker.classList.remove('playing');
  btnTestSpeaker.innerHTML = '<i class="bi bi-volume-up"></i> Test';
}

rangeVoiceActivation.addEventListener('input', () => {
  const level = parseInt(rangeVoiceActivation.value, 10);
  voiceActivationValue.textContent = level === 0 ? 'Off' : level;
  voiceService.setVoiceActivationLevel(level);
  appSettings.voiceActivationLevel = level;
  saveSettings();
});

rangeFeedbackVolume.addEventListener('input', () => {
  const vol = parseInt(rangeFeedbackVolume.value, 10);
  feedbackVolumeValue.textContent = vol;
  setFeedbackVolume(vol / 100);
  appSettings.feedbackVolume = vol;
  saveSettings();
});

checkboxNoiseSuppression.addEventListener('change', () => {
  const enabled = checkboxNoiseSuppression.checked;
  voiceService.setNoiseSuppression(enabled);
  appSettings.noiseSuppression = enabled;
  saveSettings();
});

checkboxPushToTalk.addEventListener('change', () => {
  const enabled = checkboxPushToTalk.checked;
  const key = inputPTTKey.value || ' ';
  voiceService.setPushToTalk(enabled, key);
  appSettings.pushToTalkEnabled = enabled;
  appSettings.pushToTalkKey = key;
  pttKeyConfig.style.display = enabled ? '' : 'none';
  saveSettings();
});

inputPTTKey.addEventListener('keydown', (e) => {
  e.preventDefault();
  const key = e.key;
  inputPTTKey.value = key;
  voiceService.setPushToTalk(checkboxPushToTalk.checked, key);
  appSettings.pushToTalkKey = key;
  saveSettings();
});

selectNotificationMode.addEventListener('change', () => {
  appSettings.notificationMode = selectNotificationMode.value;
  saveSettings();
});

// --- Notification click handler ---

window.gimodi.onNotificationClicked((action) => {
  if (action.type === 'channel') {
    // Navigate to channel (trigger join via chat view)
    window.dispatchEvent(new CustomEvent('gimodi:navigate-channel', { detail: { channelId: action.channelId } }));
  } else if (action.type === 'dm') {
    // Open DM tab
    window.dispatchEvent(new CustomEvent('gimodi:open-dm', { detail: action }));
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
  const hasAny = adminPerms.some(p => serverService.hasPermission(p));
  btnAdmin.classList.toggle('hidden', !hasAny);
}

btnAdmin.addEventListener('click', () => {
  showUnifiedAdminDialog();
});

// Re-render sidebar when voice server changes (to update voice-active indicator)
connectionManager.addEventListener('voice-server-changed', () => {
  rerenderSidebar();
});

// Handle unexpected connection loss from connectionManager
let _reconnectAbort = null;

connectionManager.addEventListener('connection-lost', (e) => {
  const { address, reason, hadVoice } = e.detail;
  log('Connection lost:', address, reason);

  // Auto-reconnect on server shutdown (not kick/ban)
  // Capture channel state before disconnect cleanup clears it
  const creds = connectionManager.getCredentials(address);
  const previousChannelId = (reason && reason.startsWith('Server shut down:') && creds && hadVoice)
    ? getCurrentChannelId() : null;

  window.dispatchEvent(new CustomEvent('gimodi:disconnected', {
    detail: { address, reason },
  }));

  if (reason && reason.startsWith('Server shut down:') && creds) {
    attemptReconnect(address, creds, previousChannelId);
    return;
  }

  // Clean up stored credentials since we won't reconnect
  connectionManager._credentials.delete(address);

  if (reason) {
    const errorEl = document.getElementById('connect-error');
    if (errorEl) errorEl.textContent = reason;
  }
});

const modalReconnect = document.getElementById('modal-reconnect');
const reconnectStatus = document.getElementById('reconnect-status');
const btnCancelReconnect = document.getElementById('btn-cancel-reconnect');

btnCancelReconnect.addEventListener('click', () => {
  if (_reconnectAbort) {
    _reconnectAbort.abort();
    _reconnectAbort = null;
  }
  modalReconnect.classList.add('hidden');
});

async function attemptReconnect(address, creds, previousChannelId) {
  const controller = new AbortController();
  _reconnectAbort = controller;

  reconnectStatus.textContent = 'Server shut down. Reconnecting...';
  modalReconnect.classList.remove('hidden');

  const MAX_ATTEMPTS = 10;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    if (controller.signal.aborted) break;

    reconnectStatus.textContent = `Reconnecting... (attempt ${i}/${MAX_ATTEMPTS})`;

    await new Promise(r => setTimeout(r, 1000));
    if (controller.signal.aborted) break;

    try {
      const data = await connectionManager.connect(
        address,
        creds.nickname,
        creds.password,
        creds.publicKey
      );
      // Success
      _reconnectAbort = null;
      modalReconnect.classList.add('hidden');
      data._address = address;
      window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
      log('Reconnected to', address);

      // Rejoin previous channel (which also sets up voice)
      if (previousChannelId) {
        const channelStillExists = data.channels?.some(c => c.id === previousChannelId);
        if (channelStillExists) {
          log('Rejoining channel', previousChannelId);
          await switchChannel(previousChannelId);
        }
      }
      return;
    } catch (err) {
      log(`Reconnect attempt ${i} failed:`, err.message);
    }
  }

  // All attempts failed or cancelled
  _reconnectAbort = null;
  modalReconnect.classList.add('hidden');
  connectionManager._credentials.delete(address);

  if (!controller.signal.aborted) {
    const errorEl = document.getElementById('connect-error');
    if (errorEl) errorEl.textContent = 'Failed to reconnect to server.';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Menu: connect to server from history ---

window.gimodi.onConnectServer(async (server) => {
  log('Menu connect-server:', server.address, server.nickname);
  try {
    // If already connected to this server, just switch view
    if (connectionManager.isConnected(server.address)) {
      switchToServer(server.address);
      return;
    }

    // Get identity - use stored fingerprint if available, otherwise default
    let publicKey;
    if (server.identityFingerprint) {
      const allIdentities = await window.gimodi.identity.loadAll();
      const match = allIdentities.find(i => i.fingerprint === server.identityFingerprint);
      publicKey = match ? match.publicKeyArmored : undefined;
    }
    if (!publicKey) {
      const defaultIdentity = await window.gimodi.identity.getDefault();
      publicKey = defaultIdentity ? defaultIdentity.publicKeyArmored : undefined;
    }

    const data = await connectionManager.connect(
      server.address,
      server.nickname,
      server.password || undefined,
      publicKey
    );

    data._address = server.address;
    window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
  } catch (err) {
    log('Menu connect-server failed:', err.message);
    appendSystemMessage(`Connection failed: ${err.message}`);
  }
});

// --- Microphone loopback test ---

let _micLoopbackStream = null;
let _micLoopbackCtx = null;
let _micLoopbackAudio = null;

btnTestMic.addEventListener('click', () => {
  if (_micLoopbackStream) {
    stopMicLoopback();
  } else {
    startMicLoopback();
  }
});

async function startMicLoopback() {
  stopMicLoopback();

  try {
    const micId = selectMic.value || undefined;
    const constraints = { audio: micId ? { deviceId: { exact: micId } } : true };
    _micLoopbackStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Create AudioContext, connect mic to a destination stream
    _micLoopbackCtx = new AudioContext();
    const source = _micLoopbackCtx.createMediaStreamSource(_micLoopbackStream);
    const dest = _micLoopbackCtx.createMediaStreamDestination();
    source.connect(dest);

    // Play through an audio element so we can use setSinkId
    _micLoopbackAudio = new Audio();
    _micLoopbackAudio.srcObject = dest.stream;

    // Route to selected speaker if supported
    const speakerId = selectSpeaker.value;
    if (speakerId && typeof _micLoopbackAudio.setSinkId === 'function') {
      await _micLoopbackAudio.setSinkId(speakerId);
    }

    await _micLoopbackAudio.play();

    btnTestMic.classList.add('playing');
    btnTestMic.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';
  } catch (err) {
    console.error('[app] Mic loopback failed:', err);
    stopMicLoopback();
  }
}

function stopMicLoopback() {
  if (_micLoopbackAudio) {
    _micLoopbackAudio.pause();
    _micLoopbackAudio.srcObject = null;
    _micLoopbackAudio = null;
  }
  if (_micLoopbackCtx) {
    _micLoopbackCtx.close().catch(() => { });
    _micLoopbackCtx = null;
  }
  if (_micLoopbackStream) {
    _micLoopbackStream.getTracks().forEach(t => t.stop());
    _micLoopbackStream = null;
  }
  btnTestMic.classList.remove('playing');
  btnTestMic.innerHTML = '<i class="bi bi-mic"></i> Test';
}

// --- Camera preview ---

let _cameraPreviewStream = null;

btnTestCamera.addEventListener('click', () => {
  if (_cameraPreviewStream) {
    stopCameraPreview();
  } else {
    startCameraPreview();
  }
});

async function startCameraPreview() {
  // Stop any existing preview stream first
  stopCameraPreview();

  const deviceId = selectCamera.value;
  if (!deviceId) {
    // No camera selected - show container with placeholder
    cameraPreviewContainer.classList.remove('hidden');
    cameraPreviewVideo.classList.add('hidden');
    cameraPreviewPlaceholder.classList.remove('hidden');
    btnTestCamera.classList.add('playing');
    btnTestCamera.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';
    return;
  }

  try {
    const constraints = {
      video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 360 } },
      audio: false,
    };
    _cameraPreviewStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraPreviewVideo.srcObject = _cameraPreviewStream;
    cameraPreviewContainer.classList.remove('hidden');
    cameraPreviewVideo.classList.remove('hidden');
    cameraPreviewPlaceholder.classList.add('hidden');
    btnTestCamera.classList.add('playing');
    btnTestCamera.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';
  } catch (err) {
    console.warn('[app] Camera preview failed:', err);
    cameraPreviewContainer.classList.remove('hidden');
    cameraPreviewVideo.classList.add('hidden');
    cameraPreviewPlaceholder.classList.remove('hidden');
  }
}

function stopCameraPreview() {
  if (_cameraPreviewStream) {
    _cameraPreviewStream.getTracks().forEach(t => t.stop());
    _cameraPreviewStream = null;
  }
  cameraPreviewVideo.srcObject = null;
  cameraPreviewContainer.classList.add('hidden');
  cameraPreviewVideo.classList.add('hidden');
  cameraPreviewPlaceholder.classList.remove('hidden');
  btnTestCamera.classList.remove('playing');
  btnTestCamera.innerHTML = '<i class="bi bi-camera-video"></i> Test';
}

// --- Device selectors ---

async function populateDeviceSelectors() {
  try {
    // Need permission first to see device labels
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      // Camera might not exist, try audio only
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch { /* no devices */ }
    }

    const { microphones, cameras, speakers } = await voiceService.getAudioDevices();

    selectMic.innerHTML = '<option value="">Default</option>';
    for (const d of microphones) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphonie ${d.deviceId.slice(0, 8)}`;
      if (d.deviceId === voiceService.selectedMicId) opt.selected = true;
      selectMic.appendChild(opt);
    }

    selectCamera.innerHTML = '<option value="">None</option>';
    for (const d of cameras) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${d.deviceId.slice(0, 8)}`;
      if (d.deviceId === voiceService.selectedCameraId) opt.selected = true;
      selectCamera.appendChild(opt);
    }

    selectSpeaker.innerHTML = '<option value="">Default</option>';
    for (const d of speakers) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Speaker ${d.deviceId.slice(0, 8)}`;
      if (d.deviceId === voiceService.selectedSpeakerId) opt.selected = true;
      selectSpeaker.appendChild(opt);
    }

    log('Devices: mics=', microphones.length, 'cameras=', cameras.length, 'speakers=', speakers.length);
  } catch (e) {
    console.error('[app] Failed to enumerate devices:', e);
  }
}

// --- Sidebar resize ---

{
  const sidebar = document.querySelector('.sidebar');
  const handle = document.querySelector('.sidebar-resize-handle');
  if (sidebar && handle) {
    // Restore saved width
    if (appSettings.sidebarWidth) {
      sidebar.style.width = appSettings.sidebarWidth + 'px';
    }

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
