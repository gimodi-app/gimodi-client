import serverService from '../server.js';
import chatService from '../chat.js';

/**
 * Chat provider that wraps the existing ChatService and serverService
 * for server channel chat. Implements the ChatProvider interface.
 */
class ServerChatProvider {
  /**
   * @param {string} channelId
   */
  constructor(channelId) {
    this._channelId = channelId;
    this.supportsCommands = true;
    this.supportsChannelMentions = true;
    this.supportsPinning = true;
    this.supportsTabs = true;
    this.supportsFileUpload = true;
    this.supportsReactions = true;
    this.supportsReplies = true;
    this.supportsTyping = true;
    this.supportsLinkPreviews = true;
    this.supportsEdit = true;
    this.supportsDelete = true;
    this.supportsNotifications = true;
    this.events = chatService;
  }

  /**
   * @param {string} channelId
   */
  setChannelId(channelId) {
    this._channelId = channelId;
  }

  /**
   * @param {string} content
   * @param {string} [replyTo]
   */
  sendMessage(content, replyTo) {
    chatService.sendMessage(this._channelId, content, replyTo);
  }

  /**
   * @param {string} channelId
   * @param {string} content
   * @param {string} [replyTo]
   */
  sendMessageToChannel(channelId, content, replyTo) {
    chatService.sendMessage(channelId, content, replyTo);
  }

  /**
   * @param {string} [channelId]
   * @param {number} [before]
   * @param {number} [limit]
   * @param {string} [password]
   * @returns {Promise<{messages: object[], pinnedMessageIds?: string[]}>}
   */
  async fetchHistory(channelId, before, limit = 50, password) {
    return chatService.fetchHistory(channelId || this._channelId, before, limit, password);
  }

  /**
   * @param {string} channelId
   * @param {number} timestamp
   * @returns {Promise<object>}
   */
  async fetchContext(channelId, timestamp) {
    return chatService.fetchContext(channelId, timestamp);
  }

  /**
   * @param {string} messageId
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {
    return chatService.deleteMessage(messageId);
  }

  /**
   * @param {string} messageId
   * @param {string} content
   * @returns {Promise<void>}
   */
  async editMessage(messageId, content) {
    return chatService.editMessage(messageId, content);
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  react(messageId, emoji) {
    chatService.react(messageId, emoji);
  }

  /**
   * @param {string} messageId
   * @param {string} emoji
   */
  unreact(messageId, emoji) {
    chatService.unreact(messageId, emoji);
  }

  /**
   * @param {string} [channelId]
   */
  sendTyping(channelId) {
    chatService.sendTyping(channelId || this._channelId);
  }

  /**
   * @param {string} messageId
   */
  pinMessage(messageId) {
    chatService.pinMessage(messageId);
  }

  /**
   * @param {string} messageId
   */
  unpinMessage(messageId) {
    chatService.unpinMessage(messageId);
  }

  /**
   * @param {string} messageId
   * @returns {Promise<object>}
   */
  removePreview(messageId) {
    return chatService.removePreview(messageId);
  }

  /**
   * @param {string} channelId
   * @param {string} [password]
   */
  subscribeChannel(channelId, password) {
    chatService.subscribeChannel(channelId, password);
  }

  /**
   * @param {string} channelId
   */
  unsubscribeChannel(channelId) {
    chatService.unsubscribeChannel(channelId);
  }

  /**
   * @param {string} content
   */
  sendServerMessage(content) {
    chatService.sendServerMessage(content);
  }

  /**
   * @param {number} [before]
   * @param {number} [limit]
   * @returns {Promise<object>}
   */
  async fetchServerHistory(before, limit = 50) {
    return chatService.fetchServerHistory(before, limit);
  }

  /**
   * @param {string} messageId
   * @returns {Promise<object>}
   */
  deleteServerMessage(messageId) {
    return chatService.deleteServerMessage(messageId);
  }

  /**
   * @returns {Array<{nickname: string, userId?: string, id?: string}>}
   */
  getMentionCandidates() {
    return window.gimodiClients || [];
  }

  /**
   * @returns {string|null}
   */
  get clientId() {
    return serverService.clientId;
  }

  /**
   * @returns {string|null}
   */
  get userId() {
    return serverService.userId;
  }

  /**
   * @returns {string|null}
   */
  get address() {
    return serverService.address;
  }

  /**
   * @returns {number|null}
   */
  get maxFileSize() {
    return serverService.maxFileSize;
  }

  /**
   * @param {string} permission
   * @returns {boolean}
   */
  hasPermission(permission) {
    return serverService.hasPermission(permission);
  }

  /**
   * @param {string} type
   * @param {object} data
   */
  send(type, data) {
    serverService.send(type, data);
  }

  /**
   * @param {string} event
   * @param {Function} handler
   */
  addServerEventListener(event, handler) {
    serverService.addEventListener(event, handler);
  }

  /**
   * @param {string} event
   * @param {Function} handler
   */
  removeServerEventListener(event, handler) {
    serverService.removeEventListener(event, handler);
  }
}

export default ServerChatProvider;
