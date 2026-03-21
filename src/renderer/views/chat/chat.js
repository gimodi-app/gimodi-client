import notificationService from '../../services/notifications.js';
import { tryHandleCommand, isSlashCommand } from '../../services/commands.js';
import { showEmojiPicker, closeEmojiPicker, isPickerOpen } from '../emoji/emoji-picker.js';
import { setNickname, invalidateNickname, getCachedNickname, resolveNicknames } from '../../services/nicknameCache.js';
import { formatTimeShort, formatDateTime, formatRelativeTime } from '../../services/timeFormat.js';
import { customConfirm } from '../../services/dialogs.js';
import { renderMarkdown, escapeHtml, replaceEmoticons, isEmojiOnly } from './chat-markdown.js';
import { renderReactions, showQuickReactionPicker, onReactionUpdate, setReactionProvider } from './chat-reactions.js';
import { searchEmoji, getEmoji } from '../../services/emoji-shortcodes.js';
import { createMentionHandlers } from './chat-mentions.js';
import { createInputHandlers } from './chat-input.js';
import { createMessageHandlers } from './chat-messages.js';
import { createTabHandlers } from './chat-tabs.js';
import createNotificationHandlers from './chat-notifications.js';

let compactMode = false;
let mediaEmbedPrivacy = true;

/** @type {import('../services/chat-providers/server.js').default|import('../services/chat-providers/dm.js').default|null} */
let provider = null;

// DOM element references — resolved per-container in initChatView
let chatMessages = document.getElementById('chat-messages');
let pinnedMessages = document.getElementById('pinned-messages');
let chatInput = document.getElementById('chat-input');
let chatCharCount = document.getElementById('chat-char-count');
let btnSend = document.getElementById('btn-send');
let btnAttach = document.getElementById('btn-attach');
let btnEmoji = document.getElementById('btn-emoji');
let fileInput = document.getElementById('file-input');
let btnNotifications = document.getElementById('btn-notifications');
let notificationBadge = document.getElementById('notification-badge');
let notificationDropdown = document.getElementById('notification-dropdown');

let currentChannelId = null;
let currentChannelName = 'Lobby';
const channelPinnedMessages = new Map(); // channelId → [messageIds]
let pinnedCollapsed = true;

export function getViewingChannelId() {
  if (activeTab.type === 'channel') {
    return currentChannelId;
  }
  if (activeTab.type === 'channel-view') {
    return activeTab.channelId;
  }
  return null;
}

// --- Reply state ---
let replyToMessage = null; // { id, nickname, content, channelId } | null

// --- Tab state ---
let activeTab = { type: 'channel' }; // { type: 'channel' } | { type: 'channel-view', channelId, channelName }
const channelViewTabs = []; // [{ channelId, channelName }]
const tabOrder = []; // unified visual order: [{ type: 'channel-view', id: string }, ...]
let draggedTab = null; // { index } for drag-and-drop reordering
const channelViewMessagesCache = new Map(); // channelId → DOM nodes[]
const channelViewMessagesPending = new Map(); // channelId → message[] (buffered while tab inactive)
const channelMessagesCache = []; // stores channel DOM nodes when switching away
const channelMessagesPending = []; // messages received while not on channel tab, buffered for re-render
let channelTabUnread = false;
const unreadChannels = new Set(); // channelIds with unread messages
let voiceChannelId = null; // channelId of the active voice channel (rendered as first, non-closable tab)

// --- Pagination state ---
const HISTORY_PAGE_SIZE = 50;
const paginationState = {
  channel: { oldestTs: null, allLoaded: false, loading: false },
  channelView: new Map(), // channelId → { oldestTs, allLoaded, loading }
};

function getPaginationForTab() {
  if (activeTab.type === 'channel') {
    return paginationState.channel;
  }
  if (activeTab.type === 'channel-view') {
    return paginationState.channelView.get(activeTab.channelId) || null;
  }
  return null;
}

function resetChannelPagination() {
  paginationState.channel = { oldestTs: null, allLoaded: false, loading: false };
}

// clientId → nickname map for tracking who left
const clientNicknameMap = new Map();

// --- Factory module initialization ---
// All cross-factory deps use arrow wrappers (safe: only called at runtime, not during init).

let autoResizeInput, sendMessage, onEmojiClick, onAttachClick, onFileChange;
let onDragOver, onDragLeave, onDrop, onPaste, onChatInputForTyping, onTypingEvent;
let renderTypingIndicator, clearTypingState, onChatInputForCharCount, updateCharCount;
let updateInputForTab, offerSendAsFile;
let scrollToBottom, onTabBarWheel, onChatScroll, updatePaginationFromMessages;
let loadOlderMessages, loadOlderChannelMessages, loadOlderChannelViewMessages, openLightbox;
let highlightMessage, enterEditMode, startReplyTo, cancelReply, renderReplyPreview;
let onMessageEdited, renderPinnedMessages, onMessagePinned, onMessageUnpinned;
let onNavigateChannel, switchToTab, renderTabs, showLinkContextMenu, showImageContextMenu;
let showTabContextMenu, addTabDragListeners;
let updateNotificationBell, toggleNotificationDropdown, closeNotificationDropdown;
let onChatInputForMentions, hideMentionAutocomplete, navigateMentionAutocomplete;
let selectMention, selectChannelMention, selectEmojiShortcode, onChannelMentionClick;
let resolveStructuredMentions;

const tabState = {};
Object.defineProperty(tabState, 'activeTab', {
  get() { return activeTab; },
  set(v) { activeTab = v; },
});
Object.defineProperty(tabState, 'draggedTab', {
  get() { return draggedTab; },
  set(v) { draggedTab = v; },
});
tabState.tabOrder = tabOrder;
tabState.channelViewTabs = channelViewTabs;
tabState.channelMessagesCache = channelMessagesCache;
tabState.channelMessagesPending = channelMessagesPending;
tabState.channelViewMessagesCache = channelViewMessagesCache;
tabState.channelViewMessagesPending = channelViewMessagesPending;
tabState.unreadChannels = unreadChannels;

const mentionH = createMentionHandlers({
  getChatInput: () => chatInput,
  getProvider: () => provider,
  autoResizeInput: (...a) => autoResizeInput(...a),
  openChannelViewTab: (...a) => openChannelViewTab(...a),
});

const inputH = createInputHandlers({
  getChatInput: () => chatInput,
  getFileInput: () => fileInput,
  getChatMessages: () => chatMessages,
  getChatCharCount: () => chatCharCount,
  getBtnEmoji: () => btnEmoji,
  getBtnAttach: () => btnAttach,
  getBtnSend: () => btnSend,
  getActiveTab: () => activeTab,
  getCurrentChannelId: () => currentChannelId,
  getChannelViewTabs: () => channelViewTabs,
  getProvider: () => provider,
  getReplyToMessage: () => replyToMessage,
  getSelectedMentions: () => mentionH.getSelectedMentions(),
  getSelectedChannelMentions: () => mentionH.getSelectedChannelMentions(),
  uploadFile: (...a) => uploadFile(...a),
  cancelReply: (...a) => cancelReply(...a),
  appendSystemMessage: (...a) => appendSystemMessage(...a),
  scrollToBottom: (...a) => scrollToBottom(...a),
});

const messageH = createMessageHandlers({
  getChatMessages: () => chatMessages,
  getChatInput: () => chatInput,
  getPinnedMessages: () => pinnedMessages,
  getCurrentChannelId: () => currentChannelId,
  getActiveTab: () => activeTab,
  setActiveTab: (t) => { activeTab = t; },
  getChannelMessagesCache: () => channelMessagesCache,
  getPaginationState: () => paginationState,
  getPaginationForTab,
  getProvider: () => provider,
  getChannelPinnedMessages: () => channelPinnedMessages,
  getPinnedCollapsed: () => pinnedCollapsed,
  setPinnedCollapsed: (v) => { pinnedCollapsed = v; },
  getReplyToMessage: () => replyToMessage,
  setReplyToMessage: (v) => { replyToMessage = v; },
  getSelectedMentions: () => mentionH.getSelectedMentions(),
  getChannelViewTabs: () => channelViewTabs,
  getViewingChannelId,
  loadHistory: (...a) => loadHistory(...a),
  buildMessageEl: (...a) => buildMessageEl(...a),
  appendMessage: (...a) => appendMessage(...a),
  renderTabs: (...a) => renderTabs(...a),
  updateInputForTab: (...a) => updateInputForTab(...a),
  appendSystemMessage: (...a) => appendSystemMessage(...a),
  resolveStructuredMentions: (...a) => mentionH.resolveStructuredMentions(...a),
  showImageContextMenu: (...a) => showImageContextMenu(...a),
  isFileMessage,
  resolveMentionsText,
  HISTORY_PAGE_SIZE,
});

const tabH = createTabHandlers({
  state: tabState,
  getProvider: () => provider,
  getCurrentChannelId: () => currentChannelId,
  getCurrentChannelName: () => currentChannelName,
  getVoiceChannelId: () => voiceChannelId,
  getChannelTabUnread: () => channelTabUnread,
  setChannelTabUnread: (v) => { channelTabUnread = v; },
  getChatMessages: () => chatMessages,
  appendMessage: (...a) => appendMessage(...a),
  scrollToBottom: (...a) => scrollToBottom(...a),
  renderPinnedMessages: (...a) => renderPinnedMessages(...a),
  loadHistory: (...a) => loadHistory(...a),
  loadChannelViewHistory: (...a) => loadChannelViewHistory(...a),
  updateInputForTab: (...a) => updateInputForTab(...a),
  cancelReply: (...a) => cancelReply(...a),
  renderTypingIndicator: (...a) => renderTypingIndicator(...a),
  closeChannelViewTab: (...a) => closeChannelViewTab(...a),
  markChannelRead: (...a) => messageH.markChannelRead(...a),
  notificationService,
});

