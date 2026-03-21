/**
 * Chat provider that wraps the existing DmService for conversation-based direct messages.
 * Implements the ChatProvider interface with limited feature support.
 */
class DmChatProvider {
  /**
   * @param {import('../dm.js').DmService} dmService
   * @param {string} conversationId
   * @param {string} conversationName
   * @param {string} [ownNickname]
   */
  constructor(dmService, conversationId, conversationName, ownNickname) {
    this._dmService = dmService;
    this._conversationId = conversationId;
    this._conversationName = conversationName;
    this._ownNickname = ownNickname || 'You';

    this.supportsCommands = false;
    this.supportsChannelMentions = false;
    this.supportsPinning = false;
    this.supportsTabs = false;
    this.supportsFileUpload = false;
    this.supportsReactions = true;
    this.supportsReplies = true;
    this.supportsTyping = false;
    this.supportsLinkPreviews = false;
    this.supportsEdit = false;
    this.supportsDelete = false;
    this.supportsNotifications = false;

    this.events = new EventTarget();
    this._boundHandlers = new Map();
    this._seenMessageIds = new Set();
    this._bindEvents();
  }

  /** @private */
  _bindEvents() {
    const onReceived = (e) => {
      if (e.detail.conversationId === this._conversationId) {
        if (this._seenMessageIds.has(e.detail.id)) {
          return;
        }
        this._seenMessageIds.add(e.detail.id);
        const msg = this._toMessageFormat(e.detail);
        this.events.dispatchEvent(new CustomEvent('message', { detail: msg }));
      }
    };

    const onUpdated = (e) => {
      if (e.detail.conversationId === this._conversationId) {
        const msg = this._toMessageFormat(e.detail);
        if (!this._seenMessageIds.has(e.detail.id)) {
          this._seenMessageIds.add(e.detail.id);
          this.events.dispatchEvent(new CustomEvent('message', { detail: msg }));
        }
      }
    };

    const onPurged = (e) => {
      if (e.detail?.conversationId === this._conversationId) {
        this.events.dispatchEvent(new CustomEvent('cleared', { detail: {} }));
      }
    };

    this._boundHandlers.set('message-received', onReceived);
    this._boundHandlers.set('message-updated', onUpdated);
    this._boundHandlers.set('conversation-purged', onPurged);

    const onReactionChanged = async (e) => {
      const { messageId } = e.detail;
      const reactions = await this._dmService.loadReactions(messageId);
      this.events.dispatchEvent(new CustomEvent('reaction-update', { detail: { messageId, reactions } }));
    };

    this._boundHandlers.set('reaction-changed', onReactionChanged);

    const onKeyRestored = (e) => {
      if (e.detail?.conversationId === this._conversationId) {
        this._fetchFromServer();
      }
    };

    this._boundHandlers.set('session-key-restored', onKeyRestored);

    this._dmService.addEventListener('message-received', onReceived);
    this._dmService.addEventListener('message-updated', onUpdated);
    this._dmService.addEventListener('conversation-purged', onPurged);
    this._dmService.addEventListener('reaction-changed', onReactionChanged);
    this._dmService.addEventListener('session-key-restored', onKeyRestored);
  }

  /**
   * Resolves the display name for a message sender.
   * @param {object} dm
   * @returns {string}
   * @private
   */
  _senderName(dm) {
    if (dm.direction === 'sent') {
      return this._ownNickname;
    }

    const conv = this._dmService.getConversationMeta(this._conversationId);
    if (conv) {
      const participant = conv.participants.find((p) => p.fingerprint === dm.senderFingerprint);
      if (participant) {
        return participant.nickname;
      }
    }
    return dm.senderFingerprint?.slice(0, 12) + '…';
  }

