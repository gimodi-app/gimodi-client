const HEARTBEAT_SEND_INTERVAL = 10_000;
const HEARTBEAT_TIMEOUT = 20_000;
const CONNECT_TIMEOUT = 5_000;

export class ServerService extends EventTarget {
  constructor() {
    super();
    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {string|null} */
    this.clientId = null;
    /** @type {string|null} */
    this.userId = null;
    /** @type {Set<string>} */
    this.permissions = new Set();
    /** @type {string|null} */
    this.serverName = null;
    /** @type {number|null} */
    this.maxFileSize = null;
    /** @type {number} */
    this.tempChannelDeleteDelay = 180;
    /** @type {string|null} */
    this.address = null;
    /** @type {Map<string, {resolve: Function, reject: Function}>} */
    this._pendingRequests = new Map();
    /** @type {number} */
    this._requestId = 0;
    /** @type {string|null} */
    this._disconnectReason = null;
    /** @type {number|null} */
    this._heartbeatInterval = null;
    /** @type {number|null} */
    this._inactivityTimeout = null;
  }

  /** @private */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      this.send('server:ping', {});
    }, HEARTBEAT_SEND_INTERVAL);
    this._resetInactivityTimeout();
  }

  /** @private */
  _stopHeartbeat() {
    clearInterval(this._heartbeatInterval);
    clearTimeout(this._inactivityTimeout);
    this._heartbeatInterval = null;
    this._inactivityTimeout = null;
  }

  /** @private */
  _resetInactivityTimeout() {
    clearTimeout(this._inactivityTimeout);
    this._inactivityTimeout = setTimeout(() => {
      this._disconnectReason = 'Connection lost.';
      const ws = this.ws;
      this.ws = null;
      ws?.close();
    }, HEARTBEAT_TIMEOUT);
  }

  /**
   * @param {string} address
   * @param {string} nickname
   * @param {string} [password]
   * @param {string} [publicKey]
   * @returns {Promise<object>}
   */
  connect(address, nickname, password, publicKey) {
    return new Promise((resolve, reject) => {
      let url = address;
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        url = `wss://${url}`;
      }

      let settled = false;
      const settle = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimer);
        fn(value);
      };

      const connectTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const ws = this.ws;
          this.ws = null;
          if (ws) {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
          }
          reject(new Error('Connection timed out. The server is not responding.'));
        }
      }, CONNECT_TIMEOUT);

      this.ws = new WebSocket(url);

      this.ws.onopen = async () => {
        try {
          const clientVersion = await window.gimodi.getVersion().catch(() => null);
          const data = await this.request('server:connect', {
            nickname,
            password: password || undefined,
            clientVersion,
            publicKey: publicKey || undefined,
          });
          this.clientId = data.clientId;
          this.userId = data.userId || null;
          this.permissions = new Set(data.permissions || []);
          this.serverName = data.serverName;
          this.serverVersion = data.serverVersion || null;
          this.maxFileSize = data.maxFileSize || null;
          this.tempChannelDeleteDelay = data.tempChannelDeleteDelay || 180;
          this.address = address;
          this._startHeartbeat();
          settle(resolve, data);
        } catch (err) {
          settle(reject, err);
        }
      };

      this.ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this._handleMessage(msg);
      };

      this.ws.onclose = () => {
        this._stopHeartbeat();
        this._rejectPendingRequests('Connection closed');
        const reason = this._disconnectReason;
        this._disconnectReason = null;
        this._resetState();
        this.dispatchEvent(new CustomEvent('disconnected', { detail: { reason } }));
      };

      this.ws.onerror = () => {
        settle(reject, new Error('WebSocket connection failed'));
      };
    });
  }

  /**
   * @returns {void}
   */
  disconnect() {
    this._stopHeartbeat();
    this._rejectPendingRequests('Disconnected');
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    this._resetState();
  }

  /** @private */
  _resetState() {
    this.clientId = null;
    this.userId = null;
    this.permissions = new Set();
    this.maxFileSize = null;
  }

  /**
   * @private
   * @param {string} reason
   */
  _rejectPendingRequests(reason) {
    for (const entry of this._pendingRequests.values()) {
      entry.reject(new Error(reason));
    }
    this._pendingRequests.clear();
  }

  /**
   * @param {string} perm
   * @returns {boolean}
   */
  hasPermission(perm) {
    return this.permissions.has(perm);
  }

  /**
   * @param {string} type
   * @param {object} [data={}]
   * @returns {Promise<object>}
   */
  request(type, data = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++this._requestId);
      this._pendingRequests.set(id, { resolve, reject });

      this.send(type, data, id);

      setTimeout(() => {
        if (this._pendingRequests.has(id)) {
          this._pendingRequests.delete(id);
          reject(new Error(`Request ${type} timed out`));
        }
      }, 10000);
    });
  }

  /**
   * @param {string} type
   * @param {object} [data={}]
   * @param {string} [id]
   */
  send(type, data = {}, id) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data, ...(id && { id }) }));
    }
  }

  /**
   * @private
   * @param {{type: string, data: object, id?: string}} msg
   */
  _handleMessage(msg) {
    const { type, data, id } = msg;

    this._resetInactivityTimeout();

    if (type === 'server:ping') {
      return;
    }

    if (id && this._pendingRequests.has(id)) {
      const { resolve, reject } = this._pendingRequests.get(id);
      this._pendingRequests.delete(id);

      if (type === 'server:error') {
        const err = new Error(data.message || data.code);
        err.code = data.code;
        reject(err);
      } else {
        resolve(data);
      }
      return;
    }

    if (type === 'server:kicked' || type === 'server:banned' || type === 'server:shutdown') {
      this._disconnectReason =
        type === 'server:banned'
          ? `Banned: ${data.reason || 'No reason given.'}`
          : type === 'server:shutdown'
            ? `Server shut down: ${data.reason || 'The server is shutting down.'}`
            : `Kicked: ${data.reason || 'No reason given.'}`;
    }

    this.dispatchEvent(new CustomEvent(type, { detail: data }));
  }

  /** @returns {boolean} */
  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && this.clientId;
  }
}
