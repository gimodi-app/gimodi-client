import serverService from '../services/server.js';
import connectionManager from '../services/connectionManager.js';
import voiceService from '../services/voice.js';
import screenShareService from '../services/screen.js';
import { getServerIcon } from '../services/iconCache.js';
import { setChannelName, openChannelViewTab, setVoiceChannel, switchToChannelTab, updateChatBadges, updateChatNickColors, isChannelUnread } from './chat.js';
import { setNickname } from '../services/nicknameCache.js';
import { customAlert, customConfirm, customPrompt } from '../services/dialogs.js';
import { renderAnalyticsPanel } from './server-analytics.js';
import { showFileBrowserModal } from './server-file-browser.js';
import { renderRolesPanel } from './server-admin-roles.js';
import { renderUsersPanel } from './server-admin-users.js';
import { renderTokensPanel, renderBansPanel, showRedeemTokenModal, renderAuditLogPanel } from './server-admin-misc.js';
import { renderSettingsPanel } from './server-admin-settings.js';
import { createEventHandlers } from './server-events.js';

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return 'Just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  return `${Math.floor(months / 12)}y ago`;
}

const channelTree = document.getElementById('channel-tree');

// Root-level drop zone: dropping a channel on empty tree space moves it to top level
channelTree.addEventListener('dragover', (e) => {
  if (e.target !== channelTree) {
    return;
  }
  if (!serverService.hasPermission('channel.update')) {
    return;
  }
  if (e.dataTransfer.types.includes('application/x-gimodi-user')) {
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
channelTree.addEventListener('drop', (e) => {
  if (e.target !== channelTree) {
    return;
  }
  if (!serverService.hasPermission('channel.update')) {
    return;
  }
  if (e.dataTransfer.getData('application/x-gimodi-user')) {
    return;
  }
  e.preventDefault();
  const draggedId = e.dataTransfer.getData('text/plain');
  if (!draggedId) {
    return;
  }
  const sibCount = channels.filter((c) => c.id !== draggedId && !c.parentId).length;
  moveChannel(draggedId, null, sibCount);
});

const serverNameEl = document.getElementById('server-name');
const btnLeaveVoice = document.getElementById('btn-leave-voice');
const btnCreateChannel = document.getElementById('btn-create-channel');

let channels = [];
let clients = [];
let currentChannelId = null;
const collapsedGroups = new Set();
let createDropdownInitialized = false;
const talkingClients = new Set();
const webcamClients = new Set();
const mutedClients = new Set(); // clientIds with mic muted
const deafenedClients = new Set(); // clientIds with deafened
const voiceGrantedClients = new Set();
const voiceRequestClients = new Set();
const streamingClients = new Set();
let _currentIconHash = null;

const sndConnect = new Audio('../../assets/connect.mp3');
const sndDisconnect = new Audio('../../assets/disconnect.mp3');
const sndScreenStart = new Audio('../../assets/screen-share-start.mp3');
const sndScreenStop = new Audio('../../assets/screen-share-stop.mp3');
const sndWebcamStart = new Audio('../../assets/webcam-start.mp3');
const sndWebcamStop = new Audio('../../assets/webcam-stop.mp3');
const sndPoke = new Audio('../../assets/poke.mp3');
let feedbackVolume = 0.1;

function playSound(audio) {
  console.log('playSound', audio);
  audio.volume = feedbackVolume;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function setFeedbackVolume(vol) {
  feedbackVolume = vol;
}

/**
 * @returns {number} Current feedback volume (0–1)
 */
export function getFeedbackVolume() {
  return feedbackVolume;
}

const eventHandlers = createEventHandlers({
  getChannels: () => channels,
  setChannels: (c) => { channels = c; },
  getClients: () => clients,
  setClients: (c) => { clients = c; },
  getCurrentChannelId: () => currentChannelId,
  setCurrentChannelId: (id) => { currentChannelId = id; },
  talkingClients,
  webcamClients,
  mutedClients,
  deafenedClients,
  voiceGrantedClients,
  voiceRequestClients,
  streamingClients,
  renderChannelTree: () => renderChannelTree(),
  playSound,
  switchChannel: (id) => switchChannel(id),
  updateChannelTabLabel: (id) => updateChannelTabLabel(id),
  sounds: {
    connect: sndConnect,
    disconnect: sndDisconnect,
    screenStart: sndScreenStart,
    screenStop: sndScreenStop,
    webcamStart: sndWebcamStart,
    webcamStop: sndWebcamStop,
  },
  btnLeaveVoice,
  btnCreateChannel,
});

const {
  onForceJoined, onClientJoined, onClientLeft, onAdminChanged,
  onRoleColorChanged, onPermissionsChanged, onClientMoved,
  onChannelUserJoined, onChannelUserLeft, onChannelCreated,
  onChannelDeleted, onChannelUpdated, onWebcamStarted, onWebcamStopped,
  onLocalWebcamStarted, onLocalWebcamStopped, onPeerScreenStarted,
  onPeerScreenStoppedIndicator, onLocalScreenStartedIndicator,
  onLocalScreenStoppedIndicator, onPeerMuteStateChanged,
  onLocalMuteChanged, onLocalDeafenChanged, syncLocalVoiceIndicators,
  onVoiceGranted, onVoiceRevoked, onVoiceRequested,
  onVoiceRequestCancelled, updateMuteIcons, onTalkingChanged,
} = eventHandlers;

export function initServerView(data) {
  channels = data.channels;
  clients = data.clients;
  // User starts in lobby - no channel until they explicitly join one
  currentChannelId = null;

  voiceGrantedClients.clear();
  for (const c of data.voiceGrantedClients || []) {
    voiceGrantedClients.add(c);
  }
  voiceRequestClients.clear();
  for (const c of data.voiceRequestClients || []) {
    voiceRequestClients.add(c);
  }

  // Make client and channel lists globally accessible for chat mentions
  window.gimodiClients = clients;
  window.gimodiChannels = channels;

  serverNameEl.textContent = data.serverName;

  // Load server icon
  _currentIconHash = data.iconHash || null;
  const sidebarIcon = document.querySelector('.sidebar-header-icon');
  if (_currentIconHash && sidebarIcon) {
    getServerIcon(serverService.address, _currentIconHash).then((url) => {
      if (url) {
        sidebarIcon.src = url;
      }
    });
  } else if (sidebarIcon) {
    sidebarIcon.src = '../../assets/icon.png';
  }

  // Listen for live icon changes
  serverService.addEventListener('server:icon-changed', (e) => {
    const icon = document.querySelector('.sidebar-header-icon');
    if (!icon) {
      return;
    }
    const { hash } = e.detail;
    _currentIconHash = hash || null;
    if (hash) {
      getServerIcon(serverService.address, hash).then((url) => {
        if (url) {
          icon.src = url;
        }
      });
    } else {
      icon.src = '../../assets/icon.png';
    }
  });

  // Initialize mute/deafen states from client list and seed nickname cache
  for (const c of clients) {
    if (c.muted) {
      mutedClients.add(c.id);
    }
    if (c.deafened) {
      deafenedClients.add(c.id);
    }
    if (c.userId && c.nickname) {
      setNickname(c.userId, c.nickname);
    }
  }

  renderChannelTree();

  btnLeaveVoice.addEventListener('click', handleLeaveVoice);
  window.gimodi.onTrayDisconnect(handleLeaveVoice);
  btnLeaveVoice.classList.add('hidden');
  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const canCreateGroup = serverService.hasPermission('channel.group_create');
  const canCreatePlaceholder = serverService.hasPermission('channel.placeholder_create');
  btnCreateChannel.style.display = canCreate || canCreateTemp || canCreateGroup || canCreatePlaceholder ? '' : 'none';
  btnCreateChannel.addEventListener('click', onCreateChannelClick);
  if (!createDropdownInitialized) {
    initCreateDropdown();
    createDropdownInitialized = true;
  }

  // Server events
  serverService.addEventListener('server:client-joined', onClientJoined);
  serverService.addEventListener('server:client-left', onClientLeft);
  serverService.addEventListener('server:client-moved', onClientMoved);
  serverService.addEventListener('channel:user-joined', onChannelUserJoined);
  serverService.addEventListener('channel:user-left', onChannelUserLeft);
  serverService.addEventListener('channel:created', onChannelCreated);
  serverService.addEventListener('channel:deleted', onChannelDeleted);
  serverService.addEventListener('channel:updated', onChannelUpdated);
  serverService.addEventListener('channel:joined', onForceJoined);
  serverService.addEventListener('server:admin-changed', onAdminChanged);
  serverService.addEventListener('role:color-changed', onRoleColorChanged);

  // Voice activity
  voiceService.addEventListener('talking-changed', onTalkingChanged);

  // Webcam indicators
  serverService.addEventListener('webcam:started', onWebcamStarted);
  serverService.addEventListener('webcam:stopped', onWebcamStopped);
  voiceService.addEventListener('webcam-started', onLocalWebcamStarted);
  voiceService.addEventListener('webcam-stopped', onLocalWebcamStopped);

  // Screen share indicators
  serverService.addEventListener('screen:started', onPeerScreenStarted);
  serverService.addEventListener('screen:stopped', onPeerScreenStoppedIndicator);
  screenShareService.addEventListener('started', onLocalScreenStartedIndicator);
  screenShareService.addEventListener('stopped', onLocalScreenStoppedIndicator);

  // Mute/deafen indicators
  serverService.addEventListener('voice:mute-state-changed', onPeerMuteStateChanged);
  voiceService.addEventListener('mute-changed', onLocalMuteChanged);
  voiceService.addEventListener('deafen-changed', onLocalDeafenChanged);

  // Voice moderation
  serverService.addEventListener('channel:voice-granted', onVoiceGranted);
  serverService.addEventListener('channel:voice-revoked', onVoiceRevoked);
  serverService.addEventListener('channel:voice-requested', onVoiceRequested);
  serverService.addEventListener('channel:voice-request-cancelled', onVoiceRequestCancelled);

  // Poke
  serverService.addEventListener('server:poked', onPoked);

  // Server-initiated disconnect (kick/ban)
  serverService.addEventListener('disconnected', onServerDisconnected);

  // Live permission update (role assigned/removed by admin)
  serverService.addEventListener('server:permissions-changed', onPermissionsChanged);

  // Menu actions
  window.gimodi.onMenuAction(onMenuAction);

  // Clear stale cached passwords when a channel rejects access
  window.addEventListener('gimodi:channel-access-error', onChannelAccessError);

  // Re-render channel tree when unread state changes
  window.addEventListener('gimodi:channel-unread-changed', onChannelUnreadChanged);

  // User context menu from chat nicknames
  window.addEventListener('gimodi:user-context-menu', onUserContextMenuEvent);
}

export function cleanup() {
  serverService.removeEventListener('server:client-joined', onClientJoined);
  serverService.removeEventListener('server:client-left', onClientLeft);
  serverService.removeEventListener('server:client-moved', onClientMoved);
  serverService.removeEventListener('channel:user-joined', onChannelUserJoined);
  serverService.removeEventListener('channel:user-left', onChannelUserLeft);
  serverService.removeEventListener('channel:created', onChannelCreated);
  serverService.removeEventListener('channel:deleted', onChannelDeleted);
  serverService.removeEventListener('channel:updated', onChannelUpdated);
  serverService.removeEventListener('channel:joined', onForceJoined);
  serverService.removeEventListener('server:admin-changed', onAdminChanged);
  serverService.removeEventListener('role:color-changed', onRoleColorChanged);
  voiceService.removeEventListener('talking-changed', onTalkingChanged);
  serverService.removeEventListener('webcam:started', onWebcamStarted);
  serverService.removeEventListener('webcam:stopped', onWebcamStopped);
  voiceService.removeEventListener('webcam-started', onLocalWebcamStarted);
  voiceService.removeEventListener('webcam-stopped', onLocalWebcamStopped);
  serverService.removeEventListener('screen:started', onPeerScreenStarted);
  serverService.removeEventListener('screen:stopped', onPeerScreenStoppedIndicator);
  screenShareService.removeEventListener('started', onLocalScreenStartedIndicator);
  screenShareService.removeEventListener('stopped', onLocalScreenStoppedIndicator);
  serverService.removeEventListener('voice:mute-state-changed', onPeerMuteStateChanged);
  voiceService.removeEventListener('mute-changed', onLocalMuteChanged);
  voiceService.removeEventListener('deafen-changed', onLocalDeafenChanged);
  serverService.removeEventListener('disconnected', onServerDisconnected);
  serverService.removeEventListener('channel:voice-granted', onVoiceGranted);
  serverService.removeEventListener('channel:voice-revoked', onVoiceRevoked);
  serverService.removeEventListener('channel:voice-requested', onVoiceRequested);
  serverService.removeEventListener('channel:voice-request-cancelled', onVoiceRequestCancelled);
  serverService.removeEventListener('server:poked', onPoked);
  serverService.removeEventListener('server:permissions-changed', onPermissionsChanged);
  window.removeEventListener('gimodi:channel-access-error', onChannelAccessError);
  window.removeEventListener('gimodi:channel-unread-changed', onChannelUnreadChanged);
  window.removeEventListener('gimodi:user-context-menu', onUserContextMenuEvent);
  btnLeaveVoice.removeEventListener('click', handleLeaveVoice);
  btnCreateChannel.removeEventListener('click', onCreateChannelClick);
  document.getElementById('create-dropdown').classList.add('hidden');
  window.gimodi.removeMenuListeners();
  talkingClients.clear();
  webcamClients.clear();
  streamingClients.clear();
  mutedClients.clear();
  deafenedClients.clear();
  voiceGrantedClients.clear();
  voiceRequestClients.clear();
  collapsedGroups.clear();
  savedPasswords.clear();
  currentChannelId = null;
  channels = [];
  clients = [];
  _currentIconHash = null;
  window.gimodiClients = null;
  window.gimodiChannels = null;
}

export function saveState() {
  return {
    channels: JSON.parse(JSON.stringify(channels)),
    clients: JSON.parse(JSON.stringify(clients)),
    currentChannelId,
    collapsedGroups: [...collapsedGroups],
    savedPasswords: [...savedPasswords.entries()],
    talkingClients: [...talkingClients],
    webcamClients: [...webcamClients],
    mutedClients: [...mutedClients],
    deafenedClients: [...deafenedClients],
    voiceGrantedClients: [...voiceGrantedClients],
    voiceRequestClients: [...voiceRequestClients],
    streamingClients: [...streamingClients],
    serverName: serverNameEl.textContent,
    iconHash: _currentIconHash,
  };
}

export function restoreState(state) {
  if (!state) {
    return;
  }
  channels = state.channels || [];
  clients = state.clients || [];
  window.gimodiChannels = channels;
  currentChannelId = state.currentChannelId || null;
  collapsedGroups.clear();
  for (const g of state.collapsedGroups || []) {
    collapsedGroups.add(g);
  }
  savedPasswords.clear();
  for (const [k, v] of state.savedPasswords || []) {
    savedPasswords.set(k, v);
  }
  talkingClients.clear();
  for (const c of state.talkingClients || []) {
    talkingClients.add(c);
  }
  webcamClients.clear();
  for (const c of state.webcamClients || []) {
    webcamClients.add(c);
  }
  mutedClients.clear();
  for (const c of state.mutedClients || []) {
    mutedClients.add(c);
  }
  deafenedClients.clear();
  for (const c of state.deafenedClients || []) {
    deafenedClients.add(c);
  }
  voiceGrantedClients.clear();
  for (const c of state.voiceGrantedClients || []) {
    voiceGrantedClients.add(c);
  }
  voiceRequestClients.clear();
  for (const c of state.voiceRequestClients || []) {
    voiceRequestClients.add(c);
  }
  streamingClients.clear();
  for (const c of state.streamingClients || []) {
    streamingClients.add(c);
  }

  window.gimodiClients = clients;
  serverNameEl.textContent = state.serverName || '';

  // Re-attach event listeners (same as initServerView but without re-init)
  serverService.addEventListener('server:client-joined', onClientJoined);
  serverService.addEventListener('server:client-left', onClientLeft);
  serverService.addEventListener('server:client-moved', onClientMoved);
  serverService.addEventListener('channel:user-joined', onChannelUserJoined);
  serverService.addEventListener('channel:user-left', onChannelUserLeft);
  serverService.addEventListener('channel:created', onChannelCreated);
  serverService.addEventListener('channel:deleted', onChannelDeleted);
  serverService.addEventListener('channel:updated', onChannelUpdated);
  serverService.addEventListener('channel:joined', onForceJoined);
  serverService.addEventListener('server:admin-changed', onAdminChanged);
  serverService.addEventListener('role:color-changed', onRoleColorChanged);
  voiceService.addEventListener('talking-changed', onTalkingChanged);
  serverService.addEventListener('webcam:started', onWebcamStarted);
  serverService.addEventListener('webcam:stopped', onWebcamStopped);
  voiceService.addEventListener('webcam-started', onLocalWebcamStarted);
  voiceService.addEventListener('webcam-stopped', onLocalWebcamStopped);
  serverService.addEventListener('screen:started', onPeerScreenStarted);
  serverService.addEventListener('screen:stopped', onPeerScreenStoppedIndicator);
  screenShareService.addEventListener('started', onLocalScreenStartedIndicator);
  screenShareService.addEventListener('stopped', onLocalScreenStoppedIndicator);
  serverService.addEventListener('voice:mute-state-changed', onPeerMuteStateChanged);
  voiceService.addEventListener('mute-changed', onLocalMuteChanged);
  voiceService.addEventListener('deafen-changed', onLocalDeafenChanged);
  serverService.addEventListener('channel:voice-granted', onVoiceGranted);
  serverService.addEventListener('channel:voice-revoked', onVoiceRevoked);
  serverService.addEventListener('channel:voice-requested', onVoiceRequested);
  serverService.addEventListener('channel:voice-request-cancelled', onVoiceRequestCancelled);
  serverService.addEventListener('server:poked', onPoked);
  serverService.addEventListener('disconnected', onServerDisconnected);
  serverService.addEventListener('server:permissions-changed', onPermissionsChanged);
  window.addEventListener('gimodi:channel-access-error', onChannelAccessError);
  window.addEventListener('gimodi:channel-unread-changed', onChannelUnreadChanged);
  btnLeaveVoice.addEventListener('click', handleLeaveVoice);
  btnCreateChannel.addEventListener('click', onCreateChannelClick);
  window.gimodi.onMenuAction(onMenuAction);

  // Restore server icon
  _currentIconHash = state.iconHash || null;
  const sidebarIcon = document.querySelector('.sidebar-header-icon');
  if (sidebarIcon) {
    if (_currentIconHash && serverService.address) {
      getServerIcon(serverService.address, _currentIconHash)
        .then((url) => {
          if (url) {
            sidebarIcon.src = url;
          }
        })
        .catch(() => {
          sidebarIcon.src = '../../assets/icon.png';
        });
    } else {
      sidebarIcon.src = '../../assets/icon.png';
    }
  }

  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const canCreateGroup = serverService.hasPermission('channel.group_create');
  const canCreatePlaceholder = serverService.hasPermission('channel.placeholder_create');
  btnCreateChannel.style.display = canCreate || canCreateTemp || canCreateGroup || canCreatePlaceholder ? '' : 'none';

  renderChannelTree();

  serverService
    .request('channel:list', {})
    .then((result) => {
      if (result && result.channels) {
        channels = result.channels;
        window.gimodiChannels = channels;
        renderChannelTree();
      }
    })
    .catch(() => {});
}

export function getCurrentChannelId() {
  return currentChannelId;
}

/**
 * Returns the current list of connected clients.
 * @returns {Array} The array of client objects
 */
export function getClients() {
  return clients;
}

export function getFirstChannelId() {
  const ch = channels.find((c) => c.type !== 'group');
  return ch ? ch.id : null;
}

export function isCurrentChannelModerated() {
  const ch = channels.find((c) => c.id === currentChannelId);
  return !!ch?.moderated;
}

export function hasVoiceGrant(clientId) {
  return voiceGrantedClients.has(clientId);
}

function getChannelName(id) {
  return channels.find((c) => c.id === id)?.name || 'Unknown';
}

function handleLeaveVoice() {
  if (!currentChannelId) {
    return;
  }
  playSound(sndDisconnect);
  leaveVoiceChannel();
}

/**
 * @returns {void}
 */
function leaveVoiceChannel() {
  if (screenShareService.isSharing) {
    screenShareService.stopSharing();
  }
  voiceService.cleanup();
  serverService.send('channel:leave', {});
  const self = clients.find((c) => c.id === serverService.clientId);
  if (self) {
    self.channelId = null;
  }
  currentChannelId = null;
  btnLeaveVoice.classList.add('hidden');
  connectionManager.clearVoiceServer();
  setVoiceChannel(null);
  renderChannelTree();
}

async function onPoked(e) {
  playSound(sndPoke);
  const { fromNickname, message } = e.detail;
  if (message) {
    await customAlert(`You were poked by ${fromNickname}:\n${message}`);
  } else {
    await customAlert(`You were poked by ${fromNickname}!`);
  }
}

function onServerDisconnected(_e) {
  // Server-initiated disconnection (kick/ban/shutdown) is now handled by
  // connectionManager._onConnectionLost → app.js 'connection-lost' handler.
  // Nothing to do here - cleanup is triggered by gimodi:disconnected event.
}

function formatDeleteDelay(seconds) {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    const h = seconds / 3600;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60;
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

function showCreateChannelModal() {
  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const tempGroup = document.getElementById('new-channel-temporary-group');
  const tempCheckbox = document.getElementById('new-channel-temporary');
  const title = document.getElementById('create-channel-title');
  const hint = document.getElementById('create-channel-hint');
  const delayText = formatDeleteDelay(serverService.tempChannelDeleteDelay || 180);

  if (canCreate && canCreateTemp) {
    // User can create both - show checkbox unchecked
    title.textContent = 'Create Channel';
    hint.style.display = 'none';
    hint.textContent = '';
    tempGroup.style.display = '';
    tempCheckbox.checked = false;
    // Update label with current delay
    document.getElementById('new-channel-temporary-label').textContent = `Temporary (auto-deletes after ${delayText} of inactivity)`;
  } else if (canCreateTemp && !canCreate) {
    // User can only create temporary
    title.textContent = 'Create Temporary Channel';
    hint.textContent = `This channel will be automatically deleted after ${delayText} of being empty.`;
    hint.style.display = '';
    tempGroup.style.display = 'none';
    tempCheckbox.checked = true;
  } else {
    // User can only create permanent - hide checkbox
    title.textContent = 'Create Channel';
    hint.style.display = 'none';
    hint.textContent = '';
    tempGroup.style.display = 'none';
    tempCheckbox.checked = false;
  }

  document.getElementById('modal-create-channel').classList.remove('hidden');
}

function initCreateDropdown() {
  const dropdown = document.getElementById('create-dropdown');
  const channelItem = document.getElementById('create-dropdown-channel');
  const groupItem = document.getElementById('create-dropdown-group');
  const placeholderItem = document.getElementById('create-dropdown-placeholder');

  channelItem.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    showCreateChannelModal();
  });
  groupItem.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    document.getElementById('modal-create-group').classList.remove('hidden');
  });
  placeholderItem.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    document.getElementById('new-placeholder-parent-id').value = '';
    document.getElementById('modal-create-placeholder').classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btnCreateChannel.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

function onCreateChannelClick() {
  showCreateDropdown();
}

function showCreateDropdown() {
  const dropdown = document.getElementById('create-dropdown');
  const channelItem = document.getElementById('create-dropdown-channel');
  const groupItem = document.getElementById('create-dropdown-group');
  const placeholderItem = document.getElementById('create-dropdown-placeholder');

  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const canCreateGroup = serverService.hasPermission('channel.group_create');
  const canCreatePlaceholder = serverService.hasPermission('channel.placeholder_create');
  const canCreateAnyChannel = canCreate || canCreateTemp;

  channelItem.style.display = canCreateAnyChannel ? '' : 'none';
  groupItem.style.display = canCreateGroup ? '' : 'none';
  placeholderItem.style.display = canCreatePlaceholder ? '' : 'none';

  const optionCount = [canCreateAnyChannel, canCreateGroup, canCreatePlaceholder].filter(Boolean).length;
  if (optionCount === 0) {
    return;
  }

  if (optionCount === 1) {
    if (canCreateAnyChannel) {
      showCreateChannelModal();
      return;
    }
    if (canCreateGroup) {
      document.getElementById('modal-create-group').classList.remove('hidden');
      return;
    }
    if (canCreatePlaceholder) {
      document.getElementById('new-placeholder-parent-id').value = '';
      document.getElementById('modal-create-placeholder').classList.remove('hidden');
      return;
    }
  }

  dropdown.classList.toggle('hidden');
}

function askChannelPassword() {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-channel-password');
    const input = document.getElementById('input-channel-password');
    const btnConfirm = document.getElementById('btn-confirm-channel-password');
    const btnCancel = document.getElementById('btn-cancel-channel-password');

    input.value = '';
    modal.classList.remove('hidden');
    input.focus();

    function cleanup() {
      modal.classList.add('hidden');
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      modal.removeEventListener('click', onBackdrop);
    }

    function onConfirm() {
      cleanup();
      resolve(input.value);
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === 'Escape') {
        onCancel();
      }
    }
    function onBackdrop(e) {
      if (e.target === modal) {
        onCancel();
      }
    }

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
    modal.addEventListener('click', onBackdrop);
  });
}

