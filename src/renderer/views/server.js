import serverService from '../services/server.js';
import voiceService from '../services/voice.js';
import screenShareService from '../services/screen.js';
import { getServerIcon } from '../services/iconCache.js';
import { setChannelName, openChannelViewTab, switchToChannelTab, updateChatBadges, isChannelUnread } from './chat.js';
import { setNickname } from '../services/nicknameCache.js';
import { customAlert, customConfirm, customPrompt } from '../services/dialogs.js';

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const channelTree = document.getElementById('channel-tree');

// Root-level drop zone: dropping a channel on empty tree space moves it to top level
channelTree.addEventListener('dragover', (e) => {
  if (e.target !== channelTree) return;
  if (!serverService.hasPermission('channel.update')) return;
  if (e.dataTransfer.types.includes('application/x-gimodi-user')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
channelTree.addEventListener('drop', (e) => {
  if (e.target !== channelTree) return;
  if (!serverService.hasPermission('channel.update')) return;
  if (e.dataTransfer.getData('application/x-gimodi-user')) return;
  e.preventDefault();
  const draggedId = e.dataTransfer.getData('text/plain');
  if (!draggedId) return;
  const sibCount = channels.filter(c => c.id !== draggedId && !c.parentId).length;
  moveChannel(draggedId, null, sibCount);
});

const serverNameEl = document.getElementById('server-name');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnCreateChannel = document.getElementById('btn-create-channel');

let channels = [];
let clients = [];
let currentChannelId = null;
const collapsedGroups = new Set();
let createDropdownInitialized = false;
const talkingClients = new Set();
const webcamClients = new Set();
const mutedClients = new Set();    // clientIds with mic muted
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
let feedbackVolume = 0.1;

function playSound(audio) {
  console.log('playSound', audio);
  audio.volume = feedbackVolume;
  audio.currentTime = 0;
  audio.play().catch(() => { });
}

export function setFeedbackVolume(vol) {
  feedbackVolume = vol;
}

export function initServerView(data) {
  channels = data.channels;
  clients = data.clients;
  // User starts in lobby - no channel until they explicitly join one
  currentChannelId = null;

  // Make client and channel lists globally accessible for chat mentions
  window.gimodiClients = clients;
  window.gimodiChannels = channels;

  serverNameEl.textContent = data.serverName;

  // Load server icon
  _currentIconHash = data.iconHash || null;
  const sidebarIcon = document.querySelector('.sidebar-header-icon');
  if (_currentIconHash && sidebarIcon) {
    getServerIcon(serverService.address, _currentIconHash).then(url => {
      if (url) sidebarIcon.src = url;
    });
  } else if (sidebarIcon) {
    sidebarIcon.src = '../../assets/icon.png';
  }

  // Listen for live icon changes
  serverService.addEventListener('server:icon-changed', (e) => {
    const icon = document.querySelector('.sidebar-header-icon');
    if (!icon) return;
    const { hash } = e.detail;
    _currentIconHash = hash || null;
    if (hash) {
      getServerIcon(serverService.address, hash).then(url => {
        if (url) icon.src = url;
      });
    } else {
      icon.src = '../../assets/icon.png';
    }
  });

  // Initialize mute/deafen states from client list and seed nickname cache
  for (const c of clients) {
    if (c.muted) mutedClients.add(c.id);
    if (c.deafened) deafenedClients.add(c.id);
    if (c.userId && c.nickname) setNickname(c.userId, c.nickname);
  }

  renderChannelTree();

  btnDisconnect.addEventListener('click', handleDisconnect);
  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const canCreateGroup = serverService.hasPermission('channel.group_create');
  btnCreateChannel.style.display = (canCreate || canCreateTemp || canCreateGroup) ? '' : 'none';
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
  btnDisconnect.removeEventListener('click', handleDisconnect);
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
  if (!state) return;
  channels = state.channels || [];
  clients = state.clients || [];
  window.gimodiChannels = channels;
  currentChannelId = state.currentChannelId || null;
  collapsedGroups.clear();
  for (const g of (state.collapsedGroups || [])) collapsedGroups.add(g);
  savedPasswords.clear();
  for (const [k, v] of (state.savedPasswords || [])) savedPasswords.set(k, v);
  talkingClients.clear();
  for (const c of (state.talkingClients || [])) talkingClients.add(c);
  webcamClients.clear();
  for (const c of (state.webcamClients || [])) webcamClients.add(c);
  mutedClients.clear();
  for (const c of (state.mutedClients || [])) mutedClients.add(c);
  deafenedClients.clear();
  for (const c of (state.deafenedClients || [])) deafenedClients.add(c);
  voiceGrantedClients.clear();
  for (const c of (state.voiceGrantedClients || [])) voiceGrantedClients.add(c);
  voiceRequestClients.clear();
  for (const c of (state.voiceRequestClients || [])) voiceRequestClients.add(c);
  streamingClients.clear();
  for (const c of (state.streamingClients || [])) streamingClients.add(c);

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
  btnDisconnect.addEventListener('click', handleDisconnect);
  btnCreateChannel.addEventListener('click', onCreateChannelClick);
  window.gimodi.onMenuAction(onMenuAction);

  // Restore server icon
  _currentIconHash = state.iconHash || null;
  const sidebarIcon = document.querySelector('.sidebar-header-icon');
  if (sidebarIcon) {
    if (_currentIconHash && serverService.address) {
      getServerIcon(serverService.address, _currentIconHash).then(url => {
        if (url) sidebarIcon.src = url;
      }).catch(() => {
        sidebarIcon.src = '../../assets/icon.png';
      });
    } else {
      sidebarIcon.src = '../../assets/icon.png';
    }
  }

  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const canCreateGroup = serverService.hasPermission('channel.group_create');
  btnCreateChannel.style.display = (canCreate || canCreateTemp || canCreateGroup) ? '' : 'none';

  renderChannelTree();
}

export function getCurrentChannelId() {
  return currentChannelId;
}

export function getFirstChannelId() {
  const ch = channels.find(c => c.type !== 'group');
  return ch ? ch.id : null;
}

export function isCurrentChannelModerated() {
  const ch = channels.find(c => c.id === currentChannelId);
  return !!ch?.moderated;
}

export function hasVoiceGrant(clientId) {
  return voiceGrantedClients.has(clientId);
}

function getChannelName(id) {
  return channels.find(c => c.id === id)?.name || 'Unknown';
}

function handleDisconnect() {
  playSound(sndDisconnect);
  const address = serverService.address;
  window.dispatchEvent(new CustomEvent('gimodi:disconnect-server', {
    detail: { address },
  }));
}

async function onPoked(e) {
  const { fromNickname, message } = e.detail;
  if (message) {
    await customAlert(`You were poked by ${fromNickname}:\n${message}`);
  } else {
    await customAlert(`You were poked by ${fromNickname}!`);
  }
}

function onServerDisconnected(e) {
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

  channelItem.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    showCreateChannelModal();
  });
  groupItem.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    document.getElementById('modal-create-group').classList.remove('hidden');
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

  const canCreate = serverService.hasPermission('channel.create');
  const canCreateTemp = serverService.hasPermission('channel.create_temporary');
  const canCreateGroup = serverService.hasPermission('channel.group_create');
  const canCreateAnyChannel = canCreate || canCreateTemp;

  channelItem.style.display = canCreateAnyChannel ? '' : 'none';
  groupItem.style.display = canCreateGroup ? '' : 'none';

  const optionCount = [canCreateAnyChannel, canCreateGroup].filter(Boolean).length;
  if (optionCount === 0) return;

  // If only one option, skip dropdown and open directly
  if (optionCount === 1) {
    if (canCreateAnyChannel) { showCreateChannelModal(); return; }
    if (canCreateGroup) { document.getElementById('modal-create-group').classList.remove('hidden'); return; }
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

    function onConfirm() { cleanup(); resolve(input.value); }
    function onCancel() { cleanup(); resolve(null); }
    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      if (e.key === 'Escape') { onCancel(); }
    }
    function onBackdrop(e) { if (e.target === modal) onCancel(); }

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
  if (channelId === currentChannelId) return;

  const channel = channels.find(c => c.id === channelId);
  if (!channel) return;
  if (channel.type === 'group') return;

  let password;
  if (channel.hasPassword && !serverService.hasPermission('channel.bypass_password')) {
    // Try saved password first
    if (savedPasswords.has(channelId)) {
      password = savedPasswords.get(channelId);
    } else {
      password = await askChannelPassword();
      if (password === null) return;
    }
  }

  try {
    if (screenShareService.isSharing) screenShareService.stopSharing();
    voiceService.cleanup();
    const data = await serverService.request('channel:join', { channelId, password });
    currentChannelId = channelId;
    updateChannelTabLabel(channelId);

    // Reset voice moderation state for new channel
    voiceGrantedClients.clear();
    voiceRequestClients.clear();
    if (data.moderated && data.voiceGranted) {
      for (const id of data.voiceGranted) voiceGrantedClients.add(id);
    }

    // Save password on successful join
    if (channel.hasPassword && password != null) {
      savedPasswords.set(channelId, password);
    }

    // Update local client data
    const self = clients.find(c => c.id === serverService.clientId);
    if (self) self.channelId = channelId;

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

// --- Event handlers ---

function onForceJoined(e) {
  const { channelId, moderated, voiceGranted, readRestricted, writeRestricted } = e.detail;
  if (channelId === currentChannelId) return;

  if (screenShareService.isSharing) screenShareService.stopSharing();
  voiceService.cleanup();

  // Reset voice moderation state for new channel
  voiceGrantedClients.clear();
  voiceRequestClients.clear();
  if (moderated && voiceGranted) {
    for (const id of voiceGranted) voiceGrantedClients.add(id);
  }

  currentChannelId = channelId;
  updateChannelTabLabel(channelId);

  const self = clients.find(c => c.id === serverService.clientId);
  if (self) self.channelId = channelId;

  renderChannelTree();
  playSound(sndConnect);

  const forcedChannel = channels.find(c => c.id === channelId);
  if (forcedChannel) openChannelViewTab(channelId, forcedChannel.name, undefined, !!readRestricted, !!writeRestricted);

  window.dispatchEvent(new CustomEvent('gimodi:channel-changed', { detail: { channelId } }));
}

function onClientJoined(e) {
  const { clientId, userId, nickname, channelId, badge } = e.detail;
  const newClient = { id: clientId, userId: userId || null, nickname, channelId, badge: badge || null };
  clients.push(newClient);
  window.gimodiClients = clients;
  renderChannelTree();
}

function onClientLeft(e) {
  const { clientId } = e.detail;
  const client = clients.find(c => c.id === clientId);
  // Don't play sound here - onChannelUserLeft handles it to avoid double-play
  // (server sends both channel:user-left and server:client-left on disconnect)
  clients = clients.filter(c => c.id !== clientId);
  window.gimodiClients = clients;
  webcamClients.delete(clientId);
  streamingClients.delete(clientId);
  mutedClients.delete(clientId);
  deafenedClients.delete(clientId);
  voiceGrantedClients.delete(clientId);
  voiceRequestClients.delete(clientId);
  voiceService.removeConsumersForClient(clientId);
  renderChannelTree();
}

function onAdminChanged(e) {
  const { clientId, badge } = e.detail;
  const client = clients.find(c => c.id === clientId);
  if (client) {
    client.badge = badge ?? null;
    updateChatBadges(client.userId, badge ?? null);
  }
  renderChannelTree();
}

function onPermissionsChanged(e) {
  const { permissions } = e.detail;
  serverService.permissions = new Set(permissions);
  window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'), true);
  // Update button visibility
  btnCreateChannel.style.display = (serverService.hasPermission('channel.create') || serverService.hasPermission('channel.create_temporary') || serverService.hasPermission('channel.group_create')) ? '' : 'none';
}

function onClientMoved(e) {
  const { clientId, toChannelId } = e.detail;
  const client = clients.find(c => c.id === clientId);
  if (client) client.channelId = toChannelId;
  renderChannelTree();
}

function onChannelUserJoined(e) {
  const { clientId, userId, channelId, nickname } = e.detail;
  const client = clients.find(c => c.id === clientId);
  if (client) {
    client.channelId = channelId;
  } else {
    clients.push({ id: clientId, userId: userId || null, nickname, channelId });
  }
  // Skip sound for own join - switchChannel already plays it
  if (channelId === currentChannelId && clientId !== serverService.clientId) playSound(sndConnect);
  renderChannelTree();
}

function onChannelUserLeft(e) {
  const { clientId, channelId } = e.detail;
  // Don't remove from clients list - they moved, not disconnected
  // Skip sound for own leave - handleDisconnect/switchChannel already plays it
  if (channelId === currentChannelId && clientId !== serverService.clientId) playSound(sndDisconnect);
  renderChannelTree();
}

function onChannelCreated(e) {
  const { channel } = e.detail;
  if (!channels.find(c => c.id === channel.id)) {
    channels.push(channel);
  }
  window.gimodiChannels = channels;
  renderChannelTree();
}

function onChannelDeleted(e) {
  const { channelId } = e.detail;
  channels = channels.filter(c => c.id !== channelId);
  window.gimodiChannels = channels;
  renderChannelTree();
}

function onChannelUpdated(e) {
  const { channel } = e.detail;
  const idx = channels.findIndex(c => c.id === channel.id);
  if (idx >= 0) channels[idx] = { ...channels[idx], ...channel };
  // If current channel became unmoderated, clear voice state
  if (channel.id === currentChannelId && !channel.moderated) {
    voiceGrantedClients.clear();
    voiceRequestClients.clear();
  }
  // If current channel became moderated, dispatch event so app.js can handle mic
  if (channel.id === currentChannelId && channel.moderated) {
    window.dispatchEvent(new CustomEvent('gimodi:channel-moderated-changed', { detail: { moderated: true } }));
  } else if (channel.id === currentChannelId && !channel.moderated) {
    window.dispatchEvent(new CustomEvent('gimodi:channel-moderated-changed', { detail: { moderated: false } }));
  }
  renderChannelTree();
}

function onWebcamStarted(e) {
  const { clientId } = e.detail;
  webcamClients.add(clientId);
  renderChannelTree();
  playSound(sndWebcamStart);
}

function onWebcamStopped(e) {
  const { clientId } = e.detail;
  webcamClients.delete(clientId);
  renderChannelTree();
  playSound(sndWebcamStop);
}

function onLocalWebcamStarted() {
  webcamClients.add(serverService.clientId);
  renderChannelTree();
}

function onLocalWebcamStopped() {
  webcamClients.delete(serverService.clientId);
  renderChannelTree();
}

// --- Screen share indicators ---

function onPeerScreenStarted(e) {
  const { clientId } = e.detail;
  streamingClients.add(clientId);
  renderChannelTree();
  playSound(sndScreenStart);
}

function onPeerScreenStoppedIndicator(e) {
  const { clientId } = e.detail;
  streamingClients.delete(clientId);
  renderChannelTree();
  playSound(sndScreenStop);
}

function onLocalScreenStartedIndicator() {
  streamingClients.add(serverService.clientId);
  renderChannelTree();
}

function onLocalScreenStoppedIndicator() {
  streamingClients.delete(serverService.clientId);
  renderChannelTree();
}

function onPeerMuteStateChanged(e) {
  const { clientId, muted, deafened } = e.detail;
  if (muted) mutedClients.add(clientId); else mutedClients.delete(clientId);
  if (deafened) deafenedClients.add(clientId); else deafenedClients.delete(clientId);
  // Update icons in-place without full re-render
  updateMuteIcons(clientId);
}

function onLocalMuteChanged() {
  const id = serverService.clientId;
  if (voiceService._manualMute || voiceService._deafened) mutedClients.add(id); else mutedClients.delete(id);
  updateMuteIcons(id);
}

function onLocalDeafenChanged() {
  // Update local mute/deafen tracking for the sidebar
  const id = serverService.clientId;
  if (voiceService._manualMute || voiceService._deafened) mutedClients.add(id); else mutedClients.delete(id);
  if (voiceService._deafened) deafenedClients.add(id); else deafenedClients.delete(id);
  updateMuteIcons(id);
}

function onVoiceGranted(e) {
  const { clientId } = e.detail;
  voiceGrantedClients.add(clientId);
  voiceRequestClients.delete(clientId);
  renderChannelTree();
  // If it's us, dispatch event so app.js can start mic
  if (clientId === serverService.clientId) {
    window.dispatchEvent(new CustomEvent('gimodi:voice-granted'));
  }
}

function onVoiceRevoked(e) {
  const { clientId } = e.detail;
  voiceGrantedClients.delete(clientId);
  renderChannelTree();
  // If it's us, dispatch event so app.js can stop mic
  if (clientId === serverService.clientId) {
    window.dispatchEvent(new CustomEvent('gimodi:voice-revoked'));
  }
}

function onVoiceRequested(e) {
  const { clientId } = e.detail;
  voiceRequestClients.add(clientId);
}

function onVoiceRequestCancelled(e) {
  const { clientId } = e.detail;
  voiceRequestClients.delete(clientId);
}

function updateMuteIcons(clientId) {
  const containers = document.querySelectorAll(`.channel-user-status[data-client-id="${clientId}"]`);
  for (const el of containers) {
    const isMuted = mutedClients.has(clientId);
    const isDeafened = deafenedClients.has(clientId);
    if (isDeafened) {
      el.innerHTML = '<i class="bi bi-volume-mute"></i>';
      el.title = 'Deafened';
      el.classList.remove('hidden');
    } else if (isMuted) {
      el.innerHTML = '<i class="bi bi-mic-mute"></i>';
      el.title = 'Muted';
      el.classList.remove('hidden');
    } else {
      el.innerHTML = '';
      el.title = '';
      el.classList.add('hidden');
    }
  }
}

function onTalkingChanged(e) {
  const { clientId, talking } = e.detail;
  if (talking) {
    talkingClients.add(clientId);
  } else {
    talkingClients.delete(clientId);
  }
  // Only show talking indicator for users in our current channel
  const client = clients.find(c => c.id === clientId);
  const inCurrentChannel = client && client.channelId === currentChannelId;
  const indicators = document.querySelectorAll(`.voice-indicator[data-client-id="${clientId}"]`);
  for (const el of indicators) {
    el.classList.toggle('talking', talking && inCurrentChannel);
  }
}

// --- Rendering ---

// Find the index of a reference channel among its siblings (excluding the dragged channel)
function siblingIndex(refId, parentId, draggedId) {
  const siblings = channels
    .filter(c => c.id !== draggedId && (c.parentId || null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = siblings.findIndex(c => c.id === refId);
  return idx === -1 ? siblings.length : idx;
}

function moveChannel(channelId, newParentId, insertIndex) {
  // Recalculate sort orders for siblings at the target level
  const siblings = channels
    .filter(c => c.id !== channelId && (c.parentId || null) === newParentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

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
  const topLevel = channels.filter(c => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (parentId) => channels.filter(c => c.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);

  for (const ch of topLevel) {
    if (ch.type === 'group') {
      renderGroup(ch, childrenOf(ch.id));
    } else {
      renderChannel(ch, false);
      for (const child of childrenOf(ch.id)) {
        renderChannel(child, true);
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
      if (!draggedId || draggedId === group.id) return;

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
      renderChannel(child, true, group.id);
    }
  }

  // Drop zone after group (between groups) for moving channels to root level
  if (serverService.hasPermission('channel.update')) {
    const spacer = document.createElement('div');
    spacer.className = 'channel-group-drop-spacer';
    spacer.style.cssText = 'height:6px;position:relative';
    spacer.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-gimodi-user')) return;
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
      if (!draggedId) return;
      moveChannel(draggedId, null, siblingIndex(group.id, null, draggedId) + 1);
    });
    channelTree.appendChild(spacer);
  }
}

function renderChannel(ch, isChild, groupId) {
  const el = document.createElement('div');
  el.className = `channel-item${isChild ? ' child' : ''}${ch.id === currentChannelId ? ' active' : ''}${isChannelUnread(ch.id) ? ' unread' : ''}`;
  el.dataset.channelId = ch.id;

  // Build occupancy display
  const userCount = clients.filter(c => c.channelId === ch.id).length;
  const occupancy = ch.maxUsers ? ` <span style="color:var(--text-muted);font-size:0.9em">(${userCount}/${ch.maxUsers})</span>` : '';

  el.innerHTML = `
    <span class="channel-icon">#</span>
    <span>${escapeHtml(ch.name)}${occupancy}</span>
    ${ch.isTemporary ? '<span class="channel-temp" title="Temporary channel"><i class="bi bi-hourglass-split"></i></span>' : ''}
    ${ch.hasPassword ? '<span class="channel-lock"><i class="bi bi-lock"></i></span>' : ''}
  `;
  let clickTimer = null;
  el.addEventListener('click', () => {
    if (clickTimer) return; // second click will be handled by dblclick
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
            if (password === null) return;
            savedPasswords.set(ch.id, password);
          }
        }
        openChannelViewTab(ch.id, ch.name, password);
      }
    }, 250);
  });
  el.addEventListener('dblclick', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
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
        serverService.request('admin:move-user', { clientId: userId, channelId: ch.id }).catch(async err => await customAlert(err.message));
        return;
      }

      // Channel drop - reorder channels
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === ch.id) return;

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
        const targetCh = channels.find(c => c.id === ch.id);
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
  const usersInChannel = clients.filter(c => c.channelId === ch.id);
  if (usersInChannel.length > 0) {
    const usersEl = document.createElement('div');
    usersEl.className = 'channel-users';
    for (const u of usersInChannel) {
      const userEl = document.createElement('div');
      userEl.className = `channel-user${u.id === serverService.clientId ? ' self' : ''}`;
      const indicator = document.createElement('span');
      const isTalkingInCurrentChannel = talkingClients.has(u.id) && ch.id === currentChannelId;
      indicator.className = `voice-indicator${isTalkingInCurrentChannel ? ' talking' : ''}`;
      indicator.dataset.clientId = u.id;
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

      // Voice granted icon in moderated channels
      if (ch.moderated && voiceGrantedClients.has(u.id)) {
        const micIcon = document.createElement('span');
        micIcon.className = 'voice-granted-icon';
        micIcon.title = 'Voice granted';
        micIcon.innerHTML = '<i class="bi bi-mic"></i>';
        userEl.appendChild(micIcon);
      }

      // Mute/deafen status icon
      const statusIcon = document.createElement('span');
      statusIcon.className = 'channel-user-status';
      statusIcon.dataset.clientId = u.id;
      if (deafenedClients.has(u.id)) {
        statusIcon.innerHTML = '<i class="bi bi-volume-mute"></i>';
        statusIcon.title = 'Deafened';
      } else if (mutedClients.has(u.id)) {
        statusIcon.innerHTML = '<i class="bi bi-mic-mute"></i>';
        statusIcon.title = 'Muted';
      } else {
        statusIcon.classList.add('hidden');
      }
      userEl.appendChild(statusIcon);

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

      // Double-click to open DM
      if (u.id !== serverService.clientId) {
        userEl.style.cursor = 'pointer';
        userEl.addEventListener('dblclick', () => {
          window.dispatchEvent(new CustomEvent('gimodi:open-dm', {
            detail: {
              userId: u.id,
              persistentUserId: u.userId || null,
              nickname: u.nickname,
            },
          }));
        });
      }

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
        if (password === null) return;
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
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-move-channel';

  // Build list of valid parents (exclude self and own children)
  const isDescendant = (parentId, targetId) => {
    let current = parentId;
    while (current) {
      if (current === targetId) return true;
      const parent = channels.find(c => c.id === current);
      current = parent ? parent.parentId : null;
    }
    return false;
  };

  const validParents = channels.filter(c =>
    c.id !== ch.id && c.type === 'group' && !isDescendant(c.parentId, ch.id) && c.parentId !== ch.id
  );

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

  const closeModal = () => { modal.remove(); document.removeEventListener('keydown', onEscape); };

  modal.querySelector('.modal-move-btn').addEventListener('click', () => {
    const newParentId = modal.querySelector('.move-channel-parent').value || null;
    const siblings = channels
      .filter(c => c.id !== ch.id && (c.parentId || null) === newParentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const sortOrder = siblings.length > 0 ? siblings[siblings.length - 1].sortOrder + 1 : 0;
    serverService.send('channel:update', { channelId: ch.id, parentId: newParentId, sortOrder });
    closeModal();
  });

  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  const onEscape = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEscape);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileBrowserHttpBaseUrl() {
  const addr = serverService.address;
  if (!addr) return '';
  if (addr.startsWith('ws://')) return addr.replace(/^ws:\/\//, 'http://');
  if (addr.startsWith('wss://')) return addr.replace(/^wss:\/\//, 'https://');
  return `https://${addr}`;
}

function getFileIcon(mimeType) {
  if (!mimeType) return 'bi-file-earmark';
  if (mimeType.startsWith('image/')) return 'bi-file-earmark-image';
  if (mimeType.startsWith('video/')) return 'bi-file-earmark-play';
  if (mimeType.startsWith('audio/')) return 'bi-file-earmark-music';
  if (mimeType === 'application/pdf') return 'bi-file-earmark-pdf';
  if (mimeType === 'application/zip') return 'bi-file-earmark-zip';
  if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
  return 'bi-file-earmark';
}

async function showFileBrowserModal(ch) {
  const existing = document.querySelector('.modal-file-browser');
  if (existing) existing.remove();

  const canDelete = serverService.hasPermission('file.delete');
  const baseUrl = getFileBrowserHttpBaseUrl();

  const modal = document.createElement('div');
  modal.className = 'modal modal-file-browser';

  modal.innerHTML = `<div class="modal-content" style="width: 700px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column;">
    <div style="display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 12px 0;">
      <h2 style="margin: 0; font-size: 1.1rem;">File Browser - ${escapeHtml(ch.name)}</h2>
      <span class="file-browser-stats" style="font-size: 0.8rem; color: var(--text-muted, #888);"></span>
    </div>
    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
      <input type="text" class="file-browser-search" placeholder="Search files..." style="flex: 1 1 auto; min-width: 0; width: 0; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color, #444); background: var(--bg-input, #2a2a2a); color: var(--text-color, #eee); font-size: 0.85rem;">
      <select class="file-browser-sort" style="flex: 0 0 auto; width: 130px; padding: 6px 4px; border-radius: 4px; border: 1px solid var(--border-color, #444); background: var(--bg-input, #2a2a2a); color: var(--text-color, #eee); font-size: 0.78rem; cursor: pointer;">
        <option value="date-desc">Newest</option>
        <option value="date-asc">Oldest</option>
        <option value="size-desc">Largest</option>
        <option value="size-asc">Smallest</option>
        <option value="name-asc">Name A–Z</option>
        <option value="name-desc">Name Z–A</option>
      </select>
    </div>
    ${canDelete ? `<div class="file-browser-selection-bar" style="display: none; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.8rem;">
      <button class="btn-secondary file-browser-bulk-toggle" style="padding: 4px 10px; font-size: 0.78rem;"><i class="bi bi-check2-square"></i> Bulk select</button>
      <label class="file-browser-bulk-controls" style="display: none; align-items: center; gap: 4px; cursor: pointer;"><input type="checkbox" class="file-browser-select-all"> Select all</label>
      <span class="file-browser-selection-count" style="color: var(--text-muted, #888);"></span>
      <button class="btn-secondary file-browser-delete-selected danger" style="display: none; margin-left: auto; padding: 4px 10px; font-size: 0.78rem; color: var(--danger-color, #e74c3c);"><i class="bi bi-trash"></i> Delete selected</button>
    </div>` : ''}
    <div class="file-browser-list" style="flex: 1; overflow-y: auto; min-height: 200px;"></div>
    <div class="file-browser-load-more" style="text-align: center; padding: 8px; display: none;">
      <button class="btn-secondary file-browser-load-more-btn" style="font-size: 0.8rem;">Load more</button>
    </div>
    <div class="modal-buttons" style="margin-top: 10px;">
      <button class="btn-secondary modal-cancel-btn">Close</button>
    </div>
  </div>`;

  document.body.appendChild(modal);

  const listEl = modal.querySelector('.file-browser-list');
  const searchInput = modal.querySelector('.file-browser-search');
  const sortSelect = modal.querySelector('.file-browser-sort');
  const loadMoreContainer = modal.querySelector('.file-browser-load-more');
  const loadMoreBtn = modal.querySelector('.file-browser-load-more-btn');
  const statsEl = modal.querySelector('.file-browser-stats');

  const selectionBar = canDelete ? modal.querySelector('.file-browser-selection-bar') : null;
  const bulkToggleBtn = canDelete ? modal.querySelector('.file-browser-bulk-toggle') : null;
  const bulkControls = canDelete ? modal.querySelector('.file-browser-bulk-controls') : null;
  const selectAllCheckbox = canDelete ? modal.querySelector('.file-browser-select-all') : null;
  const selectionCountEl = canDelete ? modal.querySelector('.file-browser-selection-count') : null;
  const deleteSelectedBtn = canDelete ? modal.querySelector('.file-browser-delete-selected') : null;

  let allFiles = [];
  let oldestTimestamp = null;
  let hasMore = true;
  let bulkMode = false;
  const selectedIds = new Set();

  function updateStats() {
    const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
    statsEl.textContent = `${allFiles.length} file${allFiles.length !== 1 ? 's' : ''}${hasMore ? '+' : ''} · ${formatFileSize(totalSize)}${hasMore ? '+' : ''}`;
  }

  function updateSelectionUI() {
    if (!selectionBar) return;
    selectionBar.style.display = allFiles.length > 0 ? 'flex' : 'none';
    bulkControls.style.display = bulkMode ? 'flex' : 'none';
    deleteSelectedBtn.style.display = bulkMode ? '' : 'none';
    const count = selectedIds.size;
    selectionCountEl.textContent = bulkMode && count > 0 ? `${count} selected` : '';
    deleteSelectedBtn.disabled = count === 0;
    deleteSelectedBtn.style.opacity = count === 0 ? '0.5' : '1';
    // Update select-all checkbox state
    const visibleCheckboxes = listEl.querySelectorAll('.file-row-checkbox');
    const allChecked = visibleCheckboxes.length > 0 && [...visibleCheckboxes].every(cb => cb.checked);
    const someChecked = [...visibleCheckboxes].some(cb => cb.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  }

  function sortFiles(files) {
    const mode = sortSelect.value;
    const sorted = [...files];
    switch (mode) {
      case 'date-desc': sorted.sort((a, b) => b.createdAt - a.createdAt); break;
      case 'date-asc':  sorted.sort((a, b) => a.createdAt - b.createdAt); break;
      case 'size-desc': sorted.sort((a, b) => b.size - a.size); break;
      case 'size-asc':  sorted.sort((a, b) => a.size - b.size); break;
      case 'name-asc':  sorted.sort((a, b) => a.filename.localeCompare(b.filename)); break;
      case 'name-desc': sorted.sort((a, b) => b.filename.localeCompare(a.filename)); break;
    }
    return sorted;
  }

  function renderFiles(filter) {
    let filtered = filter
      ? allFiles.filter(f => f.filename.toLowerCase().includes(filter.toLowerCase()))
      : allFiles;
    filtered = sortFiles(filtered);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted, #888); padding: 40px 0;">${allFiles.length === 0 ? 'No files uploaded in this channel.' : 'No files match your search.'}</div>`;
      updateSelectionUI();
      return;
    }

    listEl.innerHTML = '';
    for (const file of filtered) {
      const row = document.createElement('div');
      row.className = 'file-browser-row';
      row.style.cssText = 'display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #333); gap: 10px; font-size: 0.85rem;';

      const icon = getFileIcon(file.mimeType);
      const date = new Date(file.createdAt);
      const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      row.innerHTML = `
        ${canDelete && bulkMode ? `<input type="checkbox" class="file-row-checkbox" data-file-id="${file.id}" ${selectedIds.has(file.id) ? 'checked' : ''} style="flex-shrink: 0; cursor: pointer;">` : ''}
        <i class="bi ${icon}" style="font-size: 1.3rem; flex-shrink: 0; width: 24px; text-align: center;"></i>
        <div style="flex: 1; min-width: 0;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted, #888);">${escapeHtml(file.nickname)} · ${dateStr} ${timeStr} · ${formatFileSize(file.size)}</div>
        </div>
        ${canDelete ? `<button class="btn-secondary file-delete-btn" title="Delete" style="flex-shrink: 0; padding: 4px 8px; font-size: 0.8rem; color: var(--danger-color, #e74c3c);"><i class="bi bi-trash"></i></button>` : ''}
        <button class="btn-secondary file-download-btn" title="Download" style="flex-shrink: 0; padding: 4px 8px; font-size: 0.8rem;"><i class="bi bi-download"></i></button>
      `;

      // Checkbox toggle (only present in bulk mode)
      if (canDelete && bulkMode) {
        row.querySelector('.file-row-checkbox').addEventListener('change', (e) => {
          if (e.target.checked) selectedIds.add(file.id);
          else selectedIds.delete(file.id);
          updateSelectionUI();
        });
      }

      // Single file delete
      if (canDelete) {
        row.querySelector('.file-delete-btn').addEventListener('click', async () => {
          if (!await customConfirm(`Delete "${file.filename}"?`)) return;
          try {
            await serverService.request('file:delete', { fileId: file.id });
            allFiles = allFiles.filter(f => f.id !== file.id);
            selectedIds.delete(file.id);
            updateStats();
            renderFiles(searchInput.value);
          } catch {
            await customAlert('Failed to delete file.');
          }
        });
      }

      // Download
      row.querySelector('.file-download-btn').addEventListener('click', () => {
        const url = baseUrl + file.url;
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        a.target = '_blank';
        a.click();
      });

      listEl.appendChild(row);
    }
    updateSelectionUI();
  }

  async function loadFiles() {
    try {
      const result = await serverService.request('file:list', {
        channelId: ch.id,
        before: oldestTimestamp || undefined,
        limit: 50,
      });
      const files = result.files || [];
      allFiles = allFiles.concat(files);
      if (files.length > 0) {
        oldestTimestamp = files[files.length - 1].createdAt;
      }
      hasMore = files.length >= 50;
      loadMoreContainer.style.display = hasMore ? '' : 'none';
      updateStats();
      renderFiles(searchInput.value);
    } catch (err) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--danger-color, #e74c3c); padding: 40px 0;">Failed to load files: ${escapeHtml(err.message)}</div>`;
    }
  }

  searchInput.addEventListener('input', () => renderFiles(searchInput.value));
  sortSelect.addEventListener('change', () => renderFiles(searchInput.value));
  loadMoreBtn.addEventListener('click', loadFiles);

  if (canDelete) {
    bulkToggleBtn.addEventListener('click', () => {
      bulkMode = !bulkMode;
      bulkToggleBtn.style.opacity = bulkMode ? '1' : '0.7';
      if (!bulkMode) {
        selectedIds.clear();
        selectAllCheckbox.checked = false;
      }
      renderFiles(searchInput.value);
    });

    selectAllCheckbox.addEventListener('change', () => {
      const checkboxes = listEl.querySelectorAll('.file-row-checkbox');
      for (const cb of checkboxes) {
        cb.checked = selectAllCheckbox.checked;
        if (selectAllCheckbox.checked) selectedIds.add(cb.dataset.fileId);
        else selectedIds.delete(cb.dataset.fileId);
      }
      updateSelectionUI();
    });

    deleteSelectedBtn.addEventListener('click', async () => {
      const count = selectedIds.size;
      if (count === 0) return;
      if (!await customConfirm(`Delete ${count} file${count !== 1 ? 's' : ''}?`)) return;
      const ids = [...selectedIds];
      let failed = 0;
      for (const id of ids) {
        try {
          await serverService.request('file:delete', { fileId: id });
          allFiles = allFiles.filter(f => f.id !== id);
          selectedIds.delete(id);
        } catch {
          failed++;
        }
      }
      updateStats();
      renderFiles(searchInput.value);
      if (failed > 0) await customAlert(`${failed} file${failed !== 1 ? 's' : ''} could not be deleted.`);
    });
  }

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEscape);

  // Initial load
  listEl.innerHTML = '<div style="text-align: center; padding: 40px 0; color: var(--text-muted, #888);">Loading...</div>';
  loadFiles();
}

async function showEditChannelModal(ch) {
  const existing = document.querySelector('.modal-edit-channel');
  if (existing) existing.remove();

  // Try to load roles for the access control section
  let roles = null;
  try {
    const result = await serverService.request('role:list', {});
    if (result && result.roles) roles = result.roles;
  } catch { /* no permission or error - skip roles section */ }

  const modal = document.createElement('div');
  modal.className = 'modal modal-edit-channel';
  const uid = ch.id;

  let rolesHtml = '';
  if (roles && roles.length > 0) {
    const currentAllowed = ch.allowedRoles || [];
    const currentWrite = ch.writeRoles || [];
    const currentRead = ch.readRoles || [];
    const makeChips = (cls, current) => roles.map(r => {
      const active = current.includes(r.id) ? ' active' : '';
      return `<button type="button" class="role-chip ${cls}${active}" data-role-id="${r.id}">
        <i class="bi ${active ? 'bi-check-circle-fill' : 'bi-circle'}"></i>
        ${escapeHtml(r.name)}
      </button>`;
    }).join('');
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
      </div>`;
  }

  const removePwHtml = ch.hasPassword ? `
    <label class="checkbox-label" for="edit-ch-rmpw-${uid}">
      <input type="checkbox" class="edit-channel-remove-pw" id="edit-ch-rmpw-${uid}">
      Remove existing password
    </label>` : '';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Edit Channel</h2>

      <div class="form-section-header">Basic Info</div>
      <div class="form-group">
        <label for="edit-ch-name-${uid}">Channel Name</label>
        <input type="text" id="edit-ch-name-${uid}" class="edit-channel-name"
               value="${escapeHtml(ch.name)}" maxlength="50" autocomplete="off">
        <div class="input-footer-row">
          <span class="input-error-msg" id="edit-ch-name-err-${uid}" role="alert"></span>
          <span class="char-counter" id="edit-ch-name-ctr-${uid}">${ch.name.length} / 50</span>
        </div>
      </div>
      <div class="form-group">
        <label for="edit-ch-max-${uid}">Max Users <span class="form-hint">(blank = unlimited)</span></label>
        <input type="number" id="edit-ch-max-${uid}" class="edit-channel-max-users"
               min="1" placeholder="Unlimited" value="${ch.maxUsers || ''}">
      </div>

      <div class="form-section-header">Security</div>
      <div class="form-group">
        <label for="edit-ch-pw-${uid}">New Password <span class="form-hint">(blank = keep unchanged)</span></label>
        <input type="password" id="edit-ch-pw-${uid}" class="edit-channel-password"
               placeholder="Enter new password" autocomplete="new-password">
      </div>
      ${removePwHtml}

      ${rolesHtml}

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
  };

  function getFormState() {
    const activeChips = (cls) => [...modal.querySelectorAll(`.role-chip.${cls}.active`)].map(c => c.dataset.roleId).sort();
    return {
      name: nameInput.value.trim(),
      maxUsers: modal.querySelector('.edit-channel-max-users').value,
      moderated: modal.querySelector('.edit-channel-moderated').checked,
      allowedRoles: JSON.stringify(activeChips('edit-ch-role')),
      readRoles: JSON.stringify(activeChips('edit-ch-read-role')),
      writeRoles: JSON.stringify(activeChips('edit-ch-write-role')),
    };
  }

  function isDirty() {
    if (removePwCheckbox && removePwCheckbox.checked) return true;
    if (passwordInput.value !== '') return true;
    const cur = getFormState();
    return cur.name !== initial.name
      || cur.maxUsers !== initial.maxUsers
      || cur.moderated !== initial.moderated
      || cur.allowedRoles !== initial.allowedRoles
      || cur.readRoles !== initial.readRoles
      || cur.writeRoles !== initial.writeRoles;
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

  modal.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateSaveBtn);
    input.addEventListener('change', updateSaveBtn);
  });

  modal.querySelectorAll('.acl-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.acl-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.acl-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`.acl-tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    });
  });

  modal.querySelectorAll('.role-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const icon = chip.querySelector('i');
      icon.className = chip.classList.contains('active') ? 'bi bi-check-circle-fill' : 'bi bi-circle';
      updateSaveBtn();
    });
  });

  nameInput.addEventListener('input', () => {
    updateCounter();
    if (nameInput.classList.contains('is-invalid')) validateName();
    updateSaveBtn();
  });

  if (removePwCheckbox) {
    removePwCheckbox.addEventListener('change', () => {
      passwordInput.disabled = removePwCheckbox.checked;
      if (removePwCheckbox.checked) passwordInput.value = '';
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
    if (!validateName()) return;
    const payload = { channelId: ch.id, name: nameInput.value.trim() };
    const removePwCb = modal.querySelector('.edit-channel-remove-pw');
    if (removePwCb && removePwCb.checked) {
      payload.password = null;
    } else {
      const pw = passwordInput.value;
      if (pw !== '') payload.password = pw;
    }
    const maxUsersInput = modal.querySelector('.edit-channel-max-users');
    const maxUsers = parseInt(maxUsersInput.value);
    payload.maxUsers = (maxUsers > 0) ? maxUsers : null;
    payload.moderated = modal.querySelector('.edit-channel-moderated').checked;
    const activeChips = (cls) => [...modal.querySelectorAll(`.role-chip.${cls}.active`)].map(c => c.dataset.roleId);
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
    saveBtn.classList.add('btn-save-loading');
    saveBtn.disabled = true;
    serverService.send('channel:update', payload);
    closeModal();
  };

  modal.querySelector('.modal-save-btn').addEventListener('click', save);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target === nameInput) save();
  };
  document.addEventListener('keydown', onEscape);
}

