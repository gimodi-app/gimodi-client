const HEARTBEAT_SEND_INTERVAL = 10_000;
const HEARTBEAT_TIMEOUT = 20_000;
const CONNECT_TIMEOUT = 5_000;
const RECONNECT_MAX_DELAY = 30_000;

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
    /** @type {boolean} */
    this._reconnecting = false;
    /** @type {number} */
    this._reconnectAttempts = 0;
    /** @type {number|null} */
    this._reconnectTimer = null;
    /** @type {boolean} */
    this._intentionalDisconnect = false;
    /** @type {{address: string, nickname: string, password?: string, publicKey?: string}|null} */
    this._connectParams = null;
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
   * @param {{mode?: 'observe'|'full'}} [options]
   * @returns {Promise<object>}
   */
  connect(address, nickname, password, publicKey, options) {
    const mode = options?.mode || 'full';
    this._mode = mode;
    this._connectParams = { address, nickname, password, publicKey, mode };
    this._intentionalDisconnect = false;
    this._reconnecting = false;
    this._reconnectAttempts = 0;
    this.stopReconnect();

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
            mode: mode || undefined,
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

        const disconnectType = this._classifyDisconnect(reason);
        this._resetState();

        this.dispatchEvent(new CustomEvent('disconnected', { detail: { reason, disconnectType } }));

        if (disconnectType === 'connection-lost' || disconnectType === 'shutdown') {
          this._attemptReconnect();
        }
      };

      this.ws.onerror = () => {
        settle(reject, new Error('WebSocket connection failed'));
      };
    });
  }

  /**
   * @param {string|null} reason
   * @returns {string}
   */
  _classifyDisconnect(reason) {
    if (this._intentionalDisconnect) {
      return 'intentional';
    }
    if (!reason) {
      return 'connection-lost';
    }
    if (reason.startsWith('Kicked:')) {
      return 'kicked';
    }
    if (reason.startsWith('Banned:')) {
      return 'banned';
    }
    if (reason.startsWith('Server shut down:')) {
      return 'shutdown';
    }
    return 'connection-lost';
  }

  /** @private */
  _attemptReconnect() {
    if (!this._connectParams) {
      return;
    }
    this._reconnecting = true;
    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), RECONNECT_MAX_DELAY);

    this.dispatchEvent(new CustomEvent('reconnecting', { detail: { attempt: this._reconnectAttempts } }));

    this._reconnectTimer = setTimeout(async () => {
      if (!this._reconnecting) {
        return;
      }

      const { address, nickname, password, publicKey, mode: reconnectMode } = this._connectParams;
      let url = address;
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        url = `wss://${url}`;
      }

      try {
        this.ws = new WebSocket(url);

        await new Promise((resolve, reject) => {
          const ws = this.ws;
          const timer = setTimeout(() => {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
            reject(new Error('timeout'));
          }, CONNECT_TIMEOUT);

          ws.onopen = async () => {
            clearTimeout(timer);
            try {
              const clientVersion = await window.gimodi.getVersion().catch(() => null);
              const data = await this.request('server:connect', {
                nickname,
                password: password || undefined,
                clientVersion,
                publicKey: publicKey || undefined,
                mode: reconnectMode || undefined,
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
              this._reconnecting = false;
              this._reconnectAttempts = 0;
              this._intentionalDisconnect = false;

              // Rebind onclose to trigger auto-reconnect on future disconnects
              ws.onclose = () => {
                this._stopHeartbeat();
                this._rejectPendingRequests('Connection closed');
                const closeReason = this._disconnectReason;
                this._disconnectReason = null;
                const closeType = this._classifyDisconnect(closeReason);
                this._resetState();
                this.dispatchEvent(new CustomEvent('disconnected', { detail: { reason: closeReason, disconnectType: closeType } }));
                if (closeType === 'connection-lost' || closeType === 'shutdown') {
                  this._attemptReconnect();
                }
              };

              this.dispatchEvent(new CustomEvent('reconnected', { detail: data }));
              resolve();
            } catch (err) {
              reject(err);
            }
          };

          ws.onmessage = (event) => {
            let msg;
            try {
              msg = JSON.parse(event.data);
            } catch {
              return;
            }
            this._handleMessage(msg);
          };

          ws.onclose = () => {
            clearTimeout(timer);
            this._stopHeartbeat();
            this._rejectPendingRequests('Connection closed');
            reject(new Error('connection closed'));
          };

          ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('connection error'));
          };
        });
      } catch {
        if (this._reconnecting) {
          this._attemptReconnect();
        }
      }
    }, delay);
  }

  /** @returns {void} */
  stopReconnect() {
    this._reconnecting = false;
    this._reconnectAttempts = 0;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  /**
   * @returns {void}
   */
  disconnect() {
    this._intentionalDisconnect = true;
    this.stopReconnect();
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

  /**
   * Upgrades from observe to full mode over the existing WebSocket.
   * @returns {Promise<object>}
   */
  async upgrade() {
    const data = await this.request('server:upgrade', {});
    this._mode = 'full';
    if (this._connectParams) {
      this._connectParams.mode = 'full';
    }
    this.clientId = data.clientId;
    this.userId = data.userId || null;
    this.permissions = new Set(data.permissions || []);
    this.serverName = data.serverName;
    this.serverVersion = data.serverVersion || null;
    this.maxFileSize = data.maxFileSize || null;
    this.tempChannelDeleteDelay = data.tempChannelDeleteDelay || 180;
    return data;
  }

  /** @returns {string} */
  get mode() {
    return this._mode || 'full';
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
        for (const [k, v] of Object.entries(data)) {
          if (k !== 'message' && k !== 'code') err[k] = v;
        }
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

  /** @returns {boolean} */
  get reconnecting() {
    return this._reconnecting;
  }
}
