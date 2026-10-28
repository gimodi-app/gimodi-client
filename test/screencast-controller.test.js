const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createController } = require('../src/main/screencast');

/**
 * Fake utility process recording posted messages.
 * @returns {EventEmitter & {messages: Array, killed: boolean}}
 */
function fakeWorker() {
  const worker = new EventEmitter();
  worker.messages = [];
  worker.killed = false;
  worker.postMessage = (message, ports) => worker.messages.push({ message, ports });
  worker.kill = () => {
    worker.killed = true;
    worker.emit('exit', 0);
  };
  return worker;
}

/**
 * Controller with fake dependencies.
 * @param {object} [overrides]
 * @returns {{controller: object, workers: Array}}
 */
function setup(overrides = {}) {
  const workers = [];
  const controller = createController({
    fork: () => {
      const worker = fakeWorker();
      workers.push(worker);
      return worker;
    },
    createChannel: () => ({ port1: 'worker-port', port2: 'renderer-port' }),
    env: { XDG_SESSION_TYPE: 'wayland' },
    platform: 'linux',
    moduleExists: () => true,
    ...overrides,
  });
  return { controller, workers };
}

/**
 * Fake webContents recording posted ports and emitting lifecycle events.
 * @returns {EventEmitter & {posted: Array, postMessage: Function}}
 */
function fakeWebContents() {
  const webContents = new EventEmitter();
  webContents.posted = [];
  webContents.postMessage = (channel, message, ports) => webContents.posted.push({ channel, ports });
  return webContents;
}

/**
 * Starts a capture and waits until the worker reports it running.
 * @returns {Promise<{controller: object, worker: EventEmitter, webContents: EventEmitter}>}
 */
async function startCapture() {
  const { controller, workers } = setup();
  const webContents = fakeWebContents();
  const started = controller.start(webContents, { maxWidth: 1920, maxHeight: 1080, fps: 30 });
  workers[0].emit('message', { type: 'started', info: {} });
  await started;
  return { controller, worker: workers[0], webContents };
}

const RENDERER_EVENTS = ['did-start-navigation', 'render-process-gone', 'destroyed'];

test('is supported on a Linux Wayland session with the module present', () => {
  assert.strictEqual(setup().controller.isSupported(), true);
  assert.strictEqual(setup({ env: { WAYLAND_DISPLAY: 'wayland-0' } }).controller.isSupported(), true);
});

test('is not supported off Linux, on X11, with the legacy switch or without the module', () => {
  assert.strictEqual(setup({ platform: 'win32' }).controller.isSupported(), false);
  assert.strictEqual(setup({ env: { XDG_SESSION_TYPE: 'x11' } }).controller.isSupported(), false);
  assert.strictEqual(setup({ env: { XDG_SESSION_TYPE: 'wayland', GIMODI_SCREEN_CAPTURE: 'legacy' } }).controller.isSupported(), false);
  assert.strictEqual(setup({ moduleExists: () => false }).controller.isSupported(), false);
});

test('start hands one port to the worker and one to the renderer', async () => {
  const { controller, workers } = setup();
  const webContents = fakeWebContents();
  const started = controller.start(webContents, { maxWidth: 1920, maxHeight: 1080, fps: 30 });
  workers[0].emit('message', { type: 'started', info: { width: 2560, height: 1440, sourceType: 'monitor' } });
  assert.deepStrictEqual(await started, { width: 2560, height: 1440, sourceType: 'monitor' });
  assert.deepStrictEqual(workers[0].messages[0], {
    message: { type: 'start', options: { maxWidth: 1920, maxHeight: 1080, fps: 30 } },
    ports: ['worker-port'],
  });
  assert.deepStrictEqual(webContents.posted, [{ channel: 'screencast:port', ports: ['renderer-port'] }]);
});

test('start rejects with the worker error message', async () => {
  const { controller, workers } = setup();
  const started = controller.start(fakeWebContents(), { maxWidth: 1920, maxHeight: 1080, fps: 30 });
  workers[0].emit('message', { type: 'error', message: 'cancelled: the screen selection was cancelled' });
  await assert.rejects(started, { message: 'cancelled: the screen selection was cancelled' });
});

test('a worker exit while capturing reports the end once', async () => {
  const { controller, workers } = setup();
  const reasons = [];
  controller.onEnded((reason) => reasons.push(reason));
  const started = controller.start(fakeWebContents(), { maxWidth: 1920, maxHeight: 1080, fps: 30 });
  workers[0].emit('message', { type: 'started', info: {} });
  await started;
  workers[0].emit('exit', 1);
  workers[0].emit('exit', 1);
  assert.deepStrictEqual(reasons, ['worker exited']);
});

test('an ended message from the worker is reported once', async () => {
  const { controller, workers } = setup();
  const reasons = [];
  controller.onEnded((reason) => reasons.push(reason));
  const started = controller.start(fakeWebContents(), { maxWidth: 1920, maxHeight: 1080, fps: 30 });
  workers[0].emit('message', { type: 'started', info: {} });
  await started;
  workers[0].emit('message', { type: 'ended', reason: 'portal session closed' });
  workers[0].emit('exit', 0);
  assert.deepStrictEqual(reasons, ['portal session closed']);
});

test('stop asks the worker to stop and kills it after 2000 ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, workers } = setup();
  const reasons = [];
  controller.onEnded((reason) => reasons.push(reason));
  const started = controller.start(fakeWebContents(), { maxWidth: 1920, maxHeight: 1080, fps: 30 });
  workers[0].emit('message', { type: 'started', info: {} });
  await started;
  controller.stop();
  assert.deepStrictEqual(workers[0].messages.at(-1), { message: { type: 'stop' }, ports: undefined });
  t.mock.timers.tick(1999);
  assert.strictEqual(workers[0].killed, false);
  t.mock.timers.tick(1);
  assert.strictEqual(workers[0].killed, true);
  assert.deepStrictEqual(reasons, []);
});

test('stops the capture when the renderer reloads, crashes or is destroyed', async () => {
  const losses = [['did-start-navigation', { isMainFrame: true, isSameDocument: false }], ['render-process-gone', {}, { reason: 'crashed' }], ['destroyed']];
  for (const [event, ...args] of losses) {
    const { worker, webContents } = await startCapture();
    webContents.emit(event, ...args);
    assert.deepStrictEqual(worker.messages.at(-1).message, { type: 'stop' }, event);
  }
});

test('keeps capturing on same-document and subframe navigations', async () => {
  const { worker, webContents } = await startCapture();
  webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  assert.strictEqual(worker.messages.length, 1);
});

test('removes its renderer listeners once the capture stops or ends', async () => {
  const stopped = await startCapture();
  stopped.controller.stop();
  const ended = await startCapture();
  ended.worker.emit('message', { type: 'ended', reason: 'portal session closed' });
  for (const { webContents } of [stopped, ended]) {
    for (const event of RENDERER_EVENTS) {
      assert.strictEqual(webContents.listenerCount(event), 0, event);
    }
  }
});
