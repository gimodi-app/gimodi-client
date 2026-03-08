const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, shell, Notification, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const identity = require('./identity');
const venmic = require('./venmic');

const iconCacheDir = path.join(app.getPath('userData'), 'icon-cache');

// --- Auto-Updater ---

const GRS_URL = 'https://releases.gimodi.com';
let updateChannel = 'stable';

if (require('electron-squirrel-startup')) app.quit();

function getPlatformKey() {
  switch (process.platform) {
    case 'win32': return 'win';
    case 'darwin': return 'darwin';
    default: return 'linux';
  }
}

function getInstallType() {
  const { execSync } = require('child_process');
  const exe = process.execPath;

  if (process.platform === 'win32') {
    // Squirrel installs have Update.exe in the parent directory
    const updateExe = path.join(path.dirname(exe), '..', 'Update.exe');
    if (fs.existsSync(updateExe)) return 'squirrel';
    return 'zip';
  }

  if (process.platform === 'darwin') {
    return 'zip';
  }

  // Linux
  // AppImage sets APPIMAGE env var pointing to the mounted image path
  if (process.env.APPIMAGE) return 'appimage';

  // Check if installed via dpkg (deb package)
  if (exe.startsWith('/usr/') || exe.startsWith('/opt/')) {
    try {
      execSync(`dpkg -S "${exe}" 2>/dev/null`, { stdio: 'pipe' });
      return 'deb';
    } catch {}
  }

  return 'zip';
}

const installType = getInstallType();