const savedPasswords = new Map();

function onChannelAccessError(e) {
  const { channelId, code } = e.detail;
  if (code === 'BAD_PASSWORD') {
    savedPasswords.delete(channelId);
  }
}

function onChannelUnreadChanged() {
  renderChannelTree();
}

export async function switchChannel(channelId) {
  if (channelId === currentChannelId) {
    return;
  }

  const channel = channels.find((c) => c.id === channelId);
  if (!channel) {
    return;
  }
  if (channel.type === 'group') {
    return;
  }

  let password;
  if (channel.hasPassword && !serverService.hasPermission('channel.bypass_password')) {
    // Try saved password first
    if (savedPasswords.has(channelId)) {
      password = savedPasswords.get(channelId);
    } else {
      password = await askChannelPassword();
      if (password === null) {
        return;
      }
    }
  }

  try {
    if (screenShareService.isSharing) {
      screenShareService.stopSharing();
    }
    voiceService.cleanup();
    const data = await serverService.request('channel:join', { channelId, password });
    currentChannelId = channelId;
    btnLeaveVoice.classList.remove('hidden');
    updateChannelTabLabel(channelId);

    if (data.moderated && data.voiceGranted) {
      for (const id of data.voiceGranted) {
        voiceGrantedClients.add(id);
      }
    }
    if (data.moderated && data.voiceRequests) {
      for (const id of data.voiceRequests) {
        voiceRequestClients.add(id);
      }
    }

    // Save password on successful join
    if (channel.hasPassword && password !== null && password !== undefined) {
      savedPasswords.set(channelId, password);
    }

    // Update local client data
    const self = clients.find((c) => c.id === serverService.clientId);
    if (self) {
      self.channelId = channelId;
    }

    renderChannelTree();
    playSound(sndConnect);

    // Open a channel-view tab for the joined channel before notifying chat,
    // so the chat layer can detect it and skip the redundant channel-tab switch.
    openChannelViewTab(channelId, channel.name, password, !!data.readRestricted, !!data.writeRestricted);

    window.dispatchEvent(new CustomEvent('gimodi:channel-changed', { detail: { channelId } }));
  } catch (err) {
    // If saved password was wrong, clear it and ask again
    if (savedPasswords.has(channelId)) {
      savedPasswords.delete(channelId);
      return switchChannel(channelId);
    }
    await customAlert(err.message);
  }
}

