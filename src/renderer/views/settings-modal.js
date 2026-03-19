import voiceService from '../services/voice.js';
import { applyTheme, refreshIdentitySelects } from './connect.js';
import { setFeedbackVolume } from './server.js';
import { refreshTimestamps, setChatDisplayMode, setMediaEmbedPrivacy } from './chat.js';
import { setTimeFormat } from '../services/timeFormat.js';
import { customConfirm } from '../services/dialogs.js';
import notificationService from '../services/notifications.js';

const log = (...args) => console.log('[settings-modal]', ...args);

const THEMES = [
  { id: 'default', name: 'Deep Ocean', bg: '#0f111a', secondary: '#0f111a', accent: '#82aaff' },
  { id: 'classic-dark', name: 'Classic Dark', bg: '#111111', secondary: '#181818', accent: '#ffffff' },
  { id: 'deeper-blue', name: 'Deeper Blue', bg: '#060d18', secondary: '#0a1525', accent: '#3b82f6' },
  { id: 'deep-ocean', name: 'Space', bg: '#0a1628', secondary: '#0f1f3a', accent: '#4a9eff' },
  { id: 'midnight-purple', name: 'Midnight Purple', bg: '#150f1e', secondary: '#1c1528', accent: '#b388ff' },
  { id: 'forest', name: 'Forest', bg: '#0e1510', secondary: '#141e16', accent: '#66bb6a' },
  { id: 'light', name: 'Light', bg: '#f5f5f5', secondary: '#ffffff', accent: '#1a1a1a' },
];

const modalSettings = document.getElementById('modal-settings');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const settingsPanels = document.querySelectorAll('.settings-panel');
const themeGrid = document.getElementById('theme-grid');
const checkboxDevMode = document.getElementById('checkbox-dev-mode');
const selectNotificationMode = document.getElementById('select-notification-mode');
const checkboxUpdateNotifications = document.getElementById('checkbox-update-notifications');
const selectUpdateChannel = document.getElementById('select-update-channel');
const btnCheckUpdates = document.getElementById('btn-check-updates');
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
const btnTestSpeaker = document.getElementById('btn-test-speaker');
const inputPTTKey = document.getElementById('input-ptt-key');
const pttKeyConfig = document.getElementById('ptt-key-config');
const micLevelFill = document.getElementById('mic-level-fill');
const identityStatus = document.getElementById('identity-status');
const identityCreateForm = document.getElementById('identity-create-form');
const inputIdentityName = document.getElementById('input-identity-name');
const btnIdentityCreateConfirm = document.getElementById('btn-identity-create-confirm');
const btnIdentityCreateCancel = document.getElementById('btn-identity-create-cancel');
const settingsIdentityList = document.getElementById('settings-identity-list');
const btnIdentityNew = document.getElementById('btn-identity-new');
const btnIdentityImport = document.getElementById('btn-identity-import');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');

let micLevelRAF = null;
let _micMeterStream = null;
let _micMeterCtx = null;
let _micMeterAnalyser = null;
let _testToneAudio = null;
let _micLoopbackStream = null;
let _micLoopbackCtx = null;
let _micLoopbackAudio = null;
let _micLoopbackGateRAF = null;
let _cameraPreviewStream = null;

/** @type {{ appSettings: Object, saveSettings: function }} */
let _deps = { appSettings: {}, saveSettings: () => {} };

/**
 * Initializes the settings modal with external dependencies from app.js.
 * @param {{ appSettings: Object, saveSettings: function }} deps
 */
export function initSettingsModal(deps) {
  _deps = deps;
  bindEventListeners();
}

/**
 * Returns the current dependencies (for accessing appSettings by reference).
 * @returns {{ appSettings: Object, saveSettings: function }}
 */
function getDeps() {
  return _deps;
}

/**
 * Renders the theme selection grid in the appearance settings tab.
 * Highlights the currently active theme and handles theme switching on click.
 */
export function renderThemeGrid() {
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
      getDeps().appSettings.theme = theme.id;
      getDeps().saveSettings();
      renderThemeGrid();
    });
    themeGrid.appendChild(card);
  }
}

/**
 * Switches the visible settings tab and activates related features (e.g., mic level meter for audio tab).
 * @param {string} tab - The tab identifier to switch to (e.g., 'audio', 'appearance', 'identities').
 */
