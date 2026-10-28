const { test } = require('node:test');
const assert = require('node:assert');
const { FrameFlow } = require('../src/main/screencast-flow');

test('sends up to two frames without acknowledgement', () => {
  const flow = new FrameFlow();
  assert.strictEqual(flow.offer('a'), 'a');
  assert.strictEqual(flow.offer('b'), 'b');
  assert.strictEqual(flow.inFlight, 2);
});

test('keeps only the newest frame while the renderer is busy and sends it on the next ack', () => {
  const flow = new FrameFlow();
  flow.offer('a');
  flow.offer('b');
  assert.strictEqual(flow.offer('c'), null);
  assert.strictEqual(flow.offer('d'), null);
  assert.strictEqual(flow.release(), 'd');
  assert.strictEqual(flow.inFlight, 2);
  assert.strictEqual(flow.release(), null);
  assert.strictEqual(flow.inFlight, 1);
});

test('releasing without frames in flight keeps the count at zero', () => {
  const flow = new FrameFlow();
  assert.strictEqual(flow.release(), null);
  assert.strictEqual(flow.inFlight, 0);
  assert.strictEqual(flow.offer('a'), 'a');
});
