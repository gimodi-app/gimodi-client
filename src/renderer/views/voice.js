import serverService from '../services/server.js';
import voiceService from '../services/voice.js';
import screenShareService from '../services/screen.js';
import { customAlert, customConfirm } from '../services/dialogs.js';
import { getFeedbackVolume } from './server.js';

const log = (...args) => console.log('[voice-view]', ...args);

const sndMute = new Audio('../../assets/mute.mp3');
const sndUnmute = new Audio('../../assets/unmute.mp3');
const sndScreenStart = new Audio('../../assets/screen-share-start.mp3');
const sndScreenStop = new Audio('../../assets/screen-share-stop.mp3');
const sndWebcamStart = new Audio('../../assets/webcam-start.mp3');
const sndWebcamStop = new Audio('../../assets/webcam-stop.mp3');

function playMuteSound(audio) {
  const clone = audio.cloneNode();
  clone.volume = getFeedbackVolume();
  clone.play().catch(() => {});
}

function playScreenSound(audio) {
  const clone = audio.cloneNode();
  clone.volume = getFeedbackVolume();
  clone.play().catch(() => {});
}

const btnMute = document.getElementById('btn-mute');
const btnDeafen = document.getElementById('btn-deafen');
const btnWebcam = document.getElementById('btn-webcam');
const btnScreenShare = document.getElementById('btn-screen-share');
const mediaGrid = document.getElementById('media-grid');
const btnBackToGrid = document.getElementById('btn-back-to-grid');

// eslint-disable-next-line no-unused-vars
let voiceServerName = '';
// eslint-disable-next-line no-unused-vars
let screenViewMode = 'grid';
// eslint-disable-next-line no-unused-vars
let webcamViewMode = 'grid';
let focusMode = null; // null or { type: 'webcam'|'screen', clientId }
const focusStrip = document.getElementById('focus-strip');

// Webcam viewer DOM elements
const webcamViewerContainer = document.getElementById('webcam-viewer-container');
const webcamViewerVideo = document.getElementById('webcam-viewer-video');
const webcamViewerLabel = document.getElementById('webcam-viewer-label');
const btnBackToWebcamGrid = document.getElementById('btn-back-to-webcam-grid');
const btnPopoutWebcam = document.getElementById('btn-popout-webcam');
const btnMaximizeWebcam = document.getElementById('btn-maximize-webcam');
let focusedWebcamStream = null; // stream currently in the viewer
let focusedWebcamClientId = null; // clientId in the viewer
let isWebcamMaximized = false;

// Screen share DOM elements
const screenShareContainer = document.getElementById('screen-share-container');
const screenVideo = document.getElementById('screen-video');
const screenShareLabel = document.getElementById('screen-share-label');
const btnPopoutScreen = document.getElementById('btn-popout-screen');
const btnMaximizeScreen = document.getElementById('btn-maximize-screen');
const screenVolumeControl = document.getElementById('screen-volume-control');
const rangeScreenVolume = document.getElementById('range-screen-volume');
const screenVolumeValue = document.getElementById('screen-volume-value');
const screenAudioWarning = document.getElementById('screen-audio-warning');
const screenResizeHandle = document.getElementById('screen-resize-handle');
const modalScreenPicker = document.getElementById('modal-screen-picker');
const screenSourcesDiv = document.getElementById('screen-sources');
const chkScreenAudio = document.getElementById('chk-screen-audio');
const btnCancelScreen = document.getElementById('btn-cancel-screen');
const selectScreenResolution = document.getElementById('select-screen-resolution');
const savedScreenResolution = localStorage.getItem('screenShareResolution');
if (savedScreenResolution) {
  selectScreenResolution.value = savedScreenResolution;
}

let isMuted = false;
let isDeafened = false;
let isWebcamOn = false;
let isScreenSharing = false;
const audioElements = new Map(); // consumerId -> { audio, clientId, track }
const clientUserMap = new Map(); // clientId -> userId (persistent identity)
const webcamConsumers = new Map(); // clientId -> { consumer, nickname }
const screenVideoConsumers = new Map(); // clientId -> { consumer, nickname }
let watchingScreenClientId = null; // clientId of screen share we're watching
let wcPopoutPC = null; // RTCPeerConnection for webcam popout window
let wcPopoutClientId = null; // clientId of the webcam being popped out
let popoutPC = null; // RTCPeerConnection for screen share popout
let screenAudioGain = parseInt(rangeScreenVolume.value, 10); // screen audio gain percentage (0-100)
let isScreenMaximized = false;
let isScreenResized = false;

function updateMediaGridVisibility() {
  mediaGrid.classList.toggle('hidden', mediaGrid.children.length === 0);
}

export function setVoiceServerName(name) {
  voiceServerName = name;
}

export function setVoiceControlsVisible(visible) {
  const voiceBar = document.querySelector('.voice-controls');
  if (!voiceBar) {
    return;
  }
  // Always keep the bar visible, but hide voice-specific buttons when voice is unavailable
  for (const btn of voiceBar.querySelectorAll('.btn-icon:not(#btn-settings)')) {
    btn.style.display = visible ? '' : 'none';
  }
}

/**
 * Re-syncs the mute/deafen/webcam button UI to match the current voice state.
 * Called when switching back to the voice server view.
 */
export function syncVoiceControlsUI() {
  updateMuteUI();
  updateDeafenUI();
  btnWebcam.classList.toggle('active', isWebcamOn);
  btnScreenShare.classList.toggle('active', isScreenSharing);
}