export function switchSettingsTab(tab) {
  settingsNavItems.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  settingsPanels.forEach((p) => p.classList.toggle('active', p.id === `settings-panel-${tab}`));
  if (tab === 'audio') {
    populateDeviceSelectors();
    startMicLevelMeter();
  } else {
    stopMicLevelMeter();
    stopCameraPreview();
  }
  if (tab === 'appearance') {
    renderThemeGrid();
  }
  if (tab === 'identities') {
    loadSettingsIdentities();
  }
}

/**
 * Opens the settings modal and populates all controls with current values.
 * @param {string} [tab='audio'] - The tab to display when the modal opens.
 */
export async function openSettings(tab = 'audio') {
  const { appSettings } = getDeps();

  document.getElementById('select-time-format').value = appSettings.timeFormat || 'locale';
  document.getElementById('select-chat-display').value = appSettings.chatDisplay || 'default';
  checkboxDevMode.checked = !!appSettings.devMode;
  checkboxUpdateNotifications.checked = appSettings.updateNotifications !== false;
  selectUpdateChannel.value = appSettings.updateChannel || 'stable';
  selectNotificationMode.value = appSettings.notificationMode || 'mentions';
  document.getElementById('checkbox-media-embed-privacy').checked = appSettings.mediaEmbedPrivacy !== false;

  rangeVoiceActivation.value = voiceService.voiceActivationLevel;
  voiceActivationValue.textContent = voiceService.voiceActivationLevel === 0 ? 'Off' : voiceService.voiceActivationLevel;
  const fbVol = appSettings.feedbackVolume ?? 10;
  rangeFeedbackVolume.value = fbVol;
  feedbackVolumeValue.textContent = fbVol;
  checkboxNoiseSuppression.checked = !!appSettings.noiseSuppression;
  checkboxPushToTalk.checked = !!appSettings.pushToTalkEnabled;
  inputPTTKey.value = appSettings.pushToTalkKey || ' ';
  pttKeyConfig.style.display = checkboxPushToTalk.checked ? '' : 'none';

  switchSettingsTab(tab);
  modalSettings.classList.remove('hidden');
}

/**
 * Closes the settings modal and cleans up any active previews or test audio.
 */
export function closeSettings() {
  modalSettings.classList.add('hidden');
  stopMicLevelMeter();
  stopCameraPreview();
  stopTestTone();
  stopMicLoopback();
  identityCreateForm.classList.add('hidden');
  inputIdentityName.value = '';
  identityStatus.textContent = '';
}

/**
 * Loads and renders the list of identities in the identities settings tab.
 */
export async function loadSettingsIdentities() {
  identityStatus.textContent = '';
  settingsIdentityList.innerHTML = '';
  const identities = (await window.gimodi.identity.loadAll()) || [];
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
    const nameText = document.createElement('span');
    nameText.className = 'identity-name-text';
    nameText.textContent = id.name;
    name.appendChild(nameText);
    if (id.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'identity-default-badge';
      badge.textContent = ' \u2713 Default';
      name.appendChild(badge);
    }
    nameText.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = id.name;
      input.maxLength = 64;
      input.className = 'identity-rename-input';
      nameText.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      async function finish(save) {
        if (done) {
          return;
        }
        done = true;
        const newName = input.value.trim();
        if (save && newName && newName !== id.name) {
          try {
            await window.gimodi.identity.rename(id.fingerprint, newName);
            refreshIdentitySelects();
          } catch (err) {
            identityStatus.textContent = err.message || 'Rename failed.';
          }
        }
        loadSettingsIdentities();
      }
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      });
    });
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
      if (!(await customConfirm(`Delete identity "${id.name}"? This cannot be undone.`))) {
        return;
      }
      await window.gimodi.identity.delete(id.fingerprint);
      loadSettingsIdentities();
    });
    actions.appendChild(btnDelete);
    item.appendChild(info);
    item.appendChild(actions);
    settingsIdentityList.appendChild(item);
  }
}

/**
 * Stops the speaker test tone and resets the test button state.
 */
export function stopTestTone() {
  if (_testToneAudio) {
    _testToneAudio.pause();
    _testToneAudio.currentTime = 0;
    _testToneAudio.removeEventListener('ended', stopTestTone);
    _testToneAudio = null;
  }
  btnTestSpeaker.classList.remove('playing');
  btnTestSpeaker.innerHTML = '<i class="bi bi-volume-up"></i> Test';
}

/**
 * Starts the microphone loopback test, routing mic audio through the selected speaker
 * with voice activation gating applied.
 */
