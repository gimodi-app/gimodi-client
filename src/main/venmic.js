// Venmic wrapper for Linux audio capture via PipeWire
// Based on Equibop's approach: creates a virtual PipeWire sink that captures
// desktop audio while excluding the browser's own audio output and microphone inputs.
// The key to echo prevention is excluding the Chromium "Audio Service" process PID,
// which is the process that actually plays voice chat audio through PipeWire.

const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { log, rotateIfLarge } = require('./screen-audio-log');
const { summarizeGraph, findProblems } = require('./venmic-graph');

const PW_DUMP_TIMEOUT_MS = 3000;
const PW_DUMP_MAX_BUFFER = 64 * 1024 * 1024;

let patchBay = null;

/**
 * Path of venmic's own trace log, written when `VENMIC_ENABLE_LOG` is set.
 * @returns {string}
 */
function nativeLogFile() {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'venmic', 'venmic.log');
}

/**
 * Turns on venmic's trace log file. venmic links in its own PipeWire thread
 * and reports failures only through this logger, so without it they are lost.
 * Must run before the first PatchBay is created.
 * @returns {void}
 */
function enableNativeLog() {
  if (process.env.VENMIC_ENABLE_LOG === undefined) {
    process.env.VENMIC_ENABLE_LOG = '1';
  }
  rotateIfLarge(nativeLogFile());
}

function obtainVenmic() {
  if (patchBay) {
    return patchBay;
  }

  try {
    enableNativeLog();
    const native = require('@vencord/venmic');
    patchBay = new native.PatchBay();
    log('venmic', 'PatchBay created', { hasPipeWire: native.PatchBay.hasPipeWire(), nativeLog: nativeLogFile() });
    return patchBay;
  } catch (e) {
    log('venmic', 'Not available', { error: e.message });
    return null;
  }
}

function isAvailable() {
  return obtainVenmic() !== null;
}

function list(properties) {
  const pb = obtainVenmic();
  if (!pb) {
    return [];
  }

  try {
    return pb.list(properties || ['node.name', 'application.name', 'application.process.id', 'media.class', 'media.name']);
  } catch (e) {
    log('venmic', 'list error', { error: e.message });
    return [];
  }
}

/**
 * Start capturing audio from specific apps or entire system.
 * The capture stream of our audio service is pinned to our venmic node, because
 * Chromium asks for the source by the name `vencord-screen-share`, which Vesktop
 * and Equibop use for their venmic nodes too.
 * @param {Array} include - App nodes to include (e.g. [{ "application.name": "Spotify" }])
 * @param {Array} exclude - App nodes to exclude
 * @param {string} audioServicePid - Chromium Audio Service PID string to exclude (prevents echo)
 * @returns {boolean} Whether the link request was handed to venmic; the linking itself runs asynchronously.
 */
function start(include, exclude, audioServicePid) {
  const pb = obtainVenmic();
  if (!pb) {
    return false;
  }

  try {
    const excludeList = [
      // Exclude the Chromium Audio Service to prevent voice chat echo
      ...(audioServicePid ? [{ 'application.process.id': audioServicePid }] : []),
      // Exclude microphone inputs
      { 'media.class': 'Stream/Input/Audio' },
      ...exclude,
    ];
    const workaround = audioServicePid ? [{ 'application.process.id': audioServicePid, 'media.name': 'RecordStream' }] : [];

    const accepted = pb.link({
      include,
      exclude: excludeList,
      ignore_devices: true,
      workaround,
    });
    log('venmic', 'Link requested', { accepted, include, exclude: excludeList, workaround });
    return accepted;
  } catch (e) {
    log('venmic', 'link error', { error: e.message });
    return false;
  }
}

function startSystem(exclude, audioServicePid) {
  return start([], exclude, audioServicePid);
}

function stop() {
  const pb = obtainVenmic();
  if (!pb) {
    return;
  }

  try {
    pb.unlink();
    log('venmic', 'Unlinked');
  } catch (e) {
    log('venmic', 'unlink error', { error: e.message });
  }
}

/**
 * Reads the PipeWire graph with `pw-dump` and checks whether screen share
 * audio can reach our capture stream.
 * @param {string} audioServicePid - Chromium Audio Service PID.
 * @returns {Promise<{summary: import('./venmic-graph').GraphSummary, problems: string[]} | {error: string}>}
 */
function inspectGraph(audioServicePid) {
  return new Promise((resolve) => {
    execFile('pw-dump', { timeout: PW_DUMP_TIMEOUT_MS, maxBuffer: PW_DUMP_MAX_BUFFER }, (error, stdout) => {
      if (error) {
        resolve({ error: `pw-dump failed: ${error.message}` });
        return;
      }
      try {
        const summary = summarizeGraph(JSON.parse(stdout), { mainPid: String(process.pid), audioServicePid });
        resolve({ summary, problems: findProblems(summary) });
      } catch (e) {
        resolve({ error: `pw-dump output unreadable: ${e.message}` });
      }
    });
  });
}

module.exports = { isAvailable, list, start, startSystem, stop, inspectGraph };
