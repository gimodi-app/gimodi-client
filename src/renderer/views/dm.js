import { customAlert, customConfirm, customPrompt } from '../services/dialogs.js';
import connectionManager from '../services/connectionManager.js';
import DmChatProvider from '../services/chat-providers/dm.js';
import { initChatView, cleanup as cleanupChat } from './chat.js';

/** @type {import('../services/dm.js').DmService|null} */
let dmService = null;
/** @type {import('../services/friends.js').FriendsService|null} */
let friendsService = null;
/** @type {string|null} */
let activePeer = null;
/** @type {'conversations'|'friends'} */
let activeTab = 'conversations';
/** @type {DmChatProvider|null} */
let dmChatProvider = null;

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
 * Renders the DM chat header with peer name, relay server badge, and placeholder action buttons.
 * @param {HTMLElement} header
 * @param {string} nickname
 */
function renderDmHeader(header, nickname) {
  header.innerHTML = '';

  const nameEl = document.createElement('span');
  nameEl.className = 'dm-header-name';
  nameEl.textContent = nickname;
  header.appendChild(nameEl);

  const active = connectionManager.getActive();
  if (active?.serverName) {
    const badge = document.createElement('span');
    badge.className = 'dm-header-server-badge';
    badge.textContent = active.serverName;
    badge.title = active.address || '';
    header.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'dm-header-actions';
  actions.innerHTML = `<button class="btn-icon dm-header-btn" title="Call" disabled><i class="bi bi-telephone"></i></button><button class="btn-icon dm-header-btn" title="Share Screen" disabled><i class="bi bi-display"></i></button><button class="btn-icon dm-header-btn" title="Webcam" disabled><i class="bi bi-webcam"></i></button>`;
  header.appendChild(actions);
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

  const isFriend = friendsService?.isFriend(fingerprint);
  const isBlocked = friendsService?.isBlocked(fingerprint);

  if (!isFriend) {
    const addItem = document.createElement('div');
    addItem.className = 'dm-context-item';
    addItem.textContent = 'Add Friend';
    addItem.addEventListener('click', async () => {
      closeContextMenu();
      const shortFp = fingerprint.slice(0, 12) + '…';
      const raw = await customPrompt(`Add as friend — enter a name:`, shortFp);
      if (raw === null) return;
      friendsService.addFriend(fingerprint, raw.trim() || shortFp);
      renderConversationList();
      if (activePeer === fingerprint) initDmChat();
    });
    menu.appendChild(addItem);
  }

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
    if (activePeer === fingerprint) initDmChat();
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
    initDmChat();
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
    const raw = await customPrompt(`Add as friend — enter a name for ${shortFp}:`, shortFp);
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
      initDmChat();
    }
  });

  actions.appendChild(acceptBtn);
  actions.appendChild(ignoreBtn);

  item.appendChild(top);
  item.appendChild(previewEl);
  item.appendChild(actions);
  item.addEventListener('click', () => openConversation(peer.fingerprint));
  item.addEventListener('contextmenu', (e) => showConvContextMenu(e, peer.fingerprint));
  return item;
}

/**
 * Builds a friend request item element with Accept and Reject buttons.
 * @param {{requestId: string, senderFingerprint: string, senderNickname: string, createdAt: number}} req
 * @returns {HTMLElement}
 */
function buildFriendRequestItem(req) {
  const item = document.createElement('div');
  item.className = 'dm-conv-item dm-request-item';
  item.dataset.requestId = req.requestId;

  const top = document.createElement('div');
  top.className = 'dm-conv-name';
  top.innerHTML = `${escapeHtml(req.senderNickname)} <span class="dm-conv-time">${formatTime(req.createdAt)}</span>`;

  const previewEl = document.createElement('div');
  previewEl.className = 'dm-conv-preview';
  previewEl.textContent = 'Wants to be your friend';

  const actions = document.createElement('div');
  actions.className = 'dm-request-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'dm-request-accept';
  acceptBtn.textContent = 'Accept';
  acceptBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await friendsService.acceptRequest(req.requestId);
      renderConversationList();
    } catch (err) {
      customAlert('Failed to accept friend request: ' + err.message);
    }
  });

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'dm-request-ignore';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await friendsService.rejectRequest(req.requestId);
      renderConversationList();
    } catch (err) {
      customAlert('Failed to reject friend request: ' + err.message);
    }
  });

  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);

  item.appendChild(top);
  item.appendChild(previewEl);
  item.appendChild(actions);
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
    list.innerHTML = '<div class="dm-empty-hint">No conversations yet.<br>Right-click a user to send them a friend request.</div>';
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
 * Switches the active tab and renders the appropriate list.
 * @param {'conversations'|'friends'} tab
 */
