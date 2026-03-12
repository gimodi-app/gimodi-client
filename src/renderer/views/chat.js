import serverService from '../services/server.js';
import chatService from '../services/chat.js';
import notificationService from '../services/notifications.js';
import { tryHandleCommand, isSlashCommand } from '../services/commands.js';
import { showEmojiPicker, closeEmojiPicker, isPickerOpen } from './emoji-picker.js';
import { setNickname, invalidateNickname, getCachedNickname, resolveNicknames } from '../services/nicknameCache.js';
import { formatTime, formatTimeShort, formatDateTime, formatRelativeTime } from '../services/timeFormat.js';
import { customConfirm } from '../services/dialogs.js';
import { renderMarkdown, escapeHtml, replaceEmoticons, isEmojiOnly } from './chat-markdown.js';
import { renderReactions, showQuickReactionPicker, onReactionUpdate } from './chat-reactions.js';
import { searchEmoji, getEmoji, replaceEmojiShortcodes } from '../services/emoji-shortcodes.js';

const MAX_MESSAGE_LENGTH = 4000;

let compactMode = false;
let mediaEmbedPrivacy = true;

const chatMessages = document.getElementById('chat-messages');
const pinnedMessages = document.getElementById('pinned-messages');
const chatInput = document.getElementById('chat-input');
const chatCharCount = document.getElementById('chat-char-count');
const btnSend = document.getElementById('btn-send');
const btnAttach = document.getElementById('btn-attach');
const btnEmoji = document.getElementById('btn-emoji');
const fileInput = document.getElementById('file-input');
const btnNotifications = document.getElementById('btn-notifications');
const notificationBadge = document.getElementById('notification-badge');
const notificationDropdown = document.getElementById('notification-dropdown');

let currentChannelId = null;
let currentChannelName = 'Lobby';
let channelPinnedMessages = new Map(); // channelId → [messageIds]
let pinnedCollapsed = true;

export function getViewingChannelId() {
  if (activeTab.type === 'channel') return currentChannelId;
  if (activeTab.type === 'channel-view') return activeTab.channelId;
  return null;
}
let mentionAutocomplete = null; // Autocomplete dropdown element
let mentionStartPos = -1; // Position where @ or # was typed
let mentionTriggerChar = null; // '@' or '#'
let selectedMentions = new Map(); // nickname → { userId, clientId } for structured @u() tokens
let selectedChannelMentions = new Map(); // channelName → channelId for structured #c() tokens

// --- Typing indicator state ---
const typingUsers = new Map(); // channelId → Map(clientId → { nickname, timer })
let typingSendTimer = null;
let typingSendAllowed = true;
const TYPING_SEND_INTERVAL = 2000;
const TYPING_EXPIRE_TIMEOUT = 3000;

// --- Reply state ---
let replyToMessage = null; // { id, nickname, content, channelId } | null

// --- Tab state ---
let activeTab = { type: 'channel' }; // { type: 'channel' } | { type: 'dm', userId, persistentUserId, nickname } | { type: 'channel-view', channelId, channelName }
const dmTabs = []; // [{ userId, persistentUserId, nickname }]
const dmMessages = new Map(); // userId (clientId) → message[]
const channelViewTabs = []; // [{ channelId, channelName }]
let draggedTab = null; // { type, index } for drag-and-drop reordering
const channelViewMessagesCache = new Map(); // channelId → DOM nodes[]
const channelViewMessagesPending = new Map(); // channelId → message[] (buffered while tab inactive)
const channelMessagesCache = []; // stores channel DOM nodes when switching away
const channelMessagesPending = []; // messages received while not on channel tab, buffered for re-render
let channelTabUnread = false;
const unreadChannels = new Set(); // channelIds with unread messages

// --- Pagination state ---
const HISTORY_PAGE_SIZE = 50;
const paginationState = {
  channel: { oldestTs: null, allLoaded: false, loading: false },
  dm: new Map(), // userId → { oldestTs, allLoaded, loading }
  channelView: new Map(), // channelId → { oldestTs, allLoaded, loading }
};

function getPaginationForTab() {
  if (activeTab.type === 'channel') return paginationState.channel;
if (activeTab.type === 'dm') return paginationState.dm.get(activeTab.userId) || null;
  if (activeTab.type === 'channel-view') return paginationState.channelView.get(activeTab.channelId) || null;
  return null;
}

function resetChannelPagination() {
  paginationState.channel = { oldestTs: null, allLoaded: false, loading: false };
}

// clientId → nickname map for tracking who left
const clientNicknameMap = new Map();