const notifH = createNotificationHandlers({
  notificationService,
  getBtnNotifications: () => btnNotifications,
  getNotificationBadge: () => notificationBadge,
  getNotificationDropdown: () => notificationDropdown,
  switchToTab: (...a) => switchToTab(...a),
});

({
  onChatInputForMentions, hideMentionAutocomplete, navigateMentionAutocomplete,
  selectMention, selectChannelMention, selectEmojiShortcode, onChannelMentionClick,
  resolveStructuredMentions,
} = mentionH);

({
  autoResizeInput, sendMessage, onEmojiClick, onAttachClick, onFileChange,
  onDragOver, onDragLeave, onDrop, onPaste, onChatInputForTyping, onTypingEvent,
  renderTypingIndicator, clearTypingState, onChatInputForCharCount, updateCharCount,
  updateInputForTab, offerSendAsFile,
} = inputH);

({
  scrollToBottom, onTabBarWheel, onChatScroll, updatePaginationFromMessages,
  loadOlderMessages, loadOlderChannelMessages, loadOlderChannelViewMessages,
  openLightbox, highlightMessage, enterEditMode, startReplyTo, cancelReply,
  renderReplyPreview, onMessageEdited, renderPinnedMessages,
  onMessagePinned, onMessageUnpinned,
} = messageH);

({
  onNavigateChannel, switchToTab, renderTabs, showLinkContextMenu,
  showImageContextMenu, showTabContextMenu, addTabDragListeners,
} = tabH);

({
  updateNotificationBell, toggleNotificationDropdown, closeNotificationDropdown,
} = notifH);

