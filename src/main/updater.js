const { app, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const GRS_URL = 'https://releases.gimodi.com';

let updateChannel = 'stable';
let updateNotifications = true;
let getMainWindow = () => null;
let sendToMainFn = () => {};
let updateDownloadAbort = null;

/**
 * Returns the platform key used for update URL construction.
 * @returns {'win' | 'darwin' | 'linux'}
 */
function getPlatformKey() {
  switch (process.platform) {
    case 'win32':
      return 'win';
    case 'darwin':
      return 'darwin';
    default:
      return 'linux';
  }
}

/**
 * Determines the installation type for the current running instance.
 * Detects squirrel (Windows), appimage, deb, or zip (fallback).
 * @returns {'squirrel' | 'appimage' | 'deb' | 'zip'}
 */
function getInstallType() {
  const { execSync } = require('child_process');
  const exe = process.execPath;

  if (process.platform === 'win32') {
    const updateExe = path.join(path.dirname(exe), '..', 'Update.exe');
    if (fs.existsSync(updateExe)) {
      return 'squirrel';
    }
    return 'zip';
  }

  if (process.platform === 'darwin') {
    return 'zip';
  }

  if (process.env.APPIMAGE) {
    return 'appimage';
  }

  if (exe.startsWith('/usr/') || exe.startsWith('/opt/')) {
    try {
      execSync(`dpkg -S "${exe}" 2>/dev/null`, { stdio: 'pipe' });
      return 'deb';
    } catch {
      /* ignored */
    }
  }

  return 'zip';
}

const installType = getInstallType();

/**
 * Checks for application updates by querying the Gimodi Release Server.
 * If an update is available and the user accepts, triggers the download flow.
 * @param {boolean} [manual=false] - Whether the check was manually triggered (shows dialogs on no-update or error)
 * @returns {Promise<void>}
 */
async function checkForUpdates(manual = false) {
  const platform = getPlatformKey();
  const url = `${GRS_URL}/v2/releases/${platform}/${updateChannel}/latest`;
  const mainWindow = getMainWindow();
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const showDialog = (opts) => (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
  try {
    const { net } = require('electron');
    const response = await net.fetch(url);
    if (!response.ok) {
      if (manual) {
        showDialog({ type: 'error', title: 'Update Check', message: 'Failed to check for updates.' });
      }
      return;
    }
    const data = await response.json();
    if (data.version && data.version !== app.getVersion()) {
      if (!data.formats || !data.formats.includes(installType)) {
        if (manual) {
          showDialog({ type: 'info', title: 'Update Available', message: `Version ${data.version} is available, but no ${installType} package is provided yet.` });
        }
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
        sendToMainFn('update:download-start', data.version);
      }
    } else if (manual) {
      showDialog({ type: 'info', title: 'Update Check', message: `You're up to date! (v${app.getVersion()})` });
    }
  } catch (err) {
    console.error('Update check failed:', err);
    if (manual) {
      showDialog({ type: 'error', title: 'Update Check', message: 'Failed to check for updates.' });
    }
  }
}

/**
 * Handles downloading an update artifact, saving it to a temp directory,
 * and either installing it automatically or showing it in the file manager.
 * @param {string} version - The version string to download
 * @returns {Promise<void>}
 */
async function downloadUpdate(version) {
  const platform = getPlatformKey();
  const url = `${GRS_URL}/v2/releases/${platform}/${updateChannel}/download/${version}/${installType}`;
  console.log(`[update] Starting download: ${url}`);
  console.log(`[update] Install type: ${installType}, platform: ${platform}, channel: ${updateChannel}`);
  const abortController = new AbortController();
  updateDownloadAbort = abortController;
  try {
    sendToMainFn('update:status', 'Downloading...');
    const { net } = require('electron');
    const response = await net.fetch(url, { signal: abortController.signal });
    if (!response.ok) {
      console.error(`[update] Download failed: HTTP ${response.status}`);
      sendToMainFn('update:status', 'Download failed.');
      return;
    }

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
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignored */
        }
        return;
      }
      received += chunk.length;
      writer.write(chunk);
      if (total > 0) {
        const percent = Math.round((received / total) * 100);
        sendToMainFn('update:download-progress', { received, total, percent });
      }
    }
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      writer.end();
    });

    console.log(`[update] Download complete: ${received} bytes`);

    if (installType === 'appimage' && process.env.APPIMAGE) {
      sendToMainFn('update:status', 'Updating AppImage...');
      const appImagePath = process.env.APPIMAGE;
      console.log(`[update] Replacing AppImage: ${appImagePath}`);
      try {
        fs.unlinkSync(appImagePath);
      } catch (e) {
        console.log(`[update] Unlink old AppImage: ${e.message}`);
      }
      try {
        fs.renameSync(filePath, appImagePath);
        console.log('[update] Renamed temp file to AppImage path');
      } catch (e) {
        console.log(`[update] Rename failed (${e.message}), falling back to copy`);
        fs.copyFileSync(filePath, appImagePath);
        fs.unlinkSync(filePath);
      }
      fs.chmodSync(appImagePath, 0o755);
      console.log('[update] Relaunching AppImage...');
      const { spawn } = require('child_process');
      spawn(appImagePath, [], { detached: true, stdio: 'ignore' }).unref();
      app.isQuitting = true;
      app.quit();
    } else if (installType === 'zip') {
      sendToMainFn('update:status', 'Opening download...');
      shell.showItemInFolder(filePath);
    } else {
      sendToMainFn('update:status', 'Opening installer...');
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
    sendToMainFn('update:status', 'Download failed.');
  } finally {
    updateDownloadAbort = null;
  }
}

