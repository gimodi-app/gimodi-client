import connectionManager from '../services/connectionManager.js';
import { getServerIcon } from '../services/iconCache.js';

const iconUrlCache = new Map();

const sidebarList = document.getElementById('server-sidebar-list');
const connectWelcomeHint = document.getElementById('connect-welcome-hint');

let servers = [];
let activeServerAddress = null;
let contextMenuEl = null;

let dragData = null;
let dropTarget = null;

// Store connect callback for use in renderSidebar and helper functions
let _connectCallback = null;
let _editServerCallback = null;


/** @returns {Array} Flattened array of all servers (ungrouped). */
function flatServers() {
  const result = [];
  for (const item of servers) {
    if (item.type === 'group') result.push(...item.servers);
    else result.push(item);
  }
  return result;
}

/** Persists the server list to storage. */
async function saveServers() {
  await window.gimodi.servers.save(servers);
}

/** @param {Object} item - Server or group to remove from the list. */
function removeItem(item) {
  for (let i = servers.length - 1; i >= 0; i--) {
    if (servers[i] === item) { servers.splice(i, 1); return; }
    if (servers[i].type === 'group') {
      const idx = servers[i].servers.indexOf(item);
      if (idx >= 0) { servers[i].servers.splice(idx, 1); return; }
    }
  }
}

/**
 * @param {string} address
 * @param {string} nickname
 */
export function removeServerByIdentity(address, nickname) {
  for (let i = servers.length - 1; i >= 0; i--) {
    const item = servers[i];
    if (item.type === 'group') {
      const idx = item.servers.findIndex(s => s.address === address && s.nickname === nickname);
      if (idx >= 0) { item.servers.splice(idx, 1); return; }
    } else if (item.address === address && item.nickname === nickname) {
      servers.splice(i, 1); return;
    }
  }
}

/** Removes empty groups and unwraps single-server groups. */
function cleanupGroups() {
  for (let i = servers.length - 1; i >= 0; i--) {
    if (servers[i].type === 'group') {
      if (servers[i].servers.length === 0) servers.splice(i, 1);
      else if (servers[i].servers.length === 1) servers[i] = servers[i].servers[0];
    }
  }
}

/**
 * @param {Object} serverData
 * @returns {boolean} True if the server was found and updated.
 */
export function updateServerInList(serverData) {
  for (let i = 0; i < servers.length; i++) {
    const item = servers[i];
    if (item.type === 'group') {
      const idx = item.servers.findIndex(s => s.address === serverData.address && s.nickname === serverData.nickname);
      if (idx >= 0) { Object.assign(item.servers[idx], serverData); return true; }
    } else if (item.address === serverData.address && item.nickname === serverData.nickname) {
      Object.assign(servers[i], serverData); return true;
    }
  }
  return false;
}

/**
 * Adds a server to the in-memory list, updating it if already present.
 * @param {Object} server
 */
export function addOrUpdateServer(server) {
  if (!updateServerInList(server)) {
    servers.push(server);
  }
}

/**
 * Replaces a server in-place by old address+nickname, preserving its position.
 * @param {string} oldAddress
 * @param {string} oldNickname
 * @param {Object} newServer
 * @returns {boolean}
 */
export function replaceServerInPlace(oldAddress, oldNickname, newServer) {
  for (let i = 0; i < servers.length; i++) {
    const item = servers[i];
    if (item.type === 'group') {
      const idx = item.servers.findIndex(s => s.address === oldAddress && s.nickname === oldNickname);
      if (idx >= 0) { item.servers[idx] = newServer; return true; }
    } else if (item.address === oldAddress && item.nickname === oldNickname) {
      servers[i] = newServer; return true;
    }
  }
  return false;
}

/** Clears all drag-and-drop visual indicators. */
function clearDropIndicators() {
  document.querySelectorAll('.drag-merge, .drag-into-group').forEach(el => {
    el.classList.remove('drag-merge', 'drag-into-group');
  });
  dropTarget = null;
}

