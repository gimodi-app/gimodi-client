/**
 * Limits how many captured frames are in flight between the capture worker and
 * the renderer. While the renderer is busy only the newest frame is kept, and it
 * is sent with the next acknowledgement, so a still screen never stays on an
 * older picture.
 */
class FrameFlow {
  /**
   * @param {number} [limit=2] - Maximum unacknowledged frames.
   */
  constructor(limit = 2) {
    this.limit = limit;
    this.count = 0;
    this.pending = null;
  }

  /**
   * Offers a captured frame.
   * @template T
   * @param {T} frame
   * @returns {T|null} The frame to send now, or null when it is kept for later.
   */
  offer(frame) {
    if (this.count >= this.limit) {
      this.pending = frame;
      return null;
    }
    this.count += 1;
    return frame;
  }

  /**
   * Frees the slot of an acknowledged frame.
   * @returns {*|null} The newest kept frame, which now has a slot and must be sent.
   */
  release() {
    this.count = Math.max(0, this.count - 1);
    if (this.pending === null) {
      return null;
    }
    const frame = this.pending;
    this.pending = null;
    this.count += 1;
    return frame;
  }

  /** @returns {number} Frames sent but not yet acknowledged. */
  get inFlight() {
    return this.count;
  }
}

module.exports = { FrameFlow };