function showDeleteChannelConfirm(ch) {
  const existing = document.querySelector('.modal-delete-channel');
  if (existing) existing.remove();

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
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onEscape);
}

function showBanModal(user) {
  const existing = document.querySelector('.modal-ban-user');
  if (existing) existing.remove();

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
      await serverService.request('admin:ban', { clientId: user.id, reason, duration });
      closeModal();
    } catch (err) {
      await customAlert(err.message);
    }
  };

  modal.querySelector('.modal-ban-btn').addEventListener('click', confirmBan);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && (e.target === reasonInput || e.target === durationSelect)) confirmBan();
  };
  document.addEventListener('keydown', onEscape);
}

function showGroupContextMenu(e, group) {
  e.preventDefault();
  e.stopPropagation();
  dismissContextMenu();

  if (!serverService.hasPermission('channel.update') && !serverService.hasPermission('channel.delete') && !serverService.hasPermission('channel.create')) return;

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

function showEditGroupModal(group) {
  const existing = document.querySelector('.modal-edit-group');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-edit-group';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Edit Group</h2>
      <div class="form-group">
        <label>Group Name</label>
        <input type="text" class="edit-group-name" value="${escapeHtml(group.name)}">
      </div>
      <div class="modal-buttons">
        <button class="btn-primary modal-save-btn">Save</button>
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const nameInput = modal.querySelector('.edit-group-name');
  nameInput.focus();
  nameInput.select();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    serverService.send('channel:update', { channelId: group.id, name });
    closeModal();
  };

  modal.querySelector('.modal-save-btn').addEventListener('click', save);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target === nameInput) save();
  };
  document.addEventListener('keydown', onEscape);
}

