import serverService from './server.js';

class ChatService extends EventTarget {
  constructor() {
    super();
    this._setupListeners();
  }

  /** @private */
  _setupListeners() {
    serverService.addEventListener('chat:receive', (e) => {
      console.log('[chatService] chat:receive →', e.detail?.nickname, (e.detail?.content || '').substring(0, 30));
      this.dispatchEvent(new CustomEvent('message', { detail: e.detail }));
    });

    serverService.addEventListener('chat:link-preview', (e) => {
      this.dispatchEvent(new CustomEvent('link-preview', { detail: e.detail }));
    });

    serverService.addEventListener('chat:dm-receive', (e) => {
      this.dispatchEvent(new CustomEvent('dm-message', { detail: e.detail }));
    });

    serverService.addEventListener('chat:deleted', (e) => {
      this.dispatchEvent(new CustomEvent('message-deleted', { detail: e.detail }));
    });

    serverService.addEventListener('chat:server-receive', (e) => {
      this.dispatchEvent(new CustomEvent('server-message', { detail: e.detail }));
    });

    serverService.addEventListener('chat:server-deleted', (e) => {
      this.dispatchEvent(new CustomEvent('server-message-deleted', { detail: e.detail }));
    });

    serverService.addEventListener('chat:cleared', (e) => {
      this.dispatchEvent(new CustomEvent('cleared', { detail: e.detail }));
    });

    serverService.addEventListener('chat:typing', (e) => {
      this.dispatchEvent(new CustomEvent('typing', { detail: e.detail }));
    });

    serverService.addEventListener('chat:reaction-update', (e) => {
      this.dispatchEvent(new CustomEvent('reaction-update', { detail: e.detail }));
    });

    serverService.addEventListener('chat:message-edited', (e) => {
      this.dispatchEvent(new CustomEvent('message-edited', { detail: e.detail }));
    });

    serverService.addEventListener('chat:preview-removed', (e) => {
      this.dispatchEvent(new CustomEvent('preview-removed', { detail: e.detail }));
    });

    serverService.addEventListener('chat:subscribed', (e) => {
      this.dispatchEvent(new CustomEvent('subscribed', { detail: e.detail }));
    });

    serverService.addEventListener('chat:purged', (e) => {
      this.dispatchEvent(new CustomEvent('purged', { detail: e.detail }));
    });
  }

  /**
   * @param {string} channelId
   * @param {string} content
   * @param {string} [replyTo]
   */
  sendMessage(channelId, content, replyTo = null) {
    serverService.send('chat:send', { channelId, content, replyTo });
  }

  /**
   * @param {string} channelId
   * @param {string} [password]
   */
  subscribeChannel(channelId, password) {
    serverService.send('chat:subscribe', { channelId, ...(password != null && { password }) });
  }

  /**
   * @param {string} channelId
   */
  unsubscribeChannel(channelId) {
    serverService.send('chat:unsubscribe', { channelId });
  }

  /**
   * @param {string} targetClientId
   * @param {string} content
   * @returns {Promise<void>}
   */
  async sendDm(targetClientId, content) {
    let encryptedContent = content;

    try {
      const result = await serverService.request('user:get-public-key', { clientId: targetClientId });
      const recipientPublicKey = result?.publicKey;

      if (recipientPublicKey) {
        const ownIdentity = await window.gimodi.identity.getDefault();
        const ownPublicKey = ownIdentity?.publicKeyArmored;

        const keys = [recipientPublicKey];
        if (ownPublicKey && ownPublicKey !== recipientPublicKey) {
          keys.push(ownPublicKey);
        }

        encryptedContent = await window.gimodi.identity.encrypt(keys, content);
      }
    } catch (err) {
      console.warn('[chat] DM encryption failed, sending plaintext:', err.message);
      encryptedContent = content;
    }

    serverService.send('chat:dm-send', { targetId: targetClientId, content: encryptedContent });
  }

  /**
   * @param {string} channelId
   * @param {number} [before]
   * @param {number} [limit=50]
   * @param {string} [password]
   * @returns {Promise<object>}
   */
  async fetchHistory(channelId, before, limit = 50, password) {
    return serverService.request('chat:history', { channelId, before, limit, ...(password != null && { password }) });
  }

  /**
   * Fetches messages surrounding a given timestamp for jump-to-message.
   * @param {string} channelId
   * @param {number} timestamp
   * @returns {Promise<object>}
   */
  async fetchContext(channelId, timestamp) {
    return serverService.request('chat:context', { channelId, timestamp });
  }

  /**
   * @param {string} messageId
   * @returns {Promise<object>}
   */
  deleteMessage(messageId) {
    return serverService.request('chat:delete', { messageId });
  }

  /**
   * @param {string} targetUserId
   * @param {number} [before]
   * @param {number} [limit=50]
   * @returns {Promise<object>}
   */
  async fetchDmHistory(targetUserId, before, limit = 50) {
    return serverService.request('chat:dm-history', { targetUserId, before, limit });
  }

  /**
   * @param {string} content
   */
  sendServerMessage(content) {
    serverService.send('chat:server-send', { content });
  }

  /**
   * @param {number} [before]
   * @param {number} [limit=50]
   * @returns {Promise<object>}
   */
  async fetchServerHistory(before, limit = 50) {
    return serverService.request('chat:server-history', { before, limit });
  }

  /**
   * @param {string} messageId
   * @returns {Promise<object>}
   */
  deleteServerMessage(messageId) {
    return serverService.request('chat:server-delete', { messageId });
  }

  /**
   * @param {string} channelId
   */
  sendTyping(channelId) {
    serverService.send('chat:typing', { channelId });
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  react(messageId, emoji) {
    serverService.send('chat:react', { messageId, emoji });
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  unreact(messageId, emoji) {
    serverService.send('chat:unreact', { messageId, emoji });
  }

  /**
   * @param {string} messageId
   */
  pinMessage(messageId) {
    serverService.send('chat:pin-message', { messageId });
  }

  /**
   * @param {string} messageId
   */
  unpinMessage(messageId) {
    serverService.send('chat:unpin-message', { messageId });
  }

  /**
   * @param {string} messageId
   * @param {string} newContent
   * @returns {Promise<object>}
   */
  editMessage(messageId, newContent) {
    return serverService.request('chat:edit', { messageId, newContent });
  }

  /**
   * @param {string} messageId
   * @returns {Promise<object>}
   */
  removePreview(messageId) {
    return serverService.request('chat:remove-preview', { messageId });
  }
}

const chatService = new ChatService();
export default chatService;
