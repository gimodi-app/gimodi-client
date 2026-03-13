import connectionManager from './connectionManager.js';

const STORAGE_KEY_PREFIX = 'dm_friends_';
const IGNORED_KEY_PREFIX = 'dm_ignored_';
const BLOCKED_KEY_PREFIX = 'dm_blocked_';

/**
 * Returns the localStorage key for the friends list of a given identity fingerprint.
 * @param {string} ownFingerprint
 * @returns {string}
 */
function storageKey(ownFingerprint) {
  return `${STORAGE_KEY_PREFIX}${ownFingerprint}`;
}

/**
 * Loads the friends list for the given fingerprint from localStorage.
 * @param {string} ownFingerprint
 * @returns {Array<{fingerprint: string, nickname: string, publicKey?: string, addedAt: number}>}
 */
function loadFriends(ownFingerprint) {
  try {
    const raw = localStorage.getItem(storageKey(ownFingerprint));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the friends list for the given fingerprint to localStorage.
 * @param {string} ownFingerprint
 * @param {Array<{fingerprint: string, nickname: string, publicKey?: string, addedAt: number}>} friends
 */
function saveFriends(ownFingerprint, friends) {
  localStorage.setItem(storageKey(ownFingerprint), JSON.stringify(friends));
}

/**
 * Manages the friends list tied to an identity fingerprint.
 * Combines server-backed friend requests with local caching.
 */
export class FriendsService extends EventTarget {
  /** @param {string} ownFingerprint - The current user's OpenPGP fingerprint */
  constructor(ownFingerprint) {
    super();
    this._fingerprint = ownFingerprint;

    /** @type {Map<string, {requestReceived: Function, accepted: Function, rejected: Function, removed: Function}>} */
    this._listeners = new Map();
    /** @type {Map<string, {requestId: string, senderFingerprint: string, senderNickname: string, senderPublicKey: string, createdAt: number}>} */
    this._pendingRequests = new Map();
    /** @type {Map<string, Map<string, string>>} connKey → Map<clientId, fingerprint> */
    this._connClients = new Map();
    /** @type {Set<string>} fingerprints currently online across all connections */
    this._onlineFingerprints = new Set();

    connectionManager.addEventListener('connection-status-changed', (e) => {
      const { key, status } = e.detail;
      if (status === 'connected') {
        this._bindConnection(key);
      } else if (status === 'disconnected') {
        this._unbindConnection(key);
      }
    });

    for (const [key] of connectionManager.connections) {
      this._bindConnection(key);
    }
  }

  /**
   * Attaches friend event listeners to a server connection.
   * @private
   * @param {string} key
   */
  _bindConnection(key) {
    if (this._listeners.has(key)) {
      return;
    }

    const conn = connectionManager.getConnection(key);
    if (!conn) {
      console.log('[FriendsService] _bindConnection: no conn for key', key);
      return;
    }
    console.log('[FriendsService] Binding friend event listeners to connection', key);

    const onRequestReceived = (e) => this._handleRequestReceived(e.detail);
    const onAccepted = (e) => this._handleAccepted(e.detail);
    const onRejected = (e) => this._handleRejected(e.detail);
    const onRemoved = (e) => this._handleRemoved(e.detail);

    conn.addEventListener('friend:request-received', onRequestReceived);
    conn.addEventListener('friend:accepted', onAccepted);
    conn.addEventListener('friend:rejected', onRejected);
    conn.addEventListener('friend:removed', onRemoved);

    this._listeners.set(key, { requestReceived: onRequestReceived, accepted: onAccepted, rejected: onRejected, removed: onRemoved });

    this._initPresenceForConnection(key, conn);
  }

  /**
   * Removes friend event listeners from a server connection.
   * @private
   * @param {string} key
   */
  _unbindConnection(key) {
    const conn = connectionManager.getConnection(key);
    const handlers = this._listeners.get(key);

    if (conn && handlers) {
      conn.removeEventListener('friend:request-received', handlers.requestReceived);
      conn.removeEventListener('friend:accepted', handlers.accepted);
      conn.removeEventListener('friend:rejected', handlers.rejected);
      conn.removeEventListener('friend:removed', handlers.removed);
      if (handlers._presenceJoined) {
        conn.removeEventListener('server:client-joined', handlers._presenceJoined);
      }
      if (handlers._presenceLeft) {
        conn.removeEventListener('server:client-left', handlers._presenceLeft);
      }
    }

    this._listeners.delete(key);

    this._connClients.delete(key);
    this._rebuildOnlineFingerprints();
    this.dispatchEvent(new CustomEvent('friend:presence-changed'));
  }

  /**
   * Initialises presence tracking for a newly bound connection.
   * Reads the initial client list from connectionManager's stored connect data
   * and attaches server:client-joined / server:client-left listeners.
   * @private
   * @param {string} key
   * @param {object} conn
   */
  _initPresenceForConnection(key, conn) {
    const clientMap = new Map();
    this._connClients.set(key, clientMap);

    const stored = connectionManager._connectData.get(key);
    if (stored?.clients) {
      for (const c of stored.clients) {
        if (c.fingerprint) {
          clientMap.set(c.id, c.fingerprint);
          this._onlineFingerprints.add(c.fingerprint);
        }
      }
    }

    const onJoined = (e) => {
      const { clientId, fingerprint } = e.detail;
      if (clientId && fingerprint) {
        clientMap.set(clientId, fingerprint);
        this._onlineFingerprints.add(fingerprint);
        this.dispatchEvent(new CustomEvent('friend:presence-changed'));
      }
    };

    const onLeft = (e) => {
      const { clientId } = e.detail;
      const fp = clientMap.get(clientId);
      clientMap.delete(clientId);
      if (fp) {
        this._rebuildOnlineFingerprints();
        this.dispatchEvent(new CustomEvent('friend:presence-changed'));
      }
    };

    conn.addEventListener('server:client-joined', onJoined);
    conn.addEventListener('server:client-left', onLeft);

    const existing = this._listeners.get(key);
    if (existing) {
      existing._presenceJoined = onJoined;
      existing._presenceLeft = onLeft;
    }
  }

  /**
   * Rebuilds _onlineFingerprints from all current connection client maps.
   * @private
   */
  _rebuildOnlineFingerprints() {
    this._onlineFingerprints.clear();
    for (const clientMap of this._connClients.values()) {
      for (const fp of clientMap.values()) {
        this._onlineFingerprints.add(fp);
      }
    }
  }

  /**
   * Returns true if the given fingerprint is currently online on any connected server.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  isOnline(fingerprint) {
    return fingerprint ? this._onlineFingerprints.has(fingerprint) : false;
  }

  /**
   * Handles an incoming friend request from the server.
   * @private
   * @param {object} detail
   */
  _handleRequestReceived(detail) {
    console.log('[FriendsService] Received friend:request-received', detail);
    if (this._pendingRequests.has(detail.requestId)) {
      return;
    }
    this._pendingRequests.set(detail.requestId, detail);
    this.dispatchEvent(new CustomEvent('friend:request-received', { detail }));
  }

  /**
   * Handles a friend request acceptance notification.
   * Adds the friend to local storage and dispatches an event.
   * @private
   * @param {object} detail
   */
  _handleAccepted(detail) {
    console.log('[FriendsService] Received friend:accepted', detail);
    const { friendFingerprint, friendNickname, friendPublicKey, requestId } = detail;
    this._addToLocal(friendFingerprint, friendNickname, friendPublicKey);
    if (requestId) {
      this._pendingRequests.delete(requestId);
    }
    this.dispatchEvent(new CustomEvent('friend:accepted', { detail }));
  }

  /**
   * Handles a friend request rejection notification.
   * @private
   * @param {object} detail
   */
  _handleRejected(detail) {
    this.dispatchEvent(new CustomEvent('friend:rejected', { detail }));
  }

  /**
   * Handles a friendship removal notification from the other party.
   * @private
   * @param {object} detail
   */
  _handleRemoved(detail) {
    const { friendFingerprint } = detail;
    this._removeFromLocal(friendFingerprint);
    this.dispatchEvent(new CustomEvent('friend:removed', { detail }));
  }

  /**
   * Sends a friend request to a user identified by fingerprint.
   * @param {string} recipientFingerprint
   * @returns {Promise<object>}
   */
  async sendRequest(recipientFingerprint) {
    console.log('[FriendsService] Sending friend request to', recipientFingerprint);
    const conn = this._getConnection();
    const result = await conn.request('friend:request', { recipientFingerprint });
    console.log('[FriendsService] Friend request result', result);
    return result;
  }

  /**
   * Accepts a pending friend request.
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async acceptRequest(requestId) {
    const conn = this._getConnection();
    const result = await conn.request('friend:accept', { requestId });
    if (result.friendFingerprint) {
      this._addToLocal(result.friendFingerprint, result.friendNickname, result.friendPublicKey);
    }
    this._pendingRequests.delete(requestId);
    return result;
  }

  /**
   * Rejects a pending friend request.
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async rejectRequest(requestId) {
    const conn = this._getConnection();
    this._pendingRequests.delete(requestId);
    return conn.request('friend:reject', { requestId });
  }

  /**
   * Fetches the full friends list and pending requests from the server.
   * Updates local cache with the server data.
   * @returns {Promise<{friends: object[], pendingIncoming: object[]}>}
   */
  async fetchFriends() {
    const conn = this._getConnection();
    const result = await conn.request('friend:list', {});
    return result;
  }

  /**
   * Removes a friendship locally and notifies the peer if they are online.
   * @param {string} friendFingerprint
   */
  async removeServerFriend(friendFingerprint) {
    this._removeFromLocal(friendFingerprint);
    try {
      const conn = this._getConnection();
      await conn.request('friend:remove', { friendFingerprint });
    } catch {
      /* ignore */
    }
  }

  /**
   * Returns all pending incoming friend requests.
   * @returns {Array<{requestId: string, senderFingerprint: string, senderNickname: string, senderPublicKey: string, createdAt: number}>}
   */
  getPendingRequests() {
    return [...this._pendingRequests.values()];
  }

  /**
   * Gets the active server connection or throws.
   * Prefers the active server, then full-mode connections, then observe-mode.
   * @private
   * @returns {object}
   */
  _getConnection() {
    const activeKey = connectionManager.activeKey;
    if (activeKey) {
      const conn = connectionManager.getConnection(activeKey);
      if (conn?.connected) {
        return conn;
      }
    }
    let observeFallback = null;
    for (const [key, conn] of connectionManager.connections) {
      if (conn.connected) {
        if (connectionManager.getMode(key) === 'full') {
          return conn;
        }
        if (!observeFallback) {
          observeFallback = conn;
        }
      }
    }
    if (observeFallback) {
      return observeFallback;
    }
    throw new Error('No server connected');
  }

  /**
   * Adds a friend to local storage if not already present.
   * @private
   * @param {string} fingerprint
   * @param {string} nickname
   * @param {string} [publicKey]
   */
  _addToLocal(fingerprint, nickname, publicKey) {
    const friends = loadFriends(this._fingerprint);
    const existing = friends.find((f) => f.fingerprint === fingerprint);
    if (existing) {
      if (nickname) {
        existing.nickname = nickname;
      }
      if (publicKey) {
        existing.publicKey = publicKey;
      }
      saveFriends(this._fingerprint, friends);
      return;
    }
    friends.push({ fingerprint, nickname, publicKey: publicKey || null, addedAt: Date.now() });
    saveFriends(this._fingerprint, friends);
  }

  /**
   * Removes a friend from local storage.
   * @private
   * @param {string} fingerprint
   */
  _removeFromLocal(fingerprint) {
    const friends = loadFriends(this._fingerprint).filter((f) => f.fingerprint !== fingerprint);
    saveFriends(this._fingerprint, friends);
  }

  /**
   * Returns all friends from local cache.
   * @returns {Array<{fingerprint: string, nickname: string, publicKey?: string, addedAt: number}>}
   */
  getFriends() {
    return loadFriends(this._fingerprint);
  }

  /**
   * Returns a single friend by fingerprint, or null if not found.
   * @param {string} fingerprint
   * @returns {{fingerprint: string, nickname: string, addedAt: number}|null}
   */
  getFriend(fingerprint) {
    return loadFriends(this._fingerprint).find((f) => f.fingerprint === fingerprint) ?? null;
  }

  /**
   * Adds a friend locally. Does nothing if the fingerprint is already in the list.
   * @param {string} fingerprint
   * @param {string} nickname
   */
  addFriend(fingerprint, nickname) {
    this._addToLocal(fingerprint, nickname);
  }

  /**
   * Updates the nickname for an existing friend.
   * @param {string} fingerprint
   * @param {string} nickname
   */
  renameFriend(fingerprint, nickname) {
    const friends = loadFriends(this._fingerprint);
    const friend = friends.find((f) => f.fingerprint === fingerprint);
    if (friend) {
      friend.nickname = nickname;
      saveFriends(this._fingerprint, friends);
    }
  }

  /**
   * Removes a friend by fingerprint (local only).
   * @param {string} fingerprint
   */
  removeFriend(fingerprint) {
    this._removeFromLocal(fingerprint);
  }

  /**
   * Returns true if the given fingerprint is already a friend.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  isFriend(fingerprint) {
    return loadFriends(this._fingerprint).some((f) => f.fingerprint === fingerprint);
  }

  /**
   * Marks a fingerprint as ignored so their DM requests are suppressed.
   * @param {string} fingerprint
   */
  ignoreRequest(fingerprint) {
    try {
      const key = `${IGNORED_KEY_PREFIX}${this._fingerprint}`;
      const raw = localStorage.getItem(key);
      const ignored = raw ? JSON.parse(raw) : [];
      if (!ignored.includes(fingerprint)) {
        ignored.push(fingerprint);
        localStorage.setItem(key, JSON.stringify(ignored));
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Returns true if the given fingerprint has been ignored.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  isIgnored(fingerprint) {
    try {
      const key = `${IGNORED_KEY_PREFIX}${this._fingerprint}`;
      const raw = localStorage.getItem(key);
      const ignored = raw ? JSON.parse(raw) : [];
      return ignored.includes(fingerprint);
    } catch {
      return false;
    }
  }

  /**
   * Blocks a contact. Blocked contacts keep their conversation history visible
   * but incoming messages are suppressed and replies are disabled.
   * @param {string} fingerprint
   */
  blockContact(fingerprint) {
    try {
      const key = `${BLOCKED_KEY_PREFIX}${this._fingerprint}`;
      const raw = localStorage.getItem(key);
      const blocked = raw ? JSON.parse(raw) : [];
      if (!blocked.includes(fingerprint)) {
        blocked.push(fingerprint);
        localStorage.setItem(key, JSON.stringify(blocked));
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Unblocks a previously blocked contact.
   * @param {string} fingerprint
   */
  unblockContact(fingerprint) {
    try {
      const key = `${BLOCKED_KEY_PREFIX}${this._fingerprint}`;
      const raw = localStorage.getItem(key);
      const blocked = (raw ? JSON.parse(raw) : []).filter((fp) => fp !== fingerprint);
      localStorage.setItem(key, JSON.stringify(blocked));
    } catch {
      /* ignore */
    }
  }

  /**
   * Returns true if the given fingerprint is blocked.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  isBlocked(fingerprint) {
    try {
      const key = `${BLOCKED_KEY_PREFIX}${this._fingerprint}`;
      const raw = localStorage.getItem(key);
      const blocked = raw ? JSON.parse(raw) : [];
      return blocked.includes(fingerprint);
    } catch {
      return false;
    }
  }
}
