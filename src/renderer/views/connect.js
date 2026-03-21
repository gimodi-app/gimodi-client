import connectionManager, { connKey } from '../services/connectionManager.js';
import { initSidebar as _initSidebar, renderSidebar, setActiveServer, clearActiveServer, updateServerInList, addOrUpdateServer, replaceServerInPlace, removeServerByIdentity } from './sidebar.js';

export { renderSidebar, setActiveServer, clearActiveServer, removeServerByIdentity };

const addServerAddress = document.getElementById('add-server-address');
const addServerNickname = document.getElementById('add-server-nickname');
const addServerPassword = document.getElementById('add-server-password');
const addServerError = document.getElementById('add-server-error');
const btnConfirmAddServer = document.getElementById('btn-confirm-add-server');
const btnCancelAddServer = document.getElementById('btn-cancel-add-server');
const modalAddServer = document.getElementById('modal-add-server');

const modalEditServer = document.getElementById('modal-edit-server');
const editServerAddress = document.getElementById('edit-server-address');
const editServerNickname = document.getElementById('edit-server-nickname');
const editServerPassword = document.getElementById('edit-server-password');
const editServerError = document.getElementById('edit-server-error');
const btnConfirmEditServer = document.getElementById('btn-confirm-edit-server');
const btnCancelEditServer = document.getElementById('btn-cancel-edit-server');

let editingServer = null;
let editingServerWasConnected = false;

const modalConnectError = document.getElementById('modal-connect-error');
const connectErrorMessage = document.getElementById('connect-error-message');
const btnConnectErrorOk = document.getElementById('btn-connect-error-ok');

btnConnectErrorOk.addEventListener('click', () => {
  modalConnectError.classList.add('hidden');
});

/**
 * @param {string} themeId
 */
export function applyTheme(themeId) {
  if (!themeId || themeId === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
}

/** Initializes the connect view and auto-updater banner. */
export async function initConnectView() {
  const updateBanner = document.getElementById('update-banner');
  const updateBannerText = document.getElementById('update-banner-text');
  const btnUpdateDownload = document.getElementById('btn-update-download');
  const btnUpdateDismiss = document.getElementById('btn-update-dismiss');

  window.gimodi.onUpdateAvailable((version) => {
    updateBannerText.textContent = `Version ${version} is available!`;
    btnUpdateDownload.dataset.version = version;
    updateBanner.classList.remove('hidden');
  });

  const updateProgressOverlay = document.getElementById('update-progress-overlay');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressText = document.getElementById('update-progress-text');
  const btnUpdateClose = document.getElementById('btn-update-close');

  function showDownloadProgress() {
    updateBanner.classList.add('hidden');
    updateProgressOverlay.classList.remove('hidden');
    updateProgressBar.style.width = '0%';
    updateProgressText.textContent = 'Starting download...';
  }

  function startDownload(version) {
    showDownloadProgress();
    window.gimodi.downloadUpdate(version);
  }

  window.gimodi.onUpdateDownloadStart((version) => {
    startDownload(version);
  });

  window.gimodi.onUpdateDownloadProgress(({ received, total, percent }) => {
    updateProgressBar.style.width = `${percent}%`;
    const receivedMB = (received / 1048576).toFixed(1);
    const totalMB = (total / 1048576).toFixed(1);
    updateProgressText.textContent = `${percent}% - ${receivedMB} MB / ${totalMB} MB`;
  });

  window.gimodi.onUpdateStatus((status) => {
    updateProgressText.textContent = status;
  });

  btnUpdateClose.addEventListener('click', () => {
    window.gimodi.cancelUpdate();
    updateProgressOverlay.classList.add('hidden');
  });

  btnUpdateDownload.addEventListener('click', () => {
    const version = btnUpdateDownload.dataset.version;
    if (!version) {
      return;
    }
    startDownload(version);
  });

  btnUpdateDismiss.addEventListener('click', () => {
    updateBanner.classList.add('hidden');
  });
}

/** Initializes the server sidebar with connect callback and modal. */
export async function initSidebar() {
  await _initSidebar(connectToServer, openAddServerModal, openEditServerModal);

  btnConfirmAddServer.addEventListener('click', handleAddServer);
  btnCancelAddServer.addEventListener('click', closeAddServerModal);
  modalAddServer.addEventListener('click', (e) => {
    if (e.target === modalAddServer) {
      closeAddServerModal();
    }
  });

  for (const input of [addServerAddress, addServerNickname, addServerPassword]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleAddServer();
      }
    });
  }

  btnConfirmEditServer.addEventListener('click', handleEditServer);
  btnCancelEditServer.addEventListener('click', closeEditServerModal);
  modalEditServer.addEventListener('click', (e) => {
    if (e.target === modalEditServer) {
      closeEditServerModal();
    }
  });

  for (const input of [editServerAddress, editServerNickname, editServerPassword]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleEditServer();
      }
    });
  }

  window.gimodi.onProtocolAddServer((data) => {
    openAddServerModal(data);
  });
}