/** Reconstructs the server list order from the current DOM positions. */
function reconstructFromDOM() {
  const result = [];
  for (const child of sidebarList.children) {
    if (child._group) {
      const group = child._group;
      if (group.collapsed) {
        result.push(group);
      } else {
        const groupServers = [];
        for (const el of child.children) {
          if (el._server) groupServers.push(el._server);
        }
        group.servers = groupServers;
        if (groupServers.length === 0) continue;
        if (groupServers.length === 1) { result.push(groupServers[0]); continue; }
        result.push(group);
      }
    } else if (child._server) {
      result.push(child._server);
    }
  }
  return result;
}

/** Completes a drag operation by applying the drop action and saving. */
async function finalizeDrag() {
  if (!dragData) return;

  sidebarList.querySelectorAll('.server-group').forEach(g => g.style.minHeight = '');

  if (dropTarget?.zone === 'merge') {
    const targetServer = dropTarget.element._server;
    const draggedServer = dragData.item;
    if (targetServer && draggedServer && targetServer !== draggedServer) {
      removeItem(draggedServer);
      const targetIdx = servers.indexOf(targetServer);
      if (targetIdx >= 0) {
        servers[targetIdx] = {
          type: 'group',
          name: '',
          collapsed: false,
          servers: [targetServer, draggedServer],
        };
      }
      cleanupGroups();
      await saveServers();
      renderSidebar();
    }
  } else if (dropTarget?.zone === 'into-group') {
    const group = dropTarget.element._group;
    const draggedServer = dragData.item;
    if (group && draggedServer && group.type === 'group') {
      removeItem(draggedServer);
      group.servers.push(draggedServer);
      cleanupGroups();
      await saveServers();
      renderSidebar();
    }
  } else {
    servers = reconstructFromDOM();
    cleanupGroups();
    await saveServers();
    renderSidebar();
  }

  clearDropIndicators();
  dragData = null;
}

/** Renders the entire server sidebar from the current server list. */
export function renderSidebar() {
  hideTooltip();
  sidebarList.innerHTML = '';

  if (connectWelcomeHint) {
    const allServers = flatServers();
    connectWelcomeHint.textContent = allServers.length === 0
      ? 'Add a server to get started'
      : 'Select a server from the sidebar';
  }

  for (let i = 0; i < servers.length; i++) {
    const item = servers[i];
    if (item.type === 'group') {
      sidebarList.appendChild(createGroupElement(item, i));
    } else {
      sidebarList.appendChild(createServerButton(item, String(i)));
    }
  }
}

/**
 * @param {Object} server
 * @param {string} pathStr
 * @returns {HTMLButtonElement}
 */
