import serverService from '../services/server.js';
import { customConfirm, customPrompt } from '../services/dialogs.js';

let friendsList = [];
let dmModeActive = false;
let channelSection = null;
let friendsContainer = null;
let serverLayout = null;
let activeFriendUserId = null;

/**
 * Initializes the friends view and wires up the DM button.
 */
export function initFriendsView() {
  channelSection = document.querySelector('.sidebar-section');
  serverLayout = document.querySelector('.server-layout');
  createFriendsContainer();

  const dmBtn = document.getElementById('btn-dm');
  if (dmBtn) {
    dmBtn.addEventListener('click', toggleDmMode);
  }

  window.addEventListener('gimodi:friends-updated', () => loadFriends());
  window.addEventListener('gimodi:open-dm', (e) => {
    activeFriendUserId = e.detail.userId;
    renderFriendsList();
  });

  loadFriends();
}

/**
 * Creates the friends list container element and inserts it into the sidebar.
 */
function createFriendsContainer() {
  friendsContainer = document.createElement('div');
  friendsContainer.id = 'friends-list-section';
  friendsContainer.className = 'sidebar-section hidden';

  const header = document.createElement('div');
  header.className = 'sidebar-section-header';
  const headerSpan = document.createElement('span');
  headerSpan.textContent = 'Friends';
  header.appendChild(headerSpan);
  friendsContainer.appendChild(header);

  const listEl = document.createElement('div');
  listEl.id = 'friends-list';
  friendsContainer.appendChild(listEl);

  channelSection.parentNode.insertBefore(friendsContainer, channelSection.nextSibling);
}

/**
 * Loads friends from persistent storage.
 */
async function loadFriends() {
  friendsList = await window.gimodi.friends.list();
  if (dmModeActive) {
    renderFriendsList();
  }
}

/**
 * Toggles between friends mode and server mode.
 */
function toggleDmMode() {
  if (dmModeActive) {
    exitFriendsMode();
  } else {
    enterFriendsMode();
  }
}

/**
 * Enters friends mode - shows friends list and hides server UI.
 */
export function enterFriendsMode() {
  dmModeActive = true;
  const dmBtn = document.getElementById('btn-dm');
  if (dmBtn) {
    dmBtn.classList.add('active');
  }

  serverLayout.classList.add('friends-mode');
  renderFriendsList();

  window.dispatchEvent(new CustomEvent('gimodi:friends-mode-changed', { detail: { active: true } }));
}

/**
 * Exits friends mode - restores server UI.
 */
export function exitFriendsMode() {
  if (!dmModeActive) {
    return;
  }
  dmModeActive = false;
  activeFriendUserId = null;

  const dmBtn = document.getElementById('btn-dm');
  if (dmBtn) {
    dmBtn.classList.remove('active');
  }

  serverLayout.classList.remove('friends-mode');

  window.dispatchEvent(new CustomEvent('gimodi:friends-mode-changed', { detail: { active: false } }));
}

/**
 * Renders the friends list in the sidebar.
 */
function renderFriendsList() {
  const listEl = document.getElementById('friends-list');
  if (!listEl) {
    return;
  }
  listEl.innerHTML = '';

  if (friendsList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'friends-empty';
    empty.textContent = 'No friends yet. Right-click a user to add them.';
    listEl.appendChild(empty);
    return;
  }

  const connectedClients = serverService.connected ? getConnectedUserIds() : new Set();

  for (const friend of friendsList) {
    const entry = document.createElement('div');
    entry.className = 'friends-entry' + (activeFriendUserId === friend.userId ? ' active' : '');

    const indicator = document.createElement('span');
    indicator.className = 'friends-online-indicator ' + (connectedClients.has(friend.userId) ? 'online' : 'offline');
    entry.appendChild(indicator);

    const name = document.createElement('span');
    name.className = 'friends-name';
    name.textContent = friend.displayName;
    entry.appendChild(name);

    const server = document.createElement('span');
    server.className = 'friends-server';
    server.textContent = friend.serverAddress;
    entry.appendChild(server);

    entry.addEventListener('click', () => {
      activeFriendUserId = friend.userId;
      renderFriendsList();
      window.dispatchEvent(new CustomEvent('gimodi:open-dm', { detail: { userId: friend.userId, displayName: friend.displayName } }));
    });

    entry.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFriendContextMenu(e, friend);
    });

    listEl.appendChild(entry);
  }
}

/**
 * Returns a Set of userIds currently connected to the active server.
 * @returns {Set<string>}
 */
function getConnectedUserIds() {
  const ids = new Set();
  const clients = serverService.clients;
  if (clients) {
    for (const c of clients) {
      if (c.userId) {
        ids.add(c.userId);
      }
    }
  }
  return ids;
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
      await window.gimodi.friends.update(friend.userId, { displayName: newName });
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
      await window.gimodi.friends.remove(friend.userId);
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
 * Cleans up the friends view state.
 */
export function cleanup() {
  dmModeActive = false;
  activeFriendUserId = null;
  const dmBtn = document.getElementById('btn-dm');
  if (dmBtn) {
    dmBtn.classList.remove('active');
  }
  if (serverLayout) {
    serverLayout.classList.remove('friends-mode');
  }
}

/**
 * Returns whether DM mode is currently active.
 * @returns {boolean}
 */
export function isDmModeActive() {
  return dmModeActive;
}
