const { FrameFlow } = require('./screencast-flow');

const flow = new FrameFlow();
let capture = null;
let framePort = null;
let frameSequence = 0;

process.parentPort.on('message', (event) => {
  const message = event.data;
  if (message.type === 'start') {
    start(message.options, event.ports[0]);
  } else if (message.type === 'stop') {
    stop();
  }
});

/**
 * Starts the native capture and streams its frames over `port`.
 * @param {{maxWidth: number, maxHeight: number, fps: number}} options - Capture options.
 * @param {import('electron').MessagePortMain} port - Port connected to the renderer.
 * @returns {void}
 */
function start(options, port) {
  framePort = port;
  framePort.on('message', (event) => {
    if (event.data?.type === 'ack') {
      postFrame(flow.release());
    }
  });
  framePort.start();
  let ScreenCapture;
  try {
    ({ ScreenCapture } = require('../../native/screencast'));
  } catch (error) {
    process.parentPort.postMessage({ type: 'error', message: `unsupported: ${error.message}` });
    return;
  }
  capture = new ScreenCapture();
  capture.start(options, sendFrame, forwardEvent).then(
    (info) => process.parentPort.postMessage({ type: 'started', info }),
    (error) => process.parentPort.postMessage({ type: 'error', message: error.message }),
  );
}

/**
 * Hands a captured I420 frame to the flow control. The native module passes
 * null when a newer frame was already delivered.
 * @param {{data: Buffer, width: number, height: number}|null} frame
 * @returns {void}
 */
function sendFrame(frame) {
  if (frame && framePort) {
    postFrame(flow.offer(frame));
  }
}

/**
 * Posts a frame the flow control released to the renderer.
 * @param {{data: Buffer, width: number, height: number}|null} frame
 * @returns {void}
 */
function postFrame(frame) {
  if (!frame || !framePort) {
    return;
  }
  frameSequence += 1;
  framePort.postMessage({ type: 'frame', seq: frameSequence, width: frame.width, height: frame.height, data: frame.data });
}

/**
 * Reports the end of the capture (portal closed, stream gone or failed).
 * @param {{type: string, message: string}} event
 * @returns {void}
 */
function forwardEvent(event) {
  process.parentPort.postMessage({ type: 'ended', reason: `${event.type}: ${event.message}` });
}

/**
 * Stops the capture and exits the worker.
 * @returns {void}
 */
function stop() {
  capture?.stop();
  capture = null;
  framePort?.close();
  framePort = null;
  process.exit(0);
}