async function checkForUpdates(manual = false) {
  const platform = getPlatformKey();
  const url = `${GRS_URL}/v2/releases/${platform}/${updateChannel}/latest`;
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const showDialog = (opts) => win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
  try {
    const { net } = require('electron');
    const response = await net.fetch(url);
    if (!response.ok) {
      if (manual) showDialog({ type: 'error', title: 'Update Check', message: 'Failed to check for updates.' });
      return;
    }
    const data = await response.json();
    if (data.version && data.version !== app.getVersion()) {
      // Check if our install format is available
      if (!data.formats || !data.formats.includes(installType)) {
        if (manual) showDialog({ type: 'info', title: 'Update Available', message: `Version ${data.version} is available, but no ${installType} package is provided yet.` });
        return;
      }
      const result = await showDialog({
        type: 'info',
        title: 'Update Available',
        message: `Version ${data.version} is available! (current: v${app.getVersion()})`,
        buttons: ['Download & Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) {
        sendToMain('update:download-start', data.version);
      }
    } else if (manual) {
      showDialog({ type: 'info', title: 'Update Check', message: `You're up to date! (v${app.getVersion()})` });
    }
  } catch (err) {
    console.error('Update check failed:', err);
    if (manual) showDialog({ type: 'error', title: 'Update Check', message: 'Failed to check for updates.' });
  }
}

let updateDownloadAbort = null;

ipcMain.handle('update:download', async (event, version) => {
  const platform = getPlatformKey();
  const url = `${GRS_URL}/v2/releases/${platform}/${updateChannel}/download/${version}/${installType}`;
  console.log(`[update] Starting download: ${url}`);
  console.log(`[update] Install type: ${installType}, platform: ${platform}, channel: ${updateChannel}`);
  const abortController = new AbortController();
  updateDownloadAbort = abortController;
  try {
    sendToMain('update:status', 'Downloading...');
    const { net } = require('electron');
    const response = await net.fetch(url, { signal: abortController.signal });
    if (!response.ok) {
      console.error(`[update] Download failed: HTTP ${response.status}`);
      sendToMain('update:status', 'Download failed.');
      return;
    }

    // Determine filename from content-disposition or fallback
    const disposition = response.headers.get('content-disposition') || '';
    let filename = `gimodi-update-${version}`;
    const match = disposition.match(/filename="?(.+?)"?$/i);
    if (match) {
      filename = match[1];
    } else {
      const extMap = { squirrel: '.exe', deb: '.deb', appimage: '.AppImage', zip: '.zip' };
      filename += extMap[installType] || '';
    }

    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, filename);
    console.log(`[update] Saving to: ${filePath}`);

    const total = parseInt(response.headers.get('content-length'), 10) || 0;
    const writer = fs.createWriteStream(filePath);
    let received = 0;

    for await (const chunk of response.body) {
      if (abortController.signal.aborted) {
        writer.destroy();
        try { fs.unlinkSync(filePath); } catch {}
        return;
      }
      received += chunk.length;
      writer.write(chunk);
      if (total > 0) {
        const percent = Math.round((received / total) * 100);
        sendToMain('update:download-progress', { received, total, percent });
      }
    }
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      writer.end();
    });

    console.log(`[update] Download complete: ${received} bytes`);

    if (installType === 'appimage' && process.env.APPIMAGE) {
      // Replace the running AppImage with the downloaded one and relaunch
      sendToMain('update:status', 'Updating AppImage...');
      const appImagePath = process.env.APPIMAGE;
      console.log(`[update] Replacing AppImage: ${appImagePath}`);
      // Linux allows unlinking an open file — remove first, then move the new one into place
      try { fs.unlinkSync(appImagePath); } catch (e) { console.log(`[update] Unlink old AppImage: ${e.message}`); }
      // renameSync fails across filesystems (e.g. /tmp → /home), so fall back to copy+delete
      try {
        fs.renameSync(filePath, appImagePath);
        console.log('[update] Renamed temp file to AppImage path');
      } catch (e) {
        console.log(`[update] Rename failed (${e.message}), falling back to copy`);
        fs.copyFileSync(filePath, appImagePath);
        fs.unlinkSync(filePath);
      }
      fs.chmodSync(appImagePath, 0o755);
      // Relaunch from the updated AppImage
      console.log('[update] Relaunching AppImage...');
      const { spawn } = require('child_process');
      spawn(appImagePath, [], { detached: true, stdio: 'ignore' }).unref();
      app.isQuitting = true;
      app.quit();
    } else if (installType === 'zip') {
      // Just show the downloaded file in the file manager
      sendToMain('update:status', 'Opening download...');
      shell.showItemInFolder(filePath);
    } else {
      sendToMain('update:status', 'Opening installer...');
      await shell.openPath(filePath);
      app.isQuitting = true;
      app.quit();
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[update] Download cancelled by user');
      return;
    }
    console.error('[update] Download error:', err);
    sendToMain('update:status', 'Download failed.');
  } finally {
    updateDownloadAbort = null;
  }
});

ipcMain.handle('update:cancel', () => {
  if (updateDownloadAbort) {
    updateDownloadAbort.abort();
    updateDownloadAbort = null;
    sendToMain('update:status', 'Download cancelled.');
  }
});

// Accept self-signed certificates (needed for self-hosted servers with auto-generated certs)
app.commandLine.appendSwitch('ignore-certificate-errors');

// Enable PipeWire screen capture on Linux (Wayland support)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

let mainWindow;
let tray = null;

const historyPath = path.join(app.getPath('userData'), 'history.json');
const serversPath = path.join(app.getPath('userData'), 'servers.json');