export function initVoiceView(initialClients = [], serverName = '') {
  voiceServerName = serverName;
  for (const c of initialClients) {
    if (c.userId) {
      clientUserMap.set(c.id, c.userId);
    }
  }

  // Voice-specific buttons are hidden until user joins a voice channel
  // (visibility is controlled by connectionManager voice-server-changed event)
  setVoiceControlsVisible(false);
  setVoiceControlsEnabled(false);

  btnMute.addEventListener('click', toggleMute);
  btnDeafen.addEventListener('click', toggleDeafen);

  window.gimodi.onTrayToggleMute(toggleMute);
  window.gimodi.onTrayToggleDeafen(toggleDeafen);
  btnWebcam.addEventListener('click', handleWebcamClick);
  btnScreenShare.addEventListener('click', handleScreenShareClick);

  // Enable voice controls when user joins a channel
  window.addEventListener('gimodi:channel-changed', onChannelChangedForControls);

  // Screen share viewer controls
  screenVideo.addEventListener('click', onScreenVideoClick);
  btnBackToGrid.addEventListener('click', onScreenBackClick);
  btnMaximizeScreen.addEventListener('click', toggleMaximizeScreen);
  btnPopoutScreen.addEventListener('click', togglePopout);
  rangeScreenVolume.addEventListener('input', onScreenVolumeChange);
  screenResizeHandle.addEventListener('mousedown', onResizeHandleMouseDown);

  // Webcam viewer controls
  webcamViewerVideo.addEventListener('click', onWebcamViewerVideoClick);
  btnBackToWebcamGrid.addEventListener('click', onWebcamBackClick);
  btnMaximizeWebcam.addEventListener('click', toggleMaximizeWebcam);
  btnPopoutWebcam.addEventListener('click', onPopoutWebcamClick);

  // Right-click context menu for fullscreen
  screenShareContainer.addEventListener('contextmenu', (e) => showMediaContextMenu(e, screenVideo));
  webcamViewerContainer.addEventListener('contextmenu', (e) => showMediaContextMenu(e, webcamViewerVideo));

  // Update buttons when exiting browser fullscreen (e.g. via Escape)
  document.addEventListener('fullscreenchange', () => {
    updateScreenButtons();
    updateWebcamButtons();
  });

  // Watch stream from channel tree
  window.addEventListener('gimodi:watch-stream', onWatchStreamEvent);

  voiceService.addEventListener('new-consumer', onNewConsumer);
  voiceService.addEventListener('consumer-removed', onConsumerRemoved);
  voiceService.addEventListener('consumer-closed', onConsumerClosed);
  voiceService.addEventListener('speaker-changed', onSpeakerChanged);
  voiceService.addEventListener('webcam-started', onLocalWebcamStarted);
  voiceService.addEventListener('webcam-stopped', onLocalWebcamStopped);
  voiceService.addEventListener('ptt-changed', onPTTChanged);
  voiceService.addEventListener('user-volume-changed', onUserVolumeChanged);
  screenShareService.addEventListener('started', onLocalScreenStarted);
  screenShareService.addEventListener('stopped', onLocalScreenStopped);
  serverService.addEventListener('server:client-joined', onClientJoined);
  serverService.addEventListener('server:client-left', onClientLeft);
  serverService.addEventListener('webcam:stopped', onPeerWebcamStopped);
  serverService.addEventListener('screen:stopped', onPeerScreenStopped);

  // Set up screen picker IPC listener
  window.gimodi.screen.onShowPicker(showScreenPicker);
  btnCancelScreen.addEventListener('click', cancelScreenPicker);

  // Init screen share service (detect platform, venmic)
  screenShareService.init();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function setVoiceControlsEnabled(enabled) {
  btnMute.disabled = !enabled;
  btnDeafen.disabled = !enabled;
  btnWebcam.disabled = !enabled;
  btnScreenShare.disabled = !enabled;
  if (!enabled) {
    btnMute.classList.add('disabled');
    btnDeafen.classList.add('disabled');
    btnWebcam.classList.add('disabled');
    btnScreenShare.classList.add('disabled');
  } else {
    btnMute.classList.remove('disabled');
    btnDeafen.classList.remove('disabled');
    btnWebcam.classList.remove('disabled');
    btnScreenShare.classList.remove('disabled');
  }
}

function onChannelChangedForControls() {
  setVoiceControlsEnabled(true);
}

export function cleanup() {
  // Remove DOM listeners
  btnMute.removeEventListener('click', toggleMute);
  btnDeafen.removeEventListener('click', toggleDeafen);
  btnWebcam.removeEventListener('click', handleWebcamClick);
  btnScreenShare.removeEventListener('click', handleScreenShareClick);
  webcamViewerVideo.removeEventListener('click', onWebcamViewerVideoClick);
  btnBackToWebcamGrid.removeEventListener('click', onWebcamBackClick);
  btnMaximizeWebcam.removeEventListener('click', toggleMaximizeWebcam);
  btnPopoutWebcam.removeEventListener('click', onPopoutWebcamClick);
  screenVideo.removeEventListener('click', onScreenVideoClick);
  btnBackToGrid.removeEventListener('click', onScreenBackClick);
  btnMaximizeScreen.removeEventListener('click', toggleMaximizeScreen);
  btnPopoutScreen.removeEventListener('click', togglePopout);
  rangeScreenVolume.removeEventListener('input', onScreenVolumeChange);
  screenResizeHandle.removeEventListener('mousedown', onResizeHandleMouseDown);
  window.removeEventListener('mousemove', onResizeHandleMouseMove);
  window.removeEventListener('mouseup', onResizeHandleMouseUp);
  window.removeEventListener('gimodi:watch-stream', onWatchStreamEvent);
  window.removeEventListener('mousemove', onTileResizeMove);
  window.removeEventListener('mouseup', onTileResizeUp);
  tileResizeTarget = null;
  btnCancelScreen.removeEventListener('click', cancelScreenPicker);

  // Remove service listeners
  voiceService.removeEventListener('new-consumer', onNewConsumer);
  voiceService.removeEventListener('consumer-removed', onConsumerRemoved);
  voiceService.removeEventListener('consumer-closed', onConsumerClosed);
  voiceService.removeEventListener('speaker-changed', onSpeakerChanged);
  voiceService.removeEventListener('webcam-started', onLocalWebcamStarted);
  voiceService.removeEventListener('webcam-stopped', onLocalWebcamStopped);
  voiceService.removeEventListener('ptt-changed', onPTTChanged);
  voiceService.removeEventListener('user-volume-changed', onUserVolumeChanged);
  screenShareService.removeEventListener('started', onLocalScreenStarted);
  screenShareService.removeEventListener('stopped', onLocalScreenStopped);
  serverService.removeEventListener('server:client-joined', onClientJoined);
  serverService.removeEventListener('server:client-left', onClientLeft);
  serverService.removeEventListener('webcam:stopped', onPeerWebcamStopped);
  serverService.removeEventListener('screen:stopped', onPeerScreenStopped);
  window.gimodi.screen.removePickerListener();
  window.gimodi.removeTrayVoiceListeners();
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('gimodi:channel-changed', onChannelChangedForControls);

  // Reset voice controls for next connection
  voiceServerName = '';
  setVoiceControlsVisible(false);
  setVoiceControlsEnabled(false);

  for (const entry of audioElements.values()) {
    if (entry.audioCtx) {
      entry.audioCtx.close().catch(() => {});
    }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
  }
  audioElements.clear();
  clientUserMap.clear();

  // Reset unified focus
  focusMode = null;
  focusStrip.innerHTML = '';
  focusStrip.classList.add('hidden');

  // Clean up screen share
  screenShareService.cleanup();
  hideScreenShare();
  clearScreenGrid();
  screenViewMode = 'grid';
  screenVideoConsumers.clear();
  isScreenSharing = false;
  btnScreenShare.classList.remove('active');
  screenAudioGain = 100;
  rangeScreenVolume.value = '100';
  screenVolumeValue.textContent = '100%';
  screenAudioWarning.classList.add('hidden');
  modalScreenPicker.classList.add('hidden');

  // Clean up webcam viewer
  backToWebcamGrid();
  webcamViewMode = 'grid';
  isWebcamMaximized = false;

  // Clean up webcam popout and tiles
  if (wcPopoutPC) {
    window.gimodi.wcPopout.close();
    cleanupWcPopout();
  }
  for (const clientId of webcamConsumers.keys()) {
    removeWebcamTile(clientId);
  }
  webcamConsumers.clear();
  focusedWebcamClientId = null;
  focusedWebcamStream = null;
  isWebcamOn = false;
  btnWebcam.classList.remove('active');

  // Reset mute/deafen state
  isMuted = false;
  isDeafened = false;
  updateMuteUI();
  updateDeafenUI();
}

function onClientJoined(e) {
  const { clientId, userId } = e.detail;
  if (userId) {
    clientUserMap.set(clientId, userId);
  }
}

function onClientLeft(e) {
  clientUserMap.delete(e.detail.clientId);
}

function onUserVolumeChanged(e) {
  const { userId, volume } = e.detail;
  for (const entry of audioElements.values()) {
    if (!entry.screenAudio && clientUserMap.get(entry.clientId) === userId) {
      if (entry.gainNode) {
        entry.gainNode.gain.value = volume / 100;
      } else {
        entry.audio.volume = Math.min(volume / 100, 1.0);
      }
    }
  }
}

function toggleMute() {
  // If deafened, undeafen first when clicking mute
  if (isDeafened) {
    toggleDeafen();
    return;
  }
  isMuted = voiceService.toggleMute();
  playMuteSound(isMuted ? sndMute : sndUnmute);
  updateMuteUI();
}

function toggleDeafen() {
  isDeafened = voiceService.toggleDeafen();
  playMuteSound(isDeafened ? sndMute : sndUnmute);

  // When deafening, force mute indicator on; when undeafening, restore actual mute state
  if (isDeafened) {
    isMuted = true;
  } else {
    isMuted = voiceService._manualMute;
  }

  updateMuteUI();
  updateDeafenUI();
  applyDeafenToAudio();
}

function updateMuteUI() {
  const showMuted = isMuted || isDeafened;
  btnMute.classList.toggle('active', showMuted);
  btnMute.innerHTML = showMuted ? '<i class="bi bi-mic-mute"></i>' : '<i class="bi bi-mic"></i>';
  btnMute.title = isDeafened ? 'Undeafen to unmute' : isMuted ? 'Unmute' : 'Mute';
  window.gimodi.setVoiceMuteState(isMuted, isDeafened);
}

function updateDeafenUI() {
  btnDeafen.classList.toggle('active', isDeafened);
  btnDeafen.innerHTML = isDeafened ? '<i class="bi bi-volume-mute"></i>' : '<i class="bi bi-headphones"></i>';
  btnDeafen.title = isDeafened ? 'Undeafen' : 'Deafen';
}

function applyDeafenToAudio() {
  for (const entry of audioElements.values()) {
    if (entry.audio) {
      entry.audio.muted = isDeafened;
    }
    // Screen audio uses AudioContext gain instead of audio element
    if (entry.screenAudio && entry.gainNode && entry.audioCtx) {
      const vol = isDeafened ? 0 : screenAudioGain / 100;
      entry.gainNode.gain.cancelScheduledValues(entry.audioCtx.currentTime);
      entry.gainNode.gain.setValueAtTime(vol, entry.audioCtx.currentTime);
    }
  }
}

function onKeyDown(e) {
  // Ignore key events when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
    return;
  }

  if (e.key === voiceService.pushToTalkKey) {
    e.preventDefault();
    voiceService.handlePTTKeyDown();
  }
}