function dismissContextMenu() {
  const existing = document.querySelector('.context-menu:not(#create-dropdown)');
  if (existing) existing.remove();
}

function showUserContextMenu(e, user) {
  e.preventDefault();
  dismissContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  // Only show "Send Message" and "Poke" for other users
  if (user.id !== serverService.clientId) {
    const dmItem = document.createElement('div');
    dmItem.className = 'context-menu-item';
    dmItem.textContent = 'Send Message';
    dmItem.addEventListener('click', () => {
      dismissContextMenu();
      window.dispatchEvent(new CustomEvent('gimodi:open-dm', { detail: { userId: user.id, persistentUserId: user.userId || null, nickname: user.nickname } }));
    });
    menu.appendChild(dmItem);

    if (serverService.hasPermission('user.poke')) {
      const pokeItem = document.createElement('div');
      pokeItem.className = 'context-menu-item';
      pokeItem.textContent = 'Poke';
      pokeItem.addEventListener('click', async () => {
        dismissContextMenu();
        const message = await customPrompt(`Poke message for ${user.nickname} (optional):`);
        if (message === null) return;
        try {
          await serverService.request('admin:poke', { clientId: user.id, message });
        } catch (err) {
          await customAlert(err.message);
        }
      });
      menu.appendChild(pokeItem);
    }
  }

  // Per-user volume control (only for other users with persistent identity)
  if (user.id !== serverService.clientId && user.userId) {
    const volSep = document.createElement('div');
    volSep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
    menu.appendChild(volSep);

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

    // Prevent context menu from closing when interacting with slider
    volContainer.addEventListener('click', (e) => e.stopPropagation());

    menu.appendChild(volContainer);
  }

  const item = document.createElement('div');
  item.className = 'context-menu-item';
  item.textContent = 'Connection Details';
  item.addEventListener('click', () => {
    dismissContextMenu();
    showConnectionDetails(user);
  });

  menu.appendChild(item);

  // Voice moderation items
  const currentChannel = channels.find(c => c.id === currentChannelId);
  if (currentChannel?.moderated) {
    // User with voice.grant viewing another non-admin user
    if ((serverService.hasPermission('voice.grant') || serverService.hasPermission('voice.revoke')) && user.id !== serverService.clientId && !user.badge) {
      const voiceSep = document.createElement('div');
      voiceSep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
      menu.appendChild(voiceSep);

      if (voiceGrantedClients.has(user.id)) {
        const revokeItem = document.createElement('div');
        revokeItem.className = 'context-menu-item';
        revokeItem.textContent = 'Revoke Voice';
        revokeItem.addEventListener('click', async () => {
          dismissContextMenu();
          try {
            await serverService.request('admin:revoke-voice', { clientId: user.id });
          } catch (err) { await customAlert(err.message); }
        });
        menu.appendChild(revokeItem);
      } else {
        const grantItem = document.createElement('div');
        grantItem.className = 'context-menu-item';
        grantItem.textContent = voiceRequestClients.has(user.id) ? 'Grant Voice (requested)' : 'Grant Voice';
        grantItem.addEventListener('click', async () => {
          dismissContextMenu();
          try {
            await serverService.request('admin:grant-voice', { clientId: user.id });
          } catch (err) { await customAlert(err.message); }
        });
        menu.appendChild(grantItem);
      }
    }

    // User right-clicking own name (non-moderator)
    if (user.id === serverService.clientId && !serverService.hasPermission('voice.grant')) {
      if (!voiceGrantedClients.has(user.id)) {
        const voiceSep = document.createElement('div');
        voiceSep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
        menu.appendChild(voiceSep);

        if (voiceRequestClients.has(user.id)) {
          const cancelItem = document.createElement('div');
          cancelItem.className = 'context-menu-item';
          cancelItem.textContent = 'Cancel Voice Request';
          cancelItem.addEventListener('click', async () => {
            dismissContextMenu();
            try {
              await serverService.request('voice:cancel-request');
              voiceRequestClients.delete(user.id);
            } catch (err) { await customAlert(err.message); }
          });
          menu.appendChild(cancelItem);
        } else {
          const requestItem = document.createElement('div');
          requestItem.className = 'context-menu-item';
          requestItem.textContent = 'Request Voice';
          requestItem.addEventListener('click', async () => {
            dismissContextMenu();
            try {
              await serverService.request('voice:request');
              voiceRequestClients.add(user.id);
            } catch (err) { await customAlert(err.message); }
          });
          menu.appendChild(requestItem);
        }
      }
    }
  }

  // Kick & ban actions for other users
  if ((serverService.hasPermission('user.kick') || serverService.hasPermission('user.ban')) && user.id !== serverService.clientId) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
    menu.appendChild(sep);
    if (serverService.hasPermission('user.kick')) {
      const kickItem = document.createElement('div');
      kickItem.className = 'context-menu-item danger';
      kickItem.textContent = 'Kick';
      kickItem.addEventListener('click', async () => {
        dismissContextMenu();
        try {
          await serverService.request('admin:kick', { clientId: user.id });
        } catch (err) {
          await customAlert(err.message);
        }
      });
      menu.appendChild(kickItem);
    }

    if (serverService.hasPermission('user.ban')) {
      const banItem = document.createElement('div');
      banItem.className = 'context-menu-item danger';
      banItem.textContent = 'Ban';
      banItem.addEventListener('click', () => {
        dismissContextMenu();
        showBanModal(user);
      });
      menu.appendChild(banItem);
    }
  }

  // Set Role - only for other users who have a persistent identity
  if (serverService.hasPermission('user.assign_role') && user.id !== serverService.clientId) {
    const roleSep = document.createElement('div');
    roleSep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
    menu.appendChild(roleSep);

    const roleItem = document.createElement('div');
    roleItem.className = 'context-menu-item';
    roleItem.textContent = 'Set Role...';
    roleItem.addEventListener('click', async () => {
      dismissContextMenu();
      await showSetRoleMenu(user, e.clientX, e.clientY);
    });
    menu.appendChild(roleItem);
  }

  document.body.appendChild(menu);

  // Dismiss on outside click
  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      dismissContextMenu();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  // Dismiss on Escape
  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      dismissContextMenu();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