// Migrate legacy bookmarks.json → history.json
const legacyBookmarksPath = path.join(app.getPath('userData'), 'bookmarks.json');
if (!fs.existsSync(historyPath) && fs.existsSync(legacyBookmarksPath)) {
  fs.renameSync(legacyBookmarksPath, historyPath);
}
// Migrate history.json → servers.json on first run
if (!fs.existsSync(serversPath) && fs.existsSync(historyPath)) {
  try {
    const historyData = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    if (Array.isArray(historyData)) {
      fs.writeFileSync(serversPath, JSON.stringify(historyData, null, 2));
    }
  } catch { /* ignore migration errors */ }
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Gimodi',
    backgroundColor: '#111111',
    icon: path.join(__dirname, '..', '..', 'assets', 'logo.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Accept invalid/self-signed certificates for downloads and requests
  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    callback(0); // 0 = accept
  });

  // Prevent navigation away from the app (e.g. clicking download links)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appUrl = `file://${path.join(__dirname, '..', 'renderer', 'index.html')}`;
    if (!url.startsWith(appUrl)) e.preventDefault();
  });

  // Intercept getDisplayMedia calls from the renderer to show our own source picker
  let pendingScreenShareResolve = null;

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Ask the renderer to show the source picker
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    const serialized = sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
    }));

    sendToMain('screen:show-picker', serialized);

    // Wait for the renderer to respond with the user's choice
    const choice = await new Promise((resolve) => {
      pendingScreenShareResolve = resolve;
    });
    pendingScreenShareResolve = null;

    if (!choice || !choice.sourceId) {
      callback({});
      return;
    }

    const selected = sources.find(s => s.id === choice.sourceId);
    if (!selected) {
      callback({});
      return;
    }

    const streams = { video: selected };

    // On Windows, use native loopback audio capture
    if (choice.withAudio && process.platform === 'win32') {
      streams.audio = 'loopback';
    }

    callback(streams);
  });

  ipcMain.on('screen:source-selected', (_, choice) => {
    if (pendingScreenShareResolve) {
      pendingScreenShareResolve(choice);
    }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

let lastAdminStatus = false;
let lastConnected = false;
let lastDevMode = false;

function loadSettingsSync() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}


function buildMenu(isAdmin, connected) {
  lastAdminStatus = isAdmin;
  lastConnected = connected;

  // Remove native menu
  Menu.setApplicationMenu(null);

  const hamburgerItems = [
    { action: 'open-unified-settings', label: 'Settings...' },
    { type: 'separator' },
    ...(connected ? [
      { action: 'redeem-token', label: 'Redeem Server Token...' },
      { action: 'disconnect', label: 'Disconnect' },
      { type: 'separator' },
    ] : []),
    { action: 'quit', label: 'Quit' },
    ...(lastDevMode ? [
      { type: 'separator' },
      { action: 'reload', label: 'Reload' },
      { action: 'force-reload', label: 'Force Reload' },
      { action: 'toggle-devtools', label: 'Toggle DevTools' },
    ] : []),
  ];

  const menu = [
    { label: '☰', items: hamburgerItems },
  ];

  sendToMain('menu:update', menu);
}

app.whenReady().then(async () => {
  await identity.ensureDefaultIdentity();

  // Restore saved settings before building the first menu
  const savedSettings = loadSettingsSync();
  if (savedSettings.devMode) lastDevMode = true;
  if (savedSettings.updateChannel) updateChannel = savedSettings.updateChannel;

  const iconFile = process.platform === 'win32' ? 'tray-32x32.ico' : 'tray-32x32.png';
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', iconFile));
  tray = new Tray(icon);
  tray.setToolTip('Gimodi');
  const trayMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Close', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(trayMenu);
  const showWindow = () => { mainWindow.show(); mainWindow.focus(); };
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  createWindow();

  // Check for updates once the window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    buildMenu(false, false);
    checkForUpdates();
  });
});

app.on('window-all-closed', () => {
  // Don't quit - stay in tray
});

