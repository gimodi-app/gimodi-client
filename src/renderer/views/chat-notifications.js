/**
 * Factory that creates notification bell and dropdown handlers.
 *
 * @param {object} deps
 * @param {object} deps.notificationService - The notification service instance
 * @param {HTMLElement} deps.btnNotifications - The notification bell button element
 * @param {HTMLElement} deps.notificationBadge - The badge element showing unread count
 * @param {HTMLElement} deps.notificationDropdown - The dropdown container element
 * @param {Function} deps.switchToTab - Function to switch the active chat tab
 * @returns {{ updateNotificationBell: Function, renderNotificationDropdown: Function, openNotificationDropdown: Function, closeNotificationDropdown: Function, toggleNotificationDropdown: Function }}
 */
export default function createNotificationHandlers(deps) {
  const {
    notificationService,
    btnNotifications,
    notificationBadge,
    notificationDropdown,
    switchToTab,
  } = deps;

  let _onClickOutsideDropdown = null;

  /**
   * Updates the notification bell badge count and triggers a shake animation
   * when new notifications arrive. Refreshes the dropdown if it is open.
   *
   * @returns {void}
   */
  function updateNotificationBell() {
    const count = notificationService.count;
    if (count === 0) {
      notificationBadge.classList.add('hidden');
      notificationBadge.textContent = '';
    } else {
      notificationBadge.classList.remove('hidden');
      notificationBadge.textContent = count > 9 ? '9+' : String(count);
      btnNotifications.classList.remove('bell-shake');
      void btnNotifications.offsetWidth;
      btnNotifications.classList.add('bell-shake');
    }
    if (!notificationDropdown.classList.contains('hidden')) {
      renderNotificationDropdown();
    }
  }

  /**
   * Builds the notification dropdown DOM content from the current notification
   * entries, including a "Clear all" footer button.
   *
   * @returns {void}
   */
  function renderNotificationDropdown() {
    notificationDropdown.innerHTML = '';
    const entries = notificationService.entries;

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'notif-empty';
      empty.textContent = 'No new notifications';
      notificationDropdown.appendChild(empty);
    } else {
      for (const entry of entries) {
        const item = document.createElement('div');
        item.className = 'notif-item';
        item.dataset.type = entry.type;

        const icon = document.createElement('i');
        icon.className = 'bi bi-at notif-icon';
        item.appendChild(icon);

        const text = document.createElement('div');
        text.className = 'notif-text';

        const title = document.createElement('div');
        title.className = 'notif-item-title';
        title.textContent = entry.title;
        text.appendChild(title);

        const body = document.createElement('div');
        body.className = 'notif-item-body';
        body.textContent = entry.body;
        text.appendChild(body);

        item.appendChild(text);

        if (entry.action) {
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => {
            closeNotificationDropdown();
            if (entry.action.type === 'channel') {
              switchToTab({ type: 'channel' });
            }
          });
        }

        notificationDropdown.appendChild(item);
      }
    }

    const footer = document.createElement('div');
    footer.className = 'notif-footer';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'notif-clear-all';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationService.clearAll();
      closeNotificationDropdown();
    });
    footer.appendChild(clearBtn);
    notificationDropdown.appendChild(footer);
  }

  /**
   * Opens the notification dropdown, renders its content, and registers a
   * click-outside listener to auto-close it.
   *
   * @returns {void}
   */
  function openNotificationDropdown() {
    renderNotificationDropdown();
    notificationDropdown.classList.remove('hidden');
    _onClickOutsideDropdown = (e) => {
      if (!notificationDropdown.contains(e.target) && e.target !== btnNotifications) {
        closeNotificationDropdown();
      }
    };
    setTimeout(() => document.addEventListener('click', _onClickOutsideDropdown), 0);
  }

  /**
   * Closes the notification dropdown and removes the click-outside listener.
   *
   * @returns {void}
   */
  function closeNotificationDropdown() {
    if (!notificationDropdown) {
      return;
    }
    notificationDropdown.classList.add('hidden');
    if (_onClickOutsideDropdown) {
      document.removeEventListener('click', _onClickOutsideDropdown);
      _onClickOutsideDropdown = null;
    }
  }

  /**
   * Toggles the notification dropdown between open and closed states.
   *
   * @returns {void}
   */
  function toggleNotificationDropdown() {
    if (notificationDropdown.classList.contains('hidden')) {
      openNotificationDropdown();
    } else {
      closeNotificationDropdown();
    }
  }

  return {
    updateNotificationBell,
    renderNotificationDropdown,
    openNotificationDropdown,
    closeNotificationDropdown,
    toggleNotificationDropdown,
  };
}