  /**
   * Converts a DM message to the format expected by the chat component.
   * @param {object} dm
   * @returns {object}
   * @private
   */
  _toMessageFormat(dm) {
    return {
      id: dm.id,
      content: dm.content,
      nickname: this._senderName(dm),
      timestamp: dm.createdAt,
      clientId: dm.direction === 'sent' ? 'self' : dm.senderFingerprint || 'peer',
      userId: null,
      channelId: null,
      direction: dm.direction,
      status: dm.status,
      replyTo: dm.replyTo || undefined,
      replyToNickname: dm.replyToNickname || undefined,
      replyToContent: dm.replyToContent || undefined,
      reactions: this._dmService.getReactions(dm.id),
    };
  }

  /**
   * @param {string} content
   * @param {string|null} [replyTo] - message UUID of the replied-to message
   */
  async sendMessage(content, replyTo = null) {
    let replyToObj = null;
    if (replyTo) {
      const msgs = await this._dmService.getConversation(this._conversationId);
      const orig = msgs.find((m) => m.id === replyTo);
      if (orig) {
        replyToObj = {
          id: replyTo,
          nickname: this._senderName(orig),
          content: orig.content,
        };
      } else {
        replyToObj = { id: replyTo };
      }
    }
    await this._dmService.sendDm(this._conversationId, content, replyToObj);
  }

  /**
   * @param {string} [_channelId] - ignored for DMs
   * @param {number} [_before]
   * @param {number} [_limit]
   * @returns {Promise<{messages: object[]}>}
   */
  async fetchHistory(_channelId, _before, _limit) {
    const messages = await this._dmService.getConversation(this._conversationId);
    for (const m of messages) {
      this._seenMessageIds.add(m.id);
      await this._dmService.loadReactions(m.id);
    }
    const formatted = messages.map((m) => this._toMessageFormat(m));

    this._fetchFromServer();

    return { messages: formatted.reverse() };
  }

  /**
   * Fetches history from the server and emits any new messages not already seen.
   * @private
   */
  async _fetchFromServer() {
    try {
      const conv = this._dmService.getConversationMeta(this._conversationId);
      const connectionManager = (await import('../connectionManager.js')).default;
      const serverKey = conv?.serverKey || connectionManager.activeKey;
      if (!serverKey) {
        return;
      }

      await this._dmService.fetchHistory(this._conversationId, serverKey);

      const messages = await this._dmService.getConversation(this._conversationId);
      for (const m of messages) {
        if (!this._seenMessageIds.has(m.id)) {
          this._seenMessageIds.add(m.id);
          const msg = this._toMessageFormat(m);
          this.events.dispatchEvent(new CustomEvent('message', { detail: msg }));
        }
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async deleteMessage() {
    // Not supported for DMs yet
  }

  /**
   * @returns {Promise<void>}
   */
  async editMessage() {
    // Not supported for DMs yet
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  react(messageId, emoji) {
    this._dmService.addReaction(messageId, emoji);
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  unreact(messageId, emoji) {
    this._dmService.removeReaction(messageId, emoji);
  }

  sendTyping() {
    // Not supported for DMs yet
  }

  /**
   * @returns {Array<{nickname: string}>}
   */
  getMentionCandidates() {
    const conv = this._dmService.getConversationMeta(this._conversationId);
    if (!conv) {
      return [{ nickname: this._ownNickname }];
    }
    return conv.participants.map((p) => ({ nickname: p.nickname }));
  }

  /**
   * @returns {string}
   */
  get clientId() {
    return 'self';
  }

  /**
   * Returns the own fingerprint as identity token so reaction/reply UI is shown.
   * @returns {string}
   */
  get userId() {
    return this._dmService._fingerprint;
  }

  /**
   * @param {string} _permission
   * @returns {boolean}
   */
  hasPermission(_permission) {
    return false;
  }

  /**
   * Cleans up event listeners.
   */
  destroy() {
    for (const [event, handler] of this._boundHandlers) {
      this._dmService.removeEventListener(event, handler);
    }
    this._boundHandlers.clear();
    this._seenMessageIds.clear();
  }
}

export default DmChatProvider;
