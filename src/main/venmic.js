// Venmic wrapper for Linux audio capture via PipeWire
// Based on Equibop's approach: creates a virtual PipeWire sink that captures
// desktop audio while excluding the browser's own audio output and microphone inputs.
// The key to echo prevention is excluding the Chromium "Audio Service" process PID,
// which is the process that actually plays voice chat audio through PipeWire.

let patchBay = null;

function obtainVenmic() {
  if (patchBay) return patchBay;

  try {
    const native = require('@vencord/venmic');
    patchBay = new native.PatchBay();
    return patchBay;
  } catch (e) {
    console.log('[venmic] Not available:', e.message);
    return null;
  }
}

function isAvailable() {
  return obtainVenmic() !== null;
}

function list(properties) {
  const pb = obtainVenmic();
  if (!pb) return [];

  try {
    return pb.list(properties || ['node.name', 'application.name', 'application.process.id', 'media.class', 'media.name']);
  } catch (e) {
    console.error('[venmic] list error:', e);
    return [];
  }
}

/**
 * Start capturing audio from specific apps or entire system.
 * @param {Array} include - App nodes to include (e.g. [{ "application.name": "Spotify" }])
 * @param {Array} exclude - App nodes to exclude
 * @param {string} audioServicePid - Chromium Audio Service PID string to exclude (prevents echo)
 */
function start(include, exclude, audioServicePid) {
  const pb = obtainVenmic();
  if (!pb) return false;

  try {
    const excludeList = [
      // Exclude the Chromium Audio Service to prevent voice chat echo
      ...(audioServicePid ? [{ 'application.process.id': audioServicePid }] : []),
      // Exclude microphone inputs
      { 'media.class': 'Stream/Input/Audio' },
      ...exclude,
    ];

    pb.link({
      include,
      exclude: excludeList,
      ignore_devices: true,
    });
    console.log('[venmic] Linked with include:', JSON.stringify(include), 'exclude:', JSON.stringify(excludeList));
    return true;
  } catch (e) {
    console.error('[venmic] link error:', e);
    return false;
  }
}

function startSystem(exclude, audioServicePid) {
  return start([], exclude, audioServicePid);
}

function stop() {
  const pb = obtainVenmic();
  if (!pb) return;

  try {
    pb.unlink();
    console.log('[venmic] Unlinked');
  } catch (e) {
    console.error('[venmic] unlink error:', e);
  }
}

module.exports = { isAvailable, list, start, startSystem, stop };