async function showSetRoleMenu(user, x, y) {
  let result;
  try {
    result = await serverService.request('admin:get-user-roles', { clientId: user.id });
  } catch (err) {
    await customAlert(err.message);
    return;
  }

  if (!result.userId) {
    await customAlert('This user has no persistent identity and cannot be assigned a role.\nThey must connect with a cryptographic key.');
    return;
  }

  document.querySelectorAll('.context-menu').forEach(m => m.remove());

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
          await serverService.request('admin:remove-role', { clientId: user.id, roleId });
        } else {
          await serverService.request('admin:assign-role', { clientId: user.id, roleId });
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
  if (!currentRole) noneRow.style.opacity = '0.5';
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
        await serverService.request('admin:remove-role', { clientId: user.id, roleId: currentRole.id });
      } catch (err) { await customAlert(err.message); }
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
  if (existing) existing.remove();

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
    if (e.target === modal) closeModal();
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
  if (action === 'redeem-token') { showRedeemTokenModal(); return; }
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

async function renderUsersPanel(container) {
  container.innerHTML = '<div style="padding:12px;color:var(--text-muted)">Loading users...</div>';

  let users;
  try {
    const result = await serverService.request('admin:list-users');
    users = result.users;
  } catch (err) {
    container.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
    return;
  }

  // Sort: online first, then alphabetical
  users.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.nickname.localeCompare(b.nickname);
  });

  const onlineCount = users.filter(u => u.online).length;
  const selectedUserIds = new Set();
  let selectionMode = false;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 12px">
      <h3 style="margin:0;font-size:14px">All Users (${users.length}, ${onlineCount} online)</h3>
      <button class="btn-primary bulk-delete-btn" style="background:var(--danger);display:none;font-size:12px;padding:4px 12px">Delete Selected (0)</button>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="text-align:left;color:var(--text-secondary);font-size:12px">
          <th class="checkbox-col" style="padding:6px 8px;border-bottom:1px solid var(--border);width:28px;display:none">
            <input type="checkbox" class="select-all-cb" title="Select all">
          </th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border);width:24px"></th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Nickname</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Role</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">Last Seen</th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border)">User ID</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = container.querySelector('tbody');
  const bulkDeleteBtn = container.querySelector('.bulk-delete-btn');
  const selectAllCb = container.querySelector('.select-all-cb');
  const checkboxColHeader = container.querySelector('.checkbox-col');

  const updateBulkDeleteBtn = () => {
    if (selectedUserIds.size > 0) {
      bulkDeleteBtn.style.display = '';
      bulkDeleteBtn.textContent = `Delete Selected (${selectedUserIds.size})`;
    } else {
      bulkDeleteBtn.style.display = 'none';
    }
  };

  const enterSelectionMode = () => {
    if (selectionMode) return;
    selectionMode = true;
    checkboxColHeader.style.display = '';
    for (const cb of tbody.querySelectorAll('.user-row-cb-td')) {
      cb.style.display = '';
    }
  };

  const exitSelectionMode = () => {
    selectionMode = false;
    selectedUserIds.clear();
    checkboxColHeader.style.display = 'none';
    selectAllCb.checked = false;
    for (const cb of tbody.querySelectorAll('.user-row-cb-td')) {
      cb.style.display = 'none';
      cb.querySelector('input').checked = false;
    }
    updateBulkDeleteBtn();
  };

  selectAllCb.addEventListener('change', () => {
    const checked = selectAllCb.checked;
    for (const cb of tbody.querySelectorAll('.user-row-cb input')) {
      cb.checked = checked;
      const userId = cb.dataset.userId;
      if (checked) selectedUserIds.add(userId);
      else selectedUserIds.delete(userId);
    }
    updateBulkDeleteBtn();
  });

  bulkDeleteBtn.addEventListener('click', async () => {
    const count = selectedUserIds.size;
    if (count === 0) return;
    if (!await customConfirm(`Are you sure you want to permanently delete ${count} user${count > 1 ? 's' : ''}?\n\nThis will remove their identities, roles, and all DM history.`)) return;

    bulkDeleteBtn.disabled = true;
    bulkDeleteBtn.textContent = 'Deleting...';
    try {
      await serverService.request('admin:bulk-delete-users', { userIds: [...selectedUserIds] });
    } catch (err) {
      await customAlert(err.message);
    }
    renderUsersPanel(container);
  });

  if (users.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 6;
    emptyCell.style.cssText = 'padding:12px;color:var(--text-muted)';
    emptyCell.textContent = 'No registered users';
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    return;
  }

  for (const user of users) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'cursor:context-menu';
    tr.addEventListener('contextmenu', (e) => showAdminUserContextMenu(e, user, container));

    // Checkbox cell (hidden until selection mode)
    const cbTd = document.createElement('td');
    cbTd.className = 'user-row-cb-td';
    cbTd.style.cssText = 'padding:6px 8px;text-align:center;display:none';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'user-row-cb';
    cb.dataset.userId = user.userId;
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) selectedUserIds.add(user.userId);
      else selectedUserIds.delete(user.userId);
      selectAllCb.checked = selectedUserIds.size === users.length;
      updateBulkDeleteBtn();
    });
    cbTd.appendChild(cb);
    tr.appendChild(cbTd);

    // Click row to enter selection mode and toggle checkbox
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      enterSelectionMode();
      cb.checked = !cb.checked;
      if (cb.checked) selectedUserIds.add(user.userId);
      else selectedUserIds.delete(user.userId);
      selectAllCb.checked = selectedUserIds.size === users.length;
      updateBulkDeleteBtn();
    });

    // Status dot
    const statusTd = document.createElement('td');
    statusTd.style.cssText = 'padding:6px 8px;text-align:center';
    statusTd.innerHTML = user.online
      ? '<span style="color:#4caf50;font-size:10px" title="Online">●</span>'
      : '<span style="color:#888;font-size:10px" title="Offline">●</span>';
    tr.appendChild(statusTd);

    // Nickname
    const nickTd = document.createElement('td');
    nickTd.style.cssText = 'padding:6px 8px';
    nickTd.textContent = user.nickname;
    tr.appendChild(nickTd);

    // Role
    const roleTd = document.createElement('td');
    roleTd.style.cssText = 'padding:6px 8px;font-size:12px;color:var(--text-secondary)';
    roleTd.textContent = user.roles.length > 0 ? user.roles.map(r => r.name).join(', ') : '-';
    tr.appendChild(roleTd);

    // Last Seen
    const seenTd = document.createElement('td');
    seenTd.style.cssText = 'padding:6px 8px;font-size:12px;color:var(--text-secondary)';
    if (user.online) {
      seenTd.textContent = 'Now';
      seenTd.style.color = '#4caf50';
    } else if (user.lastSeenAt) {
      const ago = formatTimeAgo(user.lastSeenAt);
      seenTd.textContent = ago;
      seenTd.title = new Date(user.lastSeenAt).toLocaleString();
    } else {
      seenTd.textContent = '-';
    }
    tr.appendChild(seenTd);

    // User ID
    const idTd = document.createElement('td');
    idTd.style.cssText = 'padding:6px 8px;font-family:monospace;font-size:12px';
    idTd.textContent = user.userId.slice(0, 8) + '...';
    idTd.title = user.userId;
    tr.appendChild(idTd);

    tbody.appendChild(tr);
  }
}