function onKeyUp(e) {
  // Ignore key events when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
    return;
  }

  if (e.key === voiceService.pushToTalkKey) {
    e.preventDefault();
    voiceService.handlePTTKeyUp();
  }
}

function onPTTChanged(e) {
  const { active } = e.detail;
  // Update UI to show PTT active state
  if (active) {
    btnMute.classList.add('ptt-active');
  } else {
    btnMute.classList.remove('ptt-active');
  }
}

async function onNewConsumer(e) {
  const { consumer, clientId, nickname, kind, screen, screenAudio, webcam } = e.detail;
  log(`New consumer: kind=${kind} screen=${!!screen} webcam=${!!webcam} screenAudio=${!!screenAudio} from=${nickname} (${clientId})`);

  // Webcam video consumer
  if (kind === 'video' && webcam) {
    webcamConsumers.set(clientId, { consumer, nickname });
    createWebcamTile(clientId, nickname, consumer.track, false);
    return;
  }

  // Screen video consumer
  if (kind === 'video' && screen) {
    const track = consumer.track;
    screenVideoConsumers.set(clientId, { consumer, nickname, track });
    log('Screen video consumer from', nickname);
    createScreenTile(clientId, nickname, track, false);
    return;
  }

  // Screen audio consumer - route through AudioContext + GainNode for volume control
  if (kind === 'audio' && screenAudio) {
    const track = consumer.track;
    const stream = new MediaStream([track]);

    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Use MediaStreamAudioSourceNode directly - no <audio> element needed
    const source = audioCtx.createMediaStreamSource(stream);
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(screenAudioGain / 100, audioCtx.currentTime);
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Set output device on AudioContext if supported (Chromium 110+)
    if (voiceService.selectedSpeakerId) {
      try {
        if (typeof audioCtx.setSinkId === 'function') {
          await audioCtx.setSinkId(voiceService.selectedSpeakerId);
        }
      } catch (err) {
        log(`Failed to set screen audio output device:`, err.message);
      }
    }

    // For deafen: mute by setting gain to 0
    if (isDeafened) {
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    }

    audioElements.set(consumer.id, { clientId, track, screenAudio: true, audioCtx, gainNode, source });

    // Show volume control if we're currently watching a remote screen
    if (watchingScreenClientId && watchingScreenClientId !== '__local__') {
      screenVolumeControl.classList.remove('hidden');
    }
    return;
  }

  // Voice audio consumer
  if (kind === 'audio' && !screenAudio) {
    const track = consumer.track;
    const audio = new Audio();
    audio.volume = 1.0;

    // Apply stored per-user volume if available
    const userId = clientUserMap.get(clientId);
    if (userId) {
      const vol = voiceService.getUserVolume(userId);
      if (vol !== 100) {
        audio.volume = Math.min(vol / 100, 1.0);
      }
    }

    // Set audio output device if specified
    if (voiceService.selectedSpeakerId && typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(voiceService.selectedSpeakerId);
      } catch (err) {
        log(`Failed to set audio output device:`, err.message);
      }
    }

    // Respect current deafen state
    if (isDeafened) {
      audio.muted = true;
    }

    // Start muted, assign the stream, then fade in after a short delay
    // to avoid the initial crackle from empty WebRTC buffers
    const origVolume = audio.volume;
    audio.volume = 0;
    audio.srcObject = new MediaStream([track]);
    audio.autoplay = true;
    document.body.appendChild(audio);
    audioElements.set(consumer.id, { audio, clientId, track });
    setTimeout(() => {
      audio.volume = origVolume;
    }, 150);
  }
}

