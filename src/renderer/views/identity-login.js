/**
 * Identity login/selection screen.
 * Shown when no active identity is set (first launch or after logout).
 */
import { customConfirm } from '../services/dialogs.js';

const loginView = document.getElementById('view-identity-login');
const loginList = document.getElementById('identity-login-list');
const loginCreate = document.getElementById('identity-login-create');
const loginNameInput = document.getElementById('identity-login-name');
const btnNew = document.getElementById('btn-identity-login-new');
const btnImport = document.getElementById('btn-identity-login-import');
const btnConfirm = document.getElementById('btn-identity-login-confirm');
const btnCancel = document.getElementById('btn-identity-login-cancel');
const loginStatus = document.getElementById('identity-login-status');

/** @type {Function|null} */
let _onLogin = null;

/**
 * Initializes the identity login screen.
 * @param {Function} onLogin - Called with the selected identity after login
 */
export function initIdentityLogin(onLogin) {
  _onLogin = onLogin;

  btnNew.addEventListener('click', () => {
    loginCreate.classList.remove('hidden');
    btnNew.parentElement.classList.add('hidden');
    loginNameInput.value = '';
    loginNameInput.focus();
  });

  btnCancel.addEventListener('click', () => {
    loginCreate.classList.add('hidden');
    btnNew.parentElement.classList.remove('hidden');
  });

  btnConfirm.addEventListener('click', createIdentity);

  loginNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createIdentity();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      loginCreate.classList.add('hidden');
      btnNew.parentElement.classList.remove('hidden');
    }
  });

  btnImport.addEventListener('click', async () => {
    loginStatus.textContent = '';
    try {
      const result = await window.gimodi.db.importIdentity();
      if (!result.canceled && result.identity) {
        await renderIdentityList();
      }
    } catch (err) {
      loginStatus.textContent = err.message || 'Import failed.';
    }
  });
}

/**
 * Shows the login screen and populates the identity list.
 */
export async function showIdentityLogin() {
  loginStatus.textContent = '';
  loginCreate.classList.add('hidden');
  btnNew.parentElement.classList.remove('hidden');
  await renderIdentityList();
  loginView.classList.remove('hidden');
}

/**
 * Hides the login screen.
 */
export function hideIdentityLogin() {
  loginView.classList.add('hidden');
}

/**
 * Returns true if the login screen is currently visible.
 * @returns {boolean}
 */
export function isLoginVisible() {
  return !loginView.classList.contains('hidden');
}

/**
 * @private
 */
async function renderIdentityList() {
  loginList.innerHTML = '';
  const identities = await window.gimodi.db.listIdentities();

  if (!identities || identities.length === 0) {
    loginList.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 16px 0;">No identities yet. Create one to get started.</div>';
    return;
  }

  for (const id of identities) {
    const item = document.createElement('div');
    item.className = 'identity-login-item';

    const icon = document.createElement('div');
    icon.className = 'identity-login-item-icon';
    icon.textContent = (id.name || '?')[0].toUpperCase();

    const info = document.createElement('div');
    info.className = 'identity-login-item-info';

    const name = document.createElement('div');
    name.className = 'identity-login-item-name';
    name.textContent = id.name;

    const fp = document.createElement('div');
    fp.className = 'identity-login-item-fp';
    fp.textContent = id.fingerprint.toUpperCase().slice(0, 16) + '...';

    info.appendChild(name);
    info.appendChild(fp);

    const actions = document.createElement('div');
    actions.className = 'identity-login-item-actions';

    const btnRename = document.createElement('button');
    btnRename.title = 'Rename';
    btnRename.innerHTML = '<i class="bi bi-pencil"></i>';
    btnRename.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(id, name, icon);
    });

    const btnExport = document.createElement('button');
    btnExport.title = 'Export';
    btnExport.innerHTML = '<i class="bi bi-download"></i>';
    btnExport.addEventListener('click', (e) => {
      e.stopPropagation();
      exportIdentity(id);
    });

    const btnDelete = document.createElement('button');
    btnDelete.title = 'Delete';
    btnDelete.className = 'danger';
    btnDelete.innerHTML = '<i class="bi bi-trash"></i>';
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteIdentity(id);
    });

    actions.appendChild(btnRename);
    actions.appendChild(btnExport);
    actions.appendChild(btnDelete);

    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(actions);

    item.addEventListener('click', () => selectIdentity(id.fingerprint));

    loginList.appendChild(item);
  }
}

/**
 * @private
 * @param {Object} id
 * @param {HTMLElement} nameEl
 * @param {HTMLElement} iconEl
 */
function startRename(id, nameEl, iconEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = id.name;
  input.maxLength = 64;
  input.className = 'identity-login-rename-input';
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  async function finish(save) {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    if (save && newName && newName !== id.name) {
      try {
        await window.gimodi.db.renameIdentity(id.fingerprint, newName);
      } catch (err) {
        loginStatus.textContent = err.message || 'Rename failed.';
      }
    }
    await renderIdentityList();
  }

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * @private
 * @param {Object} id
 */
async function exportIdentity(id) {
  loginStatus.textContent = '';
  try {
    await window.gimodi.db.exportIdentity(id.fingerprint);
  } catch (err) {
    loginStatus.textContent = err.message || 'Export failed.';
  }
}

/**
 * @private
 * @param {Object} id
 */
async function deleteIdentity(id) {
  loginStatus.textContent = '';
  if (!(await customConfirm(`Delete identity "${id.name}"? This cannot be undone.`))) return;
  try {
    await window.gimodi.db.deleteIdentity(id.fingerprint);
    await renderIdentityList();
  } catch (err) {
    loginStatus.textContent = err.message || 'Delete failed.';
  }
}

/**
 * @private
 */
async function createIdentity() {
  const name = loginNameInput.value.trim();
  if (!name) return;

  loginStatus.textContent = '';
  btnConfirm.disabled = true;

  try {
    const result = await window.gimodi.db.createIdentity(name);
    loginCreate.classList.add('hidden');
    btnNew.parentElement.classList.remove('hidden');
    loginNameInput.value = '';
    await renderIdentityList();
  } catch (err) {
    loginStatus.textContent = err.message || 'Failed to create identity.';
  } finally {
    btnConfirm.disabled = false;
  }
}

/**
 * @private
 * @param {string} fingerprint
 */
async function selectIdentity(fingerprint) {
  loginStatus.textContent = '';
  try {
    const identity = await window.gimodi.db.switchIdentity(fingerprint);
    hideIdentityLogin();
    if (_onLogin) _onLogin(identity);
  } catch (err) {
    loginStatus.textContent = err.message || 'Failed to switch identity.';
  }
}