// --- Rendering ---

// Find the index of a reference channel among its siblings (excluding the dragged channel)
function siblingIndex(refId, parentId, draggedId) {
  const siblings = channels.filter((c) => c.id !== draggedId && (c.parentId || null) === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = siblings.findIndex((c) => c.id === refId);
  return idx === -1 ? siblings.length : idx;
}

function moveChannel(channelId, newParentId, insertIndex) {
  // Recalculate sort orders for siblings at the target level
  const siblings = channels.filter((c) => c.id !== channelId && (c.parentId || null) === newParentId).sort((a, b) => a.sortOrder - b.sortOrder);

  // Build new ordered list with the channel inserted at insertIndex
  const newOrder = [...siblings];
  const idx = Math.max(0, Math.min(insertIndex, newOrder.length));
  newOrder.splice(idx, 0, { id: channelId });

  // Send updates
  const updates = [];
  for (let i = 0; i < newOrder.length; i++) {
    const entry = newOrder[i];
    if (entry.id === channelId) {
      updates.push({ id: channelId, parentId: newParentId, sortOrder: i });
    } else if (entry.sortOrder !== i) {
      updates.push({ id: entry.id, sortOrder: i });
    }
  }
  for (const u of updates) {
    serverService.send('channel:update', { channelId: u.id, ...u });
  }
}

function renderChannelTree() {
  channelTree.innerHTML = '';

  // Build parent/child structure
  const topLevel = channels.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (parentId) => channels.filter((c) => c.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);

  for (const ch of topLevel) {
    if (ch.type === 'group') {
      renderGroup(ch, childrenOf(ch.id));
    } else if (ch.type === 'placeholder') {
      renderPlaceholder(ch, false);
    } else {
      renderChannel(ch, false);
      for (const child of childrenOf(ch.id)) {
        if (child.type === 'placeholder') {
          renderPlaceholder(child, true);
        } else {
          renderChannel(child, true);
        }
      }
    }
  }
}

function renderGroup(group, children) {
  const collapsed = collapsedGroups.has(group.id);

  const el = document.createElement('div');
  el.className = 'channel-group';
  el.dataset.channelId = group.id;

  const toggle = document.createElement('span');
  toggle.className = 'channel-group-toggle';
  toggle.textContent = collapsed ? '\u25B8' : '\u25BE';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'channel-group-name';
  nameSpan.textContent = group.name.toUpperCase();

  el.appendChild(toggle);
  el.appendChild(nameSpan);

  // Add channel button on group
  if (serverService.hasPermission('channel.create') || serverService.hasPermission('channel.create_temporary')) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-icon channel-group-add';
    addBtn.title = 'Create Channel';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Open create channel modal with parentId pre-set
      document.getElementById('new-channel-parent-id').value = group.id;
      document.getElementById('modal-create-channel').classList.remove('hidden');
    });
    el.appendChild(addBtn);
  }

  // Toggle collapse
  el.addEventListener('click', () => {
    if (collapsed) {
      collapsedGroups.delete(group.id);
    } else {
      collapsedGroups.add(group.id);
    }
    renderChannelTree();
  });

  // Context menu for groups
  el.addEventListener('contextmenu', (e) => showGroupContextMenu(e, group));

  // Drag & drop: groups can be reordered but not nested
  if (serverService.hasPermission('channel.update')) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', group.id);
      e.dataTransfer.setData('application/x-gimodi-group', 'true');
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  // Drop target: accept channels being dropped into group
  if (serverService.hasPermission('channel.update') || serverService.hasPermission('user.move')) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const isGroup = e.dataTransfer.types.includes('application/x-gimodi-group');
      const isUser = e.dataTransfer.types.includes('application/x-gimodi-user');
      el.classList.remove('drop-above', 'drop-below', 'drop-into');
      if (isUser) {
        // Can't drop users into groups
      } else {
        const rect = el.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < rect.height * 0.25) {
          el.classList.add('drop-above');
        } else if (y > rect.height * 0.75) {
          el.classList.add('drop-below');
        } else {
          if (isGroup) {
            // Groups reorder, don't nest
            el.classList.add(y < rect.height / 2 ? 'drop-above' : 'drop-below');
          } else {
            el.classList.add('drop-into');
          }
        }
      }
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-above', 'drop-below', 'drop-into');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-above', 'drop-below', 'drop-into');

      const isGroupDrag = e.dataTransfer.getData('application/x-gimodi-group');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === group.id) {
        return;
      }

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;

      const gi = siblingIndex(group.id, null, draggedId);
      if (y < rect.height * 0.25) {
        // Above group → root level, before this group
        moveChannel(draggedId, null, gi);
      } else if (y > rect.height * 0.75) {
        // Below group → root level, after this group
        moveChannel(draggedId, null, gi + 1);
      } else if (isGroupDrag) {
        // Group in middle zone → reorder based on half
        moveChannel(draggedId, null, y < rect.height / 2 ? gi : gi + 1);
      } else {
        // Channel in middle zone → drop into group
        moveChannel(draggedId, group.id, 0);
      }
    });
  }

  channelTree.appendChild(el);

  // Render children if not collapsed
  if (!collapsed) {
    for (const child of children) {
      if (child.type === 'placeholder') {
        renderPlaceholder(child, true, group.id);
      } else {
        renderChannel(child, true, group.id);
      }
    }
  }

  // Drop zone after group (between groups) for moving channels to root level
  if (serverService.hasPermission('channel.update')) {
    const spacer = document.createElement('div');
    spacer.className = 'channel-group-drop-spacer';
    spacer.style.cssText = 'height:6px;position:relative';
    spacer.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-gimodi-user')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      spacer.classList.add('drop-above');
    });
    spacer.addEventListener('dragleave', () => {
      spacer.classList.remove('drop-above');
    });
    spacer.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      spacer.classList.remove('drop-above');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId) {
        return;
      }
      moveChannel(draggedId, null, siblingIndex(group.id, null, draggedId) + 1);
    });
    channelTree.appendChild(spacer);
  }
}

