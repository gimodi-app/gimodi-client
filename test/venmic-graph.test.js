const { test } = require('node:test');
const assert = require('node:assert');
const { summarizeGraph, findProblems } = require('../src/main/venmic-graph');

const MAIN_PID = '100';
const AUDIO_PID = '101';
const OTHER_APP_PID = '300';

/**
 * PipeWire client object as printed by `pw-dump`, which prints PIDs as numbers.
 * @param {number} id
 * @param {string} pid
 * @returns {object}
 */
function client(id, pid) {
  return { id, type: 'PipeWire:Interface:Client', info: { props: { 'application.process.id': Number(pid) } } };
}

/**
 * PipeWire node object as printed by `pw-dump`, which prints PIDs as numbers.
 * @param {number} id
 * @param {object} props
 * @param {string} [state]
 * @returns {object}
 */
function node(id, props, state = 'running') {
  if (props['application.process.id']) {
    props['application.process.id'] = Number(props['application.process.id']);
  }
  return { id, type: 'PipeWire:Interface:Node', info: { state, props } };
}

/**
 * PipeWire link object as printed by `pw-dump`.
 * @param {number} id
 * @param {number} output
 * @param {number} input
 * @returns {object}
 */
function link(id, output, input) {
  return { id, type: 'PipeWire:Interface:Link', info: { 'output-node-id': output, 'input-node-id': input, state: 'active' } };
}

/**
 * A healthy graph: our venmic node feeds our capture stream and captures Firefox.
 * @returns {object[]}
 */
function healthyGraph() {
  return [
    client(1, MAIN_PID),
    node(10, { 'node.name': 'vencord-screen-share', 'media.class': 'Audio/Source/Virtual', 'client.id': 1 }),
    node(20, { 'node.name': '@gimodi/client', 'media.class': 'Stream/Input/Audio', 'media.name': 'RecordStream', 'application.process.id': AUDIO_PID }),
    node(30, { 'node.name': 'Firefox', 'media.class': 'Stream/Output/Audio', 'application.name': 'Firefox', 'application.process.id': OTHER_APP_PID }),
    node(40, { 'node.name': 'alsa_output.speakers', 'media.class': 'Audio/Sink', 'device.id': '5' }),
    node(50, { 'node.name': '@gimodi/client', 'media.class': 'Stream/Output/Audio', 'application.process.id': AUDIO_PID }),
    link(100, 10, 20),
    link(105, 10, 20),
    link(101, 30, 40),
    link(102, 30, 10),
    link(103, 50, 40),
  ];
}

const PIDS = { mainPid: MAIN_PID, audioServicePid: AUDIO_PID };

test('a healthy graph has no problems', () => {
  const summary = summarizeGraph(healthyGraph(), PIDS);
  assert.deepStrictEqual(summary.venmicNodes, [{ id: 10, own: true, pid: MAIN_PID, state: 'running' }]);
  assert.deepStrictEqual(summary.captures, [{ streamId: 20, sourceId: 10, own: true }]);
  assert.deepStrictEqual(summary.sources, [{ id: 30, name: 'Firefox', pid: OTHER_APP_PID, captured: true }]);
  assert.deepStrictEqual(findProblems(summary), []);
});

test('our own voice output is not a source', () => {
  const summary = summarizeGraph(healthyGraph(), PIDS);
  assert.ok(!summary.sources.some((source) => source.id === 50));
});

test('a missing venmic node is reported', () => {
  const graph = healthyGraph().filter((object) => object.id !== 10 && object.id !== 100 && object.id !== 102);
  assert.deepStrictEqual(findProblems(summarizeGraph(graph, PIDS)), ['own-node-missing', 'capture-missing', 'source-not-captured:30']);
});

test('a capture stream fed by another app venmic node is reported', () => {
  const graph = healthyGraph().filter((object) => object.id !== 100 && object.id !== 105);
  graph.push(client(2, OTHER_APP_PID));
  graph.push(node(11, { 'node.name': 'vencord-screen-share', 'media.class': 'Audio/Source/Virtual', 'client.id': 2 }));
  graph.push(link(104, 11, 20));
  const summary = summarizeGraph(graph, PIDS);
  assert.deepStrictEqual(summary.captures, [{ streamId: 20, sourceId: 11, own: false }]);
  assert.deepStrictEqual(findProblems(summary), ['capture-missing', 'capture-from-foreign-node']);
});

test('a playing app that venmic did not link is reported', () => {
  const graph = healthyGraph().filter((object) => object.id !== 102);
  assert.deepStrictEqual(findProblems(summarizeGraph(graph, PIDS)), ['source-not-captured:30']);
});

test('an app stream without any link is not a source', () => {
  const graph = healthyGraph().filter((object) => object.id !== 101 && object.id !== 102);
  assert.deepStrictEqual(summarizeGraph(graph, PIDS).sources, []);
});
