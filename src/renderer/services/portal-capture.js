const KEEPALIVE_CHECK_MS = 250;
const KEEPALIVE_AFTER_MS = 500;
const PORT_MESSAGE_TYPE = 'gimodi:screencast-port';
const FRAME_COLOR_SPACE = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'smpte170m', fullRange: false };

/**
 * Waits for the frame port the main process posts while the capture starts.
 * @returns {{promise: Promise<MessagePort>, cancel: () => void}}
 */
function waitForFramePort() {
  let listener;
  const promise = new Promise((resolve) => {
    listener = (event) => {
      if (event.source === window && event.data?.type === PORT_MESSAGE_TYPE && event.ports[0]) {
        window.removeEventListener('message', listener);
        resolve(event.ports[0]);
      }
    };
    window.addEventListener('message', listener);
  });
  return { promise, cancel: () => window.removeEventListener('message', listener) };
}

/**
 * Microsecond timestamp for a frame written now.
 * @returns {number}
 */
function frameTimestamp() {
  return Math.round(performance.now() * 1000);
}

/**
 * Starts the Wayland portal capture (embedded cursor, native conversion) and
 * exposes its I420 frames as a video track.
 * @param {object} options
 * @param {number} options.maxWidth - Largest output width.
 * @param {number} options.maxHeight - Largest output height.
 * @param {number} options.fps - 30 or 60.
 * @param {(reason: string) => void} [options.onEnded] - Called when the capture ends on its own.
 * @returns {Promise<{track: MediaStreamTrack, info: {width: number, height: number, sourceType: string}, stop: () => void}>}
 * @throws {Error} With a message starting with `cancelled:`, `unsupported:` or `error:`.
 */
export async function startPortalCapture({ maxWidth, maxHeight, fps, onEnded }) {
  const framePort = waitForFramePort();
  let info;
  try {
    info = await window.gimodi.screencast.start({ maxWidth, maxHeight, fps });
  } catch (error) {
    framePort.cancel();
    throw error;
  }
  const port = await framePort.promise;
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  generator.contentHint = 'motion';
  const writer = generator.writable.getWriter();
  let lastFrame = null;
  let lastWrite = 0;
  let stopped = false;

  /**
   * Writes a frame to the track; the track takes ownership of it.
   * @param {VideoFrame} frame
   * @returns {void}
   */
  const write = (frame) => {
    lastWrite = performance.now();
    writer.write(frame).catch(() => frame.close());
  };

  port.onmessage = (event) => {
    const message = event.data;
    if (stopped || message?.type !== 'frame') {
      return;
    }
    const frame = new VideoFrame(message.data, {
      format: 'I420',
      codedWidth: message.width,
      codedHeight: message.height,
      timestamp: frameTimestamp(),
      colorSpace: FRAME_COLOR_SPACE,
    });
    port.postMessage({ type: 'ack', seq: message.seq });
    lastFrame?.close();
    lastFrame = frame;
    write(frame.clone());
  };

  const keepalive = setInterval(() => {
    if (lastFrame && performance.now() - lastWrite >= KEEPALIVE_AFTER_MS) {
      write(new VideoFrame(lastFrame, { timestamp: frameTimestamp() }));
    }
  }, KEEPALIVE_CHECK_MS);

  /**
   * Stops the capture, the keepalive and the track. Safe to call repeatedly.
   * @returns {void}
   */
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(keepalive);
    window.gimodi.screencast.removeEndedListener();
    window.gimodi.screencast.stop();
    port.close();
    lastFrame?.close();
    lastFrame = null;
    writer.close().catch(() => {});
    generator.stop();
  };

  window.gimodi.screencast.onEnded((reason) => {
    stop();
    onEnded?.(reason);
  });

  return { track: generator, info, stop };
}