function onKeydown(e) {
  if (mentionH.isMentionAutocompleteVisible()) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateMentionAutocomplete(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      const acEl = document.querySelector('.mention-autocomplete');
      const selected = acEl?.querySelector('.mention-autocomplete-item.selected');
      if (selected) {
        e.preventDefault();
        const triggerChar = mentionH.getMentionTriggerChar();
        if (triggerChar === ':') {
          selectEmojiShortcode(selected.dataset.shortcode);
        } else if (triggerChar === '#') {
          selectChannelMention(selected.dataset.channelName, selected.dataset.channelId);
        } else {
          selectMention(selected.dataset.nickname, selected.dataset.userId || null, selected.dataset.clientId || null);
        }
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideMentionAutocomplete();
      return;
    }
  }

  if (e.key === 'Enter' && e.altKey) {
    // ALT+Enter inserts a newline
    e.preventDefault();
    const start = chatInput.selectionStart;
    const end = chatInput.selectionEnd;
    chatInput.value = chatInput.value.substring(0, start) + '\n' + chatInput.value.substring(end);
    chatInput.selectionStart = chatInput.selectionEnd = start + 1;
    autoResizeInput();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function onNickContextMenu(ev) {
  if (!provider?.supportsTabs) {
    return;
  }
  const nickEl = ev.target.closest('.chat-msg-nick, .compact-nick, .chat-msg-nick-group, .admin-badge');
  if (!nickEl) {
    return;
  }
  const msgEl = nickEl.closest('.chat-msg');
  if (!msgEl) {
    return;
  }
  const clientId = msgEl.dataset.clientId;
  const userId = msgEl.dataset.userId;
  if (clientId === provider.clientId || userId === provider.userId) {
    return;
  }
  const nickname = msgEl.dataset.nickname;
  const onlineClient = window.gimodiClients?.find((c) => (clientId && c.id === clientId) || (userId && c.userId === userId));
  const user = onlineClient || {
    id: clientId || userId,
    userId: userId || null,
    nickname: nickname || '[Unknown]',
    badge: msgEl.dataset.badge || null,
  };
  ev.preventDefault();
  ev.stopPropagation();
  window.dispatchEvent(
    new CustomEvent('gimodi:user-context-menu', {
      detail: { clientX: ev.clientX, clientY: ev.clientY, user },
    }),
  );
}

export function initChatView(channelId, chatProvider, container) {
  console.log('[chat] initChatView channelId=', channelId, 'provider:', chatProvider?.constructor?.name, 'container:', !!container);
  currentChannelId = channelId;

  // Resolve DOM elements from container or fallback to document-level IDs
  if (container) {
    chatMessages = container.querySelector('.chat-messages') || container.querySelector('#chat-messages');
    pinnedMessages = container.querySelector('.pinned-messages') || container.querySelector('#pinned-messages');
    chatInput = container.querySelector('.chat-input') || container.querySelector('#chat-input');
    chatCharCount = container.querySelector('.chat-char-count') || container.querySelector('#chat-char-count');
    btnSend = container.querySelector('.btn-send') || container.querySelector('#btn-send');
    btnAttach = container.querySelector('.btn-attach') || container.querySelector('#btn-attach');
    btnEmoji = container.querySelector('.btn-emoji') || container.querySelector('#btn-emoji');
    fileInput = container.querySelector('#file-input') || container.querySelector('.file-input');
    btnNotifications = container.querySelector('.notification-bell') || container.querySelector('#btn-notifications');
    notificationBadge = container.querySelector('.notification-badge') || container.querySelector('#notification-badge');
    notificationDropdown = container.querySelector('.notif-dropdown') || container.querySelector('#notification-dropdown');
  } else {
    chatMessages = document.getElementById('chat-messages');
    pinnedMessages = document.getElementById('pinned-messages');
    chatInput = document.getElementById('chat-input');
    chatCharCount = document.getElementById('chat-char-count');
    btnSend = document.getElementById('btn-send');
    btnAttach = document.getElementById('btn-attach');
    btnEmoji = document.getElementById('btn-emoji');
    fileInput = document.getElementById('file-input');
    btnNotifications = document.getElementById('btn-notifications');
    notificationBadge = document.getElementById('notification-badge');
    notificationDropdown = document.getElementById('notification-dropdown');
  }

  if (chatMessages && compactMode) {
    chatMessages.classList.add('compact-mode');
  }

  activeTab = { type: 'channel' };
  tabOrder.length = 0;
  channelMessagesCache.length = 0;
  channelMessagesPending.length = 0;
  channelTabUnread = false;
  resetChannelPagination();
  paginationState.channelView.clear();
  clientNicknameMap.clear();
  cancelReply();

  // Remove listeners from the previous provider before switching to the new one
  cleanup();
  provider = chatProvider;

  if (provider.supportsNotifications) {
    notificationService.clearAll();
    notificationService.addEventListener('change', updateNotificationBell);
    if (btnNotifications) {
      btnNotifications.addEventListener('click', toggleNotificationDropdown);
    }
    updateNotificationBell();
  }

  btnSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', onKeydown);
  if (btnEmoji) {
    btnEmoji.addEventListener('click', onEmojiClick);
  }
  if (provider.supportsFileUpload && btnAttach) {
    btnAttach.addEventListener('click', onAttachClick);
  }
  if (fileInput) {
    fileInput.addEventListener('change', onFileChange);
  }
  if (provider.supportsFileUpload) {
    chatMessages.addEventListener('dragover', onDragOver);
    chatMessages.addEventListener('dragleave', onDragLeave);
    chatMessages.addEventListener('drop', onDrop);
  }
  chatMessages.addEventListener('scroll', onChatScroll);
  if (provider.supportsChannelMentions) {
    chatMessages.addEventListener('click', onChannelMentionClick);
  }
  chatMessages.addEventListener('contextmenu', onNickContextMenu);
  if (provider.supportsFileUpload) {
    chatInput.addEventListener('paste', onPaste);
  }
  if (provider.supportsTyping) {
    chatInput.addEventListener('input', onChatInputForTyping);
  }
  chatInput.addEventListener('input', onChatInputForMentions);
  chatInput.addEventListener('input', onChatInputForCharCount);

  provider.events.addEventListener('message', onMessage);
  if (provider.supportsLinkPreviews) {
    provider.events.addEventListener('link-preview', onLinkPreview);
    provider.events.addEventListener('preview-removed', onPreviewRemoved);
  }
  provider.events.addEventListener('message-deleted', onMessageDeleted);
  provider.events.addEventListener('cleared', onChatCleared);
  provider.events.addEventListener('purged', onChatPurged);
  if (provider.supportsTyping) {
    provider.events.addEventListener('typing', onTypingEvent);
  }
  if (provider.supportsReactions) {
    provider.events.addEventListener('reaction-update', onReactionUpdate);
    setReactionProvider(provider);
  }
  if (provider.supportsEdit) {
    provider.events.addEventListener('message-edited', onMessageEdited);
  }
  if (provider.supportsTabs) {
    provider.events.addEventListener('subscribed', onChatSubscribed);
  }
  if (provider.addServerEventListener) {
    if (provider.supportsPinning) {
      provider.addServerEventListener('chat:message-pinned', onMessagePinned);
      provider.addServerEventListener('chat:message-unpinned', onMessageUnpinned);
    }
    provider.addServerEventListener('channel:updated', onChannelUpdatedForReadRoles);
    window.addEventListener('gimodi:navigate-channel', onNavigateChannel);
    provider.addServerEventListener('server:client-joined', onClientJoinedForCache);
    provider.addServerEventListener('server:client-left', onClientLeftForCache);
  }

  // Seed clientNicknameMap from current client list
  for (const c of provider.getMentionCandidates()) {
    if (c.id) {
      clientNicknameMap.set(c.id, c.nickname);
    }
  }

  if (provider.supportsTabs) {
    const tabBar = container ? container.querySelector('.tab-bar') : document.querySelector('.tab-bar');
    if (tabBar) {
      tabBar.addEventListener('wheel', onTabBarWheel, { passive: false });
    }
    renderTabs();
  }
  updateInputForTab();

  // Hide unsupported UI elements
  if (!provider.supportsFileUpload && btnAttach) {
    btnAttach.style.display = 'none';
  }
  if (!provider.supportsNotifications && btnNotifications) {
    btnNotifications.style.display = 'none';
  }
  if (pinnedMessages && !provider.supportsPinning) {
    pinnedMessages.classList.add('hidden');
  }

  if (channelId || !provider.supportsTabs) {
    loadHistory(channelId);
  }
}

export function cleanup() {
  console.log(
    '[chat] cleanup - activeTab:',
    activeTab.type,
    'currentChannelId:',
    currentChannelId,
    'cvTabs:',
    channelViewTabs.map((t) => t.channelId),
  );
  closeEmojiPicker();
  notificationService.removeEventListener('change', updateNotificationBell);
  if (btnNotifications) {
    btnNotifications.removeEventListener('click', toggleNotificationDropdown);
  }
  closeNotificationDropdown();
  notificationService.clearAll();

  if (btnSend) {
    btnSend.removeEventListener('click', sendMessage);
  }
  if (chatInput) {
    chatInput.removeEventListener('keydown', onKeydown);
    chatInput.removeEventListener('paste', onPaste);
    chatInput.removeEventListener('input', onChatInputForTyping);
    chatInput.removeEventListener('input', onChatInputForMentions);
    chatInput.removeEventListener('input', onChatInputForCharCount);
  }
  if (btnEmoji) {
    btnEmoji.removeEventListener('click', onEmojiClick);
  }
  if (btnAttach) {
    btnAttach.removeEventListener('click', onAttachClick);
  }
  if (fileInput) {
    fileInput.removeEventListener('change', onFileChange);
  }
  if (chatMessages) {
    chatMessages.removeEventListener('dragover', onDragOver);
    chatMessages.removeEventListener('dragleave', onDragLeave);
    chatMessages.removeEventListener('drop', onDrop);
    chatMessages.removeEventListener('scroll', onChatScroll);
    chatMessages.removeEventListener('click', onChannelMentionClick);
    chatMessages.removeEventListener('contextmenu', onNickContextMenu);
  }
  const tabBar = document.querySelector('.tab-bar');
  if (tabBar) {
    tabBar.removeEventListener('wheel', onTabBarWheel);
  }
  if (provider) {
    provider.events.removeEventListener('message', onMessage);
    provider.events.removeEventListener('link-preview', onLinkPreview);
    provider.events.removeEventListener('preview-removed', onPreviewRemoved);
    provider.events.removeEventListener('message-deleted', onMessageDeleted);
    provider.events.removeEventListener('cleared', onChatCleared);
    provider.events.removeEventListener('purged', onChatPurged);
    provider.events.removeEventListener('typing', onTypingEvent);
    provider.events.removeEventListener('reaction-update', onReactionUpdate);
    setReactionProvider(null);
    provider.events.removeEventListener('message-edited', onMessageEdited);
    provider.events.removeEventListener('subscribed', onChatSubscribed);
    if (provider.removeServerEventListener) {
      provider.removeServerEventListener('server:client-joined', onClientJoinedForCache);
      provider.removeServerEventListener('server:client-left', onClientLeftForCache);
      provider.removeServerEventListener('chat:message-pinned', onMessagePinned);
      provider.removeServerEventListener('chat:message-unpinned', onMessageUnpinned);
      provider.removeServerEventListener('channel:updated', onChannelUpdatedForReadRoles);
    }
  }
  window.removeEventListener('gimodi:navigate-channel', onNavigateChannel);
  clearTypingState();
  mentionH.getSelectedMentions().clear();
  mentionH.getSelectedChannelMentions().clear();
  if (chatMessages) {
    chatMessages.innerHTML = '';
  }
  if (chatInput) {
    chatInput.value = '';
    chatInput.style.height = '';
    chatInput.disabled = false;
    chatInput.placeholder = 'Type a message…';
  }
  if (chatCharCount) {
    chatCharCount.textContent = '';
    chatCharCount.className = 'chat-char-count';
  }
  currentChannelName = 'Lobby';
  // Clear channel-view tabs (unsubscribe all)
  for (const cv of channelViewTabs) {
    if (provider?.unsubscribeChannel) {
      provider.unsubscribeChannel(cv.channelId);
    }
  }
  channelViewTabs.length = 0;
  tabOrder.length = 0;
  voiceChannelId = null;
  channelViewMessagesCache.clear();
  channelViewMessagesPending.clear();
  channelPinnedMessages.clear();
  unreadChannels.clear();
}

/**
 * Returns true if the server chat provider is currently active (not a DM provider).
 * Used to determine whether chat state needs to be restored when returning from the DM view.
 * @returns {boolean}
 */
export function isServerChatActive() {
  return !!(provider?.supportsTabs);
}

export function saveState() {
  return {
    currentChannelId,
    currentChannelName,
    activeTab: { ...activeTab },
    channelViewTabs: channelViewTabs.map((t) => ({ ...t })),
    tabOrder: tabOrder.map((t) => ({ ...t })),
  };
}

/**
 * @param {object} state
 * @param {object} [chatProvider] - provider to pass to initChatView; if omitted, reuses existing provider
 */
export function restoreState(state, chatProvider) {
  if (!state) {
    return;
  }
  console.log('[chat] restoreState', { currentChannelId: state.currentChannelId, activeTab: state.activeTab, cvTabs: state.channelViewTabs?.length });

  initChatView(state.currentChannelId, chatProvider || provider);

  for (const cv of state.channelViewTabs || []) {
    channelViewTabs.push({ channelId: cv.channelId, channelName: cv.channelName, ...(cv.password !== null && cv.password !== undefined && { password: cv.password }) });
    provider.subscribeChannel(cv.channelId, cv.password);
  }

  if (state.tabOrder?.length) {
    tabOrder.push(...state.tabOrder.filter((t) => t.type !== 'dm'));
  } else {
    for (const cv of channelViewTabs) {
      tabOrder.push({ type: 'channel-view', id: cv.channelId });
    }
  }

  if (state.activeTab?.type === 'channel-view') {
    const cv = channelViewTabs.find((t) => t.channelId === state.activeTab.channelId);
    if (cv) {
      switchToTab({ type: 'channel-view', channelId: cv.channelId, channelName: cv.channelName });
      return;
    }
  }
  renderTabs();
}

export function switchChannel(channelId) {
  console.log('[chat] switchChannel', channelId, 'activeTab:', activeTab.type, activeTab.channelId);
  currentChannelId = channelId;

  // Clear any buffered messages and unread state from the old channel
  channelMessagesPending.length = 0;
  channelTabUnread = false;
  if (unreadChannels.delete(channelId)) {
    window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
  }
  markChannelRead(channelId, provider.address);

  // If a channel-view tab for this channel already exists (opened before this call),
  // the tab and its history are already being handled - just update currentChannelId and re-render.
  if (channelViewTabs.find((t) => t.channelId === channelId)) {
    renderTabs();
    updateInputForTab();
    renderPinnedMessages();
    return;
  }

  // No channel-view tab - use channel tab
  if (activeTab.type !== 'channel') {
    activeTab = { type: 'channel' };
    channelMessagesCache.length = 0;
  }

  chatMessages.innerHTML = '';
  renderTabs();
  updateInputForTab();
  renderTypingIndicator();
  loadHistory(channelId);
  renderPinnedMessages();
}


async function loadHistory(channelId) {
  try {
    resetChannelPagination();
    const result = await provider.fetchHistory(channelId, undefined, HISTORY_PAGE_SIZE);
    if (result && result.messages && channelId === currentChannelId && activeTab.type === 'channel') {
      // Store pinned message IDs
      if (result.pinnedMessageIds && result.pinnedMessageIds.length > 0) {
        channelPinnedMessages.set(channelId, new Set(result.pinnedMessageIds));
      } else {
        channelPinnedMessages.set(channelId, new Set());
      }

      updatePaginationFromMessages(paginationState.channel, result.messages);

      const sorted = [...result.messages].reverse();
      // Pre-resolve nicknames for all identified users in one batch
      const userIds = sorted.map((m) => m.userId).filter(Boolean);
      if (userIds.length > 0) {
        await resolveNicknames(userIds);
      }
      chatMessages.innerHTML = '';
      for (const msg of sorted) {
        appendMessage(msg);
      }
      scrollToBottom();
      renderPinnedMessages();
    }
  } catch (err) {
    console.error('[chat] loadHistory failed:', err);
  }
}

async function loadChannelViewHistory(channelId) {
  try {
    const tab = channelViewTabs.find((t) => t.channelId === channelId);

    // If already known to be read-restricted, show banner immediately
    if (tab?.readRestricted) {
      if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
        showReadRestrictionBanner();
      }
      return;
    }

    const pg = { oldestTs: null, allLoaded: false, loading: false };
    paginationState.channelView.set(channelId, pg);

    let result;
    try {
      result = await provider.fetchHistory(channelId, undefined, HISTORY_PAGE_SIZE, tab?.password);
    } catch (err) {
      if (err?.message?.includes('READ_RESTRICTED') || err?.code === 'READ_RESTRICTED') {
        if (tab) {
          tab.readRestricted = true;
        }
        if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
          showReadRestrictionBanner();
          updateInputForTab();
        }
        return;
      }
      const code = err?.message?.includes('password') ? 'BAD_PASSWORD' : 'ROLE_RESTRICTED';
      window.dispatchEvent(new CustomEvent('gimodi:channel-access-error', { detail: { channelId, code } }));
      closeChannelViewTab(channelId);
      appendSystemMessage(`Cannot access channel chat: ${err.message}`);
      return;
    }
    if (!result || !result.messages) {
      return;
    }
    if (activeTab.type !== 'channel-view' || activeTab.channelId !== channelId) {
      return;
    }

    updatePaginationFromMessages(pg, result.messages);

    // Store pinned message IDs
    if (result.pinnedMessageIds && result.pinnedMessageIds.length > 0) {
      channelPinnedMessages.set(channelId, new Set(result.pinnedMessageIds));
    } else {
      channelPinnedMessages.set(channelId, new Set());
    }

    const sorted = [...result.messages].reverse();
    const userIds = sorted.map((m) => m.userId).filter(Boolean);
    if (userIds.length > 0) {
      await resolveNicknames(userIds);
    }
    chatMessages.innerHTML = '';
    const historyIds = new Set(sorted.map((m) => m.id));
    for (const msg of sorted) {
      appendMessage(msg);
    }
    // Append any live messages that arrived while history was loading
    const pending = channelViewMessagesPending.get(channelId) || [];
    for (const msg of pending) {
      if (!historyIds.has(msg.id)) {
        appendMessage(msg);
      }
    }
    channelViewMessagesPending.delete(channelId);
    scrollToBottom();
    renderPinnedMessages();
  } catch {
    // History unavailable
  }
}

