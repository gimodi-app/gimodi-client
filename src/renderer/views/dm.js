import connectionManager from '../services/connectionManager.js';
import { customAlert, customConfirm } from '../services/dialogs.js';

/** @type {import('../services/dm.js').DmService|null} */
let dmService = null;
/** @type {import('../services/friends.js').FriendsService|null} */
let friendsService = null;
/** @type {string|null} */
let activePeer = null;

const el = (id) => document.getElementById(id);

/**
 * Escapes a string for safe HTML insertion.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Formats a timestamp as a short time string.
 * @param {number} ts
 * @returns {string}
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Returns the display name for a peer fingerprint.
 * Falls back to a truncated fingerprint if not in friends list.
 * @param {string} fingerprint
 * @returns {string}
 */
function peerName(fingerprint) {
  const friend = friendsService?.getFriend(fingerprint);
  return friend ? friend.nickname : fingerprint.slice(0, 12) + '…';
}

/**
 * Renders the status indicator icon for a message.
 * @param {'pending'|'sent'|'delivered'} status
 * @returns {string}
 */
function statusIcon(status) {
  if (status === 'delivered') return '<i class="bi bi-check2-all dm-status-delivered" title="Delivered"></i>';
  if (status === 'sent') return '<i class="bi bi-check2 dm-status-sent" title="Sent"></i>';
  return '<i class="bi bi-clock dm-status-pending" title="Pending"></i>';
}

/** @type {HTMLElement|null} */
let _ctxMenu = null;

/**
 * Closes the open context menu, if any.
 */
function closeContextMenu() {
  if (_ctxMenu) {
    _ctxMenu.remove();
    _ctxMenu = null;
  }
}

/**
 * Shows a context menu for a conversation item.
 * @param {MouseEvent} e
 * @param {string} fingerprint
 */
function showConvContextMenu(e, fingerprint) {
  e.preventDefault();
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'dm-context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const isBlocked = friendsService?.isBlocked(fingerprint);

  const blockItem = document.createElement('div');
  blockItem.className = 'dm-context-item';
  blockItem.textContent = isBlocked ? 'Unblock' : 'Block';
  blockItem.addEventListener('click', () => {
    closeContextMenu();
    if (isBlocked) {
      friendsService.unblockContact(fingerprint);
    } else {
      friendsService.blockContact(fingerprint);
    }
    renderConversationList();
    if (activePeer === fingerprint) renderMessages();
  });

  const purgeItem = document.createElement('div');
  purgeItem.className = 'dm-context-item dm-context-danger';
  purgeItem.textContent = 'Purge';
  purgeItem.addEventListener('click', async () => {
    closeContextMenu();
    const confirmed = await customConfirm('Purge this conversation? All messages will be deleted and the contact will be removed.');
    if (!confirmed) return;
    dmService.purgeConversation(fingerprint);
    friendsService?.removeFriend(fingerprint);
    if (activePeer === fingerprint) {
      activePeer = null;
    }
    renderConversationList();
    renderMessages();
  });

  menu.appendChild(blockItem);
  menu.appendChild(purgeItem);
  document.body.appendChild(menu);
  _ctxMenu = menu;
}

document.addEventListener('click', closeContextMenu, true);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.dm-conv-item')) closeContextMenu();
}, true);

/**
 * Builds a conversation list item element.
 * @param {{fingerprint: string, nickname: string, lastMsg: object|null}} peer
 * @returns {HTMLElement}
 */
function buildConvItem(peer) {
  const blocked = friendsService?.isBlocked(peer.fingerprint);
  const item = document.createElement('div');
  item.className = 'dm-conv-item' + (peer.fingerprint === activePeer ? ' active' : '') + (blocked ? ' dm-conv-blocked' : '');
  item.dataset.fingerprint = peer.fingerprint;

  const preview = peer.lastMsg ? escapeHtml(peer.lastMsg.content.slice(0, 60)) : '<em>No messages yet</em>';
  const time = peer.lastMsg ? `<span class="dm-conv-time">${formatTime(peer.lastMsg.createdAt)}</span>` : '';
  const blockedBadge = blocked ? ' <span class="dm-blocked-badge">Blocked</span>' : '';

  item.innerHTML = `
    <div class="dm-conv-name">${escapeHtml(peer.nickname)}${blockedBadge}${time}</div>
    <div class="dm-conv-preview">${preview}</div>
  `;

  item.addEventListener('click', () => openConversation(peer.fingerprint));
  item.addEventListener('contextmenu', (e) => showConvContextMenu(e, peer.fingerprint));
  return item;
}

/**
 * Builds a message request item element with Accept and Ignore buttons.
 * @param {{fingerprint: string, lastMsg: object|null}} peer
 * @returns {HTMLElement}
 */