function renderPlaceholder(ch, isChild, _groupId) {
  const el = document.createElement('div');
  el.className = `channel-item placeholder${isChild ? ' child' : ''}`;
  el.dataset.channelId = ch.id;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'placeholder-name';
  nameSpan.textContent = ch.name;
  el.appendChild(nameSpan);

  el.addEventListener('contextmenu', (e) => showPlaceholderContextMenu(e, ch));

  if (serverService.hasPermission('channel.update')) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', ch.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  if (serverService.hasPermission('channel.update')) {
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-gimodi-user')) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      el.classList.remove('drop-above', 'drop-below');
      el.classList.add(y < rect.height / 2 ? 'drop-above' : 'drop-below');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-above', 'drop-below');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-above', 'drop-below');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === ch.id) {
        return;
      }
      const targetParent = ch.parentId || null;
      const ci = siblingIndex(ch.id, targetParent, draggedId);
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      moveChannel(draggedId, targetParent, y < rect.height / 2 ? ci : ci + 1);
    });
  }

  channelTree.appendChild(el);
}

function renderChannel(ch, isChild, _groupId) {
  const el = document.createElement('div');
  el.className = `channel-item${isChild ? ' child' : ''}${ch.id === currentChannelId ? ' active' : ''}${isChannelUnread(ch.id) ? ' unread' : ''}`;
  el.dataset.channelId = ch.id;

  // Build occupancy display
  const userCount = clients.filter((c) => c.channelId === ch.id).length;
  const occupancy = ch.maxUsers ? ` <span style="color:var(--text-muted);font-size:0.9em">(${userCount}/${ch.maxUsers})</span>` : '';

  el.innerHTML = `
    <span class="channel-icon">#</span>
    <span>${escapeHtml(ch.name)}${occupancy}</span>
    ${ch.isTemporary ? '<span class="channel-temp" title="Temporary channel"><i class="bi bi-hourglass-split"></i></span>' : ''}
    ${ch.hasPassword ? '<span class="channel-lock"><i class="bi bi-lock"></i></span>' : ''}
  `;
  let clickTimer = null;
  el.addEventListener('click', () => {
    if (clickTimer) {
      return;
    } // second click will be handled by dblclick
    clickTimer = setTimeout(async () => {
      clickTimer = null;
      // Single click: open chat-only view
      if (ch.id === currentChannelId) {
        switchToChannelTab();
      } else {
        let password;
        if (ch.hasPassword && !serverService.hasPermission('channel.bypass_password')) {
          if (savedPasswords.has(ch.id)) {
            password = savedPasswords.get(ch.id);
          } else {
            password = await askChannelPassword();
            if (password === null) {
              return;
            }
            savedPasswords.set(ch.id, password);
          }
        }
        openChannelViewTab(ch.id, ch.name, password);
      }
    }, 250);
  });
  el.addEventListener('dblclick', () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    switchChannel(ch.id);
  });
  el.addEventListener('contextmenu', (e) => showChannelContextMenu(e, ch));

  // Drag & drop for users who can update channels
  if (serverService.hasPermission('channel.update')) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', ch.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }

  if (serverService.hasPermission('user.move') || serverService.hasPermission('channel.update')) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const isUserDrag = e.dataTransfer.types.includes('application/x-gimodi-user');
      el.classList.remove('drop-above', 'drop-below', 'drop-into');
      if (isUserDrag) {
        el.classList.add('drop-into');
      } else {
        const rect = el.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < rect.height * 0.25) {
          el.classList.add('drop-above');
        } else if (y > rect.height * 0.75) {
          el.classList.add('drop-below');
        } else {
          el.classList.add('drop-into');
        }
      }
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-above', 'drop-below', 'drop-into');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-above', 'drop-below', 'drop-into');

      // User drop - move user to this channel
      const userId = e.dataTransfer.getData('application/x-gimodi-user');
      if (userId) {
        serverService.request('admin:move-user', { clientId: userId, channelId: ch.id }).catch(async (err) => await customAlert(err.message));
        return;
      }

      // Channel drop - reorder channels
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === ch.id) {
        return;
      }

      // Don't allow nesting groups
      const isGroupDrag = e.dataTransfer.getData('application/x-gimodi-group');
      const targetParent = ch.parentId || null;
      const ci = siblingIndex(ch.id, targetParent, draggedId);

      if (isGroupDrag) {
        // Groups can only be reordered at top-level
        moveChannel(draggedId, null, siblingIndex(ch.id, null, draggedId));
        return;
      }

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;

      if (y < rect.height * 0.25) {
        moveChannel(draggedId, targetParent, ci);
      } else if (y > rect.height * 0.75) {
        moveChannel(draggedId, targetParent, ci + 1);
      } else {
        // Only allow dropping into groups, not into regular channels
        const targetCh = channels.find((c) => c.id === ch.id);
        if (targetCh && targetCh.type === 'group') {
          moveChannel(draggedId, ch.id, 0);
        } else {
          moveChannel(draggedId, targetParent, ci + 1);
        }
      }
    });
  }

  channelTree.appendChild(el);

  // Show users in this channel
  const usersInChannel = clients.filter((c) => c.channelId === ch.id).sort((a, b) => (a.rolePosition ?? Infinity) - (b.rolePosition ?? Infinity) || a.nickname.localeCompare(b.nickname));
  if (usersInChannel.length > 0) {
    const usersEl = document.createElement('div');
    usersEl.className = 'channel-users';
    for (const u of usersInChannel) {
      const userEl = document.createElement('div');
      userEl.className = `channel-user${u.id === serverService.clientId ? ' self' : ''}`;
      const indicator = document.createElement('span');
      indicator.dataset.clientId = u.id;
      const isTalkingInCurrentChannel = talkingClients.has(u.id) && ch.id === currentChannelId;
      if (deafenedClients.has(u.id)) {
        indicator.className = 'voice-indicator mute-status';
        indicator.innerHTML = '<i class="bi bi-volume-mute"></i>';
        indicator.title = 'Deafened';
      } else if (mutedClients.has(u.id)) {
        indicator.className = 'voice-indicator mute-status';
        indicator.innerHTML = '<i class="bi bi-mic-mute"></i>';
        indicator.title = 'Muted';
      } else {
        indicator.className = `voice-indicator${isTalkingInCurrentChannel ? ' talking' : ''}`;
      }
      userEl.appendChild(indicator);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'channel-user-name';
      nameSpan.textContent = u.nickname;
      userEl.appendChild(nameSpan);

      if (u.badge) {
        const roleBadge = document.createElement('span');
        roleBadge.className = 'admin-badge';
        roleBadge.textContent = u.badge;
        userEl.appendChild(roleBadge);
      }

      if (ch.moderated && voiceGrantedClients.has(u.id)) {
        const micIcon = document.createElement('span');
        micIcon.className = 'voice-granted-icon';
        micIcon.title = 'Voice granted';
        micIcon.innerHTML = '<i class="bi bi-mic"></i>';
        userEl.appendChild(micIcon);
      } else if (ch.moderated && voiceRequestClients.has(u.id)) {
        const handIcon = document.createElement('span');
        handIcon.className = 'voice-granted-icon';
        handIcon.title = 'Voice requested';
        handIcon.innerHTML = '<i class="bi bi-megaphone"></i>';
        userEl.appendChild(handIcon);
      } else if (ch.moderated) {
        const isSelfWithBypass = u.id === serverService.clientId && serverService.hasPermission('channel.bypass_moderation');
        if (!isSelfWithBypass) {
          const muteIcon = document.createElement('span');
          muteIcon.className = 'voice-muted-icon';
          muteIcon.title = 'No voice permission';
          muteIcon.innerHTML = '<i class="bi bi-mic-mute"></i>';
          userEl.appendChild(muteIcon);
        }
      }

      if (webcamClients.has(u.id)) {
        const camIcon = document.createElement('span');
        camIcon.className = 'stream-icon';
        camIcon.title = `${u.nickname}'s camera`;
        camIcon.innerHTML = '<i class="bi bi-camera-video"></i>';
        userEl.appendChild(camIcon);
      }

      if (streamingClients.has(u.id)) {
        const screenIcon = document.createElement('span');
        screenIcon.className = 'stream-icon screen-share-icon';
        screenIcon.title = `Watch ${u.nickname}'s stream`;
        screenIcon.innerHTML = '<i class="bi bi-display"></i>';
        userEl.appendChild(screenIcon);

        // Clicking anywhere on a streaming user's row switches to their stream
        userEl.style.cursor = 'pointer';
        userEl.addEventListener('click', (e) => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('gimodi:watch-stream', { detail: { clientId: u.id } }));
        });
      }

      // Drag & drop to move users
      if (serverService.hasPermission('user.move')) {
        userEl.draggable = true;
        userEl.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-gimodi-user', u.id);
          e.dataTransfer.effectAllowed = 'move';
          userEl.classList.add('dragging');
        });
        userEl.addEventListener('dragend', () => userEl.classList.remove('dragging'));
      }

      userEl.addEventListener('contextmenu', (e) => showUserContextMenu(e, u));

      usersEl.appendChild(userEl);
    }
    channelTree.appendChild(usersEl);
  }
}

// --- Context menu & Connection Details ---