function sendToMain(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// --- Window Controls (custom titlebar) ---

ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window:close', () => { if (mainWindow) mainWindow.close(); });

// --- Menu Actions (custom titlebar) ---

ipcMain.on('menu:action', (_, action, data) => {
  if (!mainWindow) return;
  switch (action) {
    case 'reload': mainWindow.webContents.reload(); break;
    case 'force-reload': mainWindow.webContents.reloadIgnoringCache(); break;
    case 'toggle-devtools': mainWindow.webContents.toggleDevTools(); break;
    case 'open-unified-settings': sendToMain('menu:open-unified-settings'); break;
    case 'check-updates': checkForUpdates(true).catch(() => {}); break;
    case 'disconnect': sendToMain('menu:disconnect'); break;
    case 'quit': app.isQuitting = true; app.quit(); break;
    case 'redeem-token': sendToMain('menu:redeem-token'); break;
    case 'admin:list-users': sendToMain('server-admin:list-users'); break;
    case 'admin:manage-bans': sendToMain('server-admin:manage-bans'); break;
    case 'admin:manage-tokens': sendToMain('server-admin:manage-tokens'); break;
    case 'admin:manage-roles': sendToMain('server-admin:manage-roles'); break;
    case 'admin:server-settings': sendToMain('server-admin:server-settings'); break;
    case 'admin:audit-log': sendToMain('server-admin:audit-log'); break;
    default:
      if (action.startsWith('history:')) {
        sendToMain('menu:connect-server', data);
      }
      break;
  }
});

// Dev mode toggle - rebuild menu to show/hide reload/devtools items
ipcMain.handle('settings:set-dev-mode', (_, enabled) => {
  lastDevMode = !!enabled;
  buildMenu(lastAdminStatus, lastConnected);
});

ipcMain.handle('settings:set-update-channel', (_, channel) => {
  const valid = ['stable', 'beta', 'nightly'];
  if (valid.includes(channel)) updateChannel = channel;
});

// --- Identity Manager Window ---

let identityManagerWindow = null;

function openIdentityManager() {
  if (identityManagerWindow && !identityManagerWindow.isDestroyed()) {
    identityManagerWindow.focus();
    return;
  }
  identityManagerWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, '..', 'identity-manager-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Manage Identities',
    backgroundColor: '#111111',
    autoHideMenuBar: true,
  });
  identityManagerWindow.setMenuBarVisibility(false);
  identityManagerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'identity-manager.html'));
  identityManagerWindow.on('closed', () => {
    identityManagerWindow = null;
  });
}

// --- IPC Handlers ---

// Admin status - rebuild menu when admin state changes
ipcMain.handle('set-admin-status', (event, isAdmin, connected) => {
  buildMenu(!!isAdmin, connected !== undefined ? !!connected : true);
});

// Recently Joined history
ipcMain.handle('history:load', () => {
  try {
    const data = fs.readFileSync(historyPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
});

ipcMain.handle('history:save', (event, history) => {
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
});

// Server list (persistent sidebar)
ipcMain.handle('servers:list', () => {
  try {
    const data = fs.readFileSync(serversPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
});

ipcMain.handle('servers:add', (event, server) => {
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(serversPath, 'utf-8'));
  } catch { /* empty */ }
  let found = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === 'group') {
      const idx = item.servers.findIndex(s => s.address === server.address && s.nickname === server.nickname);
      if (idx >= 0) {
        item.servers[idx] = { ...item.servers[idx], ...server };
        found = true;
        break;
      }
    } else if (item.address === server.address && item.nickname === server.nickname) {
      items[i] = { ...items[i], ...server };
      found = true;
      break;
    }
  }
  if (!found) items.push(server);
  fs.writeFileSync(serversPath, JSON.stringify(items, null, 2));
  return items;
});

ipcMain.handle('servers:reorder', (event, fromIndex, toIndex) => {
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(serversPath, 'utf-8'));
  } catch { /* empty */ }
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return items;
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  fs.writeFileSync(serversPath, JSON.stringify(items, null, 2));
  return items;
});

ipcMain.handle('servers:save', (event, items) => {
  fs.writeFileSync(serversPath, JSON.stringify(items, null, 2));
});

ipcMain.handle('servers:remove', (event, address, nickname) => {
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(serversPath, 'utf-8'));
  } catch { /* empty */ }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === 'group') {
      item.servers = item.servers.filter(s => !(s.address === address && s.nickname === nickname));
      if (item.servers.length === 0) items.splice(i, 1);
      else if (item.servers.length === 1) items[i] = item.servers[0];
    } else if (item.address === address && item.nickname === nickname) {
      items.splice(i, 1);
    }
  }
  fs.writeFileSync(serversPath, JSON.stringify(items, null, 2));
  return items;
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// Settings
ipcMain.handle('settings:load', () => {
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
});

