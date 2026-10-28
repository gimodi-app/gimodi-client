const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'native', 'screencast', 'screencast.node');
const skip = process.platform !== 'linux' || !fs.existsSync(modulePath) ? 'native screencast module not built' : false;

test('native screencast module', { skip }, async (t) => {
  const { ScreenCapture } = require('../native/screencast');

  await t.test('exports the ScreenCapture class', () => {
    assert.strictEqual(typeof ScreenCapture, 'function');
  });

  await t.test('stop can be called repeatedly without a running capture', () => {
    const capture = new ScreenCapture();
    capture.stop();
    capture.stop();
  });

  await t.test('start rejects invalid options before showing the portal', async () => {
    const capture = new ScreenCapture();
    await assert.rejects(
      capture.start({ maxWidth: 0, maxHeight: 1080, fps: 30 }, () => {}, () => {}),
      (error) => error.message.startsWith('error:'),
    );
    await assert.rejects(
      capture.start({ maxWidth: 1920, maxHeight: 1080, fps: 45 }, () => {}, () => {}),
      (error) => error.message.startsWith('error:'),
    );
  });
});
