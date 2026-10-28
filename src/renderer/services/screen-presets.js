/** Capture size and VP8 bitrate (bps) per frame rate for each resolution preset. */
const RESOLUTIONS = {
  720: { width: 1280, height: 720, bitrates: { 30: 2500000, 60: 4000000 } },
  1080: { width: 1920, height: 1080, bitrates: { 30: 5000000, 60: 8000000 } },
  1440: { width: 2560, height: 1440, bitrates: { 30: 8000000, 60: 12000000 } },
  2160: { width: 3840, height: 2160, bitrates: { 30: 14000000, 60: 20000000 } },
};

const DEFAULT_RESOLUTION = 1080;
const DEFAULT_FPS = 30;
const MAX_START_BITRATE_KBPS = 3000;

/**
 * Capture and encoder settings for a resolution preset and frame rate.
 * Unknown values fall back to 1080p at 30 fps.
 * @param {string|number} resolution - Preset height (720, 1080, 1440, 2160).
 * @param {string|number} fps - 30 or 60.
 * @returns {{width: number, height: number, fps: number, maxBitrate: number, startBitrateKbps: number}}
 */
export function getScreenPreset(resolution, fps) {
  const preset = RESOLUTIONS[resolution] ?? RESOLUTIONS[DEFAULT_RESOLUTION];
  const rate = preset.bitrates[fps] ? Number(fps) : DEFAULT_FPS;
  const maxBitrate = preset.bitrates[rate];
  return {
    width: preset.width,
    height: preset.height,
    fps: rate,
    maxBitrate,
    startBitrateKbps: Math.min(maxBitrate / 2000, MAX_START_BITRATE_KBPS),
  };
}

/**
 * Whether a capture error means the user cancelled the source selection.
 * @param {Error} error - Error from the portal capture or `getDisplayMedia`.
 * @returns {boolean}
 */
export function isCancelledCaptureError(error) {
  return error?.name === 'NotAllowedError' || error?.message === 'Error starting capture' || String(error?.message).startsWith('cancelled:');
}
