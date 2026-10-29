const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  shell,
  Notification,
  desktopCapturer,
  session,
  utilityProcess,
  MessageChannelMain,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const identity = require('./identity');
const venmic = require('./venmic');
const screenAudioLog = require('./screen-audio-log');
const { createController: createScreencastController } = require('./screencast');
const updater = require('./updater');

// Database modules
const database = require('./db/database');
const appSettingsRepo = require('./db/app-settings-repo');
const dbIpc = require('./db/ipc');
const migrateJson = require('./db/migrate-json');

const iconCacheDir = path.join(app.getPath('userData'), 'icon-cache');

// --- Auto-Updater ---

updater.init({ getMainWindow: () => mainWindow, sendToMain });
updater.registerIpcHandlers();

if (require('electron-squirrel-startup')) {
  app.quit();
}

// --- Custom Protocol (gimodi://) ---

const PROTOCOL = 'gimodi';

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

/**
 * Parses a gimodi:// URL and returns server connection params.
 * Supported format: gimodi://add-server?host=<host>&port=<port>&nickname=<nick>&password=<pw>
 * @param {string} rawUrl
 * @returns {{ address: string, nickname?: string, password?: string } | null}
 */
function parseProtocolUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${PROTOCOL}:`) {
      return null;
    }
    if (url.hostname !== 'add-server') {
      return null;
    }

    const host = url.searchParams.get('host');
    if (!host) {
      return null;
    }

    const port = url.searchParams.get('port');
    const address = port ? `${host}:${port}` : host;

    const result = { address };
    const nickname = url.searchParams.get('nickname');
    if (nickname) {
      result.nickname = nickname;
    }
    const password = url.searchParams.get('password');
    if (password) {
      result.password = password;
    }

    return result;
  } catch {
    return null;
  }
}

let pendingProtocolUrl = null;

/**
 * Sends a parsed protocol URL to the renderer, or queues it if the window isn't ready.
 * @param {string} rawUrl
 */
function handleProtocolUrl(rawUrl) {
  const parsed = parseProtocolUrl(rawUrl);
  if (!parsed) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('protocol:add-server', parsed);
  } else {
    pendingProtocolUrl = parsed;
  }
}

// Single instance lock — on second launch, focus existing window and handle URL
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
    // On Windows/Linux, the protocol URL is passed as the last argument
    const protocolArg = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (protocolArg) {
      handleProtocolUrl(protocolArg);
    }
  });
}

// macOS: handle protocol URL when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

// Accept self-signed certificates (needed for self-hosted servers with auto-generated certs)
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow;
let tray = null;


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

  // Fix Referer for YouTube embeds so they don't reject with error 153
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] }, (details, callback) => {
    details.requestHeaders['Referer'] = 'https://www.youtube-nocookie.com/';
    callback({ requestHeaders: details.requestHeaders });
  });

  // Prevent navigation away from the app (e.g. clicking download links)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appUrl = `file://${path.join(__dirname, '..', 'renderer', 'index.html')}`;
    if (!url.startsWith(appUrl)) {
      e.preventDefault();
    }
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

    const serialized = sources.map((s) => ({
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

    const selected = sources.find((s) => s.id === choice.sourceId);
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
let trayDefault = null;
let trayOnline = null;
let voiceActive = false;
let voiceMuted = false;
let voiceDeafened = false;
let notificationMode = 'mentions';

/**
 * @description Rebuilds the system tray context menu based on current voice state
 */
function rebuildTrayMenu() {
  if (!tray) {
    return;
  }
  const items = [
    {
      label: 'Open',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
  ];
  if (voiceActive) {
    items.push({
      label: voiceMuted || voiceDeafened ? 'Unmute' : 'Mute',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray:toggle-mute');
        }
      },
    });
    items.push({
      label: voiceDeafened ? 'Undeafen' : 'Deafen',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray:toggle-deafen');
        }
      },
    });
    items.push({ type: 'separator' });
    items.push({
      label: 'Leave Voice',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray:disconnect');
        }
      },
    });
  }
  items.push({ type: 'separator' });
  const notifModes = [
    { value: 'all', label: 'All messages' },
    { value: 'mentions', label: 'Mentions and DMs only' },
    { value: 'dms', label: 'DMs only' },
    { value: 'none', label: 'Disabled' },
  ];
  items.push({
    label: 'Notifications',
    type: 'submenu',
    submenu: notifModes.map((m) => ({
      label: m.label,
      type: 'radio',
      checked: notificationMode === m.value,
      click: () => {
        notificationMode = m.value;
        appSettingsRepo.setAppSetting('notificationMode', m.value);
        rebuildTrayMenu();
        if (mainWindow) {
          mainWindow.webContents.send('notification-mode:changed', m.value);
        }
      },
    })),
  });
  items.push({ type: 'separator' });
  items.push({
    label: 'Close',
    click: () => {
      app.isQuitting = true;
      app.quit();
    },
  });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}