ipcMain.handle('settings:save', (event, settings) => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
});

// Identities
ipcMain.handle('identity:load-all', () => identity.loadIdentities());
ipcMain.handle('identity:create', (event, name) => identity.createIdentity(name));
ipcMain.handle('identity:delete', (event, fingerprint) => identity.deleteIdentity(fingerprint));
ipcMain.handle('identity:set-default', (event, fingerprint) => identity.setDefaultIdentity(fingerprint));
ipcMain.handle('identity:get-default', () => identity.getDefaultIdentity());
ipcMain.handle('identity:encrypt', (event, recipientPublicKeys, plaintext) =>
  identity.encryptMessage(recipientPublicKeys, plaintext));
ipcMain.handle('identity:decrypt', (event, armoredMessage) =>
  identity.decryptMessage(armoredMessage));

ipcMain.handle('identity:export', async (event, fingerprint) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const data = identity.exportIdentity(fingerprint);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Identity',
    defaultPath: `${data.name.replace(/[^a-z0-9_-]/gi, '_')}.gimodi-identity`,
    filters: [{ name: 'Gimodi Identity', extensions: ['gimodi-identity'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return { canceled: false, filePath };
});

ipcMain.handle('identity:import', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Identity',
    filters: [{ name: 'Gimodi Identity', extensions: ['gimodi-identity'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
  const imported = await identity.importIdentity(raw);
  return { canceled: false, identity: imported };
});

// Open external URLs in system browser
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

// Download a file via Electron's built-in download manager
ipcMain.handle('download-file', (event, url, filename) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || typeof url !== 'string') return;
  win.webContents.session.once('will-download', (e, item) => {
    if (filename) item.setSavePath(''); // triggers save dialog
    item.setSaveDialogOptions({ defaultPath: filename || undefined });
  });
  win.webContents.downloadURL(url);
});

// --- Webcam Popout ---

let wcPopoutWindow = null;

ipcMain.handle('wcpopout:open', () => {
  if (wcPopoutWindow && !wcPopoutWindow.isDestroyed()) {
    wcPopoutWindow.focus();
    return;
  }
  wcPopoutWindow = new BrowserWindow({
    width: 640,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, '..', 'webcam-popout-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Webcam',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
  });
  wcPopoutWindow.setMenuBarVisibility(false);
  wcPopoutWindow.loadFile(path.join(__dirname, '..', 'renderer', 'webcam-popout.html'));
  wcPopoutWindow.on('closed', () => {
    wcPopoutWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wcpopout:closed');
    }
  });
});

ipcMain.on('wcpopout:close', () => {
  if (wcPopoutWindow && !wcPopoutWindow.isDestroyed()) wcPopoutWindow.close();
});

ipcMain.on('wcpopout:to-popout', (_, data) => {
  if (wcPopoutWindow && !wcPopoutWindow.isDestroyed()) {
    wcPopoutWindow.webContents.send('wcpopout:from-main', data);
  }
});

ipcMain.on('wcpopout:to-main', (_, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wcpopout:from-popout', data);
  }
});

ipcMain.on('wcpopout:ready', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wcpopout:from-popout', { type: 'ready' });
  }
});

// --- Screen Share Popout ---

let popoutWindow = null;

ipcMain.handle('popout:open', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.focus();
    return;
  }
  popoutWindow = new BrowserWindow({
    width: 960,
    height: 540,
    webPreferences: {
      preload: path.join(__dirname, '..', 'popout-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Screen Share',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
  });
  popoutWindow.setMenuBarVisibility(false);
  popoutWindow.loadFile(path.join(__dirname, '..', 'renderer', 'popout.html'));
  popoutWindow.on('closed', () => {
    popoutWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('popout:closed');
    }
  });
});

ipcMain.on('popout:close', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) popoutWindow.close();
});

