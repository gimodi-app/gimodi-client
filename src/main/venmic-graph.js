const VENMIC_NODE_NAME = 'vencord-screen-share';

/**
 * Reads a process ID property, which `pw-dump` prints as a number.
 * @param {object} props - PipeWire properties.
 * @returns {string|null}
 */
function pidOf(props) {
  const pid = props?.['application.process.id'];
  return pid === undefined || pid === null ? null : String(pid);
}

/**
 * @typedef {object} GraphSummary
 * @property {{id: number, own: boolean, pid: string|null, state: string}[]} venmicNodes - All nodes named like the venmic sink, ours and those of other apps (Vesktop, Equibop).
 * @property {{streamId: number, sourceId: number, own: boolean}[]} captures - Links from a venmic node into a capture stream of our audio service.
 * @property {{id: number, name: string, pid: string|null, captured: boolean}[]} sources - Playing app streams venmic should capture, and whether they feed our node.
 */

/**
 * Reduces a `pw-dump` object list to the parts that decide whether screen
 * share audio reaches our capture stream.
 * @param {object[]} objects - Parsed `pw-dump` output.
 * @param {{mainPid: string, audioServicePid: string}} pids - Our main process and Chromium audio service PIDs.
 * @returns {GraphSummary}
 */
function summarizeGraph(objects, { mainPid, audioServicePid }) {
  const clientPids = new Map();
  const nodes = new Map();
  const links = [];
  for (const object of objects) {
    if (object.type === 'PipeWire:Interface:Client') {
      clientPids.set(object.id, pidOf(object.info?.props));
    } else if (object.type === 'PipeWire:Interface:Node') {
      nodes.set(object.id, { state: object.info?.state ?? 'unknown', props: object.info?.props ?? {} });
    } else if (object.type === 'PipeWire:Interface:Link') {
      links.push({ output: object.info?.['output-node-id'], input: object.info?.['input-node-id'] });
    }
  }

  const venmicNodes = [...nodes]
    .filter(([, node]) => node.props['node.name'] === VENMIC_NODE_NAME)
    .map(([id, node]) => {
      const pid = clientPids.get(Number(node.props['client.id'])) ?? null;
      return { id, own: pid === mainPid, pid, state: node.state };
    });
  const venmicIds = new Map(venmicNodes.map((node) => [node.id, node]));
  const ownIds = new Set(venmicNodes.filter((node) => node.own).map((node) => node.id));

  const isOurCaptureStream = (id) => {
    const props = nodes.get(id)?.props ?? {};
    return props['media.class'] === 'Stream/Input/Audio' && pidOf(props) === audioServicePid;
  };
  const capturePairs = new Set(links.filter((link) => venmicIds.has(link.output) && isOurCaptureStream(link.input)).map((link) => `${link.input}:${link.output}`));
  const captures = [...capturePairs].map((pair) => {
    const [streamId, sourceId] = pair.split(':').map(Number);
    return { streamId, sourceId, own: ownIds.has(sourceId) };
  });

  const isAppStream = (props) => props['media.class'] === 'Stream/Output/Audio' && pidOf(props) !== audioServicePid;
  const sources = [...nodes]
    .filter(([id, node]) => isAppStream(node.props) && links.some((link) => link.output === id && !ownIds.has(link.input)))
    .map(([id, node]) => ({
      id,
      name: node.props['application.name'] || node.props['node.name'] || '',
      pid: pidOf(node.props),
      captured: links.some((link) => link.output === id && ownIds.has(link.input)),
    }));

  return { venmicNodes, captures, sources };
}

/**
 * Lists the states in which screen share audio is lost or wrong.
 * @param {GraphSummary} summary - Result of {@link summarizeGraph}.
 * @returns {string[]} Problem codes, `source-not-captured:<id>` once per missed stream.
 */
function findProblems(summary) {
  const problems = [];
  if (!summary.venmicNodes.some((node) => node.own)) {
    problems.push('own-node-missing');
  }
  if (!summary.captures.some((capture) => capture.own)) {
    problems.push('capture-missing');
  }
  if (summary.captures.some((capture) => !capture.own)) {
    problems.push('capture-from-foreign-node');
  }
  for (const source of summary.sources) {
    if (!source.captured) {
      problems.push(`source-not-captured:${source.id}`);
    }
  }
  return problems;
}

module.exports = { summarizeGraph, findProblems };