function onKeydown(e) {
  // Handle mention autocomplete navigation
  if (mentionAutocomplete && !mentionAutocomplete.classList.contains('hidden')) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateMentionAutocomplete(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      const selected = mentionAutocomplete.querySelector('.mention-autocomplete-item.selected');
      if (selected) {
        e.preventDefault();
        if (mentionTriggerChar === ':') {
          selectEmojiShortcode(selected.dataset.shortcode);
        } else if (mentionTriggerChar === '#') {
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

function isInsideCodeBlock(text, pos) {
  const before = text.substring(0, pos);
  // Check triple-backtick fenced code blocks
  const tripleCount = (before.match(/```/g) || []).length;
  if (tripleCount % 2 === 1) return true;
  // Check single-backtick inline code (after removing triple backticks to avoid false matches)
  const singleCount = (before.replace(/```/g, '').match(/`/g) || []).length;
  if (singleCount % 2 === 1) return true;
  return false;
}

function onChatInputForMentions() {
  const cursorPos = chatInput.selectionStart;
  const text = chatInput.value.substring(0, cursorPos);

  // Find the last @, #, or : before cursor
  const lastAtIndex = text.lastIndexOf('@');
  const lastHashIndex = text.lastIndexOf('#');
  const lastColonIndex = text.lastIndexOf(':');

  // Determine which trigger is closest to cursor
  let triggerIndex = Math.max(lastAtIndex, lastHashIndex, lastColonIndex);
  if (triggerIndex === -1) {
    hideMentionAutocomplete();
    return;
  }
  let triggerChar = null;
  if (triggerIndex === lastAtIndex) triggerChar = '@';
  else if (triggerIndex === lastHashIndex) triggerChar = '#';
  else triggerChar = ':';

  // For @ and #, require whitespace or start-of-string before trigger
  if (triggerChar !== ':' && triggerIndex > 0 && /\S/.test(text[triggerIndex - 1])) {
    hideMentionAutocomplete();
    return;
  }

  // Don't trigger autocomplete inside code blocks
  if (isInsideCodeBlock(chatInput.value, triggerIndex)) {
    hideMentionAutocomplete();
    return;
  }

  const searchText = text.substring(triggerIndex + 1);

  // Only show autocomplete if search text doesn't contain spaces
  if (/\s/.test(searchText)) {
    hideMentionAutocomplete();
    return;
  }

  // For emoji shortcodes, require at least 2 chars to start searching
  if (triggerChar === ':' && searchText.length < 2) {
    hideMentionAutocomplete();
    return;
  }

  mentionStartPos = triggerIndex;
  mentionTriggerChar = triggerChar;

  if (triggerChar === '@') {
    const channelUsers = window.gimodiClients || [];
    const matches = channelUsers.filter(c =>
      c.nickname.toLowerCase().startsWith(searchText.toLowerCase())
    ).slice(0, 10);

    if (matches.length === 0) {
      hideMentionAutocomplete();
      return;
    }
    showMentionAutocomplete(matches);
  } else if (triggerChar === '#') {
    const allChannels = (window.gimodiChannels || []).filter(c => c.type !== 'group');
    const matches = allChannels.filter(c =>
      c.name.toLowerCase().startsWith(searchText.toLowerCase())
    ).slice(0, 10);

    if (matches.length === 0) {
      hideMentionAutocomplete();
      return;
    }
    showChannelAutocomplete(matches);
  } else {
    // : emoji shortcode
    const matches = searchEmoji(searchText, 10);
    if (matches.length === 0) {
      hideMentionAutocomplete();
      return;
    }
    showEmojiShortcodeAutocomplete(matches);
  }
}

function showMentionAutocomplete(users) {
  if (!mentionAutocomplete) {
    mentionAutocomplete = document.createElement('div');
    mentionAutocomplete.id = 'mention-autocomplete';
    mentionAutocomplete.className = 'mention-autocomplete';
    document.body.appendChild(mentionAutocomplete);
  }

  mentionAutocomplete.innerHTML = '';
  for (let i = 0; i < users.length; i++) {
    const item = document.createElement('div');
    item.className = 'mention-autocomplete-item' + (i === 0 ? ' selected' : '');
    item.dataset.nickname = users[i].nickname;
    item.dataset.userId = users[i].userId || '';
    item.dataset.clientId = users[i].id || '';
    item.textContent = users[i].nickname;
    item.addEventListener('click', () => selectMention(users[i].nickname, users[i].userId || null, users[i].id || null));
    mentionAutocomplete.appendChild(item);
  }

  // Position above the input
  const inputRect = chatInput.getBoundingClientRect();
  mentionAutocomplete.style.left = inputRect.left + 'px';
  mentionAutocomplete.style.bottom = (window.innerHeight - inputRect.top + 4) + 'px';
  mentionAutocomplete.classList.remove('hidden');
}

function hideMentionAutocomplete() {
  if (mentionAutocomplete) {
    mentionAutocomplete.classList.add('hidden');
  }
  mentionStartPos = -1;
}

function navigateMentionAutocomplete(direction) {
  if (!mentionAutocomplete) return;
  const items = Array.from(mentionAutocomplete.querySelectorAll('.mention-autocomplete-item'));
  const currentIndex = items.findIndex(item => item.classList.contains('selected'));
  if (currentIndex === -1) return;

  items[currentIndex].classList.remove('selected');
  let newIndex = currentIndex + direction;
  if (newIndex < 0) newIndex = items.length - 1;
  if (newIndex >= items.length) newIndex = 0;
  items[newIndex].classList.add('selected');
}

function selectMention(nickname, userId, clientId) {
  if (mentionStartPos === -1) return;

  const cursorPos = chatInput.selectionStart;
  const before = chatInput.value.substring(0, mentionStartPos);
  const after = chatInput.value.substring(cursorPos);

  chatInput.value = before + '@' + nickname + ' ' + after;
  chatInput.selectionStart = chatInput.selectionEnd = mentionStartPos + nickname.length + 2;
  chatInput.focus();
  autoResizeInput();

  // Record structured mention so sendMessage can transform @nickname → @u(id)
  if (userId || clientId) {
    selectedMentions.set(nickname, { userId: userId || null, clientId: clientId || null });
  }

  hideMentionAutocomplete();
}

function onChannelMentionClick(e) {
  const mention = e.target.closest('.channel-mention');
  if (!mention) return;
  const channelId = mention.dataset.channelId;
  if (!channelId) return;
  // Open chat-only tab (don't join voice)
  const channels = window.gimodiChannels || [];
  const ch = channels.find(c => c.id === channelId);
  if (ch) {
    openChannelViewTab(channelId, ch.name);
  }
}

/**
 * @param {MouseEvent} ev
 */
function onNickContextMenu(ev) {
  const nickEl = ev.target.closest('.chat-msg-nick, .compact-nick, .chat-msg-nick-group, .admin-badge');
  if (!nickEl) return;
  const msgEl = nickEl.closest('.chat-msg');
  if (!msgEl) return;
  const clientId = msgEl.dataset.clientId;
  const userId = msgEl.dataset.userId;
  if (clientId === serverService.clientId || userId === serverService.userId) return;
  const nickname = msgEl.dataset.nickname;
  const onlineClient = window.gimodiClients?.find(c =>
    (clientId && c.id === clientId) || (userId && c.userId === userId)
  );
  const user = onlineClient || {
    id: clientId || userId,
    userId: userId || null,
    nickname: nickname || '[Unknown]',
    badge: msgEl.dataset.badge || null
  };
  ev.preventDefault();
  ev.stopPropagation();
  window.dispatchEvent(new CustomEvent('gimodi:user-context-menu', {
    detail: { clientX: ev.clientX, clientY: ev.clientY, user }
  }));
}

function showChannelAutocomplete(channels) {
  if (!mentionAutocomplete) {
    mentionAutocomplete = document.createElement('div');
    mentionAutocomplete.id = 'mention-autocomplete';
    mentionAutocomplete.className = 'mention-autocomplete';
    document.body.appendChild(mentionAutocomplete);
  }

  mentionAutocomplete.innerHTML = '';
  for (let i = 0; i < channels.length; i++) {
    const item = document.createElement('div');
    item.className = 'mention-autocomplete-item' + (i === 0 ? ' selected' : '');
    item.dataset.channelName = channels[i].name;
    item.dataset.channelId = channels[i].id;
    const icon = document.createElement('i');
    icon.className = 'bi bi-hash';
    icon.style.marginRight = '6px';
    icon.style.opacity = '0.6';
    item.appendChild(icon);
    item.appendChild(document.createTextNode(channels[i].name));
    item.addEventListener('click', () => selectChannelMention(channels[i].name, channels[i].id));
    mentionAutocomplete.appendChild(item);
  }

  const inputRect = chatInput.getBoundingClientRect();
  mentionAutocomplete.style.left = inputRect.left + 'px';
  mentionAutocomplete.style.bottom = (window.innerHeight - inputRect.top + 4) + 'px';
  mentionAutocomplete.classList.remove('hidden');
}

function selectChannelMention(channelName, channelId) {
  if (mentionStartPos === -1) return;

  const cursorPos = chatInput.selectionStart;
  const before = chatInput.value.substring(0, mentionStartPos);
  const after = chatInput.value.substring(cursorPos);

  chatInput.value = before + '#' + channelName + ' ' + after;
  chatInput.selectionStart = chatInput.selectionEnd = mentionStartPos + channelName.length + 2;
  chatInput.focus();
  autoResizeInput();

  if (channelId) {
    selectedChannelMentions.set(channelName, channelId);
  }

  hideMentionAutocomplete();
}

/**
 * @param {{shortcode: string, emoji: string}[]} matches
 */
function showEmojiShortcodeAutocomplete(matches) {
  if (!mentionAutocomplete) {
    mentionAutocomplete = document.createElement('div');
    mentionAutocomplete.id = 'mention-autocomplete';
    mentionAutocomplete.className = 'mention-autocomplete';
    document.body.appendChild(mentionAutocomplete);
  }

  mentionAutocomplete.innerHTML = '';
  for (let i = 0; i < matches.length; i++) {
    const item = document.createElement('div');
    item.className = 'mention-autocomplete-item' + (i === 0 ? ' selected' : '');
    item.dataset.shortcode = matches[i].shortcode;
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'emoji';
    emojiSpan.textContent = matches[i].emoji;
    emojiSpan.style.marginRight = '8px';
    item.appendChild(emojiSpan);
    item.appendChild(document.createTextNode(':' + matches[i].shortcode + ':'));
    item.addEventListener('click', () => selectEmojiShortcode(matches[i].shortcode));
    mentionAutocomplete.appendChild(item);
  }

  const inputRect = chatInput.getBoundingClientRect();
  mentionAutocomplete.style.left = inputRect.left + 'px';
  mentionAutocomplete.style.bottom = (window.innerHeight - inputRect.top + 4) + 'px';
  mentionAutocomplete.classList.remove('hidden');
}

/**
 * @param {string} shortcode
 */
function selectEmojiShortcode(shortcode) {
  if (mentionStartPos === -1) return;

  const emoji = getEmoji(shortcode);
  if (!emoji) return;

  const cursorPos = chatInput.selectionStart;
  const before = chatInput.value.substring(0, mentionStartPos);
  const after = chatInput.value.substring(cursorPos);

  chatInput.value = before + emoji + after;
  chatInput.selectionStart = chatInput.selectionEnd = mentionStartPos + emoji.length;
  chatInput.focus();
  autoResizeInput();

  hideMentionAutocomplete();
}

function onEmojiClick() {
  if (isPickerOpen()) {
    closeEmojiPicker();
    return;
  }
  showEmojiPicker({
    anchor: btnEmoji,
    closeOnSelect: false,
    onSelect: (emoji) => {
      const start = chatInput.selectionStart;
      const end = chatInput.selectionEnd;
      chatInput.value = chatInput.value.substring(0, start) + emoji + chatInput.value.substring(end);
      chatInput.selectionStart = chatInput.selectionEnd = start + emoji.length;
      chatInput.focus();
      autoResizeInput();
    }
  });
}

function onAttachClick() {
  fileInput.click();
}

function onFileChange() {
  for (const file of fileInput.files) {
    uploadFile(file);
  }
  fileInput.value = '';
}

function onDragOver(e) {
  e.preventDefault();
  chatMessages.classList.add('drag-over');
}

function onDragLeave(e) {
  e.preventDefault();
  chatMessages.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  chatMessages.classList.remove('drag-over');
  for (const file of e.dataTransfer.files) {
    uploadFile(file);
  }
}

function onPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) uploadFile(file);
      return;
    }
  }
}

function onChatInputForTyping() {
  const typingChannelId = activeTab.type === 'channel' ? currentChannelId
    : activeTab.type === 'channel-view' ? activeTab.channelId
      : null;
  if (!typingChannelId) return;
  if (!typingSendAllowed) return;
  typingSendAllowed = false;
  chatService.sendTyping(typingChannelId);
  typingSendTimer = setTimeout(() => { typingSendAllowed = true; }, TYPING_SEND_INTERVAL);
}

function onTypingEvent(e) {
  const { clientId, nickname, channelId } = e.detail;
  if (!channelId) return;

  if (!typingUsers.has(channelId)) typingUsers.set(channelId, new Map());
  const channelTyping = typingUsers.get(channelId);

  // Clear existing timer for this user
  const existing = channelTyping.get(clientId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    channelTyping.delete(clientId);
    renderTypingIndicator();
  }, TYPING_EXPIRE_TIMEOUT);

  channelTyping.set(clientId, { nickname, timer });
  renderTypingIndicator();
}

function renderTypingIndicator() {
  let indicator = document.getElementById('typing-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'typing-indicator';
    const chatInputRow = document.querySelector('.chat-input-row');
    if (chatInputRow) chatInputRow.parentNode.insertBefore(indicator, chatInputRow);
  }

  const activeChannelForTyping = activeTab.type === 'channel' ? currentChannelId
    : activeTab.type === 'channel-view' ? activeTab.channelId
      : null;
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

  const names = [...channelTyping.values()].map(v => v.nickname);
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

function clearTypingState() {
  for (const channelTyping of typingUsers.values()) {
    for (const entry of channelTyping.values()) clearTimeout(entry.timer);
  }
  typingUsers.clear();
  if (typingSendTimer) { clearTimeout(typingSendTimer); typingSendTimer = null; }
  typingSendAllowed = true;
  renderTypingIndicator();
}

// --- Notification Bell ---

function updateNotificationBell() {
  const count = notificationService.count;
  if (count === 0) {
    notificationBadge.classList.add('hidden');
    notificationBadge.textContent = '';
  } else {
    notificationBadge.classList.remove('hidden');
    notificationBadge.textContent = count > 9 ? '9+' : String(count);
    // Shake animation: remove then re-add class to retrigger
    btnNotifications.classList.remove('bell-shake');
    void btnNotifications.offsetWidth; // reflow
    btnNotifications.classList.add('bell-shake');
  }
  // Keep dropdown contents fresh if it's open
  if (!notificationDropdown.classList.contains('hidden')) {
    renderNotificationDropdown();
  }
}

function renderNotificationDropdown() {
  notificationDropdown.innerHTML = '';
  const entries = notificationService.entries;

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'No new notifications';
    notificationDropdown.appendChild(empty);
  } else {
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'notif-item';
      item.dataset.type = entry.type;

      const icon = document.createElement('i');
      icon.className = entry.type === 'dm' ? 'bi bi-envelope notif-icon' : 'bi bi-at notif-icon';
      item.appendChild(icon);

      const text = document.createElement('div');
      text.className = 'notif-text';

      const title = document.createElement('div');
      title.className = 'notif-item-title';
      title.textContent = entry.title;
      text.appendChild(title);

      const body = document.createElement('div');
      body.className = 'notif-item-body';
      body.textContent = entry.body;
      text.appendChild(body);

      item.appendChild(text);

      // Click to navigate
      if (entry.action) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          closeNotificationDropdown();
          if (entry.action.type === 'dm') {
            switchToTab({ type: 'dm', userId: entry.action.userId, persistentUserId: entry.action.persistentUserId, nickname: entry.action.nickname });
          } else if (entry.action.type === 'channel') {
            switchToTab({ type: 'channel' });
          }
        });
      }

      notificationDropdown.appendChild(item);
    }
  }

  // Footer with "Clear all"
  const footer = document.createElement('div');
  footer.className = 'notif-footer';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'notif-clear-all';
  clearBtn.textContent = 'Clear all';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notificationService.clearAll();
    closeNotificationDropdown();
  });
  footer.appendChild(clearBtn);
  notificationDropdown.appendChild(footer);
}

let _onClickOutsideDropdown = null;

function openNotificationDropdown() {
  renderNotificationDropdown();
  notificationDropdown.classList.remove('hidden');
  // Close when clicking outside
  _onClickOutsideDropdown = (e) => {
    if (!notificationDropdown.contains(e.target) && e.target !== btnNotifications) {
      closeNotificationDropdown();
    }
  };
  setTimeout(() => document.addEventListener('click', _onClickOutsideDropdown), 0);
}

function closeNotificationDropdown() {
  notificationDropdown.classList.add('hidden');
  if (_onClickOutsideDropdown) {
    document.removeEventListener('click', _onClickOutsideDropdown);
    _onClickOutsideDropdown = null;
  }
}

function toggleNotificationDropdown() {
  if (notificationDropdown.classList.contains('hidden')) {
    openNotificationDropdown();
  } else {
    closeNotificationDropdown();
  }
}

export function initChatView(channelId) {
  console.log('[chat] initChatView channelId=', channelId);
  currentChannelId = channelId;

  activeTab = { type: 'channel' };
  dmTabs.length = 0;
  dmMessages.clear();
  channelMessagesCache.length = 0;
  channelMessagesPending.length = 0;
  channelTabUnread = false;
  resetChannelPagination();
  paginationState.dm.clear();
  paginationState.channelView.clear();
  clientNicknameMap.clear();
  cancelReply();

  // Remove any previously attached DOM listeners to avoid duplicates on reconnect
  cleanup();

  notificationService.clearAll();
  notificationService.addEventListener('change', updateNotificationBell);
  btnNotifications.addEventListener('click', toggleNotificationDropdown);
  updateNotificationBell();

  btnSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', onKeydown);
  btnEmoji.addEventListener('click', onEmojiClick);
  btnAttach.addEventListener('click', onAttachClick);
  fileInput.addEventListener('change', onFileChange);
  chatMessages.addEventListener('dragover', onDragOver);
  chatMessages.addEventListener('dragleave', onDragLeave);
  chatMessages.addEventListener('drop', onDrop);
  chatMessages.addEventListener('scroll', onChatScroll);
  chatMessages.addEventListener('click', onChannelMentionClick);
  chatMessages.addEventListener('contextmenu', onNickContextMenu);
  chatInput.addEventListener('paste', onPaste);
  chatInput.addEventListener('input', onChatInputForTyping);
  chatInput.addEventListener('input', onChatInputForMentions);
  chatInput.addEventListener('input', onChatInputForCharCount);

  chatService.addEventListener('message', onMessage);
  chatService.addEventListener('link-preview', onLinkPreview);
  chatService.addEventListener('preview-removed', onPreviewRemoved);
  chatService.addEventListener('message-deleted', onMessageDeleted);
  chatService.addEventListener('dm-message', onDmMessage);
chatService.addEventListener('cleared', onChatCleared);
  chatService.addEventListener('typing', onTypingEvent);
  chatService.addEventListener('reaction-update', onReactionUpdate);
  chatService.addEventListener('message-edited', onMessageEdited);
  chatService.addEventListener('subscribed', onChatSubscribed);
  serverService.addEventListener('chat:message-pinned', onMessagePinned);
  serverService.addEventListener('chat:message-unpinned', onMessageUnpinned);
  serverService.addEventListener('channel:updated', onChannelUpdatedForReadRoles);
  window.addEventListener('gimodi:open-dm', onOpenDm);
  window.addEventListener('gimodi:navigate-channel', onNavigateChannel);
  serverService.addEventListener('server:client-joined', onClientJoinedForCache);
  serverService.addEventListener('server:client-left', onClientLeftForCache);

  // Seed clientNicknameMap from current client list
  for (const c of (window.gimodiClients || [])) {
    clientNicknameMap.set(c.id, c.nickname);
  }

  const tabBar = document.querySelector('.tab-bar');
  if (tabBar) {
    tabBar.addEventListener('wheel', onTabBarWheel, { passive: false });
  }

  renderTabs();
  updateInputForTab();

  if (channelId) {
    loadHistory(channelId);
  }
}

export function cleanup() {
  console.log('[chat] cleanup - activeTab:', activeTab.type, 'currentChannelId:', currentChannelId, 'cvTabs:', channelViewTabs.map(t => t.channelId));
  notificationService.removeEventListener('change', updateNotificationBell);
  btnNotifications.removeEventListener('click', toggleNotificationDropdown);
  closeNotificationDropdown();
  notificationService.clearAll();

  btnSend.removeEventListener('click', sendMessage);
  chatInput.removeEventListener('keydown', onKeydown);
  btnEmoji.removeEventListener('click', onEmojiClick);
  btnAttach.removeEventListener('click', onAttachClick);
  fileInput.removeEventListener('change', onFileChange);
  chatMessages.removeEventListener('dragover', onDragOver);
  chatMessages.removeEventListener('dragleave', onDragLeave);
  chatMessages.removeEventListener('drop', onDrop);
  chatMessages.removeEventListener('scroll', onChatScroll);
  chatMessages.removeEventListener('click', onChannelMentionClick);
  chatMessages.removeEventListener('contextmenu', onNickContextMenu);
  chatInput.removeEventListener('paste', onPaste);
  chatInput.removeEventListener('input', onChatInputForTyping);
  chatInput.removeEventListener('input', onChatInputForMentions);
  chatInput.removeEventListener('input', onChatInputForCharCount);
  const tabBar = document.querySelector('.tab-bar');
  if (tabBar) {
    tabBar.removeEventListener('wheel', onTabBarWheel);
  }
  chatService.removeEventListener('message', onMessage);
  chatService.removeEventListener('link-preview', onLinkPreview);
  chatService.removeEventListener('preview-removed', onPreviewRemoved);
  chatService.removeEventListener('message-deleted', onMessageDeleted);
  chatService.removeEventListener('dm-message', onDmMessage);
chatService.removeEventListener('cleared', onChatCleared);
  chatService.removeEventListener('typing', onTypingEvent);
  chatService.removeEventListener('reaction-update', onReactionUpdate);
  chatService.removeEventListener('message-edited', onMessageEdited);
  window.removeEventListener('gimodi:open-dm', onOpenDm);
  window.removeEventListener('gimodi:navigate-channel', onNavigateChannel);
  serverService.removeEventListener('server:client-joined', onClientJoinedForCache);
  serverService.removeEventListener('server:client-left', onClientLeftForCache);
  serverService.removeEventListener('chat:message-pinned', onMessagePinned);
  serverService.removeEventListener('chat:message-unpinned', onMessageUnpinned);
  serverService.removeEventListener('channel:updated', onChannelUpdatedForReadRoles);
  clearTypingState();
  selectedMentions.clear();
  selectedChannelMentions.clear();
  chatMessages.innerHTML = '';
  chatInput.value = '';
  chatInput.style.height = '';
  chatInput.disabled = false;
  chatInput.placeholder = 'Type a message…';
  chatCharCount.textContent = '';
  chatCharCount.className = 'chat-char-count';
  currentChannelName = 'Lobby';
  // Clear channel-view tabs (unsubscribe all)
  for (const cv of channelViewTabs) chatService.unsubscribeChannel(cv.channelId);
  channelViewTabs.length = 0;
  channelViewMessagesCache.clear();
  channelViewMessagesPending.clear();
  channelPinnedMessages.clear();
  unreadChannels.clear();
}

export function saveState() {
  return {
    currentChannelId,
    currentChannelName,
    activeTab: { ...activeTab },
    channelViewTabs: channelViewTabs.map(t => ({ ...t })),
    dmTabs: dmTabs.map(t => ({ ...t })),
  };
}

export function restoreState(state) {
  if (!state) return;
  console.log('[chat] restoreState', { currentChannelId: state.currentChannelId, activeTab: state.activeTab, cvTabs: state.channelViewTabs?.length });

  // Re-init with the saved channel ID - this sets up listeners and loads history
  initChatView(state.currentChannelId);

  // Restore channel-view tabs
  if (state.channelViewTabs?.length) {
    restoreChannelViewTabs(
      state.channelViewTabs.map(t => ({
        channelId: t.channelId,
        channelName: t.channelName,
        ...(t.password != null && { password: t.password }),
      })),
      state.activeTab?.type === 'channel-view' ? state.activeTab.channelId : null
    );
  }
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
  markChannelRead(channelId, serverService.address);

  // If a channel-view tab for this channel already exists (opened before this call),
  // the tab and its history are already being handled - just update currentChannelId and re-render.
  if (channelViewTabs.find(t => t.channelId === channelId)) {
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

function autoResizeInput() {
  chatInput.style.height = 'auto';
  const cs = getComputedStyle(chatInput);
  const maxHeight = parseFloat(cs.lineHeight) * 8 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const capped = chatInput.scrollHeight > maxHeight;
  chatInput.style.height = (capped ? maxHeight : chatInput.scrollHeight) + 'px';
  chatInput.style.overflowY = capped ? 'auto' : 'hidden';
}

function resolveStructuredMentions(text) {
  // Replace @nickname with @u(id) for each autocomplete-selected mention
  let result = text;
  for (const [nickname, { userId, clientId }] of selectedMentions) {
    const id = userId || clientId;
    if (!id) continue;
    const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`@${escaped}(?=\\s|$)`, 'g'), `@u(${id})`);
  }
  selectedMentions.clear();

  // Replace #channelName with #c(channelId) for each autocomplete-selected channel mention
  for (const [channelName, channelId] of selectedChannelMentions) {
    const escaped = channelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`#${escaped}(?=\\s|$)`, 'g'), `#c(${channelId})`);
  }
  selectedChannelMentions.clear();

  return result;
}

function sendMessage() {
  const content = chatInput.value.trim();
  if (!content) return;

  if (content.length > MAX_MESSAGE_LENGTH) {
    const activeChannelId = activeTab.type === 'channel' ? currentChannelId
      : activeTab.type === 'channel-view' ? activeTab.channelId : null;
    offerSendAsFile(content, activeChannelId);
    return;
  }

  const activeChannelId = activeTab.type === 'channel' ? currentChannelId : activeTab.type === 'channel-view' ? activeTab.channelId : null;
  if (activeChannelId && isSlashCommand(content)) {
    const handled = tryHandleCommand(content, { channelId: activeChannelId });
    if (handled) {
      chatInput.value = '';
      selectedMentions.clear();
      selectedChannelMentions.clear();
      autoResizeInput();
      return;
    }
    appendSystemMessage(`Unknown command: ${content.split(/\s+/)[0]}`);
    chatInput.value = '';
    selectedMentions.clear();
    selectedChannelMentions.clear();
    autoResizeInput();
    return;
  }

  const resolved = resolveStructuredMentions(content);

  const replyTo = replyToMessage?.id || null;

  if (activeTab.type === 'dm') {
    chatService.sendDm(activeTab.userId, resolved);
  } else if (activeTab.type === 'channel-view') {
    chatService.sendMessage(activeTab.channelId, resolved, replyTo);
  } else {
    if (!currentChannelId) return;
    chatService.sendMessage(currentChannelId, resolved, replyTo);
  }
  chatInput.value = '';
  cancelReply();
  autoResizeInput();
  // Reset typing send throttle so next keystroke sends immediately
  if (typingSendTimer) { clearTimeout(typingSendTimer); typingSendTimer = null; }
  typingSendAllowed = true;
}

async function offerSendAsFile(content, channelId) {
  if (!channelId) return;
  const confirmed = await customConfirm(
    `Your message is too long (${content.length} of ${MAX_MESSAGE_LENGTH} characters maximum).\n\nSend it as a text file instead?`
  );
  if (!confirmed) return;
  const blob = new Blob([content], { type: 'text/plain' });
  const file = new File([blob], 'message.txt', { type: 'text/plain' });
  chatInput.value = '';
  autoResizeInput();
  updateCharCount();
  uploadFile(file, channelId);
}

function onChatInputForCharCount() {
  updateCharCount();
  autoResizeInput();
}

function updateCharCount() {
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

function updateInputForTab() {
  const isAttachSupported = activeTab.type === 'channel';

  // Check read/write restriction for channel-view tabs and joined channel tab
  const cvChannelId = activeTab.type === 'channel-view' ? activeTab.channelId
    : activeTab.type === 'channel' ? currentChannelId : null;
  const cvTab = cvChannelId
    ? channelViewTabs.find(t => t.channelId === cvChannelId)
    : null;

  // Reset state first
  chatInput.disabled = false;
  chatInput.readOnly = false;
  chatInput.classList.remove('input-write-restricted');

  if (cvTab?.readRestricted) {
    chatInput.disabled = true;
    chatInput.placeholder = 'You do not have permission to read this channel';
    btnAttach.style.display = 'none';
    btnSend.disabled = true;
    return;
  }

  if (cvTab?.writeRestricted) {
    console.log('Write restricted for channel-view tab:', cvTab);
    console.log('Channel:', cvTab.channelId);
    console.log('chatInput.classList', chatInput.classList);
    chatInput.readOnly = true;
    chatInput.classList.add('input-write-restricted');
    chatInput.placeholder = 'You do not have permission to write in this channel';
    btnAttach.style.display = 'none';
    btnSend.disabled = true;
    return;
  }

  btnSend.disabled = false;
  chatInput.disabled = false;
  chatInput.placeholder = 'Type a message…';
  btnAttach.style.display = isAttachSupported ? '' : 'none';
}

async function loadHistory(channelId) {
  try {
    resetChannelPagination();
    const result = await chatService.fetchHistory(channelId, undefined, HISTORY_PAGE_SIZE);
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
      const userIds = sorted.map(m => m.userId).filter(Boolean);
      if (userIds.length > 0) await resolveNicknames(userIds);
      chatMessages.innerHTML = '';
      for (const msg of sorted) {
        appendMessage(msg);
      }
      scrollToBottom();
      renderPinnedMessages();
    }
  } catch {
    // History may not be available
  }
}

async function loadDmHistory(tabUserId, targetUserId) {
  try {
    const pg = { oldestTs: null, allLoaded: false, loading: false };
    paginationState.dm.set(tabUserId, pg);

    const result = await chatService.fetchDmHistory(targetUserId, undefined, HISTORY_PAGE_SIZE);
    if (!result || !result.messages) return;
    // Only render if this tab is still active
    if (activeTab.type !== 'dm' || activeTab.userId !== tabUserId) return;

    updatePaginationFromMessages(pg, result.messages);

    chatMessages.innerHTML = '';
    showDmEncryptionNotice(true);
    const sorted = [...result.messages].reverse();
    // Pre-resolve nicknames for DM senders
    const userIds = sorted.map(m => m.fromUserId).filter(Boolean);
    if (userIds.length > 0) await resolveNicknames(userIds);
    for (const msg of sorted) {
      const decrypted = await tryDecryptDmMessage(msg);
      appendDmMessage(decrypted, false);
    }

    // Append only in-session messages that arrived after the last history message
    const lastHistoryTs = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : 0;
    const sessionMsgs = dmMessages.get(tabUserId) || [];
    const pendingMsgs = sessionMsgs.filter(m => m.timestamp > lastHistoryTs);
    for (const msg of pendingMsgs) {
      appendDmMessage(msg, false);
    }
    dmMessages.set(tabUserId, pendingMsgs);

    scrollToBottom();
  } catch {
    // History unavailable
  }
}

async function loadChannelViewHistory(channelId) {
  try {
    const tab = channelViewTabs.find(t => t.channelId === channelId);

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
      result = await chatService.fetchHistory(channelId, undefined, HISTORY_PAGE_SIZE, tab?.password);
    } catch (err) {
      if (err?.message?.includes('READ_RESTRICTED') || err?.code === 'READ_RESTRICTED') {
        if (tab) tab.readRestricted = true;
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
    if (!result || !result.messages) return;
    if (activeTab.type !== 'channel-view' || activeTab.channelId !== channelId) return;

    updatePaginationFromMessages(pg, result.messages);

    // Store pinned message IDs
    if (result.pinnedMessageIds && result.pinnedMessageIds.length > 0) {
      channelPinnedMessages.set(channelId, new Set(result.pinnedMessageIds));
    } else {
      channelPinnedMessages.set(channelId, new Set());
    }

    const sorted = [...result.messages].reverse();
    const userIds = sorted.map(m => m.userId).filter(Boolean);
    if (userIds.length > 0) await resolveNicknames(userIds);
    chatMessages.innerHTML = '';
    const historyIds = new Set(sorted.map(m => m.id));
    for (const msg of sorted) appendMessage(msg);
    // Append any live messages that arrived while history was loading
    const pending = channelViewMessagesPending.get(channelId) || [];
    for (const msg of pending) {
      if (!historyIds.has(msg.id)) appendMessage(msg);
    }
    channelViewMessagesPending.delete(channelId);
    scrollToBottom();
    renderPinnedMessages();
  } catch {
    // History unavailable
  }
}

export function switchToChannelTab() {
  const cvTab = channelViewTabs.find(t => t.channelId === currentChannelId);
  if (cvTab) {
    switchToTab({ type: 'channel-view', channelId: currentChannelId, channelName: cvTab.channelName });
  } else if (activeTab.type !== 'channel') {
    switchToTab({ type: 'channel' });
  }
}

export function openChannelViewTab(channelId, channelName, password, readRestricted = false, writeRestricted = false) {
  console.log('[chat] openChannelViewTab', channelId, channelName, 'existing:', !!channelViewTabs.find(t => t.channelId === channelId), 'activeTab:', activeTab.type, activeTab.channelId);
  let tab = channelViewTabs.find(t => t.channelId === channelId);
  if (!tab) {
    tab = { channelId, channelName, readRestricted, writeRestricted, ...(password != null && { password }) };
    channelViewTabs.push(tab);
    chatService.subscribeChannel(channelId, password);
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
  const idx = channelViewTabs.findIndex(t => t.channelId === channelId);
  if (idx === -1) return;
  channelViewTabs.splice(idx, 1);
  channelViewMessagesCache.delete(channelId);
  channelViewMessagesPending.delete(channelId);
  if (channelId !== currentChannelId) channelPinnedMessages.delete(channelId);
  chatService.unsubscribeChannel(channelId);
  // If closing the current channel's view tab, clear stale cache so channel tab reloads fresh
  if (channelId === currentChannelId) channelMessagesCache.length = 0;
  window.dispatchEvent(new CustomEvent('gimodi:channel-tabs-changed'));
  if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
    switchToTab({ type: 'channel' });
  } else {
    renderTabs();
  }
}

export function getChannelViewTabsState() {
  const activeChannelId = activeTab.type === 'channel-view' ? activeTab.channelId : null;
  return {
    tabs: channelViewTabs.map(t => ({ channelId: t.channelId, channelName: t.channelName, ...(t.password != null && { password: t.password }) })),
    activeChannelId,
  };
}

export function restoreChannelViewTabs(tabs, activeChannelId) {
  for (const { channelId, channelName, password } of tabs) {
    if (!channelViewTabs.find(t => t.channelId === channelId)) {
      channelViewTabs.push({ channelId, channelName, ...(password != null && { password }) });
      chatService.subscribeChannel(channelId, password);
    }
  }
  // Switch to the previously active tab if it exists and isn't already active
  if (activeChannelId) {
    const cvTab = channelViewTabs.find(t => t.channelId === activeChannelId);
    if (cvTab && (activeTab.type !== 'channel-view' || activeTab.channelId !== activeChannelId)) {
      switchToTab({ type: 'channel-view', channelId: activeChannelId, channelName: cvTab.channelName });
      return;
    }
  }
  renderTabs();
}

async function tryDecryptDmMessage(msg) {
  if (!msg.content || !msg.content.startsWith('-----BEGIN PGP MESSAGE-----')) return msg;
  try {
    const plaintext = await window.gimodi.identity.decrypt(msg.content);
    return { ...msg, content: plaintext };
  } catch {
    return { ...msg, content: '[Encrypted message - unable to decrypt]' };
  }
}


function onClientJoinedForCache(e) {
  const { userId, nickname, clientId } = e.detail;
  if (clientId) clientNicknameMap.set(clientId, nickname);
  if (userId && nickname) {
    // User (re)connected - update cache with potentially new nickname
    invalidateNickname(userId);
    setNickname(userId, nickname);
    // Update any visible message headers for this user
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
    if (nickEl) nickEl.textContent = nickname;
  }
}

export function updateChatBadges(userId, badge) {
  if (!userId) return;

  const applyBadge = (msgEl) => {
    if (!msgEl.classList?.contains('chat-msg') || msgEl.dataset.userId !== userId) return;
    msgEl.dataset.badge = badge || '';
    const nickGroup = msgEl.querySelector('.chat-msg-nick-group');
    if (!nickGroup) return;
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
  for (const node of channelMessagesCache) applyBadge(node);
  for (const nodes of channelViewMessagesCache.values()) {
    for (const node of nodes) applyBadge(node);
  }
}

/**
 * Updates nickname colors for all messages from a given user across all tabs.
 * @param {string} userId
 * @param {string|null} roleColor
 */
export function updateChatNickColors(userId, roleColor) {
  if (!userId) return;
  const color = roleColor || nicknameColor();

  const applyColor = (msgEl) => {
    if (!msgEl.classList?.contains('chat-msg') || msgEl.dataset.userId !== userId) return;
    msgEl.dataset.roleColor = roleColor || '';
    for (const nick of msgEl.querySelectorAll('.chat-msg-nick, .compact-nick')) {
      nick.style.color = color;
    }
  };

  for (const msgEl of chatMessages.querySelectorAll(`.chat-msg[data-user-id="${CSS.escape(userId)}"]`)) {
    applyColor(msgEl);
  }
  for (const node of channelMessagesCache) applyColor(node);
  for (const nodes of channelViewMessagesCache.values()) {
    for (const node of nodes) applyColor(node);
  }

  for (const msg of channelMessagesPending) {
    if (msg.userId === userId) msg.roleColor = roleColor;
  }
  for (const msgs of channelViewMessagesPending.values()) {
    for (const msg of msgs) {
      if (msg.userId === userId) msg.roleColor = roleColor;
    }
  }
}

// --- Desktop Notifications ---

function resolveMentionsText(text) {
  return text.replace(/#c\(([^)]+)\)/g, (full, channelId) => {
    const channels = window.gimodiChannels || [];
    const ch = channels.find(c => c.id === channelId);
    return '#' + (ch ? ch.name : 'channel');
  }).replace(/@u\(([^)]+)\)/g, (full, id) => {
    let nick = null;
    if (window.gimodiClients) {
      const c = window.gimodiClients.find(cl => cl.userId === id || cl.id === id);
      nick = c?.nickname ?? null;
    }
    if (!nick) nick = getCachedNickname(id);
    if (!nick) nick = id.slice(0, 8);
    return `@${nick}`;
  });
}

function checkMentionInMessage(content) {
  const myUserId = serverService.userId;
  const myClientId = serverService.clientId;
  if (myUserId && content.includes(`@u(${myUserId})`)) return true;
  if (myClientId && content.includes(`@u(${myClientId})`)) return true;
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
    cvTabChannelIds: channelViewTabs.map(t => t.channelId),
    nickname: msg.nickname,
    contentSnippet: (msg.content || '').substring(0, 30),
  });
  // Cache the nickname from live messages
  if (msg.userId && msg.nickname) setNickname(msg.userId, msg.nickname);

  // Check for mention and show notification
  const isMention = checkMentionInMessage(msg.content);
  const isSelf = msg.clientId === serverService.clientId;

  if (!isSelf) {
    const channelName = msg.channelName || '#Channel';
    // Suppress mention notification if user has this channel open (regardless of focus)
    const viewingThisChannel = getViewingChannelId() === msg.channelId;
    if (!(isMention && viewingThisChannel)) {
      const resolvedContent = resolveMentionsText(msg.content).substring(0, 100);
      const notifBody = isMention
        ? `${msg.nickname} mentioned you: ${resolvedContent}`
        : `${msg.nickname}: ${resolvedContent}`;
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
  const cvTab = channelViewTabs.find(t => t.channelId === msg.channelId);
  if (cvTab) {
    if (activeTab.type === 'channel-view' && activeTab.channelId === msg.channelId) {
      console.log('[chat:onMessage] → appendMessage via channel-view tab');
      appendMessage(msg);
      scrollToBottom();
    } else {
      console.log('[chat:onMessage] → BUFFERED in channel-view pending (activeTab:', activeTab.type, activeTab.channelId, ')');
      let pending = channelViewMessagesPending.get(msg.channelId);
      if (!pending) { pending = []; channelViewMessagesPending.set(msg.channelId, pending); }
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
  if (channelId !== currentChannelId) return;
  // Clear both the DOM cache and any buffered pending messages
  channelMessagesCache.length = 0;
  channelMessagesPending.length = 0;
  channelTabUnread = false;
  if (activeTab.type !== 'channel') return;
  chatMessages.innerHTML = '';
}

function onMessageDeleted(e) {
  const { messageId } = e.detail;
  const el = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!el) return;

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
        const liveClient = (nextClientId && window.gimodiClients.find(c => c.id === nextClientId))
          || (nextUserId && window.gimodiClients.find(c => c.userId === nextUserId));
        if (liveClient) {
          badge = liveClient.badge || null;
          promoteRoleColor = liveClient.roleColor || null;
        }
      }
      const badgeHtml = badge ? `<span class="admin-badge">${escapeHtml(badge)}</span>` : '';
      const promoteNickColor = promoteRoleColor || nicknameColor();

      const header = document.createElement('div');
      header.className = 'chat-msg-header';
      header.innerHTML = `
        <span class="chat-msg-nick-group"><span class="chat-msg-nick" style="color:${promoteNickColor}">${escapeHtml(nickname)}</span>${badgeHtml}</span>
        <span class="chat-msg-time">${headerTime}</span>
      `;
      next.insertBefore(header, next.firstChild);
    }
  }

  el.remove();
}

function onPreviewRemoved(e) {
  const { messageId } = e.detail;
  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;
  msgEl.querySelector('.link-previews')?.remove();
}

function onLinkPreview(e) {
  const { messageId, channelId, previews } = e.detail;
  if (channelId !== currentChannelId || !previews?.length) return;

  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;

  const body = msgEl.querySelector('.chat-msg-body');
  if (!body) return;

  const embeddedUrls = new Set([...msgEl.querySelectorAll('.media-embed-link')].map(a => a.href));
  const remaining = previews.filter(p => !embeddedUrls.has(p.url));
  if (!remaining.length) return;

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
  const imageHtml = preview.image
    ? `<img class="link-preview-image" src="${escapeHtml(preview.image)}" alt="" loading="lazy">`
    : '';
  const titleHtml = preview.title
    ? `<div class="link-preview-title">${escapeHtml(preview.title)}</div>`
    : '';
  const descHtml = preview.description
    ? `<div class="link-preview-desc">${escapeHtml(preview.description)}</div>`
    : '';

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
  const isOwner = msgEl?.dataset.userId === serverService.userId;

  const container = document.createElement('div');
  container.className = 'link-previews';
  container.innerHTML = previews.map(renderPreviewCard).join('');

  // Open links in system browser
  for (const a of container.querySelectorAll('.link-preview-card, .media-embed-link')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) window.gimodi.openExternal(href);
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href');
      if (href) showLinkContextMenu(e.clientX, e.clientY, href);
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
        await chatService.removePreview(messageId);
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
  if (!body) return;

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
      if (!embed) return;
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
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
  const addr = serverService.address;
  if (!addr) return '';
  if (addr.startsWith('ws://')) return addr.replace(/^ws:\/\//, 'http://').replace(/\/+$/, '');
  if (addr.startsWith('wss://')) return addr.replace(/^wss:\/\//, 'https://').replace(/\/+$/, '');
  return `https://${addr}`.replace(/\/+$/, '');
}

function uploadFile(file, channelId) {
  const uploadChannelId = channelId || currentChannelId;
  if (!uploadChannelId || !serverService.clientId) return;

  if (serverService.maxFileSize && file.size > serverService.maxFileSize) {
    appendSystemMessage(`Upload failed: File is too large (${formatFileSize(file.size)}). Maximum allowed size is ${formatFileSize(serverService.maxFileSize)}.`);
    return;
  }

  const baseUrl = getHttpBaseUrl();
  if (!baseUrl) return;

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
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    card.querySelector('.upload-progress-bar').style.width = `${pct}%`;
    card.querySelector('.upload-progress-pct').textContent = `${pct}%`;
    card.querySelector('.upload-progress-size').textContent =
      `${formatFileSize(e.loaded)} / ${formatFileSize(e.total)}`;
  });

  xhr.addEventListener('load', () => {
    card.remove();
    if (xhr.status < 200 || xhr.status >= 300) {
      let errMsg = 'Upload failed';
      try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch { }
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
  xhr.setRequestHeader('X-Client-Id', serverService.clientId);
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
  if (getDayKey(timestamp) === getDayKey(Date.now())) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (getDayKey(timestamp) === getDayKey(yesterday.getTime())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function maybeInsertDaySeparator(timestamp) {
  const dayKey = getDayKey(timestamp);
  const seps = chatMessages.querySelectorAll('.chat-day-separator');
  const lastKey = seps.length ? seps[seps.length - 1].dataset.dayKey : null;
  if (dayKey === lastKey) return;
  const sep = document.createElement('div');
  sep.className = 'chat-day-separator';
  sep.dataset.dayKey = dayKey;
  const label = document.createElement('span');
  label.textContent = formatDayLabel(timestamp);
  sep.appendChild(label);
  chatMessages.appendChild(sep);
}

function nicknameColor() {
  return '#FFD700';
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
  const displayNickname = (msg.userId && getCachedNickname(msg.userId))
    || msg.nickname
    || '[Anonymous]';
  el.dataset.nickname = displayNickname;

  const time = formatTime(msg.timestamp);
  const compactTime = formatTimeShort(msg.timestamp);
  const headerTime = formatRelativeTime(msg.timestamp);
  const fullTime = formatDateTime(msg.timestamp);

  // Check if this message can be grouped with the previous one
  const prev = prevEl || null;
  const sameAuthor = prev && (
    (msg.userId && prev.dataset.userId === msg.userId) ||
    (msg.clientId && prev.dataset.clientId === msg.clientId) ||
    (!msg.clientId && !msg.userId && prev.dataset.nickname === displayNickname)
  );
  const prevTs = Number(prev?.dataset.timestamp);
  const isGrouped = sameAuthor
    && (msg.timestamp - prevTs) < GROUP_TIMEOUT
    && getDayKey(msg.timestamp) === getDayKey(prevTs);

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
    const liveClient = (msg.clientId && window.gimodiClients.find(c => c.id === msg.clientId))
      || (msg.userId && window.gimodiClients.find(c => c.userId === msg.userId));
    if (liveClient) {
      badge = liveClient.badge || null;
      roleColor = liveClient.roleColor || null;
    }
  }
  const nickColor = roleColor || nicknameColor();

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

  if (isGrouped) {
    el.classList.add('chat-msg-grouped');
    el.innerHTML = `
      ${compactHtml}
      <span class="chat-msg-hover-time">${time}</span>
      ${replyRefHtml}
      <div class="chat-msg-body${emojiOnly ? ' emoji-only' : ''}">${bodyHtml}</div>
      ${editedLabel}
    `;
  } else {
    el.innerHTML = `
      ${compactHtml}
      <span class="chat-msg-hover-time">${time}</span>
      <div class="chat-msg-header">
        <span class="chat-msg-nick-group"><span class="chat-msg-nick" style="color:${nickColor}">${escapeHtml(displayNickname)}</span>${badgeHtml}</span>
        <span class="chat-msg-time">${headerTime}</span>${editedLabel}
      </div>
      ${replyRefHtml}
      <div class="chat-msg-body${emojiOnly ? ' emoji-only' : ''}">${bodyHtml}</div>
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

  // Click on nickname → open DM tab (only for identified users, not self)
  if (msg.userId && msg.userId !== serverService.userId) {
    for (const nEl of el.querySelectorAll('.chat-msg-nick, .compact-nick')) {
      nEl.addEventListener('click', () => {
        const onlineClient = window.gimodiClients?.find(c => c.userId === msg.userId);
        if (onlineClient) {
          openDmTab(onlineClient.id, displayNickname, msg.userId);
        } else {
          openDmTab(msg.userId, displayNickname, msg.userId);
        }
      });
    }
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
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
    pre.appendChild(btn);
  }

  // Open links in system browser
  for (const a of el.querySelectorAll('.chat-msg-body a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) window.gimodi.openExternal(href);
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href');
      if (href) showLinkContextMenu(e.clientX, e.clientY, href);
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
    if (!video || !playBtn) continue;

    playBtn.addEventListener('click', () => {
      // Stop all other videos and reset them to default state
      for (const otherWrapper of document.querySelectorAll('.chat-video-wrapper.playing')) {
        if (otherWrapper === wrapper) continue;
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
      if (url) window.gimodi.downloadFile(url, filename);
    });
  }

  // Render inline media embeds (YouTube etc.) from message links
  appendMediaEmbeds(el);

  // Render link previews from history (skip URLs already embedded)
  if (msg.linkPreviews?.length) {
    const body = el.querySelector('.chat-msg-body');
    const embeddedUrls = new Set([...el.querySelectorAll('.media-embed-link')].map(a => a.getAttribute('href')));
    const remaining = msg.linkPreviews.filter(p => !embeddedUrls.has(p.url));
    if (remaining.length) appendPreviewCards(body, remaining);
  }

  // Render reactions
  if (msg.reactions?.length) {
    renderReactions(el, msg.id, msg.reactions);
  }

  // Hover action toolbar (Discord-style) - reaction + delete in one bar
  const canDelete = (msg.userId && msg.userId === serverService.userId) || serverService.hasPermission('chat.delete_any');
  if (serverService.userId || canDelete) {
    const hoverActions = document.createElement('div');
    hoverActions.className = 'chat-msg-actions';

    // Add Reaction button
    if (serverService.userId) {
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

      // Reply button
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
    const canEdit = msg.userId && msg.userId === serverService.userId && !isFileMessage(msg.content);
    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.className = 'chat-msg-action-btn';
      editBtn.title = 'Edit message';
      editBtn.innerHTML = '<i class="bi bi-pencil"></i>';
      editBtn.addEventListener('click', () => {
        const msgEl = document.querySelector(`.chat-msg[data-msg-id="${msg.id}"]`);
        if (msgEl) enterEditMode(msgEl, msg.id);
      });
      hoverActions.appendChild(editBtn);
    }

    // Pin/Unpin button (requires chat.pin permission)
    if (serverService.hasPermission('chat.pin')) {
      const viewingChannelId = getViewingChannelId();
      const pinnedSet = (viewingChannelId ? channelPinnedMessages.get(viewingChannelId) : null) || new Set();
      const isPinned = pinnedSet.has(msg.id);

      const pinBtn = document.createElement('button');
      pinBtn.className = 'chat-msg-action-btn';
      pinBtn.title = isPinned ? 'Unpin message' : 'Pin message';
      pinBtn.innerHTML = isPinned
        ? '<i class="bi bi-pin-angle-fill"></i>'
        : '<i class="bi bi-pin-angle"></i>';
      pinBtn.addEventListener('click', () => {
        if (isPinned) {
          chatService.unpinMessage(msg.id);
        } else {
          chatService.pinMessage(msg.id);
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
        chatService.deleteMessage(msg.id).catch(err => {
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
  const prevEl = chatMessages.querySelector('.chat-msg:last-child');
  const el = buildMessageEl(msg, prevEl);
  maybeInsertDaySeparator(msg.timestamp);
  chatMessages.appendChild(el);
}

function refreshNodeTimestamps(el) {
  if (el.classList.contains('chat-msg')) {
    const ts = Number(el.dataset.timestamp);
    if (!ts) return;
    const compactTimeEl = el.querySelector('.compact-time');
    if (compactTimeEl) {
      compactTimeEl.textContent = formatTimeShort(ts);
      compactTimeEl.title = formatDateTime(ts);
    }
    const timeEl = el.querySelector('.chat-msg-time');
    const hoverEl = el.querySelector('.chat-msg-hover-time');
    if (timeEl) timeEl.textContent = formatRelativeTime(ts);
    if (hoverEl) hoverEl.textContent = formatTime(ts);
    el.title = formatDateTime(ts);
  }
}

export function setChatDisplayMode(mode) {
  compactMode = mode === 'compact';
  chatMessages.classList.toggle('compact-mode', compactMode);
}

/**
 * Sets whether media embeds require user confirmation before loading external content.
 * @param {boolean} enabled
 */
export function setMediaEmbedPrivacy(enabled) {
  mediaEmbedPrivacy = enabled;
}

export function refreshTimestamps() {
  // Live DOM children
  for (const el of chatMessages.children) refreshNodeTimestamps(el);
  // Cached DOM nodes (individual elements, not containers)
  for (const el of channelMessagesCache) refreshNodeTimestamps(el);
}

function showDmEncryptionNotice(show = true) {
  const el = document.getElementById('dm-encryption-notice');
  if (el) el.classList.toggle('hidden', !show);
}

function onChatSubscribed(e) {
  const { channelId, readRestricted, writeRestricted } = e.detail;
  const tab = channelViewTabs.find(t => t.channelId === channelId);
  if (!tab) return;
  tab.readRestricted = !!readRestricted;
  tab.writeRestricted = !!writeRestricted;
  if (activeTab.type === 'channel-view' && activeTab.channelId === channelId) {
    updateInputForTab();
  }
}

function onChannelUpdatedForReadRoles(e) {
  const { channel } = e.detail;
  const tab = channelViewTabs.find(t => t.channelId === channel.id);
  if (!tab) return;

  const prevReadRoles = JSON.stringify((tab.readRoles || []).slice().sort());
  const newReadRoles = JSON.stringify((channel.readRoles || []).slice().sort());
  const prevWriteRoles = JSON.stringify((tab.writeRoles || []).slice().sort());
  const newWriteRoles = JSON.stringify((channel.writeRoles || []).slice().sort());

  if (prevReadRoles === newReadRoles && prevWriteRoles === newWriteRoles) return;

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
  const el = document.createElement('div');
  el.className = 'chat-system';
  el.textContent = text;
  chatMessages.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * @param {WheelEvent} e
 */
function onTabBarWheel(e) {
  if (e.deltaY !== 0) {
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
  }
}

function onChatScroll() {
  if (chatMessages.scrollTop > 150) return;
  const pg = getPaginationForTab();
  if (!pg || pg.allLoaded || pg.loading) return;
  loadOlderMessages();
}

function updatePaginationFromMessages(pg, messages) {
  if (!messages || messages.length === 0) {
    pg.allLoaded = true;
    return;
  }
  if (messages.length < HISTORY_PAGE_SIZE) pg.allLoaded = true;
  const oldest = messages.reduce((min, m) => m.timestamp < min ? m.timestamp : min, messages[0].timestamp);
  if (pg.oldestTs === null || oldest < pg.oldestTs) pg.oldestTs = oldest;
}

async function loadOlderMessages() {
  const pg = getPaginationForTab();
  if (!pg || pg.allLoaded || pg.loading || pg.oldestTs === null) return;
  pg.loading = true;

  const prevHeight = chatMessages.scrollHeight;
  const prevTop = chatMessages.scrollTop;

  try {
    if (activeTab.type === 'channel') {
      await loadOlderChannelMessages(pg);
    } else if (activeTab.type === 'dm') {
      await loadOlderDmMessages(pg);
    } else if (activeTab.type === 'channel-view') {
      await loadOlderChannelViewMessages(pg);
    }
    // Restore scroll position so new messages appear above without jumping
    chatMessages.scrollTop = prevTop + (chatMessages.scrollHeight - prevHeight);
  } finally {
    pg.loading = false;
  }
}

async function loadOlderChannelMessages(pg) {
  const result = await chatService.fetchHistory(currentChannelId, pg.oldestTs, HISTORY_PAGE_SIZE);
  if (!result?.messages || activeTab.type !== 'channel') return;
  const sorted = [...result.messages].reverse();
  updatePaginationFromMessages(pg, result.messages);
  const userIds = sorted.map(m => m.userId).filter(Boolean);
  if (userIds.length > 0) await resolveNicknames(userIds);
  const frag = document.createDocumentFragment();
  for (const msg of sorted) {
    const el = buildMessageEl(msg);
    if (el) frag.appendChild(el);
  }
  chatMessages.prepend(frag);
}

async function loadOlderDmMessages(pg) {
  const { userId: tabUserId } = activeTab;
  const targetUserId = activeTab.persistentUserId;
  const result = await chatService.fetchDmHistory(targetUserId, pg.oldestTs, HISTORY_PAGE_SIZE);
  if (!result?.messages || activeTab.type !== 'dm' || activeTab.userId !== tabUserId) return;
  const sorted = [...result.messages].reverse();
  updatePaginationFromMessages(pg, result.messages);
  const userIds = sorted.map(m => m.fromUserId).filter(Boolean);
  if (userIds.length > 0) await resolveNicknames(userIds);
  const frag = document.createDocumentFragment();
  for (const msg of sorted) {
    const decrypted = await tryDecryptDmMessage(msg);
    const el = buildDmMessageEl(decrypted);
    if (el) frag.appendChild(el);
  }
  // Prepend after the encryption notice if present
  const notice = chatMessages.querySelector('.dm-encryption-notice');
  if (notice && notice.nextSibling) {
    chatMessages.insertBefore(frag, notice.nextSibling);
  } else {
    chatMessages.prepend(frag);
  }
}

async function loadOlderChannelViewMessages(pg) {
  const { channelId } = activeTab;
  const tab = channelViewTabs.find(t => t.channelId === channelId);
  const result = await chatService.fetchHistory(channelId, pg.oldestTs, HISTORY_PAGE_SIZE, tab?.password);
  if (!result?.messages || activeTab.type !== 'channel-view' || activeTab.channelId !== channelId) return;
  const sorted = [...result.messages].reverse();
  updatePaginationFromMessages(pg, result.messages);
  const userIds = sorted.map(m => m.userId).filter(Boolean);
  if (userIds.length > 0) await resolveNicknames(userIds);
  const frag = document.createDocumentFragment();
  for (const msg of sorted) {
    const el = buildMessageEl(msg);
    if (el) frag.appendChild(el);
  }
  chatMessages.prepend(frag);
}

function openLightbox(src, alt, meta) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img class="lightbox-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}">`;
  const lbImg = overlay.querySelector('.lightbox-img');
  lbImg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showImageContextMenu(e.clientX, e.clientY, src, meta?.filename, meta?.size, meta?.url);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });
  document.body.appendChild(overlay);
}

// --- Tab management ---

function onOpenDm(e) {
  const { userId, persistentUserId, nickname } = e.detail;
  openDmTab(userId, nickname, persistentUserId || null);
}

function onNavigateChannel(e) {
  const { channelId } = e.detail;
  if (channelId) serverService.send('channel:join', { channelId });
}

function openDmTab(userId, nickname, persistentUserId = null) {
  // If tab already exists, just switch to it
  let tab = dmTabs.find(t => t.userId === userId);
  if (!tab) {
    tab = { userId, persistentUserId, nickname };
    dmTabs.push(tab);
    if (!dmMessages.has(userId)) {
      dmMessages.set(userId, []);
    }
  }
  switchToTab({ type: 'dm', userId, persistentUserId: tab.persistentUserId, nickname });
}

function closeDmTab(userId) {
  const idx = dmTabs.findIndex(t => t.userId === userId);
  if (idx === -1) return;
  dmTabs.splice(idx, 1);
  dmMessages.delete(userId);

  // If we're closing the active tab, switch to channel
  if (activeTab.type === 'dm' && activeTab.userId === userId) {
    switchToTab({ type: 'channel' });
  } else {
    renderTabs();
  }
}

function switchToTab(tab) {
  console.log('[chat] switchToTab', tab.type, tab.channelId || tab.userId || '', 'from', activeTab.type, activeTab.channelId || activeTab.userId || '');
  const isSameTab = activeTab.type === tab.type && (
    tab.type === 'channel' ||
    (tab.type === 'dm' && activeTab.userId === tab.userId) ||
    (tab.type === 'channel-view' && activeTab.channelId === tab.channelId)
  );
  if (isSameTab) {
    renderTabs();
    return;
  }

  // Save current chat DOM when switching away
  if (activeTab.type === 'channel') {
    channelMessagesCache.length = 0;
    for (const child of chatMessages.children) channelMessagesCache.push(child);
  } else if (activeTab.type === 'channel-view') {
    let cached = channelViewMessagesCache.get(activeTab.channelId);
    if (!cached) { cached = []; channelViewMessagesCache.set(activeTab.channelId, cached); }
    cached.length = 0;
    for (const child of chatMessages.children) cached.push(child);
  }

  activeTab = tab;
  chatMessages.innerHTML = '';
  showDmEncryptionNotice(tab.type === 'dm');
  updateInputForTab();
  cancelReply();
  renderTypingIndicator();

  // Clear in-app notification entries for the destination tab
  if (tab.type === 'channel') {
    notificationService.clearByAction({ type: 'channel', channelId: currentChannelId });
  } else if (tab.type === 'dm') {
    notificationService.clearByAction({ type: 'dm', userId: tab.userId });
  }

  if (tab.type === 'channel') {
    channelTabUnread = false;
    if (currentChannelId && unreadChannels.delete(currentChannelId)) {
      window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
    }
    if (currentChannelId) markChannelRead(currentChannelId, serverService.address);
    // Restore channel messages from cache if available, otherwise reload history
    if (channelMessagesCache.length > 0) {
      for (const node of channelMessagesCache) {
        chatMessages.appendChild(node);
      }
      channelMessagesCache.length = 0;
      // Render any messages that arrived while we were on another tab
      for (const msg of channelMessagesPending) appendMessage(msg);
      channelMessagesPending.length = 0;
      scrollToBottom();
      renderPinnedMessages();
    } else {
      channelMessagesPending.length = 0;
      loadHistory(currentChannelId);
    }
  } else if (tab.type === 'channel-view') {
    const cvTab = channelViewTabs.find(t => t.channelId === tab.channelId);
    if (cvTab) cvTab.unread = false;
    if (unreadChannels.delete(tab.channelId)) {
      window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
    }
    markChannelRead(tab.channelId, serverService.address);
    const cached = channelViewMessagesCache.get(tab.channelId);
    if (cached && cached.length > 0) {
      for (const node of cached) chatMessages.appendChild(node);
      cached.length = 0;
      const pending = channelViewMessagesPending.get(tab.channelId) || [];
      for (const msg of pending) appendMessage(msg);
      channelViewMessagesPending.delete(tab.channelId);
      scrollToBottom();
      renderPinnedMessages();
    } else {
      loadChannelViewHistory(tab.channelId);
    }
  } else {
    // Load DM history first if we have a persistentUserId, then render in-session messages on top
    const dmTab = dmTabs.find(t => t.userId === tab.userId);
    if (dmTab) dmTab.unread = false;
    renderPinnedMessages();

    if (tab.persistentUserId) {
      loadDmHistory(tab.userId, tab.persistentUserId);
    } else {
      // No persistent history available, just show in-session messages
      showDmEncryptionNotice(true);
      const msgs = dmMessages.get(tab.userId) || [];
      for (const msg of msgs) {
        appendDmMessage(msg, false);
      }
      scrollToBottom();
    }
  }

  renderTabs();
}

async function onDmMessage(e) {
  const msg = e.detail;
  // Cache the sender's nickname
  if (msg.fromUserId && msg.fromNickname) setNickname(msg.fromUserId, msg.fromNickname);
  // Determine the "other" user in this DM
  const isSelf = msg.fromId === serverService.clientId;
  const otherUserId = isSelf ? msg.targetId : msg.fromId;
  const otherNickname = isSelf ? null : msg.fromNickname;
  const otherPersistentUserId = isSelf ? null : (msg.fromUserId || null);

  // Decrypt content
  const decrypted = await tryDecryptDmMessage(msg);

  // Auto-open tab if it doesn't exist
  let tab = dmTabs.find(t => t.userId === otherUserId);
  if (!tab) {
    const nickname = otherNickname || otherUserId;
    tab = { userId: otherUserId, persistentUserId: otherPersistentUserId, nickname };
    dmTabs.push(tab);
    if (!dmMessages.has(otherUserId)) {
      dmMessages.set(otherUserId, []);
    }
  }

  // Store the decrypted message
  const msgs = dmMessages.get(otherUserId) || [];
  msgs.push(decrypted);
  dmMessages.set(otherUserId, msgs);

  // If this DM tab is active, append to DOM
  if (activeTab.type === 'dm' && activeTab.userId === otherUserId) {
    appendDmMessage(decrypted, true);
  } else {
    // Mark tab as unread
    tab.unread = true;

    // Show desktop notification for incoming DMs
    if (!isSelf) {
      const nickname = otherNickname || 'Someone';
      const preview = decrypted.content.length > 100
        ? decrypted.content.substring(0, 100) + '...'
        : decrypted.content;
      notificationService.show({
        type: 'dm',
        title: `DM from ${nickname}`,
        body: preview,
        action: { type: 'dm', userId: otherUserId, persistentUserId: otherPersistentUserId, nickname: tab.nickname },
      });
    }
  }

  renderTabs();
}

function buildDmMessageEl(msg) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.dataset.userId = msg.fromUserId || '';
  const headerTime = formatRelativeTime(msg.timestamp);
  const nickname = (msg.fromUserId && getCachedNickname(msg.fromUserId))
    || msg.fromNickname
    || '[Anonymous]';

  let badge = msg.badge || null;
  let dmRoleColor = null;
  if (window.gimodiClients) {
    const liveClient = (msg.fromUserId && window.gimodiClients.find(c => c.userId === msg.fromUserId))
      || (msg.fromId && window.gimodiClients.find(c => c.id === msg.fromId));
    if (liveClient) {
      badge = liveClient.badge || null;
      dmRoleColor = liveClient.roleColor || null;
    }
  }
  const badgeHtml = badge ? `<span class="admin-badge">${escapeHtml(badge)}</span>` : '';
  const dmNickColor = dmRoleColor || '#FFD700';

  const fullTime = formatDateTime(msg.timestamp);
  const compactTime = formatTimeShort(msg.timestamp);
  const compactHtml = `<span class="compact-row"><span class="compact-time" title="${escapeHtml(fullTime)}">${compactTime}</span> <span class="compact-nick" style="color:${dmNickColor}" title="${badge ? escapeHtml(badge) : ''}">${escapeHtml(nickname)}:</span></span>`;
  el.innerHTML = `
    ${compactHtml}
    <div class="chat-msg-header">
      <span class="chat-msg-nick-group"><span class="chat-msg-nick" style="color:${dmNickColor}">${escapeHtml(nickname)}</span>${badgeHtml}</span>
      <span class="chat-msg-time">${headerTime}</span>
    </div>
    <div class="chat-msg-body">${renderMarkdown(msg.content)}</div>
  `;

  // Open links in system browser
  for (const a of el.querySelectorAll('.chat-msg-body a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href) window.gimodi.openExternal(href);
    });
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href');
      if (href) showLinkContextMenu(e.clientX, e.clientY, href);
    });
  }

  return el;
}

function appendDmMessage(msg, doScroll) {
  const el = buildDmMessageEl(msg);
  maybeInsertDaySeparator(msg.timestamp);
  chatMessages.appendChild(el);
  if (doScroll) scrollToBottom();
}

function renderTabs() {
  const tabBar = document.querySelector('.tab-bar');
  if (!tabBar) return;

  tabBar.innerHTML = '';

  // Channel tab - hidden when no channel joined (lobby) or when a channel-view tab for the current channel is open
  if (currentChannelId && !channelViewTabs.find(t => t.channelId === currentChannelId)) {
    const channelTab = document.createElement('div');
    channelTab.id = 'tab-channel';
    channelTab.className = `tab${activeTab.type === 'channel' ? ' active' : ''}${channelTabUnread ? ' unread' : ''}`;
    channelTab.dataset.type = 'channel';
    const channelLabel = document.createElement('span');
    channelLabel.className = 'tab-label';
    channelLabel.textContent = '#' + currentChannelName;
    channelTab.appendChild(channelLabel);
    channelTab.addEventListener('click', () => switchToTab({ type: 'channel' }));
    tabBar.appendChild(channelTab);
  }

  // DM tabs
  for (let i = 0; i < dmTabs.length; i++) {
    const dt = dmTabs[i];
    const tab = document.createElement('div');
    tab.className = `tab${activeTab.type === 'dm' && activeTab.userId === dt.userId ? ' active' : ''}${dt.unread ? ' unread' : ''}`;
    tab.dataset.type = 'dm';
    tab.dataset.userId = dt.userId;
    tab.dataset.dragIndex = i;
    tab.draggable = true;
    addTabDragListeners(tab, 'dm', i);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = dt.nickname;
    tab.appendChild(label);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDmTab(dt.userId);
    });
    tab.appendChild(closeBtn);

    tab.addEventListener('click', () => switchToTab({ type: 'dm', userId: dt.userId, persistentUserId: dt.persistentUserId, nickname: dt.nickname }));
    tab.addEventListener('contextmenu', (e) => showTabContextMenu(e, { type: 'dm', userId: dt.userId }));
    tabBar.appendChild(tab);
  }

  // Channel-view tabs (closeable, read-only channel history)
  for (let i = 0; i < channelViewTabs.length; i++) {
    const cv = channelViewTabs[i];
    const tab = document.createElement('div');
    tab.className = `tab${activeTab.type === 'channel-view' && activeTab.channelId === cv.channelId ? ' active' : ''}${cv.unread ? ' unread' : ''}`;
    tab.dataset.type = 'channel-view';
    tab.dataset.channelId = cv.channelId;
    tab.dataset.dragIndex = i;
    tab.draggable = true;
    addTabDragListeners(tab, 'channel-view', i);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = '#' + cv.channelName;
    tab.appendChild(label);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChannelViewTab(cv.channelId);
    });
    tab.appendChild(closeBtn);

    tab.addEventListener('click', () => switchToTab({ type: 'channel-view', channelId: cv.channelId, channelName: cv.channelName }));
    tab.addEventListener('contextmenu', (e) => showTabContextMenu(e, { type: 'channel-view', channelId: cv.channelId }));
    tabBar.appendChild(tab);
  }
}