function showChannelContextMenu(e, ch) {
  e.preventDefault();
  e.stopPropagation();
  dismissContextMenu();

  const canUpdate = serverService.hasPermission('channel.update');
  const canDelete = serverService.hasPermission('channel.delete');

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  // Join voice (first item; hidden when already in this channel)
  if (ch.id !== currentChannelId) {
    const joinVoiceItem = document.createElement('div');
    joinVoiceItem.className = 'context-menu-item';
    joinVoiceItem.textContent = 'Join voice';
    joinVoiceItem.addEventListener('click', () => {
      dismissContextMenu();
      switchChannel(ch.id);
    });
    menu.appendChild(joinVoiceItem);
  }

  // Open chat in a new tab (available to all users)
  const openChatItem = document.createElement('div');
  openChatItem.className = 'context-menu-item';
  openChatItem.textContent = 'Open chat';
  openChatItem.addEventListener('click', async () => {
    dismissContextMenu();
    let password;
    if (ch.hasPassword && ch.id !== currentChannelId && !serverService.hasPermission('channel.bypass_password')) {
      if (savedPasswords.has(ch.id)) {
        password = savedPasswords.get(ch.id);
      } else {
        password = await askChannelPassword();
        if (password === null) {
          return;
        }
        savedPasswords.set(ch.id, password);
      }
    }
    openChannelViewTab(ch.id, ch.name, password);
  });
  menu.appendChild(openChatItem);

  // File Browser (requires file.browse permission)
  if (serverService.hasPermission('file.browse')) {
    const fileBrowserItem = document.createElement('div');
    fileBrowserItem.className = 'context-menu-item';
    fileBrowserItem.textContent = 'File Browser';
    fileBrowserItem.addEventListener('click', () => {
      dismissContextMenu();
      showFileBrowserModal(ch);
    });
    menu.appendChild(fileBrowserItem);
  }

  if (canUpdate) {
    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.textContent = 'Edit Channel';
    editItem.addEventListener('click', () => {
      dismissContextMenu();
      showEditChannelModal(ch);
    });
    menu.appendChild(editItem);
  }

  if (!ch.isDefault) {
    if (canUpdate) {
      // Move to submenu
      const moveItem = document.createElement('div');
      moveItem.className = 'context-menu-item';
      moveItem.textContent = 'Move to...';
      moveItem.addEventListener('click', () => {
        dismissContextMenu();
        showMoveChannelModal(ch);
      });
      menu.appendChild(moveItem);
    }

    if (canDelete) {
      const deleteItem = document.createElement('div');
      deleteItem.className = 'context-menu-item danger';
      deleteItem.textContent = 'Delete Channel';
      deleteItem.addEventListener('click', () => {
        dismissContextMenu();
        showDeleteChannelConfirm(ch);
      });
      menu.appendChild(deleteItem);
    }
  }

  document.body.appendChild(menu);

  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      dismissContextMenu();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      dismissContextMenu();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

function showMoveChannelModal(ch) {
  const existing = document.querySelector('.modal-move-channel');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-move-channel';

  // Build list of valid parents (exclude self and own children)
  const isDescendant = (parentId, targetId) => {
    let current = parentId;
    while (current) {
      if (current === targetId) {
        return true;
      }
      const parent = channels.find((c) => c.id === current);
      current = parent ? parent.parentId : null;
    }
    return false;
  };

  const validParents = channels.filter((c) => c.id !== ch.id && c.type === 'group' && !isDescendant(c.parentId, ch.id) && c.parentId !== ch.id);

  const options = [`<option value="">-- Top Level --</option>`];
  for (const p of validParents) {
    const selected = p.id === ch.parentId ? ' selected' : '';
    options.push(`<option value="${p.id}"${selected}>${escapeHtml(p.name)}</option>`);
  }

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Move "${escapeHtml(ch.name)}"</h2>
      <div class="form-group">
        <label>Parent Channel</label>
        <select class="move-channel-parent">${options.join('')}</select>
      </div>
      <div class="modal-buttons">
        <button class="btn-primary modal-move-btn">Move</button>
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  modal.querySelector('.modal-move-btn').addEventListener('click', () => {
    const newParentId = modal.querySelector('.move-channel-parent').value || null;
    const siblings = channels.filter((c) => c.id !== ch.id && (c.parentId || null) === newParentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const sortOrder = siblings.length > 0 ? siblings[siblings.length - 1].sortOrder + 1 : 0;
    serverService.send('channel:update', { channelId: ch.id, parentId: newParentId, sortOrder });
    closeModal();
  });

  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', onEscape);
}


async function showEditChannelModal(ch) {
  const existing = document.querySelector('.modal-edit-channel');
  if (existing) {
    existing.remove();
  }

  // Try to load roles for the access control section
  let roles = null;
  try {
    const result = await serverService.request('role:list', {});
    if (result && result.roles) {
      roles = result.roles;
    }
  } catch {
    /* no permission or error - skip roles section */
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-edit-channel';
  const uid = ch.id;

  let rolesHtml = '';
  if (roles && roles.length > 0) {
    const currentAllowed = ch.allowedRoles || [];
    const currentWrite = ch.writeRoles || [];
    const currentRead = ch.readRoles || [];
    const currentVisibility = ch.visibilityRoles || [];
    const makeChips = (cls, current) =>
      roles
        .map((r) => {
          const active = current.includes(r.id) ? ' active' : '';
          return `<button type="button" class="role-chip ${cls}${active}" data-role-id="${r.id}">
        <i class="bi ${active ? 'bi-check-circle-fill' : 'bi-circle'}"></i>
        ${escapeHtml(r.name)}
      </button>`;
        })
        .join('');
    rolesHtml = `
      <div class="form-section-header">Access Control</div>
      <div class="acl-card">
        <div class="acl-tabs">
          <button type="button" class="acl-tab active" data-tab="join">
            <i class="bi bi-door-open"></i> Join
          </button>
          <button type="button" class="acl-tab" data-tab="read">
            <i class="bi bi-eye"></i> Read
          </button>
          <button type="button" class="acl-tab" data-tab="write">
            <i class="bi bi-pencil"></i> Write
          </button>
          <button type="button" class="acl-tab" data-tab="visibility">
            <i class="bi bi-eye-slash"></i> Visibility
          </button>
        </div>
        <div class="acl-tab-panel active" data-panel="join">
          <div class="acl-hint">Select roles that can join this channel. None selected means open to all.</div>
          <div class="role-chips">${makeChips('edit-ch-role', currentAllowed)}</div>
        </div>
        <div class="acl-tab-panel" data-panel="read">
          <div class="acl-hint">Select roles that can read messages. None selected means everyone can read.</div>
          <div class="role-chips">${makeChips('edit-ch-read-role', currentRead)}</div>
        </div>
        <div class="acl-tab-panel" data-panel="write">
          <div class="acl-hint">Select roles that can send messages. None selected means everyone can write.</div>
          <div class="role-chips">${makeChips('edit-ch-write-role', currentWrite)}</div>
        </div>
        <div class="acl-tab-panel" data-panel="visibility">
          <div class="acl-hint">Select roles that can see this channel. None selected means visible to everyone.</div>
          <div class="role-chips">${makeChips('edit-ch-visibility-role', currentVisibility)}</div>
        </div>
      </div>`;
  }

  const removePwHtml = ch.hasPassword
    ? `
    <label class="checkbox-label" for="edit-ch-rmpw-${uid}">
      <input type="checkbox" class="edit-channel-remove-pw" id="edit-ch-rmpw-${uid}">
      Remove existing password
    </label>`
    : '';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Edit Channel</h2>

      <div class="form-section-header">Basic Info</div>
      <div class="form-row">
        <div class="form-group form-group-grow">
          <label for="edit-ch-name-${uid}">Channel Name</label>
          <input type="text" id="edit-ch-name-${uid}" class="edit-channel-name"
                 value="${escapeHtml(ch.name)}" maxlength="50" autocomplete="off">
          <div class="input-footer-row">
            <span class="input-error-msg" id="edit-ch-name-err-${uid}" role="alert"></span>
            <span class="char-counter" id="edit-ch-name-ctr-${uid}">${ch.name.length} / 50</span>
          </div>
        </div>
        <div class="form-group form-group-max-users">
          <label for="edit-ch-max-${uid}">Max Users</label>
          <input type="number" id="edit-ch-max-${uid}" class="edit-channel-max-users"
                 min="1" placeholder="∞" value="${ch.maxUsers || ''}">
        </div>
      </div>

      ${rolesHtml}

      ${!rolesHtml ? '<div class="form-section-header">Access Control</div>' : ''}
      <div class="acl-password-group">
        <div class="form-group">
          <label for="edit-ch-pw-${uid}">Channel Password <span class="form-hint">(blank = keep unchanged)</span></label>
          <input type="password" id="edit-ch-pw-${uid}" class="edit-channel-password"
                 placeholder="Enter new password" autocomplete="new-password">
        </div>
        ${removePwHtml}
      </div>

      <div class="form-section-header">Voice Power</div>
      <div class="moderation-card">
        <div class="moderation-card-content">
          <div class="moderation-card-icon">
            <i class="bi bi-shield-check"></i>
          </div>
          <div class="moderation-card-text">
            <span class="moderation-card-title">Voice Power</span>
            <span class="moderation-card-desc">Users must be granted voice permission before they can speak</span>
          </div>
          <label class="toggle-switch" for="edit-ch-mod-${uid}">
            <input type="checkbox" class="edit-channel-moderated"
                   id="edit-ch-mod-${uid}" ${ch.moderated ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="modal-buttons modal-buttons-end">
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
        <button class="btn-primary modal-save-btn" disabled>Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const nameInput = modal.querySelector('.edit-channel-name');
  const nameError = modal.querySelector(`#edit-ch-name-err-${uid}`);
  const nameCounter = modal.querySelector(`#edit-ch-name-ctr-${uid}`);
  const passwordInput = modal.querySelector('.edit-channel-password');
  const removePwCheckbox = modal.querySelector('.edit-channel-remove-pw');
  const saveBtn = modal.querySelector('.modal-save-btn');

  // Snapshot initial state for dirty-checking
  const initial = {
    name: ch.name,
    maxUsers: String(ch.maxUsers || ''),
    moderated: ch.moderated || false,
    allowedRoles: JSON.stringify((ch.allowedRoles || []).slice().sort()),
    readRoles: JSON.stringify((ch.readRoles || []).slice().sort()),
    writeRoles: JSON.stringify((ch.writeRoles || []).slice().sort()),
    visibilityRoles: JSON.stringify((ch.visibilityRoles || []).slice().sort()),
  };

  function getFormState() {
    const activeChips = (cls) => [...modal.querySelectorAll(`.role-chip.${cls}.active`)].map((c) => c.dataset.roleId).sort();
    return {
      name: nameInput.value.trim(),
      maxUsers: modal.querySelector('.edit-channel-max-users').value,
      moderated: modal.querySelector('.edit-channel-moderated').checked,
      allowedRoles: JSON.stringify(activeChips('edit-ch-role')),
      readRoles: JSON.stringify(activeChips('edit-ch-read-role')),
      writeRoles: JSON.stringify(activeChips('edit-ch-write-role')),
      visibilityRoles: JSON.stringify(activeChips('edit-ch-visibility-role')),
    };
  }

  function isDirty() {
    if (removePwCheckbox && removePwCheckbox.checked) {
      return true;
    }
    if (passwordInput.value !== '') {
      return true;
    }
    const cur = getFormState();
    return (
      cur.name !== initial.name ||
      cur.maxUsers !== initial.maxUsers ||
      cur.moderated !== initial.moderated ||
      cur.allowedRoles !== initial.allowedRoles ||
      cur.readRoles !== initial.readRoles ||
      cur.writeRoles !== initial.writeRoles ||
      cur.visibilityRoles !== initial.visibilityRoles
    );
  }

  function validateName() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('is-invalid');
      nameError.textContent = 'Channel name is required.';
      return false;
    }
    nameInput.classList.remove('is-invalid');
    nameError.textContent = '';
    return true;
  }

  function updateCounter() {
    const len = nameInput.value.length;
    nameCounter.textContent = `${len} / 50`;
    nameCounter.classList.toggle('near-limit', len >= 40 && len < 50);
    nameCounter.classList.toggle('at-limit', len >= 50);
  }

  function updateSaveBtn() {
    saveBtn.disabled = !isDirty();
  }

  modal.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateSaveBtn);
    input.addEventListener('change', updateSaveBtn);
  });

  modal.querySelectorAll('.acl-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.acl-tab').forEach((t) => t.classList.remove('active'));
      modal.querySelectorAll('.acl-tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`.acl-tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  modal.querySelectorAll('.role-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const icon = chip.querySelector('i');
      icon.className = chip.classList.contains('active') ? 'bi bi-check-circle-fill' : 'bi bi-circle';
      updateSaveBtn();
    });
  });

  nameInput.addEventListener('input', () => {
    updateCounter();
    if (nameInput.classList.contains('is-invalid')) {
      validateName();
    }
    updateSaveBtn();
  });

  if (removePwCheckbox) {
    removePwCheckbox.addEventListener('change', () => {
      passwordInput.disabled = removePwCheckbox.checked;
      if (removePwCheckbox.checked) {
        passwordInput.value = '';
      }
      updateSaveBtn();
    });
  }

  nameInput.focus();
  nameInput.select();
  updateCounter();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const save = () => {
    if (!validateName()) {
      return;
    }
    const payload = { channelId: ch.id, name: nameInput.value.trim() };
    const removePwCb = modal.querySelector('.edit-channel-remove-pw');
    if (removePwCb && removePwCb.checked) {
      payload.password = null;
    } else {
      const pw = passwordInput.value;
      if (pw !== '') {
        payload.password = pw;
      }
    }
    const maxUsersInput = modal.querySelector('.edit-channel-max-users');
    const maxUsers = parseInt(maxUsersInput.value);
    payload.maxUsers = maxUsers > 0 ? maxUsers : null;
    payload.moderated = modal.querySelector('.edit-channel-moderated').checked;
    const activeChips = (cls) => [...modal.querySelectorAll(`.role-chip.${cls}.active`)].map((c) => c.dataset.roleId);
    const joinChips = modal.querySelectorAll('.role-chip.edit-ch-role');
    if (joinChips.length > 0) {
      payload.allowedRoles = activeChips('edit-ch-role');
    }
    const readChips = modal.querySelectorAll('.role-chip.edit-ch-read-role');
    if (readChips.length > 0) {
      payload.readRoles = activeChips('edit-ch-read-role');
    }
    const writeChips = modal.querySelectorAll('.role-chip.edit-ch-write-role');
    if (writeChips.length > 0) {
      payload.writeRoles = activeChips('edit-ch-write-role');
    }
    const visibilityChips = modal.querySelectorAll('.role-chip.edit-ch-visibility-role');
    if (visibilityChips.length > 0) {
      payload.visibilityRoles = activeChips('edit-ch-visibility-role');
    }
    saveBtn.classList.add('btn-save-loading');
    saveBtn.disabled = true;
    serverService.send('channel:update', payload);
    closeModal();
  };

  modal.querySelector('.modal-save-btn').addEventListener('click', save);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
    if (e.key === 'Enter' && e.target === nameInput) {
      save();
    }
  };
  document.addEventListener('keydown', onEscape);
}