export function switchToChannelTab() {
  const cvTab = channelViewTabs.find((t) => t.channelId === currentChannelId);
  if (cvTab) {
    switchToTab({ type: 'channel-view', channelId: currentChannelId, channelName: cvTab.channelName });
  } else if (activeTab.type !== 'channel') {
    switchToTab({ type: 'channel' });
  }
}

export function openChannelViewTab(channelId, channelName, password, readRestricted = false, writeRestricted = false) {
  console.log('[chat] openChannelViewTab', channelId, channelName, 'existing:', !!channelViewTabs.find((t) => t.channelId === channelId), 'activeTab:', activeTab.type, activeTab.channelId);
  let tab = channelViewTabs.find((t) => t.channelId === channelId);
  if (!tab) {
    tab = { channelId, channelName, readRestricted, writeRestricted, ...(password !== null && password !== undefined && { password }) };
    channelViewTabs.push(tab);
    if (channelId !== voiceChannelId) {
      tabOrder.push({ type: 'channel-view', id: channelId });
    }
    provider.subscribeChannel(channelId, password);
    window.dispatchEvent(new CustomEvent('gimodi:channel-tabs-changed'));
  } else {
    tab.readRestricted = readRestricted;
    tab.writeRestricted = writeRestricted;
    // If this tab is already active, switchToTab returns early - update input directly
    if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
      updateInputForTab();
      return;
    }
  }
  switchToTab({ type: 'channel-view', channelId, channelName });
}

function closeChannelViewTab(channelId) {
  if (channelId === voiceChannelId) {
    return;
  }
  const idx = channelViewTabs.findIndex((t) => t.channelId === channelId);
  if (idx === -1) {
    return;
  }
  channelViewTabs.splice(idx, 1);
  const orderIdx = tabOrder.findIndex((t) => t.type === 'channel-view' && t.id === channelId);
  if (orderIdx !== -1) {
    tabOrder.splice(orderIdx, 1);
  }
  channelViewMessagesCache.delete(channelId);
  channelViewMessagesPending.delete(channelId);
  if (channelId !== currentChannelId) {
    channelPinnedMessages.delete(channelId);
  }
  provider.unsubscribeChannel(channelId);
  if (channelId === currentChannelId) {
    channelMessagesCache.length = 0;
    if (!voiceChannelId) {
      currentChannelId = null;
    }
  }
  window.dispatchEvent(new CustomEvent('gimodi:channel-tabs-changed'));
  if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
    switchToTab({ type: 'channel' });
  } else {
    renderTabs();
  }
}

/**
 * @param {string|null} channelId
 */
export function setVoiceChannel(channelId) {
  const prevVoiceId = voiceChannelId;
  voiceChannelId = channelId;

  // Restore previous voice channel tab back into tabOrder so it becomes closeable
  if (prevVoiceId && prevVoiceId !== channelId && channelViewTabs.find((t) => t.channelId === prevVoiceId)) {
    if (!tabOrder.find((t) => t.type === 'channel-view' && t.id === prevVoiceId)) {
      tabOrder.push({ type: 'channel-view', id: prevVoiceId });
    }
  }

  // Remove new voice channel from tabOrder (it renders separately as first tab)
  if (channelId) {
    const idx = tabOrder.findIndex((t) => t.type === 'channel-view' && t.id === channelId);
    if (idx !== -1) {
      tabOrder.splice(idx, 1);
    }
  }

  renderTabs();
}

export function getChannelViewTabsState() {
  const activeChannelId = activeTab.type === 'channel-view' ? activeTab.channelId : null;
  return {
    tabs: tabOrder
      .filter((o) => o.type === 'channel-view')
      .map((o) => {
        const t = channelViewTabs.find((cv) => cv.channelId === o.id);
        return t ? { channelId: t.channelId, channelName: t.channelName, ...(t.password !== null && t.password !== undefined && { password: t.password }) } : null;
      })
      .filter(Boolean),
    activeChannelId,
    tabOrder: tabOrder.map((entry) => ({ type: entry.type, id: entry.id })).filter(Boolean),
  };
}

export function restoreChannelViewTabs(tabs, activeChannelId) {
  for (const { channelId, channelName, password } of tabs) {
    if (!channelViewTabs.find((t) => t.channelId === channelId)) {
      channelViewTabs.push({ channelId, channelName, ...(password !== null && password !== undefined && { password }) });
      tabOrder.push({ type: 'channel-view', id: channelId });
      provider.subscribeChannel(channelId, password);
    }
  }
  // Switch to the previously active tab if it exists and isn't already active
  if (activeChannelId) {
    const cvTab = channelViewTabs.find((t) => t.channelId === activeChannelId);
    if (cvTab && (activeTab.type !== 'channel-view' || activeTab.channelId !== activeChannelId)) {
      switchToTab({ type: 'channel-view', channelId: activeChannelId, channelName: cvTab.channelName });
      return;
    }
  }
  renderTabs();
}

/**
 * @param {Object} saved
 * @param {Array} saved.cvTabs
 * @param {Array} saved.savedTabOrder
 * @param {string|null} saved.activeChannelId
 */
export function restoreTabs({ cvTabs, savedTabOrder, activeChannelId }) {
  for (const { channelId, channelName, password } of cvTabs || []) {
    if (!channelViewTabs.find((t) => t.channelId === channelId)) {
      channelViewTabs.push({ channelId, channelName, ...(password !== null && password !== undefined && { password }) });
      provider.subscribeChannel(channelId, password);
    }
  }

  tabOrder.length = 0;
  if (savedTabOrder?.length) {
    for (const entry of savedTabOrder) {
      if (entry.type === 'channel-view' && channelViewTabs.find((t) => t.channelId === entry.id)) {
        tabOrder.push({ type: 'channel-view', id: entry.id });
      }
    }
  }
  for (const cv of channelViewTabs) {
    if (!tabOrder.find((t) => t.type === 'channel-view' && t.id === cv.channelId)) {
      tabOrder.push({ type: 'channel-view', id: cv.channelId });
    }
  }

  if (activeChannelId) {
    const cvTab = channelViewTabs.find((t) => t.channelId === activeChannelId);
    if (cvTab && (activeTab.type !== 'channel-view' || activeTab.channelId !== activeChannelId)) {
      switchToTab({ type: 'channel-view', channelId: activeChannelId, channelName: cvTab.channelName });
      return;
    }
  }
  renderTabs();
}

function onClientJoinedForCache(e) {
  const { userId, nickname, clientId } = e.detail;
  if (clientId) {
    clientNicknameMap.set(clientId, nickname);
  }
  if (userId && nickname) {
    invalidateNickname(userId);
    setNickname(userId, nickname);
    updateVisibleNicknames(userId, nickname);
  }
}

function onClientLeftForCache(e) {
  const leftId = e.detail.clientId;
  clientNicknameMap.delete(leftId);
  // Remove typing indicator for disconnected client
  for (const channelTyping of typingUsers.values()) {
    const entry = channelTyping.get(leftId);
    if (entry) {
      clearTimeout(entry.timer);
      channelTyping.delete(leftId);
    }
  }
  renderTypingIndicator();
}

function updateVisibleNicknames(userId, nickname) {
  for (const el of chatMessages.querySelectorAll(`.chat-msg[data-user-id="${CSS.escape(userId)}"]`)) {
    const nickEl = el.querySelector('.chat-msg-nick');
    if (nickEl) {
      nickEl.textContent = nickname;
    }
  }
}

export function updateChatBadges(userId, badge) {
  if (!userId) {
    return;
  }

  const applyBadge = (msgEl) => {
    if (!msgEl.classList?.contains('chat-msg') || msgEl.dataset.userId !== userId) {
      return;
    }
    msgEl.dataset.badge = badge || '';
    const nickGroup = msgEl.querySelector('.chat-msg-nick-group');
    if (!nickGroup) {
      return;
    }
    nickGroup.querySelector('.admin-badge')?.remove();
    if (badge) {
      const badgeEl = document.createElement('span');
      badgeEl.className = 'admin-badge';
      badgeEl.textContent = badge;
      nickGroup.appendChild(badgeEl);
    }
  };

  // Update messages currently visible in the DOM
  for (const msgEl of chatMessages.querySelectorAll(`.chat-msg[data-user-id="${CSS.escape(userId)}"]`)) {
    applyBadge(msgEl);
  }

  // Also update messages stored in caches (when on a different tab)
  for (const node of channelMessagesCache) {
    applyBadge(node);
  }
  for (const nodes of channelViewMessagesCache.values()) {
    for (const node of nodes) {
      applyBadge(node);
    }
  }
}

/**
 * Updates nickname colors for all messages from a given user across all tabs.
 * @param {string} userId
 * @param {string|null} roleColor
 */
