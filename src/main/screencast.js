const path = require('path');

const WORKER_PATH = path.join(__dirname, 'screencast-worker.js');
const MODULE_PATH = path.join(__dirname, '..', '..', 'native', 'screencast', 'screencast.node');
const STOP_TIMEOUT_MS = 2000;

/**
 * Creates the controller that runs the native Wayland screen capture in a
 * utility process and connects it to a renderer through a message port.
 * @param {object} deps
 * @param {(modulePath: string) => import('electron').UtilityProcess} deps.fork - Starts the capture worker.
 * @param {() => {port1: import('electron').MessagePortMain, port2: import('electron').MessagePortMain}} deps.createChannel - Creates a message channel.
 * @param {NodeJS.ProcessEnv} deps.env - Environment variables.
 * @param {string} deps.platform - `process.platform`.
 * @param {(file: string) => boolean} deps.moduleExists - Checks for the native module file.
 * @returns {{isSupported: () => boolean, start: (webContents: import('electron').WebContents, options: object) => Promise<object>, stop: () => void, onEnded: (listener: (reason: string) => void) => void}}
 */
function createController({ fork, createChannel, env, platform, moduleExists }) {
  let session = null;
  let endedListener = () => {};

  /**
   * Whether the portal capture can be used on this system.
   * @returns {boolean}
   */
  function isSupported() {
    const wayland = env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
    return platform === 'linux' && wayland && env.GIMODI_SCREEN_CAPTURE !== 'legacy' && moduleExists(MODULE_PATH);
  }

  /**
   * Starts a capture worker, shows the portal dialog through it and sends the
   * frame port to the renderer.
   * @param {import('electron').WebContents} webContents - Renderer receiving the frames.
   * @param {{maxWidth: number, maxHeight: number, fps: number}} options - Capture options.
   * @returns {Promise<{width: number, height: number, sourceType: string}>}
   * @throws {Error} With a message starting with `cancelled:`, `unsupported:` or `error:`.
   */
  function start(webContents, options) {
    stop();
    const current = { worker: fork(WORKER_PATH), started: false, stopping: false, ended: false };
    session = current;
    const { port1, port2 } = createChannel();
    return new Promise((resolve, reject) => {
      current.worker.on('message', (message) => {
        if (message.type === 'started') {
          current.started = true;
          resolve(message.info);
        } else if (message.type === 'error') {
          reject(new Error(message.message));
          shutdown(current);
        } else if (message.type === 'ended') {
          reportEnded(current, message.reason);
        }
      });
      current.worker.on('exit', () => {
        if (!current.started) {
          reject(new Error('error: capture worker exited'));
        }
        reportEnded(current, 'worker exited');
        if (session === current) {
          session = null;
        }
      });
      current.worker.postMessage({ type: 'start', options }, [port1]);
      webContents.postMessage('screencast:port', null, [port2]);
    });
  }

  /**
   * Notifies the ended listener once for a running capture that ended on its own.
   * @param {object} current - Capture session.
   * @param {string} reason - Why the capture ended.
   * @returns {void}
   */
  function reportEnded(current, reason) {
    if (!current.started || current.stopping || current.ended) {
      return;
    }
    current.ended = true;
    endedListener(reason);
    shutdown(current);
  }

  /**
   * Asks a worker to stop and kills it if it does not exit in time.
   * @param {object} current - Capture session.
   * @returns {void}
   */
  function shutdown(current) {
    if (current.stopping) {
      return;
    }
    current.stopping = true;
    current.worker.postMessage({ type: 'stop' });
    const timer = setTimeout(() => current.worker.kill(), STOP_TIMEOUT_MS);
    current.worker.once('exit', () => clearTimeout(timer));
    if (session === current) {
      session = null;
    }
  }

  /**
   * Stops the running capture, if any.
   * @returns {void}
   */
  function stop() {
    if (session) {
      shutdown(session);
    }
  }

  /**
   * Sets the listener called when a capture ends without a stop request.
   * @param {(reason: string) => void} listener
   * @returns {void}
   */
  function onEnded(listener) {
    endedListener = listener;
  }

  return { isSupported, start, stop, onEnded };
}

module.exports = { createController };