function showDeleteChannelConfirm(ch) {
  const existing = document.querySelector('.modal-delete-channel');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-delete-channel';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Delete Channel</h2>
      <p>Are you sure you want to delete <strong>${escapeHtml(ch.name)}</strong>?</p>
      <div class="modal-buttons">
        <button class="btn-primary modal-yes-btn" style="background: var(--danger);">Yes</button>
        <button class="btn-secondary modal-no-btn">No</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const confirmDelete = () => {
    serverService.send('channel:delete', { channelId: ch.id });
    closeModal();
  };

  modal.querySelector('.modal-yes-btn').addEventListener('click', confirmDelete);
  modal.querySelector('.modal-no-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', onEscape);
}

function showBanModal(user, options = {}) {
  const existing = document.querySelector('.modal-ban-user');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-ban-user';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Ban ${escapeHtml(user.nickname)}</h2>
      <div class="form-group">
        <label>Reason (optional)</label>
        <input type="text" class="ban-reason" placeholder="Reason for ban">
      </div>
      <div class="form-group">
        <label>Duration</label>
        <select class="ban-duration">
          <option value="3600">1 hour</option>
          <option value="86400">24 hours</option>
          <option value="604800">7 days</option>
          <option value="2592000">30 days</option>
          <option value="0">Permanent</option>
        </select>
      </div>
      <div class="modal-buttons">
        <button class="btn-primary modal-ban-btn" style="background: var(--danger);">Ban</button>
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const reasonInput = modal.querySelector('.ban-reason');
  const durationSelect = modal.querySelector('.ban-duration');
  reasonInput.focus();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const confirmBan = async () => {
    const reason = reasonInput.value.trim();
    const duration = parseInt(durationSelect.value);
    try {
      if (options.fromChat && user.userId) {
        await serverService.request('admin:ban-user', { userId: user.userId, reason, duration });
      } else {
        await serverService.request('admin:ban', { clientId: user.id, reason, duration });
      }
      closeModal();
    } catch (err) {
      await customAlert(err.message);
    }
  };

  modal.querySelector('.modal-ban-btn').addEventListener('click', confirmBan);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
    if (e.key === 'Enter' && (e.target === reasonInput || e.target === durationSelect)) {
      confirmBan();
    }
  };
  document.addEventListener('keydown', onEscape);
}

function showGroupContextMenu(e, group) {
  e.preventDefault();
  e.stopPropagation();
  dismissContextMenu();

  if (
    !serverService.hasPermission('channel.update') &&
    !serverService.hasPermission('channel.delete') &&
    !serverService.hasPermission('channel.create') &&
    !serverService.hasPermission('channel.placeholder_create')
  ) {
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  if (serverService.hasPermission('channel.create')) {
    const createItem = document.createElement('div');
    createItem.className = 'context-menu-item';
    createItem.textContent = 'Create Channel';
    createItem.addEventListener('click', () => {
      dismissContextMenu();
      document.getElementById('new-channel-parent-id').value = group.id;
      document.getElementById('modal-create-channel').classList.remove('hidden');
    });
    menu.appendChild(createItem);
  }

  if (serverService.hasPermission('channel.placeholder_create')) {
    const createPlaceholderItem = document.createElement('div');
    createPlaceholderItem.className = 'context-menu-item';
    createPlaceholderItem.textContent = 'Create Placeholder';
    createPlaceholderItem.addEventListener('click', () => {
      dismissContextMenu();
      document.getElementById('new-placeholder-parent-id').value = group.id;
      document.getElementById('modal-create-placeholder').classList.remove('hidden');
    });
    menu.appendChild(createPlaceholderItem);
  }

  if (serverService.hasPermission('channel.update')) {
    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.textContent = 'Edit Group';
    editItem.addEventListener('click', () => {
      dismissContextMenu();
      showEditGroupModal(group);
    });
    menu.appendChild(editItem);
  }

  if (serverService.hasPermission('channel.delete')) {
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item danger';
    deleteItem.textContent = 'Delete Group';
    deleteItem.addEventListener('click', () => {
      dismissContextMenu();
      showDeleteChannelConfirm(group);
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);

  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      dismissContextMenu();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      dismissContextMenu();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

async function showEditGroupModal(group) {
  const existing = document.querySelector('.modal-edit-group');
  if (existing) {
    existing.remove();
  }

  let roles = null;
  try {
    const result = await serverService.request('role:list', {});
    if (result && result.roles) {
      roles = result.roles;
    }
  } catch {
    /* no permission or error - skip roles section */
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-edit-group';

  let rolesHtml = '';
  if (roles && roles.length > 0) {
    const currentAllowed = group.allowedRoles || [];
    const currentWrite = group.writeRoles || [];
    const currentRead = group.readRoles || [];
    const currentVisibility = group.visibilityRoles || [];
    const makeChips = (cls, current) =>
      roles
        .map((r) => {
          const active = current.includes(r.id) ? ' active' : '';
          return `<button type="button" class="role-chip ${cls}${active}" data-role-id="${r.id}">
        <i class="bi ${active ? 'bi-check-circle-fill' : 'bi-circle'}"></i>
        ${escapeHtml(r.name)}
      </button>`;
        })
        .join('');
    rolesHtml = `
      <div class="form-section-header">Access Control</div>
      <div class="acl-hint" style="margin-bottom:8px;">Group-level restrictions override individual channel settings.</div>
      <div class="acl-card">
        <div class="acl-tabs">
          <button type="button" class="acl-tab active" data-tab="join">
            <i class="bi bi-door-open"></i> Join
          </button>
          <button type="button" class="acl-tab" data-tab="read">
            <i class="bi bi-eye"></i> Read
          </button>
          <button type="button" class="acl-tab" data-tab="write">
            <i class="bi bi-pencil"></i> Write
          </button>
          <button type="button" class="acl-tab" data-tab="visibility">
            <i class="bi bi-eye-slash"></i> Visibility
          </button>
        </div>
        <div class="acl-tab-panel active" data-panel="join">
          <div class="acl-hint">Select roles that can join channels in this group. None selected means open to all.</div>
          <div class="role-chips">${makeChips('edit-grp-role', currentAllowed)}</div>
        </div>
        <div class="acl-tab-panel" data-panel="read">
          <div class="acl-hint">Select roles that can read messages in channels of this group. None selected means everyone can read.</div>
          <div class="role-chips">${makeChips('edit-grp-read-role', currentRead)}</div>
        </div>
        <div class="acl-tab-panel" data-panel="write">
          <div class="acl-hint">Select roles that can send messages in channels of this group. None selected means everyone can write.</div>
          <div class="role-chips">${makeChips('edit-grp-write-role', currentWrite)}</div>
        </div>
        <div class="acl-tab-panel" data-panel="visibility">
          <div class="acl-hint">Select roles that can see this group and its channels. None selected means visible to everyone.</div>
          <div class="role-chips">${makeChips('edit-grp-visibility-role', currentVisibility)}</div>
        </div>
      </div>`;
  }

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Edit Group</h2>
      <div class="form-group">
        <label>Group Name</label>
        <input type="text" class="edit-group-name" value="${escapeHtml(group.name)}" maxlength="50">
      </div>
      ${rolesHtml}
      <div class="modal-buttons modal-buttons-end">
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
        <button class="btn-primary modal-save-btn" disabled>Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const nameInput = modal.querySelector('.edit-group-name');
  const saveBtn = modal.querySelector('.modal-save-btn');

  const initial = {
    name: group.name,
    allowedRoles: JSON.stringify((group.allowedRoles || []).slice().sort()),
    readRoles: JSON.stringify((group.readRoles || []).slice().sort()),
    writeRoles: JSON.stringify((group.writeRoles || []).slice().sort()),
    visibilityRoles: JSON.stringify((group.visibilityRoles || []).slice().sort()),
  };

  function getFormState() {
    const activeChips = (cls) => [...modal.querySelectorAll(`.role-chip.${cls}.active`)].map((c) => c.dataset.roleId).sort();
    return {
      name: nameInput.value.trim(),
      allowedRoles: JSON.stringify(activeChips('edit-grp-role')),
      readRoles: JSON.stringify(activeChips('edit-grp-read-role')),
      writeRoles: JSON.stringify(activeChips('edit-grp-write-role')),
      visibilityRoles: JSON.stringify(activeChips('edit-grp-visibility-role')),
    };
  }

  function isDirty() {
    const cur = getFormState();
    return (
      cur.name !== initial.name ||
      cur.allowedRoles !== initial.allowedRoles ||
      cur.readRoles !== initial.readRoles ||
      cur.writeRoles !== initial.writeRoles ||
      cur.visibilityRoles !== initial.visibilityRoles
    );
  }

  function updateSaveBtn() {
    saveBtn.disabled = !isDirty();
  }

  modal.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateSaveBtn);
  });

  modal.querySelectorAll('.acl-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.acl-tab').forEach((t) => t.classList.remove('active'));
      modal.querySelectorAll('.acl-tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`.acl-tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  modal.querySelectorAll('.role-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const icon = chip.querySelector('i');
      icon.className = chip.classList.contains('active') ? 'bi bi-check-circle-fill' : 'bi bi-circle';
      updateSaveBtn();
    });
  });

  nameInput.focus();
  nameInput.select();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) {
      return;
    }
    const payload = { channelId: group.id, name };
    const activeChips = (cls) => [...modal.querySelectorAll(`.role-chip.${cls}.active`)].map((c) => c.dataset.roleId);
    if (modal.querySelectorAll('.role-chip.edit-grp-role').length > 0) {
      payload.allowedRoles = activeChips('edit-grp-role');
    }
    if (modal.querySelectorAll('.role-chip.edit-grp-read-role').length > 0) {
      payload.readRoles = activeChips('edit-grp-read-role');
    }
    if (modal.querySelectorAll('.role-chip.edit-grp-write-role').length > 0) {
      payload.writeRoles = activeChips('edit-grp-write-role');
    }
    if (modal.querySelectorAll('.role-chip.edit-grp-visibility-role').length > 0) {
      payload.visibilityRoles = activeChips('edit-grp-visibility-role');
    }
    saveBtn.classList.add('btn-save-loading');
    saveBtn.disabled = true;
    serverService.send('channel:update', payload);
    closeModal();
  };

  modal.querySelector('.modal-save-btn').addEventListener('click', save);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
    if (e.key === 'Enter' && e.target === nameInput) {
      save();
    }
  };
  document.addEventListener('keydown', onEscape);
}