function switchTab(tab) {
  activeTab = tab;
  const convList = el('dm-conversation-list');
  const friendsList = el('dm-friends-list');
  if (!convList || !friendsList) return;

  for (const btn of document.querySelectorAll('.dm-tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }

  if (tab === 'conversations') {
    convList.style.display = '';
    friendsList.style.display = 'none';
    renderConversationList();
  } else {
    convList.style.display = 'none';
    friendsList.style.display = '';
    renderFriendsList();
  }
}

/**
 * Renders the friends list with friend requests at the top.
 */
function renderFriendsList() {
  const list = el('dm-friends-list');
  if (!list || !friendsService) return;

  const friends = friendsService.getFriends();
  const friendRequests = friendsService.getPendingRequests();

  list.innerHTML = '';

  if (friends.length === 0 && friendRequests.length === 0) {
    list.innerHTML = '<div class="dm-empty-hint">No friends yet.<br>Right-click a user to send them a friend request.</div>';
    return;
  }

  if (friendRequests.length > 0) {
    const header = document.createElement('div');
    header.className = 'dm-section-header';
    header.textContent = `Friend Requests (${friendRequests.length})`;
    list.appendChild(header);

    for (const req of friendRequests) {
      list.appendChild(buildFriendRequestItem(req));
    }
  }

  if (friends.length > 0) {
    if (friendRequests.length > 0) {
      const header = document.createElement('div');
      header.className = 'dm-section-header';
      header.textContent = 'Friends';
      list.appendChild(header);
    }

    const sorted = [...friends].sort((a, b) => a.nickname.localeCompare(b.nickname));
    for (const friend of sorted) {
      list.appendChild(buildFriendItem(friend));
    }
  }
}

/**
 * Builds a friend list item element.
 * @param {{fingerprint: string, nickname: string}} friend
 * @returns {HTMLElement}
 */
function buildFriendItem(friend) {
  const item = document.createElement('div');
  item.className = 'dm-conv-item';
  item.dataset.fingerprint = friend.fingerprint;

  const nameEl = document.createElement('div');
  nameEl.className = 'dm-conv-name';
  nameEl.textContent = friend.nickname;

  item.appendChild(nameEl);
  item.addEventListener('click', () => {
    switchTab('conversations');
    openConversation(friend.fingerprint);
  });
  return item;
}

/**
 * Initializes the chat component for the active DM conversation.
 */
function initDmChat() {
  const container = el('dm-chat-container');
  const header = el('dm-chat-header');
  const chatMessagesEl = el('dm-chat-messages');

  if (!container) return;

  if (!activePeer) {
    if (chatMessagesEl) chatMessagesEl.innerHTML = '<div class="dm-empty-hint">Select a conversation</div>';
    if (header) header.textContent = '';
    // Disable input
    const input = container.querySelector('.chat-input');
    const sendBtn = container.querySelector('.btn-send');
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  const blocked = friendsService?.isBlocked(activePeer);
  if (header) renderDmHeader(header, peerName(activePeer));

  if (blocked) {
    if (chatMessagesEl) chatMessagesEl.innerHTML = '';
    const input = container.querySelector('.chat-input');
    const sendBtn = container.querySelector('.btn-send');
    if (input) {
      input.disabled = true;
      input.placeholder = 'You have blocked this person.';
    }
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  // Destroy previous provider
  if (dmChatProvider) {
    cleanupChat();
    dmChatProvider.destroy();
    dmChatProvider = null;
  }

  const nickname = peerName(activePeer);
  dmChatProvider = new DmChatProvider(dmService, activePeer, nickname);
  initChatView(null, dmChatProvider, container);
}


/**
 * Opens a conversation with a peer, rendering their messages via the chat component.
 * @param {string} fingerprint
 */
function openConversation(fingerprint) {
  activePeer = fingerprint;
  renderConversationList();
  initDmChat();
}

// showRetryPicker and handleSend removed — the chat component handles sending via the DmChatProvider

/**
 * Updates the service references when a new identity becomes active.
 * Called from app.js whenever ensureDmServices creates new instances.
 * @param {import('../services/dm.js').DmService} dm
 * @param {import('../services/friends.js').FriendsService} friends
 */
export function updateDmServices(dm, friends) {
  dmService = dm;
  friendsService = friends;
  friendsService.addEventListener('friend:request-received', renderActiveTab);
  friendsService.addEventListener('friend:accepted', renderActiveTab);
  friendsService.addEventListener('friend:rejected', renderActiveTab);
  friendsService.addEventListener('friend:removed', renderActiveTab);
  activePeer = null;
  renderActiveTab();
  initDmChat();
}

/**
 * Re-renders whichever tab is currently active.
 */
function renderActiveTab() {
  if (activeTab === 'friends') {
    renderFriendsList();
  } else {
    renderConversationList();
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
    // The chat component handles live message rendering via the provider events
  });

  dmService.addEventListener('conversation-purged', () => {
    renderConversationList();
    if (activePeer) initDmChat();
  });

  dmService.addEventListener('message-updated', () => {
    renderConversationList();
    // The chat component handles message updates via the provider events
  });

  friendsService.addEventListener('friend:request-received', renderActiveTab);
  friendsService.addEventListener('friend:accepted', renderActiveTab);
  friendsService.addEventListener('friend:rejected', renderActiveTab);
  friendsService.addEventListener('friend:removed', renderActiveTab);

  for (const tab of document.querySelectorAll('.dm-tab')) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  renderConversationList();
}

/**
 * Refreshes the DM view when switching to it.
 * Called from app.js each time the DM view becomes visible.
 */
export function refreshDmView() {
  renderActiveTab();
  if (activePeer) initDmChat();
}

/**
 * Opens the DM view directly to a conversation with the given fingerprint.
 * @param {string} fingerprint
 */
export function openDmConversation(fingerprint) {
  openConversation(fingerprint);
}
