/**
 * Factory function that creates tab management handlers for the chat view.
 * Receives dependencies from the parent chat module and returns an object
 * of tab-related functions.
 *
 * @param {object} deps
 * @param {object} deps.state - Mutable module-level state object
 * @param {object} deps.state.activeTab - Currently active tab descriptor
 * @param {Array} deps.state.tabOrder - Unified visual tab order
 * @param {Array} deps.state.channelViewTabs - Open channel-view tabs
 * @param {Array} deps.state.channelMessagesCache - Cached channel DOM nodes
 * @param {Array} deps.state.channelMessagesPending - Buffered channel messages
 * @param {Map} deps.state.channelViewMessagesCache - Cached channel-view DOM nodes by channelId
 * @param {Map} deps.state.channelViewMessagesPending - Buffered channel-view messages by channelId
 * @param {Set} deps.state.unreadChannels - Channel IDs with unread messages
 * @param {object|null} deps.state.draggedTab - Current drag state
 * @param {Function} deps.getProvider - Returns the current server provider
 * @param {Function} deps.getCurrentChannelId - Returns the current channel ID
 * @param {Function} deps.getCurrentChannelName - Returns the current channel name
 * @param {Function} deps.getVoiceChannelId - Returns the voice channel ID
 * @param {Function} deps.getChannelTabUnread - Returns channel tab unread flag
 * @param {Function} deps.setChannelTabUnread - Sets the channel tab unread flag
 * @param {Function} deps.getChatMessages - Returns the chat messages DOM element
 * @param {Function} deps.appendMessage - Appends a message to the chat view
 * @param {Function} deps.scrollToBottom - Scrolls chat to the bottom
 * @param {Function} deps.renderPinnedMessages - Re-renders pinned messages
 * @param {Function} deps.loadHistory - Loads message history for a channel
 * @param {Function} deps.loadChannelViewHistory - Loads history for a channel-view tab
 * @param {Function} deps.updateInputForTab - Updates the input area for the active tab
 * @param {Function} deps.cancelReply - Cancels any pending reply
 * @param {Function} deps.renderTypingIndicator - Re-renders the typing indicator
 * @param {Function} deps.closeChannelViewTab - Closes a channel-view tab by channelId
 * @param {Function} deps.markChannelRead - Marks a channel as read
 * @param {object} deps.notificationService - Notification service instance
 * @returns {object} Object containing tab management functions
 */