function createServerButton(server, pathStr) {
  const btn = document.createElement('button');
  btn.className = 'server-sidebar-btn';
  btn.draggable = true;
  btn.dataset.path = pathStr;
  const isActive = activeServerAddress && server.address === activeServerAddress;
  const isConnected = connectionManager.isConnected(server.address);
  const isVoice = connectionManager.voiceAddress === server.address;

  if (isActive) btn.classList.add('active');
  if (isConnected) btn.classList.add('connected');
  if (isVoice) btn.classList.add('voice-active');

  const img = document.createElement('img');
  const cachedUrl = iconUrlCache.get(server.address);
  img.src = cachedUrl || '../../assets/icon.png';
  img.alt = '';
  btn.appendChild(img);

  if (!cachedUrl) {
    (async () => {
      try {
        const health = await window.gimodi.iconCache.health(server.address);
        if (health && health.iconHash) {
          const url = await getServerIcon(server.address, health.iconHash);
          if (url) {
            iconUrlCache.set(server.address, url);
            img.src = url;
          }
        }
      } catch {}
    })();
  }

  btn.addEventListener('mouseenter', (e) => showTooltip(e, server));
  btn.addEventListener('mouseleave', hideTooltip);

  let clickTimer = null;
  btn.addEventListener('click', () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (isConnected && !isActive) {
        window.dispatchEvent(new CustomEvent('gimodi:switch-server', {
          detail: { address: server.address },
        }));
      } else if (!isConnected) {
        _connectCallback(server);
      }
    }, 250);
  });
  btn.addEventListener('dblclick', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    if (!isConnected) {
      _connectCallback(server, { autoJoin: true });
    } else {
      if (!isActive) {
        window.dispatchEvent(new CustomEvent('gimodi:switch-server', {
          detail: { address: server.address },
        }));
      }
      window.dispatchEvent(new CustomEvent('gimodi:auto-join-voice'));
    }
  });

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideTooltip();
    showServerContextMenu(e, server, isConnected);
  });

  btn._server = server;

  btn.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    hideTooltip();
    const originGroup = btn.closest('.server-group');
    dragData = { type: 'server', item: server, originGroup };
    e.dataTransfer.effectAllowed = 'move';
    const clone = btn.cloneNode(true);
    clone.style.cssText = 'position:absolute;top:-9999px;width:48px;height:48px;border-radius:50%;overflow:hidden;';
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 24, 24);
    const parentGroup = btn.closest('.server-group');
    if (parentGroup) {
      parentGroup.style.minHeight = parentGroup.offsetHeight + 'px';
    }
    requestAnimationFrame(() => {
      clone.remove();
      btn.classList.add('dragging');
    });
  });

  btn.addEventListener('dragover', (e) => {
    if (!dragData || dragData.item === server) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const draggingEl = document.querySelector('.dragging');
    if (!draggingEl || draggingEl === btn || draggingEl.contains(btn)) return;

    const rect = btn.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const isUngrouped = btn.parentElement === sidebarList;
    const dragIsGroup = dragData.type === 'group';

    if (isUngrouped && !dragIsGroup && ratio > 0.3 && ratio < 0.7) {
      if (dropTarget?.zone === 'merge' && dropTarget?.element === btn) return;
      clearDropIndicators();
      btn.classList.add('drag-merge');
      dropTarget = { zone: 'merge', element: btn };
      return;
    }

    clearDropIndicators();

    if (dragIsGroup) {
      let ref = btn;
      while (ref.parentElement !== sidebarList) ref = ref.parentElement;
      if (ratio < 0.5) {
        sidebarList.insertBefore(draggingEl, ref);
      } else {
        sidebarList.insertBefore(draggingEl, ref.nextSibling);
      }
    } else {
      const parent = btn.parentElement;
      const isTargetGrouped = parent.classList.contains('server-group');
      const isSameGroup = isTargetGrouped && dragData.originGroup === parent;

      if (isTargetGrouped && !isSameGroup) {
        const groupBtns = [...parent.querySelectorAll('.server-sidebar-btn:not(.dragging)')];
        const isFirst = groupBtns[0] === btn;
        const isLast = groupBtns[groupBtns.length - 1] === btn;

        if (isFirst && ratio < 0.25) {
          sidebarList.insertBefore(draggingEl, parent);
        } else if (isLast && ratio > 0.75) {
          sidebarList.insertBefore(draggingEl, parent.nextSibling);
        } else {
          parent.classList.add('drag-into-group');
          dropTarget = { zone: 'into-group', element: parent };
        }
      } else if (isSameGroup) {
        const groupBtns = [...parent.querySelectorAll('.server-sidebar-btn:not(.dragging)')];
        const isFirst = groupBtns[0] === btn;
        const isLast = groupBtns[groupBtns.length - 1] === btn;

        if (isFirst && ratio < 0.25) {
          sidebarList.insertBefore(draggingEl, parent);
        } else if (isLast && ratio > 0.75) {
          sidebarList.insertBefore(draggingEl, parent.nextSibling);
        } else {
          if (ratio < 0.5) {
            parent.insertBefore(draggingEl, btn);
          } else {
            parent.insertBefore(draggingEl, btn.nextSibling);
          }
        }
      } else {
        if (ratio < 0.5) {
          parent.insertBefore(draggingEl, btn);
        } else {
          parent.insertBefore(draggingEl, btn.nextSibling);
        }
      }
    }
  });

  btn.addEventListener('dragend', () => {
    btn.classList.remove('dragging');
    finalizeDrag();
  });

  return btn;
}

/**
 * @param {Object} group
 * @param {number} topIndex
 * @returns {HTMLButtonElement}
 */
