import { showEmojiPicker, closeEmojiPicker, isPickerOpen } from '../emoji/emoji-picker.js';
import { tryHandleCommand, isSlashCommand } from '../../services/commands.js';
import { customConfirm } from '../../services/dialogs.js';

const MAX_MESSAGE_LENGTH = 4000;
const TYPING_SEND_INTERVAL = 2000;
const TYPING_EXPIRE_TIMEOUT = 3000;

/**
 * Creates input handling functions for the chat view.
 * @param {object} deps - Dependencies from the parent chat module
 * @param {function} deps.getChatInput - Returns the chat input textarea element
 * @param {function} deps.getFileInput - Returns the hidden file input element
 * @param {function} deps.getChatMessages - Returns the chat messages container element
 * @param {function} deps.getChatCharCount - Returns the character count display element
 * @param {function} deps.getBtnEmoji - Returns the emoji button element
 * @param {function} deps.getBtnAttach - Returns the attach button element
 * @param {function} deps.getBtnSend - Returns the send button element
 * @param {function} deps.getActiveTab - Returns the current active tab descriptor
 * @param {function} deps.getCurrentChannelId - Returns the current channel ID
 * @param {function} deps.getChannelViewTabs - Returns the channel view tabs array
 * @param {function} deps.getProvider - Returns the current chat provider
 * @param {function} deps.getReplyToMessage - Returns the current reply target message or null
 * @param {function} deps.getSelectedMentions - Returns the selected mentions Map
 * @param {function} deps.getSelectedChannelMentions - Returns the selected channel mentions Map
 * @param {function} deps.uploadFile - Uploads a file to the server
 * @param {function} deps.cancelReply - Cancels the current reply target
 * @param {function} deps.appendSystemMessage - Appends a system message to chat
 * @param {function} deps.scrollToBottom - Scrolls chat to the bottom
 * @returns {object} Object containing all input handler functions
 */