function cleanupAudioEntry(consumerId, entry) {
  if (entry.audioCtx) {
    entry.audioCtx.close().catch(() => {});
  }
  if (entry.audio) {
    entry.audio.srcObject = null;
    entry.audio.remove();
  }
  audioElements.delete(consumerId);
}

function onConsumerRemoved(e) {
  const { clientId } = e.detail;
  for (const [consumerId, entry] of audioElements) {
    if (entry.clientId === clientId) {
      cleanupAudioEntry(consumerId, entry);
    }
  }
  // Clean up webcam consumer for this client
  if (webcamConsumers.has(clientId)) {
    webcamConsumers.delete(clientId);
    removeWebcamTile(clientId);
  }
  // Clean up screen consumer for this client
  if (screenVideoConsumers.has(clientId)) {
    screenVideoConsumers.delete(clientId);
    removeScreenTile(clientId);
    if (watchingScreenClientId === clientId) {
      unwatchScreen();
      backToGrid();
    }
  }
}

function onConsumerClosed(e) {
  const { consumerId, clientId, kind, screen, webcam } = e.detail;
  const entry = audioElements.get(consumerId);
  if (entry) {
    cleanupAudioEntry(consumerId, entry);
  }
  // Clean up webcam consumer
  if (kind === 'video' && webcam && webcamConsumers.has(clientId)) {
    webcamConsumers.delete(clientId);
    removeWebcamTile(clientId);
  }
  // Clean up screen video consumer
  if (kind === 'video' && screen && screenVideoConsumers.has(clientId)) {
    screenVideoConsumers.delete(clientId);
    removeScreenTile(clientId);
    if (watchingScreenClientId === clientId) {
      unwatchScreen();
      backToGrid();
    }
  }
}

async function onSpeakerChanged(e) {
  const { deviceId } = e.detail;
  log(`Speaker changed to: ${deviceId || 'default'}`);

  // Update all existing audio elements
  for (const [consumerId, entry] of audioElements) {
    try {
      if (entry.audioCtx && typeof entry.audioCtx.setSinkId === 'function') {
        // Screen audio routed through AudioContext - set sink on the context
        await entry.audioCtx.setSinkId(deviceId || '');
        log(`Updated audio output (AudioContext) for consumer ${consumerId}`);
      } else if (typeof entry.audio.setSinkId === 'function') {
        await entry.audio.setSinkId(deviceId || '');
        log(`Updated audio output for consumer ${consumerId}`);
      }
    } catch (err) {
      log(`Failed to update audio output for consumer ${consumerId}:`, err.message);
    }
  }
}

// --- Webcam ---

async function handleWebcamClick() {
  if (isWebcamOn) {
    voiceService.stopWebcam();
    return;
  }

  if (!(await customConfirm('Do you want to share your webcam?'))) {
    return;
  }

  try {
    await voiceService.startWebcam();
  } catch (err) {
    console.error('Webcam start failed:', err);
    if (err.name !== 'NotAllowedError') {
      await customAlert('Failed to start webcam: ' + err.message);
    }
  }
}

function onLocalWebcamStarted(e) {
  isWebcamOn = true;
  btnWebcam.classList.add('active');
  playScreenSound(sndWebcamStart);
  const { track } = e.detail;
  createWebcamTile(serverService.clientId, 'You', track, true);
}

function onPeerWebcamStopped(e) {
  const { clientId } = e.detail;
  log('Peer webcam stopped (server event):', clientId);
  if (webcamConsumers.has(clientId)) {
    webcamConsumers.delete(clientId);
    removeWebcamTile(clientId);
  }
}

function onLocalWebcamStopped() {
  isWebcamOn = false;
  btnWebcam.classList.remove('active');
  playScreenSound(sndWebcamStop);
  if (wcPopoutClientId === serverService.clientId) {
    cleanupWcPopout();
  }
  removeWebcamTile(serverService.clientId);
}

// --- Tile Resize ---

let tileResizeTarget = null;
let tileResizeStartX = 0;
let tileResizeStartW = 0;

function addTileResizeHandle(tile) {
  const handle = document.createElement('div');
  handle.className = 'tile-resize-handle';
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    tileResizeTarget = tile;
    tileResizeStartX = e.clientX;
    tileResizeStartW = tile.offsetWidth;
    window.addEventListener('mousemove', onTileResizeMove);
    window.addEventListener('mouseup', onTileResizeUp);
  });
  tile.appendChild(handle);
}

function onTileResizeMove(e) {
  if (!tileResizeTarget) {
    return;
  }
  const delta = e.clientX - tileResizeStartX;
  const newWidth = Math.max(120, tileResizeStartW + delta);
  tileResizeTarget.style.width = `${newWidth}px`;
}

function onTileResizeUp() {
  tileResizeTarget = null;
  window.removeEventListener('mousemove', onTileResizeMove);
  window.removeEventListener('mouseup', onTileResizeUp);
}

