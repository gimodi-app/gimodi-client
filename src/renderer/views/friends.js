import dmService from '../services/dm.js';
import { renderDmMessageEl, maybeInsertDaySeparator, createLinkPreviewEl } from './chat-renderer.js';
import { formatRelativeTime } from '../services/timeFormat.js';
import { customConfirm, customPrompt } from '../services/dialogs.js';

let friendsList = [];
let conversations = [];
let activeFingerprint = null;
let dmPagination = { oldestTs: null, allLoaded: false, loading: false };

const HISTORY_PAGE_SIZE = 50;

/**
 * Initializes the DM view.
 */
export function initDmView() {
  loadFriends();

  dmService.addEventListener('dm-message', onDmMessage);
  dmService.addEventListener('dm-deleted', onDmDeleted);
  dmService.addEventListener('dm-link-preview', onDmLinkPreview);
  dmService.addEventListener('presence-update', onPresenceUpdate);

  const sendBtn = document.getElementById('dm-btn-send');
  const input = document.getElementById('dm-chat-input');

  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const msgContainer = document.getElementById('dm-chat-messages');
  if (msgContainer) {
    msgContainer.addEventListener('scroll', onScroll);
  }

  window.addEventListener('gimodi:friends-updated', () => loadFriends());
}

/**
 * Called when the DM view becomes visible.
 */
export async function onDmViewActive() {
  await loadFriends();
  await loadConversations();
}

/**
 * Loads friends from persistent storage and updates DmService.
 */
async function loadFriends() {
  friendsList = await window.gimodi.friends.list();
  dmService.setFriends(friendsList);
}

/**
 * Loads DM conversations from all servers and renders the list.
 */
async function loadConversations() {
  const serverConversations = await dmService.fetchAllConversations();

  const byFp = new Map();
  for (const conv of serverConversations) {
    const fp = conv.partnerFingerprint;
    if (!fp) {
      continue;
    }
    const existing = byFp.get(fp);
    if (!existing || conv.lastMessage.timestamp > existing.lastMessage.timestamp) {
      byFp.set(fp, conv);
    }
  }

  for (const friend of friendsList) {
    if (!byFp.has(friend.fingerprint)) {
      byFp.set(friend.fingerprint, {
        partnerFingerprint: friend.fingerprint,
        partnerUserId: null,
        lastMessage: null,
      });
    }
  }

  conversations = [...byFp.values()].sort((a, b) => {
    const tA = a.lastMessage?.timestamp || 0;
    const tB = b.lastMessage?.timestamp || 0;
    return tB - tA;
  });

  renderConversationList();

  if (!activeFingerprint && conversations.length > 0) {
    selectConversation(conversations[0].partnerFingerprint);
  }
}

/**
 * Renders the conversation list in the DM sidebar.
 */
function renderConversationList() {
  const listEl = document.getElementById('dm-conversation-list');
  if (!listEl) {
    return;
  }
  listEl.innerHTML = '';

  if (conversations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dm-conversations-empty';
    empty.textContent = 'No conversations yet. Right-click a user to add them as a friend.';
    listEl.appendChild(empty);
    return;
  }

  for (const conv of conversations) {
    const fp = conv.partnerFingerprint;
    const friend = friendsList.find((f) => f.fingerprint === fp);
    const displayName = friend?.displayName || fp.substring(0, 12) + '...';
    const online = dmService.isOnline(fp);

    const entry = document.createElement('div');
    entry.className = 'dm-conversation-entry' + (activeFingerprint === fp ? ' active' : '');

    const indicator = document.createElement('span');
    indicator.className = 'dm-conv-indicator ' + (online ? 'online' : 'offline');
    entry.appendChild(indicator);

    const info = document.createElement('div');
    info.className = 'dm-conv-info';

    const name = document.createElement('div');
    name.className = 'dm-conv-name';
    name.textContent = displayName;
    info.appendChild(name);

    if (conv.lastMessage) {
      const preview = document.createElement('div');
      preview.className = 'dm-conv-preview';
      preview.textContent = conv.lastMessage.content?.substring(0, 50) || '';
      info.appendChild(preview);
    }

    entry.appendChild(info);

    if (conv.lastMessage) {
      const time = document.createElement('span');
      time.className = 'dm-conv-time';
      time.textContent = formatRelativeTime(conv.lastMessage.timestamp);
      entry.appendChild(time);
    }

    entry.addEventListener('click', () => selectConversation(fp));
    entry.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (friend) {
        showFriendContextMenu(e, friend);
      }
    });

    listEl.appendChild(entry);
  }
}

