/**
 * Limits how many captured frames are in flight between the capture worker and
 * the renderer, so a busy renderer drops frames instead of queueing them.
 */
class FrameFlow {
  /**
   * @param {number} [limit=2] - Maximum unacknowledged frames.
   */
  constructor(limit = 2) {
    this.limit = limit;
    this.count = 0;
  }

  /**
   * Reserves a slot for one frame.
   * @returns {boolean} Whether the frame may be sent.
   */
  tryAcquire() {
    if (this.count >= this.limit) {
      return false;
    }
    this.count += 1;
    return true;
  }

  /**
   * Frees the slot of an acknowledged frame.
   * @returns {void}
   */
  release() {
    this.count = Math.max(0, this.count - 1);
  }

  /** @returns {number} Frames sent but not yet acknowledged. */
  get inFlight() {
    return this.count;
  }
}

module.exports = { FrameFlow };
