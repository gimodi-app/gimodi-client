import { customAlert, customConfirm, customPrompt } from '../services/dialogs.js';
import connectionManager from '../services/connectionManager.js';
import DmChatProvider from '../services/chat-providers/dm.js';
import { initChatView, cleanup as cleanupChat } from './chat.js';

/** @type {import('../services/dm.js').DmService|null} */
let dmService = null;
/** @type {import('../services/friends.js').FriendsService|null} */
let friendsService = null;
/** @type {string|null} */
let activeConversationId = null;
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
 * Renders the DM chat header for a conversation.
 * @param {HTMLElement} header
 * @param {string} name
 * @param {import('../services/dm.js').Conversation} conv
 */
function renderDmHeader(header, name, conv) {
  header.innerHTML = '';

  const nameEl = document.createElement('span');
  nameEl.className = 'dm-header-name';
  nameEl.textContent = name;
  header.appendChild(nameEl);

  if (conv.type === 'group') {
    const countBadge = document.createElement('span');
    countBadge.className = 'dm-header-server-badge';
    countBadge.textContent = `${conv.participants.length} members`;
    header.appendChild(countBadge);
  }

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
 * Returns a display name for a conversation.
 * @param {import('../services/dm.js').Conversation} conv
 * @returns {string}
 */
function conversationDisplayName(conv) {
  if (conv.name) {
    return conv.name;
  }
  if (conv.type === 'direct') {
    const other = conv.participants.find((p) => p.fingerprint !== dmService._fingerprint);
    if (other) {
      const friend = friendsService?.getFriend(other.fingerprint);
      return friend ? friend.nickname : other.nickname;
    }
    return 'Unknown';
  }
  return conv.participants
    .filter((p) => p.fingerprint !== dmService._fingerprint)
    .map((p) => {
      const friend = friendsService?.getFriend(p.fingerprint);
      return friend ? friend.nickname : p.nickname;
    })
    .join(', ');
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
 * @param {string} conversationId
 */
function showConvContextMenu(e, conversationId) {
  e.preventDefault();
  closeContextMenu();

  const conv = dmService?.getConversationMeta(conversationId);
  if (!conv) {
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'dm-context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  if (conv.type === 'direct') {
    const otherFp = conv.participants.find((p) => p.fingerprint !== dmService._fingerprint)?.fingerprint;
    if (otherFp) {
      const isFriend = friendsService?.isFriend(otherFp);
      const isBlocked = friendsService?.isBlocked(otherFp);

      if (!isFriend) {
        const addItem = document.createElement('div');
        addItem.className = 'dm-context-item';
        addItem.textContent = 'Add Friend';
        addItem.addEventListener('click', async () => {
          closeContextMenu();
          const shortFp = otherFp.slice(0, 12) + '…';
          const raw = await customPrompt(`Add as friend — enter a name:`, shortFp);
          if (raw === null) {
            return;
          }
          friendsService.addFriend(otherFp, raw.trim() || shortFp);
          renderConversationList();
          if (activeConversationId === conversationId) {
            initDmChat();
          }
        });
        menu.appendChild(addItem);
      }

      const blockItem = document.createElement('div');
      blockItem.className = 'dm-context-item';
      blockItem.textContent = isBlocked ? 'Unblock' : 'Block';
      blockItem.addEventListener('click', () => {
        closeContextMenu();
        if (isBlocked) {
          friendsService.unblockContact(otherFp);
        } else {
          friendsService.blockContact(otherFp);
        }
        renderConversationList();
        if (activeConversationId === conversationId) {
          initDmChat();
        }
      });
      menu.appendChild(blockItem);
    }
  }

  if (conv.type === 'group') {
    const leaveItem = document.createElement('div');
    leaveItem.className = 'dm-context-item dm-context-danger';
    leaveItem.textContent = 'Leave Group';
    leaveItem.addEventListener('click', async () => {
      closeContextMenu();
      const confirmed = await customConfirm('Leave this group conversation?');
      if (!confirmed) {
        return;
      }
      try {
        await dmService.leaveConversation(conversationId);
        if (activeConversationId === conversationId) {
          activeConversationId = null;
        }
        renderConversationList();
        initDmChat();
      } catch (err) {
        customAlert('Failed to leave conversation: ' + err.message);
      }
    });
    menu.appendChild(leaveItem);
  }

  const purgeItem = document.createElement('div');
  purgeItem.className = 'dm-context-item dm-context-danger';
  purgeItem.textContent = 'Purge';
  purgeItem.addEventListener('click', async () => {
    closeContextMenu();
    const confirmed = await customConfirm('Purge this conversation? All messages will be deleted locally.');
    if (!confirmed) {
      return;
    }
    dmService.purgeConversation(conversationId);
    if (activeConversationId === conversationId) {
      activeConversationId = null;
    }
    renderConversationList();
    initDmChat();
  });
  menu.appendChild(purgeItem);

  document.body.appendChild(menu);
  _ctxMenu = menu;
}

document.addEventListener('click', closeContextMenu, true);
document.addEventListener(
  'contextmenu',
  (e) => {
    if (!e.target.closest('.dm-conv-item')) {
      closeContextMenu();
    }
  },
  true,
);

/**
 * Builds a conversation list item element.
 * @param {import('../services/dm.js').Conversation} conv
 * @param {import('../services/dm.js').DmMessage|null} lastMsg
 * @returns {HTMLElement}
 */
function buildConvItem(conv) {
  const item = document.createElement('div');
  const isActive = conv.id === activeConversationId;
  item.className = 'dm-conv-item' + (isActive ? ' active' : '');
  item.dataset.conversationId = conv.id;

  const name = conversationDisplayName(conv);

  const isGroup = conv.type === 'group';
  const icon = isGroup ? '<i class="bi bi-people-fill dm-conv-group-icon"></i> ' : '';

  item.innerHTML = `<div class="dm-conv-name">${icon}${escapeHtml(name)}</div>`;

  item.addEventListener('click', () => openConversation(conv.id));
  item.addEventListener('contextmenu', (e) => showConvContextMenu(e, conv.id));
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
      renderFriendsList();
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
      renderFriendsList();
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
  if (!list || !dmService) {
    return;
  }

  const conversations = dmService.getConversationList();
  const lastMessages = dmService.getLastMessages();

  list.innerHTML = '';

  if (conversations.length === 0) {
    list.innerHTML = '<div class="dm-empty-hint">No conversations yet.<br>Click <b>+</b> to start one, or right-click a user to send them a friend request.</div>';
    return;
  }

  const sorted = [...conversations].sort((a, b) => {
    const aTime = lastMessages.get(a.id)?.createdAt ?? a.createdAt;
    const bTime = lastMessages.get(b.id)?.createdAt ?? b.createdAt;
    return bTime - aTime;
  });

  for (const conv of sorted) {
    list.appendChild(buildConvItem(conv));
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
  if (!convList || !friendsList) {
    return;
  }

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
  if (!list || !friendsService) {
    return;
  }

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
  item.className = 'dm-conv-item dm-friend-item';
  item.dataset.fingerprint = friend.fingerprint;

  const online = friendsService?.isOnline(friend.fingerprint) ?? false;

  const avatar = document.createElement('div');
  avatar.className = 'dm-conv-avatar ' + (online ? 'online' : 'offline');
  const initials = (friend.nickname || '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
  avatar.textContent = initials;

  const nameEl = document.createElement('div');
  nameEl.className = 'dm-conv-name dm-friend-name';
  nameEl.textContent = friend.nickname;

  item.appendChild(avatar);
  item.appendChild(nameEl);
  item.addEventListener('click', () => {
    switchTab('conversations');
    const existingConv = dmService?.findDirectConversation(friend.fingerprint);
    if (existingConv) {
      openConversation(existingConv.id);
    } else {
      startDirectConversation(friend.fingerprint);
    }
  });
  return item;
}

/**
 * Creates a new direct conversation with a peer and opens it.
 * @param {string} fingerprint
 */
async function startDirectConversation(fingerprint) {
  try {
    const active = connectionManager.getActive();
    const clients = active?.clients ?? [];
    const peerClient = clients.find((c) => c.fingerprint === fingerprint);
    const publicKeyArmored = peerClient?.publicKey ?? null;
    const nickname = friendsService?.getFriend(fingerprint)?.nickname ?? fingerprint.slice(0, 12) + '…';

    const conv = await dmService.createConversation([{ fingerprint, publicKeyArmored, nickname }]);
    openConversation(conv.id);
  } catch (err) {
    customAlert('Failed to create conversation: ' + err.message);
  }
}

/**
 * Initializes the chat component for the active DM conversation.
 */
function initDmChat() {
  const container = el('dm-chat-container');
  const header = el('dm-chat-header');
  const chatMessagesEl = el('dm-chat-messages');

  if (!container) {
    return;
  }

  if (!activeConversationId) {
    if (chatMessagesEl) {
      chatMessagesEl.innerHTML = '<div class="dm-empty-hint">Select a conversation</div>';
    }
    if (header) {
      header.textContent = '';
    }
    const input = container.querySelector('.chat-input');
    const sendBtn = container.querySelector('.btn-send');
    if (input) {
      input.disabled = true;
    }
    if (sendBtn) {
      sendBtn.disabled = true;
    }
    return;
  }

  const conv = dmService?.getConversationMeta(activeConversationId);
  if (!conv) {
    activeConversationId = null;
    initDmChat();
    return;
  }

  const name = conversationDisplayName(conv);

  if (conv.type === 'direct') {
    const otherFp = conv.participants.find((p) => p.fingerprint !== dmService._fingerprint)?.fingerprint;
    const blocked = otherFp && friendsService?.isBlocked(otherFp);
    if (blocked) {
      if (header) {
        renderDmHeader(header, name, conv);
      }
      if (chatMessagesEl) {
        chatMessagesEl.innerHTML = '';
      }
      const input = container.querySelector('.chat-input');
      const sendBtn = container.querySelector('.btn-send');
      if (input) {
        input.disabled = true;
        input.placeholder = 'You have blocked this person.';
      }
      if (sendBtn) {
        sendBtn.disabled = true;
      }
      return;
    }
  }

  if (header) {
    renderDmHeader(header, name, conv);
  }

  if (dmChatProvider) {
    cleanupChat();
    dmChatProvider.destroy();
    dmChatProvider = null;
  }

  const ownNicknameKey = `gimodi:ownNickname:${dmService._fingerprint}`;
  const serverNickname = connectionManager.getCredentials(connectionManager.activeKey)?.nickname;
  if (serverNickname) {
    localStorage.setItem(ownNicknameKey, serverNickname);
  }
  const ownNickname = serverNickname || localStorage.getItem(ownNicknameKey);
  dmChatProvider = new DmChatProvider(dmService, activeConversationId, name, ownNickname);
  initChatView(null, dmChatProvider, container);
}

/**
 * Opens a conversation by its ID.
 * @param {string} conversationId
 */
function openConversation(conversationId) {
  activeConversationId = conversationId;
  renderConversationList();
  initDmChat();
}

/**
 * Shows the new conversation dialog with friend selection and optional group naming.
 */
async function showNewConversationDialog() {
  const friends = friendsService?.getFriends() ?? [];
  if (friends.length === 0) {
    customAlert('You need to add friends first before creating a conversation.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'dm-new-conv-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dm-new-conv-dialog';

  const title = document.createElement('h3');
  title.textContent = 'New Conversation';
  dialog.appendChild(title);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'dm-new-conv-search';
  searchInput.placeholder = 'Search friends...';
  dialog.appendChild(searchInput);

  const friendListEl = document.createElement('div');
  friendListEl.className = 'dm-new-conv-friends';

  const selected = new Set();

  /**
   * @param {string} [filter]
   */
  function renderFriendCheckboxes(filter = '') {
    friendListEl.innerHTML = '';
    const filtered = filter ? friends.filter((f) => f.nickname.toLowerCase().includes(filter.toLowerCase())) : friends;

    for (const friend of filtered) {
      const label = document.createElement('label');
      label.className = 'dm-new-conv-friend-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(friend.fingerprint);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selected.add(friend.fingerprint);
        } else {
          selected.delete(friend.fingerprint);
        }
        updateGroupNameVisibility();
      });

      const nameSpan = document.createElement('span');
      nameSpan.textContent = friend.nickname;

      label.appendChild(cb);
      label.appendChild(nameSpan);
      friendListEl.appendChild(label);
    }
  }

  renderFriendCheckboxes();
  searchInput.addEventListener('input', () => renderFriendCheckboxes(searchInput.value));
  dialog.appendChild(friendListEl);

  const groupNameRow = document.createElement('div');
  groupNameRow.className = 'dm-new-conv-group-name-row';
  groupNameRow.style.display = 'none';

  const groupNameLabel = document.createElement('label');
  groupNameLabel.textContent = 'Group name (optional):';
  const groupNameInput = document.createElement('input');
  groupNameInput.type = 'text';
  groupNameInput.className = 'dm-new-conv-group-name';
  groupNameInput.placeholder = 'Leave empty to use participant names';
  groupNameRow.appendChild(groupNameLabel);
  groupNameRow.appendChild(groupNameInput);
  dialog.appendChild(groupNameRow);

  function updateGroupNameVisibility() {
    groupNameRow.style.display = selected.size > 1 ? '' : 'none';
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'dm-new-conv-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'dm-new-conv-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const createBtn = document.createElement('button');
  createBtn.className = 'dm-new-conv-create';
  createBtn.textContent = 'Create';
  createBtn.addEventListener('click', async () => {
    if (selected.size === 0) {
      customAlert('Select at least one friend.');
      return;
    }

    if (selected.size === 1) {
      const fp = [...selected][0];
      const existingConv = dmService?.findDirectConversation(fp);
      if (existingConv) {
        overlay.remove();
        openConversation(existingConv.id);
        return;
      }
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const participants = [...selected].map((fp) => {
        const friend = friends.find((f) => f.fingerprint === fp);
        return {
          fingerprint: fp,
          publicKeyArmored: null,
          nickname: friend?.nickname ?? fp.slice(0, 12) + '…',
        };
      });

      const groupName = selected.size > 1 ? groupNameInput.value.trim() || null : null;
      const conv = await dmService.createConversation(participants, groupName);
      overlay.remove();
      renderConversationList();
      openConversation(conv.id);
    } catch (err) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create';
      customAlert('Failed to create conversation: ' + err.message);
    }
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(createBtn);
  dialog.appendChild(btnRow);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  searchInput.focus();
}

/**
 * Updates the service references when a new identity becomes active.
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
  activeConversationId = null;
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
  });

  dmService.addEventListener('conversation-purged', () => {
    renderConversationList();
    if (activeConversationId) {
      initDmChat();
    }
  });

  dmService.addEventListener('message-updated', () => {
    renderConversationList();
  });

  dmService.addEventListener('conversation-created', () => {
    renderConversationList();
  });

  dmService.addEventListener('conversation-invite', () => {
    renderConversationList();
  });

  dmService.addEventListener('conversations-loaded', () => {
    renderConversationList();
  });

  dmService.addEventListener('participant-changed', () => {
    renderConversationList();
    if (activeConversationId) {
      initDmChat();
    }
  });

  dmService.addEventListener('conversation-left', () => {
    renderConversationList();
    if (activeConversationId) {
      initDmChat();
    }
  });

  friendsService.addEventListener('friend:request-received', renderActiveTab);
  friendsService.addEventListener('friend:accepted', renderActiveTab);
  friendsService.addEventListener('friend:rejected', renderActiveTab);
  friendsService.addEventListener('friend:removed', renderActiveTab);
  friendsService.addEventListener('friend:presence-changed', () => {
    if (activeTab === 'friends') {
      renderFriendsList();
    }
  });

  for (const tab of document.querySelectorAll('.dm-tab')) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  const newConvBtn = el('dm-new-conversation-btn');
  if (newConvBtn) {
    newConvBtn.addEventListener('click', showNewConversationDialog);
  }

  renderConversationList();
}

/**
 * Refreshes the DM view when switching to it.
 */
export function refreshDmView() {
  renderActiveTab();
  if (activeConversationId) {
    initDmChat();
  }
}

/**
 * Opens the DM view directly to a conversation with the given fingerprint.
 * Creates a direct conversation if one doesn't exist.
 * @param {string} fingerprint
 */
export function openDmConversation(fingerprint) {
  const existing = dmService?.findDirectConversation(fingerprint);
  if (existing) {
    openConversation(existing.id);
  } else {
    startDirectConversation(fingerprint);
  }
}
