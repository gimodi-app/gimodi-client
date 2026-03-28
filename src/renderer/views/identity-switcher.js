/**
 * Combined identity switcher + status picker.
 * Replaces the self-user button click with a unified popup menu.
 */
import { PRESENCE_STATUSES, getEffectivePresence, setPresence } from './sidebar.js';

const selfBtn = document.getElementById('btn-self-user');

/** @type {{ fingerprint: string, name: string } | null} */
let _activeIdentity = null;

/** @type {HTMLElement|null} */
let _menuEl = null;

/** @type {Function|null} */
let _onSwitch = null;

/** @type {Function|null} */
let _onLogout = null;

/**
 * Initializes the combined identity/status menu on the self-user button.
 * @param {{ onSwitch: Function, onLogout: Function }} callbacks
 */
export function initIdentitySwitcher({ onSwitch, onLogout }) {
  _onSwitch = onSwitch;
  _onLogout = onLogout;

  selfBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_menuEl) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  document.addEventListener('click', () => closeMenu());
}

/**
 * Updates the active identity state (used to highlight the current identity in the menu).
 * @param {{ fingerprint: string, name: string } | null} identity
 */
export function setActiveIdentity(identity) {
  _activeIdentity = identity;
}

/**
 * @private
 */
async function openMenu() {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'self-menu';
  menu.addEventListener('click', (e) => e.stopPropagation());

  // --- Identity section ---
  if (_activeIdentity) {
    const header = document.createElement('div');
    header.className = 'self-menu-header';
    header.textContent = _activeIdentity.name;
    menu.appendChild(header);
  }

  const identities = await window.gimodi.db.listIdentities();

  if (identities.length > 1) {
    const label = document.createElement('div');
    label.className = 'self-menu-label';
    label.textContent = 'Switch Identity';
    menu.appendChild(label);

    for (const id of identities) {
      if (_activeIdentity && id.fingerprint === _activeIdentity.fingerprint) {continue;}

      const item = document.createElement('div');
      item.className = 'self-menu-item';

      const icon = document.createElement('div');
      icon.className = 'self-menu-identity-icon';
      icon.textContent = (id.name || '?')[0].toUpperCase();

      const name = document.createElement('span');
      name.className = 'self-menu-identity-name';
      name.textContent = id.name;

      item.appendChild(icon);
      item.appendChild(name);

      item.addEventListener('click', () => {
        closeMenu();
        if (_onSwitch) {_onSwitch(id.fingerprint);}
      });

      menu.appendChild(item);
    }

    menu.appendChild(createDivider());
  }

  // --- Status section ---
  const statusLabel = document.createElement('div');
  statusLabel.className = 'self-menu-label';
  statusLabel.textContent = 'Status';
  menu.appendChild(statusLabel);

  for (const status of PRESENCE_STATUSES) {
    const item = document.createElement('div');
    item.className = 'self-menu-item' + (status.key === getEffectivePresence() ? ' active' : '');

    const dot = document.createElement('span');
    dot.className = 'status-picker-dot';
    dot.style.background = status.color;

    const label = document.createElement('span');
    label.textContent = status.label;

    item.appendChild(dot);
    item.appendChild(label);
    item.addEventListener('click', () => {
      setPresence(status.key);
      closeMenu();
    });
    menu.appendChild(item);
  }

  // --- Logout ---
  menu.appendChild(createDivider());

  const logoutItem = document.createElement('div');
  logoutItem.className = 'self-menu-item danger';
  logoutItem.textContent = 'Logout';
  logoutItem.addEventListener('click', () => {
    closeMenu();
    if (_onLogout) {_onLogout();}
  });
  menu.appendChild(logoutItem);

  document.body.appendChild(menu);

  // Position to the right of the button
  const btnRect = selfBtn.getBoundingClientRect();
  menu.style.left = btnRect.right + 8 + 'px';
  const menuHeight = menu.offsetHeight;
  menu.style.top = Math.max(4, btnRect.bottom - menuHeight) + 'px';

  _menuEl = menu;
}

/**
 * @private
 * @returns {HTMLElement}
 */
function createDivider() {
  const div = document.createElement('div');
  div.className = 'self-menu-divider';
  return div;
}

/**
 * @private
 */
function closeMenu() {
  if (_menuEl) {
    _menuEl.remove();
    _menuEl = null;
  }
}