/**
 * Returns the active identity from the DB.
 * @returns {Promise<{ fingerprint: string, name: string, public_key: string } | null>}
 */
async function getActiveIdentity() {
  return window.gimodi.db.getActiveIdentity();
}

/**
 * Opens the Add Server modal, optionally pre-filling fields.
 * @param {{ address?: string, nickname?: string, password?: string }} [prefill]
 */
function openAddServerModal(prefill) {
  addServerAddress.value = prefill?.address || '';
  addServerNickname.value = prefill?.nickname || '';
  addServerPassword.value = prefill?.password || '';
  addServerError.textContent = '';
  modalAddServer.classList.remove('hidden');
  if (prefill?.address) {
    addServerNickname.focus();
  } else {
    addServerAddress.focus();
  }
}

/** Closes the Add Server modal. */
function closeAddServerModal() {
  modalAddServer.classList.add('hidden');
}

/** Validates inputs, connects to the server, and saves it to the list. */
async function handleAddServer() {
  let address = addServerAddress.value.trim();
  const nickname = addServerNickname.value.trim();
  const password = addServerPassword.value;

  if (!address) {
    addServerError.textContent = 'Server address is required.';
    return;
  }
  if (!address.startsWith('ws://') && !address.startsWith('wss://')) {
    const hostPart = address.startsWith('[') ? address.slice(address.indexOf(']') + 1) : address;
    if (!hostPart.includes(':')) {
      address += ':6833';
    }
  }
  if (!nickname) {
    addServerError.textContent = 'Nickname is required.';
    return;
  }

  addServerError.textContent = '';
  btnConfirmAddServer.disabled = true;
  btnConfirmAddServer.textContent = 'Adding...';

  const activeIdentity = await getActiveIdentity();

  const server = {
    name: address,
    address,
    nickname,
    password: password || null,
  };

  try {
    const publicKey = activeIdentity?.public_key || undefined;
    const key = connKey(address);
    const data = await connectionManager.connect(key, address, nickname, password || undefined, publicKey);

    server.name = data.serverName || address;

    await window.gimodi.db.addServer(server);
    addOrUpdateServer(server);

    await saveToHistory(address, nickname, password, data.serverName);

    closeAddServerModal();
    data._connKey = key;
    renderSidebar();
    window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: data }));
  } catch (err) {
    addServerError.textContent = err.message || 'Connection failed.';
  } finally {
    btnConfirmAddServer.disabled = false;
    btnConfirmAddServer.textContent = 'Add Server';
  }
}

/**
 * @param {Object} server
 * @param {boolean} isConnected
 */
function openEditServerModal(server, isConnected) {
  editingServer = server;
  editingServerWasConnected = isConnected;
  editServerAddress.value = server.address || '';
  editServerNickname.value = server.nickname || '';
  editServerPassword.value = server.password || '';
  editServerError.textContent = '';
  modalEditServer.classList.remove('hidden');
  editServerAddress.focus();
}

/** Closes the Edit Server modal. */
function closeEditServerModal() {
  modalEditServer.classList.add('hidden');
  editingServer = null;
}