export function createTabHandlers(deps) {
  const {
    state,
    getProvider,
    getCurrentChannelId,
    getCurrentChannelName,
    getVoiceChannelId,
    getChannelTabUnread,
    setChannelTabUnread,
    getChatMessages,
    appendMessage,
    scrollToBottom,
    renderPinnedMessages,
    loadHistory,
    loadChannelViewHistory,
    updateInputForTab,
    cancelReply,
    renderTypingIndicator,
    closeChannelViewTab,
    markChannelRead,
    notificationService,
  } = deps;

  /**
   * Handles channel navigation events dispatched from the server view.
   * Sends a channel join request to the server.
   *
   * @param {CustomEvent} e - Event with detail.channelId
   * @returns {void}
   */
  function onNavigateChannel(e) {
    const { channelId } = e.detail;
    if (channelId) {
      getProvider().send('channel:join', { channelId });
    }
  }

  /**
   * Switches the active chat tab to the specified tab descriptor.
   * Saves current DOM state, restores cached messages or loads history
   * for the target tab, and updates unread indicators.
   *
   * @param {object} tab - Tab descriptor
   * @param {string} tab.type - Either 'channel' or 'channel-view'
   * @param {string} [tab.channelId] - Channel ID for channel-view tabs
   * @param {string} [tab.channelName] - Channel name for channel-view tabs
   * @returns {void}
   */
  function switchToTab(tab) {
    const currentChannelId = getCurrentChannelId();
    const provider = getProvider();
    const chatMessages = getChatMessages();

    console.log('[chat] switchToTab', tab.type, tab.channelId || '', 'from', state.activeTab.type, state.activeTab.channelId || '');
    const isSameTab = state.activeTab.type === tab.type && (tab.type === 'channel' || (tab.type === 'channel-view' && state.activeTab.channelId === tab.channelId));
    if (isSameTab) {
      renderTabs();
      return;
    }

    if (state.activeTab.type === 'channel') {
      state.channelMessagesCache.length = 0;
      for (const child of chatMessages.children) {
        state.channelMessagesCache.push(child);
      }
    } else if (state.activeTab.type === 'channel-view') {
      let cached = state.channelViewMessagesCache.get(state.activeTab.channelId);
      if (!cached) {
        cached = [];
        state.channelViewMessagesCache.set(state.activeTab.channelId, cached);
      }
      cached.length = 0;
      for (const child of chatMessages.children) {
        cached.push(child);
      }
    }

    state.activeTab = tab;
    chatMessages.innerHTML = '';
    updateInputForTab();
    cancelReply();
    renderTypingIndicator();

    if (tab.type === 'channel') {
      notificationService.clearByAction({ type: 'channel', channelId: currentChannelId });
    }

    if (tab.type === 'channel') {
      setChannelTabUnread(false);
      if (currentChannelId && state.unreadChannels.delete(currentChannelId)) {
        window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
      }
      if (currentChannelId) {
        markChannelRead(currentChannelId, provider.address);
      }
      if (state.channelMessagesCache.length > 0) {
        for (const node of state.channelMessagesCache) {
          chatMessages.appendChild(node);
        }
        state.channelMessagesCache.length = 0;
        for (const msg of state.channelMessagesPending) {
          appendMessage(msg);
        }
        state.channelMessagesPending.length = 0;
        scrollToBottom();
        renderPinnedMessages();
      } else {
        state.channelMessagesPending.length = 0;
        if (currentChannelId) {
          loadHistory(currentChannelId);
        }
      }
    } else if (tab.type === 'channel-view') {
      const cvTab = state.channelViewTabs.find((t) => t.channelId === tab.channelId);
      if (cvTab) {
        cvTab.unread = false;
      }
      if (state.unreadChannels.delete(tab.channelId)) {
        window.dispatchEvent(new CustomEvent('gimodi:channel-unread-changed'));
      }
      markChannelRead(tab.channelId, provider.address);
      const cached = state.channelViewMessagesCache.get(tab.channelId);
      if (cached && cached.length > 0) {
        for (const node of cached) {
          chatMessages.appendChild(node);
        }
        cached.length = 0;
        const pending = state.channelViewMessagesPending.get(tab.channelId) || [];
        for (const msg of pending) {
          appendMessage(msg);
        }
        state.channelViewMessagesPending.delete(tab.channelId);
        scrollToBottom();
        renderPinnedMessages();
      } else {
        loadChannelViewHistory(tab.channelId);
      }
    }

    renderTabs();
    window.dispatchEvent(new CustomEvent('gimodi:channel-tabs-changed'));
  }

  /**
   * Renders the tab bar UI, creating DOM elements for the voice channel tab,
   * the current channel tab, and all channel-view tabs in tab order.
   * Handles active/unread styling, close buttons, click handlers, context
   * menus, and drag-and-drop attributes.
   *
   * @returns {void}
   */
  function renderTabs() {
    const tabBar = document.querySelector('.tab-bar');
    if (!tabBar) {
      return;
    }

    tabBar.innerHTML = '';

    const voiceChannelId = getVoiceChannelId();
    const currentChannelId = getCurrentChannelId();
    const currentChannelName = getCurrentChannelName();
    const channelTabUnread = getChannelTabUnread();

    if (voiceChannelId) {
      const vcTab = state.channelViewTabs.find((t) => t.channelId === voiceChannelId);
      if (vcTab) {
        const tab = document.createElement('div');
        tab.className = `tab${state.activeTab.type === 'channel-view' && state.activeTab.channelId === voiceChannelId ? ' active' : ''}${vcTab.unread ? ' unread' : ''}`;
        tab.dataset.type = 'channel-view';
        tab.dataset.channelId = vcTab.channelId;
        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = '#' + vcTab.channelName;
        tab.appendChild(label);
        tab.addEventListener('click', () => switchToTab({ type: 'channel-view', channelId: vcTab.channelId, channelName: vcTab.channelName }));
        tabBar.appendChild(tab);
      }
    }

    if (currentChannelId && !state.channelViewTabs.find((t) => t.channelId === currentChannelId)) {
      const channelTab = document.createElement('div');
      channelTab.id = 'tab-channel';
      channelTab.className = `tab${state.activeTab.type === 'channel' ? ' active' : ''}${channelTabUnread ? ' unread' : ''}`;
      channelTab.dataset.type = 'channel';
      const channelLabel = document.createElement('span');
      channelLabel.className = 'tab-label';
      channelLabel.textContent = '#' + currentChannelName;
      channelTab.appendChild(channelLabel);
      channelTab.addEventListener('click', () => switchToTab({ type: 'channel' }));
      tabBar.appendChild(channelTab);
    }

    for (let i = 0; i < state.tabOrder.length; i++) {
      const entry = state.tabOrder[i];
      const tab = document.createElement('div');
      tab.dataset.dragIndex = i;
      tab.draggable = true;
      addTabDragListeners(tab, i);

      {
        const cv = state.channelViewTabs.find((t) => t.channelId === entry.id);
        if (!cv) {
          continue;
        }
        tab.className = `tab${state.activeTab.type === 'channel-view' && state.activeTab.channelId === cv.channelId ? ' active' : ''}${cv.unread ? ' unread' : ''}`;
        tab.dataset.type = 'channel-view';
        tab.dataset.channelId = cv.channelId;

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
      }
      tabBar.appendChild(tab);
    }
  }

  /**
   * Displays a context menu for a hyperlink with options to open or copy the URL.
   *
   * @param {number} x - Horizontal position in pixels for the menu
   * @param {number} y - Vertical position in pixels for the menu
   * @param {string} href - The URL of the link
   * @returns {void}
   */
  function showLinkContextMenu(x, y, href) {
    const existing = document.querySelector('.link-context-menu');
    if (existing) {
      existing.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu link-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const openItem = document.createElement('div');
    openItem.className = 'context-menu-item';
    openItem.textContent = 'Open Link';
    openItem.addEventListener('click', () => {
      menu.remove();
      window.gimodi.openExternal(href);
    });
    menu.appendChild(openItem);

    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.textContent = 'Copy Link';
    copyItem.addEventListener('click', () => {
      menu.remove();
      navigator.clipboard.writeText(href);
    });
    menu.appendChild(copyItem);

    document.body.appendChild(menu);
    const onClickOutside = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', onClickOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);
  }

  /**
   * Displays a context menu for an image with options to copy URL,
   * save the image, or open it in an external browser.
   *
   * @param {number} x - Horizontal position in pixels for the menu
   * @param {number} y - Vertical position in pixels for the menu
   * @param {string} src - The image source URL
   * @param {string} [filename] - Optional filename for saving
   * @param {string} [size] - Optional file size descriptor
   * @param {string} [url] - Optional download URL (enables save option)
   * @returns {void}
   */
  function showImageContextMenu(x, y, src, filename, size, url) {
    const existing = document.querySelector('.image-context-menu');
    if (existing) {
      existing.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu image-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const copyItem = document.createElement('div');
    copyItem.className = 'context-menu-item';
    copyItem.textContent = 'Copy Image URL';
    copyItem.addEventListener('click', () => {
      menu.remove();
      navigator.clipboard.writeText(src);
    });
    menu.appendChild(copyItem);

    if (url) {
      const downloadItem = document.createElement('div');
      downloadItem.className = 'context-menu-item';
      downloadItem.textContent = 'Save Image';
      downloadItem.addEventListener('click', () => {
        menu.remove();
        window.gimodi.downloadFile(url, filename || 'image');
      });
      menu.appendChild(downloadItem);
    }

    const openItem = document.createElement('div');
    openItem.className = 'context-menu-item';
    openItem.textContent = 'Open in Browser';
    openItem.addEventListener('click', () => {
      menu.remove();
      window.gimodi.openExternal(src);
    });
    menu.appendChild(openItem);

    document.body.appendChild(menu);
    const onClickOutside = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', onClickOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onClickOutside, true), 0);
  }

  /**
   * Displays a context menu for a channel-view tab with options to close
   * the tab, close all tabs, or close all other tabs.
   *
   * @param {MouseEvent} e - The contextmenu event
   * @param {object} tabInfo - Tab descriptor with type and channelId
   * @param {string} tabInfo.type - The tab type
   * @param {string} tabInfo.channelId - The channel ID of the tab
   * @returns {void}
   */
  function showTabContextMenu(e, tabInfo) {
    e.preventDefault();
    e.stopPropagation();

    const existing = document.querySelector('.tab-context-menu');
    if (existing) {
      existing.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu tab-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const closeItem = document.createElement('div');
    closeItem.className = 'context-menu-item';
    closeItem.textContent = 'Close Tab';
    closeItem.addEventListener('click', () => {
      menu.remove();
      closeChannelViewTab(tabInfo.channelId);
    });
    menu.appendChild(closeItem);

    const closeAllItem = document.createElement('div');
    closeAllItem.className = 'context-menu-item';
    closeAllItem.textContent = 'Close All Tabs';
    closeAllItem.addEventListener('click', () => {
      menu.remove();
      for (const t of [...state.channelViewTabs]) {
        closeChannelViewTab(t.channelId);
      }
    });
    menu.appendChild(closeAllItem);

    const closeOthersItem = document.createElement('div');
    closeOthersItem.className = 'context-menu-item';
    closeOthersItem.textContent = 'Close Other Tabs';
    closeOthersItem.addEventListener('click', () => {
      menu.remove();
      for (const t of [...state.channelViewTabs]) {
        if (t.channelId !== tabInfo.channelId) {
          closeChannelViewTab(t.channelId);
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

  /**
   * Attaches drag-and-drop event listeners to a tab DOM element,
   * enabling tab reordering within the tab bar.
   *
   * @param {HTMLElement} tab - The tab DOM element to attach listeners to
   * @param {number} index - The current index of this tab in tabOrder
   * @returns {void}
   */
  function addTabDragListeners(tab, index) {
    tab.addEventListener('dragstart', (e) => {
      state.draggedTab = { index };
      tab.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      document.querySelectorAll('.tab.drag-over-left, .tab.drag-over-right').forEach((el) => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });
      state.draggedTab = null;
    });

    tab.addEventListener('dragover', (e) => {
      if (!state.draggedTab) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
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
      if (!state.draggedTab) {
        return;
      }

      const fromIndex = state.draggedTab.index;
      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      let toIndex = e.clientX < midX ? index : index + 1;
      if (toIndex > fromIndex) {
        toIndex--;
      }
      if (fromIndex === toIndex) {
        return;
      }

      const [moved] = state.tabOrder.splice(fromIndex, 1);
      state.tabOrder.splice(toIndex, 0, moved);

      if (state.tabOrder.some((t) => t.type === 'channel-view')) {
        window.dispatchEvent(new CustomEvent('gimodi:channel-tabs-changed'));
      }
      renderTabs();
    });
  }

  return {
    onNavigateChannel,
    switchToTab,
    renderTabs,
    showLinkContextMenu,
    showImageContextMenu,
    showTabContextMenu,
    addTabDragListeners,
  };
}