function showAdminUserContextMenu(e, user, panelContainer) {
  e.preventDefault();
  dismissContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  // Copy User ID
  const copyItem = document.createElement('div');
  copyItem.className = 'context-menu-item';
  copyItem.textContent = 'Copy User ID';
  copyItem.addEventListener('click', () => {
    dismissContextMenu();
    navigator.clipboard.writeText(user.userId);
  });
  menu.appendChild(copyItem);

  // Online-only actions
  if (user.online && user.clientId) {
    // Send Message
    const dmItem = document.createElement('div');
    dmItem.className = 'context-menu-item';
    dmItem.textContent = 'Send Message';
    dmItem.addEventListener('click', () => {
      dismissContextMenu();
      window.dispatchEvent(new CustomEvent('gimodi:open-dm', { detail: { userId: user.clientId, persistentUserId: user.userId, nickname: user.nickname } }));
    });
    menu.appendChild(dmItem);

    if (serverService.hasPermission('user.poke')) {
      const pokeItem = document.createElement('div');
      pokeItem.className = 'context-menu-item';
      pokeItem.textContent = 'Poke';
      pokeItem.addEventListener('click', async () => {
        dismissContextMenu();
        const message = await customPrompt(`Poke message for ${user.nickname} (optional):`);
        if (message === null) return;
        try {
          await serverService.request('admin:poke', { clientId: user.clientId, message });
        } catch (err) { await customAlert(err.message); }
      });
      menu.appendChild(pokeItem);
    }

    if (serverService.hasPermission('user.kick')) {
      const sep = document.createElement('div');
      sep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
      menu.appendChild(sep);

      const kickItem = document.createElement('div');
      kickItem.className = 'context-menu-item danger';
      kickItem.textContent = 'Kick';
      kickItem.addEventListener('click', async () => {
        dismissContextMenu();
        try {
          await serverService.request('admin:kick', { clientId: user.clientId });
          renderUsersPanel(panelContainer);
        } catch (err) { await customAlert(err.message); }
      });
      menu.appendChild(kickItem);
    }
  }

  // Assign Role (works for online and offline)
  if (serverService.hasPermission('user.assign_role')) {
    const roleSep = document.createElement('div');
    roleSep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
    menu.appendChild(roleSep);

    const roleItem = document.createElement('div');
    roleItem.className = 'context-menu-item';
    roleItem.textContent = 'Set Role...';
    roleItem.addEventListener('click', async () => {
      dismissContextMenu();
      await showSetRoleMenuByUserId(user, e.clientX, e.clientY, panelContainer);
    });
    menu.appendChild(roleItem);
  }

  // Ban (works for online and offline)
  if (serverService.hasPermission('user.ban')) {
    const banSep = document.createElement('div');
    banSep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
    menu.appendChild(banSep);

    const banItem = document.createElement('div');
    banItem.className = 'context-menu-item danger';
    banItem.textContent = 'Ban User';
    banItem.addEventListener('click', () => {
      dismissContextMenu();
      showBanByUserIdModal(user, panelContainer);
    });
    menu.appendChild(banItem);

    // Delete User
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item danger';
    deleteItem.textContent = 'Delete User';
    deleteItem.addEventListener('click', async () => {
      dismissContextMenu();
      if (!await customConfirm(`Are you sure you want to permanently delete user "${user.nickname}"?\n\nThis will remove their identity, roles, and all DM history.`)) return;
      try {
        await serverService.request('admin:delete-user', { userId: user.userId });
        renderUsersPanel(panelContainer);
      } catch (err) { await customAlert(err.message); }
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

async function showSetRoleMenuByUserId(user, x, y, panelContainer) {
  let result;
  try {
    result = await serverService.request('admin:get-user-roles-by-userid', { userId: user.userId });
  } catch (err) {
    await customAlert(err.message);
    return;
  }

  document.querySelectorAll('.context-menu').forEach(m => m.remove());

  const submenu = document.createElement('div');
  submenu.className = 'context-menu';
  submenu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10001;min-width:180px`;

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
          await serverService.request('admin:remove-role-by-userid', { userId: user.userId, roleId });
        } else {
          await serverService.request('admin:assign-role-by-userid', { userId: user.userId, roleId });
        }
        renderUsersPanel(panelContainer);
      } catch (err) { await customAlert(err.message); }
    });
    submenu.appendChild(row);
  };

  // "None" option
  const noneRow = document.createElement('div');
  noneRow.className = 'context-menu-item' + (!currentRole ? ' disabled' : '');
  noneRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  if (!currentRole) noneRow.style.opacity = '0.5';
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
        await serverService.request('admin:remove-role-by-userid', { userId: user.userId, roleId: currentRole.id });
        renderUsersPanel(panelContainer);
      } catch (err) { await customAlert(err.message); }
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

function showBanByUserIdModal(user, panelContainer) {
  const existing = document.querySelector('.modal-ban-user');
  if (existing) existing.remove();

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
      await serverService.request('admin:ban-user', { userId: user.userId, reason, duration });
      closeModal();
      renderUsersPanel(panelContainer);
    } catch (err) {
      await customAlert(err.message);
    }
  };

  modal.querySelector('.modal-ban-btn').addEventListener('click', confirmBan);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && (e.target === reasonInput || e.target === durationSelect)) confirmBan();
  };
  document.addEventListener('keydown', onEscape);
}

function showListUsersModal() {
  const existing = document.querySelector('.modal-list-users');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-list-users';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:550px">
      <div class="users-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  renderUsersPanel(modal.querySelector('.users-panel-container'));

  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  const onEscape = (e) => {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onEscape); }
  };
  document.addEventListener('keydown', onEscape);
}

async function renderTokensPanel(container) {
  container.innerHTML = `
    <div class="token-create-form" style="margin:0 0 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select class="token-role-select" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:13px">
        <option value="admin">Admin</option>
      </select>
      <select class="token-expiry-select" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:13px">
        <option value="3600000">1 Stunde</option>
        <option value="21600000">6 Stunden</option>
        <option value="43200000">12 Stunden</option>
        <option value="86400000" selected>24 Stunden</option>
        <option value="172800000">48 Stunden</option>
        <option value="604800000">7 Tage</option>
        <option value="2592000000">30 Tage</option>
      </select>
      <button class="btn-primary modal-create-btn">Create Token</button>
    </div>
    <div class="token-list" style="max-height:350px;overflow-y:auto"></div>
  `;

  const tokenList = container.querySelector('.token-list');
  const roleNameMap = new Map();

  const renderTokens = (tokens) => {
    if (!tokens.length) {
      tokenList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No unredeemed tokens</div>';
      return;
    }
    tokenList.innerHTML = '';
    for (const t of tokens) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border)';
      const tokenText = document.createElement('code');
      tokenText.style.cssText = 'flex:1;font-size:12px;user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      tokenText.textContent = t.token;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-secondary';
      copyBtn.style.cssText = 'padding:2px 8px;font-size:12px';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(t.token).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
      });
      const roleBadge = document.createElement('span');
      roleBadge.style.cssText = 'font-size:11px;color:var(--text-secondary);background:var(--bg-tertiary);padding:1px 6px;border-radius:3px;white-space:nowrap';
      roleBadge.textContent = roleNameMap.get(t.role) || t.role || 'admin';
      const expiryInfo = document.createElement('span');
      expiryInfo.style.cssText = 'font-size:11px;color:var(--text-secondary);white-space:nowrap';
      if (t.expires_at) {
        const remaining = t.expires_at - Date.now();
        if (remaining <= 0) {
          expiryInfo.textContent = 'Abgelaufen';
          expiryInfo.style.color = 'var(--danger)';
        } else if (remaining < 3600000) {
          expiryInfo.textContent = `${Math.ceil(remaining / 60000)}m`;
        } else if (remaining < 86400000) {
          expiryInfo.textContent = `${Math.round(remaining / 3600000)}h`;
        } else {
          expiryInfo.textContent = `${Math.round(remaining / 86400000)}d`;
        }
      } else {
        expiryInfo.textContent = 'Kein Ablauf';
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-secondary';
      delBtn.style.cssText = 'padding:2px 8px;font-size:12px';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        try {
          await serverService.request('token:delete', { token: t.token });
          row.remove();
          if (!tokenList.children.length) {
            tokenList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No unredeemed tokens</div>';
          }
        } catch (err) {
          await customAlert(err.message);
        }
      });
      row.append(tokenText, copyBtn, roleBadge, expiryInfo, delBtn);
      tokenList.appendChild(row);
    }
  };

  // Load roles into dropdown
  const roleSelect = container.querySelector('.token-role-select');
  try {
    const roleResult = await serverService.request('role:list');
    roleSelect.innerHTML = '';
    for (const r of roleResult.roles) {
      roleNameMap.set(r.id, r.name);
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      if (r.id === 'admin') opt.selected = true;
      roleSelect.appendChild(opt);
    }
  } catch { /* keep default admin option */ }

  // Load tokens
  try {
    const result = await serverService.request('token:list');
    renderTokens(result.tokens);
  } catch (err) {
    tokenList.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
  }

  // Create token
  const expirySelect = container.querySelector('.token-expiry-select');
  container.querySelector('.modal-create-btn').addEventListener('click', async () => {
    try {
      const role = roleSelect.value;
      const expiresIn = parseInt(expirySelect.value, 10);
      await serverService.request('token:create', { role, expiresIn });
      const listResult = await serverService.request('token:list');
      renderTokens(listResult.tokens);
    } catch (err) {
      await customAlert(err.message);
    }
  });
}

async function showManageTokensModal() {
  const existing = document.querySelector('.modal-manage-tokens');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-tokens';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:600px">
      <h2>Admin Tokens</h2>
      <div class="tokens-panel-container"></div>
      <div class="modal-buttons" style="justify-content:flex-end">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderTokensPanel(modal.querySelector('.tokens-panel-container'));

  const closeModal = () => { modal.remove(); document.removeEventListener('keydown', onEscape); };
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  const onEscape = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEscape);
}

async function renderBansPanel(container) {
  container.innerHTML = '<div class="ban-list" style="max-height:400px;overflow-y:auto"></div>';

  const banList = container.querySelector('.ban-list');

  const renderBans = (bans) => {
    if (!bans.length) {
      banList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No bans</div>';
      return;
    }
    banList.innerHTML = '';
    for (const ban of bans) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border)';
      if (ban.isExpired) {
        row.style.opacity = '0.5';
      }

      const ip = document.createElement('code');
      ip.style.cssText = 'flex:0 0 130px;font-size:12px';
      ip.textContent = ban.ip;

      const reason = document.createElement('span');
      reason.style.cssText = 'flex:1;font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      reason.textContent = ban.reason || '(no reason)';

      const expiry = document.createElement('span');
      expiry.style.cssText = 'font-size:11px;color:var(--text-muted);white-space:nowrap';
      if (ban.expires_at) {
        const expiryDate = new Date(ban.expires_at);
        expiry.textContent = ban.isExpired ? `Expired ${expiryDate.toLocaleDateString()}` : `Expires ${expiryDate.toLocaleDateString()}`;
      } else {
        expiry.textContent = 'Permanent';
      }

      const unbanBtn = document.createElement('button');
      unbanBtn.className = 'btn-secondary';
      unbanBtn.style.cssText = 'padding:2px 8px;font-size:12px';
      unbanBtn.textContent = 'Unban';
      unbanBtn.addEventListener('click', async () => {
        try {
          await serverService.request('admin:remove-ban', { banId: ban.id });
          row.remove();
          if (!banList.children.length) {
            banList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No bans</div>';
          }
        } catch (err) {
          await customAlert(err.message);
        }
      });

      row.append(ip, reason, expiry, unbanBtn);
      banList.appendChild(row);
    }
  };

  try {
    const result = await serverService.request('admin:list-bans');
    renderBans(result.bans);
  } catch (err) {
    banList.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
  }
}

async function showManageBansModal() {
  const existing = document.querySelector('.modal-manage-bans');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-bans';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:650px">
      <h2>Ban List</h2>
      <div class="bans-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderBansPanel(modal.querySelector('.bans-panel-container'));

  const closeModal = () => { modal.remove(); document.removeEventListener('keydown', onEscape); };
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  const onEscape = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEscape);
}

export function showRedeemTokenModal() {
  const existing = document.querySelector('.modal-redeem-token');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-redeem-token';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Redeem Server Token</h2>
      <div class="form-group">
        <label>Enter token</label>
        <input type="text" class="redeem-token-input" placeholder="Paste admin token here" spellcheck="false" autocomplete="off">
      </div>
      <div class="redeem-token-status" style="margin:8px 0;min-height:20px"></div>
      <div class="modal-buttons">
        <button class="btn-primary modal-redeem-btn">Redeem</button>
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const input = modal.querySelector('.redeem-token-input');
  const statusEl = modal.querySelector('.redeem-token-status');
  input.focus();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  const redeem = async () => {
    const token = input.value.trim();
    if (!token) return;
    statusEl.textContent = 'Redeeming...';
    statusEl.style.color = 'var(--text-secondary)';
    try {
      const result = await serverService.request('token:redeem', { token });
      if (result.permissions) {
        serverService.permissions = new Set(result.permissions);
      }
      window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'));
      closeModal();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.style.color = 'var(--danger, #f44336)';
    }
  };

  modal.querySelector('.modal-redeem-btn').addEventListener('click', redeem);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const onEscape = (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target === input) redeem();
  };
  document.addEventListener('keydown', onEscape);
}


async function renderRolesPanel(container) {
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;';
  container.innerHTML = `
    <div style="display:flex;flex:1;min-height:0">
      <div class="roles-sidebar" style="width:180px;border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0">
        <div style="padding:12px 12px 8px;font-weight:600;font-size:13px;border-bottom:1px solid var(--border)">Roles</div>
        <div class="roles-list" style="flex:1;overflow-y:auto"></div>
        <div style="display:flex;border-top:1px solid var(--border);padding:6px">
          <button class="btn-icon roles-add-btn" title="Add role" style="flex:1;font-size:18px;line-height:1">+</button>
          <button class="btn-icon roles-remove-btn" title="Remove role" style="flex:1;font-size:18px;line-height:1">\u2212</button>
        </div>
      </div>
      <div class="roles-detail" style="flex:1;display:flex;flex-direction:column;min-width:0">
        <div class="roles-detail-empty" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px">
          Select a role to edit its permissions
        </div>
        <div class="roles-detail-content" style="display:none;flex:1;flex-direction:column;min-height:0">
          <div style="padding:12px 16px 8px;border-bottom:1px solid var(--border)">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
              <div style="flex:1">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Role Name</label>
                <input class="roles-name-input" type="text" style="width:100%;box-sizing:border-box">
              </div>
              <div style="width:120px">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Badge Text</label>
                <input class="roles-badge-input" type="text" placeholder="(none)" style="width:100%;box-sizing:border-box">
              </div>
            </div>
          </div>
          <div style="display:flex;flex:1;min-height:0">
            <div class="roles-perms-list" style="width:280px;flex-shrink:0;overflow-y:auto;padding:8px 16px"></div>
            <div class="roles-members-section" style="flex:1;border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden">
              <div style="font-size:11px;color:var(--text-muted);padding:8px 12px 6px">Members</div>
              <div class="roles-members-list" style="flex:1;overflow-y:auto;padding:0 12px 8px"></div>
            </div>
          </div>
          <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
            <button class="btn-secondary roles-cancel-btn">Cancel</button>
            <button class="btn-primary roles-save-btn">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  _initRolesLogic(container);
}

async function _initRolesLogic(root) {

  const rolesList = root.querySelector('.roles-list');
  const rolesDetailEmpty = root.querySelector('.roles-detail-empty');
  const rolesDetailContent = root.querySelector('.roles-detail-content');
  const nameInput = root.querySelector('.roles-name-input');
  const badgeInput = root.querySelector('.roles-badge-input');
  const membersContainer = root.querySelector('.roles-members-list');
  const membersSection = root.querySelector('.roles-members-section');
  const permsContainer = root.querySelector('.roles-perms-list');

  let roles = [];
  let availablePermissions = []; // loaded from server
  let permissionGroups = [];     // grouped permissions from server
  let selectedRoleId = null;
  let pendingPerms = new Set();
  let pendingName = '';
  let pendingBadge = '';

  const renderRolesList = () => {
    rolesList.innerHTML = '';
    for (const role of roles) {
      const item = document.createElement('div');
      item.className = 'roles-list-item';
      item.dataset.roleId = role.id;
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:13px;user-select:none;display:flex;align-items:center;gap:6px';
      if (role.id === selectedRoleId) {
        item.style.background = '#232323';
        item.style.color = '#fff';
      }
      const nameSpan = document.createElement('span');
      nameSpan.style.flex = '1';
      nameSpan.textContent = role.name;
      item.appendChild(nameSpan);
      if (role.badge) {
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.2)';
        badge.textContent = role.badge;
        item.appendChild(badge);
      }
      if (role.id === 'admin' || role.id === 'user') {
        const defaultTag = document.createElement('span');
        defaultTag.style.cssText = 'font-size:9px;padding:1px 4px;border-radius:3px;background:var(--bg-tertiary);color:var(--text-secondary);border:1px solid var(--border)';
        defaultTag.textContent = 'default';
        item.appendChild(defaultTag);
      }

      item.addEventListener('click', () => selectRole(role.id));

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showRoleContextMenu(e.clientX, e.clientY, role);
      });

      rolesList.appendChild(item);
    }
  };

  const selectRole = (roleId) => {
    selectedRoleId = roleId;
    renderRolesList();

    const role = roles.find(r => r.id === roleId);
    if (!role) {
      rolesDetailEmpty.style.display = 'flex';
      rolesDetailContent.style.display = 'none';
      return;
    }

    rolesDetailEmpty.style.display = 'none';
    rolesDetailContent.style.display = 'flex';

    const isStatic = role.id === 'admin' || role.id === 'user';
    nameInput.value = role.name;
    nameInput.disabled = isStatic;
    badgeInput.value = role.badge || '';
    pendingPerms = new Set(role.permissions || []);
    pendingName = role.name;
    pendingBadge = role.badge || '';

    renderPerms(role.id === 'admin');

    if (role.id === 'user') {
      membersSection.style.display = 'none';
    } else {
      membersSection.style.display = '';
      loadMembers(roleId);
    }
  };

  const loadMembers = async (roleId) => {
    membersContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Loading...</span>';
    try {
      const result = await serverService.request('role:get-members', { roleId });
      if (selectedRoleId !== roleId) return;
      renderMembers(result.members, roleId);
    } catch {
      membersContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Failed to load members</span>';
    }
  };

  const renderMembers = (members, roleId) => {
    membersContainer.innerHTML = '';
    if (!members.length) {
      membersContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No members</span>';
      return;
    }
    const nameCounts = {};
    for (const m of members) nameCounts[m.name] = (nameCounts[m.name] || 0) + 1;
    for (const member of members) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px';

      const name = document.createElement('span');
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const fpShort = member.fingerprint ? member.fingerprint.slice(0, 8) : null;
      if (nameCounts[member.name] > 1 && fpShort) {
        name.textContent = `${member.name} [${fpShort}]`;
        name.title = `Fingerprint: ${member.fingerprint}`;
      } else {
        name.textContent = member.name;
        if (fpShort) name.title = `Fingerprint: ${member.fingerprint}`;
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-secondary';
      removeBtn.style.cssText = 'padding:1px 6px;font-size:11px;flex-shrink:0';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        // Find connected client by userId to call admin:remove-role
        const connectedClient = clients.find(c => c.userId === member.user_id);
        if (connectedClient) {
          try {
            await serverService.request('admin:remove-role', { clientId: connectedClient.id, roleId });
          } catch (err) { await customAlert(err.message); return; }
        } else {
          // User is offline - remove directly via new endpoint
          try {
            await serverService.request('role:remove-member', { userId: member.user_id, roleId });
          } catch (err) { await customAlert(err.message); return; }
        }
        loadMembers(roleId);
      });

      row.append(name, removeBtn);
      membersContainer.appendChild(row);
    }
  };

  const collapsedGroups = new Set(); // track collapsed group IDs

  const renderPerms = (readOnly = false) => {
    permsContainer.innerHTML = '';
    if (readOnly) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--text-muted);padding:4px 0 8px';
      note.textContent = 'Permissions for the admin role cannot be changed.';
      permsContainer.appendChild(note);
    }

    const groups = permissionGroups.length > 0
      ? permissionGroups
      : [{ id: 'all', label: 'All Permissions', permissions: availablePermissions }];

    for (const group of groups) {
      const isCollapsed = collapsedGroups.has(group.id);
      const checkedCount = group.permissions.filter(p => pendingPerms.has(p.key)).length;

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 0 4px;cursor:pointer;user-select:none;font-size:12px;font-weight:600;color:var(--text-secondary)';
      const arrow = document.createElement('span');
      arrow.style.cssText = 'font-size:10px;width:12px;text-align:center;flex-shrink:0;transition:transform 0.15s';
      arrow.textContent = '\u25B6';
      if (!isCollapsed) arrow.style.transform = 'rotate(90deg)';
      const groupLabel = document.createElement('span');
      groupLabel.style.flex = '1';
      groupLabel.textContent = group.label;
      const counter = document.createElement('span');
      counter.style.cssText = 'font-size:10px;color:var(--text-muted);font-weight:400';
      counter.textContent = `${checkedCount}/${group.permissions.length}`;

      header.append(arrow, groupLabel, counter);
      permsContainer.appendChild(header);

      const body = document.createElement('div');
      body.style.cssText = `padding-left:18px;${isCollapsed ? 'display:none;' : ''}`;

      for (const { key, label } of group.permissions) {
        const row = document.createElement('label');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;${readOnly ? 'opacity:0.5;' : 'cursor:pointer;'}`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = pendingPerms.has(key);
        checkbox.disabled = readOnly;
        if (!readOnly) {
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) pendingPerms.add(key);
            else pendingPerms.delete(key);
            counter.textContent = `${group.permissions.filter(p => pendingPerms.has(p.key)).length}/${group.permissions.length}`;
          });
        }
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        row.append(checkbox, labelSpan);
        body.appendChild(row);
      }

      permsContainer.appendChild(body);

      header.addEventListener('click', () => {
        if (collapsedGroups.has(group.id)) {
          collapsedGroups.delete(group.id);
          body.style.display = '';
          arrow.style.transform = 'rotate(90deg)';
        } else {
          collapsedGroups.add(group.id);
          body.style.display = 'none';
          arrow.style.transform = '';
        }
      });
    }
  };

  const showRoleContextMenu = (x, y, role) => {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10001`;

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item' + (role.id === 'admin' || role.id === 'user' ? ' disabled' : '');
    deleteItem.textContent = 'Delete Role';
    deleteItem.addEventListener('click', async () => {
      menu.remove();
      if (role.id === 'admin' || role.id === 'user') return;
      if (!await customConfirm(`Delete role "${role.name}"?`)) return;
      try {
        await serverService.request('role:delete', { roleId: role.id });
        roles = roles.filter(r => r.id !== role.id);
        if (selectedRoleId === role.id) {
          selectedRoleId = null;
          rolesDetailEmpty.style.display = 'flex';
          rolesDetailContent.style.display = 'none';
        }
        renderRolesList();
      } catch (err) { await customAlert(err.message); }
    });

    const cloneItem = document.createElement('div');
    cloneItem.className = 'context-menu-item';
    cloneItem.textContent = 'Clone Role';
    cloneItem.addEventListener('click', async () => {
      menu.remove();
      try {
        const result = await serverService.request('role:create', {
          name: role.name + ' (copy)',
          badge: role.badge || null,
        });
        await serverService.request('role:set-permissions', {
          roleId: result.id,
          permissions: [...(role.permissions || [])],
        });
        result.permissions = [...(role.permissions || [])];
        roles.push(result);
        renderRolesList();
        selectRole(result.id);
      } catch (err) { await customAlert(err.message); }
    });

    menu.append(deleteItem, cloneItem);
    document.body.appendChild(menu);

    const removeMenu = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', removeMenu); }
    };
    setTimeout(() => document.addEventListener('mousedown', removeMenu), 0);
  };

  // Add role
  root.querySelector('.roles-add-btn').addEventListener('click', async () => {
    const name = await customPrompt('New role name:');
    if (!name || !name.trim()) return;
    try {
      const result = await serverService.request('role:create', { name: name.trim() });
      result.permissions = result.permissions || [];
      roles.push(result);
      renderRolesList();
      selectRole(result.id);
    } catch (err) { await customAlert(err.message); }
  });

  // Remove selected role
  root.querySelector('.roles-remove-btn').addEventListener('click', async () => {
    if (!selectedRoleId) return;
    const role = roles.find(r => r.id === selectedRoleId);
    if (!role) return;
    if (role.id === 'admin' || role.id === 'user') { await customAlert('Cannot delete a built-in role.'); return; }
    if (!await customConfirm(`Delete role "${role.name}"?`)) return;
    try {
      await serverService.request('role:delete', { roleId: role.id });
      roles = roles.filter(r => r.id !== role.id);
      selectedRoleId = null;
      rolesDetailEmpty.style.display = 'flex';
      rolesDetailContent.style.display = 'none';
      renderRolesList();
    } catch (err) { await customAlert(err.message); }
  });

  // Save button
  root.querySelector('.roles-save-btn').addEventListener('click', async () => {
    if (!selectedRoleId) return;
    const role = roles.find(r => r.id === selectedRoleId);
    if (!role) return;
    const isStatic = role.id === 'admin' || role.id === 'user';
    const newName = nameInput.value.trim();
    const newBadge = badgeInput.value.trim() || null;
    if (!isStatic && !newName) { await customAlert('Role name cannot be empty.'); return; }
    try {
      if (isStatic) {
        await serverService.request('role:update', { roleId: role.id, badge: newBadge });
      } else {
        await serverService.request('role:update', { roleId: role.id, name: newName, badge: newBadge });
        role.name = newName;
      }
      if (role.id !== 'admin') {
        await serverService.request('role:set-permissions', { roleId: role.id, permissions: [...pendingPerms] });
        role.permissions = [...pendingPerms];
      }
      role.badge = newBadge;
      renderRolesList();
    } catch (err) { await customAlert(err.message); }
  });

  // Cancel button - reload role from server
  root.querySelector('.roles-cancel-btn').addEventListener('click', () => {
    if (selectedRoleId) selectRole(selectedRoleId);
  });

  // Load roles and available permissions in parallel
  try {
    const [rolesResult, permsResult] = await Promise.all([
      serverService.request('role:list'),
      serverService.request('role:list-permissions'),
    ]);
    roles = rolesResult.roles;
    availablePermissions = permsResult.permissions;
    permissionGroups = permsResult.groups || [];
    renderRolesList();
  } catch (err) {
    rolesDetailEmpty.textContent = err.message;
    rolesDetailEmpty.style.color = 'var(--danger)';
  }
}

