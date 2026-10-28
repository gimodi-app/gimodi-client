const { test } = require('node:test');
const assert = require('node:assert');
const { FrameFlow } = require('../src/main/screencast-flow');

test('allows two frames in flight by default', () => {
  const flow = new FrameFlow();
  assert.strictEqual(flow.tryAcquire(), true);
  assert.strictEqual(flow.tryAcquire(), true);
  assert.strictEqual(flow.tryAcquire(), false);
  assert.strictEqual(flow.inFlight, 2);
});

test('an acknowledged frame frees a slot', () => {
  const flow = new FrameFlow();
  flow.tryAcquire();
  flow.tryAcquire();
  flow.release();
  assert.strictEqual(flow.tryAcquire(), true);
});

test('releasing without frames in flight keeps the count at zero', () => {
  const flow = new FrameFlow();
  flow.release();
  assert.strictEqual(flow.inFlight, 0);
  assert.strictEqual(flow.tryAcquire(), true);
});