function buildRequestItem(peer) {
  const item = document.createElement('div');
  item.className = 'dm-conv-item dm-request-item';
  item.dataset.fingerprint = peer.fingerprint;

  const preview = peer.lastMsg ? escapeHtml(peer.lastMsg.content.slice(0, 60)) : '';
  const time = peer.lastMsg ? `<span class="dm-conv-time">${formatTime(peer.lastMsg.createdAt)}</span>` : '';
  const shortFp = peer.fingerprint.slice(0, 12) + '…';

  const top = document.createElement('div');
  top.className = 'dm-conv-name';
  top.innerHTML = `${escapeHtml(shortFp)}${time}`;

  const previewEl = document.createElement('div');
  previewEl.className = 'dm-conv-preview';
  previewEl.innerHTML = preview;

  const actions = document.createElement('div');
  actions.className = 'dm-request-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'dm-request-accept';
  acceptBtn.textContent = 'Accept';
  acceptBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const raw = prompt(`Add as friend — enter a name for ${shortFp}:`, shortFp);
    if (raw === null) return;
    const nickname = raw.trim() || shortFp;
    friendsService.addFriend(peer.fingerprint, nickname);
    renderConversationList();
    openConversation(peer.fingerprint);
  });

  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'dm-request-ignore';
  ignoreBtn.textContent = 'Ignore';
  ignoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    friendsService.ignoreRequest(peer.fingerprint);
    renderConversationList();
    if (activePeer === peer.fingerprint) {
      activePeer = null;
      renderMessages();
    }
  });

  actions.appendChild(acceptBtn);
  actions.appendChild(ignoreBtn);

  item.appendChild(top);
  item.appendChild(previewEl);
  item.appendChild(actions);
  item.addEventListener('click', () => openConversation(peer.fingerprint));
  return item;
}

/**
 * Renders the conversation list in the left panel.
 */
function renderConversationList() {
  const list = el('dm-conversation-list');
  if (!list || !dmService) return;

  const convMap = dmService.getConversationList();
  const friends = friendsService?.getFriends() ?? [];

  // Split into known peers (friends) and requests (received from strangers)
  const knownPeers = new Map();
  for (const f of friends) {
    knownPeers.set(f.fingerprint, { fingerprint: f.fingerprint, nickname: f.nickname, lastMsg: null });
  }

  const requests = [];
  for (const [fingerprint, lastMsg] of convMap) {
    if (knownPeers.has(fingerprint)) {
      knownPeers.get(fingerprint).lastMsg = lastMsg;
    } else if (lastMsg.direction === 'received' && !friendsService?.isIgnored(fingerprint)) {
      requests.push({ fingerprint, lastMsg });
    }
  }

  // Also include sent-only conversations (peers we messaged but haven't added as friends)
  for (const [fingerprint, lastMsg] of convMap) {
    if (!knownPeers.has(fingerprint) && lastMsg.direction === 'sent') {
      knownPeers.set(fingerprint, { fingerprint, nickname: fingerprint.slice(0, 12) + '…', lastMsg });
    }
  }

  list.innerHTML = '';

  if (knownPeers.size === 0 && requests.length === 0) {
    list.innerHTML = '<div class="dm-empty-hint">No conversations yet.<br>Right-click a user to add them as a friend.</div>';
    return;
  }

  if (requests.length > 0) {
    const header = document.createElement('div');
    header.className = 'dm-section-header';
    header.textContent = `Message Requests (${requests.length})`;
    list.appendChild(header);

    requests.sort((a, b) => (b.lastMsg?.createdAt ?? 0) - (a.lastMsg?.createdAt ?? 0));
    for (const peer of requests) {
      list.appendChild(buildRequestItem(peer));
    }
  }

  if (knownPeers.size > 0) {
    if (requests.length > 0) {
      const header = document.createElement('div');
      header.className = 'dm-section-header';
      header.textContent = 'Conversations';
      list.appendChild(header);
    }

    const sorted = [...knownPeers.values()].sort((a, b) => (b.lastMsg?.createdAt ?? 0) - (a.lastMsg?.createdAt ?? 0));
    for (const peer of sorted) {
      list.appendChild(buildConvItem(peer));
    }
  }
}

/**
 * Renders the message list for the active conversation.
 */
function renderMessages() {
  const container = el('dm-messages');
  const header = el('dm-chat-header');
  const input = el('dm-input');
  const sendBtn = el('btn-dm-send');

  if (!container) return;

  if (!activePeer) {
    container.innerHTML = '<div class="dm-empty-hint">Select a conversation</div>';
    if (header) header.textContent = '';
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  const blocked = friendsService?.isBlocked(activePeer);
  if (header) header.textContent = peerName(activePeer);
  if (input) input.disabled = !!blocked;
  if (sendBtn) sendBtn.disabled = !!blocked;
  if (input) input.placeholder = blocked ? 'You have blocked this person.' : 'Message…';

  const messages = dmService?.getConversation(activePeer) ?? [];
  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = '<div class="dm-empty-hint">No messages yet. Say hello!</div>';
    return;
  }

  for (const msg of messages) {
    container.appendChild(buildMessageEl(msg));
  }

  container.scrollTop = container.scrollHeight;
}

