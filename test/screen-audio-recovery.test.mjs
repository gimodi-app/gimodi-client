import { test } from 'node:test';
import assert from 'node:assert';
import { createRecoveryPolicy } from '../src/renderer/services/screen-audio-recovery.js';

const OPTIONS = { cooldownMs: 60000, maxRecoveries: 2 };

test('nothing happens while the graph is healthy', () => {
  const policy = createRecoveryPolicy(OPTIONS);
  assert.deepStrictEqual(policy.decide({ trackEnded: false, problems: [], now: 0 }), { action: 'none' });
});

test('an ended track recovers at once', () => {
  const policy = createRecoveryPolicy(OPTIONS);
  assert.deepStrictEqual(policy.decide({ trackEnded: true, problems: [], now: 0 }), { action: 'recover', reason: 'track-ended' });
});

test('a graph problem recovers only when it is seen twice in a row', () => {
  const policy = createRecoveryPolicy(OPTIONS);
  assert.deepStrictEqual(policy.decide({ trackEnded: false, problems: ['capture-missing'], now: 0 }), { action: 'none' });
  assert.deepStrictEqual(policy.decide({ trackEnded: false, problems: ['capture-missing'], now: 10000 }), { action: 'recover', reason: 'capture-missing' });
});

test('a problem that went away in between does not count', () => {
  const policy = createRecoveryPolicy(OPTIONS);
  policy.decide({ trackEnded: false, problems: ['source-not-captured:30'], now: 0 });
  policy.decide({ trackEnded: false, problems: [], now: 10000 });
  assert.deepStrictEqual(policy.decide({ trackEnded: false, problems: ['source-not-captured:30'], now: 20000 }), { action: 'none' });
});

test('recoveries wait for the cooldown', () => {
  const policy = createRecoveryPolicy(OPTIONS);
  policy.decide({ trackEnded: true, problems: [], now: 0 });
  assert.deepStrictEqual(policy.decide({ trackEnded: true, problems: [], now: 30000 }), { action: 'cooldown', reason: 'track-ended' });
  assert.deepStrictEqual(policy.decide({ trackEnded: true, problems: [], now: 60000 }), { action: 'recover', reason: 'track-ended' });
});

test('recoveries stop after the limit', () => {
  const policy = createRecoveryPolicy(OPTIONS);
  policy.decide({ trackEnded: true, problems: [], now: 0 });
  policy.decide({ trackEnded: true, problems: [], now: 60000 });
  assert.deepStrictEqual(policy.decide({ trackEnded: true, problems: [], now: 120000 }), { action: 'limit', reason: 'track-ended' });
});

test('a problem must be seen twice again after a recovery', () => {
  const policy = createRecoveryPolicy({ cooldownMs: 0, maxRecoveries: 5 });
  policy.decide({ trackEnded: false, problems: ['capture-missing'], now: 0 });
  policy.decide({ trackEnded: false, problems: ['capture-missing'], now: 10000 });
  assert.deepStrictEqual(policy.decide({ trackEnded: false, problems: ['capture-missing'], now: 20000 }), { action: 'none' });
});