/**
 * Cancels an in-progress update download if one is active.
 */
function cancelDownload() {
  if (updateDownloadAbort) {
    updateDownloadAbort.abort();
    updateDownloadAbort = null;
    sendToMainFn('update:status', 'Download cancelled.');
  }
}

/**
 * Registers IPC handlers for update download and cancellation.
 * Must be called once during app initialization.
 */
function registerIpcHandlers() {
  ipcMain.handle('update:download', async (event, version) => {
    await downloadUpdate(version);
  });

  ipcMain.handle('update:cancel', () => {
    cancelDownload();
  });
}

/**
 * Sets the update channel used when checking for and downloading updates.
 * @param {string} channel - One of 'stable', 'beta', or 'nightly'
 */
function setUpdateChannel(channel) {
  const valid = ['stable', 'beta', 'nightly'];
  if (valid.includes(channel)) {
    updateChannel = channel;
  }
}

/**
 * Gets the current update channel.
 * @returns {string}
 */
function getUpdateChannel() {
  return updateChannel;
}

/**
 * Sets whether automatic update notifications are enabled.
 * @param {boolean} enabled - True to enable automatic update checks on startup
 */
function setUpdateNotifications(enabled) {
  updateNotifications = !!enabled;
}

/**
 * Gets whether automatic update notifications are enabled.
 * @returns {boolean}
 */
function getUpdateNotifications() {
  return updateNotifications;
}

/**
 * Initializes the updater module with references needed for window management and IPC.
 * Must be called before checkForUpdates or registerIpcHandlers.
 * @param {object} opts
 * @param {Function} opts.getMainWindow - Function that returns the current main BrowserWindow instance
 * @param {Function} opts.sendToMain - Function to send IPC messages to the renderer process
 */
function init(opts) {
  getMainWindow = opts.getMainWindow;
  sendToMainFn = opts.sendToMain;
}

module.exports = {
  checkForUpdates,
  registerIpcHandlers,
  setUpdateChannel,
  getUpdateChannel,
  setUpdateNotifications,
  getUpdateNotifications,
  init,
};
