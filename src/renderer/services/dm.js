import connectionManager from './connectionManager.js';

const MSG_STORAGE_PREFIX = 'dm_messages_';
const CONV_STORAGE_PREFIX = 'dm_conversations_';
const PURGE_LOG_PREFIX = 'dm_purged_';
const REACTIONS_STORAGE_PREFIX = 'dm_reactions_';

/**
 * @typedef {'pending'|'sent'|'delivered'} DmStatus
 *
 * @typedef {object} DmMessage
 * @property {string} id - UUID generated client-side
 * @property {string} conversationId
 * @property {'sent'|'received'} direction
 * @property {string} senderFingerprint
 * @property {string} content - Plaintext (decrypted) content
 * @property {DmStatus} status
 * @property {number} createdAt
 * @property {number} [keyIndex]
 * @property {string|null} [replyTo]
 * @property {string|null} [replyToNickname]
 * @property {string|null} [replyToContent]
 */

/**
 * @typedef {object} Conversation
 * @property {string} id
 * @property {string} name
 * @property {'direct'|'group'} type
 * @property {string} creatorFingerprint
 * @property {Array<{ fingerprint: string, nickname: string, publicKeyArmored: string|null }>} participants
 * @property {string|null} encryptedSessionKey - PGP-encrypted AES key (persisted)
 * @property {string|null} sessionKey - Decrypted AES key (in-memory only)
 * @property {number} createdAt
 */

/**
 * @param {string} ownFingerprint
 * @returns {DmMessage[]}
 */
