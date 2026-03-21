import { escapeHtml, renderMarkdown } from './chat-markdown.js';
import { formatDateTime, formatRelativeTime } from '../../services/timeFormat.js';
import { getCachedNickname, resolveNicknames } from '../../services/nicknameCache.js';

/**
 * @typedef {Object} MessageHandlerDeps
 * @property {function(): HTMLElement} getChatMessages - Returns the chat messages container element
 * @property {function(): HTMLElement} getChatInput - Returns the chat input element
 * @property {function(): HTMLElement} getPinnedMessages - Returns the pinned messages container element
 * @property {function(): string|null} getCurrentChannelId - Returns the currently active channel ID
 * @property {function(): Object} getActiveTab - Returns the active tab state object
 * @property {function(Object): void} setActiveTab - Sets the active tab state
 * @property {function(): Array} getChannelMessagesCache - Returns the channel messages cache array
 * @property {function(): Object} getPaginationState - Returns the pagination state object
 * @property {function(): Object|null} getPaginationForTab - Returns pagination for the current tab
 * @property {function(): Object|null} getProvider - Returns the current chat provider
 * @property {function(): Map} getChannelPinnedMessages - Returns the channelId-to-pinnedSet map
 * @property {function(): boolean} getPinnedCollapsed - Returns whether pinned messages are collapsed
 * @property {function(boolean): void} setPinnedCollapsed - Sets pinned collapsed state
 * @property {function(): Object|null} getReplyToMessage - Returns the current reply target
 * @property {function(Object|null): void} setReplyToMessage - Sets the current reply target
 * @property {function(): Map} getSelectedMentions - Returns the selected mentions map
 * @property {function(): Array} getChannelViewTabs - Returns the channel view tabs array
 * @property {function(): string|null} getViewingChannelId - Returns the viewing channel ID
 * @property {function(string): Promise} loadHistory - Loads chat history for a channel
 * @property {function(Object, HTMLElement|null): HTMLElement|null} buildMessageEl - Builds a message DOM element
 * @property {function(Object): void} appendMessage - Appends a message to the chat
 * @property {function(): void} renderTabs - Re-renders the tab bar
 * @property {function(): void} updateInputForTab - Updates input state for the current tab
 * @property {function(string): void} appendSystemMessage - Appends a system message
 * @property {function(string): string} resolveStructuredMentions - Resolves @mentions to structured tokens
 * @property {function(number, number, string, string, number, string): void} showImageContextMenu - Shows context menu for images
 * @property {function(string): boolean} isFileMessage - Checks if content is a file message
 * @property {function(string): string} resolveMentionsText - Resolves structured mentions to display text
 * @property {number} HISTORY_PAGE_SIZE - Number of messages per history page
 */

/**
 * Creates message handler functions with access to shared chat view dependencies.
 * @param {MessageHandlerDeps} deps - The dependencies from the chat view module
 * @returns {Object} An object containing all message handler functions
 */