function createWebcamTile(clientId, nickname, track, isSelf) {
  // Remove existing tile for this client if any
  removeWebcamTile(clientId);

  const tile = document.createElement('div');
  tile.className = `webcam-tile${isSelf ? ' self' : ''}`;
  tile.dataset.clientId = clientId;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = new MediaStream([track]);

  const nameLabel = document.createElement('div');
  nameLabel.className = 'webcam-name';
  nameLabel.textContent = nickname;

  tile.appendChild(video);
  tile.appendChild(nameLabel);
  addTileResizeHandle(tile);

  // Click to focus in viewer (ignore bottom 10% to avoid accidental focus from resize)
  tile.addEventListener('click', (e) => {
    const rect = tile.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height * 0.8) {
      return;
    }
    focusWebcamTile(clientId);
  });

  mediaGrid.appendChild(tile);
  if (focusMode) {
    buildFocusStrip();
  } else {
    updateMediaGridVisibility();
  }
}

function removeWebcamTile(clientId) {
  if (wcPopoutClientId === clientId) {
    cleanupWcPopout();
  }
  // If focused on this client, return to grid
  const wasFocused = focusMode && focusMode.type === 'webcam' && focusMode.clientId === clientId;
  const tile = mediaGrid.querySelector(`.webcam-tile[data-client-id="${clientId}"]`);
  if (tile) {
    const video = tile.querySelector('video');
    if (video) {
      video.srcObject = null;
    }
    tile.remove();
  }
  if (wasFocused) {
    unfocus();
  } else if (focusMode) {
    buildFocusStrip();
  } else {
    updateMediaGridVisibility();
  }
}

// --- Webcam Popout ---

async function toggleWcPopout(clientId, nickname, isSelf) {
  // If already popped out this client, close
  if (wcPopoutPC && wcPopoutClientId === clientId) {
    window.gimodi.wcPopout.close();
    cleanupWcPopout();
    return;
  }

  // Close any existing webcam popout first
  if (wcPopoutPC) {
    window.gimodi.wcPopout.close();
    cleanupWcPopout();
  }

  // Get the video stream from the viewer (if focused) or the tile
  let stream = null;
  if (focusedWebcamClientId === clientId && focusedWebcamStream) {
    stream = focusedWebcamStream;
  } else {
    const tile = mediaGrid.querySelector(`.webcam-tile[data-client-id="${clientId}"]`);
    if (!tile) {
      return;
    }
    const video = tile.querySelector('video');
    if (!video || !video.srcObject) {
      return;
    }
    stream = video.srcObject;
  }
  wcPopoutClientId = clientId;

  window.gimodi.wcPopout.removeListeners();

  window.gimodi.wcPopout.onSignal(async (data) => {
    if (data.type === 'ready') {
      await startWcPopoutWebRTC(stream);
      window.gimodi.wcPopout.sendSignal({
        type: 'meta',
        label: nickname,
        mirrored: isSelf,
      });
    } else if (data.type === 'answer') {
      await wcPopoutPC.setRemoteDescription(data.sdp);
    } else if (data.type === 'ice') {
      await wcPopoutPC.addIceCandidate(data.candidate);
    }
  });

  window.gimodi.wcPopout.onClosed(() => {
    cleanupWcPopout();
  });

  await window.gimodi.wcPopout.open();
  const poppedTile = mediaGrid.querySelector(`.webcam-tile[data-client-id="${clientId}"]`);
  if (poppedTile) {
    poppedTile.classList.add('popped-out');
  }
}

