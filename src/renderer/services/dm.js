import connectionManager from './connectionManager.js';

const MSG_STORAGE_PREFIX = 'dm_messages_';
const PURGE_LOG_PREFIX = 'dm_purged_';

/**
 * @typedef {'pending'|'sent'|'delivered'} DmStatus
 *
 * @typedef {object} DmMessage
 * @property {string} id - UUID generated client-side
 * @property {string} peerFingerprint - The other party's fingerprint
 * @property {'sent'|'received'} direction
 * @property {string} content
 * @property {DmStatus} status
 * @property {number} createdAt
 */

/**
 * localStorage key for the message store of a given identity fingerprint.
 * @param {string} ownFingerprint
 * @returns {string}
 */
function storageKey(ownFingerprint) {
  return `${MSG_STORAGE_PREFIX}${ownFingerprint}`;
}

/**
 * @param {string} ownFingerprint
 * @returns {DmMessage[]}
 */
function loadMessages(ownFingerprint) {
  try {
    const raw = localStorage.getItem(storageKey(ownFingerprint));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} ownFingerprint
 * @param {DmMessage[]} messages
 */
function saveMessages(ownFingerprint, messages) {
  localStorage.setItem(storageKey(ownFingerprint), JSON.stringify(messages));
}

/**
 * Loads the purge log: a map of peerFingerprint → purge timestamp.
 * Messages from a peer received before their purge timestamp are silently discarded.
 * @param {string} ownFingerprint
 * @returns {Record<string, number>}
 */
function loadPurgeLog(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${PURGE_LOG_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} ownFingerprint
 * @param {Record<string, number>} log
 */
function savePurgeLog(ownFingerprint, log) {
  localStorage.setItem(`${PURGE_LOG_PREFIX}${ownFingerprint}`, JSON.stringify(log));
}

/**
 * Manages direct messages for a single identity.
 * Handles local persistence, sending via connected servers, deduplication, and delivery tracking.
 */
export class DmService extends EventTarget {
  /**
   * @param {string} ownFingerprint - The current user's OpenPGP fingerprint
   */
  constructor(ownFingerprint) {
    super();
    this._fingerprint = ownFingerprint;

    /** @type {Map<string, Function>} - serverKey → bound listener for dm:receive */
    this._receiveListeners = new Map();
    /** @type {Map<string, Function>} - serverKey → bound listener for dm:delivered */
    this._deliveredListeners = new Map();

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
   * Attaches dm:receive and dm:delivered listeners to a server connection.
   * @private
   * @param {string} key
   */
  _bindConnection(key) {
    if (this._receiveListeners.has(key)) {
      return;
    }

    const conn = connectionManager.getConnection(key);
    if (!conn) {
      return;
    }

    const onReceive = (e) => this._handleReceived(e.detail);
    const onDelivered = (e) => this._handleDelivered(e.detail);

    conn.addEventListener('dm:receive', onReceive);
    conn.addEventListener('dm:delivered', onDelivered);

    this._receiveListeners.set(key, onReceive);
    this._deliveredListeners.set(key, onDelivered);
  }

  /**
   * Removes dm listeners from a server connection.
   * @private
   * @param {string} key
   */
  _unbindConnection(key) {
    const conn = connectionManager.getConnection(key);
    const onReceive = this._receiveListeners.get(key);
    const onDelivered = this._deliveredListeners.get(key);

    if (conn && onReceive) {
      conn.removeEventListener('dm:receive', onReceive);
      conn.removeEventListener('dm:delivered', onDelivered);
    }

    this._receiveListeners.delete(key);
    this._deliveredListeners.delete(key);
  }

  /**
   * Picks a connected server to route a DM through.
   * Prefers the active server, falls back to any other connected server.
   * @private
   * @returns {{key: string, conn: object}|null}
   */
  _pickServer() {
    const activeKey = connectionManager.activeKey;
    if (activeKey) {
      const conn = connectionManager.getConnection(activeKey);
      if (conn?.connected) {
        return { key: activeKey, conn };
      }
    }
    for (const [key, conn] of connectionManager.connections) {
      if (conn.connected) {
        return { key, conn };
      }
    }
    return null;
  }

  /**
   * Sends a direct message to a recipient identified by fingerprint.
   * Generates a UUID client-side, stores locally as 'sent', and transmits via the best available server.
   * @param {string} recipientFingerprint
   * @param {string} content
   * @returns {Promise<DmMessage>} The stored message object
   */
  async sendDm(recipientFingerprint, content) {
    const id = crypto.randomUUID();
    const now = Date.now();

    /** @type {DmMessage} */
    const message = {
      id,
      peerFingerprint: recipientFingerprint,
      direction: 'sent',
      content,
      status: 'pending',
      createdAt: now,
    };

    this._storeMessage(message);
    this.dispatchEvent(new CustomEvent('message-updated', { detail: message }));

    const server = this._pickServer();
    if (!server) {
      throw new Error('No server connected');
    }

    try {
      await server.conn.request('dm:send', { id, recipientFingerprint, content });
      this._updateStatus(id, 'sent');
    } catch (err) {
      // Leave as 'pending' so the UI can offer a retry
      throw err;
    }

    return this._getMessage(id);
  }

  /**
   * Retries sending a pending message via a specific server.
   * Uses the original UUID so the recipient deduplicates correctly.
   * @param {string} messageId
   * @param {string} serverKey - Key of the server to retry through
   */
  async retrySend(messageId, serverKey) {
    const messages = loadMessages(this._fingerprint);
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) {
      throw new Error('Message not found');
    }

    const conn = connectionManager.getConnection(serverKey);
    if (!conn?.connected) {
      throw new Error('Server not connected');
    }

    await conn.request('dm:send', { id: msg.id, recipientFingerprint: msg.peerFingerprint, content: msg.content });
    this._updateStatus(messageId, 'sent');
  }

  /**
   * Returns messages for a conversation with a specific peer, sorted oldest-first.
   * @param {string} peerFingerprint
   * @returns {DmMessage[]}
   */
  getConversation(peerFingerprint) {
    return loadMessages(this._fingerprint)
      .filter((m) => m.peerFingerprint === peerFingerprint)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Returns a map of peerFingerprint → last message, for rendering the conversation list.
   * @returns {Map<string, DmMessage>}
   */
  getConversationList() {
    const latest = new Map();
    for (const msg of loadMessages(this._fingerprint)) {
      const existing = latest.get(msg.peerFingerprint);
      if (!existing || msg.createdAt > existing.createdAt) {
        latest.set(msg.peerFingerprint, msg);
      }
    }
    return latest;
  }

  /**
   * Fetches DM history for a conversation from the server and merges it into local storage.
   * @param {string} peerFingerprint
   * @param {string} serverKey - Which server to query
   * @param {{ before?: number, limit?: number }} [options]
   */
  async fetchHistory(peerFingerprint, serverKey, { before, limit } = {}) {
    const conn = connectionManager.getConnection(serverKey);
    if (!conn?.connected) {
      return;
    }

    const { messages } = await conn.request('dm:history', { peerFingerprint, before, limit });
    const messages_ = loadMessages(this._fingerprint);
    const knownIds = new Set(messages_.map((m) => m.id));

    for (const raw of messages) {
      if (knownIds.has(raw.id)) {
        continue;
      }
      const direction = raw.sender_fingerprint === this._fingerprint ? 'sent' : 'received';
      messages_.push({
        id: raw.id,
        peerFingerprint,
        direction,
        content: raw.content,
        status: raw.delivered_at ? 'delivered' : 'sent',
        createdAt: raw.created_at,
      });
    }

    saveMessages(this._fingerprint, messages_);
    this.dispatchEvent(new CustomEvent('history-loaded', { detail: { peerFingerprint } }));
  }

  /**
   * Handles an incoming dm:receive event from any server.
   * Deduplicates by UUID, stores locally, sends acknowledgment.
   * @private
   * @param {object} detail
   */
  _handleReceived(detail) {
    const { id, senderFingerprint, content, createdAt } = detail;

    const purgeLog = loadPurgeLog(this._fingerprint);
    const purgedAt = purgeLog[senderFingerprint];
    if (purgedAt && createdAt <= purgedAt) {
      this._sendAck(id, senderFingerprint);
      return;
    }

    const messages = loadMessages(this._fingerprint);
    if (messages.some((m) => m.id === id)) {
      // Already received — send ack again in case the server missed the first one
      this._sendAck(id, senderFingerprint);
      return;
    }

    /** @type {DmMessage} */
    const message = {
      id,
      peerFingerprint: senderFingerprint,
      direction: 'received',
      content,
      status: 'delivered',
      createdAt,
    };

    messages.push(message);
    saveMessages(this._fingerprint, messages);

    this._sendAck(id, senderFingerprint);
    this.dispatchEvent(new CustomEvent('message-received', { detail: message }));
  }

  /**
   * Handles a dm:delivered event, updating the local message status.
   * @private
   * @param {object} detail
   */
  _handleDelivered({ id }) {
    this._updateStatus(id, 'delivered');
  }

  /**
   * Sends a dm:ack to the server that delivered the message.
   * Tries all connected servers since we don't know which one the sender is on.
   * @private
   * @param {string} messageId
   * @param {string} senderFingerprint
   */
  _sendAck(messageId, senderFingerprint) {
    for (const [, conn] of connectionManager.connections) {
      if (conn.connected) {
        conn.send('dm:ack', { id: messageId, senderFingerprint });
      }
    }
  }

  /**
   * Stores a message in localStorage.
   * @private
   * @param {DmMessage} message
   */
  _storeMessage(message) {
    const messages = loadMessages(this._fingerprint);
    messages.push(message);
    saveMessages(this._fingerprint, messages);
  }

  /**
   * Updates the status of a locally stored message by ID.
   * @private
   * @param {string} id
   * @param {DmStatus} status
   */
  _updateStatus(id, status) {
    const messages = loadMessages(this._fingerprint);
    const msg = messages.find((m) => m.id === id);
    if (msg) {
      msg.status = status;
      saveMessages(this._fingerprint, messages);
      this.dispatchEvent(new CustomEvent('message-updated', { detail: { ...msg } }));
    }
  }

  /**
   * Removes all locally stored messages for a conversation with the given peer.
   * Records a purge timestamp so future re-deliveries of old messages are discarded.
   * Also acks pending received messages for the online case.
   * @param {string} peerFingerprint
   */
  purgeConversation(peerFingerprint) {
    const purgedAt = Date.now();
    const all = loadMessages(this._fingerprint);

    for (const msg of all) {
      if (msg.peerFingerprint === peerFingerprint && msg.direction === 'received') {
        this._sendAck(msg.id, peerFingerprint);
      }
    }

    saveMessages(this._fingerprint, all.filter((m) => m.peerFingerprint !== peerFingerprint));

    const log = loadPurgeLog(this._fingerprint);
    log[peerFingerprint] = purgedAt;
    savePurgeLog(this._fingerprint, log);

    this.dispatchEvent(new CustomEvent('conversation-purged', { detail: { peerFingerprint } }));
  }

  /**
   * Returns a single message by ID from local storage.
   * @private
   * @param {string} id
   * @returns {DmMessage|null}
   */
  _getMessage(id) {
    return loadMessages(this._fingerprint).find((m) => m.id === id) ?? null;
  }
}