export function updateChatNickColors(userId, roleColor) {
  if (!userId) {
    return;
  }
  const color = roleColor || nicknameColor(userId);

  const applyColor = (msgEl) => {
    if (!msgEl.classList?.contains('chat-msg') || msgEl.dataset.userId !== userId) {
      return;
    }
    msgEl.dataset.roleColor = roleColor || '';
    for (const nick of msgEl.querySelectorAll('.chat-msg-nick, .compact-nick')) {
      nick.style.color = color;
    }
  };

  for (const msgEl of chatMessages.querySelectorAll(`.chat-msg[data-user-id="${CSS.escape(userId)}"]`)) {
    applyColor(msgEl);
  }
  for (const node of channelMessagesCache) {
    applyColor(node);
  }
  for (const nodes of channelViewMessagesCache.values()) {
    for (const node of nodes) {
      applyColor(node);
    }
  }

  for (const msg of channelMessagesPending) {
    if (msg.userId === userId) {
      msg.roleColor = roleColor;
    }
  }
  for (const msgs of channelViewMessagesPending.values()) {
    for (const msg of msgs) {
      if (msg.userId === userId) {
        msg.roleColor = roleColor;
      }
    }
  }
}

// --- Desktop Notifications ---

function resolveMentionsText(text) {
  return text
    .replace(/#c\(([^)]+)\)/g, (full, channelId) => {
      const channels = window.gimodiChannels || [];
      const ch = channels.find((c) => c.id === channelId);
      return '#' + (ch ? ch.name : 'channel');
    })
    .replace(/@u\(([^)]+)\)/g, (full, id) => {
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
      return `@${nick}`;
    });
}

function checkMentionInMessage(content) {
  const myUserId = provider.userId;
  const myClientId = provider.clientId;
  if (myUserId && content.includes(`@u(${myUserId})`)) {
    return true;
  }
  if (myClientId && content.includes(`@u(${myClientId})`)) {
    return true;
  }
  return false;
}

function onMessage(e) {
  const msg = e.detail;
  console.log('[chat:onMessage]', {
    channelId: msg.channelId,
    currentChannelId,
    activeTabType: activeTab.type,
    activeTabChannelId: activeTab.channelId,
    cvTabCount: channelViewTabs.length,
    cvTabChannelIds: channelViewTabs.map((t) => t.channelId),
    nickname: msg.nickname,
    contentSnippet: (msg.content || '').substring(0, 30),
  });
  // Cache the nickname from live messages
  if (msg.userId && msg.nickname) {
    setNickname(msg.userId, msg.nickname);
  }

  const isSelf = msg.clientId === provider.clientId;

  // For providers without tabs/channels (e.g. DMs), append directly
  if (!provider.supportsTabs) {
    appendMessage(msg);
    scrollToBottom();
    return;
  }

  // Check for mention and show notification
  const isMention = checkMentionInMessage(msg.content);

  if (!isSelf && provider.supportsNotifications) {
    const channelName = msg.channelName || '#Channel';
    // Suppress mention notification if user has this channel open (regardless of focus)
    const viewingThisChannel = getViewingChannelId() === msg.channelId;
    if (!(isMention && viewingThisChannel)) {
      const resolvedContent = resolveMentionsText(msg.content).substring(0, 100);
      const notifBody = isMention ? `${msg.nickname} mentioned you: ${resolvedContent}` : `${msg.nickname}: ${resolvedContent}`;
      notificationService.show({
        type: isMention ? 'mention' : 'message',
        title: channelName,
        body: notifBody,
        action: { type: 'channel', channelId: msg.channelId },
      });
    }
    // Mark channel as unread in channel tree if not currently viewing it
    if (!viewingThisChannel && !unreadChannels.has(msg.channelId)) {
      unreadChannels.add(msg.channelId);
      window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
    }
  }

  // Handle channel-view tabs (active or buffered)
  const cvTab = channelViewTabs.find((t) => t.channelId === msg.channelId);
  if (cvTab) {
    if (activeTab.type === 'channel-view' && activeTab.channelId === msg.channelId) {
      console.log('[chat:onMessage] → appendMessage via channel-view tab');
      appendMessage(msg);
      scrollToBottom();
    } else {
      console.log('[chat:onMessage] → BUFFERED in channel-view pending (activeTab:', activeTab.type, activeTab.channelId, ')');
      let pending = channelViewMessagesPending.get(msg.channelId);
      if (!pending) {
        pending = [];
        channelViewMessagesPending.set(msg.channelId, pending);
      }
      pending.push(msg);
      if (!isSelf) {
        cvTab.unread = true;
        renderTabs();
      }
    }
    return;
  }

  if (msg.channelId !== currentChannelId) {
    console.log('[chat:onMessage] → DROPPED: channelId mismatch', msg.channelId, '!==', currentChannelId);
    return;
  }

  if (activeTab.type !== 'channel') {
    console.log('[chat:onMessage] → BUFFERED in channel pending (activeTab:', activeTab.type, ')');
    // Buffer message - will be rendered when the user switches back to the channel tab
    channelMessagesPending.push(msg);
    if (!isSelf) {
      channelTabUnread = true;
      renderTabs();
    }
    return;
  }

  console.log('[chat:onMessage] → appendMessage via channel tab');
  appendMessage(msg);
  scrollToBottom();
}

function onChatCleared(e) {
  const { channelId } = e.detail;

  if (channelId === currentChannelId) {
    channelMessagesCache.length = 0;
    channelMessagesPending.length = 0;
    channelTabUnread = false;
    paginationState.channel = { oldestTs: null, allLoaded: false, loading: false };
    if (activeTab.type === 'channel') {
      chatMessages.innerHTML = '';
    }
  }

  channelViewMessagesCache.delete(channelId);
  channelViewMessagesPending.delete(channelId);
  paginationState.channelView.delete(channelId);

  if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
    chatMessages.innerHTML = '';
  }
}

function onChatPurged(e) {
  const { clientId, userId } = e.detail;

  const selectors = [];
  if (clientId) {
    selectors.push(`.chat-msg[data-client-id="${CSS.escape(clientId)}"]`);
  }
  if (userId) {
    selectors.push(`.chat-msg[data-user-id="${CSS.escape(userId)}"]`);
  }
  if (selectors.length === 0) {
    return;
  }

  const selector = selectors.join(', ');
  for (const el of chatMessages.querySelectorAll(selector)) {
    el.remove();
  }

  const matchesNode = (node) => (clientId && node.dataset?.clientId === clientId) || (userId && node.dataset?.userId === userId);

  const matchesMsg = (msg) => (clientId && msg.clientId === clientId) || (userId && msg.userId === userId);

  for (let i = channelMessagesCache.length - 1; i >= 0; i--) {
    if (matchesNode(channelMessagesCache[i])) {
      channelMessagesCache.splice(i, 1);
    }
  }

  for (const [chId, nodes] of channelViewMessagesCache) {
    const filtered = nodes.filter((n) => !matchesNode(n));
    if (filtered.length === 0) {
      channelViewMessagesCache.delete(chId);
    } else {
      channelViewMessagesCache.set(chId, filtered);
    }
  }

  for (let i = channelMessagesPending.length - 1; i >= 0; i--) {
    if (matchesMsg(channelMessagesPending[i])) {
      channelMessagesPending.splice(i, 1);
    }
  }

  for (const [chId, msgs] of channelViewMessagesPending) {
    const filtered = msgs.filter((m) => !matchesMsg(m));
    if (filtered.length === 0) {
      channelViewMessagesPending.delete(chId);
    } else {
      channelViewMessagesPending.set(chId, filtered);
    }
  }
}

function onMessageDeleted(e) {
  const { messageId } = e.detail;
  const el = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!el) {
    return;
  }

  // If this is a header message (not grouped) and the next sibling is grouped, promote it
  if (!el.classList.contains('chat-msg-grouped')) {
    const next = el.nextElementSibling;
    if (next && next.classList.contains('chat-msg-grouped')) {
      next.classList.remove('chat-msg-grouped');
      const nextUserId = next.dataset.userId;
      const nextClientId = next.dataset.clientId;
      const nickname = (nextUserId && getCachedNickname(nextUserId)) || next.dataset.nickname;
      const headerTime = formatRelativeTime(Number(next.dataset.timestamp));

      let badge = next.dataset.badge || null;
      let promoteRoleColor = next.dataset.roleColor || null;
      if (window.gimodiClients) {
        const liveClient = (nextClientId && window.gimodiClients.find((c) => c.id === nextClientId)) || (nextUserId && window.gimodiClients.find((c) => c.userId === nextUserId));
        if (liveClient) {
          badge = liveClient.badge || null;
          promoteRoleColor = liveClient.roleColor || null;
        }
      }
      const badgeHtml = badge ? `<span class="admin-badge">${escapeHtml(badge)}</span>` : '';
      const promoteNickColor = promoteRoleColor || nicknameColor(nickname);

      const avatarEl = next.querySelector('.chat-msg-avatar');
      if (avatarEl) {
        avatarEl.classList.remove('chat-msg-avatar-grouped');
        avatarEl.textContent = nickname.trim().split(/\s+/).map((w) => w[0]).join('').substring(0, 2).toUpperCase();
      }
      const header = document.createElement('div');
      header.className = 'chat-msg-header';
      header.innerHTML = `
        <span class="chat-msg-nick-group"><span class="chat-msg-nick" style="color:${promoteNickColor}">${escapeHtml(nickname)}</span>${badgeHtml}</span>
        <span class="chat-msg-time">${headerTime}</span>
      `;
      const content = next.querySelector('.chat-msg-content');
      const insertBefore = content?.querySelector('.chat-msg-reply, .chat-msg-body');
      if (content && insertBefore) {
        content.insertBefore(header, insertBefore);
      }
    }
  }

  el.remove();
}

function onPreviewRemoved(e) {
  const { messageId } = e.detail;
  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) {
    return;
  }
  msgEl.querySelector('.link-previews')?.remove();
}

function onLinkPreview(e) {
  const { messageId, channelId, previews } = e.detail;
  if (channelId !== currentChannelId || !previews?.length) {
    return;
  }

  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) {
    return;
  }

  const body = msgEl.querySelector('.chat-msg-body');
  if (!body) {
    return;
  }

  const embeddedUrls = new Set([...msgEl.querySelectorAll('.media-embed-link')].map((a) => a.href));
  const remaining = previews.filter((p) => !embeddedUrls.has(p.url));
  if (!remaining.length) {
    return;
  }

  appendPreviewCards(body, remaining);
  scrollToBottom();
}