async function startWcPopoutWebRTC(stream) {
  wcPopoutPC = new RTCPeerConnection();

  for (const track of stream.getTracks()) {
    wcPopoutPC.addTrack(track, stream);
  }

  wcPopoutPC.onicecandidate = (e) => {
    if (e.candidate) {
      window.gimodi.wcPopout.sendSignal({ type: 'ice', candidate: e.candidate.toJSON() });
    }
  };

  const offer = await wcPopoutPC.createOffer();
  await wcPopoutPC.setLocalDescription(offer);
  window.gimodi.wcPopout.sendSignal({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
}

function cleanupWcPopout() {
  if (wcPopoutPC) {
    wcPopoutPC.close();
    wcPopoutPC = null;
  }
  window.gimodi.wcPopout.close();
  window.gimodi.wcPopout.removeListeners();
  if (wcPopoutClientId) {
    const tile = mediaGrid.querySelector(`.webcam-tile[data-client-id="${wcPopoutClientId}"]`);
    if (tile) {
      tile.classList.remove('popped-out');
    }
    wcPopoutClientId = null;
  }
}

// --- Webcam Viewer (Focus / Fullscreen) ---

function focusStream(type, clientId) {
  // Hide grid
  mediaGrid.classList.add('hidden');

  // Hide both viewers first
  webcamViewerContainer.classList.add('hidden');
  webcamViewerContainer.classList.remove('maximized');
  isWebcamMaximized = false;
  screenShareContainer.classList.add('hidden');
  screenShareContainer.classList.remove('maximized', 'resized');
  screenShareContainer.style.height = '';
  isScreenMaximized = false;
  isScreenResized = false;

  focusMode = { type, clientId };

  if (type === 'webcam') {
    webcamViewMode = 'focused';
    const tile = mediaGrid.querySelector(`.webcam-tile[data-client-id="${clientId}"]`);
    if (!tile) {
      unfocus();
      return;
    }
    const video = tile.querySelector('video');
    if (!video || !video.srcObject) {
      unfocus();
      return;
    }

    const stream = video.srcObject;
    const isSelf = tile.classList.contains('self');
    const nameLabel = tile.querySelector('.webcam-name');
    const nickname = nameLabel ? nameLabel.textContent : '';

    focusedWebcamClientId = clientId;
    focusedWebcamStream = stream;

    webcamViewerVideo.srcObject = stream;
    webcamViewerVideo.classList.toggle('mirrored', isSelf);
    webcamViewerLabel.textContent = nickname;
    webcamViewerContainer.classList.remove('hidden');
    webcamViewerVideo.play().catch(() => {});
  } else if (type === 'screen') {
    screenViewMode = 'focused';
    if (clientId === '__local__' && isScreenSharing && screenShareService.stream) {
      showLocalScreenShare(screenShareService.stream);
    } else {
      const entry = screenVideoConsumers.get(clientId);
      if (entry && entry.track) {
        watchScreen(clientId, entry.nickname, entry.track);
      } else {
        unfocus();
        return;
      }
    }
  }

  buildFocusStrip();
}

function buildFocusStrip() {
  focusStrip.innerHTML = '';
  if (!focusMode) {
    focusStrip.classList.add('hidden');
    return;
  }

  const tiles = [];

  // Collect all webcam streams
  for (const tile of mediaGrid.querySelectorAll('.webcam-tile')) {
    const cid = tile.dataset.clientId;
    if (focusMode.type === 'webcam' && focusMode.clientId === cid) {
      continue;
    }
    const video = tile.querySelector('video');
    if (!video || !video.srcObject) {
      continue;
    }
    const label = tile.querySelector('.webcam-name');
    tiles.push({ type: 'webcam', clientId: cid, stream: video.srcObject, label: label ? label.textContent : '' });
  }

  // Collect all screen streams
  for (const tile of mediaGrid.querySelectorAll('.screen-tile')) {
    const cid = tile.dataset.clientId;
    if (focusMode.type === 'screen' && focusMode.clientId === cid) {
      continue;
    }
    const video = tile.querySelector('video');
    if (!video || !video.srcObject) {
      continue;
    }
    const label = tile.querySelector('.screen-tile-label');
    tiles.push({ type: 'screen', clientId: cid, stream: video.srcObject, label: label ? label.textContent : '' });
  }

  if (tiles.length === 0) {
    focusStrip.classList.add('hidden');
    return;
  }

  for (const t of tiles) {
    const thumb = document.createElement('div');
    thumb.className = 'focus-strip-tile';
    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.playsInline = true;
    vid.muted = true;
    vid.srcObject = t.stream;
    thumb.appendChild(vid);

    const lbl = document.createElement('div');
    lbl.className = 'strip-label';
    lbl.textContent = t.label;
    thumb.appendChild(lbl);

    thumb.addEventListener('click', () => focusStream(t.type, t.clientId));
    focusStrip.appendChild(thumb);
  }

  focusStrip.classList.remove('hidden');
}

function unfocus() {
  focusMode = null;

  // Hide webcam viewer
  webcamViewMode = 'grid';
  focusedWebcamClientId = null;
  focusedWebcamStream = null;
  webcamViewerVideo.srcObject = null;
  webcamViewerVideo.classList.remove('mirrored');
  webcamViewerLabel.textContent = '';
  webcamViewerContainer.classList.add('hidden');
  webcamViewerContainer.classList.remove('maximized');
  isWebcamMaximized = false;
  if (isInBrowserFullscreen(webcamViewerContainer)) {
    exitBrowserFullscreen();
  }
  updateWebcamButtons();

  // Hide screen viewer
  screenViewMode = 'grid';
  cleanupPopout();
  watchingScreenClientId = null;
  screenVideo.srcObject = null;
  screenVideo.muted = false;
  screenShareLabel.textContent = '';
  screenShareContainer.classList.add('hidden');
  screenShareContainer.classList.remove('maximized', 'resized');
  screenShareContainer.style.height = '';
  screenVolumeControl.classList.add('hidden');
  isScreenMaximized = false;
  isScreenResized = false;
  if (isInBrowserFullscreen(screenShareContainer)) {
    exitBrowserFullscreen();
  }
  updateScreenButtons();

  // Hide strip
  focusStrip.innerHTML = '';
  focusStrip.classList.add('hidden');

  // Show grid if it has children
  updateMediaGridVisibility();
}

function focusWebcamTile(clientId) {
  focusStream('webcam', clientId);
}

function backToWebcamGrid() {
  unfocus();
}

function isInBrowserFullscreen(container) {
  return document.fullscreenElement === container;
}

function exitBrowserFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function updateWebcamButtons() {
  if (isInBrowserFullscreen(webcamViewerContainer)) {
    btnBackToWebcamGrid.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
    btnBackToWebcamGrid.title = 'Exit Fullscreen';
    btnMaximizeWebcam.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
  } else if (isWebcamMaximized) {
    btnBackToWebcamGrid.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
    btnBackToWebcamGrid.title = 'Minimize';
    btnMaximizeWebcam.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
  } else {
    btnBackToWebcamGrid.innerHTML = '<i class="bi bi-dash-lg"></i>';
    btnBackToWebcamGrid.title = 'Minimize';
    btnMaximizeWebcam.innerHTML = '<i class="bi bi-fullscreen"></i>';
  }
}

function toggleMaximizeWebcam() {
  if (isWebcamMaximized) {
    webcamViewerContainer.classList.remove('maximized');
    isWebcamMaximized = false;
  } else {
    webcamViewerContainer.classList.add('maximized');
    isWebcamMaximized = true;
  }
  updateWebcamButtons();
}

function onWebcamBackClick() {
  if (isInBrowserFullscreen(webcamViewerContainer)) {
    exitBrowserFullscreen();
  } else if (isWebcamMaximized) {
    webcamViewerContainer.classList.remove('maximized');
    isWebcamMaximized = false;
    updateWebcamButtons();
  } else {
    unfocus();
  }
}

function onWebcamViewerVideoClick() {
  if (isInBrowserFullscreen(webcamViewerContainer)) {
    exitBrowserFullscreen();
  } else if (isWebcamMaximized) {
    toggleMaximizeWebcam();
  } else {
    unfocus();
  }
}

// --- Right-click fullscreen context menu ---

function showMediaContextMenu(e, videoEl) {
  e.preventDefault();
  // Remove any existing menu
  const existing = document.getElementById('media-context-menu');
  if (existing) {
    existing.remove();
  }

  const container = videoEl.closest('#screen-share-container, #webcam-viewer-container');
  const inFullscreen = document.fullscreenElement === container;

  const menu = document.createElement('div');
  menu.id = 'media-context-menu';
  menu.className = 'media-context-menu';
  menu.innerHTML = inFullscreen
    ? `<div class="media-context-menu-item"><i class="bi bi-fullscreen-exit"></i> Exit Fullscreen</div>`
    : `<div class="media-context-menu-item"><i class="bi bi-arrows-fullscreen"></i> Fullscreen</div>`;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  (document.fullscreenElement || document.body).appendChild(menu);

  const item = menu.querySelector('.media-context-menu-item');
  item.addEventListener('click', () => {
    menu.remove();
    if (inFullscreen) {
      exitBrowserFullscreen();
    } else {
      enterBrowserFullscreen(videoEl);
    }
  });

  // Close on click outside or Escape
  const close = () => {
    menu.remove();
    document.removeEventListener('click', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      close();
    }
  };
  setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function enterBrowserFullscreen(videoEl) {
  const container = videoEl.closest('#screen-share-container, #webcam-viewer-container');
  const target = container || videoEl;
  if (target.requestFullscreen) {
    target.requestFullscreen();
  } else if (target.webkitRequestFullscreen) {
    target.webkitRequestFullscreen();
  }
}

function onPopoutWebcamClick() {
  if (!focusedWebcamClientId) {
    return;
  }
  const tile = mediaGrid.querySelector(`.webcam-tile[data-client-id="${focusedWebcamClientId}"]`);
  const isSelf = tile ? tile.classList.contains('self') : false;
  const nickname = webcamViewerLabel.textContent;
  toggleWcPopout(focusedWebcamClientId, nickname, isSelf);
}

// --- Screen Share ---

async function handleScreenShareClick() {
  if (isScreenSharing) {
    screenShareService.stopSharing();
    return;
  }

  try {
    // The main process will intercept getDisplayMedia and show the picker.
    // We pass withAudio based on the checkbox state - the picker will set it.
    // The actual call happens in the service, which calls getDisplayMedia.
    await screenShareService.startSharing(true);
  } catch (e) {
    const cancelled = e.name === 'NotAllowedError' || e.message === 'Error starting capture';
    if (!cancelled) {
      console.error('Screen share failed:', e);
      await customAlert('Failed to start screen share: ' + e.message);
    }
  }
}

function showScreenPicker(sources) {
  screenSourcesDiv.innerHTML = '';

  // Separate screens and windows
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  if (screens.length > 0) {
    const header = document.createElement('div');
    header.className = 'source-group-header';
    header.textContent = 'Screens';
    screenSourcesDiv.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'source-grid';
    for (const src of screens) {
      grid.appendChild(createSourceItem(src));
    }
    screenSourcesDiv.appendChild(grid);
  }

  if (windows.length > 0) {
    const header = document.createElement('div');
    header.className = 'source-group-header';
    header.textContent = 'Application Windows';
    screenSourcesDiv.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'source-grid';
    for (const src of windows) {
      grid.appendChild(createSourceItem(src));
    }
    screenSourcesDiv.appendChild(grid);
  }

  modalScreenPicker.classList.remove('hidden');
}

function createSourceItem(source) {
  const item = document.createElement('div');
  item.className = 'source-item';

  const img = document.createElement('img');
  img.src = source.thumbnail;
  item.appendChild(img);

  const name = document.createElement('div');
  name.className = 'source-name';
  name.textContent = source.name;
  item.appendChild(name);

  item.addEventListener('click', () => {
    const withAudio = chkScreenAudio.checked;
    // Tell the screen service whether the user wants audio before the main
    // process resolves getDisplayMedia (needed for venmic on Linux)
    screenShareService._wantAudio = withAudio;
    screenShareService._resolution = selectScreenResolution.value || '1080';
    localStorage.setItem('screenShareResolution', screenShareService._resolution);
    window.gimodi.screen.selectSource({ sourceId: source.id, withAudio });
    modalScreenPicker.classList.add('hidden');
  });

  return item;
}

function cancelScreenPicker() {
  window.gimodi.screen.selectSource({ sourceId: null });
  modalScreenPicker.classList.add('hidden');
}

function onLocalScreenStarted(e) {
  isScreenSharing = true;
  btnScreenShare.classList.add('active');
  log('Local screen share started');
  playScreenSound(sndScreenStart);

  const { stream } = e.detail;
  if (stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      createScreenTile('__local__', 'You (sharing)', videoTrack, true);
    }
  }
}

function showLocalScreenShare(stream) {
  watchingScreenClientId = '__local__';
  screenVideo.srcObject = stream;
  screenVideo.muted = true;
  screenShareLabel.textContent = 'You are sharing your screen';
  screenShareContainer.classList.remove('hidden');
  screenVolumeControl.classList.add('hidden');
  screenVideo.play().catch(() => {});
}

function onLocalScreenStopped() {
  isScreenSharing = false;
  btnScreenShare.classList.remove('active');
  log('Local screen share stopped');
  playScreenSound(sndScreenStop);

  removeScreenTile('__local__');
  if (watchingScreenClientId === '__local__') {
    unwatchScreen();
    backToGrid();
  }
}

function onPeerScreenStopped(e) {
  const { clientId } = e.detail;
  log('Peer screen stopped (server event):', clientId);
  if (screenVideoConsumers.has(clientId)) {
    screenVideoConsumers.delete(clientId);
    removeScreenTile(clientId);
    if (watchingScreenClientId === clientId) {
      unwatchScreen();
      backToGrid();
    }
  }
}

function watchScreen(clientId, nickname, track) {
  watchingScreenClientId = clientId;
  screenVideo.srcObject = new MediaStream([track]);
  screenShareLabel.textContent = `${nickname}'s screen`;
  screenShareContainer.classList.remove('hidden');
  screenVideo.play().catch(() => {});
  // Show volume control if there's screen audio from any peer
  const hasScreenAudio = [...audioElements.values()].some((e) => e.screenAudio);
  if (hasScreenAudio) {
    screenVolumeControl.classList.remove('hidden');
  } else {
    screenVolumeControl.classList.add('hidden');
  }
  log('Watching screen from', nickname);
}

function unwatchScreen() {
  watchingScreenClientId = null;
  screenVideo.srcObject = null;
  screenShareLabel.textContent = '';
  screenShareContainer.classList.add('hidden');
  screenShareContainer.classList.remove('maximized');
  screenVolumeControl.classList.add('hidden');
}

// --- Screen Share Grid ---

function createScreenTile(clientId, nickname, track, isLocal) {
  removeScreenTile(clientId);

  const tile = document.createElement('div');
  tile.className = 'screen-tile';
  tile.dataset.clientId = clientId;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = new MediaStream([track]);

  const label = document.createElement('div');
  label.className = 'screen-tile-label';
  label.textContent = isLocal ? 'You (sharing)' : nickname;

  tile.appendChild(video);
  tile.appendChild(label);
  addTileResizeHandle(tile);

  tile.addEventListener('click', (e) => {
    const rect = tile.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height * 0.8) {
      return;
    }
    focusScreenTile(clientId);
  });

  mediaGrid.appendChild(tile);
  if (focusMode) {
    buildFocusStrip();
  } else {
    updateMediaGridVisibility();
  }
}

function removeScreenTile(clientId) {
  const wasFocused = focusMode && focusMode.type === 'screen' && focusMode.clientId === clientId;
  const tile = mediaGrid.querySelector(`.screen-tile[data-client-id="${clientId}"]`);
  if (tile) {
    const video = tile.querySelector('video');
    if (video) {
      video.srcObject = null;
    }
    tile.remove();
  }
  if (wasFocused) {
    unfocus();
  } else if (focusMode) {
    buildFocusStrip();
  } else {
    updateMediaGridVisibility();
  }
}

function clearScreenGrid() {
  for (const tile of [...mediaGrid.querySelectorAll('.screen-tile')]) {
    const video = tile.querySelector('video');
    if (video) {
      video.srcObject = null;
    }
    tile.remove();
  }
  updateMediaGridVisibility();
}

function focusScreenTile(clientId) {
  focusStream('screen', clientId);
}

function updateScreenButtons() {
  if (isInBrowserFullscreen(screenShareContainer)) {
    btnBackToGrid.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
    btnBackToGrid.title = 'Exit Fullscreen';
    btnMaximizeScreen.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
  } else if (isScreenMaximized) {
    btnBackToGrid.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
    btnBackToGrid.title = 'Minimize';
    btnMaximizeScreen.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
  } else {
    btnBackToGrid.innerHTML = '<i class="bi bi-dash-lg"></i>';
    btnBackToGrid.title = 'Minimize';
    btnMaximizeScreen.innerHTML = '<i class="bi bi-fullscreen"></i>';
  }
}

function toggleMaximizeScreen() {
  if (isScreenMaximized) {
    screenShareContainer.classList.remove('maximized');
    isScreenMaximized = false;
  } else {
    screenShareContainer.classList.add('maximized');
    isScreenMaximized = true;
  }
  updateScreenButtons();
}

function onScreenVideoClick() {
  if (isInBrowserFullscreen(screenShareContainer)) {
    exitBrowserFullscreen();
  } else if (isScreenMaximized) {
    toggleMaximizeScreen();
  } else {
    unfocus();
  }
}

function onScreenBackClick() {
  if (isInBrowserFullscreen(screenShareContainer)) {
    exitBrowserFullscreen();
  } else if (isScreenMaximized) {
    screenShareContainer.classList.remove('maximized');
    isScreenMaximized = false;
    updateScreenButtons();
  } else {
    unfocus();
  }
}

function backToGrid() {
  unfocus();
}

// eslint-disable-next-line no-unused-vars
function autoWatchNextScreen() {
  // Auto-watch first available screen share
  for (const [clientId, entry] of screenVideoConsumers) {
    if (entry.track) {
      watchScreen(clientId, entry.nickname, entry.track);
      return;
    }
  }
  // Fall back to own local screen share if still active
  if (isScreenSharing && screenShareService.stream) {
    showLocalScreenShare(screenShareService.stream);
  }
}

function onScreenVolumeChange() {
  const vol = parseFloat(rangeScreenVolume.value);
  screenAudioGain = vol;
  screenVolumeValue.textContent = `${Math.round(vol)}%`;
  // Apply to all screen audio elements via GainNode
  for (const entry of audioElements.values()) {
    if (entry.screenAudio && entry.gainNode) {
      entry.gainNode.gain.cancelScheduledValues(entry.audioCtx.currentTime);
      entry.gainNode.gain.setValueAtTime(vol / 100, entry.audioCtx.currentTime);
    }
  }
}

// --- Screen Share Helpers ---

function hideScreenShare() {
  cleanupPopout();
  watchingScreenClientId = null;
  screenVideo.srcObject = null;
  screenVideo.muted = false;
  screenShareLabel.textContent = '';
  screenShareContainer.classList.add('hidden');
  screenShareContainer.classList.remove('maximized', 'resized');
  screenShareContainer.style.height = '';
  screenVolumeControl.classList.add('hidden');
  isScreenMaximized = false;
  isScreenResized = false;
  screenViewMode = 'grid';
  if (isInBrowserFullscreen(screenShareContainer)) {
    exitBrowserFullscreen();
  }
  updateScreenButtons();
  clearScreenGrid();
}

// --- Screen Share Popout ---

async function togglePopout() {
  if (popoutPC) {
    window.gimodi.popout.close();
    cleanupPopout();
    return;
  }

  // Get the current screen video stream
  const stream = screenVideo.srcObject;
  if (!stream) {
    return;
  }

  const label = screenShareLabel.textContent;

  window.gimodi.popout.removeListeners();

  window.gimodi.popout.onSignal(async (data) => {
    if (data.type === 'ready') {
      await startPopoutWebRTC(stream);
      window.gimodi.popout.sendSignal({ type: 'meta', label });
    } else if (data.type === 'answer') {
      await popoutPC.setRemoteDescription(data.sdp);
    } else if (data.type === 'ice') {
      await popoutPC.addIceCandidate(data.candidate);
    }
  });

  window.gimodi.popout.onClosed(() => {
    cleanupPopout();
  });

  await window.gimodi.popout.open();
}

async function startPopoutWebRTC(stream) {
  popoutPC = new RTCPeerConnection();

  for (const track of stream.getTracks()) {
    popoutPC.addTrack(track, stream);
  }

  popoutPC.onicecandidate = (e) => {
    if (e.candidate) {
      window.gimodi.popout.sendSignal({ type: 'ice', candidate: e.candidate.toJSON() });
    }
  };

  const offer = await popoutPC.createOffer();
  await popoutPC.setLocalDescription(offer);
  window.gimodi.popout.sendSignal({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
}

function cleanupPopout() {
  if (popoutPC) {
    popoutPC.close();
    popoutPC = null;
  }
  window.gimodi.popout.close();
  window.gimodi.popout.removeListeners();
}

// --- Resize Handle ---

let resizeStartY = 0;
let resizeStartHeight = 0;

function onResizeHandleMouseDown(e) {
  e.preventDefault();
  resizeStartY = e.clientY;
  resizeStartHeight = screenShareContainer.offsetHeight;
  window.addEventListener('mousemove', onResizeHandleMouseMove);
  window.addEventListener('mouseup', onResizeHandleMouseUp);
}

function onResizeHandleMouseMove(e) {
  const delta = e.clientY - resizeStartY;
  const newHeight = Math.max(150, resizeStartHeight + delta);
  screenShareContainer.style.height = `${newHeight}px`;
  if (!isScreenResized) {
    screenShareContainer.classList.add('resized');
    isScreenResized = true;
  }
}

function onResizeHandleMouseUp() {
  window.removeEventListener('mousemove', onResizeHandleMouseMove);
  window.removeEventListener('mouseup', onResizeHandleMouseUp);
}

// --- Watch Stream (from channel tree) ---

function onWatchStreamEvent(e) {
  const { clientId } = e.detail;
  if (!clientId) {
    return;
  }

  // If clicking own username while screen sharing, focus local tile
  if (clientId === serverService.clientId && isScreenSharing && screenShareService.stream) {
    focusScreenTile('__local__');
    return;
  }

  const entry = screenVideoConsumers.get(clientId);
  if (entry && entry.track) {
    focusScreenTile(clientId);
  }
}