export function createInputHandlers(deps) {
  const typingUsers = new Map();
  let typingSendTimer = null;
  let typingSendAllowed = true;

  /**
   * Toggles the emoji picker or inserts a selected emoji into the chat input.
   * @returns {void}
   */
  function onEmojiClick() {
    if (isPickerOpen()) {
      closeEmojiPicker();
      return;
    }
    showEmojiPicker({
      anchor: deps.getBtnEmoji(),
      closeOnSelect: false,
      onSelect: (emoji) => {
        const chatInput = deps.getChatInput();
        const start = chatInput.selectionStart;
        const end = chatInput.selectionEnd;
        chatInput.value = chatInput.value.substring(0, start) + emoji + chatInput.value.substring(end);
        chatInput.selectionStart = chatInput.selectionEnd = start + emoji.length;
        chatInput.focus();
        autoResizeInput();
      },
    });
  }

  /**
   * Opens the native file picker by triggering a click on the hidden file input.
   * @returns {void}
   */
  function onAttachClick() {
    deps.getFileInput().click();
  }

  /**
   * Handles file selection from the file input and uploads each selected file.
   * @returns {void}
   */
  function onFileChange() {
    const fileInput = deps.getFileInput();
    for (const file of fileInput.files) {
      deps.uploadFile(file);
    }
    fileInput.value = '';
  }

  /**
   * Handles dragover events on the chat area to show a drop indicator.
   * @param {DragEvent} e - The dragover event
   * @returns {void}
   */
  function onDragOver(e) {
    e.preventDefault();
    deps.getChatMessages().classList.add('drag-over');
  }

  /**
   * Handles dragleave events on the chat area to hide the drop indicator.
   * @param {DragEvent} e - The dragleave event
   * @returns {void}
   */
  function onDragLeave(e) {
    e.preventDefault();
    deps.getChatMessages().classList.remove('drag-over');
  }

  /**
   * Handles drop events on the chat area and uploads each dropped file.
   * @param {DragEvent} e - The drop event
   * @returns {void}
   */
  function onDrop(e) {
    e.preventDefault();
    deps.getChatMessages().classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      deps.uploadFile(file);
    }
  }

  /**
   * Handles paste events to intercept image pastes and upload them as files.
   * @param {ClipboardEvent} e - The paste event
   * @returns {void}
   */
  function onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          deps.uploadFile(file);
        }
        return;
      }
    }
  }

  /**
   * Throttled handler for chat input keystrokes that sends typing indicators to the server.
   * @returns {void}
   */
  function onChatInputForTyping() {
    const activeTab = deps.getActiveTab();
    const currentChannelId = deps.getCurrentChannelId();
    const typingChannelId = activeTab.type === 'channel' ? currentChannelId : activeTab.type === 'channel-view' ? activeTab.channelId : null;
    if (!typingChannelId) {
      return;
    }
    if (!typingSendAllowed) {
      return;
    }
    typingSendAllowed = false;
    deps.getProvider().sendTyping(typingChannelId);
    typingSendTimer = setTimeout(() => {
      typingSendAllowed = true;
    }, TYPING_SEND_INTERVAL);
  }

  /**
   * Processes incoming typing events from other users and updates the typing indicator.
   * @param {CustomEvent} e - The typing event with detail containing clientId, nickname, and channelId
   * @returns {void}
   */
  function onTypingEvent(e) {
    const { clientId, nickname, channelId } = e.detail;
    if (!channelId) {
      return;
    }

    if (!typingUsers.has(channelId)) {
      typingUsers.set(channelId, new Map());
    }
    const channelTyping = typingUsers.get(channelId);

    const existing = channelTyping.get(clientId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      channelTyping.delete(clientId);
      renderTypingIndicator();
    }, TYPING_EXPIRE_TIMEOUT);

    channelTyping.set(clientId, { nickname, timer });
    renderTypingIndicator();
  }

  /**
   * Renders the typing indicator below the chat messages showing which users are currently typing.
   * @returns {void}
   */
  function renderTypingIndicator() {
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'typing-indicator';
      indicator.className = 'typing-indicator';
      const chatInputRow = document.querySelector('.chat-input-row');
      if (chatInputRow) {
        chatInputRow.parentNode.insertBefore(indicator, chatInputRow);
      }
    }

    const activeTab = deps.getActiveTab();
    const currentChannelId = deps.getCurrentChannelId();
    const activeChannelForTyping = activeTab.type === 'channel' ? currentChannelId : activeTab.type === 'channel-view' ? activeTab.channelId : null;
    if (!activeChannelForTyping) {
      indicator.textContent = '';
      indicator.style.display = 'none';
      return;
    }

    const channelTyping = typingUsers.get(activeChannelForTyping);
    if (!channelTyping || channelTyping.size === 0) {
      indicator.textContent = '';
      indicator.style.display = 'none';
      return;
    }

    const names = [...channelTyping.values()].map((v) => v.nickname);
    let text;
    if (names.length === 1) {
      text = `${names[0]} is typing...`;
    } else if (names.length === 2) {
      text = `${names[0]} and ${names[1]} are typing...`;
    } else {
      text = `${names.slice(0, 2).join(', ')} and ${names.length - 2} more are typing...`;
    }

    indicator.textContent = text;
    indicator.style.display = '';
  }

  /**
   * Clears all typing state including per-channel timers and the send throttle timer.
   * @returns {void}
   */
  function clearTypingState() {
    for (const channelTyping of typingUsers.values()) {
      for (const entry of channelTyping.values()) {
        clearTimeout(entry.timer);
      }
    }
    typingUsers.clear();
    if (typingSendTimer) {
      clearTimeout(typingSendTimer);
      typingSendTimer = null;
    }
    typingSendAllowed = true;
    renderTypingIndicator();
  }

  /**
   * Auto-resizes the chat input textarea to fit its content up to a maximum of 8 lines.
   * @returns {void}
   */
  function autoResizeInput() {
    const chatInput = deps.getChatInput();
    chatInput.style.height = 'auto';
    const cs = getComputedStyle(chatInput);
    const maxHeight = parseFloat(cs.lineHeight) * 8 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const capped = chatInput.scrollHeight > maxHeight;
    chatInput.style.height = (capped ? maxHeight : chatInput.scrollHeight) + 'px';
    chatInput.style.overflowY = capped ? 'auto' : 'hidden';
  }

  /**
   * Replaces @nickname and #channelName tokens with structured mention IDs for server processing.
   * @param {string} text - The raw message text containing @mentions and #channel references
   * @returns {string} The text with mentions replaced by structured @u(id) and #c(id) tokens
   */
  function resolveStructuredMentions(text) {
    let result = text;
    const selectedMentions = deps.getSelectedMentions();
    for (const [nickname, { userId, clientId }] of selectedMentions) {
      const id = userId || clientId;
      if (!id) {
        continue;
      }
      const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`@${escaped}(?=\\s|$)`, 'g'), `@u(${id})`);
    }
    selectedMentions.clear();

    const selectedChannelMentions = deps.getSelectedChannelMentions();
    for (const [channelName, channelId] of selectedChannelMentions) {
      const escaped = channelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`#${escaped}(?=\\s|$)`, 'g'), `#c(${channelId})`);
    }
    selectedChannelMentions.clear();

    return result;
  }

  /**
   * Sends the current chat input content as a message, handling slash commands, long messages, replies, and mentions.
   * @returns {void}
   */
  function sendMessage() {
    const chatInput = deps.getChatInput();
    const content = chatInput.value.trim();
    if (!content) {
      return;
    }

    const provider = deps.getProvider();
    const activeTab = deps.getActiveTab();
    const currentChannelId = deps.getCurrentChannelId();

    if (content.length > MAX_MESSAGE_LENGTH) {
      if (provider.supportsFileUpload) {
        const activeChannelId = activeTab.type === 'channel' ? currentChannelId : activeTab.type === 'channel-view' ? activeTab.channelId : null;
        offerSendAsFile(content, activeChannelId);
      } else {
        deps.appendSystemMessage(`Message is too long (${content.length} of ${MAX_MESSAGE_LENGTH} characters maximum).`);
      }
      return;
    }

    const activeChannelId = activeTab.type === 'channel' ? currentChannelId : activeTab.type === 'channel-view' ? activeTab.channelId : null;
    if (provider.supportsCommands && activeChannelId && isSlashCommand(content)) {
      const handled = tryHandleCommand(content, { channelId: activeChannelId });
      if (handled) {
        chatInput.value = '';
        deps.getSelectedMentions().clear();
        deps.getSelectedChannelMentions().clear();
        autoResizeInput();
        return;
      }
      deps.appendSystemMessage(`Unknown command: ${content.split(/\s+/)[0]}`);
      chatInput.value = '';
      deps.getSelectedMentions().clear();
      deps.getSelectedChannelMentions().clear();
      autoResizeInput();
      return;
    }

    const resolved = resolveStructuredMentions(content);

    const replyToMessage = deps.getReplyToMessage();
    const replyTo = provider.supportsReplies ? replyToMessage?.id || null : null;

    if (activeTab.type === 'channel-view' && provider.sendMessageToChannel) {
      provider.sendMessageToChannel(activeTab.channelId, resolved, replyTo);
    } else {
      if (!currentChannelId && !provider.sendMessage) {
        return;
      }
      if (provider.sendMessageToChannel && currentChannelId) {
        provider.sendMessageToChannel(currentChannelId, resolved, replyTo);
      } else {
        provider.sendMessage(resolved, replyTo);
      }
    }
    chatInput.value = '';
    deps.cancelReply();
    autoResizeInput();
    if (typingSendTimer) {
      clearTimeout(typingSendTimer);
      typingSendTimer = null;
    }
    typingSendAllowed = true;
  }

  /**
   * Offers to send an oversized message as a text file attachment after user confirmation.
   * @param {string} content - The message content that exceeds the length limit
   * @param {string|null} channelId - The target channel ID
   * @returns {Promise<void>}
   */
  async function offerSendAsFile(content, channelId) {
    if (!channelId) {
      return;
    }
    const confirmed = await customConfirm(`Your message is too long (${content.length} of ${MAX_MESSAGE_LENGTH} characters maximum).\n\nSend it as a text file instead?`);
    if (!confirmed) {
      return;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], 'message.txt', { type: 'text/plain' });
    const chatInput = deps.getChatInput();
    chatInput.value = '';
    autoResizeInput();
    updateCharCount();
    deps.uploadFile(file, channelId);
  }

  /**
   * Handles input events on the chat textarea to update character count and auto-resize.
   * @returns {void}
   */
  function onChatInputForCharCount() {
    updateCharCount();
    autoResizeInput();
  }

  /**
   * Updates the character count display based on the current input length.
   * @returns {void}
   */
  function updateCharCount() {
    const chatInput = deps.getChatInput();
    const chatCharCount = deps.getChatCharCount();
    const len = chatInput.value.length;
    if (len < MAX_MESSAGE_LENGTH * 0.75) {
      chatCharCount.textContent = '';
      chatCharCount.className = 'chat-char-count';
      return;
    }
    const remaining = MAX_MESSAGE_LENGTH - len;
    chatCharCount.textContent = remaining >= 0 ? `${remaining}` : `${-remaining} over limit`;
    chatCharCount.className = 'chat-char-count visible' + (len > MAX_MESSAGE_LENGTH ? ' danger' : len >= MAX_MESSAGE_LENGTH * 0.9 ? ' warning' : '');
  }

  /**
   * Updates the chat input state (disabled, readonly, placeholder, attach button visibility) based on the active tab and channel permissions.
   * @returns {void}
   */
  function updateInputForTab() {
    const provider = deps.getProvider();
    const activeTab = deps.getActiveTab();
    const currentChannelId = deps.getCurrentChannelId();
    const btnAttach = deps.getBtnAttach();
    const btnSend = deps.getBtnSend();
    const chatInput = deps.getChatInput();
    const channelViewTabs = deps.getChannelViewTabs();

    const isAttachSupported = provider?.supportsFileUpload && activeTab.type === 'channel';

    const cvChannelId = activeTab.type === 'channel-view' ? activeTab.channelId : activeTab.type === 'channel' ? currentChannelId : null;
    const cvTab = cvChannelId ? channelViewTabs.find((t) => t.channelId === cvChannelId) : null;

    chatInput.disabled = false;
    chatInput.readOnly = false;
    chatInput.classList.remove('input-write-restricted');

    if (cvTab?.readRestricted) {
      chatInput.disabled = true;
      chatInput.placeholder = 'You do not have permission to read this channel';
      if (btnAttach) {
        btnAttach.style.display = 'none';
      }
      btnSend.disabled = true;
      return;
    }

    if (cvTab?.writeRestricted) {
      chatInput.readOnly = true;
      chatInput.classList.add('input-write-restricted');
      chatInput.placeholder = 'You do not have permission to write in this channel';
      if (btnAttach) {
        btnAttach.style.display = 'none';
      }
      btnSend.disabled = true;
      return;
    }

    btnSend.disabled = false;
    chatInput.disabled = false;
    chatInput.placeholder = 'Type a message\u2026';
    if (btnAttach) {
      btnAttach.style.display = isAttachSupported ? '' : 'none';
    }
  }

  return {
    onEmojiClick,
    onAttachClick,
    onFileChange,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    onChatInputForTyping,
    onTypingEvent,
    renderTypingIndicator,
    clearTypingState,
    autoResizeInput,
    resolveStructuredMentions,
    sendMessage,
    offerSendAsFile,
    onChatInputForCharCount,
    updateCharCount,
    updateInputForTab,
    getTypingUsers() { return typingUsers; },
  };
}