function createCollapsedGroup(group, topIndex) {
  const btn = document.createElement('button');
  btn.className = 'server-sidebar-btn server-group-collapsed';
  btn.dataset.path = String(topIndex);
  btn.draggable = true;

  const grid = document.createElement('div');
  grid.className = 'server-group-grid';
  const previewServers = group.servers.slice(0, 4);
  for (const server of previewServers) {
    const mini = document.createElement('img');
    const cachedUrl = iconUrlCache.get(server.address);
    mini.src = cachedUrl || '../../assets/icon.png';
    mini.alt = '';
    if (!cachedUrl) {
      (async () => {
        try {
          const health = await window.gimodi.iconCache.health(server.address);
          if (health && health.iconHash) {
            const url = await getServerIcon(server.address, health.iconHash);
            if (url) { iconUrlCache.set(server.address, url); mini.src = url; }
          }
        } catch {}
      })();
    }
    grid.appendChild(mini);
  }
  btn.appendChild(grid);

  btn.addEventListener('click', () => {
    group.collapsed = false;
    saveServers();
    renderSidebar();
  });

  btn.addEventListener('mouseenter', (e) => showGroupTooltip(e, group));
  btn.addEventListener('mouseleave', hideTooltip);

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hideTooltip();
    showGroupContextMenu(e, group, topIndex);
  });

  btn._group = group;

  btn.addEventListener('dragstart', (e) => {
    hideTooltip();
    dragData = { type: 'group', item: group };
    e.dataTransfer.effectAllowed = 'move';
    const clone = btn.cloneNode(true);
    clone.style.cssText = 'position:absolute;top:-9999px;width:48px;height:48px;border-radius:16px;overflow:hidden;';
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 24, 24);
    requestAnimationFrame(() => { clone.remove(); btn.classList.add('dragging'); });
  });

  btn.addEventListener('dragend', () => {
    btn.classList.remove('dragging');
    finalizeDrag();
  });

  btn.addEventListener('dragover', (e) => {
    if (!dragData || dragData.item === group) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const draggingEl = document.querySelector('.dragging');
    if (!draggingEl) return;

    clearDropIndicators();

    const rect = btn.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;

    if (dragData.type === 'group') {
      if (ratio < 0.5) {
        sidebarList.insertBefore(draggingEl, btn);
      } else {
        sidebarList.insertBefore(draggingEl, btn.nextSibling);
      }
    } else if (ratio < 0.25) {
      sidebarList.insertBefore(draggingEl, btn);
    } else if (ratio > 0.75) {
      sidebarList.insertBefore(draggingEl, btn.nextSibling);
    } else {
      btn.classList.add('drag-into-group');
      dropTarget = { zone: 'into-group', element: btn };
    }
  });

  btn.addEventListener('dragleave', () => {
    btn.classList.remove('drag-into-group');
  });

  return btn;
}

/**
 * @param {Object} group
 * @param {number} topIndex
 * @returns {HTMLElement}
 */
function createGroupElement(group, topIndex) {
  if (group.collapsed) {
    return createCollapsedGroup(group, topIndex);
  }

  const container = document.createElement('div');
  container.className = 'server-group';
  container.dataset.path = String(topIndex);
  container.draggable = true;

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'server-group-collapse-btn';
  collapseBtn.title = group.name || 'Minimize group';
  collapseBtn.innerHTML = '<i class="bi bi-dash-lg"></i>';
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    group.collapsed = true;
    saveServers();
    renderSidebar();
  });
  container.appendChild(collapseBtn);

  if (group.name) {
    const label = document.createElement('div');
    label.className = 'server-group-label';
    label.textContent = group.name;
    container.appendChild(label);
  }

  container._group = group;

  for (let i = 0; i < group.servers.length; i++) {
    const btn = createServerButton(group.servers[i], `${topIndex}.${i}`);
    container.appendChild(btn);
  }

  container.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.server-sidebar-btn')) return;
    e.preventDefault();
    showGroupContextMenu(e, group, topIndex);
  });

  container.addEventListener('mouseenter', (e) => {
    if (e.target.closest('.server-sidebar-btn')) return;
    showGroupTooltip(e, group);
  });
  container.addEventListener('mouseleave', hideTooltip);

  container.addEventListener('dragstart', (e) => {
    if (e.target.closest('.server-sidebar-btn')) return;
    hideTooltip();
    dragData = { type: 'group', item: group };
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => {
      container.classList.add('dragging');
    });
  });

  container.addEventListener('dragend', () => {
    container.classList.remove('dragging');
    finalizeDrag();
  });

  container.addEventListener('dragover', (e) => {
    if (!dragData) return;
    if (e.target.closest('.server-sidebar-btn')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const draggingEl = document.querySelector('.dragging');
    if (!draggingEl || draggingEl === container) return;

    if (dragData.originGroup === container) return;

    clearDropIndicators();

    const rect = container.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;

    if (dragData.type === 'group') {
      if (ratio < 0.5) {
        sidebarList.insertBefore(draggingEl, container);
      } else {
        sidebarList.insertBefore(draggingEl, container.nextSibling);
      }
    } else if (ratio < 0.2) {
      sidebarList.insertBefore(draggingEl, container);
    } else if (ratio > 0.8) {
      sidebarList.insertBefore(draggingEl, container.nextSibling);
    } else {
      container.classList.add('drag-into-group');
      dropTarget = { zone: 'into-group', element: container };
    }
  });

  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.classList.remove('drag-into-group');
    }
  });

  return container;
}

