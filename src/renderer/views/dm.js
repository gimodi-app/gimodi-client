import connectionManager from '../services/connectionManager.js';
import { customAlert } from '../services/dialogs.js';

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

/**
 * Renders the conversation list in the left panel.
 */
function renderConversationList() {
  const list = el('dm-conversation-list');
  if (!list || !dmService) return;

  const convMap = dmService.getConversationList();
  const friends = friendsService?.getFriends() ?? [];

  // Build union of known peers: friends + peers with messages
  const peers = new Map();
  for (const f of friends) {
    peers.set(f.fingerprint, { fingerprint: f.fingerprint, nickname: f.nickname, lastMsg: null });
  }
  for (const [fingerprint, lastMsg] of convMap) {
    if (peers.has(fingerprint)) {
      peers.get(fingerprint).lastMsg = lastMsg;
    } else {
      peers.set(fingerprint, { fingerprint, nickname: fingerprint.slice(0, 12) + '…', lastMsg });
    }
  }

  list.innerHTML = '';

  if (peers.size === 0) {
    list.innerHTML = '<div class="dm-empty-hint">No conversations yet.<br>Right-click a user to add them as a friend.</div>';
    return;
  }

  const sorted = [...peers.values()].sort((a, b) => {
    const ta = a.lastMsg?.createdAt ?? 0;
    const tb = b.lastMsg?.createdAt ?? 0;
    return tb - ta;
  });

  for (const peer of sorted) {
    const item = document.createElement('div');
    item.className = 'dm-conv-item' + (peer.fingerprint === activePeer ? ' active' : '');
    item.dataset.fingerprint = peer.fingerprint;

    const preview = peer.lastMsg ? escapeHtml(peer.lastMsg.content.slice(0, 60)) : '<em>No messages yet</em>';
    const time = peer.lastMsg ? `<span class="dm-conv-time">${formatTime(peer.lastMsg.createdAt)}</span>` : '';

    item.innerHTML = `
      <div class="dm-conv-name">${escapeHtml(peer.nickname)}${time}</div>
      <div class="dm-conv-preview">${preview}</div>
    `;

    item.addEventListener('click', () => openConversation(peer.fingerprint));
    list.appendChild(item);
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

  if (header) header.textContent = peerName(activePeer);
  if (input) input.disabled = false;
  if (sendBtn) sendBtn.disabled = false;

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