export async function startMicLoopback() {
  stopMicLoopback();

  try {
    const micId = selectMic.value || undefined;
    const constraints = { audio: micId ? { deviceId: { exact: micId } } : true };
    _micLoopbackStream = await navigator.mediaDevices.getUserMedia(constraints);

    const micTrackSettings = _micLoopbackStream.getAudioTracks()[0]?.getSettings();
    _micLoopbackCtx = new AudioContext(micTrackSettings?.sampleRate ? { sampleRate: micTrackSettings.sampleRate } : undefined);
    const source = _micLoopbackCtx.createMediaStreamSource(_micLoopbackStream);
    const dest = _micLoopbackCtx.createMediaStreamDestination();
    const gate = _micLoopbackCtx.createGain();
    const analyser = _micLoopbackCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(gate);
    gate.connect(dest);

    const gateData = new Uint8Array(analyser.frequencyBinCount);
    function updateGate() {
      const threshold = voiceService.voiceActivationLevel;
      if (threshold > 0) {
        analyser.getByteFrequencyData(gateData);
        const level = Math.min(100, gateData.reduce((a, b) => a + b, 0) / gateData.length);
        gate.gain.value = level >= threshold ? 1 : 0;
      } else {
        gate.gain.value = 1;
      }
      _micLoopbackGateRAF = requestAnimationFrame(updateGate);
    }
    _micLoopbackGateRAF = requestAnimationFrame(updateGate);

    _micLoopbackAudio = new Audio();
    _micLoopbackAudio.srcObject = dest.stream;

    const speakerId = selectSpeaker.value;
    if (speakerId && typeof _micLoopbackAudio.setSinkId === 'function') {
      await _micLoopbackAudio.setSinkId(speakerId);
    }

    await _micLoopbackAudio.play();

    btnTestMic.classList.add('playing');
    btnTestMic.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';
  } catch (err) {
    console.error('[settings-modal] Mic loopback failed:', err);
    stopMicLoopback();
  }
}

/**
 * Stops the microphone loopback test and releases all associated resources.
 */
export function stopMicLoopback() {
  if (_micLoopbackGateRAF) {
    cancelAnimationFrame(_micLoopbackGateRAF);
    _micLoopbackGateRAF = null;
  }
  if (_micLoopbackAudio) {
    _micLoopbackAudio.pause();
    _micLoopbackAudio.srcObject = null;
    _micLoopbackAudio = null;
  }
  if (_micLoopbackCtx) {
    _micLoopbackCtx.close().catch(() => {});
    _micLoopbackCtx = null;
  }
  if (_micLoopbackStream) {
    _micLoopbackStream.getTracks().forEach((t) => t.stop());
    _micLoopbackStream = null;
  }
  btnTestMic.classList.remove('playing');
  btnTestMic.innerHTML = '<i class="bi bi-mic"></i> Test';
}

/**
 * Starts the camera preview in the audio/video settings tab using the selected camera device.
 */
export async function startCameraPreview() {
  stopCameraPreview();

  const deviceId = selectCamera.value;
  if (!deviceId) {
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
    console.warn('[settings-modal] Camera preview failed:', err);
    cameraPreviewContainer.classList.remove('hidden');
    cameraPreviewVideo.classList.add('hidden');
    cameraPreviewPlaceholder.classList.remove('hidden');
  }
}

/**
 * Stops the camera preview and hides the preview container.
 */
export function stopCameraPreview() {
  if (_cameraPreviewStream) {
    _cameraPreviewStream.getTracks().forEach((t) => t.stop());
    _cameraPreviewStream = null;
  }
  cameraPreviewVideo.srcObject = null;
  cameraPreviewContainer.classList.add('hidden');
  cameraPreviewVideo.classList.add('hidden');
  cameraPreviewPlaceholder.classList.remove('hidden');
  btnTestCamera.classList.remove('playing');
  btnTestCamera.innerHTML = '<i class="bi bi-camera-video"></i> Test';
}

/**
 * Enumerates available audio/video devices and populates the microphone,
 * camera, and speaker select elements with the results.
 */