function showTabContextMenu(e, tabInfo) {
  e.preventDefault();
  e.stopPropagation();

  const existing = document.querySelector('.tab-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu tab-context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const closeItem = document.createElement('div');
  closeItem.className = 'context-menu-item';
  closeItem.textContent = 'Close Tab';
  closeItem.addEventListener('click', () => {
    menu.remove();
    if (tabInfo.type === 'dm') {
      closeDmTab(tabInfo.userId);
    } else {
      closeChannelViewTab(tabInfo.channelId);
    }
  });
  menu.appendChild(closeItem);

  const closeAllItem = document.createElement('div');
  closeAllItem.className = 'context-menu-item';
  closeAllItem.textContent = 'Close All Tabs';
  closeAllItem.addEventListener('click', () => {
    menu.remove();
    for (const t of [...dmTabs]) closeDmTab(t.userId);
    for (const t of [...channelViewTabs]) closeChannelViewTab(t.channelId);
  });
  menu.appendChild(closeAllItem);

  const closeOthersItem = document.createElement('div');
  closeOthersItem.className = 'context-menu-item';
  closeOthersItem.textContent = 'Close Other Tabs';
  closeOthersItem.addEventListener('click', () => {
    menu.remove();
    if (tabInfo.type === 'dm') {
      for (const t of [...dmTabs]) {
        if (t.userId !== tabInfo.userId) closeDmTab(t.userId);
      }
      for (const t of [...channelViewTabs]) closeChannelViewTab(t.channelId);
    } else {
      for (const t of [...dmTabs]) closeDmTab(t.userId);
      for (const t of [...channelViewTabs]) {
        if (t.channelId !== tabInfo.channelId) closeChannelViewTab(t.channelId);
      }
    }
  });
  menu.appendChild(closeOthersItem);

  document.body.appendChild(menu);

  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      menu.remove();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

function addTabDragListeners(tab, type, index) {
  tab.addEventListener('dragstart', (e) => {
    draggedTab = { type, index };
    tab.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  tab.addEventListener('dragend', () => {
    tab.classList.remove('dragging');
    document.querySelectorAll('.tab.drag-over-left, .tab.drag-over-right').forEach(el => {
      el.classList.remove('drag-over-left', 'drag-over-right');
    });
    draggedTab = null;
  });

  tab.addEventListener('dragover', (e) => {
    if (!draggedTab || draggedTab.type !== type) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Show drop indicator based on cursor position
    const rect = tab.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    tab.classList.toggle('drag-over-left', e.clientX < midX);
    tab.classList.toggle('drag-over-right', e.clientX >= midX);
  });

  tab.addEventListener('dragleave', () => {
    tab.classList.remove('drag-over-left', 'drag-over-right');
  });

  tab.addEventListener('drop', (e) => {
    e.preventDefault();
    tab.classList.remove('drag-over-left', 'drag-over-right');
    if (!draggedTab || draggedTab.type !== type) return;

    const fromIndex = draggedTab.index;
    const rect = tab.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    let toIndex = e.clientX < midX ? index : index + 1;
    if (toIndex > fromIndex) toIndex--;
    if (fromIndex === toIndex) return;

    const arr = type === 'dm' ? dmTabs : channelViewTabs;
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);

    if (type === 'channel-view') {
      window.dispatchEvent(new CustomEvent('gimodi:channel-tabs-changed'));
    }
    renderTabs();
  });
}

export function setChannelName(name) {
  currentChannelName = name;
  renderTabs();
}

export function isChannelUnread(channelId) {
  return unreadChannels.has(channelId);
}

export function initUnreadState(channels, serverAddress) {
  unreadChannels.clear();
  const storageKey = `gimodi:lastRead:${serverAddress}`;
  let lastReadMap = {};
  try {
    lastReadMap = JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch { /* ignore */ }

  for (const ch of channels) {
    if (!ch.lastMessageAt) continue;
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
 * Highlights a message element and removes the highlight after 2 seconds.
 * @param {HTMLElement} el
 */
function highlightMessage(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('chat-msg-highlight');
  setTimeout(() => el.classList.remove('chat-msg-highlight'), 2000);
}

/**
 * Scrolls to a specific message by ID, loading context from server if needed.
 * @param {string} messageId
 * @param {number} timestamp
 */
export async function scrollToMessage(messageId, timestamp) {
  if (!currentChannelId) return;

  if (activeTab.type !== 'channel') {
    activeTab = { type: 'channel' };
    channelMessagesCache.length = 0;
    renderTabs();
    updateInputForTab();
    await loadHistory(currentChannelId);
  }

  const existing = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (existing) {
    highlightMessage(existing);
    return;
  }

  try {
    const result = await chatService.fetchContext(currentChannelId, timestamp);
    if (!result?.messages?.length) return;

    const sorted = [...result.messages];
    sorted.sort((a, b) => a.timestamp - b.timestamp);

    const userIds = sorted.map(m => m.userId).filter(Boolean);
    if (userIds.length > 0) await resolveNicknames(userIds);

    chatMessages.innerHTML = '';
    paginationState.channel = { oldestTs: sorted[0].timestamp, allLoaded: false, loading: false };

    for (const msg of sorted) {
      appendMessage(msg);
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

export function markChannelRead(channelId, serverAddress) {
  const storageKey = `gimodi:lastRead:${serverAddress}`;
  let lastReadMap = {};
  try {
    lastReadMap = JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch { /* ignore */ }
  lastReadMap[channelId] = Date.now();
  localStorage.setItem(storageKey, JSON.stringify(lastReadMap));
}

function onMessagePinned(e) {
  const { messageId, channelId } = e.detail;
  if (!channelPinnedMessages.has(channelId)) {
    channelPinnedMessages.set(channelId, new Set());
  }
  channelPinnedMessages.get(channelId).add(messageId);

  // If this is the currently viewed channel, update pinned messages display
  if (channelId === getViewingChannelId()) {
    renderPinnedMessages();
  }
}

function onMessageUnpinned(e) {
  const { messageId, channelId } = e.detail;
  const pinnedSet = channelPinnedMessages.get(channelId);
  if (pinnedSet) {
    pinnedSet.delete(messageId);
  }

  // If this is the currently viewed channel, update pinned messages display
  if (channelId === getViewingChannelId()) {
    renderPinnedMessages();
  }
}

// --- Message editing ---

function enterEditMode(msgEl, messageId) {
  if (msgEl.classList.contains('editing')) return;

  const rawContent = msgEl.dataset.content || '';
  const bodyEl = msgEl.querySelector('.chat-msg-body');
  if (!bodyEl) return;

  // Convert @u(id) → @nickname for display in edit field
  const preexistingMentions = new Map(); // nickname → { userId, clientId }
  const content = rawContent.replace(/@u\(([^)]+)\)/g, (full, id) => {
    let nick = null;
    if (window.gimodiClients) {
      const c = window.gimodiClients.find(cl => cl.userId === id || cl.id === id);
      nick = c?.nickname ?? null;
    }
    if (!nick) nick = getCachedNickname(id);
    if (!nick) nick = id.slice(0, 8);
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
    if (!editedText) return;
    // Seed selectedMentions with pre-existing mentions before resolving
    for (const [nick, ids] of preexistingMentions) {
      if (!selectedMentions.has(nick)) selectedMentions.set(nick, ids);
    }
    const newContent = resolveStructuredMentions(editedText);
    if (newContent === rawContent) { exitEditMode(); return; }
    try {
      await chatService.editMessage(messageId, newContent);
      exitEditMode();
    } catch (err) {
      appendSystemMessage(`Edit failed: ${err.message}`);
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

// --- Reply functionality ---

function startReplyTo(msg) {
  replyToMessage = {
    id: msg.id,
    nickname: msg.nickname,
    content: msg.content,
    channelId: msg.channelId,
  };
  renderReplyPreview();
  chatInput.focus();
}

function cancelReply() {
  replyToMessage = null;
  renderReplyPreview();
}

function renderReplyPreview() {
  let previewEl = document.getElementById('reply-preview');
  if (!replyToMessage) {
    if (previewEl) previewEl.remove();
    return;
  }

  const inputRow = document.querySelector('.chat-input-row');
  if (!previewEl) {
    previewEl = document.createElement('div');
    previewEl.id = 'reply-preview';
    previewEl.className = 'reply-preview';
    inputRow.parentNode.insertBefore(previewEl, inputRow);
  }

  const rawPreview = replyToMessage.content && isFileMessage(replyToMessage.content) ? 'click to see attachment' : replyToMessage.content ? resolveMentionsText(replyToMessage.content) : '';
  const previewContent = rawPreview
    ? rawPreview.substring(0, 80) + (rawPreview.length > 80 ? '…' : '')
    : '(message)';

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

function onMessageEdited(e) {
  const { messageId, newContent, editedAt } = e.detail;
  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;

  // Update stored raw content
  msgEl.dataset.content = newContent;

  const bodyEl = msgEl.querySelector('.chat-msg-body');
  if (bodyEl) {
    bodyEl.innerHTML = renderMarkdown(newContent);
    // Re-attach link click handlers
    for (const a of bodyEl.querySelectorAll('a')) {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const href = a.getAttribute('href');
        if (href) window.gimodi.openExternal(href);
      });
    }
    // Re-attach copy buttons to code blocks
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
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      });
      pre.appendChild(btn);
    }
  }

  // Add or update (edited) label
  let editedLabelEl = msgEl.querySelector('.chat-msg-edited');
  if (!editedLabelEl) {
    editedLabelEl = document.createElement('span');
    editedLabelEl.className = 'chat-msg-edited';
    editedLabelEl.textContent = '(edited)';

    const header = msgEl.querySelector('.chat-msg-header');
    if (header) {
      const timeEl = header.querySelector('.chat-msg-time');
      if (timeEl) timeEl.after(editedLabelEl);
      else header.appendChild(editedLabelEl);
    } else {
      // Grouped message - append after body
      if (bodyEl) bodyEl.after(editedLabelEl);
    }
  }
  editedLabelEl.title = formatDateTime(editedAt);
}

function renderPinnedMessages() {
  const viewingChannelId = getViewingChannelId();
  const pinnedSet = viewingChannelId ? channelPinnedMessages.get(viewingChannelId) : null;
  if (!pinnedSet || pinnedSet.size === 0) {
    pinnedMessages.classList.add('hidden');
    pinnedMessages.innerHTML = '';
    return;
  }

  pinnedMessages.classList.remove('hidden');
  pinnedMessages.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'pinned-header';
  header.innerHTML = `
    <i class="bi bi-pin-angle-fill"></i>
    <span>${pinnedSet.size} Pinned Message${pinnedSet.size > 1 ? 's' : ''}</span>
    <i class="bi bi-chevron-down pinned-chevron${pinnedCollapsed ? '' : ' expanded'}"></i>
  `;
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    pinnedCollapsed = !pinnedCollapsed;
    renderPinnedMessages();
  });
  pinnedMessages.appendChild(header);

  if (pinnedCollapsed) return;

  const container = document.createElement('div');
  container.className = 'pinned-messages-container';

  // Display pinned messages (find them in the chat history)
  for (const messageId of pinnedSet) {
    const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
      const clone = msgEl.cloneNode(true);
      clone.classList.add('pinned-message-preview');

      const actionsEl = clone.querySelector('.chat-msg-actions');
      if (actionsEl) actionsEl.remove();
      const hoverTimeEl = clone.querySelector('.chat-msg-hover-time');
      if (hoverTimeEl) hoverTimeEl.remove();

      // If this is a grouped message (no header), inject the author name with badge and time
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
        if (body) clone.insertBefore(headerDiv, body);
      }

      // Add unpin button
      if (serverService.hasPermission('chat.pin')) {
        const unpinBtn = document.createElement('button');
        unpinBtn.className = 'pinned-message-unpin';
        unpinBtn.title = 'Unpin';
        unpinBtn.innerHTML = '&times;';
        unpinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chatService.unpinMessage(messageId);
        });
        clone.appendChild(unpinBtn);
      }

      // Click to scroll to original message
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
      // Message was deleted - auto-unpin the orphaned pin
      pinnedSet.delete(messageId);
      if (serverService.hasPermission('chat.pin')) {
        chatService.unpinMessage(messageId);
      }
    }
  }

  pinnedMessages.appendChild(container);
}
