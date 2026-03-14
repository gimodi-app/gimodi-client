/**
 * Chat provider that wraps the existing DmService for direct message chat.
 * Implements the ChatProvider interface with limited feature support.
 */
class DmChatProvider {
  /**
   * @param {import('../dm.js').DmService} dmService
   * @param {string} peerFingerprint
   * @param {string} peerNickname
   * @param {string} [ownNickname]
   */
  constructor(dmService, peerFingerprint, peerNickname, ownNickname) {
    this._dmService = dmService;
    this._peerFingerprint = peerFingerprint;
    this._peerNickname = peerNickname;
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
      if (e.detail.peerFingerprint === this._peerFingerprint || e.detail.senderFingerprint === this._peerFingerprint) {
        if (this._seenMessageIds.has(e.detail.id)) return;
        this._seenMessageIds.add(e.detail.id);
        const msg = this._toMessageFormat(e.detail);
        this.events.dispatchEvent(new CustomEvent('message', { detail: msg }));
      }
    };

    const onUpdated = (e) => {
      if (e.detail.peerFingerprint === this._peerFingerprint) {
        const msg = this._toMessageFormat(e.detail);
        if (!this._seenMessageIds.has(e.detail.id)) {
          this._seenMessageIds.add(e.detail.id);
          this.events.dispatchEvent(new CustomEvent('message', { detail: msg }));
        }
        // Status updates are not rendered differently in the chat component yet
      }
    };

    const onPurged = (e) => {
      if (e.detail?.peerFingerprint === this._peerFingerprint) {
        this.events.dispatchEvent(new CustomEvent('cleared', { detail: {} }));
      }
    };

    this._boundHandlers.set('message-received', onReceived);
    this._boundHandlers.set('message-updated', onUpdated);
    this._boundHandlers.set('conversation-purged', onPurged);

    const onReactionChanged = (e) => {
      const { messageId } = e.detail;
      const reactions = this._dmService.getReactions(messageId);
      this.events.dispatchEvent(new CustomEvent('reaction-update', { detail: { messageId, reactions } }));
    };

    this._boundHandlers.set('reaction-changed', onReactionChanged);

    this._dmService.addEventListener('message-received', onReceived);
    this._dmService.addEventListener('message-updated', onUpdated);
    this._dmService.addEventListener('conversation-purged', onPurged);
    this._dmService.addEventListener('reaction-changed', onReactionChanged);
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
      nickname: dm.direction === 'sent' ? this._ownNickname : this._peerNickname,
      timestamp: dm.createdAt,
      clientId: dm.direction === 'sent' ? 'self' : 'peer',
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
      const msgs = this._dmService.getConversation(this._peerFingerprint);
      const orig = msgs.find((m) => m.id === replyTo);
      if (orig) {
        replyToObj = {
          id: replyTo,
          nickname: orig.direction === 'sent' ? this._ownNickname : this._peerNickname,
          content: orig.content,
        };
      } else {
        replyToObj = { id: replyTo };
      }
    }
    await this._dmService.sendDm(this._peerFingerprint, content, replyToObj);
  }

  /**
   * @param {string} [_channelId] - ignored for DMs
   * @param {number} [_before]
   * @param {number} [_limit]
   * @returns {Promise<{messages: object[]}>}
   */
  async fetchHistory(_channelId, _before, _limit) {
    const messages = this._dmService.getConversation(this._peerFingerprint);
    for (const m of messages) {
      this._seenMessageIds.add(m.id);
    }
    const formatted = messages.map((m) => this._toMessageFormat(m));
    return { messages: formatted.reverse() };
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
    return [{ nickname: this._peerNickname }, { nickname: this._ownNickname }];
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