export async function populateDeviceSelectors() {
  try {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* no devices */
      }
    }

    const { microphones, cameras, speakers } = await voiceService.getAudioDevices();

    selectMic.innerHTML = '<option value="">Default</option>';
    for (const d of microphones) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphonie ${d.deviceId.slice(0, 8)}`;
      if (d.deviceId === voiceService.selectedMicId) {
        opt.selected = true;
      }
      selectMic.appendChild(opt);
    }

    selectCamera.innerHTML = '';
    if (cameras.length === 0) {
      selectCamera.innerHTML = '<option value="">None</option>';
    }
    for (const d of cameras) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${d.deviceId.slice(0, 8)}`;
      if (d.deviceId === voiceService.selectedCameraId) {
        opt.selected = true;
      }
      selectCamera.appendChild(opt);
    }

    selectSpeaker.innerHTML = '<option value="">Default</option>';
    for (const d of speakers) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Speaker ${d.deviceId.slice(0, 8)}`;
      if (d.deviceId === voiceService.selectedSpeakerId) {
        opt.selected = true;
      }
      selectSpeaker.appendChild(opt);
    }

    log('Devices: mics=', microphones.length, 'cameras=', cameras.length, 'speakers=', speakers.length);
  } catch (e) {
    console.error('[settings-modal] Failed to enumerate devices:', e);
  }
}

/**
 * Starts the microphone level meter, displaying real-time audio levels
 * in the settings panel. Opens an independent mic stream for monitoring.
 */
export async function startMicLevelMeter() {
  stopMicLevelMeter();

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
    console.warn('[settings-modal] Mic level meter: could not open mic stream:', e);
  }

  function update() {
    let pct = 0;
    if (_micMeterAnalyser) {
      const data = new Uint8Array(_micMeterAnalyser.frequencyBinCount);
      _micMeterAnalyser.getByteFrequencyData(data);
      pct = Math.min(100, data.reduce((a, b) => a + b, 0) / data.length);
    }
    micLevelFill.style.width = pct + '%';
    const threshold = voiceService.voiceActivationLevel;
    if (threshold > 0) {
      micLevelFill.classList.toggle('below-threshold', pct < threshold);
    } else {
      micLevelFill.classList.remove('below-threshold');
    }
    micLevelRAF = requestAnimationFrame(update);
  }
  micLevelRAF = requestAnimationFrame(update);
}

/**
 * Stops the microphone level meter and releases its audio resources.
 */
export function stopMicLevelMeter() {
  if (micLevelRAF) {
    cancelAnimationFrame(micLevelRAF);
    micLevelRAF = null;
  }
  if (_micMeterStream) {
    _micMeterStream.getTracks().forEach((t) => t.stop());
    _micMeterStream = null;
  }
  if (_micMeterCtx) {
    _micMeterCtx.close().catch(() => {});
    _micMeterCtx = null;
    _micMeterAnalyser = null;
  }
  micLevelFill.style.width = '0%';
  micLevelFill.classList.remove('below-threshold');
}

/**
 * Binds all event listeners for the settings modal UI elements.
 * Called once during initialization.
 */
function bindEventListeners() {
  settingsNavItems.forEach((t) => {
    t.addEventListener('click', () => switchSettingsTab(t.dataset.tab));
  });

  btnSettings.addEventListener('click', () => openSettings('audio'));

  btnCloseSettings.addEventListener('click', closeSettings);

  modalSettings.addEventListener('click', (e) => {
    if (e.target === modalSettings) {
      closeSettings();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalSettings.classList.contains('hidden')) {
      closeSettings();
    }
  });

  document.getElementById('select-time-format').addEventListener('change', (e) => {
    const fmt = e.target.value;
    setTimeFormat(fmt);
    getDeps().appSettings.timeFormat = fmt;
    getDeps().saveSettings();
    refreshTimestamps();
  });

  document.getElementById('select-chat-display').addEventListener('change', (e) => {
    const mode = e.target.value;
    setChatDisplayMode(mode);
    getDeps().appSettings.chatDisplay = mode;
    getDeps().saveSettings();
  });

  checkboxDevMode.addEventListener('change', () => {
    getDeps().appSettings.devMode = checkboxDevMode.checked;
    getDeps().saveSettings();
    window.gimodi.setDevMode(checkboxDevMode.checked);
  });

  checkboxUpdateNotifications.addEventListener('change', () => {
    getDeps().appSettings.updateNotifications = checkboxUpdateNotifications.checked;
    getDeps().saveSettings();
    window.gimodi.setUpdateNotifications(checkboxUpdateNotifications.checked);
  });

  selectUpdateChannel.addEventListener('change', () => {
    getDeps().appSettings.updateChannel = selectUpdateChannel.value;
    getDeps().saveSettings();
    window.gimodi.setUpdateChannel(selectUpdateChannel.value);
  });

  btnCheckUpdates.addEventListener('click', () => {
    window.gimodi.menuAction('check-updates');
  });

  selectNotificationMode.addEventListener('change', () => {
    getDeps().appSettings.notificationMode = selectNotificationMode.value;
    getDeps().saveSettings();
    window.gimodi.setNotificationMode(selectNotificationMode.value);
  });

  document.getElementById('checkbox-media-embed-privacy').addEventListener('change', (e) => {
    getDeps().appSettings.mediaEmbedPrivacy = e.target.checked;
    setMediaEmbedPrivacy(e.target.checked);
    getDeps().saveSettings();
  });

  window.gimodi.onNotificationModeChanged((mode) => {
    getDeps().appSettings.notificationMode = mode;
    notificationService.updateSettings(getDeps().appSettings);
    selectNotificationMode.value = mode;
  });

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
    if (!name) {
      return;
    }
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
    if (e.key === 'Enter') {
      btnIdentityCreateConfirm.click();
    }
    if (e.key === 'Escape') {
      btnIdentityCreateCancel.click();
    }
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
    getDeps().appSettings.micId = selectMic.value || null;
    getDeps().saveSettings();
    startMicLevelMeter();
    if (_micLoopbackStream) {
      startMicLoopback();
    }
  });

  selectCamera.addEventListener('change', () => {
    voiceService.setCamera(selectCamera.value || null);
    getDeps().appSettings.cameraId = selectCamera.value || null;
    getDeps().saveSettings();
    if (_cameraPreviewStream) {
      startCameraPreview();
    }
  });

  selectSpeaker.addEventListener('change', () => {
    voiceService.setSpeaker(selectSpeaker.value || null);
    getDeps().appSettings.speakerId = selectSpeaker.value || null;
    getDeps().saveSettings();
  });

  btnTestSpeaker.addEventListener('click', async () => {
    if (_testToneAudio) {
      stopTestTone();
      return;
    }

    try {
      _testToneAudio = new Audio('../../assets/test-tone.wav');
      _testToneAudio.volume = 0.1;

      const speakerId = selectSpeaker.value;
      if (speakerId && typeof _testToneAudio.setSinkId === 'function') {
        await _testToneAudio.setSinkId(speakerId);
      }

      btnTestSpeaker.classList.add('playing');
      btnTestSpeaker.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';

      _testToneAudio.addEventListener('ended', stopTestTone);
      _testToneAudio.addEventListener('error', (e) => {
        console.error('[settings-modal] Test tone error:', e);
        stopTestTone();
      });

      await _testToneAudio.play();
    } catch (e) {
      console.error('[settings-modal] Failed to play test tone:', e);
      stopTestTone();
    }
  });

  rangeVoiceActivation.addEventListener('input', () => {
    const level = parseInt(rangeVoiceActivation.value, 10);
    voiceActivationValue.textContent = level === 0 ? 'Off' : level;
    voiceService.setVoiceActivationLevel(level);
    getDeps().appSettings.voiceActivationLevel = level;
    getDeps().saveSettings();
  });

  rangeFeedbackVolume.addEventListener('input', () => {
    const vol = parseInt(rangeFeedbackVolume.value, 10);
    feedbackVolumeValue.textContent = vol;
    setFeedbackVolume(vol / 100);
    getDeps().appSettings.feedbackVolume = vol;
    getDeps().saveSettings();
  });

  checkboxNoiseSuppression.addEventListener('change', () => {
    const enabled = checkboxNoiseSuppression.checked;
    voiceService.setNoiseSuppression(enabled);
    getDeps().appSettings.noiseSuppression = enabled;
    getDeps().saveSettings();
  });

  checkboxPushToTalk.addEventListener('change', () => {
    const enabled = checkboxPushToTalk.checked;
    const key = inputPTTKey.value || ' ';
    voiceService.setPushToTalk(enabled, key);
    getDeps().appSettings.pushToTalkEnabled = enabled;
    getDeps().appSettings.pushToTalkKey = key;
    pttKeyConfig.style.display = enabled ? '' : 'none';
    getDeps().saveSettings();
  });

  inputPTTKey.addEventListener('keydown', (e) => {
    e.preventDefault();
    const key = e.key;
    inputPTTKey.value = key;
    voiceService.setPushToTalk(checkboxPushToTalk.checked, key);
    getDeps().appSettings.pushToTalkKey = key;
    getDeps().saveSettings();
  });

  btnTestMic.addEventListener('click', () => {
    if (_micLoopbackStream) {
      stopMicLoopback();
    } else {
      startMicLoopback();
    }
  });

  btnTestCamera.addEventListener('click', () => {
    if (_cameraPreviewStream || btnTestCamera.classList.contains('playing')) {
      stopCameraPreview();
    } else {
      startCameraPreview();
    }
  });
}