/**
 * Extracts a YouTube video ID from a URL, or returns null.
 * @param {string} url
 * @returns {string|null}
 */
function extractYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/**
 * Extracts a start time parameter from a YouTube URL, or returns null.
 * @param {string} url
 * @returns {string|null}
 */
function extractYouTubeStart(url) {
  const m = url.match(/[?&]t=(\d+)/);
  return m ? m[1] : null;
}

/**
 * Renders an embeddable media preview card, or falls back to a standard link preview.
 * @param {{url: string, title: string, description: string, image: string|null, siteName: string}} preview
 * @returns {string}
 */
function renderPreviewCard(preview) {
  const imageHtml = preview.image ? `<img class="link-preview-image" src="${escapeHtml(preview.image)}" alt="" loading="lazy">` : '';
  const titleHtml = preview.title ? `<div class="link-preview-title">${escapeHtml(preview.title)}</div>` : '';
  const descHtml = preview.description ? `<div class="link-preview-desc">${escapeHtml(preview.description)}</div>` : '';

  return `
    <a class="link-preview-card" href="${escapeHtml(preview.url)}" title="${escapeHtml(preview.url)}">
      ${imageHtml}
      <div class="link-preview-text">
        <div class="link-preview-site">${escapeHtml(preview.siteName || '')}</div>
        ${titleHtml}
        ${descHtml}
      </div>
    </a>
  `;
}

function appendPreviewCards(bodyEl, previews) {
  const msgEl = bodyEl.closest('[data-msg-id]');
  const messageId = msgEl?.dataset.msgId;
  const isOwner = msgEl?.dataset.userId === provider.userId;

  const container = document.createElement('div');
  container.className = 'link-previews';
  container.innerHTML = previews.map(renderPreviewCard).join('');

  // Open links in system browser
  for (const a of container.querySelectorAll('.link-preview-card, .media-embed-link')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) {
        window.gimodi.openExternal(href);
      }
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href');
      if (href) {
        showLinkContextMenu(e.clientX, e.clientY, href);
      }
    });
  }

  // Copy image from link preview
  for (const img of container.querySelectorAll('.link-preview-image')) {
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showImageContextMenu(e.clientX, e.clientY, img.src);
    });
  }

  // Dismiss button - removes preview for all (owner) or locally only (non-owner)
  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'link-preview-dismiss';
  dismissBtn.title = isOwner ? 'Remove preview for everyone' : 'Hide preview';
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOwner && messageId) {
      try {
        await provider.removePreview(messageId);
      } catch {
        container.remove();
      }
    } else {
      container.remove();
    }
  });
  const firstCard = container.querySelector('.link-preview-card') || container.querySelector('.media-embed');
  (firstCard || container).appendChild(dismissBtn);

  activateMediaEmbedButtons(container);

  bodyEl.appendChild(container);
}

/**
 * Scans a message element for embeddable URLs and appends inline media players.
 * @param {HTMLElement} msgEl
 */
function appendMediaEmbeds(msgEl) {
  const body = msgEl.querySelector('.chat-msg-body');
  if (!body) {
    return;
  }

  const links = body.querySelectorAll('a[href]');
  const embeds = [];

  for (const a of links) {
    const href = a.getAttribute('href');
    const ytId = extractYouTubeId(href);
    if (ytId) {
      const start = extractYouTubeStart(href);
      const embed = document.createElement('div');
      embed.className = 'media-embed';
      embed.dataset.embedId = ytId;
      embed.dataset.embedStart = start || '';
      if (mediaEmbedPrivacy) {
        embed.innerHTML = `
          <div class="media-embed-player media-embed-placeholder">
            <button class="media-embed-load" aria-label="Load preview"><i class="bi bi-eye"></i> Load preview</button>
          </div>
          <a class="media-embed-link" href="${escapeHtml(href)}" title="${escapeHtml(href)}">
            <i class="bi bi-box-arrow-up-right"></i> ${escapeHtml(a.textContent || href)}
          </a>
        `;
      } else {
        const embedUrl = `https://www.youtube-nocookie.com/embed/${escapeHtml(ytId)}?vq=hd1080${start ? `&start=${start}` : ''}`;
        embed.innerHTML = `
          <div class="media-embed-player">
            <iframe src="${escapeHtml(embedUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
          </div>
          <a class="media-embed-link" href="${escapeHtml(href)}" title="${escapeHtml(href)}">
            <i class="bi bi-box-arrow-up-right"></i> ${escapeHtml(a.textContent || href)}
          </a>
        `;
      }

      const link = embed.querySelector('.media-embed-link');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        window.gimodi.openExternal(href);
      });
      link.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showLinkContextMenu(e.clientX, e.clientY, href);
      });

      embeds.push(embed);
    }
  }

  for (const embed of embeds) {
    body.appendChild(embed);
  }

  activateMediaEmbedButtons(body);
}

/**
 * Replaces a media embed placeholder with a live iframe when the play button is clicked.
 * @param {HTMLElement} container
 */
/**
 * Activates load-preview buttons on media embeds (step 1: load thumbnail, step 2: play video).
 * @param {HTMLElement} container
 */