function loadMessages(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${MSG_STORAGE_PREFIX}${ownFingerprint}`);
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
  localStorage.setItem(`${MSG_STORAGE_PREFIX}${ownFingerprint}`, JSON.stringify(messages));
}

/**
 * @param {string} ownFingerprint
 * @returns {Conversation[]}
 */
function loadConversations(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${CONV_STORAGE_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} ownFingerprint
 * @param {Conversation[]} conversations
 */
function saveConversations(ownFingerprint, conversations) {
  const toSave = conversations.map((c) => ({ ...c, sessionKey: undefined }));
  localStorage.setItem(`${CONV_STORAGE_PREFIX}${ownFingerprint}`, JSON.stringify(toSave));
}

/**
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
 * @param {string} ownFingerprint
 * @returns {Record<string, string[]>}
 */
function loadReactions(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${REACTIONS_STORAGE_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} ownFingerprint
 * @param {Record<string, string[]>} data
 */
function saveReactions(ownFingerprint, data) {
  localStorage.setItem(`${REACTIONS_STORAGE_PREFIX}${ownFingerprint}`, JSON.stringify(data));
}

/**
 * Manages direct messages and group conversations for a single identity.
 */
export class DmService extends EventTarget {
  /**
   * @param {string} ownFingerprint
   * @param {string} ownPublicKeyArmored
   */
  constructor(ownFingerprint, ownPublicKeyArmored) {
    super();
    this._fingerprint = ownFingerprint;
    this._publicKey = ownPublicKeyArmored;

    /** @type {Map<string, Conversation>} */
    this._conversations = new Map();

    /** @type {Map<string, Function>} */
    this._receiveListeners = new Map();
    /** @type {Map<string, Function>} */
    this._deliveredListeners = new Map();
    /** @type {Map<string, Function>} */
    this._inviteListeners = new Map();
    /** @type {Map<string, Function>} */
    this._participantJoinedListeners = new Map();
    /** @type {Map<string, Function>} */
    this._participantLeftListeners = new Map();
    /** @type {Map<string, Function>} */
    this._keyUpdateListeners = new Map();

    this._loadConversationsFromStorage();

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
   * @private
   */
  _loadConversationsFromStorage() {
    const saved = loadConversations(this._fingerprint);
    for (const conv of saved) {
      this._conversations.set(conv.id, { ...conv, sessionKey: null });
    }
  }

  /**
   * @private
   */
  _saveConversationsToStorage() {
    saveConversations(this._fingerprint, [...this._conversations.values()]);
  }

  /**
   * @private
   * @param {string} key
   */
  _bindConnection(key) {
    if (this._receiveListeners.has(key)) return;

    const conn = connectionManager.getConnection(key);
    if (!conn) return;

    const onReceive = (e) => this._handleReceived(e.detail);
    const onDelivered = (e) => this._handleDelivered(e.detail);
    const onInvite = (e) => this._handleConversationInvite(e.detail);
    const onParticipantJoined = (e) => this._handleParticipantJoined(e.detail);
    const onParticipantLeft = (e) => this._handleParticipantLeft(e.detail);
    const onKeyUpdate = (e) => this._handleKeyUpdate(e.detail);

    conn.addEventListener('dm:receive', onReceive);
    conn.addEventListener('dm:delivered', onDelivered);
    conn.addEventListener('conversation:invite', onInvite);
    conn.addEventListener('conversation:participant-joined', onParticipantJoined);
    conn.addEventListener('conversation:participant-left', onParticipantLeft);
    conn.addEventListener('conversation:key-update', onKeyUpdate);

    this._receiveListeners.set(key, onReceive);
    this._deliveredListeners.set(key, onDelivered);
    this._inviteListeners.set(key, onInvite);
    this._participantJoinedListeners.set(key, onParticipantJoined);
    this._participantLeftListeners.set(key, onParticipantLeft);
    this._keyUpdateListeners.set(key, onKeyUpdate);
  }

  /**
   * @private
   * @param {string} key
   */
  _unbindConnection(key) {
    const conn = connectionManager.getConnection(key);
    if (conn) {
      const listeners = [
        ['dm:receive', this._receiveListeners],
        ['dm:delivered', this._deliveredListeners],
        ['conversation:invite', this._inviteListeners],
        ['conversation:participant-joined', this._participantJoinedListeners],
        ['conversation:participant-left', this._participantLeftListeners],
        ['conversation:key-update', this._keyUpdateListeners],
      ];
      for (const [event, map] of listeners) {
        const fn = map.get(key);
        if (fn) conn.removeEventListener(event, fn);
        map.delete(key);
      }
    }
  }

  /**
   * @private
   * @returns {{key: string, conn: object}|null}
   */
  _pickServer() {
    const activeKey = connectionManager.activeKey;
    if (activeKey) {
      const conn = connectionManager.getConnection(activeKey);
      if (conn?.connected) return { key: activeKey, conn };
    }
    let fallback = null;
    for (const [key, conn] of connectionManager.connections) {
      if (conn.connected) {
        if (connectionManager.getMode(key) === 'full') return { key, conn };
        if (!fallback) fallback = { key, conn };
      }
    }
    return fallback;
  }

  // ── Conversation Management ─────────────────────────────────────────────

  /**
   * Creates a new conversation (1:1 or group).
   * @param {Array<{ fingerprint: string, publicKeyArmored: string, nickname: string }>} participants
   * @param {string|null} [name]
   * @returns {Promise<Conversation>}
   */
  async createConversation(participants, name = null) {
    const server = this._pickServer();
    if (!server) throw new Error('No server connected');

    const fingerprints = participants.map((p) => p.fingerprint);
    const needKeys = participants.filter((p) => !p.publicKeyArmored).map((p) => p.fingerprint);
    if (needKeys.length > 0) {
      const { keys } = await server.conn.request('user:get-public-keys', { fingerprints: needKeys });
      for (const p of participants) {
        if (!p.publicKeyArmored && keys[p.fingerprint]) {
          p.publicKeyArmored = keys[p.fingerprint];
        }
      }
    }

    const isGroup = participants.length > 1;
    let encryptedKeys = null;

    if (isGroup) {
      const sessionKey = await window.gimodi.identity.generateSessionKey();
      const allParticipants = [
        { fingerprint: this._fingerprint, publicKeyArmored: this._publicKey },
        ...participants,
      ];
      encryptedKeys = await window.gimodi.identity.encryptSessionKey(sessionKey, allParticipants);
      console.log('[DmService] createConversation encryptedKeys fingerprints:', Object.keys(encryptedKeys));
      console.log('[DmService] createConversation allParticipants:', allParticipants.map((p) => ({ fp: p.fingerprint, hasKey: !!p.publicKeyArmored })));
    }

    const participantFingerprints = fingerprints;

    let result;
    try {
      result = await server.conn.request('conversation:create', {
        participants: participantFingerprints,
        encryptedKeys,
        name: isGroup ? name : null,
      });
    } catch (err) {
      if (err.code === 'CONVERSATION_EXISTS' && err.conversationId) {
        await this.fetchConversations();
        const existing = this._conversations.get(err.conversationId);
        if (existing) return existing;
      }
      throw err;
    }

    const conv = {
      id: result.id,
      name: result.name,
      type: result.type,
      creatorFingerprint: result.creatorFingerprint,
      participants: result.participants,
      encryptedSessionKey: result.encryptedSessionKey ?? null,
      sessionKey: null,
      createdAt: result.createdAt,
    };

    if (isGroup && conv.encryptedSessionKey) {
      conv.sessionKey = await window.gimodi.identity.decryptSessionKey(conv.encryptedSessionKey);
    }

    this._conversations.set(conv.id, conv);
    this._saveConversationsToStorage();
    this.dispatchEvent(new CustomEvent('conversation-created', { detail: conv }));
    return conv;
  }

  /**
   * Fetches all conversations from the server and merges with local state.
   */
  async fetchConversations() {
    const server = this._pickServer();
    if (!server) return;

    const { conversations } = await server.conn.request('conversation:list', {});
    for (const raw of conversations) {
      if (!this._conversations.has(raw.id)) {
        const conv = {
          id: raw.id,
          name: raw.name,
          type: raw.type,
          creatorFingerprint: raw.creatorFingerprint,
          participants: raw.participants,
          encryptedSessionKey: raw.encryptedSessionKey ?? null,
          sessionKey: null,
          createdAt: raw.createdAt,
        };
        if (conv.type === 'group' && conv.encryptedSessionKey) {
          try {
            conv.sessionKey = await window.gimodi.identity.decryptSessionKey(conv.encryptedSessionKey);
          } catch (err) {
            console.error('[DmService] Failed to decrypt session key on fetch for', conv.id, err);
          }
        } else if (conv.type === 'group') {
          console.warn('[DmService] Group conversation fetched without encryptedSessionKey', conv.id);
        }
        this._conversations.set(conv.id, conv);
      } else {
        const existing = this._conversations.get(raw.id);
        existing.participants = raw.participants;
        existing.name = raw.name;
      }
    }
    this._saveConversationsToStorage();
    this.dispatchEvent(new CustomEvent('conversations-loaded'));
  }

  /**
   * @param {string} conversationId
   * @returns {Conversation|null}
   */
  getConversationMeta(conversationId) {
    return this._conversations.get(conversationId) ?? null;
  }

  /**
   * Returns all conversations.
   * @returns {Conversation[]}
   */
  getConversationList() {
    return [...this._conversations.values()];
  }

  /**
   * Returns messages for a conversation, sorted oldest-first.
   * @param {string} conversationId
   * @returns {DmMessage[]}
   */
  getConversation(conversationId) {
    return loadMessages(this._fingerprint)
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Returns the last message for each conversation.
   * @returns {Map<string, DmMessage>}
   */
  getLastMessages() {
    const latest = new Map();
    for (const msg of loadMessages(this._fingerprint)) {
      const existing = latest.get(msg.conversationId);
      if (!existing || msg.createdAt > existing.createdAt) {
        latest.set(msg.conversationId, msg);
      }
    }
    return latest;
  }

  /**
   * Finds a direct conversation by the peer's fingerprint.
   * @param {string} peerFingerprint
   * @returns {Conversation|null}
   */
  findDirectConversation(peerFingerprint) {
    for (const conv of this._conversations.values()) {
      if (conv.type === 'direct' && conv.participants.some((p) => p.fingerprint === peerFingerprint)) {
        return conv;
      }
    }
    return null;
  }

  /**
   * Leaves a group conversation.
   * @param {string} conversationId
   */
  async leaveConversation(conversationId) {
    const server = this._pickServer();
    if (!server) throw new Error('No server connected');

    await server.conn.request('conversation:leave', { conversationId });
    this._conversations.delete(conversationId);
    this._saveConversationsToStorage();
    this.dispatchEvent(new CustomEvent('conversation-left', { detail: { conversationId } }));
  }

  /**
   * Creator removes a participant from a group conversation.
   * @param {string} conversationId
   * @param {string} fingerprint
   */
  async removeParticipant(conversationId, fingerprint) {
    const server = this._pickServer();
    if (!server) throw new Error('No server connected');

    await server.conn.request('conversation:remove-participant', { conversationId, fingerprint });
  }

  /**
   * Creator adds a participant to a group conversation.
   * @param {string} conversationId
   * @param {{ fingerprint: string, publicKeyArmored: string }} participant
   */
  async addParticipant(conversationId, participant) {
    const conv = this._conversations.get(conversationId);
    if (!conv || conv.type !== 'group') throw new Error('Invalid conversation');

    const server = this._pickServer();
    if (!server) throw new Error('No server connected');

    if (!participant.publicKeyArmored) {
      const { keys } = await server.conn.request('user:get-public-keys', { fingerprints: [participant.fingerprint] });
      participant.publicKeyArmored = keys[participant.fingerprint] ?? null;
    }

    let encryptedKey = null;
    if (conv.sessionKey && participant.publicKeyArmored) {
      const keys = await window.gimodi.identity.encryptSessionKey(conv.sessionKey, [participant]);
      encryptedKey = keys[participant.fingerprint];
    }

    await server.conn.request('conversation:add-participant', {
      conversationId,
      fingerprint: participant.fingerprint,
      encryptedKey,
    });
  }

  // ── Sending Messages ────────────────────────────────────────────────────

  /**
   * Sends a message to a conversation.
   * @param {string} conversationId
   * @param {string} content - Plaintext content
   * @param {{ id: string, nickname: string, content: string }|null} [replyTo]
   * @returns {Promise<DmMessage>}
   */
  async sendDm(conversationId, content, replyTo = null) {
    const conv = this._conversations.get(conversationId);
    if (!conv) throw new Error('Conversation not found');

    const server = this._pickServer();
    if (!server) throw new Error('No server connected');

    const id = crypto.randomUUID();
    const now = Date.now();

    let encryptedContent;
    let keyIndex = 0;

    if (conv.type === 'direct') {
      let recipientPubKeys = conv.participants
        .map((p) => p.publicKeyArmored)
        .filter(Boolean);

      if (recipientPubKeys.length < conv.participants.length) {
        const needKeys = conv.participants.filter((p) => !p.publicKeyArmored).map((p) => p.fingerprint);
        if (needKeys.length > 0) {
          const { keys } = await server.conn.request('user:get-public-keys', { fingerprints: needKeys });
          for (const p of conv.participants) {
            if (!p.publicKeyArmored && keys[p.fingerprint]) {
              p.publicKeyArmored = keys[p.fingerprint];
            }
          }
          this._saveConversationsToStorage();
          recipientPubKeys = conv.participants.map((p) => p.publicKeyArmored).filter(Boolean);
        }
      }

      recipientPubKeys.push(this._publicKey);
      encryptedContent = await window.gimodi.identity.encrypt(recipientPubKeys, content);
    } else {
      if (!conv.sessionKey) throw new Error('Session key not available');
      encryptedContent = await window.gimodi.identity.encryptSymmetric(conv.sessionKey, content);
    }

    /** @type {DmMessage} */
    const message = {
      id,
      conversationId,
      direction: 'sent',
      senderFingerprint: this._fingerprint,
      content,
      status: 'pending',
      createdAt: now,
      keyIndex,
      replyTo: replyTo?.id ?? null,
      replyToNickname: replyTo?.nickname ?? null,
      replyToContent: replyTo?.content ?? null,
    };

    this._storeMessage(message);
    this.dispatchEvent(new CustomEvent('message-updated', { detail: message }));

    const payload = { id, conversationId, content: encryptedContent, keyIndex };
    if (replyTo?.id) {
      payload.replyTo = replyTo.id;
      payload.replyToNickname = replyTo.nickname ?? null;
      payload.replyToContent = replyTo.content ?? null;
    }

    try {
      await server.conn.request('dm:send', payload);
      this._updateStatus(id, 'sent');
    } catch (err) {
      throw err;
    }

    return this._getMessage(id);
  }

  /**
   * Retries sending a pending message.
   * @param {string} messageId
   * @param {string} serverKey
   */
  async retrySend(messageId, serverKey) {
    const msg = this._getMessage(messageId);
    if (!msg) throw new Error('Message not found');

    const conv = this._conversations.get(msg.conversationId);
    if (!conv) throw new Error('Conversation not found');

    const conn = connectionManager.getConnection(serverKey);
    if (!conn?.connected) throw new Error('Server not connected');

    let encryptedContent;
    if (conv.type === 'direct') {
      let recipientPubKeys = conv.participants.map((p) => p.publicKeyArmored).filter(Boolean);
      if (recipientPubKeys.length < conv.participants.length) {
        const needKeys = conv.participants.filter((p) => !p.publicKeyArmored).map((p) => p.fingerprint);
        if (needKeys.length > 0) {
          const { keys } = await conn.request('user:get-public-keys', { fingerprints: needKeys });
          for (const p of conv.participants) {
            if (!p.publicKeyArmored && keys[p.fingerprint]) {
              p.publicKeyArmored = keys[p.fingerprint];
            }
          }
          this._saveConversationsToStorage();
          recipientPubKeys = conv.participants.map((p) => p.publicKeyArmored).filter(Boolean);
        }
      }
      recipientPubKeys.push(this._publicKey);
      encryptedContent = await window.gimodi.identity.encrypt(recipientPubKeys, msg.content);
    } else {
      if (!conv.sessionKey) throw new Error('Session key not available');
      encryptedContent = await window.gimodi.identity.encryptSymmetric(conv.sessionKey, msg.content);
    }

    await conn.request('dm:send', { id: msg.id, conversationId: msg.conversationId, content: encryptedContent, keyIndex: msg.keyIndex ?? 0 });
    this._updateStatus(messageId, 'sent');
  }

  // ── History ─────────────────────────────────────────────────────────────

  /**
   * Fetches message history for a conversation from the server.
   * @param {string} conversationId
   * @param {string} serverKey
   * @param {{ before?: number, limit?: number }} [options]
   */
  async fetchHistory(conversationId, serverKey, { before, limit } = {}) {
    const conn = connectionManager.getConnection(serverKey);
    if (!conn?.connected) return;

    const conv = this._conversations.get(conversationId);
    if (!conv) return;

    const { messages: rawMessages } = await conn.request('dm:history', { conversationId, before, limit });
    const stored = loadMessages(this._fingerprint);
    const knownIds = new Set(stored.map((m) => m.id));

    for (const raw of rawMessages) {
      if (knownIds.has(raw.id)) continue;

      let plaintext;
      try {
        plaintext = await this._decryptContent(conv, raw.content);
      } catch {
        plaintext = '[Decryption failed]';
      }

      stored.push({
        id: raw.id,
        conversationId,
        direction: raw.sender_fingerprint === this._fingerprint ? 'sent' : 'received',
        senderFingerprint: raw.sender_fingerprint,
        content: plaintext,
        status: raw.delivered_at ? 'delivered' : 'sent',
        createdAt: raw.created_at,
        keyIndex: raw.key_index ?? 0,
        replyTo: raw.reply_to ?? null,
        replyToNickname: raw.reply_to_nickname ?? null,
        replyToContent: raw.reply_to_content ?? null,
      });
    }

    saveMessages(this._fingerprint, stored);
    this.dispatchEvent(new CustomEvent('history-loaded', { detail: { conversationId } }));
  }

  // ── Event Handlers ──────────────────────────────────────────────────────

  /**
   * @private
   * @param {object} detail
   */
  async _handleReceived(detail) {
    const { id, conversationId, senderFingerprint, content, createdAt, keyIndex, replyTo, replyToNickname, replyToContent } = detail;

    const conv = this._conversations.get(conversationId);
    if (!conv) return;

    const purgeLog = loadPurgeLog(this._fingerprint);
    const purgedAt = purgeLog[conversationId];
    if (purgedAt && createdAt <= purgedAt) {
      this._sendAck(id, senderFingerprint);
      return;
    }

    const messages = loadMessages(this._fingerprint);
    if (messages.some((m) => m.id === id)) {
      this._sendAck(id, senderFingerprint);
      return;
    }

    let plaintext;
    try {
      plaintext = await this._decryptContent(conv, content);
    } catch {
      plaintext = '[Decryption failed]';
    }

    /** @type {DmMessage} */
    const message = {
      id,
      conversationId,
      direction: 'received',
      senderFingerprint,
      content: plaintext,
      status: 'delivered',
      createdAt,
      keyIndex: keyIndex ?? 0,
      replyTo: replyTo ?? null,
      replyToNickname: replyToNickname ?? null,
      replyToContent: replyToContent ?? null,
    };

    messages.push(message);
    saveMessages(this._fingerprint, messages);

    this._sendAck(id, senderFingerprint);
    this.dispatchEvent(new CustomEvent('message-received', { detail: message }));
  }

  /**
   * @private
   * @param {object} detail
   */
  _handleDelivered({ id }) {
    this._updateStatus(id, 'delivered');
  }

  /**
   * @private
   * @param {object} detail
   */
  async _handleConversationInvite(detail) {
    const { conversationId, name, type, creatorFingerprint, participants, encryptedKey } = detail;

    if (this._conversations.has(conversationId)) {
      const existing = this._conversations.get(conversationId);
      existing.participants = participants;
      existing.name = name;
      this._saveConversationsToStorage();
      return;
    }

    let sessionKey = null;
    if (type === 'group' && encryptedKey) {
      try {
        sessionKey = await window.gimodi.identity.decryptSessionKey(encryptedKey);
      } catch (err) {
        console.error('[DmService] Failed to decrypt session key for conversation', conversationId, err);
      }
    } else if (type === 'group') {
      console.warn('[DmService] Group conversation invite received without encryptedKey', conversationId);
    }

    const conv = {
      id: conversationId,
      name,
      type,
      creatorFingerprint,
      participants,
      encryptedSessionKey: encryptedKey,
      sessionKey,
      createdAt: Date.now(),
    };

    this._conversations.set(conversationId, conv);
    this._saveConversationsToStorage();

    const server = this._pickServer();
    if (server) {
      server.conn.send('conversation:joined', { conversationId });
    }

    this.dispatchEvent(new CustomEvent('conversation-invite', { detail: conv }));
  }

  /**
   * @private
   * @param {object} detail
   */
  _handleParticipantJoined(detail) {
    const { conversationId, fingerprint, nickname } = detail;
    const conv = this._conversations.get(conversationId);
    if (!conv) return;

    if (!conv.participants.some((p) => p.fingerprint === fingerprint)) {
      conv.participants.push({ fingerprint, nickname });
      this._saveConversationsToStorage();
      this.dispatchEvent(new CustomEvent('participant-changed', { detail: { conversationId } }));
    }
  }

  /**
   * @private
   * @param {object} detail
   */
  _handleParticipantLeft(detail) {
    const { conversationId, fingerprint } = detail;
    const conv = this._conversations.get(conversationId);
    if (!conv) return;

    if (fingerprint === this._fingerprint) {
      this._conversations.delete(conversationId);
      this._saveConversationsToStorage();
      this.dispatchEvent(new CustomEvent('conversation-left', { detail: { conversationId } }));
      return;
    }

    conv.participants = conv.participants.filter((p) => p.fingerprint !== fingerprint);
    this._saveConversationsToStorage();
    this.dispatchEvent(new CustomEvent('participant-changed', { detail: { conversationId } }));

    if (conv.type === 'group' && conv.creatorFingerprint === this._fingerprint) {
      this._rotateKey(conversationId).catch(() => {});
    }
  }

  /**
   * @private
   * @param {object} detail
   */
  async _handleKeyUpdate(detail) {
    const { conversationId, encryptedKey, keyIndex } = detail;
    const conv = this._conversations.get(conversationId);
    if (!conv) return;

    try {
      conv.sessionKey = await window.gimodi.identity.decryptSessionKey(encryptedKey);
      conv.encryptedSessionKey = encryptedKey;
      conv.keyIndex = keyIndex ?? 0;
      this._saveConversationsToStorage();
      this.dispatchEvent(new CustomEvent('key-updated', { detail: { conversationId, keyIndex } }));
    } catch {}
  }

  /**
   * Generates a new session key and distributes it to remaining participants.
   * @private
   * @param {string} conversationId
   */
  async _rotateKey(conversationId) {
    const conv = this._conversations.get(conversationId);
    if (!conv || conv.type !== 'group') return;

    const server = this._pickServer();
    if (!server) return;

    const allParticipants = [
      ...conv.participants.map((p) => ({ fingerprint: p.fingerprint, publicKeyArmored: p.publicKeyArmored ?? null })),
      { fingerprint: this._fingerprint, publicKeyArmored: this._publicKey },
    ];

    const needKeys = allParticipants.filter((p) => !p.publicKeyArmored).map((p) => p.fingerprint);
    if (needKeys.length > 0) {
      const { keys } = await server.conn.request('user:get-public-keys', { fingerprints: needKeys });
      for (const p of allParticipants) {
        if (!p.publicKeyArmored && keys[p.fingerprint]) {
          p.publicKeyArmored = keys[p.fingerprint];
        }
      }
    }

    const newKey = await window.gimodi.identity.generateSessionKey();
    const encryptedKeys = await window.gimodi.identity.encryptSessionKey(newKey, allParticipants);
    const keyIndex = (conv.keyIndex ?? 0) + 1;

    await server.conn.request('conversation:key-update', {
      conversationId,
      encryptedKeys,
      keyIndex,
    });

    conv.sessionKey = newKey;
    conv.keyIndex = keyIndex;
    this._saveConversationsToStorage();
  }

  // ── Crypto helpers ──────────────────────────────────────────────────────

  /**
   * Decrypts message content based on conversation type.
   * @private
   * @param {Conversation} conv
   * @param {string} encryptedContent
   * @returns {Promise<string>}
   */
  async _decryptContent(conv, encryptedContent) {
    if (conv.type === 'direct') {
      return window.gimodi.identity.decrypt(encryptedContent);
    }
    if (!conv.sessionKey) throw new Error('No session key');
    return window.gimodi.identity.decryptSymmetric(conv.sessionKey, encryptedContent);
  }

  // ── Storage helpers ─────────────────────────────────────────────────────

  /**
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
   * @private
   * @param {DmMessage} message
   */
  _storeMessage(message) {
    const messages = loadMessages(this._fingerprint);
    messages.push(message);
    saveMessages(this._fingerprint, messages);
  }

  /**
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
   * @param {string} conversationId
   */
  purgeConversation(conversationId) {
    const purgedAt = Date.now();
    const all = loadMessages(this._fingerprint);

    saveMessages(this._fingerprint, all.filter((m) => m.conversationId !== conversationId));

    const log = loadPurgeLog(this._fingerprint);
    log[conversationId] = purgedAt;
    savePurgeLog(this._fingerprint, log);

    for (const msg of all) {
      if (msg.conversationId === conversationId && msg.direction === 'received') {
        try { this._sendAck(msg.id, msg.senderFingerprint); } catch {}
      }
    }

    this.dispatchEvent(new CustomEvent('conversation-purged', { detail: { conversationId } }));
  }

  /**
   * @param {string} messageId
   * @returns {Array<{emoji: string, count: number, userIds: string[], currentUser: boolean}>}
   */
  getReactions(messageId) {
    const data = loadReactions(this._fingerprint);
    return (data[messageId] || []).map((emoji) => ({
      emoji,
      count: 1,
      userIds: [this._fingerprint],
      currentUser: true,
    }));
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  addReaction(messageId, emoji) {
    const data = loadReactions(this._fingerprint);
    const emojis = data[messageId] || [];
    if (!emojis.includes(emoji)) {
      emojis.push(emoji);
      data[messageId] = emojis;
      saveReactions(this._fingerprint, data);
      this.dispatchEvent(new CustomEvent('reaction-changed', { detail: { messageId } }));
    }
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  removeReaction(messageId, emoji) {
    const data = loadReactions(this._fingerprint);
    const emojis = data[messageId] || [];
    const idx = emojis.indexOf(emoji);
    if (idx !== -1) {
      emojis.splice(idx, 1);
      if (emojis.length === 0) {
        delete data[messageId];
      } else {
        data[messageId] = emojis;
      }
      saveReactions(this._fingerprint, data);
      this.dispatchEvent(new CustomEvent('reaction-changed', { detail: { messageId } }));
    }
  }

  /**
   * @private
   * @param {string} id
   * @returns {DmMessage|null}
   */
  _getMessage(id) {
    return loadMessages(this._fingerprint).find((m) => m.id === id) ?? null;
  }
}
