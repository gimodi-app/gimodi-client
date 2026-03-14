const sndNotification = new Audio('../../assets/notification.mp3');

class NotificationService extends EventTarget {
  constructor() {
    super();
    /** @type {string} */
    this._mode = 'mentions';
    /** @type {Array<{type: string, title: string, body: string, action: object, timestamp: number}>} */
    this._entries = [];
  }

  /**
   * @param {object} settings
   */
  updateSettings(settings) {
    this._mode = (settings && settings.notificationMode) || 'mentions';
  }

  /** @returns {number} */
  get count() {
    return this._entries.length;
  }

  /** @returns {Array<{type: string, title: string, body: string, action: object, timestamp: number}>} */
  get entries() {
    return [...this._entries];
  }

  /**
   * @private
   * @param {{type: string, title: string, body: string, action: object}} entry
   */
  _addEntry({ type, title, body, action }) {
    this._entries.unshift({ type, title, body, action, timestamp: Date.now() });
    if (this._entries.length > 20) {
      this._entries.length = 20;
    }
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * @param {{ type: 'channel', channelId: string }} action
   */
  clearByAction(action) {
    if (!action) {
      return;
    }
    const before = this._entries.length;
    this._entries = this._entries.filter((e) => {
      if (!e.action) {
        return true;
      }
      if (action.type === 'channel') {
        return !(e.action.type === 'channel' && e.action.channelId === action.channelId);
      }
      return true;
    });
    if (this._entries.length !== before) {
      this.dispatchEvent(new CustomEvent('change'));
    }
  }

  /**
   * @returns {void}
   */
  clearAll() {
    if (this._entries.length === 0) {
      return;
    }
    this._entries = [];
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * @param {object} opts
   * @param {'mention'|'message'} opts.type
   * @param {string} opts.title
   * @param {string} opts.body
   * @param {object} [opts.action]
   */
  show({ type, title, body, action }) {
    if (type === 'mention') {
      this._addEntry({ type, title, body, action });
      const clone = sndNotification.cloneNode();
      clone.volume = 0.4;
      clone.play().catch(() => {});
    }

    if (type !== 'mention' && document.hasFocus()) {
      return;
    }

    const mode = this._mode;
    if (mode === 'none') {
      return;
    }
    if (mode === 'mentions' && type !== 'mention') {
      return;
    }

    window.gimodi.showNotification({ title, body, action });
  }
}

const notificationService = new NotificationService();
export default notificationService;