function activateMediaEmbedButtons(container) {
  for (const btn of container.querySelectorAll('.media-embed-load')) {
    btn.addEventListener('click', () => {
      const embed = btn.closest('.media-embed');
      if (!embed) {
        return;
      }
      const videoId = embed.dataset.embedId;
      const player = embed.querySelector('.media-embed-player');
      player.innerHTML = `
        <img src="https://img.youtube.com/vi/${escapeHtml(videoId)}/hqdefault.jpg" alt="" loading="lazy">
        <button class="media-embed-play" aria-label="Play video"><i class="bi bi-play-fill"></i></button>
      `;
      player.querySelector('.media-embed-play').addEventListener('click', () => {
        const start = embed.dataset.embedStart;
        const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&vq=hd1080${start ? `&start=${start}` : ''}`;
        player.classList.remove('media-embed-placeholder');
        player.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      });
    });
  }
}

function isFileMessage(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed && parsed.type === 'file';
  } catch {
    return false;
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function resolveFileUrl(url) {
  if (url && url.startsWith('/')) {
    return getHttpBaseUrl() + url;
  }
  return url;
}

function renderFileCard(fileData) {
  fileData = { ...fileData, url: resolveFileUrl(fileData.url) };
  const isImage = fileData.mimeType.startsWith('image/');
  if (isImage) {
    return `
      <div class="chat-image-wrapper" data-url="${escapeHtml(fileData.url)}" data-filename="${escapeHtml(fileData.filename)}" data-size="${formatFileSize(fileData.size)}">
        <img class="chat-image" src="${escapeHtml(fileData.url)}" alt="${escapeHtml(fileData.filename)}" loading="lazy">
      </div>
    `;
  }
  const isVideo = fileData.mimeType.startsWith('video/');
  if (isVideo) {
    return `
      <div class="chat-video-wrapper">
        <video class="chat-video" preload="metadata">
          <source src="${escapeHtml(fileData.url)}" type="${escapeHtml(fileData.mimeType)}">
        </video>
        <div class="chat-video-play-btn"><i class="bi bi-play-fill"></i></div>
      </div>
    `;
  }
  const isAudio = fileData.mimeType.startsWith('audio/');
  if (isAudio) {
    return `
      <div class="chat-audio-wrapper">
        <audio class="chat-audio" controls preload="metadata">
          <source src="${escapeHtml(fileData.url)}" type="${escapeHtml(fileData.mimeType)}">
        </audio>
      </div>
    `;
  }
  return `
    <div class="file-card" data-url="${escapeHtml(fileData.url)}" data-filename="${escapeHtml(fileData.filename)}">
      <div class="file-card-info">
        <span class="file-card-name">${escapeHtml(fileData.filename)}</span>
        <span class="file-card-size">${formatFileSize(fileData.size)}</span>
      </div>
    </div>
  `;
}

function getHttpBaseUrl() {
  // Derive HTTP base URL from the server address
  const addr = provider.address;
  if (!addr) {
    return '';
  }
  if (addr.startsWith('ws://')) {
    return addr.replace(/^ws:\/\//, 'http://').replace(/\/+$/, '');
  }
  if (addr.startsWith('wss://')) {
    return addr.replace(/^wss:\/\//, 'https://').replace(/\/+$/, '');
  }
  return `https://${addr}`.replace(/\/+$/, '');
}

function uploadFile(file, channelId) {
  const uploadChannelId = channelId || currentChannelId;
  if (!uploadChannelId || !provider.clientId) {
    return;
  }

  if (provider.maxFileSize && file.size > provider.maxFileSize) {
    appendSystemMessage(`Upload failed: File is too large (${formatFileSize(file.size)}). Maximum allowed size is ${formatFileSize(provider.maxFileSize)}.`);
    return;
  }

  const baseUrl = getHttpBaseUrl();
  if (!baseUrl) {
    return;
  }

  const uploadId = Math.random().toString(36).slice(2);
  const card = document.createElement('div');
  card.className = 'upload-progress-card';
  card.id = `upload-${uploadId}`;
  card.innerHTML = `
    <div class="upload-progress-header">
      <span class="upload-progress-name">${escapeHtml(file.name)}</span>
      <button class="upload-cancel-btn" title="Cancel upload">✕</button>
    </div>
    <div class="upload-progress-bar-wrap">
      <div class="upload-progress-bar" style="width: 0%"></div>
    </div>
    <div class="upload-progress-meta">
      <span class="upload-progress-pct">0%</span>
      <span class="upload-progress-size">0 B / ${formatFileSize(file.size)}</span>
    </div>
  `;
  chatMessages.appendChild(card);
  scrollToBottom();

  const xhr = new XMLHttpRequest();

  card.querySelector('.upload-cancel-btn').addEventListener('click', () => xhr.abort());

  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) {
      return;
    }
    const pct = Math.round((e.loaded / e.total) * 100);
    card.querySelector('.upload-progress-bar').style.width = `${pct}%`;
    card.querySelector('.upload-progress-pct').textContent = `${pct}%`;
    card.querySelector('.upload-progress-size').textContent = `${formatFileSize(e.loaded)} / ${formatFileSize(e.total)}`;
  });

  xhr.addEventListener('load', () => {
    card.remove();
    if (xhr.status < 200 || xhr.status >= 300) {
      let errMsg = 'Upload failed';
      try {
        errMsg = JSON.parse(xhr.responseText).error || errMsg;
      } catch {
        /* ignored */
      }
      appendSystemMessage(`Upload failed: ${errMsg}`);
    }
  });

  xhr.addEventListener('error', () => {
    card.remove();
    appendSystemMessage('Upload failed: network error');
  });

  xhr.addEventListener('abort', () => {
    card.remove();
    appendSystemMessage('Upload cancelled');
  });

  xhr.open('POST', `${baseUrl}/files`);
  xhr.setRequestHeader('X-Channel-Id', uploadChannelId);
  xhr.setRequestHeader('X-Client-Id', provider.clientId);
  xhr.setRequestHeader('X-Filename', file.name);
  xhr.send(file);
}

const GROUP_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function getDayKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(timestamp) {
  const d = new Date(timestamp);
  if (getDayKey(timestamp) === getDayKey(Date.now())) {
    return 'Today';
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (getDayKey(timestamp) === getDayKey(yesterday.getTime())) {
    return 'Yesterday';
  }
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function maybeInsertDaySeparator(timestamp) {
  const dayKey = getDayKey(timestamp);
  const seps = chatMessages.querySelectorAll('.chat-day-separator');
  const lastKey = seps.length ? seps[seps.length - 1].dataset.dayKey : null;
  if (dayKey === lastKey) {
    return;
  }
  const sep = document.createElement('div');
  sep.className = 'chat-day-separator';
  sep.dataset.dayKey = dayKey;
  const label = document.createElement('span');
  label.textContent = formatDayLabel(timestamp);
  sep.appendChild(label);
  chatMessages.appendChild(sep);
}

/**
 * Returns a deterministic HSL color for a nickname string.
 * The hue is derived from a hash of the string, saturation and lightness are
 * fixed at values that ensure visibility on both dark and light themes.
 * @param {string} [str]
 * @returns {string}
 */
function nicknameColor(str) {
  if (!str) {
    return '#FFD700';
  }
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  const hue = hash % 260;
  return `hsl(${hue}, 70%, 62%)`;
}

function buildMessageEl(msg, prevEl) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.dataset.msgId = msg.id;
  el.dataset.clientId = msg.clientId || '';
  el.dataset.userId = msg.userId || '';
  el.dataset.badge = msg.badge || '';
  el.dataset.roleColor = msg.roleColor || '';
  el.dataset.timestamp = msg.timestamp;
  el.dataset.content = msg.content || '';

  // Resolve display nickname: from cache (for history), or from live msg, or fallback
  const displayNickname = (msg.userId && getCachedNickname(msg.userId)) || msg.nickname || '[Anonymous]';
  el.dataset.nickname = displayNickname;

  const compactTime = formatTimeShort(msg.timestamp);
  const headerTime = formatRelativeTime(msg.timestamp);
  const fullTime = formatDateTime(msg.timestamp);

  // Check if this message can be grouped with the previous one
  const prev = prevEl || null;
  const sameAuthor =
    prev &&
    ((msg.userId && prev.dataset.userId === msg.userId) || (msg.clientId && prev.dataset.clientId === msg.clientId) || (!msg.clientId && !msg.userId && prev.dataset.nickname === displayNickname));
  const prevTs = Number(prev?.dataset.timestamp);
  const isGrouped = sameAuthor && msg.timestamp - prevTs < GROUP_TIMEOUT && getDayKey(msg.timestamp) === getDayKey(prevTs);

  let bodyHtml;
  const emojiOnly = !isFileMessage(msg.content) && isEmojiOnly(replaceEmoticons(msg.content));
  if (isFileMessage(msg.content)) {
    const fileData = JSON.parse(msg.content);
    bodyHtml = renderFileCard(fileData);
  } else {
    bodyHtml = renderMarkdown(msg.content);
  }

  // Look up badge and role color: prefer live client list (up-to-date), fall back to msg data
  let badge = msg.badge || null;
  let roleColor = msg.roleColor || null;
  if (window.gimodiClients) {
    const liveClient = (msg.clientId && window.gimodiClients.find((c) => c.id === msg.clientId)) || (msg.userId && window.gimodiClients.find((c) => c.userId === msg.userId));
    if (liveClient) {
      badge = liveClient.badge || null;
      roleColor = liveClient.roleColor || null;
    }
  }
  const nickColor = roleColor || nicknameColor(displayNickname);

  const badgeHtml = badge ? `<span class="admin-badge">${escapeHtml(badge)}</span>` : '';

  const editedLabel = msg.editedAt ? `<span class="chat-msg-edited" title="${escapeHtml(formatDateTime(msg.editedAt))}">(edited)</span>` : '';

  // Reply reference (Discord-style)
  let replyRefHtml = '';
  if (msg.replyTo) {
    const replyNickname = msg.replyToNickname || '[Unknown]';
    const rawReplyContent = msg.replyToContent && isFileMessage(msg.replyToContent) ? 'click to see attachment' : msg.replyToContent ? resolveMentionsText(msg.replyToContent) : '';
    const replyPreview = rawReplyContent.length > 100 ? rawReplyContent.substring(0, 100) + '…' : rawReplyContent;
    replyRefHtml = `
      <div class="chat-msg-reply" data-reply-to="${escapeHtml(msg.replyTo)}">
        <i class="bi bi-reply"></i>
        <span class="chat-msg-reply-nick">${escapeHtml(replyNickname)}</span>
        ${replyPreview ? `<span class="chat-msg-reply-content">${escapeHtml(replyPreview)}</span>` : ''}
      </div>
    `;
  }

  // Compact inline row (hidden in default mode, shown in compact mode)
  const compactHtml = `<span class="compact-row"><span class="compact-time" title="${escapeHtml(fullTime)}">${compactTime}</span> <span class="compact-nick" style="color:${nickColor}" title="${badge ? escapeHtml(badge) : ''}">${escapeHtml(displayNickname)}</span></span>`;

  const initials = displayNickname.trim().split(/\s+/).map((w) => w[0]).join('').substring(0, 2).toUpperCase();

  if (isGrouped) {
    el.classList.add('chat-msg-grouped');
    el.innerHTML = `
      <div class="chat-msg-avatar chat-msg-avatar-grouped"></div>
      <div class="chat-msg-content">
        ${compactHtml}
        ${replyRefHtml}
        <div class="chat-msg-body${emojiOnly ? ' emoji-only' : ''}">${bodyHtml}</div>
        ${editedLabel}
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="chat-msg-avatar">${escapeHtml(initials)}</div>
      <div class="chat-msg-content">
        ${compactHtml}
        <div class="chat-msg-header">
          <span class="chat-msg-nick-group"><span class="chat-msg-nick" style="color:${nickColor}">${escapeHtml(displayNickname)}</span>${badgeHtml}</span>
          <span class="chat-msg-time">${headerTime}</span>${editedLabel}
        </div>
        ${replyRefHtml}
        <div class="chat-msg-body${emojiOnly ? ' emoji-only' : ''}">${bodyHtml}</div>
      </div>
    `;
  }
  el.title = fullTime;

  // Click on reply reference → scroll to original message
  const replyRef = el.querySelector('.chat-msg-reply[data-reply-to]');
  if (replyRef) {
    replyRef.style.cursor = 'pointer';
    replyRef.addEventListener('click', () => {
      const targetId = replyRef.dataset.replyTo;
      const targetEl = chatMessages.querySelector(`.chat-msg[data-msg-id="${targetId}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.classList.add('chat-msg-highlight');
        setTimeout(() => targetEl.classList.remove('chat-msg-highlight'), 2000);
      }
    });
  }

  // Add copy button to code blocks
  for (const pre of el.querySelectorAll('.chat-msg-body pre')) {
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

  // Open links in system browser
  for (const a of el.querySelectorAll('.chat-msg-body a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) {
        window.gimodi.openExternal(href);
      }
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href');
      if (href) {
        showLinkContextMenu(e.clientX, e.clientY, href);
      }
    });
  }

  // Image click → lightbox
  for (const img of el.querySelectorAll('.chat-image')) {
    const wrapper = img.closest('.chat-image-wrapper');
    const imgMeta = { filename: wrapper?.dataset.filename, size: wrapper?.dataset.size, url: wrapper?.dataset.url };
    img.addEventListener('click', () => openLightbox(img.src, img.alt, imgMeta));
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showImageContextMenu(e.clientX, e.clientY, img.src, imgMeta.filename, imgMeta.size, imgMeta.url);
    });
  }

  // Video play button handling
  for (const wrapper of el.querySelectorAll('.chat-video-wrapper')) {
    const video = wrapper.querySelector('.chat-video');
    const playBtn = wrapper.querySelector('.chat-video-play-btn');
    if (!video || !playBtn) {
      continue;
    }

    playBtn.addEventListener('click', () => {
      // Stop all other videos and reset them to default state
      for (const otherWrapper of document.querySelectorAll('.chat-video-wrapper.playing')) {
        if (otherWrapper === wrapper) {
          continue;
        }
        const otherVideo = otherWrapper.querySelector('.chat-video');
        if (otherVideo) {
          otherVideo.pause();
          otherVideo.currentTime = 0;
          otherVideo.removeAttribute('controls');
        }
        otherWrapper.classList.remove('playing');
      }
      video.setAttribute('controls', '');
      wrapper.classList.add('playing');
      video.play();
    });

    video.addEventListener('ended', () => {
      video.currentTime = 0;
      video.removeAttribute('controls');
      wrapper.classList.remove('playing');
    });
  }

  // File name click → download (for video/audio info)
  for (const link of el.querySelectorAll('.image-download')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.gimodi.downloadFile(link.dataset.url, link.dataset.filename);
    });
  }

  // File card click → download in app
  const fileCard = el.querySelector('.file-card');
  if (fileCard) {
    fileCard.addEventListener('click', () => {
      const url = fileCard.dataset.url;
      const filename = fileCard.dataset.filename;
      if (url) {
        window.gimodi.downloadFile(url, filename);
      }
    });
  }

  // Render inline media embeds (YouTube etc.) from message links
  appendMediaEmbeds(el);

  // Render link previews from history (skip URLs already embedded)
  if (msg.linkPreviews?.length) {
    const body = el.querySelector('.chat-msg-body');
    const embeddedUrls = new Set([...el.querySelectorAll('.media-embed-link')].map((a) => a.getAttribute('href')));
    const remaining = msg.linkPreviews.filter((p) => !embeddedUrls.has(p.url));
    if (remaining.length) {
      appendPreviewCards(body, remaining);
    }
  }

  // Render reactions
  if (msg.reactions?.length) {
    renderReactions(el, msg.id, msg.reactions);
  }

  // Hover action toolbar (Discord-style) - reaction + delete in one bar
  const canDelete = provider.supportsDelete && ((msg.userId && msg.userId === provider.userId) || provider.hasPermission('chat.delete_any'));
  const showActions = (provider.supportsReactions && provider.userId) || canDelete;
  if (showActions) {
    const hoverActions = document.createElement('div');
    hoverActions.className = 'chat-msg-actions';

    // Add Reaction button
    if (provider.supportsReactions && provider.userId) {
      const addReactionBtn = document.createElement('button');
      addReactionBtn.className = 'chat-msg-action-btn';
      addReactionBtn.title = 'Add Reaction';
      addReactionBtn.innerHTML = '<i class="bi bi-emoji-smile"></i>';
      addReactionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = addReactionBtn.getBoundingClientRect();
        showQuickReactionPicker(rect.left, rect.bottom + 4, msg.id);
      });
      hoverActions.appendChild(addReactionBtn);
    }

    // Reply button
    if (provider.supportsReplies && provider.userId) {
      const replyBtn = document.createElement('button');
      replyBtn.className = 'chat-msg-action-btn';
      replyBtn.title = 'Reply';
      replyBtn.innerHTML = '<i class="bi bi-reply"></i>';
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startReplyTo(msg);
      });
      hoverActions.appendChild(replyBtn);
    }

    // Edit button (own messages, non-file, requires identity)
    if (provider.supportsEdit) {
      const canEdit = msg.userId && msg.userId === provider.userId && !isFileMessage(msg.content);
      if (canEdit) {
        const editBtn = document.createElement('button');
        editBtn.className = 'chat-msg-action-btn';
        editBtn.title = 'Edit message';
        editBtn.innerHTML = '<i class="bi bi-pencil"></i>';
        editBtn.addEventListener('click', () => {
          const msgEl = document.querySelector(`.chat-msg[data-msg-id="${msg.id}"]`);
          if (msgEl) {
            enterEditMode(msgEl, msg.id);
          }
        });
        hoverActions.appendChild(editBtn);
      }
    }

    // Pin/Unpin button (requires chat.pin permission)
    if (provider.supportsPinning && provider.hasPermission('chat.pin')) {
      const viewingChannelId = getViewingChannelId();
      const pinnedSet = (viewingChannelId ? channelPinnedMessages.get(viewingChannelId) : null) || new Set();
      const isPinned = pinnedSet.has(msg.id);

      const pinBtn = document.createElement('button');
      pinBtn.className = 'chat-msg-action-btn';
      pinBtn.title = isPinned ? 'Unpin message' : 'Pin message';
      pinBtn.innerHTML = isPinned ? '<i class="bi bi-pin-angle-fill"></i>' : '<i class="bi bi-pin-angle"></i>';
      pinBtn.addEventListener('click', () => {
        if (isPinned) {
          provider.unpinMessage(msg.id);
        } else {
          provider.pinMessage(msg.id);
        }
      });
      hoverActions.appendChild(pinBtn);
    }

    // Delete button
    if (canDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'chat-msg-action-btn chat-msg-action-delete';
      deleteBtn.title = 'Delete message';
      deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
      deleteBtn.addEventListener('click', () => {
        provider.deleteMessage(msg.id).catch((err) => {
          appendSystemMessage(`Delete failed: ${err.message}`);
        });
      });
      hoverActions.appendChild(deleteBtn);
    }

    el.appendChild(hoverActions);
  }

  return el;
}

function appendMessage(msg) {
  const allMsgs = chatMessages.querySelectorAll('.chat-msg');
  const prevEl = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1] : null;
  const el = buildMessageEl(msg, prevEl);
  maybeInsertDaySeparator(msg.timestamp);
  chatMessages.appendChild(el);
}

function refreshNodeTimestamps(el) {
  if (el.classList.contains('chat-msg')) {
    const ts = Number(el.dataset.timestamp);
    if (!ts) {
      return;
    }
    const compactTimeEl = el.querySelector('.compact-time');
    if (compactTimeEl) {
      compactTimeEl.textContent = formatTimeShort(ts);
      compactTimeEl.title = formatDateTime(ts);
    }
    const timeEl = el.querySelector('.chat-msg-time');
    if (timeEl) {
      timeEl.textContent = formatRelativeTime(ts);
    }
    el.title = formatDateTime(ts);
  }
}

export function setChatDisplayMode(mode) {
  compactMode = mode === 'compact';
  for (const el of document.querySelectorAll('.chat-messages')) {
    el.classList.toggle('compact-mode', compactMode);
  }
}

/**
 * Sets whether media embeds require user confirmation before loading external content.
 * @param {boolean} enabled
 */
export function setMediaEmbedPrivacy(enabled) {
  mediaEmbedPrivacy = enabled;
}

export function refreshTimestamps() {
  if (!chatMessages) {
    return;
  }
  // Live DOM children
  for (const el of chatMessages.children) {
    refreshNodeTimestamps(el);
  }
  // Cached DOM nodes (individual elements, not containers)
  for (const el of channelMessagesCache) {
    refreshNodeTimestamps(el);
  }
}

function onChatSubscribed(e) {
  const { channelId, readRestricted, writeRestricted } = e.detail;
  const tab = channelViewTabs.find((t) => t.channelId === channelId);
  if (!tab) {
    return;
  }
  tab.readRestricted = !!readRestricted;
  tab.writeRestricted = !!writeRestricted;
  if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
    updateInputForTab();
  }
}

function onChannelUpdatedForReadRoles(e) {
  const { channel } = e.detail;
  const tab = channelViewTabs.find((t) => t.channelId === channel.id);
  if (!tab) {
    return;
  }

  const prevReadRoles = JSON.stringify((tab.readRoles || []).slice().sort());
  const newReadRoles = JSON.stringify((channel.readRoles || []).slice().sort());
  const prevWriteRoles = JSON.stringify((tab.writeRoles || []).slice().sort());
  const newWriteRoles = JSON.stringify((channel.writeRoles || []).slice().sort());

  if (prevReadRoles === newReadRoles && prevWriteRoles === newWriteRoles) {
    return;
  }

  tab.readRoles = channel.readRoles || [];
  tab.writeRoles = channel.writeRoles || [];

  if (prevReadRoles !== newReadRoles) {
    // Re-evaluate read restriction by reloading history
    tab.readRestricted = false;
    channelViewMessagesCache.delete(channel.id);
    if (activeTab.type === 'channel-view' && activeTab.channelId === channel.id) {
      chatMessages.innerHTML = '';
      loadChannelViewHistory(channel.id);
    }
  }

  if (prevWriteRoles !== newWriteRoles) {
    // Clear write restriction flag - server will enforce on next send attempt
    tab.writeRestricted = false;
  }

  if (activeTab.type === 'channel-view' && activeTab.channelId === channel.id) {
    updateInputForTab();
  }
}

function showReadRestrictionBanner() {
  chatMessages.innerHTML = '';
  const banner = document.createElement('div');
  banner.className = 'read-restriction-banner';
  banner.innerHTML = '<i class="bi bi-lock-fill"></i><span>You don\'t have permission to read this channel.</span>';
  chatMessages.appendChild(banner);
}

export function appendSystemMessage(text) {
  if (!chatMessages) {
    return;
  }
  const el = document.createElement('div');
  el.className = 'chat-system';
  el.textContent = text;
  chatMessages.appendChild(el);
  scrollToBottom();
}

export function setChannelName(name) {
  currentChannelName = name;
  renderTabs();
}

export function isChannelUnread(channelId) {
  return unreadChannels.has(channelId);
}

export async function initUnreadState(channels, serverAddress) {
  unreadChannels.clear();
  const lastReadMap = await window.gimodi.db.getLastRead(serverAddress);

  for (const ch of channels) {
    if (!ch.lastMessageAt) {
      continue;
    }
    const lastRead = lastReadMap[ch.id] || 0;
    if (ch.lastMessageAt > lastRead) {
      unreadChannels.add(ch.id);
    }
  }

  if (unreadChannels.size > 0) {
    window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
  }
}

/**
 * Scrolls to a specific message by ID, loading context from server if needed.
 * @param {string} messageId
 * @param {number} timestamp
 * @returns {Promise<void>}
 */
export async function scrollToMessage(messageId, timestamp) {
  return messageH.scrollToMessage(messageId, timestamp);
}

/**
 * Marks a channel as read by updating the lastRead timestamp in the database.
 * @param {string} channelId
 * @param {string} serverAddress
 * @returns {void}
 */
export function markChannelRead(channelId, serverAddress) {
  return messageH.markChannelRead(channelId, serverAddress);
}

