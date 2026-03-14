import { ServerService } from './serverConnection.js';

/**
 * @param {string} address
 * @param {string|null} [identityFingerprint]
 * @returns {string}
 */
export function connKey(address, identityFingerprint) {
  return identityFingerprint ? address + '\0' + identityFingerprint : address;
}

/**
 * @param {string} key
 * @returns {string}
 */
export function addressFromKey(key) {
  const idx = key.indexOf('\0');
  return idx >= 0 ? key.slice(0, idx) : key;
}

class ConnectionManager extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, ServerService>} */
    this._connections = new Map();
    /** @type {string|null} */
    this._activeKey = null;
    /** @type {string|null} */
    this._voiceKey = null;
    /** @type {Array<{type: string, listener: Function, options: any}>} */
    this._proxyListeners = [];
    /** @type {Map<string, {server: object, chat: object}>} */
    this._serverStates = new Map();
    /** @type {Map<string, {nickname: string, password: string|undefined, publicKey: string|undefined}>} */
    this._credentials = new Map();
    /** @type {Map<string, string>} */
    this._connectionStatus = new Map();
    /** @type {Map<string, object>} */
    this._connectData = new Map();
    /** @type {Map<string, 'observe'|'full'>} */
    this._connectionModes = new Map();
  }

  /**
   * @param {string} key
   * @param {string} address
   * @param {string} nickname
   * @param {string} [password]
   * @param {string} [publicKey]
   * @returns {Promise<object>}
   */
  async connect(key, address, nickname, password, publicKey) {
    if (this._connections.has(key)) {
      this.switchView(key);
      const conn = this._connections.get(key);
      return { clientId: conn.clientId, serverName: conn.serverName, _connKey: key };
    }

    const conn = new ServerService();
    const data = await conn.connect(address, nickname, password, publicKey);

    this._connections.set(key, conn);
    this._credentials.set(key, { nickname, password, publicKey });
    this._connectionStatus.set(key, 'connected');
    this._connectData.set(key, data);
    this._connectionModes.set(key, 'full');
    this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'connected' } }));

    this._bindReconnectEvents(key, conn);

    conn.addEventListener('disconnected', (e) => {
      this._onConnectionLost(key, e.detail?.reason, e.detail?.disconnectType);
    });

    this.dispatchEvent(
      new CustomEvent('connection-added', {
        detail: { key, conn },
      }),
    );

    return data;
  }

  /**
   * @param {Array} servers
   * @param {Array} identities
   */
  async connectAll(servers, identities) {
    const pending = [];
    for (const server of servers) {
      const key = connKey(server.address, server.identityFingerprint);
      if (this._connections.has(key)) {
        continue;
      }

      let publicKey;
      if (server.identityFingerprint) {
        const match = identities.find((i) => i.fingerprint === server.identityFingerprint);
        publicKey = match ? match.publicKeyArmored : undefined;
      }
      if (!publicKey) {
        const defaultId = identities.find((i) => i.isDefault) || identities[0];
        publicKey = defaultId ? defaultId.publicKeyArmored : undefined;
      }

      this._connectionStatus.set(key, 'connecting');
      this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'connecting' } }));

      pending.push({ key, server, publicKey });
    }

    const concurrency = 5;
    let i = 0;
    const runNext = () => {
      if (i >= pending.length) {
        return;
      }
      const { key, server, publicKey } = pending[i++];
      this._connectInBackground(key, server, publicKey).then(runNext, runNext);
    };
    for (let j = 0; j < Math.min(concurrency, pending.length); j++) {
      runNext();
    }
  }

  /**
   * @private
   * @param {string} key
   * @param {object} server
   * @param {string} [publicKey]
   */
  async _connectInBackground(key, server, publicKey) {
    try {
      const conn = new ServerService();
      const data = await conn.connect(server.address, server.nickname, server.password || undefined, publicKey, { mode: 'observe' });

      this._connections.set(key, conn);
      this._credentials.set(key, { nickname: server.nickname, password: server.password || undefined, publicKey });
      this._connectionStatus.set(key, 'connected');
      this._connectData.set(key, data);
      this._connectionModes.set(key, 'observe');
      this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'connected' } }));

      this._bindReconnectEvents(key, conn);

      conn.addEventListener('disconnected', (e) => {
        this._onConnectionLost(key, e.detail?.reason, e.detail?.disconnectType);
      });

      this.dispatchEvent(new CustomEvent('background-connected', { detail: { key, data, server } }));
    } catch {
      this._connectionStatus.set(key, 'disconnected');
      this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'disconnected' } }));
    }
  }

  /**
   * @private
   * @param {string} key
   * @param {ServerService} conn
   */
  _bindReconnectEvents(key, conn) {
    conn.addEventListener('reconnecting', (e) => {
      this._connectionStatus.set(key, 'reconnecting');
      this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'reconnecting' } }));
      this.dispatchEvent(new CustomEvent('reconnecting', { detail: { key, attempt: e.detail.attempt } }));
    });

    conn.addEventListener('reconnected', (e) => {
      this._connectionStatus.set(key, 'connected');
      this._connectData.set(key, e.detail);
      this._connectionModes.set(key, e.detail.mode || 'full');
      this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'connected' } }));
      this.dispatchEvent(new CustomEvent('reconnected', { detail: { key, data: e.detail } }));
    });
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  getStatus(key) {
    return this._connectionStatus.get(key) || 'disconnected';
  }

  /**
   * @param {string} key
   */
  switchView(key) {
    if (key === this._activeKey) {
      return;
    }
    if (!this._connections.has(key)) {
      return;
    }

    const oldKey = this._activeKey;
    const oldConn = oldKey ? this._connections.get(oldKey) : null;
    const newConn = this._connections.get(key);

    if (oldConn) {
      oldConn.send('server:set-mode', { mode: 'background' });
    }
    if (newConn) {
      newConn.send('server:set-mode', { mode: 'active' });
    }

    this._rebindProxyListeners(oldConn, newConn);
    this._activeKey = key;

    this.dispatchEvent(
      new CustomEvent('view-switched', {
        detail: { from: oldKey, to: key },
      }),
    );
  }

  /**
   * Sets all connections to background mode (used when entering DM view).
   */
  setAllBackground() {
    for (const [, conn] of this._connections) {
      conn.send('server:set-mode', { mode: 'background' });
    }
  }

  /**
   * Sets a specific connection to active mode.
   * @param {string} key
   */
  setActive(key) {
    const conn = this._connections.get(key);
    if (conn) {
      conn.send('server:set-mode', { mode: 'active' });
    }
  }

  /**
   * @param {string} key
   */
  disconnect(key) {
    const conn = this._connections.get(key);
    if (!conn) {
      return;
    }

    conn.stopReconnect();
    conn.disconnect();
    this._connections.delete(key);
    this._serverStates.delete(key);
    this._credentials.delete(key);
    this._connectData.delete(key);
    this._connectionModes.delete(key);
    this._connectionStatus.set(key, 'disconnected');

    if (this._voiceKey === key) {
      this._voiceKey = null;
    }

    if (this._activeKey === key) {
      this._activeKey = null;
      const remaining = [...this._connections.keys()];
      if (remaining.length > 0) {
        this.switchView(remaining[0]);
      } else {
        this._unbindProxyListeners(conn);
        this.dispatchEvent(new CustomEvent('all-disconnected'));
      }
    }

    this.dispatchEvent(
      new CustomEvent('connection-removed', {
        detail: { key },
      }),
    );
  }

  /**
   * @returns {void}
   */
  disconnectAll() {
    for (const [, conn] of this._connections) {
      conn.stopReconnect();
      conn.disconnect();
    }
    const oldActive = this._activeKey ? this._connections.get(this._activeKey) : null;
    if (oldActive) {
      this._unbindProxyListeners(oldActive);
    }
    this._connections.clear();
    this._serverStates.clear();
    this._credentials.clear();
    this._connectData.clear();
    this._connectionModes.clear();
    this._connectionStatus.clear();
    this._activeKey = null;
    this._voiceKey = null;
    this.dispatchEvent(new CustomEvent('all-disconnected'));
  }

  /**
   * @private
   * @param {string} key
   * @param {string} [reason]
   * @param {string} [disconnectType]
   */
  _onConnectionLost(key, reason, disconnectType) {
    const hadVoice = this._voiceKey === key;
    if (hadVoice) {
      this._voiceKey = null;
    }

    const willReconnect = disconnectType === 'connection-lost' || disconnectType === 'shutdown';

    if (willReconnect) {
      this._connectionStatus.set(key, 'reconnecting');
      this._serverStates.delete(key);
      this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'reconnecting' } }));
      this.dispatchEvent(
        new CustomEvent('connection-lost', {
          detail: { key, reason, hadVoice, willReconnect: true },
        }),
      );
      return;
    }

    this._connections.delete(key);
    this._serverStates.delete(key);
    this._credentials.delete(key);
    this._connectData.delete(key);
    this._connectionModes.delete(key);
    this._connectionStatus.set(key, 'disconnected');
    this.dispatchEvent(new CustomEvent('connection-status-changed', { detail: { key, status: 'disconnected' } }));

    if (this._activeKey === key) {
      this._activeKey = null;
      const remaining = [...this._connections.keys()];
      if (remaining.length > 0) {
        this.switchView(remaining[0]);
      } else {
        this.dispatchEvent(new CustomEvent('all-disconnected'));
      }
    }

    this.dispatchEvent(
      new CustomEvent('connection-lost', {
        detail: { key, reason, hadVoice, willReconnect: false },
      }),
    );
  }

  /**
   * @param {string} key
   */
  setVoiceServer(key) {
    this._voiceKey = key;
    this.dispatchEvent(
      new CustomEvent('voice-server-changed', {
        detail: { key },
      }),
    );
  }

  /**
   * @returns {void}
   */
  clearVoiceServer() {
    this._voiceKey = null;
    this.dispatchEvent(
      new CustomEvent('voice-server-changed', {
        detail: { key: null },
      }),
    );
  }

  /**
   * @param {string} key
   * @returns {'observe'|'full'|null}
   */
  getMode(key) {
    return this._connectionModes.get(key) || null;
  }

  /**
   * @param {string} key
   * @returns {Promise<object>}
   */
  async upgrade(key) {
    const conn = this._connections.get(key);
    if (!conn) {
      throw new Error('No connection for key');
    }
    const data = await conn.upgrade();
    this._connectionModes.set(key, 'full');
    this._connectData.set(key, data);
    this.dispatchEvent(new CustomEvent('connection-upgraded', { detail: { key, data } }));
    return data;
  }

  /**
   * @returns {ServerService|null}
   */
  getActive() {
    if (!this._activeKey) {
      return null;
    }
    return this._connections.get(this._activeKey) || null;
  }

  /**
   * @returns {ServerService|null}
   */
  getVoice() {
    if (!this._voiceKey) {
      return null;
    }
    return this._connections.get(this._voiceKey) || null;
  }

  /**
   * @param {string} key
   * @returns {ServerService|null}
   */
  getConnection(key) {
    return this._connections.get(key) || null;
  }

  /** @returns {string|null} */
  get activeKey() {
    return this._activeKey;
  }

  /** @param {string|null} key */
  set activeKey(key) {
    this._activeKey = key;
  }

  /** @returns {string|null} */
  get voiceKey() {
    return this._voiceKey;
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
   * @param {string} key
   * @returns {boolean}
   */
  isConnected(key) {
    const conn = this._connections.get(key);
    return conn ? !!conn.connected : false;
  }

  /**
   * @param {string} key
   * @returns {{nickname: string, password: string|undefined, publicKey: string|undefined}|null}
   */
  getCredentials(key) {
    return this._credentials.get(key) || null;
  }

  /**
   * @param {string} key
   * @param {object} state
   */
  saveServerState(key, state) {
    this._serverStates.set(key, state);
  }

  /**
   * @param {string} key
   * @returns {object|null}
   */
  getServerState(key) {
    return this._serverStates.get(key) || null;
  }

  /**
   * @param {string} key
   * @returns {object|null}
   */
  getConnectData(key) {
    const data = this._connectData.get(key) || null;
    if (data) {
      this._connectData.delete(key);
    }
    return data;
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
    const idx = this._proxyListeners.findIndex((l) => l.type === type && l.listener === listener);
    if (idx >= 0) {
      this._proxyListeners.splice(idx, 1);
    }
    const conn = this.getActive();
    if (conn) {
      conn.removeEventListener(type, listener, options);
    }
  }

  /**
   * @param {ServerService|null} oldConn
   * @param {ServerService|null} newConn
   */
  _rebindProxyListeners(oldConn, newConn) {
    for (const { type, listener, options } of this._proxyListeners) {
      if (oldConn) {
        oldConn.removeEventListener(type, listener, options);
      }
      if (newConn) {
        newConn.addEventListener(type, listener, options);
      }
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