function buildMenu(isAdmin, connected) {
  lastAdminStatus = isAdmin;
  lastConnected = connected;

  // Remove native menu
  Menu.setApplicationMenu(null);

  const hamburgerItems = [
    { action: 'open-unified-settings', label: 'Settings...' },
    { type: 'separator' },
    ...(connected ? [{ action: 'redeem-token', label: 'Redeem Server Token...' }, { type: 'separator' }] : []),
    { action: 'quit', label: 'Quit' },
    ...(lastDevMode ? [{ type: 'separator' }, { action: 'reload', label: 'Reload' }, { action: 'force-reload', label: 'Force Reload' }, { action: 'toggle-devtools', label: 'Toggle DevTools' }] : []),
  ];

  const menu = [{ label: '☰', items: hamburgerItems }];

  sendToMain('menu:update', menu);
}

app.whenReady().then(async () => {
  // Initialize database
  try {
    database.openAppDb();
    identity.setAppSettingsRepo(appSettingsRepo);

    // Migrate legacy JSON files to SQLite on first run
    await migrateJson.migrateJsonFiles();

    // Ensure at least one identity exists
    const identities = appSettingsRepo.listIdentities();
    if (identities.length === 0) {
      await identity.createIdentity('Default');
    }

    // Auto-login to last active identity
    const activeIdentityFp = appSettingsRepo.getAppSetting('activeIdentity');
    if (activeIdentityFp && appSettingsRepo.getIdentity(activeIdentityFp)) {
      database.switchIdentity(activeIdentityFp);
    } else {
      const defaultIdent = appSettingsRepo.listIdentities()[0];
      if (defaultIdent) {
        database.switchIdentity(defaultIdent.fingerprint);
      }
    }

    // Register new db:* IPC handlers
    dbIpc.registerIpcHandlers(sendToMain);
  } catch (err) {
    console.error('[db] Failed to initialize database:', err.stack || err);
  }

  // Handle protocol URL from cold start (Windows/Linux pass it as argv)
  const launchUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (launchUrl) {
    pendingProtocolUrl = parseProtocolUrl(launchUrl);
  }

  // Restore saved settings from database
  const devModeSetting = appSettingsRepo.getAppSetting('devMode');
  if (devModeSetting === '1') {
    lastDevMode = true;
  }
  const updateChannelSetting = appSettingsRepo.getAppSetting('updateChannel');
  if (updateChannelSetting) {
    updater.setUpdateChannel(updateChannelSetting);
  }
  const updateNotifSetting = appSettingsRepo.getAppSetting('updateNotifications');
  if (updateNotifSetting === '0') {
    updater.setUpdateNotifications(false);
  }
  const notifModeSetting = appSettingsRepo.getAppSetting('notificationMode');
  if (notifModeSetting) {
    notificationMode = notifModeSetting;
  }

  const trayExt = process.platform === 'win32' ? 'ico' : 'png';
  trayDefault = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', `tray-32x32.${trayExt}`));
  trayOnline = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', `tray-online-32x32.${trayExt}`));
  tray = new Tray(trayDefault);
  tray.setToolTip('Gimodi');
  rebuildTrayMenu();
  const showWindow = () => {
    mainWindow.show();
    mainWindow.focus();
  };
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  createWindow();

  // Check for updates once the window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    buildMenu(false, false);
    if (updater.getUpdateNotifications()) {updater.checkForUpdates();}

    // Flush any protocol URL received before the window was ready
    if (pendingProtocolUrl) {
      mainWindow.webContents.send('protocol:add-server', pendingProtocolUrl);
      pendingProtocolUrl = null;
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit - stay in tray
});

app.on('will-quit', () => {
  database.closeAll();
});

function sendToMain(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// --- Window Controls (custom titlebar) ---

ipcMain.on('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});
ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

// --- Menu Actions (custom titlebar) ---

ipcMain.on('menu:action', (_, action, data) => {
  if (!mainWindow) {
    return;
  }
  switch (action) {
    case 'reload':
      mainWindow.webContents.reload();
      break;
    case 'force-reload':
      mainWindow.webContents.reloadIgnoringCache();
      break;
    case 'toggle-devtools':
      mainWindow.webContents.toggleDevTools();
      break;
    case 'open-unified-settings':
      sendToMain('menu:open-unified-settings');
      break;
    case 'check-updates':
      updater.checkForUpdates(true).catch(() => {});
      break;
    case 'disconnect':
      sendToMain('menu:disconnect');
      break;
    case 'quit':
      app.isQuitting = true;
      app.quit();
      break;
    case 'redeem-token':
      sendToMain('menu:redeem-token');
      break;
    case 'admin:list-users':
      sendToMain('server-admin:list-users');
      break;
    case 'admin:manage-bans':
      sendToMain('server-admin:manage-bans');
      break;
    case 'admin:manage-tokens':
      sendToMain('server-admin:manage-tokens');
      break;
    case 'admin:manage-roles':
      sendToMain('server-admin:manage-roles');
      break;
    case 'admin:server-settings':
      sendToMain('server-admin:server-settings');
      break;
    case 'admin:audit-log':
      sendToMain('server-admin:audit-log');
      break;
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
  appSettingsRepo.setAppSetting('devMode', enabled ? '1' : '0');
  buildMenu(lastAdminStatus, lastConnected);
});

ipcMain.handle('settings:set-update-channel', (_, channel) => {
  if (updater.setUpdateChannel(channel)) {
    appSettingsRepo.setAppSetting('updateChannel', channel);
  }
});

ipcMain.handle('settings:set-update-notifications', (_, enabled) => {
  updater.setUpdateNotifications(enabled);
  appSettingsRepo.setAppSetting('updateNotifications', enabled ? '1' : '0');
});

// --- IPC Handlers ---

// Admin status - rebuild menu when admin state changes
ipcMain.handle('set-admin-status', (event, isAdmin, connected) => {
  buildMenu(!!isAdmin, connected !== undefined ? !!connected : true);
});

// Voice state - swap tray icon when voice is active
ipcMain.handle('set-voice-active', (event, active) => {
  voiceActive = active;
  if (!active) {
    voiceMuted = false;
    voiceDeafened = false;
  }
  if (tray) {
    tray.setImage(active ? trayOnline : trayDefault);
  }
  rebuildTrayMenu();
});

ipcMain.handle('set-voice-mute-state', (event, muted, deafened) => {
  voiceMuted = muted;
  voiceDeafened = deafened;
  rebuildTrayMenu();
});


ipcMain.on('notification-mode:set', (event, mode) => {
  notificationMode = mode;
  appSettingsRepo.setAppSetting('notificationMode', mode);
  rebuildTrayMenu();
});

ipcMain.handle('get-version', () => {
  return app.getVersion();
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
  if (!win || typeof url !== 'string') {
    return;
  }
  win.webContents.session.once('will-download', (e, item) => {
    if (filename) {
      item.setSavePath('');
    } // triggers save dialog
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
  if (wcPopoutWindow && !wcPopoutWindow.isDestroyed()) {
    wcPopoutWindow.close();
  }
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
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.close();
  }
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

const screencast = createScreencastController({
  fork: (modulePath) => utilityProcess.fork(modulePath, [], { serviceName: 'Gimodi Screen Capture' }),
  createChannel: () => new MessageChannelMain(),
  env: process.env,
  platform: process.platform,
  moduleExists: fs.existsSync,
});
screencast.onEnded((reason) => sendToMain('screencast:ended', reason));

ipcMain.handle('screencast:is-supported', () => screencast.isSupported());
ipcMain.handle('screencast:start', (event, options) =>
  screencast.start(event.sender, options).then(
    (info) => ({ ok: true, info }),
    (error) => ({ ok: false, message: error.message }),
  ),
);
ipcMain.handle('screencast:stop', () => screencast.stop());

let lastAudioServicePid = null;

/**
 * Get the Chromium "Audio Service" process PID.
 * This is the process that actually outputs audio via PipeWire/PulseAudio.
 * Excluding this PID from venmic capture prevents voice chat echo.
 * (Equibop uses the same approach.) Logs when the PID changes, which means
 * the audio service was restarted.
 * @returns {string}
 */
function getAudioServicePid() {
  const metrics = app.getAppMetrics();
  const audioService = metrics.find((proc) => proc.name === 'Audio Service');
  const pid = audioService?.pid?.toString() ?? '';
  if (pid !== lastAudioServicePid) {
    screenAudioLog.log('main', 'Audio Service PID changed', { from: lastAudioServicePid, to: pid });
    lastAudioServicePid = pid;
  }
  return pid;
}

let lastGraphReport = '';

/**
 * Inspects the PipeWire graph for the screen share audio and logs the result
 * whenever it differs from the previous inspection.
 * @returns {Promise<{problems: string[], summary?: object, error?: string}>}
 */
async function diagnoseScreenAudio() {
  const result = await venmic.inspectGraph(getAudioServicePid());
  const report = { problems: result.problems ?? [], ...result };
  const serialized = JSON.stringify(report);
  if (serialized !== lastGraphReport) {
    screenAudioLog.log('venmic-graph', report.problems.length ? 'Problems found' : 'Graph changed', report);
    lastGraphReport = serialized;
  }
  return report;
}

ipcMain.handle('venmic:is-available', () => venmic.isAvailable());

ipcMain.handle('venmic:list', () => {
  const audioPid = getAudioServicePid();
  const nodes = venmic.list();
  // Filter out our own audio output from the list (same as Equibop)
  return nodes.filter((n) => n['application.process.id'] !== audioPid);
});

ipcMain.handle('venmic:start', (_, include, exclude) => {
  const pid = getAudioServicePid();
  return venmic.start(include || [], exclude || [], pid);
});

ipcMain.handle('venmic:start-system', (_, exclude) => {
  const pid = getAudioServicePid();
  return venmic.startSystem(exclude || [], pid);
});

ipcMain.handle('venmic:stop', () => {
  lastGraphReport = '';
  venmic.stop();
});

ipcMain.handle('venmic:diagnose', () => diagnoseScreenAudio());

ipcMain.on('screen-audio:log', (_, scope, message, data) => screenAudioLog.log(`renderer:${scope}`, message, data));

app.on('child-process-gone', (_, details) => screenAudioLog.log('main', 'Child process gone', details));

// Desktop notifications
ipcMain.handle('show-notification', (event, options) => {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: options.title || 'Gimodi',
    body: options.body || '',
    silent: options.silent || false,
  });

  notification.on('click', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
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
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
});

ipcMain.handle('icon-cache:health', async (event, address) => {
  try {
    const { net } = require('electron');
    const resp = await net.fetch(`https://${address}/health`);
    if (!resp.ok) {
      return null;
    }
    return await resp.json();
  } catch {
    return null;
  }
});

ipcMain.handle('icon-cache:fetch', async (event, address) => {
  try {
    const { net } = require('electron');
    const resp = await net.fetch(`https://${address}/icon`);
    if (!resp.ok) {
      return null;
    }
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
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
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
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
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
  } catch {
    /* ignored */
  }

  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return filePath;
});
