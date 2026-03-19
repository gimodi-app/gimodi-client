import serverService from '../services/server.js';
import { customAlert, customConfirm, customPrompt } from '../services/dialogs.js';
import { getClients } from './server.js';

/**
 * Renders the roles management panel inside the given container element.
 * Sets up the full roles UI including sidebar, detail pane, and initializes all logic.
 * @param {HTMLElement} container - The container element to render the roles panel into
 * @returns {Promise<void>}
 */
async function renderRolesPanel(container) {
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;';
  container.innerHTML = `
    <div style="display:flex;flex:1;min-height:0">
      <div class="roles-sidebar" style="width:220px;border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0">
        <div style="padding:12px 12px 8px;font-weight:600;font-size:13px;border-bottom:1px solid var(--border)">Roles</div>
        <div class="roles-list" style="flex:1;overflow-y:auto"></div>
        <div style="display:flex;border-top:1px solid var(--border);padding:6px">
          <button class="btn-icon roles-add-btn" title="Add role" style="flex:1;font-size:18px;line-height:1">+</button>
          <button class="btn-icon roles-remove-btn" title="Remove role" style="flex:1;font-size:18px;line-height:1">\u2212</button>
        </div>
      </div>
      <div class="roles-resize-handle" style="width:4px;cursor:col-resize;flex-shrink:0;background:transparent;transition:background 0.15s"></div>
      <div class="roles-detail" style="flex:1;display:flex;flex-direction:column;min-width:0">
        <div class="roles-detail-empty" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px">
          Select a role to edit its permissions
        </div>
        <div class="roles-detail-content" style="display:none;flex:1;flex-direction:column;min-height:0">
          <div style="padding:12px 16px 8px;border-bottom:1px solid var(--border)">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
              <div style="width:36px">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Color</label>
                <div class="roles-color-swatch" style="width:36px;height:28px;border-radius:6px;border:2px solid var(--border);cursor:pointer;background:#FFD700;transition:border-color 0.15s" title="Pick color"></div>
                <input class="roles-color-input" type="color" value="#FFD700" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none">
              </div>
              <div style="flex:1">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Role Name</label>
                <input class="roles-name-input" type="text" style="width:100%;box-sizing:border-box">
              </div>
              <div style="width:120px">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px">Badge Text</label>
                <input class="roles-badge-input" type="text" placeholder="(none)" style="width:100%;box-sizing:border-box">
              </div>
            </div>
          </div>
          <div style="display:flex;flex:1;min-height:0">
            <div class="roles-perms-list" style="width:280px;flex-shrink:0;overflow-y:auto;padding:8px 16px"></div>
            <div class="roles-perms-resize-handle" style="width:5px;cursor:col-resize;background:var(--border);flex-shrink:0;transition:background 0.15s"></div>
            <div class="roles-members-section" style="flex:1;border-left:none;display:flex;flex-direction:column;overflow:hidden">
              <div style="font-size:11px;color:var(--text-muted);padding:8px 12px 6px">Members</div>
              <div class="roles-members-list" style="flex:1;overflow-y:auto;padding:0 12px 8px"></div>
            </div>
          </div>
          <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">
            <button class="btn-secondary roles-cancel-btn">Cancel</button>
            <button class="btn-primary roles-save-btn">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  _initRolesLogic(container);
}

/**
 * Initializes all interactive logic for the roles panel, including role selection,
 * drag-and-drop reordering, permission editing, member management, and CRUD operations.
 * @param {HTMLElement} root - The root container element of the roles panel
 * @returns {Promise<void>}
 */
async function _initRolesLogic(root) {
  const rolesList = root.querySelector('.roles-list');
  const rolesDetailEmpty = root.querySelector('.roles-detail-empty');
  const rolesDetailContent = root.querySelector('.roles-detail-content');
  const nameInput = root.querySelector('.roles-name-input');
  const badgeInput = root.querySelector('.roles-badge-input');
  const colorInput = root.querySelector('.roles-color-input');
  const colorSwatch = root.querySelector('.roles-color-swatch');

  colorSwatch.addEventListener('click', () => colorInput.click());
  colorInput.addEventListener('input', () => {
    colorSwatch.style.background = colorInput.value;
  });
  colorSwatch.addEventListener('mouseenter', () => {
    colorSwatch.style.borderColor = 'var(--text-muted)';
  });
  colorSwatch.addEventListener('mouseleave', () => {
    colorSwatch.style.borderColor = 'var(--border)';
  });

  const rolesSidebar = root.querySelector('.roles-sidebar');
  const resizeHandle = root.querySelector('.roles-resize-handle');
  const savedWidth = (await window.gimodi.settings.load())?.rolesSidebarWidth;
  if (savedWidth) {
    rolesSidebar.style.width = savedWidth + 'px';
  }

  resizeHandle.addEventListener('mouseenter', () => {
    resizeHandle.style.background = 'var(--border)';
  });
  resizeHandle.addEventListener('mouseleave', () => {
    if (!resizeHandle._dragging) {
      resizeHandle.style.background = 'transparent';
    }
  });
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizeHandle._dragging = true;
    resizeHandle.style.background = 'var(--accent)';
    const startX = e.clientX;
    const startW = rolesSidebar.offsetWidth;
    const onMove = (ev) => {
      const w = Math.max(140, Math.min(400, startW + ev.clientX - startX));
      rolesSidebar.style.width = w + 'px';
    };
    const onUp = async () => {
      resizeHandle._dragging = false;
      resizeHandle.style.background = 'transparent';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const settings = (await window.gimodi.settings.load()) || {};
      settings.rolesSidebarWidth = rolesSidebar.offsetWidth;
      window.gimodi.settings.save(settings);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  const membersContainer = root.querySelector('.roles-members-list');
  const membersSection = root.querySelector('.roles-members-section');
  const permsContainer = root.querySelector('.roles-perms-list');

  const permsResizeHandle = root.querySelector('.roles-perms-resize-handle');
  const savedPermsWidth = (await window.gimodi.settings.load())?.rolesPermsWidth;
  if (savedPermsWidth) {
    permsContainer.style.width = savedPermsWidth + 'px';
  }

  permsResizeHandle.addEventListener('mouseenter', () => {
    permsResizeHandle.style.background = 'var(--accent)';
  });
  permsResizeHandle.addEventListener('mouseleave', () => {
    if (!permsResizeHandle._dragging) {
      permsResizeHandle.style.background = 'var(--border)';
    }
  });
  permsResizeHandle.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    permsResizeHandle._dragging = true;
    permsResizeHandle.style.background = 'var(--accent)';
    const startX = ev.clientX;
    const startWidth = permsContainer.offsetWidth;
    const onMove = (me) => {
      const parentWidth = permsContainer.parentElement.offsetWidth - permsResizeHandle.offsetWidth;
      const maxWidth = parentWidth - 150;
      const newWidth = Math.max(150, Math.min(maxWidth, startWidth + me.clientX - startX));
      permsContainer.style.width = newWidth + 'px';
    };
    const onUp = async () => {
      permsResizeHandle._dragging = false;
      permsResizeHandle.style.background = 'var(--border)';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const settings = (await window.gimodi.settings.load()) || {};
      settings.rolesPermsWidth = permsContainer.offsetWidth;
      window.gimodi.settings.save(settings);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  let roles = [];
  let availablePermissions = [];
  let permissionGroups = [];
  let selectedRoleId = null;
  let pendingPerms = new Set();
  let draggedRoleId = null;

  /**
   * Renders the list of roles in the sidebar, including drag-and-drop reordering support.
   * @returns {void}
   */
  const renderRolesList = () => {
    rolesList.innerHTML = '';
    for (const role of roles) {
      const item = document.createElement('div');
      item.className = 'roles-list-item';
      item.dataset.roleId = role.id;
      item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:13px;user-select:none;display:flex;align-items:center;gap:6px';
      if (role.id === selectedRoleId) {
        item.style.background = '#232323';
        item.style.color = '#fff';
      }

      if (role.id !== 'admin') {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
          draggedRoleId = role.id;
          e.dataTransfer.effectAllowed = 'move';
          item.style.opacity = '0.4';
        });
        item.addEventListener('dragend', () => {
          draggedRoleId = null;
          item.style.opacity = '';
          rolesList.querySelectorAll('.roles-list-item').forEach((el) => {
            el.style.borderTop = '';
            el.style.borderBottom = '';
          });
        });
      }

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedRoleId || draggedRoleId === role.id) {
          return;
        }
        if (role.id === 'admin') {
          return;
        }
        e.dataTransfer.dropEffect = 'move';
        rolesList.querySelectorAll('.roles-list-item').forEach((el) => {
          el.style.borderTop = '';
          el.style.borderBottom = '';
        });
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          item.style.borderTop = '2px solid var(--accent, #5865f2)';
        } else {
          item.style.borderBottom = '2px solid var(--accent, #5865f2)';
        }
      });

      item.addEventListener('dragleave', () => {
        item.style.borderTop = '';
        item.style.borderBottom = '';
      });

      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.style.borderTop = '';
        item.style.borderBottom = '';
        if (!draggedRoleId || draggedRoleId === role.id) {
          return;
        }
        if (role.id === 'admin') {
          return;
        }

        const fromIdx = roles.findIndex((r) => r.id === draggedRoleId);
        if (fromIdx < 0) {
          return;
        }
        const [moved] = roles.splice(fromIdx, 1);
        let toIdx = roles.findIndex((r) => r.id === role.id);
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY >= mid) {
          toIdx++;
        }
        if (toIdx < 1) {
          toIdx = 1;
        }
        roles.splice(toIdx, 0, moved);

        for (let i = 0; i < roles.length; i++) {
          roles[i].position = i;
        }
        renderRolesList();

        try {
          await serverService.request('role:reorder', { order: roles.map((r) => r.id) });
        } catch (err) {
          await customAlert(err.message);
        }
      });

      if (role.color) {
        const dot = document.createElement('span');
        dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${role.color};flex-shrink:0`;
        item.appendChild(dot);
      }
      const nameSpan = document.createElement('span');
      nameSpan.style.flex = '1';
      nameSpan.textContent = role.name;
      item.appendChild(nameSpan);
      if (role.badge) {
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.2)';
        badge.textContent = role.badge;
        item.appendChild(badge);
      }
      if (role.id === 'admin' || role.id === 'user') {
        const defaultTag = document.createElement('span');
        defaultTag.style.cssText = 'font-size:9px;padding:1px 4px;border-radius:3px;background:var(--bg-tertiary);color:var(--text-secondary);border:1px solid var(--border)';
        defaultTag.textContent = 'default';
        item.appendChild(defaultTag);
      }

      item.addEventListener('click', () => selectRole(role.id));

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showRoleContextMenu(e.clientX, e.clientY, role);
      });

      rolesList.appendChild(item);
    }
  };

  /**
   * Selects a role by ID and displays its details in the detail pane.
   * @param {string} roleId - The ID of the role to select
   * @returns {void}
   */
  const selectRole = (roleId) => {
    selectedRoleId = roleId;
    renderRolesList();

    const role = roles.find((r) => r.id === roleId);
    if (!role) {
      rolesDetailEmpty.style.display = 'flex';
      rolesDetailContent.style.display = 'none';
      return;
    }

    rolesDetailEmpty.style.display = 'none';
    rolesDetailContent.style.display = 'flex';

    const isStatic = role.id === 'admin' || role.id === 'user';
    nameInput.value = role.name;
    nameInput.disabled = isStatic;
    badgeInput.value = role.badge || '';
    colorInput.value = role.color || '#FFD700';
    colorSwatch.style.background = colorInput.value;
    pendingPerms = new Set(role.permissions || []);

    renderPerms(role.id === 'admin');

    if (role.id === 'user') {
      membersSection.style.display = 'none';
    } else {
      membersSection.style.display = '';
      loadMembers(roleId);
    }
  };

  /**
   * Loads the members of a role from the server and renders them.
   * @param {string} roleId - The ID of the role whose members to load
   * @returns {Promise<void>}
   */
  const loadMembers = async (roleId) => {
    membersContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Loading...</span>';
    try {
      const result = await serverService.request('role:get-members', { roleId });
      if (selectedRoleId !== roleId) {
        return;
      }
      renderMembers(result.members, roleId);
    } catch {
      membersContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Failed to load members</span>';
    }
  };

  /**
   * Renders the list of role members with remove buttons.
   * @param {Array<{name: string, fingerprint: string, user_id: string}>} members - The member objects to render
   * @param {string} roleId - The ID of the role these members belong to
   * @returns {void}
   */
  const renderMembers = (members, roleId) => {
    membersContainer.innerHTML = '';
    if (!members.length) {
      membersContainer.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">No members</span>';
      return;
    }
    const nameCounts = {};
    for (const m of members) {
      nameCounts[m.name] = (nameCounts[m.name] || 0) + 1;
    }
    for (const member of members) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px';

      const name = document.createElement('span');
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const fpShort = member.fingerprint ? member.fingerprint.slice(0, 8) : null;
      if (nameCounts[member.name] > 1 && fpShort) {
        name.textContent = `${member.name} [${fpShort}]`;
        name.title = `Fingerprint: ${member.fingerprint}`;
      } else {
        name.textContent = member.name;
        if (fpShort) {
          name.title = `Fingerprint: ${member.fingerprint}`;
        }
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-secondary';
      removeBtn.style.cssText = 'padding:1px 6px;font-size:11px;flex-shrink:0';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        const clients = getClients();
        const connectedClient = clients.find((c) => c.userId === member.user_id);
        if (connectedClient) {
          try {
            await serverService.request('admin:remove-role', { clientId: connectedClient.id, roleId });
          } catch (err) {
            await customAlert(err.message);
            return;
          }
        } else {
          try {
            await serverService.request('role:remove-member', { userId: member.user_id, roleId });
          } catch (err) {
            await customAlert(err.message);
            return;
          }
        }
        loadMembers(roleId);
      });

      row.append(name, removeBtn);
      membersContainer.appendChild(row);
    }
  };

  const collapsedGroups = new Set();

  let permsSearchValue = '';

  /**
   * Renders the permissions list with grouped checkboxes and search filtering.
   * @param {boolean} readOnly - Whether the permissions should be displayed as read-only
   * @returns {void}
   */
  const renderPerms = (readOnly = false) => {
    permsContainer.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'roles-perms-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'roles-perms-search';
    searchInput.placeholder = 'Search permissions...';
    searchInput.value = permsSearchValue;
    const clearBtn = document.createElement('span');
    clearBtn.className = 'roles-perms-search-clear';
    clearBtn.textContent = '\u00D7';
    clearBtn.style.display = permsSearchValue ? '' : 'none';
    searchWrap.append(searchInput, clearBtn);
    permsContainer.appendChild(searchWrap);

    if (readOnly) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:var(--text-muted);padding:4px 0 8px';
      note.textContent = 'Permissions for the admin role cannot be changed.';
      permsContainer.appendChild(note);
    }

    const groups = permissionGroups.length > 0 ? permissionGroups : [{ id: 'all', label: 'All Permissions', permissions: availablePermissions }];

    const filter = permsSearchValue.toLowerCase();
    const groupElements = [];

    for (const group of groups) {
      const filteredPerms = filter ? group.permissions.filter((p) => p.label.toLowerCase().includes(filter) || p.key.toLowerCase().includes(filter)) : group.permissions;

      if (filter && filteredPerms.length === 0) {
        continue;
      }

      const isCollapsed = !filter && collapsedGroups.has(group.id);
      const checkedCount = group.permissions.filter((p) => pendingPerms.has(p.key)).length;

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 0 4px;cursor:pointer;user-select:none;font-size:12px;font-weight:600;color:var(--text-secondary)';
      const arrow = document.createElement('span');
      arrow.style.cssText = 'font-size:10px;width:12px;text-align:center;flex-shrink:0;transition:transform 0.15s';
      arrow.textContent = '\u25B6';
      if (!isCollapsed) {
        arrow.style.transform = 'rotate(90deg)';
      }
      const groupLabel = document.createElement('span');
      groupLabel.style.flex = '1';
      groupLabel.textContent = group.label;
      const counter = document.createElement('span');
      counter.style.cssText = 'font-size:10px;color:var(--text-muted);font-weight:400';
      counter.textContent = `${checkedCount}/${group.permissions.length}`;

      header.append(arrow, groupLabel, counter);
      permsContainer.appendChild(header);

      const body = document.createElement('div');
      body.style.cssText = `padding-left:18px;${isCollapsed ? 'display:none;' : ''}`;

      for (const { key, label } of filteredPerms) {
        const row = document.createElement('label');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;${readOnly ? 'opacity:0.5;' : 'cursor:pointer;'}`;
        row.dataset.permKey = key;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = pendingPerms.has(key);
        checkbox.disabled = readOnly;
        if (!readOnly) {
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              pendingPerms.add(key);
            } else {
              pendingPerms.delete(key);
            }
            counter.textContent = `${group.permissions.filter((p) => pendingPerms.has(p.key)).length}/${group.permissions.length}`;
          });
        }
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        row.append(checkbox, labelSpan);
        body.appendChild(row);
      }

      permsContainer.appendChild(body);
      groupElements.push({ header, body, arrow, group });

      if (!filter) {
        header.addEventListener('click', () => {
          if (collapsedGroups.has(group.id)) {
            collapsedGroups.delete(group.id);
            body.style.display = '';
            arrow.style.transform = 'rotate(90deg)';
          } else {
            collapsedGroups.add(group.id);
            body.style.display = 'none';
            arrow.style.transform = '';
          }
        });
      }
    }

    if (filter && groupElements.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:var(--text-muted);padding:12px 0;text-align:center';
      empty.textContent = 'No permissions found.';
      permsContainer.appendChild(empty);
    }

    searchInput.addEventListener('input', () => {
      permsSearchValue = searchInput.value;
      clearBtn.style.display = permsSearchValue ? '' : 'none';
      renderPerms(readOnly);
      const newInput = permsContainer.querySelector('.roles-perms-search');
      if (newInput) {
        newInput.focus();
        newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
      }
    });

    clearBtn.addEventListener('click', () => {
      permsSearchValue = '';
      renderPerms(readOnly);
    });
  };

  /**
   * Displays a context menu for a role with delete and clone options.
   * @param {number} x - The horizontal position for the context menu
   * @param {number} y - The vertical position for the context menu
   * @param {{id: string, name: string, badge: string|null, permissions: string[]}} role - The role object
   * @returns {void}
   */
  const showRoleContextMenu = (x, y, role) => {
    document.querySelectorAll('.context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10001`;

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item' + (role.id === 'admin' || role.id === 'user' ? ' disabled' : '');
    deleteItem.textContent = 'Delete Role';
    deleteItem.addEventListener('click', async () => {
      menu.remove();
      if (role.id === 'admin' || role.id === 'user') {
        return;
      }
      if (!(await customConfirm(`Delete role "${role.name}"?`))) {
        return;
      }
      try {
        await serverService.request('role:delete', { roleId: role.id });
        roles = roles.filter((r) => r.id !== role.id);
        if (selectedRoleId === role.id) {
          selectedRoleId = null;
          rolesDetailEmpty.style.display = 'flex';
          rolesDetailContent.style.display = 'none';
        }
        renderRolesList();
      } catch (err) {
        await customAlert(err.message);
      }
    });

    const cloneItem = document.createElement('div');
    cloneItem.className = 'context-menu-item';
    cloneItem.textContent = 'Clone Role';
    cloneItem.addEventListener('click', async () => {
      menu.remove();
      try {
        const result = await serverService.request('role:create', {
          name: role.name + ' (copy)',
          badge: role.badge || null,
        });
        await serverService.request('role:set-permissions', {
          roleId: result.id,
          permissions: [...(role.permissions || [])],
        });
        result.permissions = [...(role.permissions || [])];
        roles.push(result);
        renderRolesList();
        selectRole(result.id);
      } catch (err) {
        await customAlert(err.message);
      }
    });

    menu.append(deleteItem, cloneItem);
    document.body.appendChild(menu);

    const removeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', removeMenu);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', removeMenu), 0);
  };

  root.querySelector('.roles-add-btn').addEventListener('click', async () => {
    const name = await customPrompt('New role name:');
    if (!name || !name.trim()) {
      return;
    }
    try {
      const result = await serverService.request('role:create', { name: name.trim() });
      result.permissions = result.permissions || [];
      roles.push(result);
      renderRolesList();
      selectRole(result.id);
    } catch (err) {
      await customAlert(err.message);
    }
  });

  root.querySelector('.roles-remove-btn').addEventListener('click', async () => {
    if (!selectedRoleId) {
      return;
    }
    const role = roles.find((r) => r.id === selectedRoleId);
    if (!role) {
      return;
    }
    if (role.id === 'admin' || role.id === 'user') {
      await customAlert('Cannot delete a built-in role.');
      return;
    }
    if (!(await customConfirm(`Delete role "${role.name}"?`))) {
      return;
    }
    try {
      await serverService.request('role:delete', { roleId: role.id });
      roles = roles.filter((r) => r.id !== role.id);
      selectedRoleId = null;
      rolesDetailEmpty.style.display = 'flex';
      rolesDetailContent.style.display = 'none';
      renderRolesList();
    } catch (err) {
      await customAlert(err.message);
    }
  });

  root.querySelector('.roles-save-btn').addEventListener('click', async () => {
    if (!selectedRoleId) {
      return;
    }
    const role = roles.find((r) => r.id === selectedRoleId);
    if (!role) {
      return;
    }
    const isStatic = role.id === 'admin' || role.id === 'user';
    const newName = nameInput.value.trim();
    const newBadge = badgeInput.value.trim() || null;
    const newColor = colorInput.value || null;
    if (!isStatic && !newName) {
      await customAlert('Role name cannot be empty.');
      return;
    }
    try {
      if (isStatic) {
        await serverService.request('role:update', { roleId: role.id, badge: newBadge, color: newColor });
      } else {
        await serverService.request('role:update', { roleId: role.id, name: newName, badge: newBadge, color: newColor });
        role.name = newName;
      }
      if (role.id !== 'admin') {
        await serverService.request('role:set-permissions', { roleId: role.id, permissions: [...pendingPerms] });
        role.permissions = [...pendingPerms];
      }
      role.badge = newBadge;
      role.color = newColor;
      renderRolesList();

      const saveBtn = root.querySelector('.roles-save-btn');
      const origText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      saveBtn.disabled = true;
      saveBtn.classList.add('roles-save-success');
      setTimeout(() => {
        saveBtn.textContent = origText;
        saveBtn.disabled = false;
        saveBtn.classList.remove('roles-save-success');
      }, 1500);
    } catch (err) {
      await customAlert(err.message);
    }
  });

  root.querySelector('.roles-cancel-btn').addEventListener('click', () => {
    if (selectedRoleId) {
      selectRole(selectedRoleId);
    }
  });

  try {
    const [rolesResult, permsResult] = await Promise.all([serverService.request('role:list'), serverService.request('role:list-permissions')]);
    roles = rolesResult.roles;
    availablePermissions = permsResult.permissions;
    permissionGroups = permsResult.groups || [];
    renderRolesList();
  } catch (err) {
    rolesDetailEmpty.textContent = err.message;
    rolesDetailEmpty.style.color = 'var(--danger)';
  }
}

/**
 * Opens a modal dialog containing the roles management panel.
 * Creates the modal overlay, renders the roles panel inside it, and sets up close handlers.
 * @returns {Promise<void>}
 */
async function showManageRolesModal() {
  const existing = document.querySelector('.modal-manage-roles');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-roles';
  modal.innerHTML = `
    <div class="modal-content" style="width:700px;max-width:90vw;padding:0;display:flex;flex-direction:column;height:520px">
      <div class="roles-panel-container" style="flex:1;min-height:0"></div>
      <div style="padding:8px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button class="btn-secondary roles-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderRolesPanel(modal.querySelector('.roles-panel-container'));

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };
  modal.querySelector('.roles-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  const onEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', onEscape);
}

export { renderRolesPanel, showManageRolesModal };
