/**
 * DmService listens to dm:* events on ALL connections, merges conversations
 * by fingerprint, handles route selection for sending, and aggregates presence.
 */
class DmService extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, object[]>} fingerprint → messages[] */
    this._conversations = new Map();
    /** @type {Map<string, object>} fingerprint → { displayName, servers, lastMessage } */
    this._conversationMeta = new Map();
    /** @type {Map<string, boolean>} fingerprint → online */
    this._presence = new Map();
    /** @type {Map<string, Function[]>} connKey → bound listeners */
    this._connListeners = new Map();
    /** @type {import('./connectionManager.js').default|null} */
    this._connectionManager = null;
    /** @type {object[]} */
    this._friends = [];
  }

  /**
   * Initializes the DM service with a connection manager reference.
   * @param {import('./connectionManager.js').default} connectionManager
   */
  init(connectionManager) {
    this._connectionManager = connectionManager;

    for (const [key, conn] of connectionManager.connections) {
      this._bindConnection(key, conn);
    }
  }

  /**
   * Binds dm:* and presence:* listeners to a server connection.
   * @param {string} key
   * @param {import('./serverConnection.js').ServerService} conn
   */
  _bindConnection(key, conn) {
    if (this._connListeners.has(key)) {
      return;
    }

    const onDmReceive = (e) => this._onDmReceive(key, e.detail);
    const onDmDeleted = (e) => this._onDmDeleted(key, e.detail);
    const onDmLinkPreview = (e) => this._onDmLinkPreview(key, e.detail);
    const onPresenceUpdate = (e) => this._onPresenceUpdate(e.detail);

    conn.addEventListener('dm:receive', onDmReceive);
    conn.addEventListener('dm:deleted', onDmDeleted);
    conn.addEventListener('dm:link-preview', onDmLinkPreview);
    conn.addEventListener('presence:update', onPresenceUpdate);

    this._connListeners.set(key, [
      { type: 'dm:receive', fn: onDmReceive },
      { type: 'dm:deleted', fn: onDmDeleted },
      { type: 'dm:link-preview', fn: onDmLinkPreview },
      { type: 'presence:update', fn: onPresenceUpdate },
    ]);
  }

  /**
   * Unbinds listeners from a server connection.
   * @param {string} key
   * @param {import('./serverConnection.js').ServerService} conn
   */
  unbindConnection(key, conn) {
    const listeners = this._connListeners.get(key);
    if (!listeners) {
      return;
    }
    for (const { type, fn } of listeners) {
      conn.removeEventListener(type, fn);
    }
    this._connListeners.delete(key);
  }

  /**
   * Called when a new server connection is added.
   * @param {string} key
   * @param {import('./serverConnection.js').ServerService} conn
   */
  onConnectionAdded(key, conn) {
    this._bindConnection(key, conn);
    this._subscribePresence(key, conn);
  }

  /**
   * Called when a server connection is removed.
   * @param {string} key
   * @param {import('./serverConnection.js').ServerService} conn
   */
  onConnectionRemoved(key, conn) {
    this.unbindConnection(key, conn);
  }

  /**
   * Subscribes to presence updates for all friends on a specific connection.
   * @param {string} key
   * @param {import('./serverConnection.js').ServerService} conn
   */
  _subscribePresence(key, conn) {
    const fingerprints = this._friends.map((f) => f.fingerprint).filter(Boolean);
    if (fingerprints.length > 0) {
      conn.send('presence:subscribe', { fingerprints });
    }
  }

  /**
   * Updates the friends list and re-subscribes presence on all connections.
   * @param {object[]} friends
   */
  setFriends(friends) {
    this._friends = friends;
    if (!this._connectionManager) {
      return;
    }
    const fingerprints = friends.map((f) => f.fingerprint).filter(Boolean);
    if (fingerprints.length === 0) {
      return;
    }
    for (const [key, conn] of this._connectionManager.connections) {
      conn.send('presence:subscribe', { fingerprints });
    }
  }

  /**
   * Returns the fingerprint for a partner userId by looking up friends.
   * @param {string} partnerUserId
   * @param {string} connKey
   * @returns {string|null}
   */
  _resolveFingerprint(partnerUserId, connKey) {
    for (const friend of this._friends) {
      for (const s of friend.servers) {
        if (s.userId === partnerUserId) {
          return friend.fingerprint;
        }
      }
    }

    if (!this._connectionManager) {
      return null;
    }
    const conn = this._connectionManager.getConnection(connKey);
    if (!conn) {
      return null;
    }
    const clients = conn.clients || [];
    for (const c of clients) {
      if (c.userId === partnerUserId && c.fingerprint) {
        return c.fingerprint;
      }
    }
    return null;
  }

  /**
   * @param {string} connKey
   * @param {object} msg
   */
  _onDmReceive(connKey, msg) {
    const conn = this._connectionManager?.getConnection(connKey);
    const myUserId = conn?.userId;
    const partnerUserId = msg.senderUserId === myUserId ? msg.recipientUserId : msg.senderUserId;
    const fingerprint = this._resolveFingerprint(partnerUserId, connKey);

    this.dispatchEvent(
      new CustomEvent('dm-message', {
        detail: { ...msg, fingerprint, connKey, partnerUserId },
      }),
    );
  }

  /**
   * @param {string} connKey
   * @param {object} detail
   */
  _onDmDeleted(connKey, detail) {
    this.dispatchEvent(new CustomEvent('dm-deleted', { detail: { ...detail, connKey } }));
  }

  /**
   * @param {string} connKey
   * @param {object} detail
   */
  _onDmLinkPreview(connKey, detail) {
    this.dispatchEvent(new CustomEvent('dm-link-preview', { detail: { ...detail, connKey } }));
  }

  /**
   * @param {object} detail
   */
  _onPresenceUpdate(detail) {
    const { fingerprint, online } = detail;
    this._presence.set(fingerprint, online);
    this.dispatchEvent(new CustomEvent('presence-update', { detail: { fingerprint, online } }));
  }

  /**
   * Checks if a friend (by fingerprint) is online on any connected server.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  isOnline(fingerprint) {
    return this._presence.get(fingerprint) || false;
  }

  /**
   * Picks the best connection to route a DM through for a given friend.
   * @param {string} fingerprint
   * @returns {{ conn: import('./serverConnection.js').ServerService, recipientUserId: string, connKey: string }|null}
   */
  pickRoute(fingerprint) {
    const friend = this._friends.find((f) => f.fingerprint === fingerprint);
    if (!friend || !this._connectionManager) {
      return null;
    }

    let bestConn = null;
    let bestUserId = null;
    let bestKey = null;

    for (const server of friend.servers) {
      for (const [key, conn] of this._connectionManager.connections) {
        if (!conn.connected) {
          continue;
        }
        const clients = conn.clients || [];
        const friendOnline = clients.some((c) => c.userId === server.userId);

        if (conn.userId && server.address) {
          const connAddress = key.split('\0')[0];
          if (connAddress === server.address || conn.userId) {
            if (friendOnline) {
              return { conn, recipientUserId: server.userId, connKey: key };
            }
            if (!bestConn) {
              bestConn = conn;
              bestUserId = server.userId;
              bestKey = key;
            }
          }
        }
      }
    }

    if (bestConn) {
      return { conn: bestConn, recipientUserId: bestUserId, connKey: bestKey };
    }
    return null;
  }

  /**
   * Sends a DM to a friend, routing through the best available connection.
   * @param {string} fingerprint
   * @param {string} content
   * @param {string} [replyTo]
   * @returns {boolean}
   */
  sendMessage(fingerprint, content, replyTo = null) {
    const route = this.pickRoute(fingerprint);
    if (!route) {
      return false;
    }
    route.conn.send('dm:send', { recipientUserId: route.recipientUserId, content, replyTo });
    return true;
  }

  /**
   * Fetches DM history for a friend through a specific server connection.
   * @param {string} fingerprint
   * @param {number} [before]
   * @param {number} [limit]
   * @returns {Promise<object|null>}
   */
  async fetchHistory(fingerprint, before, limit = 50) {
    const route = this.pickRoute(fingerprint);
    if (!route) {
      return null;
    }
    return route.conn.request('dm:history', { recipientUserId: route.recipientUserId, before, limit });
  }

  /**
   * Fetches DM conversations from all connected servers.
   * @returns {Promise<object[]>}
   */
  async fetchAllConversations() {
    if (!this._connectionManager) {
      return [];
    }

    const promises = [];
    for (const [key, conn] of this._connectionManager.connections) {
      if (conn.connected && conn.userId) {
        promises.push(
          conn
            .request('dm:conversations', {})
            .then((data) => ({ key, conversations: data.conversations || [] }))
            .catch(() => ({ key, conversations: [] })),
        );
      }
    }

    const results = await Promise.all(promises);
    const merged = new Map();

    for (const { key, conversations } of results) {
      for (const conv of conversations) {
        const fp = conv.partnerFingerprint;
        if (!fp) {
          continue;
        }
        const existing = merged.get(fp);
        if (!existing || conv.lastMessage.timestamp > existing.lastMessage.timestamp) {
          merged.set(fp, { ...conv, connKey: key });
        }
      }
    }

    return [...merged.values()];
  }

  /**
   * Deletes a DM message through the appropriate connection.
   * @param {string} fingerprint
   * @param {string} messageId
   * @returns {Promise<object|null>}
   */
  async deleteMessage(fingerprint, messageId) {
    const route = this.pickRoute(fingerprint);
    if (!route) {
      return null;
    }
    return route.conn.request('dm:delete', { messageId });
  }

  /**
   * Cleans up all listeners.
   */
  cleanup() {
    if (this._connectionManager) {
      for (const [key, conn] of this._connectionManager.connections) {
        this.unbindConnection(key, conn);
      }
    }
    this._connListeners.clear();
    this._conversations.clear();
    this._conversationMeta.clear();
    this._presence.clear();
  }
}

const dmService = new DmService();
export default dmService;