/**
 * Builds a single message DOM element.
 * @param {import('../services/dm.js').DmMessage} msg
 * @returns {HTMLElement}
 */
function buildMessageEl(msg) {
  const row = document.createElement('div');
  row.className = 'dm-msg' + (msg.direction === 'sent' ? ' dm-msg-sent' : ' dm-msg-received');
  row.dataset.id = msg.id;

  const bubble = document.createElement('div');
  bubble.className = 'dm-msg-bubble';
  bubble.textContent = msg.content;

  const meta = document.createElement('div');
  meta.className = 'dm-msg-meta';
  meta.innerHTML = `<span class="dm-msg-time">${formatTime(msg.createdAt)}</span>`;

  if (msg.direction === 'sent') {
    const statusEl = document.createElement('span');
    statusEl.className = 'dm-msg-status';
    statusEl.innerHTML = statusIcon(msg.status);
    meta.appendChild(statusEl);

    if (msg.status === 'pending') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'dm-retry-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => showRetryPicker(msg.id));
      meta.appendChild(retryBtn);
    }
  }

  row.appendChild(bubble);
  row.appendChild(meta);
  return row;
}

/**
 * Opens a conversation with a peer, rendering their messages.
 * @param {string} fingerprint
 */
function openConversation(fingerprint) {
  activePeer = fingerprint;
  renderConversationList();
  renderMessages();
}

/**
 * Shows a server picker to retry sending a stuck message.
 * @param {string} messageId
 */
async function showRetryPicker(messageId) {
  const servers = [...connectionManager.connections.entries()]
    .filter(([, conn]) => conn.connected)
    .map(([key]) => key);

  if (servers.length === 0) {
    await customAlert('No servers connected. Cannot retry.');
    return;
  }

  try {
    await dmService.retrySend(messageId, servers[0]);
  } catch (err) {
    await customAlert(`Retry failed: ${err.message}`);
  }
}

/**
 * Handles sending a message from the input field.
 */
async function handleSend() {
  const input = el('dm-input');
  if (!input || !activePeer || !dmService) return;

  const content = input.value.trim();
  if (!content) return;

  input.value = '';
  input.style.height = '';

  try {
    await dmService.sendDm(activePeer, content);
  } catch (err) {
    await customAlert(`Failed to send: ${err.message}`);
  }
}

/**
 * Updates the service references when a new identity becomes active.
 * Called from app.js whenever ensureDmServices creates new instances.
 * @param {import('../services/dm.js').DmService} dm
 * @param {import('../services/friends.js').FriendsService} friends
 */
export function updateDmServices(dm, friends) {
  dmService = dm;
  friendsService = friends;
  activePeer = null;
  renderConversationList();
  renderMessages();
}

/**
 * Initializes the DM view. Called once from app.js after identity is known.
 * @param {import('../services/dm.js').DmService} dm
 * @param {import('../services/friends.js').FriendsService} friends
 */
export function initDmView(dm, friends) {
  dmService = dm;
  friendsService = friends;

  dmService.addEventListener('message-received', () => {
    renderConversationList();
    if (activePeer) renderMessages();
  });

  dmService.addEventListener('conversation-purged', () => {
    renderConversationList();
    renderMessages();
  });

  dmService.addEventListener('message-updated', (e) => {
    renderConversationList();
    if (activePeer && e.detail.peerFingerprint === activePeer) {
      const existing = el('dm-messages')?.querySelector(`[data-id="${e.detail.id}"]`);
      if (existing) {
        existing.replaceWith(buildMessageEl(e.detail));
      } else {
        renderMessages();
      }
    }
  });

  const sendBtn = el('btn-dm-send');
  const input = el('dm-input');
  const backBtn = el('btn-dm-back');

  if (sendBtn) sendBtn.addEventListener('click', handleSend);

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = '';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    input.disabled = true;
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('gimodi:show-server-view'));
    });
  }

  renderConversationList();
}

/**
 * Refreshes the DM view when switching to it.
 * Called from app.js each time the DM view becomes visible.
 */
export function refreshDmView() {
  renderConversationList();
  renderMessages();
}

/**
 * Opens the DM view directly to a conversation with the given fingerprint.
 * @param {string} fingerprint
 */
export function openDmConversation(fingerprint) {
  openConversation(fingerprint);
}
