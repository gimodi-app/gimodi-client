import serverService from '../../services/server.js';
import { customAlert, customConfirm, customPrompt } from '../../services/dialogs.js';

/**
 * Escapes HTML special characters in a string to prevent XSS.
 * @param {string} str - The string to escape
 * @returns {string} The escaped HTML string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Removes any open context menu from the DOM.
 * @returns {void}
 */
function dismissContextMenu() {
  const existing = document.querySelector('.context-menu:not(#create-dropdown)');
  if (existing) {
    existing.remove();
  }
}

/**
 * Formats a Unix timestamp into a human-readable relative time string.
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Relative time string such as "5m ago" or "2d ago"
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return 'Just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Initializes column resize handles on a table element, enabling drag-to-resize columns.
 * @param {HTMLTableElement} table - The table element containing resize handles
 * @returns {void}
 */
function initUsersTableResize(table) {
  for (const th of table.querySelectorAll('th[data-col]')) {
    const handle = th.querySelector('.col-resize-handle');
    if (!handle) {
      continue;
    }

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = th.offsetWidth;

      const onMouseMove = (ev) => {
        th.style.width = Math.max(30, startWidth + (ev.clientX - startX)) + 'px';
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

/**
 * Renders the admin users panel with a searchable, sortable table of all registered users.
 * Supports bulk selection, deletion, and inline user management actions.
 * @param {HTMLElement} container - The container element to render the users panel into
 * @returns {Promise<void>}
 */
async function renderUsersPanel(container) {
  container.innerHTML = '<div style="padding:12px;color:var(--text-muted)">Loading users...</div>';

  let users;
  try {
    const result = await serverService.request('admin:list-users');
    users = result.users;
  } catch (err) {
    container.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
    return;
  }

  users.sort((a, b) => {
    if (a.online !== b.online) {
      return a.online ? -1 : 1;
    }
    return a.nickname.localeCompare(b.nickname);
  });

  const onlineCount = users.filter((u) => u.online).length;
  const selectedUserIds = new Set();

  container.style.position = 'relative';
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 12px">
      <h3 style="margin:0;font-size:14px">All Users (${users.length}, ${onlineCount} online)</h3>
    </div>
    <div style="margin:0 0 10px">
      <input type="text" class="users-search-input" placeholder="Search by nickname, role or user ID..." style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box">
    </div>
    <div class="admin-users-table-wrap" style="overflow-x:auto">
    <table class="admin-users-table" style="min-width:100%;border-collapse:collapse;table-layout:fixed">
      <thead>
        <tr style="text-align:left;color:var(--text-secondary);font-size:12px">
          <th class="checkbox-col" style="padding:6px 8px;border-bottom:1px solid var(--border);width:28px">
            <input type="checkbox" class="select-all-cb" title="Select all">
          </th>
          <th style="padding:6px 8px;border-bottom:1px solid var(--border);width:24px"></th>
          <th data-col="nickname" style="padding:6px 8px;border-bottom:1px solid var(--border);position:relative">Nickname<span class="col-resize-handle"></span></th>
          <th data-col="role" style="padding:6px 8px;border-bottom:1px solid var(--border);position:relative">Role<span class="col-resize-handle"></span></th>
          <th data-col="lastSeen" style="padding:6px 8px;border-bottom:1px solid var(--border);position:relative">Last Seen<span class="col-resize-handle"></span></th>
          <th data-col="userId" style="padding:6px 8px;border-bottom:1px solid var(--border)">User ID</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    </div>
    <div class="users-selection-bar" style="display:none;position:absolute;bottom:12px;right:12px;align-items:center;gap:8px;font-size:0.8rem;padding:8px 14px;background:var(--bg-secondary, #2a2a2a);border:1px solid var(--border);border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.3);z-index:10">
      <span class="selection-count" style="color:var(--text-muted, #888)"></span>
      <button class="btn-secondary bulk-delete-btn danger" style="padding:4px 10px;font-size:0.78rem;color:var(--danger-color, #e74c3c)"><i class="bi bi-trash"></i> Delete</button>
      <button class="btn-secondary cancel-selection-btn" style="padding:4px 10px;font-size:0.78rem">Cancel</button>
    </div>
  `;

  const tbody = container.querySelector('tbody');
  const selectionBar = container.querySelector('.users-selection-bar');
  const selectionCount = container.querySelector('.selection-count');
  const bulkDeleteBtn = container.querySelector('.bulk-delete-btn');
  const cancelSelectionBtn = container.querySelector('.cancel-selection-btn');
  const selectAllCb = container.querySelector('.select-all-cb');
  const searchInput = container.querySelector('.users-search-input');

  initUsersTableResize(container.querySelector('.admin-users-table'));

  /**
   * Filters table rows by a search query, matching against nickname, roles, and user ID.
   * @param {string} query - Search query to filter user rows by
   * @returns {void}
   */
  const filterRows = (query) => {
    const q = query.toLowerCase().trim();
    for (const row of tbody.querySelectorAll('tr[data-user-id]')) {
      const nick = row.dataset.nickname || '';
      const roles = row.dataset.roles || '';
      const uid = row.dataset.userId || '';
      const match = !q || nick.includes(q) || roles.includes(q) || uid.includes(q);
      row.style.display = match ? '' : 'none';
    }
  };

  searchInput.addEventListener('input', () => filterRows(searchInput.value));

  /**
   * Updates the selection bar UI to reflect the current number of selected users.
   * @returns {void}
   */
  const updateSelectionUI = () => {
    const count = selectedUserIds.size;
    if (count > 0) {
      selectionBar.style.display = 'flex';
      selectionCount.textContent = `${count} selected`;
    } else {
      selectionBar.style.display = 'none';
    }
    selectAllCb.checked = count === users.length && count > 0;
    selectAllCb.indeterminate = count > 0 && count < users.length;
  };

  /**
   * Clears all selected users and resets checkbox states.
   * @returns {void}
   */
  const exitSelectionMode = () => {
    selectedUserIds.clear();
    for (const cb of tbody.querySelectorAll('.user-row-cb')) {
      cb.checked = false;
    }
    updateSelectionUI();
  };

  selectAllCb.addEventListener('change', () => {
    const checked = selectAllCb.checked;
    for (const cb of tbody.querySelectorAll('.user-row-cb')) {
      cb.checked = checked;
      if (checked) {
        selectedUserIds.add(cb.dataset.userId);
      } else {
        selectedUserIds.delete(cb.dataset.userId);
      }
    }
    updateSelectionUI();
  });

  cancelSelectionBtn.addEventListener('click', exitSelectionMode);

  bulkDeleteBtn.addEventListener('click', async () => {
    const count = selectedUserIds.size;
    if (count === 0) {
      return;
    }
    if (!(await customConfirm(`Are you sure you want to permanently delete ${count} user${count > 1 ? 's' : ''}?\n\nThis will remove their identities and roles.`))) {
      return;
    }

    bulkDeleteBtn.disabled = true;
    bulkDeleteBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Deleting...';
    try {
      await serverService.request('admin:bulk-delete-users', { userIds: [...selectedUserIds] });
    } catch (err) {
      await customAlert(err.message);
    }
    renderUsersPanel(container);
  });

  if (users.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 6;
    emptyCell.style.cssText = 'padding:12px;color:var(--text-muted)';
    emptyCell.textContent = 'No registered users';
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    return;
  }

  for (const user of users) {
    const tr = document.createElement('tr');
    tr.style.cssText = '';
    tr.dataset.userId = user.userId.toLowerCase();
    tr.dataset.nickname = (user.registeredNicknames || [user.nickname]).join(' ').toLowerCase();
    tr.dataset.roles = user.roles
      .map((r) => r.name)
      .join(', ')
      .toLowerCase();
    tr.addEventListener('contextmenu', (e) => showAdminUserContextMenu(e, user, container));
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input')) {
        return;
      }
      showUserDetailModal(user);
    });

    const cbTd = document.createElement('td');
    cbTd.style.cssText = 'padding:6px 8px;text-align:center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'user-row-cb';
    cb.dataset.userId = user.userId;
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) {
        selectedUserIds.add(user.userId);
      } else {
        selectedUserIds.delete(user.userId);
      }
      updateSelectionUI();
    });
    cbTd.appendChild(cb);
    tr.appendChild(cbTd);

    const statusTd = document.createElement('td');
    statusTd.style.cssText = 'padding:6px 8px;text-align:center';
    statusTd.innerHTML = user.online ? '<span style="color:#4caf50;font-size:10px" title="Online">●</span>' : '<span style="color:#888;font-size:10px" title="Offline">●</span>';
    tr.appendChild(statusTd);

    const nickTd = document.createElement('td');
    nickTd.style.cssText = 'padding:6px 8px';
    const nicks = user.registeredNicknames && user.registeredNicknames.length > 0 ? user.registeredNicknames : [user.nickname];
    nickTd.textContent = nicks[0];
    if (nicks.length > 1) {
      const extra = document.createElement('span');
      extra.style.cssText = 'margin-left:6px;font-size:11px;color:var(--text-muted)';
      extra.textContent = nicks
        .slice(1)
        .map((n) => n)
        .join(', ');
      nickTd.appendChild(extra);
    }
    tr.appendChild(nickTd);

    const roleTd = document.createElement('td');
    roleTd.style.cssText = 'padding:6px 8px;font-size:12px;color:var(--text-secondary)';
    roleTd.textContent = user.roles.length > 0 ? user.roles.map((r) => r.name).join(', ') : '-';
    tr.appendChild(roleTd);

    const seenTd = document.createElement('td');
    seenTd.style.cssText = 'padding:6px 8px;font-size:12px;color:var(--text-secondary)';
    if (user.online) {
      seenTd.textContent = 'Now';
      seenTd.style.color = '#4caf50';
    } else if (user.lastSeenAt) {
      const ago = formatTimeAgo(user.lastSeenAt);
      seenTd.textContent = ago;
      seenTd.title = new Date(user.lastSeenAt).toLocaleString();
    } else {
      seenTd.textContent = '-';
    }
    tr.appendChild(seenTd);

    const idTd = document.createElement('td');
    idTd.style.cssText = 'padding:6px 8px;font-family:monospace;font-size:12px';
    idTd.textContent = user.userId.slice(0, 8) + '...';
    idTd.title = user.userId;
    tr.appendChild(idTd);

    tbody.appendChild(tr);
  }
}

/**
 * Displays a modal with detailed information about a specific user.
 * @param {object} user - The user object containing nickname, userId, roles, online status, etc.
 * @returns {void}
 */
function showUserDetailModal(user) {
  const existing = document.querySelector('.modal-user-detail');
  if (existing) {
    existing.remove();
  }

  const nicks = user.registeredNicknames && user.registeredNicknames.length > 0 ? user.registeredNicknames.join(', ') : user.nickname;
  const roles = user.roles.length > 0 ? user.roles.map((r) => r.name).join(', ') : '-';
  const status = user.online ? 'Online' : 'Offline';
  const lastSeen = user.online ? 'Now' : user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : '-';
  const created = user.createdAt ? new Date(user.createdAt).toLocaleString() : '-';

  const rows = [
    ['Nickname', user.nickname],
    ['Registered Nicknames', nicks],
    ['User ID', user.userId],
    ['Status', status],
    ['Roles', roles],
    ['Last Seen', lastSeen],
    ['Created', created],
  ];

  const modal = document.createElement('div');
  modal.className = 'modal modal-user-detail';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:450px">
      <h3 style="margin:0 0 16px">User Details - ${escapeHtml(user.nickname)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${rows
          .map(
            ([label, value]) => `
          <tr>
            <td style="padding:5px 10px 5px 0;color:var(--text-muted);white-space:nowrap;vertical-align:top;font-weight:600">${escapeHtml(label)}</td>
            <td style="padding:5px 0;word-break:break-all;user-select:text">${escapeHtml(value)}</td>
          </tr>
        `,
          )
          .join('')}
      </table>
      <div class="modal-buttons" style="margin-top:16px">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

/**
 * Displays a context menu with admin actions for a user in the admin users panel.
 * Actions include copying user ID, poking, setting roles, managing nicknames,
 * kicking, banning, and deleting the user.
 * @param {MouseEvent} e - The contextmenu event
 * @param {object} user - The user object
 * @param {HTMLElement} panelContainer - The panel container for re-rendering after actions
 * @returns {void}
 */
function showAdminUserContextMenu(e, user, panelContainer) {
  e.preventDefault();
  dismissContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  /**
   * Adds a non-interactive label element to the context menu.
   * @param {string} text - The label text
   * @returns {void}
   */
  const addLabel = (text) => {
    const label = document.createElement('div');
    label.className = 'context-menu-label';
    label.textContent = text;
    menu.appendChild(label);
  };

  /**
   * Adds a clickable item to the context menu.
   * @param {string} text - The menu item text
   * @param {function} handler - The click handler
   * @param {{ danger?: boolean }} [opts] - Options for styling
   * @returns {void}
   */
  const addItem = (text, handler, opts = {}) => {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (opts.danger ? ' danger' : '');
    item.textContent = text;
    item.addEventListener('click', async () => {
      dismissContextMenu();
      await handler();
    });
    menu.appendChild(item);
  };

  /**
   * Adds a visual separator line to the context menu.
   * @returns {void}
   */
  const addSeparator = () => {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);
  };

  addItem('Copy User ID', () => navigator.clipboard.writeText(user.userId));

  if (user.online && user.clientId) {
    addSeparator();
    addLabel('Communication');

    if (serverService.hasPermission('user.poke')) {
      addItem('Poke', async () => {
        const message = await customPrompt(`Poke message for ${user.nickname} (optional):`);
        if (message === null) {
          return;
        }
        try {
          await serverService.request('admin:poke', { clientId: user.clientId, message });
        } catch (err) {
          await customAlert(err.message);
        }
      });
    }
  }

  const hasManagement = serverService.hasPermission('user.assign_role') || (serverService.hasPermission('user.ban') && user.registeredNicknames?.length > 0);

  if (hasManagement) {
    addSeparator();
    addLabel('Management');

    if (serverService.hasPermission('user.assign_role')) {
      addItem('Set Role...', () => showSetRoleMenuByUserId(user, e.clientX, e.clientY, panelContainer));
    }

    if (serverService.hasPermission('user.ban') && user.registeredNicknames?.length > 0) {
      addItem('Manage Nicknames...', () => showManageNicknamesModal(user, panelContainer));
    }
  }

  const hasDangerActions = (user.online && user.clientId && serverService.hasPermission('user.kick')) || serverService.hasPermission('user.ban');

  if (hasDangerActions) {
    addSeparator();
    addLabel('Danger Zone');

    if (user.online && user.clientId && serverService.hasPermission('user.kick')) {
      addItem(
        'Kick',
        async () => {
          try {
            await serverService.request('admin:kick', { clientId: user.clientId });
            renderUsersPanel(panelContainer);
          } catch (err) {
            await customAlert(err.message);
          }
        },
        { danger: true },
      );
    }

    if (serverService.hasPermission('user.ban')) {
      addItem('Ban User', () => showBanByUserIdModal(user, panelContainer), { danger: true });

      addItem(
        'Delete User',
        async () => {
          if (!(await customConfirm(`Are you sure you want to permanently delete user "${user.nickname}"?\n\nThis will remove their identity, roles, and all registered nicknames.`))) {
            return;
          }
          try {
            await serverService.request('admin:delete-user', { userId: user.userId });
            renderUsersPanel(panelContainer);
          } catch (err) {
            await customAlert(err.message);
          }
        },
        { danger: true },
      );
    }
  }

  document.body.appendChild(menu);

  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      dismissContextMenu();
      document.removeEventListener('click', onClickOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);

  const onEscape = (ev) => {
    if (ev.key === 'Escape') {
      dismissContextMenu();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

/**
 * Displays a modal for managing a user's registered nicknames, allowing
 * adding new nicknames and deleting existing ones.
 * @param {object} user - The user object with registeredNicknames array
 * @param {HTMLElement} panelContainer - The panel container for re-rendering after changes
 * @returns {Promise<void>}
 */
async function showManageNicknamesModal(user, panelContainer) {
  const existing = document.querySelector('.modal-manage-nicknames');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-nicknames';

  /**
   * Re-renders the nickname list inside the modal.
   * @returns {void}
   */
  const renderList = () => {
    const nicks = user.registeredNicknames || [];
    const list = modal.querySelector('.nickname-list');
    list.innerHTML = '';

    if (nicks.length === 0) {
      list.innerHTML = '<div style="padding:8px;color:var(--text-muted)">No registered nicknames</div>';
      return;
    }

    for (const nick of nicks) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid var(--border)';

      const label = document.createElement('span');
      label.textContent = nick;
      row.appendChild(label);

      if (nicks.length > 1) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-secondary danger';
        delBtn.style.cssText = 'padding:2px 8px;font-size:12px;color:var(--danger-color, #e74c3c)';
        delBtn.innerHTML = '<i class="bi bi-trash"></i>';
        delBtn.title = 'Delete this nickname';
        delBtn.addEventListener('click', async () => {
          if (!(await customConfirm(`Delete nickname "${nick}" from this user?\n\nThis will free the nickname for others to use.`))) {
            return;
          }
          try {
            await serverService.request('admin:delete-nickname', { userId: user.userId, nickname: nick });
            user.registeredNicknames = user.registeredNicknames.filter((n) => n.toLowerCase() !== nick.toLowerCase());
            renderList();
            renderUsersPanel(panelContainer);
          } catch (err) {
            await customAlert(err.message);
          }
        });
        row.appendChild(delBtn);
      }

      list.appendChild(row);
    }
  };

  modal.innerHTML = `
    <div class="modal-content" style="max-width:400px">
      <h3 style="margin:0 0 12px">Registered Nicknames - ${escapeHtml(user.nickname)}</h3>
      <div class="nickname-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:4px"></div>
      <div class="add-nickname-row" style="display:flex;gap:8px;margin-top:12px">
        <input type="text" class="add-nickname-input" placeholder="Add nickname..." maxlength="32" style="flex:1;min-width:0;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--text-color);font-size:13px">
        <button class="btn-secondary add-nickname-btn" style="padding:4px 10px;font-size:12px;white-space:nowrap;flex-shrink:0"><i class="bi bi-plus-lg"></i></button>
      </div>
      <div class="add-nickname-error" style="color:var(--danger-color, #e74c3c);font-size:12px;margin-top:4px;display:none"></div>
      <div class="modal-buttons" style="margin-top:12px">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  renderList();

  const addInput = modal.querySelector('.add-nickname-input');
  const addBtn = modal.querySelector('.add-nickname-btn');
  const addError = modal.querySelector('.add-nickname-error');

  /**
   * Adds a new nickname to the user via server request and updates the UI.
   * @returns {Promise<void>}
   */
  const addNickname = async () => {
    const nick = addInput.value.trim();
    if (!nick) {
      return;
    }
    addError.style.display = 'none';
    try {
      await serverService.request('admin:add-nickname', { userId: user.userId, nickname: nick });
      if (!user.registeredNicknames) {
        user.registeredNicknames = [];
      }
      user.registeredNicknames.push(nick);
      addInput.value = '';
      renderList();
      renderUsersPanel(panelContainer);
    } catch (err) {
      addError.textContent = err.message;
      addError.style.display = 'block';
    }
  };

  addBtn.addEventListener('click', addNickname);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addNickname();
    }
  });

  modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

/**
 * Displays a context menu for assigning or removing a role from a user by their userId.
 * Shows all available roles with the current role indicated.
 * @param {object} user - The user object
 * @param {number} x - The X coordinate for menu positioning
 * @param {number} y - The Y coordinate for menu positioning
 * @param {HTMLElement} panelContainer - The panel container for re-rendering after changes
 * @returns {Promise<void>}
 */
async function showSetRoleMenuByUserId(user, x, y, panelContainer) {
  let result;
  try {
    result = await serverService.request('admin:get-user-roles-by-userid', { userId: user.userId });
  } catch (err) {
    await customAlert(err.message);
    return;
  }

  document.querySelectorAll('.context-menu').forEach((m) => m.remove());

  const submenu = document.createElement('div');
  submenu.className = 'context-menu';
  submenu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10001;min-width:180px`;

  const currentRole = result.roles[0] || null;

  /**
   * Adds a role row to the submenu with toggle behavior.
   * @param {string} roleId - The role ID
   * @param {string} roleName - The display name of the role
   * @param {boolean} isActive - Whether this role is currently assigned
   * @returns {void}
   */
  const addRoleRow = (roleId, roleName, isActive) => {
    const row = document.createElement('div');
    row.className = 'context-menu-item';
    row.style.cssText = 'display:flex;align-items:center;gap:8px';

    const dot = document.createElement('span');
    dot.style.cssText = 'width:14px;text-align:center;font-size:12px';
    dot.textContent = isActive ? '●' : '○';

    const label = document.createElement('span');
    label.textContent = roleName;

    row.append(dot, label);
    row.addEventListener('click', async () => {
      submenu.remove();
      try {
        if (isActive) {
          await serverService.request('admin:remove-role-by-userid', { userId: user.userId, roleId });
        } else {
          await serverService.request('admin:assign-role-by-userid', { userId: user.userId, roleId });
        }
        renderUsersPanel(panelContainer);
      } catch (err) {
        await customAlert(err.message);
      }
    });
    submenu.appendChild(row);
  };

  const noneRow = document.createElement('div');
  noneRow.className = 'context-menu-item' + (!currentRole ? ' disabled' : '');
  noneRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  if (!currentRole) {
    noneRow.style.opacity = '0.5';
  }
  const noneDot = document.createElement('span');
  noneDot.style.cssText = 'width:14px;text-align:center;font-size:12px';
  noneDot.textContent = currentRole ? '○' : '●';
  const noneLabel = document.createElement('span');
  noneLabel.textContent = 'None';
  noneRow.append(noneDot, noneLabel);
  if (currentRole) {
    noneRow.addEventListener('click', async () => {
      submenu.remove();
      try {
        await serverService.request('admin:remove-role-by-userid', { userId: user.userId, roleId: currentRole.id });
        renderUsersPanel(panelContainer);
      } catch (err) {
        await customAlert(err.message);
      }
    });
  }
  submenu.appendChild(noneRow);

  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid var(--border);margin:4px 0';
  submenu.appendChild(sep);

  for (const role of result.allRoles) {
    addRoleRow(role.id, role.name, currentRole?.id === role.id);
  }

  document.body.appendChild(submenu);

  const removeSubmenu = (ev) => {
    if (!submenu.contains(ev.target)) {
      submenu.remove();
      document.removeEventListener('mousedown', removeSubmenu);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', removeSubmenu), 0);
}

/**
 * Displays a modal for banning a user by their userId, with reason and duration options.
 * @param {object} user - The user object to ban
 * @param {HTMLElement} panelContainer - The panel container for re-rendering after banning
 * @returns {void}
 */
function showBanByUserIdModal(user, panelContainer) {
  const existing = document.querySelector('.modal-ban-user');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-ban-user';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Ban ${escapeHtml(user.nickname)}</h2>
      <div class="form-group">
        <label>Reason (optional)</label>
        <input type="text" class="ban-reason" placeholder="Reason for ban">
      </div>
      <div class="form-group">
        <label>Duration</label>
        <select class="ban-duration">
          <option value="3600">1 hour</option>
          <option value="86400">24 hours</option>
          <option value="604800">7 days</option>
          <option value="2592000">30 days</option>
          <option value="0">Permanent</option>
        </select>
      </div>
      <div class="modal-buttons">
        <button class="btn-primary modal-ban-btn" style="background: var(--danger);">Ban</button>
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const reasonInput = modal.querySelector('.ban-reason');
  const durationSelect = modal.querySelector('.ban-duration');
  reasonInput.focus();

  /**
   * Closes the ban modal and removes the escape key listener.
   * @returns {void}
   */
  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  /**
   * Sends the ban request to the server and refreshes the users panel on success.
   * @returns {Promise<void>}
   */
  const confirmBan = async () => {
    const reason = reasonInput.value.trim();
    const duration = parseInt(durationSelect.value);
    try {
      await serverService.request('admin:ban-user', { userId: user.userId, reason, duration });
      closeModal();
      renderUsersPanel(panelContainer);
    } catch (err) {
      await customAlert(err.message);
    }
  };

  modal.querySelector('.modal-ban-btn').addEventListener('click', confirmBan);
  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  /**
   * Handles keyboard events for closing or confirming the ban modal.
   * @param {KeyboardEvent} e - The keyboard event
   * @returns {void}
   */
  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
    if (e.key === 'Enter' && (e.target === reasonInput || e.target === durationSelect)) {
      confirmBan();
    }
  };
  document.addEventListener('keydown', onEscape);
}

/**
 * Displays a standalone modal containing the admin users panel for listing
 * and managing all registered users.
 * @returns {void}
 */
function showListUsersModal() {
  const existing = document.querySelector('.modal-list-users');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-list-users';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:550px">
      <div class="users-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  renderUsersPanel(modal.querySelector('.users-panel-container'));

  /**
   * Closes the list users modal.
   * @returns {void}
   */
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  /**
   * Handles the Escape key to close the modal.
   * @param {KeyboardEvent} e - The keyboard event
   * @returns {void}
   */
  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', onEscape);
    }
  };
  document.addEventListener('keydown', onEscape);
}

export { renderUsersPanel, showListUsersModal, showUserDetailModal, showAdminUserContextMenu };
