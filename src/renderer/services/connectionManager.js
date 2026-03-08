import { ServerService } from './serverConnection.js';

class ConnectionManager extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, ServerService>} */
    this._connections = new Map();
    /** @type {string|null} */
    this._activeAddress = null;
    /** @type {string|null} */
    this._voiceAddress = null;
    /** @type {Array<{type: string, listener: Function, options: any}>} */
    this._proxyListeners = [];
    /** @type {Map<string, {server: object, chat: object}>} */
    this._serverStates = new Map();
    /** @type {Map<string, {nickname: string, password: string|undefined, publicKey: string|undefined}>} */
    this._credentials = new Map();
  }

  /**
   * @param {string} address
   * @param {string} nickname
   * @param {string} [password]
   * @param {string} [publicKey]
   * @returns {Promise<object>}
   */
  async connect(address, nickname, password, publicKey) {
    if (this._connections.has(address)) {
      this.switchView(address);
      const conn = this._connections.get(address);
      return { clientId: conn.clientId, serverName: conn.serverName, _address: address };
    }

    const conn = new ServerService();
    const data = await conn.connect(address, nickname, password, publicKey);

    this._connections.set(address, conn);
    this._credentials.set(address, { nickname, password, publicKey });

    conn.addEventListener('disconnected', (e) => {
      this._onConnectionLost(address, e.detail?.reason);
    });

    return data;
  }

  /**
   * @param {string} address
   */
  switchView(address) {
    if (address === this._activeAddress) return;
    if (!this._connections.has(address)) return;

    const oldAddress = this._activeAddress;
    const oldConn = oldAddress ? this._connections.get(oldAddress) : null;
    const newConn = this._connections.get(address);

    this._rebindProxyListeners(oldConn, newConn);
    this._activeAddress = address;

    this.dispatchEvent(new CustomEvent('view-switched', {
      detail: { from: oldAddress, to: address },
    }));
  }

  /**
   * @param {string} address
   */
  disconnect(address) {
    const conn = this._connections.get(address);
    if (!conn) return;

    conn.disconnect();
    this._connections.delete(address);
    this._serverStates.delete(address);
    this._credentials.delete(address);

    if (this._voiceAddress === address) {
      this._voiceAddress = null;
    }

    if (this._activeAddress === address) {
      this._activeAddress = null;
      const remaining = [...this._connections.keys()];
      if (remaining.length > 0) {
        this.switchView(remaining[0]);
      } else {
        this._unbindProxyListeners(conn);
        this.dispatchEvent(new CustomEvent('all-disconnected'));
      }
    }

    this.dispatchEvent(new CustomEvent('connection-removed', {
      detail: { address },
    }));
  }

  /**
   * @returns {void}
   */
  disconnectAll() {
    for (const [address, conn] of this._connections) {
      conn.disconnect();
    }
    const oldActive = this._activeAddress ? this._connections.get(this._activeAddress) : null;
    if (oldActive) this._unbindProxyListeners(oldActive);
    this._connections.clear();
    this._serverStates.clear();
    this._credentials.clear();
    this._activeAddress = null;
    this._voiceAddress = null;
    this.dispatchEvent(new CustomEvent('all-disconnected'));
  }

  /**
   * @private
   * @param {string} address
   * @param {string} [reason]
   */
  _onConnectionLost(address, reason) {
    this._connections.delete(address);
    this._serverStates.delete(address);

    const hadVoice = this._voiceAddress === address;
    if (hadVoice) {
      this._voiceAddress = null;
    }

    if (this._activeAddress === address) {
      this._activeAddress = null;
      const remaining = [...this._connections.keys()];
      if (remaining.length > 0) {
        this.switchView(remaining[0]);
      } else {
        this.dispatchEvent(new CustomEvent('all-disconnected'));
      }
    }

    this.dispatchEvent(new CustomEvent('connection-lost', {
      detail: { address, reason, hadVoice },
    }));
  }

  /**
   * @param {string} address
   */
  setVoiceServer(address) {
    this._voiceAddress = address;
    this.dispatchEvent(new CustomEvent('voice-server-changed', {
      detail: { address },
    }));
  }

  /**
   * @returns {void}
   */
  clearVoiceServer() {
    this._voiceAddress = null;
    this.dispatchEvent(new CustomEvent('voice-server-changed', {
      detail: { address: null },
    }));
  }

  /**
   * @returns {ServerService|null}
   */
  getActive() {
    if (!this._activeAddress) return null;
    return this._connections.get(this._activeAddress) || null;
  }

  /**
   * @returns {ServerService|null}
   */
  getVoice() {
    if (!this._voiceAddress) return null;
    return this._connections.get(this._voiceAddress) || null;
  }

  /**
   * @param {string} address
   * @returns {ServerService|null}
   */
  getConnection(address) {
    return this._connections.get(address) || null;
  }

  /** @returns {string|null} */
  get activeAddress() {
    return this._activeAddress;
  }

  /** @param {string|null} addr */
  set activeAddress(addr) {
    this._activeAddress = addr;
  }

  /** @returns {string|null} */
  get voiceAddress() {
    return this._voiceAddress;
  }

  /** @returns {Map<string, ServerService>} */
  get connections() {
    return this._connections;
  }

  /** @returns {number} */
  get connectionCount() {
    return this._connections.size;
  }

  /**
   * @param {string} address
   * @returns {boolean}
   */
  isConnected(address) {
    const conn = this._connections.get(address);
    return conn ? !!conn.connected : false;
  }

  /**
   * @param {string} address
   * @returns {{nickname: string, password: string|undefined, publicKey: string|undefined}|null}
   */
  getCredentials(address) {
    return this._credentials.get(address) || null;
  }

  /**
   * @param {string} address
   * @param {object} state
   */
  saveServerState(address, state) {
    this._serverStates.set(address, state);
  }

  /**
   * @param {string} address
   * @returns {object|null}
   */
  getServerState(address) {
    return this._serverStates.get(address) || null;
  }

  /**
   * @param {string} type
   * @param {Function} listener
   * @param {object} [options]
   */
  addProxyListener(type, listener, options) {
    this._proxyListeners.push({ type, listener, options });
    const conn = this.getActive();
    if (conn) {
      conn.addEventListener(type, listener, options);
    }
  }

  /**
   * @param {string} type
   * @param {Function} listener
   * @param {object} [options]
   */
  removeProxyListener(type, listener, options) {
    const idx = this._proxyListeners.findIndex(
      l => l.type === type && l.listener === listener
    );
    if (idx >= 0) {
      this._proxyListeners.splice(idx, 1);
    }
    const conn = this.getActive();
    if (conn) {
      conn.removeEventListener(type, listener, options);
    }
  }

  /**
   * @private
   * @param {ServerService|null} oldConn
   * @param {ServerService|null} newConn
   */
  _rebindProxyListeners(oldConn, newConn) {
    for (const { type, listener, options } of this._proxyListeners) {
      if (oldConn) oldConn.removeEventListener(type, listener, options);
      if (newConn) newConn.addEventListener(type, listener, options);
    }
  }

  /**
   * @private
   * @param {ServerService} conn
   */
  _unbindProxyListeners(conn) {
    for (const { type, listener, options } of this._proxyListeners) {
      conn.removeEventListener(type, listener, options);
    }
  }
}

const connectionManager = new ConnectionManager();
export default connectionManager;