let tooltipEl = null;

/**
 * @param {MouseEvent} e
 * @param {Object} server
 */
function showTooltip(e, server) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'server-sidebar-tooltip';
  const name = document.createElement('div');
  name.className = 'tooltip-name';
  name.textContent = server.name || server.address;
  tooltipEl.appendChild(name);
  const addr = document.createElement('div');
  addr.className = 'tooltip-addr';
  const isConnected = connectionManager.isConnected(server.address);
  addr.textContent = `${server.address} · ${server.nickname}${isConnected ? ' · Connected' : ''}`;
  tooltipEl.appendChild(addr);
  document.body.appendChild(tooltipEl);

  const rect = e.currentTarget.getBoundingClientRect();
  tooltipEl.style.top = rect.top + rect.height / 2 - tooltipEl.offsetHeight / 2 + 'px';
}

/**
 * @param {MouseEvent} e
 * @param {Object} group
 */
function showGroupTooltip(e, group) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'server-sidebar-tooltip';
  const name = document.createElement('div');
  name.className = 'tooltip-name';
  name.textContent = group.name || 'Server Group';
  tooltipEl.appendChild(name);
  const info = document.createElement('div');
  info.className = 'tooltip-addr';
  info.textContent = `${group.servers.length} server${group.servers.length !== 1 ? 's' : ''}`;
  tooltipEl.appendChild(info);
  document.body.appendChild(tooltipEl);
  const rect = e.currentTarget.getBoundingClientRect();
  tooltipEl.style.top = rect.top + rect.height / 2 - tooltipEl.offsetHeight / 2 + 'px';
}

/** Removes the active tooltip from the DOM. */
function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

/**
 * @param {MouseEvent} e
 * @param {Object} server
 * @param {boolean} isConnected
 */
function showServerContextMenu(e, server, isConnected) {
  dismissContextMenu();
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'context-menu';
  contextMenuEl.style.position = 'fixed';
  contextMenuEl.style.left = e.clientX + 'px';
  contextMenuEl.style.top = e.clientY + 'px';
  contextMenuEl.style.zIndex = '10000';

  if (isConnected) {
    const disconnectItem = document.createElement('div');
    disconnectItem.className = 'context-menu-item';
    disconnectItem.textContent = 'Disconnect';
    disconnectItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      dismissContextMenu();
      window.dispatchEvent(new CustomEvent('gimodi:disconnect-server', {
        detail: { address: server.address },
      }));
    });
    contextMenuEl.appendChild(disconnectItem);
  } else {
    const openItem = document.createElement('div');
    openItem.className = 'context-menu-item';
    openItem.textContent = 'Connect';
    openItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      dismissContextMenu();
      _connectCallback(server);
    });
    contextMenuEl.appendChild(openItem);
  }

  const parentGroup = servers.find(item => item.type === 'group' && item.servers.includes(server));
  if (parentGroup) {
    const removeFromGroupItem = document.createElement('div');
    removeFromGroupItem.className = 'context-menu-item';
    removeFromGroupItem.textContent = 'Remove from Group';
    removeFromGroupItem.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      dismissContextMenu();
      removeItem(server);
      const groupIdx = servers.indexOf(parentGroup);
      if (groupIdx >= 0) {
        servers.splice(groupIdx + 1, 0, server);
      } else {
        servers.push(server);
      }
      cleanupGroups();
      await saveServers();
      renderSidebar();
    });
    contextMenuEl.appendChild(removeFromGroupItem);
  }

  const editItem = document.createElement('div');
  editItem.className = 'context-menu-item';
  editItem.textContent = 'Edit Server';
  editItem.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dismissContextMenu();
    if (_editServerCallback) _editServerCallback(server, isConnected);
  });
  contextMenuEl.appendChild(editItem);

  const removeItemEl = document.createElement('div');
  removeItemEl.className = 'context-menu-item';
  removeItemEl.textContent = 'Remove';
  removeItemEl.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    dismissContextMenu();
    if (isConnected) {
      window.dispatchEvent(new CustomEvent('gimodi:disconnect-server', {
        detail: { address: server.address },
      }));
    }
    await window.gimodi.servers.remove(server.address, server.nickname);
    removeServerByIdentity(server.address, server.nickname);
    cleanupGroups();
    renderSidebar();
  });
  contextMenuEl.appendChild(removeItemEl);

  document.body.appendChild(contextMenuEl);
}