/**
 * Selects a conversation and loads its messages.
 * @param {string} fingerprint
 */
async function selectConversation(fingerprint) {
  activeFingerprint = fingerprint;
  dmPagination = { oldestTs: null, allLoaded: false, loading: false };

  renderConversationList();

  const friend = friendsList.find((f) => f.fingerprint === fingerprint);
  const displayName = friend?.displayName || fingerprint.substring(0, 12) + '...';
  const online = dmService.isOnline(fingerprint);

  const headerName = document.getElementById('dm-chat-partner-name');
  const headerPresence = document.getElementById('dm-chat-presence');
  const emptyState = document.getElementById('dm-empty-state');
  const msgContainer = document.getElementById('dm-chat-messages');
  const inputRow = document.querySelector('.dm-chat-input-row');

  if (headerName) {
    headerName.textContent = displayName;
  }
  if (headerPresence) {
    headerPresence.className = 'dm-presence-indicator ' + (online ? 'online' : 'offline');
  }
  if (emptyState) {
    emptyState.classList.add('hidden');
  }
  if (inputRow) {
    inputRow.style.display = '';
  }
  if (msgContainer) {
    msgContainer.innerHTML = '';
  }

  await loadHistory(fingerprint);
}

/**
 * Loads DM history for the active conversation.
 * @param {string} fingerprint
 */
async function loadHistory(fingerprint) {
  if (dmPagination.loading || dmPagination.allLoaded) {
    return;
  }
  dmPagination.loading = true;

  try {
    const result = await dmService.fetchHistory(fingerprint, dmPagination.oldestTs, HISTORY_PAGE_SIZE);
    if (!result || activeFingerprint !== fingerprint) {
      return;
    }

    const messages = result.messages || [];
    if (messages.length < HISTORY_PAGE_SIZE) {
      dmPagination.allLoaded = true;
    }
    if (messages.length > 0) {
      dmPagination.oldestTs = messages[messages.length - 1].timestamp;
    }

    const msgContainer = document.getElementById('dm-chat-messages');
    if (!msgContainer) {
      return;
    }

    const route = dmService.pickRoute(fingerprint);
    const myUserId = route?.conn?.userId || null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      maybeInsertDaySeparator(msgContainer, msg.timestamp);
      const el = renderDmMessageEl(msg, {
        myUserId,
        onDelete: (id) => dmService.deleteMessage(fingerprint, id),
        onReply: (m) => setReplyTo(m),
      });
      msgContainer.insertBefore(el, msgContainer.firstChild);
    }

    if (messages.length > 0 && !dmPagination.oldestTs) {
      scrollToBottom();
    }
  } finally {
    dmPagination.loading = false;
  }
}

/**
 * Scrolls the DM chat to the bottom.
 */
function scrollToBottom() {
  const msgContainer = document.getElementById('dm-chat-messages');
  if (msgContainer) {
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }
}

/**
 * Sends a message in the active DM conversation.
 */
function sendMessage() {
  if (!activeFingerprint) {
    return;
  }
  const input = document.getElementById('dm-chat-input');
  if (!input) {
    return;
  }
  const content = input.value.trim();
  if (!content) {
    return;
  }

  const sent = dmService.sendMessage(activeFingerprint, content);
  if (sent) {
    input.value = '';
  }
}

/**
 * Sets reply context (placeholder for future reply support).
 * @param {object} msg
 */
function setReplyTo(_msg) {
  const input = document.getElementById('dm-chat-input');
  if (input) {
    input.focus();
  }
}

/**
 * Handles incoming DM messages.
 * @param {CustomEvent} e
 */
function onDmMessage(e) {
  const msg = e.detail;
  const fp = msg.fingerprint;

  if (activeFingerprint === fp) {
    const msgContainer = document.getElementById('dm-chat-messages');
    if (msgContainer) {
      maybeInsertDaySeparator(msgContainer, msg.timestamp);
      const route = dmService.pickRoute(fp);
      const myUserId = route?.conn?.userId || null;
      const el = renderDmMessageEl(msg, {
        myUserId,
        onDelete: (id) => dmService.deleteMessage(fp, id),
        onReply: (m) => setReplyTo(m),
      });
      const atBottom = msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight < 80;
      msgContainer.appendChild(el);
      if (atBottom) {
        scrollToBottom();
      }
    }
  }

  updateConversationPreview(fp, msg);
}

