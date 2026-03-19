import serverService from '../services/server.js';
import { getServerIcon } from '../services/iconCache.js';
import { escapeHtml, getChannels } from './server.js';

/**
 * Flattens a nested configuration object into dot-separated key-value pairs.
 * @param {Object} obj - The nested configuration object to flatten.
 * @param {string} [prefix=''] - The current key prefix for recursion.
 * @returns {Object} A flat object with dot-separated keys.
 */
function flattenConfig(obj, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenConfig(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

/**
 * Converts a flat dot-separated key-value object back into a nested object.
 * @param {Object} flat - The flat object with dot-separated keys.
 * @returns {Object} A nested object reconstructed from the flat keys.
 */
function unflattenConfig(flat) {
  const result = {};
  for (const [dotKey, val] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return result;
}

/**
 * Displays a modal for cropping an image to a circular icon.
 * Supports drag-to-pan and zoom via slider or mouse wheel.
 * Resolves with a PNG Blob of the cropped 256x256 icon, or null if cancelled.
 * @param {string} dataUrl - The data URL of the image to crop.
 * @returns {Promise<Blob|null>} The cropped image blob or null if the user cancels.
 */
function showIconCropModal(dataUrl) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.zIndex = '10100';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:460px;width:90vw;padding:20px">
        <h2 style="margin-bottom:12px">Crop Icon</h2>
        <div class="icon-crop-area" style="position:relative;width:400px;max-width:100%;aspect-ratio:1;margin:0 auto 16px;overflow:hidden;border-radius:50%;background:#000;cursor:grab;touch-action:none">
          <img style="position:absolute;transform-origin:0 0;pointer-events:none;user-select:none" draggable="false">
          <div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 2px var(--accent, #5865f2);pointer-events:none"></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:0 4px">
          <i class="bi bi-image" style="font-size:14px;color:var(--text-muted)"></i>
          <input type="range" class="icon-crop-zoom" min="100" max="500" value="100" style="flex:1;cursor:pointer">
          <i class="bi bi-image" style="font-size:20px;color:var(--text-muted)"></i>
        </div>
        <div class="modal-buttons" style="justify-content:flex-end">
          <button class="btn-secondary icon-crop-cancel">Cancel</button>
          <button class="btn-primary icon-crop-apply">Apply</button>
        </div>
      </div>
    `;

    const cropArea = overlay.querySelector('.icon-crop-area');
    const img = cropArea.querySelector('img');
    const zoomSlider = overlay.querySelector('.icon-crop-zoom');
    const cancelBtn = overlay.querySelector('.icon-crop-cancel');
    const applyBtn = overlay.querySelector('.icon-crop-apply');

    let imgW = 0,
      imgH = 0;
    let scale = 1;
    let offsetX = 0,
      offsetY = 0;
    let dragging = false,
      dragStartX = 0,
      dragStartY = 0,
      startOX = 0,
      startOY = 0;

    /**
     * Returns the current pixel width of the crop area element.
     * @returns {number} The width of the crop area in pixels.
     */
    function areaSize() {
      return cropArea.getBoundingClientRect().width;
    }

    /**
     * Clamps the pan offset so the image fully covers the circular crop area.
     * @returns {void}
     */
    function clampOffset() {
      const s = areaSize();
      const sw = imgW * scale,
        sh = imgH * scale;
      offsetX = Math.min(0, Math.max(s - sw, offsetX));
      offsetY = Math.min(0, Math.max(s - sh, offsetY));
    }

    /**
     * Applies the current offset and scale as a CSS transform on the image.
     * @returns {void}
     */
    function applyTransform() {
      img.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    }

    /**
     * Fits the image to cover the crop area and centers it.
     * @returns {void}
     */
    function fitInitial() {
      const s = areaSize();
      const minDim = Math.min(imgW, imgH);
      scale = s / minDim;
      offsetX = (s - imgW * scale) / 2;
      offsetY = (s - imgH * scale) / 2;
      zoomSlider.min = '100';
      zoomSlider.value = '100';
      applyTransform();
    }

    const imgEl = new Image();
    imgEl.onload = () => {
      imgW = imgEl.width;
      imgH = imgEl.height;
      img.src = dataUrl;
      img.style.width = imgW + 'px';
      img.style.height = imgH + 'px';
      requestAnimationFrame(() => requestAnimationFrame(fitInitial));
    };
    imgEl.src = dataUrl;

    /**
     * Computes the base scale factor that fits the smaller image dimension to the crop area.
     * @returns {number} The base scale factor.
     */
    const baseScale = () => {
      const s = areaSize();
      return s / Math.min(imgW, imgH);
    };

    zoomSlider.addEventListener('input', () => {
      const s = areaSize();
      const pct = parseInt(zoomSlider.value) / 100;
      const oldScale = scale;
      scale = baseScale() * pct;
      const cx = s / 2,
        cy = s / 2;
      offsetX = cx - (cx - offsetX) * (scale / oldScale);
      offsetY = cy - (cy - offsetY) * (scale / oldScale);
      clampOffset();
      applyTransform();
    });

    cropArea.addEventListener('pointerdown', (e) => {
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      startOX = offsetX;
      startOY = offsetY;
      cropArea.style.cursor = 'grabbing';
      cropArea.setPointerCapture(e.pointerId);
    });
    cropArea.addEventListener('pointermove', (e) => {
      if (!dragging) {
        return;
      }
      offsetX = startOX + (e.clientX - dragStartX);
      offsetY = startOY + (e.clientY - dragStartY);
      clampOffset();
      applyTransform();
    });
    cropArea.addEventListener('pointerup', () => {
      dragging = false;
      cropArea.style.cursor = 'grab';
    });

    cropArea.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        let val = parseInt(zoomSlider.value) - Math.sign(e.deltaY) * 10;
        val = Math.max(parseInt(zoomSlider.min), Math.min(parseInt(zoomSlider.max), val));
        zoomSlider.value = val;
        zoomSlider.dispatchEvent(new Event('input'));
      },
      { passive: false },
    );

    /**
     * Removes the crop modal overlay and resolves the promise with the given result.
     * @param {Blob|null} result - The cropped image blob or null.
     * @returns {void}
     */
    function close(result) {
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close(null);
      }
    });

    applyBtn.addEventListener('click', () => {
      const s = areaSize();
      const outputSize = 256;
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      const srcX = -offsetX / scale;
      const srcY = -offsetY / scale;
      const srcSize = s / scale;
      ctx.drawImage(imgEl, srcX, srcY, srcSize, srcSize, 0, 0, outputSize, outputSize);
      canvas.toBlob((blob) => close(blob), 'image/png');
    });

    document.body.appendChild(overlay);
  });
}

/**
 * Renders the server settings panel into a container element.
 * Loads current settings from the server, displays grouped setting inputs
 * with icon management, and handles saving changes.
 * @param {HTMLElement} container - The DOM element to render the settings panel into.
 * @returns {Promise<void>}
 */
async function renderSettingsPanel(container) {
  container.innerHTML = `
    <div class="settings-form" style="overflow-y:auto;margin-bottom:12px">
      <p class="text-muted" style="font-size:13px">Loading...</p>
    </div>
    <div class="settings-status" style="min-height:20px;font-size:13px;margin-bottom:8px"></div>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn-primary settings-save-btn" disabled>Save</button>
    </div>
  `;

  const formEl = container.querySelector('.settings-form');
  const statusEl = container.querySelector('.settings-status');
  const saveBtn = container.querySelector('.settings-save-btn');

  let flatSettings = {};
  let envLockedKeys = new Set();

  try {
    const res = await serverService.request('server:get-settings', {});
    flatSettings = flattenConfig(res.settings);
    if (Array.isArray(res.envLockedKeys)) {
      envLockedKeys = new Set(res.envLockedKeys);
    }
  } catch (err) {
    formEl.innerHTML = `<p style="color:var(--danger)">Failed to load settings: ${escapeHtml(String(err.message || err))}</p>`;
    return;
  }

  const SETTING_LABELS = {
    name: 'Server Name',
    port: 'Port',
    password: 'Server Password',
    maxClients: 'Max Clients',
    maxConnectionsPerIp: 'Max Connections per IP',
    generateAdminToken: 'Generate Admin Token on Start',
    'media.listenIp': 'Listen IP',
    'media.announcedIp': 'Announced IP',
    'media.rtcPort': 'RTC Base Port',
    'media.workers': 'Media Workers (0 = auto)',
    'media.logLevel': 'Log Level',
    'chat.persistMessages': 'Persist Messages',
    'chat.tempChannelDeleteDelay': 'Temp Channel Auto-Delete Delay',
    defaultChannelId: 'Default Channel',
    'files.maxFileSize': 'Max Upload Size',
    'files.storagePath': 'Storage Path',
    'files.publicUrl': 'Public URL',
    'ssl.certPath': 'Certificate Path',
    'ssl.keyPath': 'Key Path',
  };

  const SETTING_GROUPS = [
    { label: 'General', icon: 'bi-gear', keys: ['name', 'port', 'password', 'maxClients', 'maxConnectionsPerIp', 'defaultChannelId', 'generateAdminToken'] },
    { label: 'Media', icon: 'bi-broadcast', keys: ['media.listenIp', 'media.announcedIp', 'media.rtcPort', 'media.workers', 'media.logLevel'] },
    { label: 'Chat', icon: 'bi-chat-dots', keys: ['chat.persistMessages', 'chat.tempChannelDeleteDelay'] },
    { label: 'Files', icon: 'bi-folder', keys: ['files.maxFileSize', 'files.storagePath', 'files.publicUrl'] },
    { label: 'SSL', icon: 'bi-shield-lock', keys: ['ssl.certPath', 'ssl.keyPath'] },
  ];

  formEl.innerHTML = '';

  const iconSection = document.createElement('div');
  iconSection.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:8px 0';

  const iconPreview = document.createElement('img');
  iconPreview.style.cssText = 'width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--bg-secondary)';
  iconPreview.src = '../../assets/icon.png';

  const currentIconHash = flatSettings['icon.hash'] || null;
  if (currentIconHash) {
    getServerIcon(serverService.address, currentIconHash).then((url) => {
      if (url) {
        iconPreview.src = url;
      }
    });
  }

  const iconControls = document.createElement('div');
  iconControls.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const iconFileInput = document.createElement('input');
  iconFileInput.type = 'file';
  iconFileInput.accept = 'image/*';
  iconFileInput.style.display = 'none';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn-primary';
  uploadBtn.textContent = 'Upload Icon';
  uploadBtn.style.cssText = 'font-size:12px;padding:4px 12px';
  uploadBtn.addEventListener('click', () => iconFileInput.click());

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-secondary';
  removeBtn.textContent = 'Remove Icon';
  removeBtn.style.cssText = 'font-size:12px;padding:4px 12px';
  removeBtn.style.display = currentIconHash ? '' : 'none';

  iconFileInput.addEventListener('change', async () => {
    const file = iconFileInput.files[0];
    if (!file) {
      return;
    }

    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) {
      iconFileInput.value = '';
      return;
    }

    const croppedBlob = await showIconCropModal(dataUrl);
    iconFileInput.value = '';
    if (!croppedBlob) {
      return;
    }

    statusEl.textContent = 'Uploading icon...';
    statusEl.style.color = 'var(--text-muted)';
    try {
      const buffer = await croppedBlob.arrayBuffer();
      const data = await window.gimodi.iconCache.upload(serverService.address, serverService.clientId, 'image/png', new Uint8Array(buffer));
      if (data.error) {
        throw new Error(data.error);
      }
      statusEl.textContent = 'Icon updated.';
      statusEl.style.color = 'var(--success, #4caf50)';
      const url = await getServerIcon(serverService.address, data.hash);
      if (url) {
        iconPreview.src = url;
      }
      removeBtn.style.display = '';
    } catch (err) {
      statusEl.textContent = `Icon upload failed: ${err.message}`;
      statusEl.style.color = 'var(--danger)';
    }
  });

  removeBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Removing icon...';
    statusEl.style.color = 'var(--text-muted)';
    try {
      const data = await window.gimodi.iconCache.delete(serverService.address, serverService.clientId);
      if (data.error) {
        throw new Error(data.error);
      }
      statusEl.textContent = 'Icon removed.';
      statusEl.style.color = 'var(--success, #4caf50)';
      iconPreview.src = '../../assets/icon.png';
      removeBtn.style.display = 'none';
    } catch (err) {
      statusEl.textContent = `Icon removal failed: ${err.message}`;
      statusEl.style.color = 'var(--danger)';
    }
  });

  iconControls.append(iconFileInput, uploadBtn, removeBtn);
  iconSection.append(iconPreview, iconControls);
  formEl.appendChild(iconSection);

  delete flatSettings['icon.hash'];
  delete flatSettings['icon.filename'];

  const inputStyle = 'width:100%;box-sizing:border-box;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px';
  const smallInputStyle = 'width:80px;box-sizing:border-box;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px';
  const selectStyle = 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;cursor:pointer';

  const lockedStyle = 'opacity:0.6;cursor:not-allowed';
  const lockIcon = '<i class="bi bi-lock-fill" style="font-size:11px;color:var(--text-muted)" title="Locked by environment variable"></i>';

  const channels = getChannels();

  /**
   * Builds an HTML input element string for a given settings key and value.
   * Handles special cases like channel selectors, duration inputs, file size inputs,
   * booleans, numbers, and strings. Disables inputs locked by environment variables.
   * @param {string} key - The dot-separated settings key.
   * @param {*} val - The current value for this setting.
   * @returns {string} An HTML string for the input element.
   */
  function buildInput(key, val) {
    const type = typeof val;
    const locked = envLockedKeys.has(key);
    const dis = locked ? ' disabled' : '';
    if (key === 'defaultChannelId') {
      const nonGroupChannels = channels.filter((c) => c.type !== 'group');
      const currentDefault = val || nonGroupChannels.find((c) => c.isDefault)?.id || '';
      const options = nonGroupChannels.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === currentDefault ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
      return `<select data-key="${escapeHtml(key)}" data-type="string" style="width:200px;${selectStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>${options}</select>${locked ? ` ${lockIcon}` : ''}`;
    } else if (key === 'chat.tempChannelDeleteDelay' && type === 'number') {
      let dUnit = 'seconds',
        dVal = val;
      if (val >= 3600 && val % 3600 === 0) {
        dUnit = 'hours';
        dVal = val / 3600;
      } else if (val >= 60 && val % 60 === 0) {
        dUnit = 'minutes';
        dVal = val / 60;
      }
      return `<div style="display:flex;gap:6px;align-items:center">
        <input type="number" min="1" data-key="${escapeHtml(key)}" data-type="duration" value="${dVal}" style="${smallInputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
        <select data-key="${escapeHtml(key)}-unit" style="width:90px;${selectStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
          <option value="seconds" ${dUnit === 'seconds' ? 'selected' : ''}>Seconds</option>
          <option value="minutes" ${dUnit === 'minutes' ? 'selected' : ''}>Minutes</option>
          <option value="hours" ${dUnit === 'hours' ? 'selected' : ''}>Hours</option>
        </select>
        ${locked ? lockIcon : ''}
      </div>`;
    } else if (key === 'files.maxFileSize' && type === 'number') {
      const isGb = val >= 1024 * 1024 * 1024 && val % (1024 * 1024 * 1024) === 0;
      const unit = isGb ? 'GB' : 'MB';
      const divisor = isGb ? 1024 * 1024 * 1024 : 1024 * 1024;
      return `<div style="display:flex;gap:6px;align-items:center">
        <input type="number" min="1" data-key="${escapeHtml(key)}" data-type="filesize" value="${val / divisor}" style="${smallInputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
        <select data-key="${escapeHtml(key)}-unit" style="width:60px;${selectStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>
          <option value="MB" ${unit === 'MB' ? 'selected' : ''}>MB</option>
          <option value="GB" ${unit === 'GB' ? 'selected' : ''}>GB</option>
        </select>
        ${locked ? lockIcon : ''}
      </div>`;
    } else if (type === 'boolean') {
      return `<span style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-key="${escapeHtml(key)}" data-type="boolean" ${val ? 'checked' : ''} style="width:16px;height:16px;${locked ? lockedStyle : 'cursor:pointer'}"${dis}>${locked ? lockIcon : ''}</span>`;
    } else if (type === 'number') {
      return `<span style="display:inline-flex;align-items:center;gap:6px;width:100%"><input type="number" data-key="${escapeHtml(key)}" data-type="number" value="${escapeHtml(String(val))}" style="${inputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>${locked ? lockIcon : ''}</span>`;
    }
    return `<span style="display:inline-flex;align-items:center;gap:6px;width:100%"><input type="text" data-key="${escapeHtml(key)}" data-type="string" value="${escapeHtml(val === null ? '' : String(val))}" placeholder="${val === null ? 'null' : ''}" style="${inputStyle}${locked ? `;${lockedStyle}` : ''}"${dis}>${locked ? lockIcon : ''}</span>`;
  }

  const groupedKeys = new Set();
  for (const group of SETTING_GROUPS) {
    const visibleKeys = group.keys.filter((k) => k in flatSettings);
    if (!visibleKeys.length) {
      continue;
    }

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px';
    header.innerHTML = `<i class="bi ${group.icon}" style="font-size:14px;color:var(--text-muted)"></i><span style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(group.label)}</span>`;
    section.appendChild(header);

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';

    for (const key of visibleKeys) {
      groupedKeys.add(key);
      const val = flatSettings[key];
      const label = SETTING_LABELS[key] || key;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px 8px;white-space:nowrap;vertical-align:middle;width:45%">
          <span style="color:var(--text-primary)">${escapeHtml(label)}</span>
        </td>
        <td style="padding:5px 8px;vertical-align:middle">${buildInput(key, val)}</td>
      `;
      table.appendChild(tr);
    }

    section.appendChild(table);
    formEl.appendChild(section);
  }

  const ungrouped = Object.entries(flatSettings).filter(([k]) => !groupedKeys.has(k));
  if (ungrouped.length) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 0 6px;border-bottom:1px solid var(--border);margin-bottom:4px';
    header.innerHTML = `<i class="bi bi-three-dots" style="font-size:14px;color:var(--text-muted)"></i><span style="font-size:13px;font-weight:600;color:var(--text-primary)">Other</span>`;
    section.appendChild(header);
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
    for (const [key, val] of ungrouped) {
      const label = SETTING_LABELS[key] || key;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:5px 8px;white-space:nowrap;vertical-align:middle;width:45%">
          <span style="color:var(--text-primary)">${escapeHtml(label)}</span>
        </td>
        <td style="padding:5px 8px;vertical-align:middle">${buildInput(key, val)}</td>
      `;
      table.appendChild(tr);
    }
    section.appendChild(table);
    formEl.appendChild(section);
  }
  saveBtn.disabled = false;

  saveBtn.addEventListener('click', async () => {
    const inputs = formEl.querySelectorAll('[data-key]');
    const updated = {};
    for (const input of inputs) {
      const key = input.dataset.key;
      const dtype = input.dataset.type;
      if (key.endsWith('-unit')) {
        continue;
      }
      if (input.disabled) {
        continue;
      }
      let value;
      if (dtype === 'boolean') {
        value = input.checked;
      } else if (dtype === 'duration') {
        const unitSel = formEl.querySelector(`[data-key="${key}-unit"]`);
        const multiplier = unitSel?.value === 'hours' ? 3600 : unitSel?.value === 'minutes' ? 60 : 1;
        value = input.value === '' ? null : Number(input.value) * multiplier;
      } else if (dtype === 'filesize') {
        const unitSel = formEl.querySelector(`[data-key="${key}-unit"]`);
        const multiplier = unitSel && unitSel.value === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024;
        value = input.value === '' ? null : Number(input.value) * multiplier;
      } else if (dtype === 'number') {
        value = input.value === '' ? null : Number(input.value);
      } else {
        value = input.value === '' ? null : input.value;
      }
      updated[key] = value;
    }

    saveBtn.disabled = true;
    statusEl.textContent = 'Saving...';
    statusEl.style.color = 'var(--text-muted)';

    try {
      await serverService.request('server:set-settings', { settings: unflattenConfig(updated) });
      statusEl.textContent = 'Settings saved.';
      statusEl.style.color = 'var(--success, #4caf50)';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message || err}`;
      statusEl.style.color = 'var(--danger)';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

/**
 * Opens a standalone modal dialog containing the server settings panel.
 * Removes any existing settings modal before creating a new one.
 * @returns {Promise<void>}
 */
async function showServerSettingsModal() {
  const existing = document.querySelector('.modal-server-settings');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-server-settings';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:600px;width:90vw">
      <h2>Server Settings</h2>
      <div class="settings-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary settings-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderSettingsPanel(modal.querySelector('.settings-panel-container'));

  modal.querySelector('.settings-close-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

export { renderSettingsPanel, showServerSettingsModal, showIconCropModal };
