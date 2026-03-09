const listEl = document.getElementById('identity-list');
const statusEl = document.getElementById('status');
const createForm = document.getElementById('create-form');
const inputName = document.getElementById('input-name');
const btnCreate = document.getElementById('btn-create');
const btnImport = document.getElementById('btn-import');
const btnCreateConfirm = document.getElementById('btn-create-confirm');
const btnCreateCancel = document.getElementById('btn-create-cancel');

/**
 * @returns {Promise<void>}
 */
async function render() {
  const identities = await window.gimodi.identity.loadAll();
  listEl.innerHTML = '';

  for (const id of identities) {
    const el = document.createElement('div');
    el.className = 'identity-item';

    const fp = id.fingerprint.toUpperCase();
    const fpDisplay = fp.slice(0, 8) + '...' + fp.slice(-8);
    const date = new Date(id.createdAt).toLocaleDateString();

    el.dataset.fp = id.fingerprint;
    el.dataset.name = id.name;
    el.innerHTML = `
      <div class="identity-info">
        <div class="identity-name">
          <span class="identity-name-text">${escapeHtml(id.name)}</span>
          ${id.isDefault ? '<span class="identity-default-badge">DEFAULT</span>' : ''}
        </div>
        <div class="identity-fingerprint">${fpDisplay} &middot; ${date}</div>
      </div>
      <div class="identity-actions">
        ${!id.isDefault ? `<button class="btn-set-default" data-fp="${id.fingerprint}">Set Default</button>` : ''}
        <button class="btn-export" data-fp="${id.fingerprint}">Export</button>
        ${identities.length > 1 ? `<button class="btn-danger btn-delete" data-fp="${id.fingerprint}">Delete</button>` : ''}
      </div>
    `;
    listEl.appendChild(el);
  }

  for (const btn of listEl.querySelectorAll('.btn-set-default')) {
    btn.addEventListener('click', async () => {
      await window.gimodi.identity.setDefault(btn.dataset.fp);
      render();
    });
  }

  for (const btn of listEl.querySelectorAll('.btn-export')) {
    btn.addEventListener('click', async () => {
      try {
        const result = await window.gimodi.identity.export(btn.dataset.fp);
        if (!result.canceled) {
          statusEl.textContent = `Exported to ${result.filePath}`;
          setTimeout(() => { statusEl.textContent = ''; }, 4000);
        }
      } catch (err) {
        statusEl.textContent = err.message || 'Export failed.';
      }
    });
  }

  for (const nameEl of listEl.querySelectorAll('.identity-name')) {
    nameEl.style.cursor = 'default';
    nameEl.querySelector('.identity-name-text').addEventListener('click', () => {
      const item = nameEl.closest('.identity-item');
      const fp = item.dataset.fp;
      const currentName = item.dataset.name;
      const nameTextEl = nameEl.querySelector('.identity-name-text');

      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentName;
      input.maxLength = 64;
      input.style.cssText = 'background:var(--bg-input);color:var(--text-primary);border:1px solid var(--accent);border-radius:4px;padding:2px 6px;font-size:14px;font-weight:500;outline:none;';

      nameTextEl.replaceWith(input);
      input.focus();
      input.select();

      let done = false;
      /** @param {boolean} save */
      async function finish(save) {
        if (done) return;
        done = true;
        const newName = input.value.trim();
        if (save && newName && newName !== currentName) {
          try {
            await window.gimodi.identity.rename(fp, newName);
          } catch (err) {
            statusEl.textContent = err.message || 'Rename failed.';
          }
        }
        render();
      }

      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
    });
  }

  for (const btn of listEl.querySelectorAll('.btn-delete')) {
    btn.addEventListener('click', async () => {
      try {
        await window.gimodi.identity.delete(btn.dataset.fp);
        render();
      } catch (err) {
        statusEl.textContent = err.message || 'Failed to delete identity.';
      }
    });
  }
}

btnCreate.addEventListener('click', () => {
  createForm.classList.add('active');
  inputName.value = '';
  inputName.focus();
  statusEl.textContent = '';
});

btnCreateCancel.addEventListener('click', () => {
  createForm.classList.remove('active');
});

btnCreateConfirm.addEventListener('click', handleCreate);
inputName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreate();
  if (e.key === 'Escape') createForm.classList.remove('active');
});

/**
 * @returns {Promise<void>}
 */
async function handleCreate() {
  const name = inputName.value.trim();
  if (!name) {
    statusEl.textContent = 'Name is required.';
    return;
  }
  statusEl.textContent = 'Generating key pair...';
  btnCreateConfirm.disabled = true;
  try {
    await window.gimodi.identity.create(name);
    createForm.classList.remove('active');
    statusEl.textContent = '';
    render();
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to create identity.';
  } finally {
    btnCreateConfirm.disabled = false;
  }
}

btnImport.addEventListener('click', async () => {
  statusEl.textContent = '';
  try {
    const result = await window.gimodi.identity.import();
    if (!result.canceled) {
      statusEl.textContent = `Imported "${result.identity.name}" successfully.`;
      setTimeout(() => { statusEl.textContent = ''; }, 4000);
      render();
    }
  } catch (err) {
    statusEl.textContent = err.message || 'Import failed.';
  }
});

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

render();