function showPlaceholderContextMenu(e, ch) {
  e.preventDefault();
  e.stopPropagation();
  dismissContextMenu();

  const canUpdate = serverService.hasPermission('channel.update');
  const canDelete = serverService.hasPermission('channel.delete');
  if (!canUpdate && !canDelete) {
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  if (canUpdate) {
    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.textContent = 'Edit Placeholder';
    editItem.addEventListener('click', () => {
      dismissContextMenu();
      showEditPlaceholderModal(ch);
    });
    menu.appendChild(editItem);
  }

  if (canDelete) {
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item danger';
    deleteItem.textContent = 'Delete Placeholder';
    deleteItem.addEventListener('click', () => {
      dismissContextMenu();
      showDeleteChannelConfirm(ch);
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);

  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      dismissContextMenu();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      dismissContextMenu();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

function showEditPlaceholderModal(ch) {
  const existing = document.querySelector('.modal-edit-placeholder');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-edit-placeholder';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Edit Placeholder</h2>
      <div class="form-group">
        <label>Name</label>
        <input type="text" class="edit-placeholder-name" value="${escapeHtml(ch.name)}" maxlength="50">
      </div>
      <div class="modal-buttons modal-buttons-end">
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
        <button class="btn-primary modal-save-btn" disabled>Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const nameInput = modal.querySelector('.edit-placeholder-name');
  const saveBtn = modal.querySelector('.modal-save-btn');

  function updateSaveBtn() {
    saveBtn.disabled = nameInput.value.trim() === ch.name || !nameInput.value.trim();
  }

  nameInput.addEventListener('input', updateSaveBtn);
  nameInput.focus();
  nameInput.select();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const save = () => {
    const name = nameInput.value.trim();
    if (!name || name === ch.name) {
      return;
    }
    serverService.send('channel:update', { channelId: ch.id, name });
    closeModal();
  };

  saveBtn.addEventListener('click', save);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
    if (e.key === 'Enter' && e.target === nameInput) {
      save();
    }
  };
  document.addEventListener('keydown', onEscape);
}

function dismissContextMenu() {
  const existing = document.querySelector('.context-menu:not(#create-dropdown)');
  if (existing) {
    existing.remove();
  }
}

/**
 * @param {CustomEvent} e
 */
function onUserContextMenuEvent(e) {
  const { clientX, clientY, user } = e.detail;
  showUserContextMenu({ preventDefault() {}, clientX, clientY }, user, { fromChat: true });
}

export function showUserContextMenu(e, user, options = {}) {
  e.preventDefault();
  dismissContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const isOther = user.id !== serverService.clientId;

  /**
   * @param {string} text
   */
  const addLabel = (text) => {
    const label = document.createElement('div');
    label.className = 'context-menu-label';
    label.textContent = text;
    menu.appendChild(label);
  };

  /**
   * @param {string} text
   * @param {function} handler
   * @param {{ danger?: boolean }} [opts]
   * @returns {HTMLDivElement}
   */
  const addItem = (text, handler, opts = {}) => {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (opts.danger ? ' danger' : '');
    item.textContent = text;
    item.addEventListener('click', async () => {
      dismissContextMenu();
      await handler();
    });
    menu.appendChild(item);
    return item;
  };

  const addSeparator = () => {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);
  };

  if (isOther) {
    if (user.fingerprint) {
      addItem('Send Friend Request', async () => {
        window.dispatchEvent(new CustomEvent('gimodi:add-friend', { detail: { fingerprint: user.fingerprint, nickname: user.nickname } }));
      });
    }

    if (!options.fromChat && serverService.hasPermission('user.poke')) {
      addItem('Poke', async () => {
        const message = await customPrompt(`Poke message for ${user.nickname} (optional):`);
        if (message === null) {
          return;
        }
        try {
          await serverService.request('admin:poke', { clientId: user.id, message });
        } catch (err) {
          await customAlert(err.message);
        }
      });
    }
  }

  if (!options.fromChat && isOther && user.userId) {
    addSeparator();
    addLabel('Volume');

    const volContainer = document.createElement('div');
    volContainer.className = 'context-menu-volume';
    volContainer.style.cssText = 'padding:6px 12px;display:flex;align-items:center;gap:8px;min-width:180px';

    const volIcon = document.createElement('i');
    volIcon.className = 'bi bi-volume-up';
    volIcon.style.cssText = 'font-size:14px;color:var(--text-muted);flex-shrink:0';
    volContainer.appendChild(volIcon);

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = voiceService.getUserVolume(user.userId);
    volSlider.style.cssText = 'flex:1;cursor:pointer;accent-color:var(--accent)';
    volContainer.appendChild(volSlider);

    const volLabel = document.createElement('span');
    volLabel.style.cssText = 'font-size:11px;color:var(--text-muted);min-width:32px;text-align:right';
    volLabel.textContent = volSlider.value + '%';
    volContainer.appendChild(volLabel);

    volSlider.addEventListener('input', () => {
      const vol = parseInt(volSlider.value, 10);
      volLabel.textContent = vol + '%';
      volIcon.className = vol === 0 ? 'bi bi-volume-mute' : vol < 100 ? 'bi bi-volume-down' : 'bi bi-volume-up';
      voiceService.setUserVolume(user.userId, vol);
    });

    volContainer.addEventListener('click', (ev) => ev.stopPropagation());
    menu.appendChild(volContainer);
  }

  if (!options.fromChat) {
    if (!menu.querySelector('.context-menu-separator')) {
      addSeparator();
    }
    addItem('Connection Details', () => showConnectionDetails(user));
  }

  const currentChannel = channels.find((c) => c.id === currentChannelId);
  if (currentChannel?.moderated) {
    const hasVoicePerms = serverService.hasPermission('voice.grant') || serverService.hasPermission('voice.revoke');

    if (hasVoicePerms && isOther && !user.badge) {
      addSeparator();
      addLabel('Voice');

      if (voiceGrantedClients.has(user.id)) {
        addItem('Revoke Voice', async () => {
          try {
            await serverService.request('admin:revoke-voice', { clientId: user.id });
          } catch (err) {
            await customAlert(err.message);
          }
        });
      } else {
        addItem(voiceRequestClients.has(user.id) ? 'Grant Voice (requested)' : 'Grant Voice', async () => {
          try {
            await serverService.request('admin:grant-voice', { clientId: user.id });
          } catch (err) {
            await customAlert(err.message);
          }
        });
      }
    }

    if (!isOther && !hasVoicePerms && !voiceGrantedClients.has(user.id)) {
      addSeparator();
      addLabel('Voice');

      if (voiceRequestClients.has(user.id)) {
        addItem('Cancel Voice Request', async () => {
          try {
            await serverService.request('voice:cancel-request');
            voiceRequestClients.delete(user.id);
            renderChannelTree();
          } catch (err) {
            await customAlert(err.message);
          }
        });
      } else {
        addItem('Request Voice', async () => {
          try {
            await serverService.request('voice:request');
            voiceRequestClients.add(user.id);
            renderChannelTree();
          } catch (err) {
            await customAlert(err.message);
          }
        });
      }
    }
  }

  if (isOther && user.userId) {
    addSeparator();
    addItem('Add Friend', async () => {
      const displayName = await customPrompt('Display name for friend:', user.nickname);
      if (displayName === null) {
        return;
      }
      await window.gimodi.friends.add({
        userId: user.userId,
        displayName: displayName || user.nickname,
        serverAddress: serverService.address,
        identityFingerprint: user.userId,
        addedAt: Date.now(),
      });
      window.dispatchEvent(new CustomEvent('gimodi:friends-updated'));
    });
    if (user.fingerprint) {
      addItem('Direct Message', () => {
        window.dispatchEvent(new CustomEvent('gimodi:open-dm', { detail: { fingerprint: user.fingerprint, displayName: user.nickname } }));
      });
    }
  }

  const hasAdminActions = isOther && (serverService.hasPermission('user.kick') || serverService.hasPermission('user.ban') || serverService.hasPermission('user.assign_role'));

  if (hasAdminActions) {
    addSeparator();
    addLabel('Administration');

    if (!options.fromChat && serverService.hasPermission('user.kick')) {
      addItem(
        'Kick',
        async () => {
          try {
            await serverService.request('admin:kick', { clientId: user.id });
          } catch (err) {
            await customAlert(err.message);
          }
        },
        { danger: true },
      );
    }

    if (serverService.hasPermission('user.ban')) {
      addItem('Ban', () => showBanModal(user, options), { danger: true });
    }

    if (serverService.hasPermission('user.assign_role')) {
      addItem('Set Role...', () => showSetRoleMenu(user, e.clientX, e.clientY, options));
    }
  }

  document.body.appendChild(menu);

  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      dismissContextMenu();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      dismissContextMenu();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

async function showSetRoleMenu(user, x, y, options = {}) {
  const useByUserId = options.fromChat && user.userId;
  let result;
  try {
    if (useByUserId) {
      result = await serverService.request('admin:get-user-roles-by-userid', { userId: user.userId });
    } else {
      result = await serverService.request('admin:get-user-roles', { clientId: user.id });
    }
  } catch (err) {
    await customAlert(err.message);
    return;
  }

  if (!result.userId && !useByUserId) {
    await customAlert('This user has no persistent identity and cannot be assigned a role.\nThey must connect with a cryptographic key.');
    return;
  }

  document.querySelectorAll('.context-menu').forEach((m) => m.remove());

  const submenu = document.createElement('div');
  submenu.className = 'context-menu';
  submenu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10001;min-width:180px`;

  // One role per user - find the single assigned role if any
  const currentRole = result.roles[0] || null;

  const addRoleRow = (roleId, roleName, isActive) => {
    const row = document.createElement('div');
    row.className = 'context-menu-item';
    row.style.cssText = 'display:flex;align-items:center;gap:8px';

    const dot = document.createElement('span');
    dot.style.cssText = 'width:14px;text-align:center;font-size:12px';
    dot.textContent = isActive ? '●' : '○';

    const label = document.createElement('span');
    label.textContent = roleName;

    row.append(dot, label);
    row.addEventListener('click', async () => {
      submenu.remove();
      try {
        if (isActive) {
          if (useByUserId) {
            await serverService.request('admin:remove-role-by-userid', { userId: user.userId, roleId });
          } else {
            await serverService.request('admin:remove-role', { clientId: user.id, roleId });
          }
        } else {
          if (useByUserId) {
            await serverService.request('admin:assign-role-by-userid', { userId: user.userId, roleId });
          } else {
            await serverService.request('admin:assign-role', { clientId: user.id, roleId });
          }
        }
      } catch (err) {
        await customAlert(err.message);
      }
    });
    submenu.appendChild(row);
  };

  if (!result.allRoles.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 12px;font-size:13px;color:var(--text-muted)';
    empty.textContent = 'No roles defined';
    submenu.appendChild(empty);
  }

  // "None" option - removes current role
  const noneRow = document.createElement('div');
  noneRow.className = 'context-menu-item' + (!currentRole ? ' disabled' : '');
  noneRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  if (!currentRole) {
    noneRow.style.opacity = '0.5';
  }
  const noneDot = document.createElement('span');
  noneDot.style.cssText = 'width:14px;text-align:center;font-size:12px';
  noneDot.textContent = currentRole ? '○' : '●';
  const noneLabel = document.createElement('span');
  noneLabel.textContent = 'None';
  noneRow.append(noneDot, noneLabel);
  if (currentRole) {
    noneRow.addEventListener('click', async () => {
      submenu.remove();
      try {
        if (useByUserId) {
          await serverService.request('admin:remove-role-by-userid', { userId: user.userId, roleId: currentRole.id });
        } else {
          await serverService.request('admin:remove-role', { clientId: user.id, roleId: currentRole.id });
        }
      } catch (err) {
        await customAlert(err.message);
      }
    });
  }
  submenu.appendChild(noneRow);

  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
  submenu.appendChild(sep);

  for (const role of result.allRoles) {
    addRoleRow(role.id, role.name, currentRole?.id === role.id);
  }

  document.body.appendChild(submenu);

  const removeSubmenu = (ev) => {
    if (!submenu.contains(ev.target)) {
      submenu.remove();
      document.removeEventListener('mousedown', removeSubmenu);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', removeSubmenu), 0);
}

async function showConnectionDetails(user) {
  try {
    const info = await serverService.request('user:get-info', { clientId: user.id });
    showDetailsModal(info);
  } catch (err) {
    await customAlert('Failed to get connection details: ' + err.message);
  }
}

function showDetailsModal(info) {
  // Remove any existing details modal
  const existing = document.querySelector('.modal-connection-details');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-connection-details';

  const connectedDate = new Date(info.connectedAt);
  const timeStr = connectedDate.toLocaleString();

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Connection Details</h2>
      <div class="detail-row"><span class="detail-label">Nickname</span><span class="detail-value">${escapeHtml(info.nickname)}</span></div>
      <div class="detail-row"><span class="detail-label">IP Address</span><span class="detail-value">${escapeHtml(info.ip || 'Unknown')}</span></div>
      <div class="detail-row"><span class="detail-label">Client Version</span><span class="detail-value">${escapeHtml(info.clientVersion || 'Unknown')}</span></div>
      <div class="detail-row"><span class="detail-label">Connected At</span><span class="detail-value">${escapeHtml(timeStr)}</span></div>
      <div class="modal-buttons">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();

  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

function onMenuAction(action) {
  if (action === 'redeem-token') {
    showRedeemTokenModal();
    return;
  }
  // Route admin menu actions to the unified dialog with the right tab
  const tabMap = {
    'list-users': 'users',
    'manage-bans': 'bans',
    'manage-tokens': 'tokens',
    'manage-roles': 'roles',
    'server-settings': 'settings',
    'audit-log': 'audit-log',
  };
  if (tabMap[action]) {
    showUnifiedAdminDialog(tabMap[action]);
  }
}

/**
 * Initializes column resize handles on the admin users table.
 * @param {HTMLTableElement} table
 */

function updateChannelTabLabel(channelId) {
  setChannelName(getChannelName(channelId));
}

/**
 * Escapes a string for safe insertion into HTML.
 * @param {string} str - The string to escape
 * @returns {string} The HTML-escaped string
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Returns the current list of channels.
 * @returns {Array} The channels array
 */
export function getChannels() {
  return channels;
}

export { syncLocalVoiceIndicators };
export { showRedeemTokenModal };

// --- Unified Admin Dialog ---

const ADMIN_TABS = [
  { id: 'settings', label: 'Server Settings', icon: 'bi-sliders', permission: 'server.manage_settings' },
  { id: 'users', label: 'Users', icon: 'bi-people', permission: 'server.admin_menu' },
  { id: 'bans', label: 'Manage Bans', icon: 'bi-shield-exclamation', permission: 'ban.list' },
  { id: 'tokens', label: 'Manage Tokens', icon: 'bi-key', permission: 'token.list' },
  { id: 'roles', label: 'Manage Roles', icon: 'bi-person-badge', permission: 'role.manage' },
  { id: 'audit-log', label: 'Audit Log', icon: 'bi-journal-text', permission: 'server.admin_menu' },
  { id: 'analytics', label: 'Server Analytics', icon: 'bi-graph-up', permission: 'server.admin_menu' },
];

export function showUnifiedAdminDialog(initialTab) {
  const existing = document.querySelector('.modal-admin-unified');
  if (existing) {
    existing.remove();
  }

  // Filter tabs by permission
  const visibleTabs = ADMIN_TABS.filter((t) => serverService.hasPermission(t.permission));
  if (!visibleTabs.length) {
    return;
  }

  const startTab = initialTab && visibleTabs.find((t) => t.id === initialTab) ? initialTab : visibleTabs[0].id;

  const modal = document.createElement('div');
  modal.className = 'modal modal-admin-unified';

  const content = document.createElement('div');
  content.className = 'modal-content admin-dialog-content';

  // Header
  const header = document.createElement('div');
  header.className = 'admin-dialog-header';
  const versionText = serverService.serverVersion ? ` <span class="admin-dialog-version">v${serverService.serverVersion}</span>` : '';
  header.innerHTML = `<h2>Server Admin${versionText}</h2>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'admin-dialog-close';
  closeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
  header.appendChild(closeBtn);
  content.appendChild(header);

  // Body: nav + panel
  const body = document.createElement('div');
  body.className = 'admin-dialog-body';

  const nav = document.createElement('div');
  nav.className = 'admin-dialog-nav';

  const panel = document.createElement('div');
  panel.className = 'admin-dialog-panel';

  for (const tab of visibleTabs) {
    const item = document.createElement('button');
    item.className = 'admin-nav-item';
    item.dataset.tab = tab.id;
    item.innerHTML = `<i class="bi ${tab.icon}"></i> ${tab.label}`;
    item.addEventListener('click', () => switchTab(tab.id));
    nav.appendChild(item);
  }

  body.appendChild(nav);
  body.appendChild(panel);
  content.appendChild(body);
  modal.appendChild(content);
  document.body.appendChild(modal);

  let activeTab = null;

  async function switchTab(tabId) {
    if (activeTab === tabId) {
      return;
    }
    activeTab = tabId;

    // Update nav active state
    nav.querySelectorAll('.admin-nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });

    // Clear and render panel
    panel.innerHTML = '<p class="text-muted" style="font-size:13px">Loading...</p>';

    // For roles tab, the panel needs special flex handling
    if (tabId === 'roles') {
      panel.style.padding = '0';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
    } else {
      panel.style.padding = '';
      panel.style.display = '';
      panel.style.flexDirection = '';
    }

    try {
      switch (tabId) {
        case 'users':
          renderUsersPanel(panel);
          break;
        case 'bans':
          await renderBansPanel(panel);
          break;
        case 'tokens':
          await renderTokensPanel(panel);
          break;
        case 'roles':
          await renderRolesPanel(panel);
          break;
        case 'settings':
          await renderSettingsPanel(panel);
          break;
        case 'audit-log':
          panel.style.cssText = 'flex:1;padding:16px 20px;min-width:0;display:flex;flex-direction:column;overflow:hidden';
          await renderAuditLogPanel(panel);
          break;
        case 'analytics':
          panel.style.cssText = 'flex:1;padding:0;min-width:0;display:flex;flex-direction:column;overflow:hidden';
          await renderAnalyticsPanel(panel);
          break;
      }
    } catch (err) {
      panel.innerHTML = `<p style="color:var(--danger);font-size:13px">${escapeHtml(err.message || String(err))}</p>`;
    }
  }

  // Close handlers
  const closeAdminDialog = () => {
    modal.remove();
    document.removeEventListener('keydown', onAdminEscape);
  };
  closeBtn.addEventListener('click', closeAdminDialog);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeAdminDialog();
    }
  });
  const onAdminEscape = (e) => {
    if (e.key === 'Escape') {
      closeAdminDialog();
    }
  };
  document.addEventListener('keydown', onAdminEscape);

  // Open initial tab
  switchTab(startTab);
}
