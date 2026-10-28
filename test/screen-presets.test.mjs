import { test } from 'node:test';
import assert from 'node:assert';
import { getScreenPreset, isCancelledCaptureError } from '../src/renderer/services/screen-presets.js';

test('1080p at 30 fps', () => {
  assert.deepStrictEqual(getScreenPreset('1080', 30), {
    width: 1920,
    height: 1080,
    fps: 30,
    maxBitrate: 5000000,
    startBitrateKbps: 2500,
  });
});

test('60 fps raises the bitrate', () => {
  assert.strictEqual(getScreenPreset('1080', 60).maxBitrate, 8000000);
  assert.strictEqual(getScreenPreset('720', 60).maxBitrate, 4000000);
});

test('start bitrate is capped at 3000 kbps', () => {
  assert.strictEqual(getScreenPreset('2160', 60).startBitrateKbps, 3000);
});

test('unknown resolution and frame rate fall back to 1080p at 30 fps', () => {
  assert.deepStrictEqual(getScreenPreset('999', 45), getScreenPreset('1080', 30));
});

test('portal cancellation and legacy picker cancellation count as cancelled', () => {
  assert.strictEqual(isCancelledCaptureError(new Error('cancelled: the screen selection was cancelled')), true);
  assert.strictEqual(isCancelledCaptureError(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })), true);
  assert.strictEqual(isCancelledCaptureError(new Error('Error starting capture')), true);
});

test('other capture errors are not cancellations', () => {
  assert.strictEqual(isCancelledCaptureError(new Error('error: stream failed')), false);
  assert.strictEqual(isCancelledCaptureError(new Error('unsupported: no portal')), false);
});