async function showManageRolesModal() {
  const existing = document.querySelector('.modal-manage-roles');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-roles';
  modal.innerHTML = `
    <div class="modal-content" style="width:700px;max-width:90vw;padding:0;display:flex;flex-direction:column;height:520px">
      <div class="roles-panel-container" style="flex:1;min-height:0"></div>
      <div style="padding:8px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button class="btn-secondary roles-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderRolesPanel(modal.querySelector('.roles-panel-container'));

  const closeModal = () => { modal.remove(); document.removeEventListener('keydown', onEscape); };
  modal.querySelector('.roles-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  const onEscape = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onEscape);
}

function updateChannelTabLabel(channelId) {
  setChannelName(getChannelName(channelId));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function flattenConfig(obj, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenConfig(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

function unflattenConfig(flat) {
  const result = {};
  for (const [dotKey, val] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return result;
}

function showIconCropModal(dataUrl) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.zIndex = '10100';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:460px;width:90vw;padding:20px">
        <h2 style="margin-bottom:12px">Crop Icon</h2>
        <div class="icon-crop-area" style="position:relative;width:400px;max-width:100%;aspect-ratio:1;margin:0 auto 16px;overflow:hidden;border-radius:50%;background:#000;cursor:grab;touch-action:none">
          <img style="position:absolute;transform-origin:0 0;pointer-events:none;user-select:none" draggable="false">
          <div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 2px var(--accent, #5865f2);pointer-events:none"></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:0 4px">
          <i class="bi bi-image" style="font-size:14px;color:var(--text-muted)"></i>
          <input type="range" class="icon-crop-zoom" min="100" max="500" value="100" style="flex:1;cursor:pointer">
          <i class="bi bi-image" style="font-size:20px;color:var(--text-muted)"></i>
        </div>
        <div class="modal-buttons" style="justify-content:flex-end">
          <button class="btn-secondary icon-crop-cancel">Cancel</button>
          <button class="btn-primary icon-crop-apply">Apply</button>
        </div>
      </div>
    `;

    const cropArea = overlay.querySelector('.icon-crop-area');
    const img = cropArea.querySelector('img');
    const zoomSlider = overlay.querySelector('.icon-crop-zoom');
    const cancelBtn = overlay.querySelector('.icon-crop-cancel');
    const applyBtn = overlay.querySelector('.icon-crop-apply');

    let imgW = 0, imgH = 0;
    let scale = 1;
    let offsetX = 0, offsetY = 0;
    let dragging = false, dragStartX = 0, dragStartY = 0, startOX = 0, startOY = 0;

    function areaSize() { return cropArea.getBoundingClientRect().width; }

    function clampOffset() {
      const s = areaSize();
      const sw = imgW * scale, sh = imgH * scale;
      // Image must fully cover the circle
      offsetX = Math.min(0, Math.max(s - sw, offsetX));
      offsetY = Math.min(0, Math.max(s - sh, offsetY));
    }

    function applyTransform() {
      img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    }

    function fitInitial() {
      const s = areaSize();
      const minDim = Math.min(imgW, imgH);
      scale = s / minDim;
      offsetX = (s - imgW * scale) / 2;
      offsetY = (s - imgH * scale) / 2;
      // Set slider to match
      zoomSlider.min = '100';
      zoomSlider.value = '100';
      applyTransform();
    }

    const imgEl = new Image();
    imgEl.onload = () => {
      imgW = imgEl.width;
      imgH = imgEl.height;
      img.src = dataUrl;
      img.style.width = imgW + 'px';
      img.style.height = imgH + 'px';
      // Wait for layout
      requestAnimationFrame(() => requestAnimationFrame(fitInitial));
    };
    imgEl.src = dataUrl;

    // Zoom
    const baseScale = () => {
      const s = areaSize();
      return s / Math.min(imgW, imgH);
    };

    zoomSlider.addEventListener('input', () => {
      const s = areaSize();
      const pct = parseInt(zoomSlider.value) / 100;
      const oldScale = scale;
      scale = baseScale() * pct;
      // Zoom toward center
      const cx = s / 2, cy = s / 2;
      offsetX = cx - (cx - offsetX) * (scale / oldScale);
      offsetY = cy - (cy - offsetY) * (scale / oldScale);
      clampOffset();
      applyTransform();
    });

    // Drag
    cropArea.addEventListener('pointerdown', (e) => {
      dragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      startOX = offsetX; startOY = offsetY;
      cropArea.style.cursor = 'grabbing';
      cropArea.setPointerCapture(e.pointerId);
    });
    cropArea.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      offsetX = startOX + (e.clientX - dragStartX);
      offsetY = startOY + (e.clientY - dragStartY);
      clampOffset();
      applyTransform();
    });
    cropArea.addEventListener('pointerup', () => {
      dragging = false;
      cropArea.style.cursor = 'grab';
    });

    // Mouse wheel zoom
    cropArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      let val = parseInt(zoomSlider.value) - Math.sign(e.deltaY) * 10;
      val = Math.max(parseInt(zoomSlider.min), Math.min(parseInt(zoomSlider.max), val));
      zoomSlider.value = val;
      zoomSlider.dispatchEvent(new Event('input'));
    }, { passive: false });

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

    applyBtn.addEventListener('click', () => {
      const s = areaSize();
      const outputSize = 256;
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      // Map crop area back to image coordinates
      const srcX = -offsetX / scale;
      const srcY = -offsetY / scale;
      const srcSize = s / scale;
      ctx.drawImage(imgEl, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize);
      canvas.toBlob((blob) => close(blob), 'image/png');
    });

    document.body.appendChild(overlay);
  });
}