export function createMessageHandlers(deps) {
  /**
   * Highlights a message element briefly to draw attention to it.
   * @param {HTMLElement} el - The message element to highlight
   * @returns {void}
   */
  function highlightMessage(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('chat-msg-highlight');
    setTimeout(() => el.classList.remove('chat-msg-highlight'), 2000);
  }

  /**
   * Scrolls to a specific message by ID, loading context from the server if the message is not currently rendered.
   * @param {string} messageId - The ID of the message to scroll to
   * @param {number} timestamp - The timestamp of the message for context loading
   * @returns {Promise<void>}
   */
  async function scrollToMessage(messageId, timestamp) {
    const currentChannelId = deps.getCurrentChannelId();
    if (!currentChannelId) {
      return;
    }

    const activeTab = deps.getActiveTab();
    if (activeTab.type !== 'channel') {
      deps.setActiveTab({ type: 'channel' });
      deps.getChannelMessagesCache().length = 0;
      deps.renderTabs();
      deps.updateInputForTab();
      await deps.loadHistory(currentChannelId);
    }

    const chatMessages = deps.getChatMessages();
    const existing = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
    if (existing) {
      highlightMessage(existing);
      return;
    }

    try {
      const provider = deps.getProvider();
      const result = await provider.fetchContext(currentChannelId, timestamp);
      if (!result?.messages?.length) {
        return;
      }

      const sorted = [...result.messages];
      sorted.sort((a, b) => a.timestamp - b.timestamp);

      const userIds = sorted.map((m) => m.userId).filter(Boolean);
      if (userIds.length > 0) {
        await resolveNicknames(userIds);
      }

      chatMessages.innerHTML = '';
      const paginationState = deps.getPaginationState();
      paginationState.channel = { oldestTs: sorted[0].timestamp, allLoaded: false, loading: false };

      for (const msg of sorted) {
        deps.appendMessage(msg);
      }

      requestAnimationFrame(() => {
        const target = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
        if (target) {
          highlightMessage(target);
        }
      });
    } catch (err) {
      console.error('[chat] scrollToMessage failed:', err);
    }
  }

  /**
   * Marks a channel as read by storing the current timestamp in the database.
   * @param {string} channelId - The ID of the channel to mark as read
   * @param {string} serverAddress - The server address for the storage key
   * @returns {void}
   */
  function markChannelRead(channelId, serverAddress) {
    window.gimodi.db.setLastRead(serverAddress, channelId, Date.now());
  }

  /**
   * Handles a message-pinned event by updating the pinned messages set and re-rendering if needed.
   * @param {CustomEvent} e - The event containing messageId and channelId in its detail
   * @returns {void}
   */
  function onMessagePinned(e) {
    const { messageId, channelId } = e.detail;
    const channelPinnedMessages = deps.getChannelPinnedMessages();
    if (!channelPinnedMessages.has(channelId)) {
      channelPinnedMessages.set(channelId, new Set());
    }
    channelPinnedMessages.get(channelId).add(messageId);

    if (channelId === deps.getViewingChannelId()) {
      renderPinnedMessages();
    }
  }

  /**
   * Handles a message-unpinned event by removing the message from the pinned set and re-rendering if needed.
   * @param {CustomEvent} e - The event containing messageId and channelId in its detail
   * @returns {void}
   */
  function onMessageUnpinned(e) {
    const { messageId, channelId } = e.detail;
    const channelPinnedMessages = deps.getChannelPinnedMessages();
    const pinnedSet = channelPinnedMessages.get(channelId);
    if (pinnedSet) {
      pinnedSet.delete(messageId);
    }

    if (channelId === deps.getViewingChannelId()) {
      renderPinnedMessages();
    }
  }

  /**
   * Enters inline edit mode for a chat message, replacing the body with a textarea.
   * @param {HTMLElement} msgEl - The message DOM element to edit
   * @param {string} messageId - The ID of the message being edited
   * @returns {void}
   */
  function enterEditMode(msgEl, messageId) {
    if (msgEl.classList.contains('editing')) {
      return;
    }

    const rawContent = msgEl.dataset.content || '';
    const bodyEl = msgEl.querySelector('.chat-msg-body');
    if (!bodyEl) {
      return;
    }

    const preexistingMentions = new Map();
    const content = rawContent.replace(/@u\(([^)]+)\)/g, (full, id) => {
      let nick = null;
      if (window.gimodiClients) {
        const c = window.gimodiClients.find((cl) => cl.userId === id || cl.id === id);
        nick = c?.nickname ?? null;
      }
      if (!nick) {
        nick = getCachedNickname(id);
      }
      if (!nick) {
        nick = id.slice(0, 8);
      }
      preexistingMentions.set(nick, { userId: id, clientId: null });
      return `@${nick}`;
    });

    msgEl.classList.add('editing');
    bodyEl.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.className = 'edit-msg-textarea';
    textarea.value = content;
    textarea.rows = Math.min(content.split('\n').length + 1, 10);

    const controls = document.createElement('div');
    controls.className = 'edit-msg-controls';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'edit-msg-save';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'edit-msg-cancel';
    cancelBtn.textContent = 'Cancel';

    controls.appendChild(saveBtn);
    controls.appendChild(cancelBtn);
    bodyEl.after(textarea);
    textarea.after(controls);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

    function exitEditMode() {
      msgEl.classList.remove('editing');
      textarea.remove();
      controls.remove();
      bodyEl.style.display = '';
    }

    cancelBtn.addEventListener('click', exitEditMode);

    saveBtn.addEventListener('click', async () => {
      const editedText = textarea.value.trim();
      if (!editedText) {
        return;
      }
      const selectedMentions = deps.getSelectedMentions();
      for (const [nick, ids] of preexistingMentions) {
        if (!selectedMentions.has(nick)) {
          selectedMentions.set(nick, ids);
        }
      }
      const newContent = deps.resolveStructuredMentions(editedText);
      if (newContent === rawContent) {
        exitEditMode();
        return;
      }
      try {
        const provider = deps.getProvider();
        await provider.editMessage(messageId, newContent);
        exitEditMode();
      } catch (err) {
        deps.appendSystemMessage(`Edit failed: ${err.message}`);
        exitEditMode();
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveBtn.click();
      }
      if (e.key === 'Escape') {
        exitEditMode();
      }
    });
  }

  /**
   * Initiates a reply to a message by setting the reply target and rendering the preview.
   * @param {Object} msg - The message object to reply to
   * @param {string} msg.id - The message ID
   * @param {string} msg.nickname - The sender nickname
   * @param {string} msg.content - The message content
   * @param {string} msg.channelId - The channel ID
   * @returns {void}
   */
  function startReplyTo(msg) {
    deps.setReplyToMessage({
      id: msg.id,
      nickname: msg.nickname,
      content: msg.content,
      channelId: msg.channelId,
    });
    renderReplyPreview();
    const chatInput = deps.getChatInput();
    chatInput.focus();
  }

  /**
   * Cancels the current reply by clearing the reply target and removing the preview.
   * @returns {void}
   */
  function cancelReply() {
    deps.setReplyToMessage(null);
    renderReplyPreview();
  }

  /**
   * Renders or removes the reply preview bar above the chat input.
   * @returns {void}
   */
  function renderReplyPreview() {
    let previewEl = document.getElementById('reply-preview');
    const replyToMessage = deps.getReplyToMessage();
    if (!replyToMessage) {
      if (previewEl) {
        previewEl.remove();
      }
      return;
    }

    const chatInput = deps.getChatInput();
    const inputRow = chatInput?.closest('.chat-input-row');
    if (!previewEl) {
      previewEl = document.createElement('div');
      previewEl.id = 'reply-preview';
      previewEl.className = 'reply-preview';
      inputRow.parentNode.insertBefore(previewEl, inputRow);
    }

    const rawPreview = replyToMessage.content && deps.isFileMessage(replyToMessage.content) ? 'click to see attachment' : replyToMessage.content ? deps.resolveMentionsText(replyToMessage.content) : '';
    const previewContent = rawPreview ? rawPreview.substring(0, 80) + (rawPreview.length > 80 ? '\u2026' : '') : '(message)';

    previewEl.innerHTML = `
    <div class="reply-preview-bar"></div>
    <div class="reply-preview-body">
      <span class="reply-preview-nickname">${escapeHtml(replyToMessage.nickname)}</span>
      <span class="reply-preview-content">${escapeHtml(previewContent)}</span>
    </div>
    <button class="reply-preview-cancel" title="Cancel reply"><i class="bi bi-x"></i></button>
  `;

    previewEl.querySelector('.reply-preview-cancel').addEventListener('click', cancelReply);
  }

  /**
   * Handles a message-edited event by updating the message content and adding an edited label.
   * @param {CustomEvent} e - The event containing messageId, newContent, and editedAt in its detail
   * @returns {void}
   */
  function onMessageEdited(e) {
    const { messageId, newContent, editedAt } = e.detail;
    const chatMessages = deps.getChatMessages();
    const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.dataset.content = newContent;

    const bodyEl = msgEl.querySelector('.chat-msg-body');
    if (bodyEl) {
      bodyEl.innerHTML = renderMarkdown(newContent);
      for (const a of bodyEl.querySelectorAll('a')) {
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          const href = a.getAttribute('href');
          if (href) {
            window.gimodi.openExternal(href);
          }
        });
      }
      for (const pre of bodyEl.querySelectorAll('pre')) {
        pre.style.position = 'relative';
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => {
          const code = pre.querySelector('code');
          const text = (code || pre).textContent;
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => {
              btn.textContent = 'Copy';
            }, 1500);
          });
        });
        pre.appendChild(btn);
      }
    }

    let editedLabelEl = msgEl.querySelector('.chat-msg-edited');
    if (!editedLabelEl) {
      editedLabelEl = document.createElement('span');
      editedLabelEl.className = 'chat-msg-edited';
      editedLabelEl.textContent = '(edited)';

      const header = msgEl.querySelector('.chat-msg-header');
      if (header) {
        const timeEl = header.querySelector('.chat-msg-time');
        if (timeEl) {
          timeEl.after(editedLabelEl);
        } else {
          header.appendChild(editedLabelEl);
        }
      } else {
        if (bodyEl) {
          bodyEl.after(editedLabelEl);
        }
      }
    }
    editedLabelEl.title = formatDateTime(editedAt);
  }

  /**
   * Renders the pinned messages panel for the currently viewed channel.
   * @returns {void}
   */
  function renderPinnedMessages() {
    const provider = deps.getProvider();
    const pinnedMessagesEl = deps.getPinnedMessages();
    if (!provider?.supportsPinning || !pinnedMessagesEl) {
      return;
    }
    const viewingChannelId = deps.getViewingChannelId();
    const channelPinnedMessages = deps.getChannelPinnedMessages();
    const pinnedSet = viewingChannelId ? channelPinnedMessages.get(viewingChannelId) : null;
    if (!pinnedSet || pinnedSet.size === 0) {
      pinnedMessagesEl.classList.add('hidden');
      pinnedMessagesEl.innerHTML = '';
      return;
    }

    pinnedMessagesEl.classList.remove('hidden');
    pinnedMessagesEl.innerHTML = '';

    const pinnedCollapsed = deps.getPinnedCollapsed();
    const header = document.createElement('div');
    header.className = 'pinned-header';
    header.innerHTML = `
    <i class="bi bi-pin-angle-fill"></i>
    <span>${pinnedSet.size} Pinned Message${pinnedSet.size > 1 ? 's' : ''}</span>
    <i class="bi bi-chevron-down pinned-chevron${pinnedCollapsed ? '' : ' expanded'}"></i>
  `;
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      deps.setPinnedCollapsed(!deps.getPinnedCollapsed());
      renderPinnedMessages();
    });
    pinnedMessagesEl.appendChild(header);

    if (pinnedCollapsed) {
      return;
    }

    const chatMessages = deps.getChatMessages();
    const container = document.createElement('div');
    container.className = 'pinned-messages-container';

    for (const messageId of pinnedSet) {
      const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
      if (msgEl) {
        const clone = msgEl.cloneNode(true);
        clone.classList.add('pinned-message-preview');

        const actionsEl = clone.querySelector('.chat-msg-actions');
        if (actionsEl) {
          actionsEl.remove();
        }
        const hoverTimeEl = clone.querySelector('.chat-msg-hover-time');
        if (hoverTimeEl) {
          hoverTimeEl.remove();
        }

        if (clone.classList.contains('chat-msg-grouped')) {
          clone.classList.remove('chat-msg-grouped');
          const nickname = msgEl.dataset.nickname || 'Unknown';
          const badge = msgEl.dataset.badge || '';
          const badgeHtml = badge ? `<span class="admin-badge">${escapeHtml(badge)}</span>` : '';
          const ts = Number(msgEl.dataset.timestamp);
          const timeStr = formatRelativeTime(ts);
          const headerDiv = document.createElement('div');
          headerDiv.className = 'chat-msg-header';
          headerDiv.innerHTML = `<span class="chat-msg-nick-group"><span class="chat-msg-nick">${escapeHtml(nickname)}</span>${badgeHtml}</span><span class="chat-msg-time">${timeStr}</span>`;
          const body = clone.querySelector('.chat-msg-body');
          if (body) {
            clone.insertBefore(headerDiv, body);
          }
        }

        if (provider.hasPermission('chat.pin')) {
          const unpinBtn = document.createElement('button');
          unpinBtn.className = 'pinned-message-unpin';
          unpinBtn.title = 'Unpin';
          unpinBtn.innerHTML = '&times;';
          unpinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            provider.unpinMessage(messageId);
          });
          clone.appendChild(unpinBtn);
        }

        clone.addEventListener('click', () => {
          const original = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
          if (original) {
            original.scrollIntoView({ behavior: 'smooth', block: 'center' });
            original.classList.add('highlight');
            setTimeout(() => original.classList.remove('highlight'), 2000);
          }
        });

        container.appendChild(clone);
      } else {
        pinnedSet.delete(messageId);
        if (provider.hasPermission('chat.pin')) {
          provider.unpinMessage(messageId);
        }
      }
    }

    pinnedMessagesEl.appendChild(container);
  }

  /**
   * Scrolls the chat messages container to the bottom.
   * @returns {void}
   */
  function scrollToBottom() {
    const chatMessages = deps.getChatMessages();
    if (!chatMessages) {
      return;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  /**
   * Handles horizontal scrolling on the tab bar via mouse wheel.
   * @param {WheelEvent} e - The wheel event
   * @returns {void}
   */
  function onTabBarWheel(e) {
    if (e.deltaY !== 0) {
      e.preventDefault();
      e.currentTarget.scrollLeft += e.deltaY;
    }
  }

  /**
   * Handles chat scroll events to trigger loading older messages when near the top.
   * @returns {void}
   */
  function onChatScroll() {
    const chatMessages = deps.getChatMessages();
    if (chatMessages.scrollTop > 150) {
      return;
    }
    const pg = deps.getPaginationForTab();
    if (!pg || pg.allLoaded || pg.loading) {
      return;
    }
    loadOlderMessages();
  }

  /**
   * Updates pagination state based on fetched messages, marking all loaded if fewer than a full page.
   * @param {Object} pg - The pagination state object to update
   * @param {Array} messages - The fetched messages array
   * @returns {void}
   */
  function updatePaginationFromMessages(pg, messages) {
    if (!messages || messages.length === 0) {
      pg.allLoaded = true;
      return;
    }
    if (messages.length < deps.HISTORY_PAGE_SIZE) {
      pg.allLoaded = true;
    }
    const oldest = messages.reduce((min, m) => (m.timestamp < min ? m.timestamp : min), messages[0].timestamp);
    if (pg.oldestTs === null || oldest < pg.oldestTs) {
      pg.oldestTs = oldest;
    }
  }

  /**
   * Loads older messages for the current tab, preserving scroll position.
   * @returns {Promise<void>}
   */
  async function loadOlderMessages() {
    const pg = deps.getPaginationForTab();
    if (!pg || pg.allLoaded || pg.loading || pg.oldestTs === null) {
      return;
    }
    pg.loading = true;

    const chatMessages = deps.getChatMessages();
    const prevHeight = chatMessages.scrollHeight;
    const prevTop = chatMessages.scrollTop;

    try {
      const activeTab = deps.getActiveTab();
      if (activeTab.type === 'channel') {
        await loadOlderChannelMessages(pg);
      } else if (activeTab.type === 'channel-view') {
        await loadOlderChannelViewMessages(pg);
      }
      chatMessages.scrollTop = prevTop + (chatMessages.scrollHeight - prevHeight);
    } finally {
      pg.loading = false;
    }
  }

  /**
   * Loads older messages for the main channel tab and prepends them to the chat.
   * @param {Object} pg - The pagination state for the channel
   * @returns {Promise<void>}
   */
  async function loadOlderChannelMessages(pg) {
    const currentChannelId = deps.getCurrentChannelId();
    const provider = deps.getProvider();
    const result = await provider.fetchHistory(currentChannelId, pg.oldestTs, deps.HISTORY_PAGE_SIZE);
    const activeTab = deps.getActiveTab();
    if (!result?.messages || activeTab.type !== 'channel') {
      return;
    }
    const sorted = [...result.messages].reverse();
    updatePaginationFromMessages(pg, result.messages);
    const userIds = sorted.map((m) => m.userId).filter(Boolean);
    if (userIds.length > 0) {
      await resolveNicknames(userIds);
    }
    const frag = document.createDocumentFragment();
    let batchPrev = null;
    for (const msg of sorted) {
      const el = deps.buildMessageEl(msg, batchPrev);
      if (el) {
        frag.appendChild(el);
        batchPrev = el;
      }
    }
    const chatMessages = deps.getChatMessages();
    chatMessages.prepend(frag);
  }

  /**
   * Loads older messages for a channel-view tab and prepends them to the chat.
   * @param {Object} pg - The pagination state for the channel view
   * @returns {Promise<void>}
   */
  async function loadOlderChannelViewMessages(pg) {
    const activeTab = deps.getActiveTab();
    const { channelId } = activeTab;
    const channelViewTabs = deps.getChannelViewTabs();
    const tab = channelViewTabs.find((t) => t.channelId === channelId);
    const provider = deps.getProvider();
    const result = await provider.fetchHistory(channelId, pg.oldestTs, deps.HISTORY_PAGE_SIZE, tab?.password);
    const currentActiveTab = deps.getActiveTab();
    if (!result?.messages || currentActiveTab.type !== 'channel-view' || currentActiveTab.channelId !== channelId) {
      return;
    }
    const sorted = [...result.messages].reverse();
    updatePaginationFromMessages(pg, result.messages);
    const userIds = sorted.map((m) => m.userId).filter(Boolean);
    if (userIds.length > 0) {
      await resolveNicknames(userIds);
    }
    const frag = document.createDocumentFragment();
    let batchPrev = null;
    for (const msg of sorted) {
      const el = deps.buildMessageEl(msg, batchPrev);
      if (el) {
        frag.appendChild(el);
        batchPrev = el;
      }
    }
    const chatMessages = deps.getChatMessages();
    chatMessages.prepend(frag);
  }

  /**
   * Opens a fullscreen lightbox overlay for an image with context menu support.
   * @param {string} src - The image source URL
   * @param {string} alt - The image alt text
   * @param {Object} [meta] - Optional metadata for the image context menu
   * @param {string} [meta.filename] - The original filename
   * @param {number} [meta.size] - The file size in bytes
   * @param {string} [meta.url] - The download URL
   * @returns {void}
   */
  function openLightbox(src, alt, meta) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `<img class="lightbox-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}">`;
    const lbImg = overlay.querySelector('.lightbox-img');
    lbImg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deps.showImageContextMenu(e.clientX, e.clientY, src, meta?.filename, meta?.size, meta?.url);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
    });
    document.body.appendChild(overlay);
  }

  return {
    highlightMessage,
    scrollToMessage,
    markChannelRead,
    onMessagePinned,
    onMessageUnpinned,
    enterEditMode,
    startReplyTo,
    cancelReply,
    renderReplyPreview,
    onMessageEdited,
    renderPinnedMessages,
    scrollToBottom,
    onTabBarWheel,
    onChatScroll,
    updatePaginationFromMessages,
    loadOlderMessages,
    loadOlderChannelMessages,
    loadOlderChannelViewMessages,
    openLightbox,
  };
}