/** Saves edited server settings and reconnects if needed. */
async function handleEditServer() {
  let address = editServerAddress.value.trim();
  const nickname = editServerNickname.value.trim();
  const password = editServerPassword.value;

  if (!address) {
    editServerError.textContent = 'Server address is required.';
    return;
  }
  if (!address.startsWith('ws://') && !address.startsWith('wss://')) {
    const hostPart = address.startsWith('[') ? address.slice(address.indexOf(']') + 1) : address;
    if (!hostPart.includes(':')) {
      address += ':6833';
    }
  }
  if (!nickname) {
    editServerError.textContent = 'Nickname is required.';
    return;
  }

  const oldAddress = editingServer.address;
  const oldNickname = editingServer.nickname;
  const wasConnected = editingServerWasConnected;

  const oldKey = connKey(oldAddress);
  if (wasConnected || connectionManager.getStatus(oldKey) === 'reconnecting') {
    const oldConn = connectionManager.getConnection(oldKey);
    if (oldConn) {
      oldConn.stopReconnect();
    }
    window.dispatchEvent(
      new CustomEvent('gimodi:disconnect-server', {
        detail: { connKey: oldKey },
      }),
    );
  }

  const updatedServer = {
    name: editingServer.name,
    address,
    nickname,
    password: password || null,
  };

  const matchesOld = (s) => s.address === oldAddress && s.nickname === oldNickname;
  replaceServerInPlace(oldAddress, oldNickname, null, updatedServer);
  const items = await window.gimodi.db.listServersGrouped();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === 'group') {
      const idx = item.servers.findIndex(matchesOld);
      if (idx >= 0) {
        item.servers[idx] = updatedServer;
        break;
      }
    } else if (matchesOld(item)) {
      items[i] = updatedServer;
      break;
    }
  }
  await window.gimodi.db.saveServersGrouped(items);

  closeEditServerModal();
  renderSidebar();

  if (wasConnected) {
    connectToServer(updatedServer);
  }
}

/**
 * @param {Object} server
 * @param {Object} [options]
 * @param {boolean} [options.autoJoin=false]
 */
async function connectToServer(server, { autoJoin = false } = {}) {
  const key = connKey(server.address);
  if (connectionManager.isConnected(key)) {
    window.dispatchEvent(
      new CustomEvent('gimodi:switch-server', {
        detail: { connKey: key },
      }),
    );
    return;
  }

  const activeIdentity = await getActiveIdentity();
  const publicKey = activeIdentity?.public_key || undefined;

  try {
    const data = await connectionManager.connect(key, server.address, server.nickname, server.password || undefined, publicKey);

    if (data.serverName && data.serverName !== server.name) {
      server.name = data.serverName;
      await window.gimodi.db.addServer(server);
      updateServerInList(server);
    }

    await saveToHistory(server.address, server.nickname, server.password, data.serverName);

    data._connKey = key;
    window.dispatchEvent(new CustomEvent('gimodi:connected', { detail: { ...data, autoJoin } }));
  } catch (err) {
    console.error('[connect] Failed to connect:', err.message);
    showConnectError(err.message || 'Connection failed.');
  }
}

/**
 * @param {string} address
 * @param {string} nickname
 * @param {string} password
 * @param {string} serverName
 */
async function saveToHistory(address, nickname, password, serverName) {
  const raw = await window.gimodi.db.getAppSetting('connectHistory');
  const history = raw ? JSON.parse(raw) : [];
  const existing = history.findIndex((b) => b.address === address && b.nickname === nickname);
  if (existing >= 0) {
    history[existing].name = serverName || address;
    history[existing].password = password || null;
  } else {
    history.push({
      name: serverName || address,
      address,
      nickname,
      password: password || null,
    });
  }
  await window.gimodi.db.setAppSetting('connectHistory', JSON.stringify(history));
}

/** @param {string} message */
function showConnectError(message) {
  connectErrorMessage.textContent = message;
  modalConnectError.classList.remove('hidden');
}