async function renderSettingsPanel(container) {
  container.innerHTML = `
    <div class="settings-form" style="overflow-y:auto;margin-bottom:12px">
      <p class="text-muted" style="font-size:13px">Loading...</p>
    </div>
    <div class="settings-status" style="min-height:20px;font-size:13px;margin-bottom:8px"></div>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn-primary settings-save-btn" disabled>Save</button>
    </div>
  `;

  const formEl = container.querySelector('.settings-form');
  const statusEl = container.querySelector('.settings-status');
  const saveBtn = container.querySelector('.settings-save-btn');

  let flatSettings = {};
  let envLockedKeys = new Set();

  try {
    const res = await serverService.request('server:get-settings', {});
    flatSettings = flattenConfig(res.settings);
    if (Array.isArray(res.envLockedKeys)) envLockedKeys = new Set(res.envLockedKeys);
  } catch (err) {
    formEl.innerHTML = `<p style="color:var(--danger)">Failed to load settings: ${escapeHtml(String(err.message || err))}</p>`;
    return;
  }

  const SETTING_LABELS = {
    'name': 'Server Name',
    'port': 'Port',
    'password': 'Server Password',
    'maxClients': 'Max Clients',
    'maxConnectionsPerIp': 'Max Connections per IP',
    'generateAdminToken': 'Generate Admin Token on Start',
    'media.listenIp': 'Listen IP',
    'media.announcedIp': 'Announced IP',
    'media.rtcPort': 'RTC Base Port',
    'media.workers': 'Media Workers (0 = auto)',
    'media.logLevel': 'Log Level',
    'chat.persistMessages': 'Persist Messages',
    'chat.tempChannelDeleteDelay': 'Temp Channel Auto-Delete Delay',
    'defaultChannelId': 'Default Channel',
    'files.maxFileSize': 'Max Upload Size',
    'files.storagePath': 'Storage Path',
    'files.publicUrl': 'Public URL',
    'ssl.certPath': 'Certificate Path',
    'ssl.keyPath': 'Key Path',
  };

  const SETTING_GROUPS = [
    { label: 'General', icon: 'bi-gear', keys: ['name', 'port', 'password', 'maxClients', 'maxConnectionsPerIp', 'defaultChannelId', 'generateAdminToken'] },
    { label: 'Media', icon: 'bi-broadcast', keys: ['media.listenIp', 'media.announcedIp', 'media.rtcPort', 'media.workers', 'media.logLevel'] },
    { label: 'Chat', icon: 'bi-chat-dots', keys: ['chat.persistMessages', 'chat.tempChannelDeleteDelay'] },
    { label: 'Files', icon: 'bi-folder', keys: ['files.maxFileSize', 'files.storagePath', 'files.publicUrl'] },
    { label: 'SSL', icon: 'bi-shield-lock', keys: ['ssl.certPath', 'ssl.keyPath'] },
  ];

  formEl.innerHTML = '';

  // --- Icon section ---
  const iconSection = document.createElement('div');
  iconSection.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:8px 0';

  const iconPreview = document.createElement('img');
  iconPreview.style.cssText = 'width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--bg-secondary)';
  iconPreview.src = '../../assets/icon.png';

  // Load current icon
  const currentIconHash = flatSettings['icon.hash'] || null;
  if (currentIconHash) {
    getServerIcon(serverService.address, currentIconHash).then(url => {
      if (url) iconPreview.src = url;
    });
  }

  const iconControls = document.createElement('div');
  iconControls.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const iconFileInput = document.createElement('input');
  iconFileInput.type = 'file';
  iconFileInput.accept = 'image/*';
  iconFileInput.style.display = 'none';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn-primary';
  uploadBtn.textContent = 'Upload Icon';
  uploadBtn.style.cssText = 'font-size:12px;padding:4px 12px';
  uploadBtn.addEventListener('click', () => iconFileInput.click());

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-secondary';
  removeBtn.textContent = 'Remove Icon';
  removeBtn.style.cssText = 'font-size:12px;padding:4px 12px';
  removeBtn.style.display = currentIconHash ? '' : 'none';

  iconFileInput.addEventListener('change', async () => {
    const file = iconFileInput.files[0];
    if (!file) return;

    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) { iconFileInput.value = ''; return; }

    // Show crop modal and get cropped result
    const croppedBlob = await showIconCropModal(dataUrl);
    iconFileInput.value = '';
    if (!croppedBlob) return;

    statusEl.textContent = 'Uploading icon...';
    statusEl.style.color = 'var(--text-muted)';
    try {
      const buffer = await croppedBlob.arrayBuffer();
      const data = await window.gimodi.iconCache.upload(serverService.address, serverService.clientId, 'image/png', new Uint8Array(buffer));
      if (data.error) throw new Error(data.error);
      statusEl.textContent = 'Icon updated.';
      statusEl.style.color = 'var(--success, #4caf50)';
      const url = await getServerIcon(serverService.address, data.hash);
      if (url) iconPreview.src = url;
      removeBtn.style.display = '';
    } catch (err) {
      statusEl.textContent = `Icon upload failed: ${err.message}`;
      statusEl.style.color = 'var(--danger)';
    }
  });

  removeBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Removing icon...';
    statusEl.style.color = 'var(--text-muted)';
    try {
      const data = await window.gimodi.iconCache.delete(serverService.address, serverService.clientId);
      if (data.error) throw new Error(data.error);
      statusEl.textContent = 'Icon removed.';
      statusEl.style.color = 'var(--success, #4caf50)';
      iconPreview.src = '../../assets/icon.png';
      removeBtn.style.display = 'none';
    } catch (err) {
      statusEl.textContent = `Icon removal failed: ${err.message}`;
      statusEl.style.color = 'var(--danger)';
    }
  });

  iconControls.append(iconFileInput, uploadBtn, removeBtn);
  iconSection.append(iconPreview, iconControls);
  formEl.appendChild(iconSection);

  // Remove icon keys from the settings table (managed by icon section above)
  delete flatSettings['icon.hash'];
  delete flatSettings['icon.filename'];

  const inputStyle = 'width:100%;box-sizing:border-box;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px';
  const smallInputStyle = 'width:80px;box-sizing:border-box;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px';
  const selectStyle = 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;cursor:pointer';

  const lockedStyle = 'opacity:0.6;cursor:not-allowed';
  const lockIcon = '<i class="bi bi-lock-fill" style="font-size:11px;color:var(--text-muted)" title="Locked by environment variable"></i>';

  function buildInput(key, val) {
    const type = typeof val;
    const locked = envLockedKeys.has(key);
    const dis = locked ? ' disabled' : '';
    if (key === 'defaultChannelId') {
      const nonGroupChannels = channels.filter(c => c.type !== 'group');
      const currentDefault = val || nonGroupChannels.find(c => c.isDefault)?.id || '';
      const options = nonGroupChannels.map(c =>
        `<option value="${escapeHtml(c.id)}" ${c.id === currentDefault ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
      ).join('');
      return `<select data-key="${escapeHtml(key)}" data-type="string" style="width:200px;${selectStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>${options}</select>${locked ? ` ${lockIcon}` : ''}`;
    } else if (key === 'chat.tempChannelDeleteDelay' && type === 'number') {
      let dUnit = 'seconds', dVal = val;
      if (val >= 3600 && val % 3600 === 0) { dUnit = 'hours'; dVal = val / 3600; }
      else if (val >= 60 && val % 60 === 0) { dUnit = 'minutes'; dVal = val / 60; }
      return `<div style="display:flex;gap:6px;align-items:center">
        <input type="number" min="1" data-key="${escapeHtml(key)}" data-type="duration" value="${dVal}" style="${smallInputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
        <select data-key="${escapeHtml(key)}-unit" style="width:90px;${selectStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
          <option value="seconds" ${dUnit === 'seconds' ? 'selected' : ''}>Seconds</option>
          <option value="minutes" ${dUnit === 'minutes' ? 'selected' : ''}>Minutes</option>
          <option value="hours" ${dUnit === 'hours' ? 'selected' : ''}>Hours</option>
        </select>
        ${locked ? lockIcon : ''}
      </div>`;
    } else if (key === 'files.maxFileSize' && type === 'number') {
      const isGb = val >= 1024 * 1024 * 1024 && val % (1024 * 1024 * 1024) === 0;
      const unit = isGb ? 'GB' : 'MB';
      const divisor = isGb ? 1024 * 1024 * 1024 : 1024 * 1024;
      return `<div style="display:flex;gap:6px;align-items:center">
        <input type="number" min="1" data-key="${escapeHtml(key)}" data-type="filesize" value="${val / divisor}" style="${smallInputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
        <select data-key="${escapeHtml(key)}-unit" style="width:60px;${selectStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
          <option value="MB" ${unit === 'MB' ? 'selected' : ''}>MB</option>
          <option value="GB" ${unit === 'GB' ? 'selected' : ''}>GB</option>
        </select>
        ${locked ? lockIcon : ''}
      </div>`;
    } else if (type === 'boolean') {
      return `<span style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-key="${escapeHtml(key)}" data-type="boolean" ${val ? 'checked' : ''} style="width:16px;height:16px;${locked ? lockedStyle : 'cursor:pointer'}"${dis}>${locked ? lockIcon : ''}</span>`;
    } else if (type === 'number') {
      return `<span style="display:inline-flex;align-items:center;gap:6px;width:100%"><input type="number" data-key="${escapeHtml(key)}" data-type="number" value="${escapeHtml(String(val))}" style="${inputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>${locked ? lockIcon : ''}</span>`;
    }
    return `<span style="display:inline-flex;align-items:center;gap:6px;width:100%"><input type="text" data-key="${escapeHtml(key)}" data-type="string" value="${escapeHtml(val === null ? '' : String(val))}" placeholder="${val === null ? 'null' : ''}" style="${inputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>${locked ? lockIcon : ''}</span>`;
  }

  const groupedKeys = new Set();
  for (const group of SETTING_GROUPS) {
    const visibleKeys = group.keys.filter(k => k in flatSettings);
    if (!visibleKeys.length) continue;

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px';
    header.innerHTML = `<i class="bi ${group.icon}" style="font-size:14px;color:var(--text-muted)"></i><span style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(group.label)}</span>`;
    section.appendChild(header);

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';

    for (const key of visibleKeys) {
      groupedKeys.add(key);
      const val = flatSettings[key];
      const label = SETTING_LABELS[key] || key;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px 8px;white-space:nowrap;vertical-align:middle;width:45%">
          <span style="color:var(--text-primary)">${escapeHtml(label)}</span>
        </td>
        <td style="padding:5px 8px;vertical-align:middle">${buildInput(key, val)}</td>
      `;
      table.appendChild(tr);
    }

    section.appendChild(table);
    formEl.appendChild(section);
  }

  // Render any ungrouped settings
  const ungrouped = Object.entries(flatSettings).filter(([k]) => !groupedKeys.has(k));
  if (ungrouped.length) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px';
    header.innerHTML = `<i class="bi bi-three-dots" style="font-size:14px;color:var(--text-muted)"></i><span style="font-size:13px;font-weight:600;color:var(--text-primary)">Other</span>`;
    section.appendChild(header);
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    for (const [key, val] of ungrouped) {
      const label = SETTING_LABELS[key] || key;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px 8px;white-space:nowrap;vertical-align:middle;width:45%">
          <span style="color:var(--text-primary)">${escapeHtml(label)}</span>
        </td>
        <td style="padding:5px 8px;vertical-align:middle">${buildInput(key, val)}</td>
      `;
      table.appendChild(tr);
    }
    section.appendChild(table);
    formEl.appendChild(section);
  }
  saveBtn.disabled = false;

  saveBtn.addEventListener('click', async () => {
    const inputs = formEl.querySelectorAll('[data-key]');
    const updated = {};
    for (const input of inputs) {
      const key = input.dataset.key;
      const dtype = input.dataset.type;
      if (key.endsWith('-unit')) continue;
      if (input.disabled) continue;
      let value;
      if (dtype === 'boolean') {
        value = input.checked;
      } else if (dtype === 'duration') {
        const unitSel = formEl.querySelector(`[data-key="${key}-unit"]`);
        const multiplier = unitSel?.value === 'hours' ? 3600 : unitSel?.value === 'minutes' ? 60 : 1;
        value = input.value === '' ? null : Number(input.value) * multiplier;
      } else if (dtype === 'filesize') {
        const unitSel = formEl.querySelector(`[data-key="${key}-unit"]`);
        const multiplier = unitSel && unitSel.value === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024;
        value = input.value === '' ? null : Number(input.value) * multiplier;
      } else if (dtype === 'number') {
        value = input.value === '' ? null : Number(input.value);
      } else {
        value = input.value === '' ? null : input.value;
      }
      updated[key] = value;
    }

    saveBtn.disabled = true;
    statusEl.textContent = 'Saving...';
    statusEl.style.color = 'var(--text-muted)';

    try {
      await serverService.request('server:set-settings', { settings: unflattenConfig(updated) });
      statusEl.textContent = 'Settings saved.';
      statusEl.style.color = 'var(--success, #4caf50)';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message || err}`;
      statusEl.style.color = 'var(--danger)';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

async function showServerSettingsModal() {
  const existing = document.querySelector('.modal-server-settings');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-server-settings';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:600px;width:90vw">
      <h2>Server Settings</h2>
      <div class="settings-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary settings-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderSettingsPanel(modal.querySelector('.settings-panel-container'));

  modal.querySelector('.settings-close-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function renderAuditLogPanel(container) {
  const ACTION_LABELS = {
    kick: 'Kick', ban: 'Ban', unban: 'Unban',
    assign_role: 'Assign Role', remove_role: 'Remove Role',
    channel_create: 'Create Channel', channel_delete: 'Delete Channel', channel_update: 'Update Channel',
    token_create: 'Create Token', token_delete: 'Delete Token',
    role_create: 'Create Role', role_delete: 'Delete Role',
    grant_voice: 'Grant Voice', revoke_voice: 'Revoke Voice',
  };

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <label style="font-size:13px;color:var(--text-secondary)">Filter by action:</label>
      <select class="audit-action-filter" style="font-size:13px;padding:3px 6px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
        <option value="">All actions</option>
      </select>
    </div>
    <div class="audit-table-wrap" style="overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="position:sticky;top:0;background:var(--bg-secondary)">
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">Time</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Action</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Actor</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Target</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Details</th>
          </tr>
        </thead>
        <tbody class="audit-tbody"></tbody>
      </table>
      <div class="audit-empty" style="display:none;padding:16px;color:var(--text-muted);text-align:center">No entries found.</div>
      <div class="audit-error" style="display:none;padding:16px;color:var(--danger)"></div>
    </div>
  `;

  const tbody = container.querySelector('.audit-tbody');
  const emptyMsg = container.querySelector('.audit-empty');
  const errorMsg = container.querySelector('.audit-error');
  const filterSelect = container.querySelector('.audit-action-filter');

  let allLogs = [];

  const renderLogs = (logs) => {
    tbody.innerHTML = '';
    const visible = filterSelect.value
      ? logs.filter(l => l.action === filterSelect.value)
      : logs;

    if (!visible.length) {
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';

    for (const log of visible) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';

      const time = new Date(log.created_at);
      const timeStr = time.toLocaleDateString() + ' ' + time.toLocaleTimeString();

      const actionLabel = ACTION_LABELS[log.action] || log.action;

      const actorText = log.actor_nickname || log.actor_user_id || '\u2014';
      const targetText = log.target_nickname || log.target_user_id || '\u2014';

      [timeStr, actionLabel, actorText, targetText, log.details || '\u2014'].forEach((text, i) => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:5px 8px;vertical-align:top;' + (i === 0 ? 'white-space:nowrap;color:var(--text-muted)' : '');
        td.textContent = text;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
  };

  const populateFilter = (logs) => {
    const actions = [...new Set(logs.map(l => l.action))].sort();
    for (const action of actions) {
      const opt = document.createElement('option');
      opt.value = action;
      opt.textContent = ACTION_LABELS[action] || action;
      filterSelect.appendChild(opt);
    }
  };

  filterSelect.addEventListener('change', () => renderLogs(allLogs));

  try {
    const result = await serverService.request('admin:audit-log', { limit: 200 });
    allLogs = result.logs || [];
    populateFilter(allLogs);
    renderLogs(allLogs);
  } catch (err) {
    errorMsg.style.display = 'block';
    errorMsg.textContent = err.message;
  }
}

async function showAuditLogModal() {
  const existing = document.querySelector('.modal-audit-log');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal modal-audit-log';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:800px;width:90vw">
      <h2>Audit Log</h2>
      <div class="audit-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary audit-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderAuditLogPanel(modal.querySelector('.audit-panel-container'));

  const closeAuditModal = () => { modal.remove(); document.removeEventListener('keydown', onAuditEscape); };
  modal.querySelector('.audit-close-btn').addEventListener('click', closeAuditModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuditModal(); });
  const onAuditEscape = (e) => { if (e.key === 'Escape') closeAuditModal(); };
  document.addEventListener('keydown', onAuditEscape);
}

// --- Unified Admin Dialog ---

const ADMIN_TABS = [
  { id: 'settings', label: 'Server Settings', icon: 'bi-sliders', permission: 'server.manage_settings' },
  { id: 'users', label: 'Users', icon: 'bi-people', permission: 'server.admin_menu' },
  { id: 'bans', label: 'Manage Bans', icon: 'bi-shield-exclamation', permission: 'ban.list' },
  { id: 'tokens', label: 'Manage Tokens', icon: 'bi-key', permission: 'token.list' },
  { id: 'roles', label: 'Manage Roles', icon: 'bi-person-badge', permission: 'role.manage' },
  { id: 'audit-log', label: 'Audit Log', icon: 'bi-journal-text', permission: 'server.admin_menu' },
];

export function showUnifiedAdminDialog(initialTab) {
  const existing = document.querySelector('.modal-admin-unified');
  if (existing) existing.remove();

  // Filter tabs by permission
  const visibleTabs = ADMIN_TABS.filter(t => serverService.hasPermission(t.permission));
  if (!visibleTabs.length) return;

  const startTab = initialTab && visibleTabs.find(t => t.id === initialTab)
    ? initialTab
    : visibleTabs[0].id;

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
    if (activeTab === tabId) return;
    activeTab = tabId;

    // Update nav active state
    nav.querySelectorAll('.admin-nav-item').forEach(item => {
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
          await renderAuditLogPanel(panel);
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
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAdminDialog(); });
  const onAdminEscape = (e) => { if (e.key === 'Escape') closeAdminDialog(); };
  document.addEventListener('keydown', onAdminEscape);

  // Open initial tab
  switchTab(startTab);
}