ipcMain.on('popout:to-popout', (_, data) => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.webContents.send('popout:from-main', data);
  }
});

ipcMain.on('popout:to-main', (_, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('popout:from-popout', data);
  }
});

ipcMain.on('popout:ready', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('popout:from-popout', { type: 'ready' });
  }
});

// --- Screen Share / Venmic ---

ipcMain.handle('screen:get-platform', () => process.platform);

/**
 * Get the Chromium "Audio Service" process PID.
 * This is the process that actually outputs audio via PipeWire/PulseAudio.
 * Excluding this PID from venmic capture prevents voice chat echo.
 * (Equibop uses the same approach.)
 */
function getAudioServicePid() {
  const metrics = app.getAppMetrics();
  const audioService = metrics.find(proc => proc.name === 'Audio Service');
  return audioService?.pid?.toString() ?? '';
}

ipcMain.handle('venmic:is-available', () => venmic.isAvailable());

ipcMain.handle('venmic:list', () => {
  const audioPid = getAudioServicePid();
  const nodes = venmic.list();
  // Filter out our own audio output from the list (same as Equibop)
  return nodes.filter(n => n['application.process.id'] !== audioPid);
});

ipcMain.handle('venmic:start', (_, include, exclude) => {
  const pid = getAudioServicePid();
  return venmic.start(include || [], exclude || [], pid);
});

ipcMain.handle('venmic:start-system', (_, exclude) => {
  const pid = getAudioServicePid();
  return venmic.startSystem(exclude || [], pid);
});

ipcMain.handle('venmic:stop', () => venmic.stop());

// Desktop notifications
ipcMain.handle('show-notification', (event, options) => {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: options.title || 'Gimodi',
    body: options.body || '',
    silent: options.silent || false,
  });

  notification.on('click', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();

      // Send event to renderer to navigate to the relevant channel/DM
      if (options.action) {
        mainWindow.webContents.send('notification:clicked', options.action);
      }
    }
  });

  notification.show();
});

// --- Icon Cache ---

ipcMain.handle('icon-cache:get', (event, address, hash) => {
  const addrHash = crypto.createHash('sha256').update(address).digest('hex');
  const filename = `${addrHash}-${hash}`;
  const filePath = path.join(iconCacheDir, filename);
  if (fs.existsSync(filePath)) return filePath;
  return null;
});

ipcMain.handle('icon-cache:health', async (event, address) => {
  try {
    const { net } = require('electron');
    const resp = await net.fetch(`https://${address}/health`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
});

ipcMain.handle('icon-cache:fetch', async (event, address) => {
  try {
    const { net } = require('electron');
    const resp = await net.fetch(`https://${address}/icon`);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  }
});

ipcMain.handle('icon-cache:upload', async (event, address, clientId, contentType, arrayBuffer) => {
  try {
    const { net } = require('electron');
    const resp = await net.fetch(`https://${address}/icon`, {
      method: 'POST',
      headers: { 'X-Client-Id': clientId, 'Content-Type': contentType },
      body: Buffer.from(arrayBuffer),
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('icon-cache:delete', async (event, address, clientId) => {
  try {
    const { net } = require('electron');
    const resp = await net.fetch(`https://${address}/icon`, {
      method: 'DELETE',
      headers: { 'X-Client-Id': clientId },
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('icon-cache:save', (event, address, hash, arrayBuffer) => {
  fs.mkdirSync(iconCacheDir, { recursive: true });
  const addrHash = crypto.createHash('sha256').update(address).digest('hex');
  const filename = `${addrHash}-${hash}`;
  const filePath = path.join(iconCacheDir, filename);

  // Delete old entries for the same address
  try {
    const prefix = `${addrHash}-`;
    for (const f of fs.readdirSync(iconCacheDir)) {
      if (f.startsWith(prefix) && f !== filename) {
        fs.unlinkSync(path.join(iconCacheDir, f));
      }
    }
  } catch {}

  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return filePath;
});
