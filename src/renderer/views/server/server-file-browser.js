import serverService from '../../services/server.js';
import { customAlert, customConfirm } from '../../services/dialogs.js';
import { escapeHtml } from '../chat/chat-markdown.js';

/**
 * Formats a byte count into a human-readable file size string.
 * @param {number} bytes - The size in bytes.
 * @returns {string} The formatted size string (e.g. "1.5 MB").
 */
function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Derives the HTTP base URL from the current server WebSocket address.
 * @returns {string} The HTTP(S) base URL corresponding to the server connection.
 */
function getFileBrowserHttpBaseUrl() {
  const addr = serverService.address;
  if (!addr) {
    return '';
  }
  if (addr.startsWith('ws://')) {
    return addr.replace(/^ws:\/\//, 'http://');
  }
  if (addr.startsWith('wss://')) {
    return addr.replace(/^wss:\/\//, 'https://');
  }
  return `https://${addr}`;
}

/**
 * Returns a Bootstrap icon class name appropriate for the given MIME type.
 * @param {string} mimeType - The MIME type of the file.
 * @returns {string} A Bootstrap icon class name.
 */
function getFileIcon(mimeType) {
  if (!mimeType) {
    return 'bi-file-earmark';
  }
  if (mimeType.startsWith('image/')) {
    return 'bi-file-earmark-image';
  }
  if (mimeType.startsWith('video/')) {
    return 'bi-file-earmark-play';
  }
  if (mimeType.startsWith('audio/')) {
    return 'bi-file-earmark-music';
  }
  if (mimeType === 'application/pdf') {
    return 'bi-file-earmark-pdf';
  }
  if (mimeType === 'application/zip') {
    return 'bi-file-earmark-zip';
  }
  if (mimeType.startsWith('text/')) {
    return 'bi-file-earmark-text';
  }
  return 'bi-file-earmark';
}

/**
 * Displays a modal dialog for browsing and managing files uploaded to a channel.
 * Supports searching, sorting, downloading, and bulk deletion of files.
 * @param {Object} ch - The channel object.
 * @param {string} ch.id - The channel's unique identifier.
 * @param {string} ch.name - The channel's display name.
 * @returns {void}
 */
async function showFileBrowserModal(ch) {
  const existing = document.querySelector('.modal-file-browser');
  if (existing) {
    existing.remove();
  }

  const canDelete = serverService.hasPermission('file.delete');
  const baseUrl = getFileBrowserHttpBaseUrl();

  const modal = document.createElement('div');
  modal.className = 'modal modal-file-browser';

  modal.innerHTML = `<div class="modal-content" style="width: 700px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column;">
    <div style="display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 12px 0;">
      <h2 style="margin: 0; font-size: 1.1rem;">File Browser - ${escapeHtml(ch.name)}</h2>
      <span class="file-browser-stats" style="font-size: 0.8rem; color: var(--text-muted, #888);"></span>
    </div>
    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
      <input type="text" class="file-browser-search" placeholder="Search files..." style="flex: 1 1 auto; min-width: 0; width: 0; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-color, #444); background: var(--bg-input, #2a2a2a); color: var(--text-color, #eee); font-size: 0.85rem;">
      <select class="file-browser-sort" style="flex: 0 0 auto; width: 130px; padding: 6px 4px; border-radius: 4px; border: 1px solid var(--border-color, #444); background: var(--bg-input, #2a2a2a); color: var(--text-color, #eee); font-size: 0.78rem; cursor: pointer;">
        <option value="date-desc">Newest</option>
        <option value="date-asc">Oldest</option>
        <option value="size-desc">Largest</option>
        <option value="size-asc">Smallest</option>
        <option value="name-asc">Name A–Z</option>
        <option value="name-desc">Name Z–A</option>
      </select>
    </div>
    ${
      canDelete
        ? `<div class="file-browser-selection-bar" style="display: none; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.8rem;">
      <button class="btn-secondary file-browser-bulk-toggle" style="padding: 4px 10px; font-size: 0.78rem;"><i class="bi bi-check2-square"></i> Bulk select</button>
      <label class="file-browser-bulk-controls" style="display: none; align-items: center; gap: 4px; cursor: pointer;"><input type="checkbox" class="file-browser-select-all"> Select all</label>
      <span class="file-browser-selection-count" style="color: var(--text-muted, #888);"></span>
      <button class="btn-secondary file-browser-delete-selected danger" style="display: none; margin-left: auto; padding: 4px 10px; font-size: 0.78rem; color: var(--danger-color, #e74c3c);"><i class="bi bi-trash"></i> Delete selected</button>
    </div>`
        : ''
    }
    <div class="file-browser-list" style="flex: 1; overflow-y: auto; min-height: 200px;"></div>
    <div class="file-browser-load-more" style="text-align: center; padding: 8px; display: none;">
      <button class="btn-secondary file-browser-load-more-btn" style="font-size: 0.8rem;">Load more</button>
    </div>
    <div class="modal-buttons" style="margin-top: 10px;">
      <button class="btn-secondary modal-cancel-btn">Close</button>
    </div>
  </div>`;

  document.body.appendChild(modal);

  const listEl = modal.querySelector('.file-browser-list');
  const searchInput = modal.querySelector('.file-browser-search');
  const sortSelect = modal.querySelector('.file-browser-sort');
  const loadMoreContainer = modal.querySelector('.file-browser-load-more');
  const loadMoreBtn = modal.querySelector('.file-browser-load-more-btn');
  const statsEl = modal.querySelector('.file-browser-stats');

  const selectionBar = canDelete ? modal.querySelector('.file-browser-selection-bar') : null;
  const bulkToggleBtn = canDelete ? modal.querySelector('.file-browser-bulk-toggle') : null;
  const bulkControls = canDelete ? modal.querySelector('.file-browser-bulk-controls') : null;
  const selectAllCheckbox = canDelete ? modal.querySelector('.file-browser-select-all') : null;
  const selectionCountEl = canDelete ? modal.querySelector('.file-browser-selection-count') : null;
  const deleteSelectedBtn = canDelete ? modal.querySelector('.file-browser-delete-selected') : null;

  let allFiles = [];
  let oldestTimestamp = null;
  let hasMore = true;
  let bulkMode = false;
  const selectedIds = new Set();

  /**
   * Updates the file count and total size display in the modal header.
   * @returns {void}
   */
  function updateStats() {
    const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
    statsEl.textContent = `${allFiles.length} file${allFiles.length !== 1 ? 's' : ''}${hasMore ? '+' : ''} · ${formatFileSize(totalSize)}${hasMore ? '+' : ''}`;
  }

  /**
   * Updates the bulk selection UI elements based on current selection state.
   * @returns {void}
   */
  function updateSelectionUI() {
    if (!selectionBar) {
      return;
    }
    selectionBar.style.display = allFiles.length > 0 ? 'flex' : 'none';
    bulkControls.style.display = bulkMode ? 'flex' : 'none';
    deleteSelectedBtn.style.display = bulkMode ? '' : 'none';
    const count = selectedIds.size;
    selectionCountEl.textContent = bulkMode && count > 0 ? `${count} selected` : '';
    deleteSelectedBtn.disabled = count === 0;
    deleteSelectedBtn.style.opacity = count === 0 ? '0.5' : '1';
    const visibleCheckboxes = listEl.querySelectorAll('.file-row-checkbox');
    const allChecked = visibleCheckboxes.length > 0 && [...visibleCheckboxes].every((cb) => cb.checked);
    const someChecked = [...visibleCheckboxes].some((cb) => cb.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  }

  /**
   * Sorts an array of file objects according to the currently selected sort mode.
   * @param {Array<Object>} files - The files to sort.
   * @returns {Array<Object>} A new sorted array of files.
   */
  function sortFiles(files) {
    const mode = sortSelect.value;
    const sorted = [...files];
    switch (mode) {
      case 'date-desc':
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'date-asc':
        sorted.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'size-desc':
        sorted.sort((a, b) => b.size - a.size);
        break;
      case 'size-asc':
        sorted.sort((a, b) => a.size - b.size);
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.filename.localeCompare(a.filename));
        break;
    }
    return sorted;
  }

  /**
   * Renders the file list in the modal, applying an optional search filter and current sort order.
   * @param {string} [filter] - Optional search string to filter files by filename.
   * @returns {void}
   */
  function renderFiles(filter) {
    let filtered = filter ? allFiles.filter((f) => f.filename.toLowerCase().includes(filter.toLowerCase())) : allFiles;
    filtered = sortFiles(filtered);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted, #888); padding: 40px 0;">${allFiles.length === 0 ? 'No files uploaded in this channel.' : 'No files match your search.'}</div>`;
      updateSelectionUI();
      return;
    }

    listEl.innerHTML = '';
    for (const file of filtered) {
      const row = document.createElement('div');
      row.className = 'file-browser-row';
      row.style.cssText = 'display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #333); gap: 10px; font-size: 0.85rem;';

      const icon = getFileIcon(file.mimeType);
      const date = new Date(file.createdAt);
      const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      row.innerHTML = `
        ${canDelete && bulkMode ? `<input type="checkbox" class="file-row-checkbox" data-file-id="${file.id}" ${selectedIds.has(file.id) ? 'checked' : ''} style="flex-shrink: 0; cursor: pointer;">` : ''}
        <i class="bi ${icon}" style="font-size: 1.3rem; flex-shrink: 0; width: 24px; text-align: center;"></i>
        <div style="flex: 1; min-width: 0;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted, #888);">${escapeHtml(file.nickname)} · ${dateStr} ${timeStr} · ${formatFileSize(file.size)}</div>
        </div>
        ${canDelete ? `<button class="btn-secondary file-delete-btn" title="Delete" style="flex-shrink: 0; padding: 4px 8px; font-size: 0.8rem; color: var(--danger-color, #e74c3c);"><i class="bi bi-trash"></i></button>` : ''}
        <button class="btn-secondary file-download-btn" title="Download" style="flex-shrink: 0; padding: 4px 8px; font-size: 0.8rem;"><i class="bi bi-download"></i></button>
      `;

      if (canDelete && bulkMode) {
        row.querySelector('.file-row-checkbox').addEventListener('change', (e) => {
          if (e.target.checked) {
            selectedIds.add(file.id);
          } else {
            selectedIds.delete(file.id);
          }
          updateSelectionUI();
        });
      }

      if (canDelete) {
        row.querySelector('.file-delete-btn').addEventListener('click', async () => {
          if (!(await customConfirm(`Delete "${file.filename}"?`))) {
            return;
          }
          try {
            await serverService.request('file:delete', { fileId: file.id });
            allFiles = allFiles.filter((f) => f.id !== file.id);
            selectedIds.delete(file.id);
            updateStats();
            renderFiles(searchInput.value);
          } catch {
            await customAlert('Failed to delete file.');
          }
        });
      }

      row.querySelector('.file-download-btn').addEventListener('click', () => {
        const url = baseUrl + file.url;
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        a.target = '_blank';
        a.click();
      });

      listEl.appendChild(row);
    }
    updateSelectionUI();
  }

  /**
   * Loads the next batch of files from the server for the current channel.
   * @returns {Promise<void>}
   */
  async function loadFiles() {
    try {
      const result = await serverService.request('file:list', {
        channelId: ch.id,
        before: oldestTimestamp || undefined,
        limit: 50,
      });
      const files = result.files || [];
      allFiles = allFiles.concat(files);
      if (files.length > 0) {
        oldestTimestamp = files[files.length - 1].createdAt;
      }
      hasMore = files.length >= 50;
      loadMoreContainer.style.display = hasMore ? '' : 'none';
      updateStats();
      renderFiles(searchInput.value);
    } catch (err) {
      listEl.innerHTML = `<div style="text-align: center; color: var(--danger-color, #e74c3c); padding: 40px 0;">Failed to load files: ${escapeHtml(err.message)}</div>`;
    }
  }

  searchInput.addEventListener('input', () => renderFiles(searchInput.value));
  sortSelect.addEventListener('change', () => renderFiles(searchInput.value));
  loadMoreBtn.addEventListener('click', loadFiles);

  if (canDelete) {
    bulkToggleBtn.addEventListener('click', () => {
      bulkMode = !bulkMode;
      bulkToggleBtn.style.opacity = bulkMode ? '1' : '0.7';
      if (!bulkMode) {
        selectedIds.clear();
        selectAllCheckbox.checked = false;
      }
      renderFiles(searchInput.value);
    });

    selectAllCheckbox.addEventListener('change', () => {
      const checkboxes = listEl.querySelectorAll('.file-row-checkbox');
      for (const cb of checkboxes) {
        cb.checked = selectAllCheckbox.checked;
        if (selectAllCheckbox.checked) {
          selectedIds.add(cb.dataset.fileId);
        } else {
          selectedIds.delete(cb.dataset.fileId);
        }
      }
      updateSelectionUI();
    });

    deleteSelectedBtn.addEventListener('click', async () => {
      const count = selectedIds.size;
      if (count === 0) {
        return;
      }
      if (!(await customConfirm(`Delete ${count} file${count !== 1 ? 's' : ''}?`))) {
        return;
      }
      const ids = [...selectedIds];
      let failed = 0;
      for (const id of ids) {
        try {
          await serverService.request('file:delete', { fileId: id });
          allFiles = allFiles.filter((f) => f.id !== id);
          selectedIds.delete(id);
        } catch {
          failed++;
        }
      }
      updateStats();
      renderFiles(searchInput.value);
      if (failed > 0) {
        await customAlert(`${failed} file${failed !== 1 ? 's' : ''} could not be deleted.`);
      }
    });
  }

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  modal.querySelector('.modal-cancel-btn').addEventListener('click', closeModal);
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

  listEl.innerHTML = '<div style="text-align: center; padding: 40px 0; color: var(--text-muted, #888);">Loading...</div>';
  loadFiles();
}

export { showFileBrowserModal };