/**
 * Updates the conversation list with a new message preview.
 * @param {string} fingerprint
 * @param {object} msg
 */
function updateConversationPreview(fingerprint, msg) {
  const conv = conversations.find((c) => c.partnerFingerprint === fingerprint);
  if (conv) {
    conv.lastMessage = {
      content: msg.content,
      senderUserId: msg.senderUserId,
      timestamp: msg.timestamp,
    };
    conversations.sort((a, b) => {
      const tA = a.lastMessage?.timestamp || 0;
      const tB = b.lastMessage?.timestamp || 0;
      return tB - tA;
    });
    renderConversationList();
  }
}

/**
 * Handles DM message deletion.
 * @param {CustomEvent} e
 */
function onDmDeleted(e) {
  const { messageId } = e.detail;
  const msgContainer = document.getElementById('dm-chat-messages');
  if (msgContainer) {
    const el = msgContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.remove();
    }
  }
}

/**
 * Handles DM link preview updates.
 * @param {CustomEvent} e
 */
function onDmLinkPreview(e) {
  const { messageId, previews } = e.detail;
  const msgContainer = document.getElementById('dm-chat-messages');
  if (msgContainer && previews) {
    const el = msgContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      for (const preview of previews) {
        el.appendChild(createLinkPreviewEl(preview));
      }
    }
  }
}

/**
 * Handles presence updates.
 * @param {CustomEvent} e
 */
function onPresenceUpdate(e) {
  const { fingerprint, online } = e.detail;

  if (activeFingerprint === fingerprint) {
    const headerPresence = document.getElementById('dm-chat-presence');
    if (headerPresence) {
      headerPresence.className = 'dm-presence-indicator ' + (online ? 'online' : 'offline');
    }
  }

  renderConversationList();
}

/**
 * Handles scroll for loading older messages.
 */
function onScroll() {
  const msgContainer = document.getElementById('dm-chat-messages');
  if (!msgContainer || !activeFingerprint) {
    return;
  }
  if (msgContainer.scrollTop < 100 && !dmPagination.loading && !dmPagination.allLoaded) {
    const prevHeight = msgContainer.scrollHeight;
    loadHistory(activeFingerprint).then(() => {
      msgContainer.scrollTop += msgContainer.scrollHeight - prevHeight;
    });
  }
}

/**
 * Shows the context menu for a friend entry.
 * @param {MouseEvent} e
 * @param {object} friend
 */
function showFriendContextMenu(e, friend) {
  const existing = document.querySelector('.context-menu');
  if (existing) {
    existing.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  const renameItem = document.createElement('div');
  renameItem.className = 'context-menu-item';
  renameItem.textContent = 'Rename';
  renameItem.addEventListener('click', async () => {
    menu.remove();
    const newName = await customPrompt('New display name:', friend.displayName);
    if (newName && newName !== friend.displayName) {
      await window.gimodi.friends.update(friend.fingerprint, { displayName: newName });
      window.dispatchEvent(new CustomEvent('gimodi:friends-updated'));
    }
  });
  menu.appendChild(renameItem);

  const removeItem = document.createElement('div');
  removeItem.className = 'context-menu-item danger';
  removeItem.textContent = 'Remove Friend';
  removeItem.addEventListener('click', async () => {
    menu.remove();
    const confirmed = await customConfirm(`Remove ${friend.displayName} from friends?`);
    if (confirmed) {
      await window.gimodi.friends.remove(friend.fingerprint);
      window.dispatchEvent(new CustomEvent('gimodi:friends-updated'));
    }
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);

  const dismiss = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss, true), 0);
}

/**
 * Cleans up the DM view state.
 */
export function cleanup() {
  activeFingerprint = null;
  conversations = [];
  dmPagination = { oldestTs: null, allLoaded: false, loading: false };
}

/**
 * Returns whether a DM conversation is currently active.
 * @returns {boolean}
 */
export function isDmViewActive() {
  return activeFingerprint !== null;
}