/**
 * @param {MouseEvent} e
 * @param {Object} group
 * @param {number} topIndex
 */
function showGroupContextMenu(e, group, topIndex) {
  dismissContextMenu();
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'context-menu';
  contextMenuEl.style.position = 'fixed';
  contextMenuEl.style.left = e.clientX + 'px';
  contextMenuEl.style.top = e.clientY + 'px';
  contextMenuEl.style.zIndex = '10000';

  const renameItem = document.createElement('div');
  renameItem.className = 'context-menu-item';
  renameItem.textContent = 'Rename Group';
  renameItem.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dismissContextMenu();
    const name = prompt('Group name:', group.name || '');
    if (name !== null) {
      group.name = name;
      saveServers();
      renderSidebar();
    }
  });
  contextMenuEl.appendChild(renameItem);

  const ungroupItem = document.createElement('div');
  ungroupItem.className = 'context-menu-item';
  ungroupItem.textContent = 'Ungroup';
  ungroupItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    dismissContextMenu();
    servers.splice(topIndex, 1, ...group.servers);
    await saveServers();
    renderSidebar();
  });
  contextMenuEl.appendChild(ungroupItem);

  document.body.appendChild(contextMenuEl);
}

/** Removes the active context menu from the DOM. */
function dismissContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

/** @param {string|null} address */
export function setActiveServer(address) {
  activeServerAddress = address || null;
}

/** Clears the active server and re-renders the sidebar. */
export function clearActiveServer() {
  activeServerAddress = null;
  renderSidebar();
}

/**
 * Initializes the server sidebar, event listeners, and drag-and-drop.
 * @param {function} connectCallback - Called with (server, options?) to initiate a connection.
 * @param {function} onAddServer - Called when the add-server button is clicked.
 */
export async function initSidebar(connectCallback, onAddServer, onEditServer) {
  _connectCallback = connectCallback;
  _editServerCallback = onEditServer;
  servers = await window.gimodi.servers.list() || [];
  renderSidebar();

  document.getElementById('btn-add-server').addEventListener('click', onAddServer);

  sidebarList.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragData) return;

    const draggingEl = document.querySelector('.dragging');
    if (!draggingEl) return;

    const listRect = sidebarList.getBoundingClientRect();
    const edgeSize = 20;
    const atTop = e.clientY < listRect.top + edgeSize;
    const atBottom = e.clientY > listRect.bottom - edgeSize;

    if (e.target !== sidebarList && !atTop && !atBottom) return;

    clearDropIndicators();

    if (atTop) {
      sidebarList.insertBefore(draggingEl, sidebarList.firstChild);
    } else if (atBottom) {
      sidebarList.appendChild(draggingEl);
    } else {
      const children = [...sidebarList.children].filter(c => c !== draggingEl);
      let inserted = false;
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          sidebarList.insertBefore(draggingEl, child);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        sidebarList.appendChild(draggingEl);
      }
    }
  });

  document.addEventListener('click', dismissContextMenu);
}
