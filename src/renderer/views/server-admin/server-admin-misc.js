import serverService from '../../services/server.js';
import { customAlert } from '../../services/dialogs.js';

/**
 * Formats a Unix timestamp into a human-readable relative time string.
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Human-readable relative time (e.g., "5m ago", "2h ago")
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
 * Escapes HTML special characters in a string to prevent XSS.
 * @param {string} str - The string to escape
 * @returns {string} The HTML-escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Renders the admin tokens management panel into the given container element.
 * Displays a form to create new tokens and a list of existing unredeemed tokens
 * with copy, role badge, expiry info, and delete controls.
 * @param {HTMLElement} container - The DOM element to render the tokens panel into
 * @returns {Promise<void>}
 */
async function renderTokensPanel(container) {
  container.innerHTML = `
    <div class="token-create-form" style="margin:0 0 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select class="token-role-select" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:13px">
        <option value="admin">Admin</option>
      </select>
      <select class="token-expiry-select" style="padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:13px">
        <option value="3600000">1 Stunde</option>
        <option value="21600000">6 Stunden</option>
        <option value="43200000">12 Stunden</option>
        <option value="86400000" selected>24 Stunden</option>
        <option value="172800000">48 Stunden</option>
        <option value="604800000">7 Tage</option>
        <option value="2592000000">30 Tage</option>
      </select>
      <button class="btn-primary modal-create-btn">Create Token</button>
    </div>
    <div class="token-list" style="max-height:350px;overflow-y:auto"></div>
  `;

  const tokenList = container.querySelector('.token-list');
  const roleNameMap = new Map();

  /**
   * Renders a list of token objects into the token list container.
   * @param {Array<Object>} tokens - Array of token objects with token, role, and expires_at properties
   * @returns {void}
   */
  const renderTokens = (tokens) => {
    if (!tokens.length) {
      tokenList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No unredeemed tokens</div>';
      return;
    }
    tokenList.innerHTML = '';
    for (const t of tokens) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border)';
      const tokenText = document.createElement('code');
      tokenText.style.cssText = 'flex:1;font-size:12px;user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      tokenText.textContent = t.token;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-secondary';
      copyBtn.style.cssText = 'padding:2px 8px;font-size:12px';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(t.token).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
          }, 1500);
        });
      });
      const roleBadge = document.createElement('span');
      roleBadge.style.cssText = 'font-size:11px;color:var(--text-secondary);background:var(--bg-tertiary);padding:1px 6px;border-radius:3px;white-space:nowrap';
      roleBadge.textContent = roleNameMap.get(t.role) || t.role || 'admin';
      const expiryInfo = document.createElement('span');
      expiryInfo.style.cssText = 'font-size:11px;color:var(--text-secondary);white-space:nowrap';
      if (t.expires_at) {
        const remaining = t.expires_at - Date.now();
        if (remaining <= 0) {
          expiryInfo.textContent = 'Abgelaufen';
          expiryInfo.style.color = 'var(--danger)';
        } else if (remaining < 3600000) {
          expiryInfo.textContent = `${Math.ceil(remaining / 60000)}m`;
        } else if (remaining < 86400000) {
          expiryInfo.textContent = `${Math.round(remaining / 3600000)}h`;
        } else {
          expiryInfo.textContent = `${Math.round(remaining / 86400000)}d`;
        }
      } else {
        expiryInfo.textContent = 'Kein Ablauf';
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-secondary';
      delBtn.style.cssText = 'padding:2px 8px;font-size:12px';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        try {
          await serverService.request('token:delete', { token: t.token });
          row.remove();
          if (!tokenList.children.length) {
            tokenList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No unredeemed tokens</div>';
          }
        } catch (err) {
          await customAlert(err.message);
        }
      });
      row.append(tokenText, copyBtn, roleBadge, expiryInfo, delBtn);
      tokenList.appendChild(row);
    }
  };

  const roleSelect = container.querySelector('.token-role-select');
  try {
    const roleResult = await serverService.request('role:list');
    roleSelect.innerHTML = '';
    for (const r of roleResult.roles) {
      roleNameMap.set(r.id, r.name);
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      if (r.id === 'admin') {
        opt.selected = true;
      }
      roleSelect.appendChild(opt);
    }
  } catch {
    /* keep default admin option */
  }

  try {
    const result = await serverService.request('token:list');
    renderTokens(result.tokens);
  } catch (err) {
    tokenList.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
  }

  const expirySelect = container.querySelector('.token-expiry-select');
  container.querySelector('.modal-create-btn').addEventListener('click', async () => {
    try {
      const role = roleSelect.value;
      const expiresIn = parseInt(expirySelect.value, 10);
      await serverService.request('token:create', { role, expiresIn });
      const listResult = await serverService.request('token:list');
      renderTokens(listResult.tokens);
    } catch (err) {
      await customAlert(err.message);
    }
  });
}

/**
 * Opens a standalone modal dialog for managing admin tokens.
 * Creates and displays a modal containing the tokens panel with create/list/delete functionality.
 * @returns {Promise<void>}
 */
async function showManageTokensModal() {
  const existing = document.querySelector('.modal-manage-tokens');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-tokens';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:600px">
      <h2>Admin Tokens</h2>
      <div class="tokens-panel-container"></div>
      <div class="modal-buttons" style="justify-content:flex-end">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderTokensPanel(modal.querySelector('.tokens-panel-container'));

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
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

/**
 * Renders the ban list management panel into the given container element.
 * Displays all active and expired bans with nickname, IP, reason, expiry, and unban controls.
 * @param {HTMLElement} container - The DOM element to render the bans panel into
 * @returns {Promise<void>}
 */
async function renderBansPanel(container) {
  container.innerHTML = '<div class="ban-list" style="max-height:400px;overflow-y:auto"></div>';

  const banList = container.querySelector('.ban-list');

  /**
   * Renders a list of ban objects into the ban list container.
   * @param {Array<Object>} bans - Array of ban objects with id, nickname, ip, reason, expires_at, and isExpired properties
   * @returns {void}
   */
  const renderBans = (bans) => {
    if (!bans.length) {
      banList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No bans</div>';
      return;
    }
    banList.innerHTML = '';
    for (const ban of bans) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border)';
      if (ban.isExpired) {
        row.style.opacity = '0.5';
      }

      const nick = document.createElement('span');
      nick.style.cssText = 'flex:0 0 100px;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nick.textContent = ban.nickname || '—';

      const ip = document.createElement('code');
      ip.style.cssText = 'flex:0 0 130px;font-size:12px';
      ip.textContent = ban.ip;

      const reason = document.createElement('span');
      reason.style.cssText = 'flex:1;font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      reason.textContent = ban.reason || '(no reason)';

      const expiry = document.createElement('span');
      expiry.style.cssText = 'font-size:11px;color:var(--text-muted);white-space:nowrap';
      if (ban.expires_at) {
        const expiryDate = new Date(ban.expires_at);
        expiry.textContent = ban.isExpired ? `Expired ${expiryDate.toLocaleDateString()}` : `Expires ${expiryDate.toLocaleDateString()}`;
      } else {
        expiry.textContent = 'Permanent';
      }

      const unbanBtn = document.createElement('button');
      unbanBtn.className = 'btn-secondary';
      unbanBtn.style.cssText = 'padding:2px 8px;font-size:12px';
      unbanBtn.textContent = 'Unban';
      unbanBtn.addEventListener('click', async () => {
        try {
          await serverService.request('admin:remove-ban', { banId: ban.id });
          row.remove();
          if (!banList.children.length) {
            banList.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No bans</div>';
          }
        } catch (err) {
          await customAlert(err.message);
        }
      });

      row.append(nick, ip, reason, expiry, unbanBtn);
      banList.appendChild(row);
    }
  };

  try {
    const result = await serverService.request('admin:list-bans');
    renderBans(result.bans);
  } catch (err) {
    banList.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
  }
}

/**
 * Opens a standalone modal dialog for managing the server ban list.
 * Creates and displays a modal containing the bans panel with unban functionality.
 * @returns {Promise<void>}
 */
async function showManageBansModal() {
  const existing = document.querySelector('.modal-manage-bans');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-manage-bans';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:650px">
      <h2>Ban List</h2>
      <div class="bans-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderBansPanel(modal.querySelector('.bans-panel-container'));

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };
  modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
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

/**
 * Opens a modal dialog for redeeming a server admin token.
 * Allows the user to paste and redeem a token, updating permissions on success.
 * @returns {void}
 */
export function showRedeemTokenModal() {
  const existing = document.querySelector('.modal-redeem-token');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-redeem-token';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Redeem Server Token</h2>
      <div class="form-group">
        <label>Enter token</label>
        <input type="text" class="redeem-token-input" placeholder="Paste admin token here" spellcheck="false" autocomplete="off">
      </div>
      <div class="redeem-token-status" style="margin:8px 0;min-height:20px"></div>
      <div class="modal-buttons">
        <button class="btn-primary modal-redeem-btn">Redeem</button>
        <button class="btn-secondary modal-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const input = modal.querySelector('.redeem-token-input');
  const statusEl = modal.querySelector('.redeem-token-status');
  input.focus();

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onEscape);
  };

  /**
   * Attempts to redeem the token entered in the input field.
   * Updates server permissions and admin status on success.
   * @returns {Promise<void>}
   */
  const redeem = async () => {
    const token = input.value.trim();
    if (!token) {
      return;
    }
    statusEl.textContent = 'Redeeming...';
    statusEl.style.color = 'var(--text-secondary)';
    try {
      const result = await serverService.request('token:redeem', { token });
      if (result.permissions) {
        serverService.permissions = new Set(result.permissions);
      }
      window.gimodi.setAdminStatus(serverService.hasPermission('server.admin_menu'));
      closeModal();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.style.color = 'var(--danger, #f44336)';
    }
  };

  modal.querySelector('.modal-redeem-btn').addEventListener('click', redeem);
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
    if (e.key === 'Enter' && e.target === input) {
      redeem();
    }
  };
  document.addEventListener('keydown', onEscape);
}

/**
 * Renders the audit log panel into the given container element.
 * Displays a filterable, resizable-column table of server audit log entries
 * with persistent column width preferences.
 * @param {HTMLElement} container - The DOM element to render the audit log panel into
 * @returns {Promise<void>}
 */
async function renderAuditLogPanel(container) {
  const ACTION_LABELS = {
    kick: 'Kick',
    ban: 'Ban',
    unban: 'Unban',
    assign_role: 'Assign Role',
    remove_role: 'Remove Role',
    channel_create: 'Create Channel',
    channel_delete: 'Delete Channel',
    channel_update: 'Update Channel',
    token_create: 'Create Token',
    token_delete: 'Delete Token',
    role_create: 'Create Role',
    role_delete: 'Delete Role',
    grant_voice: 'Grant Voice',
    revoke_voice: 'Revoke Voice',
  };

  const AUDIT_COLUMNS = [
    { key: 'time', label: 'Time', minWidth: 80, defaultWidth: 150 },
    { key: 'action', label: 'Action', minWidth: 60, defaultWidth: 120 },
    { key: 'actor', label: 'Actor', minWidth: 60, defaultWidth: 120 },
    { key: 'target', label: 'Target', minWidth: 60, defaultWidth: 120 },
    { key: 'details', label: 'Details', minWidth: 80 },
  ];

  const savedColWidths = JSON.parse(await window.gimodi.db.getAppSetting('appSettings') || '{}').auditColumnWidths || {};

  container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0';
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-shrink:0">
      <label style="font-size:13px;color:var(--text-secondary)">Filter by action:</label>
      <select class="audit-action-filter" style="font-size:13px;padding:3px 6px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
        <option value="">All actions</option>
      </select>
    </div>
    <div class="audit-table-wrap" style="overflow-y:auto;flex:1;min-height:0">
      <table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed">
        <thead>
          <tr style="position:sticky;top:0;background:var(--bg-secondary)">
            ${AUDIT_COLUMNS.map((col, i) => {
              const width = savedColWidths[col.key] || col.defaultWidth;
              const widthStyle = width ? `width:${width}px;` : '';
              const isLast = i === AUDIT_COLUMNS.length - 1;
              return `<th data-col="${col.key}" style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);position:relative;${widthStyle}${isLast ? '' : 'white-space:nowrap;'}">${col.label}${isLast ? '' : '<div class="audit-col-resize" style="position:absolute;right:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:1"></div>'}</th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody class="audit-tbody"></tbody>
      </table>
      <div class="audit-empty" style="display:none;padding:16px;color:var(--text-muted);text-align:center">No entries found.</div>
      <div class="audit-error" style="display:none;padding:16px;color:var(--danger)"></div>
    </div>
  `;

  container.querySelectorAll('.audit-col-resize').forEach((handle) => {
    handle.addEventListener('mouseenter', () => {
      handle.style.background = 'var(--accent)';
    });
    handle.addEventListener('mouseleave', () => {
      if (!handle._dragging) {
        handle.style.background = '';
      }
    });
    handle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handle._dragging = true;
      handle.style.background = 'var(--accent)';
      const th = handle.parentElement;
      const colKey = th.dataset.col;
      const colDef = AUDIT_COLUMNS.find((c) => c.key === colKey);
      const startX = ev.clientX;
      const startWidth = th.offsetWidth;
      const table = th.closest('table');
      const allThs = [...table.querySelectorAll('thead th')];
      const colIndex = allThs.indexOf(th);
      const othersCurrentWidth = allThs.reduce((sum, t, i) => (i !== colIndex ? sum + t.offsetWidth : sum), 0);
      const maxWidth = table.parentElement.clientWidth - othersCurrentWidth;
      const onMove = (me) => {
        const newWidth = Math.max(colDef.minWidth, Math.min(maxWidth, startWidth + me.clientX - startX));
        th.style.width = newWidth + 'px';
      };
      const onUp = async () => {
        handle._dragging = false;
        handle.style.background = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const settings = JSON.parse(await window.gimodi.db.getAppSetting('appSettings') || '{}');
        if (!settings.auditColumnWidths) {
          settings.auditColumnWidths = {};
        }
        settings.auditColumnWidths[colKey] = th.offsetWidth;
        window.gimodi.db.setAppSetting('appSettings', JSON.stringify(settings));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  const tbody = container.querySelector('.audit-tbody');
  const emptyMsg = container.querySelector('.audit-empty');
  const errorMsg = container.querySelector('.audit-error');
  const filterSelect = container.querySelector('.audit-action-filter');

  let allLogs = [];

  /**
   * Renders audit log entries into the table body, applying the current action filter.
   * @param {Array<Object>} logs - Array of audit log entry objects
   * @returns {void}
   */
  const renderLogs = (logs) => {
    tbody.innerHTML = '';
    const visible = filterSelect.value ? logs.filter((l) => l.action === filterSelect.value) : logs;

    if (!visible.length) {
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';

    for (const log of visible) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';

      const time = new Date(log.created_at);
      const timeStr = time.toLocaleDateString() + ' ' + time.toLocaleTimeString();

      const actionLabel = ACTION_LABELS[log.action] || log.action;

      const actorText = log.actor_nickname || log.actor_user_id || '-';
      const targetText = log.target_nickname || log.target_user_id || '-';

      const fields = [timeStr, actionLabel, actorText, targetText, log.details || '-'];
      fields.forEach((text, i) => {
        const td = document.createElement('td');
        td.style.cssText = 'padding:5px 8px;vertical-align:top;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (i === 0 ? 'color:var(--text-muted)' : '');
        td.textContent = text;
        td.title = text;
        tr.appendChild(td);
      });

      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        const labels = ['Time', 'Action', 'Actor', 'Target', 'Details'];
        const content = labels.map((l, i) => `${l}: ${fields[i]}`).join('\n');
        customAlert(content);
      });

      tbody.appendChild(tr);
    }
  };

  /**
   * Populates the action filter dropdown with unique actions found in the log entries.
   * @param {Array<Object>} logs - Array of audit log entry objects
   * @returns {void}
   */
  const populateFilter = (logs) => {
    const actions = [...new Set(logs.map((l) => l.action))].sort();
    for (const action of actions) {
      const opt = document.createElement('option');
      opt.value = action;
      opt.textContent = ACTION_LABELS[action] || action;
      filterSelect.appendChild(opt);
    }
  };

  filterSelect.addEventListener('change', () => renderLogs(allLogs));

  try {
    const result = await serverService.request('admin:audit-log', { limit: 200 });
    allLogs = result.logs || [];
    populateFilter(allLogs);
    renderLogs(allLogs);
  } catch (err) {
    errorMsg.style.display = 'block';
    errorMsg.textContent = err.message;
  }
}

/**
 * Opens a standalone modal dialog for viewing the server audit log.
 * Creates and displays a modal containing the audit log panel with filtering capabilities.
 * @returns {Promise<void>}
 */
async function showAuditLogModal() {
  const existing = document.querySelector('.modal-audit-log');
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal modal-audit-log';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:800px;width:90vw">
      <h2>Audit Log</h2>
      <div class="audit-panel-container"></div>
      <div class="modal-buttons">
        <button class="btn-secondary audit-close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  await renderAuditLogPanel(modal.querySelector('.audit-panel-container'));

  const closeAuditModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onAuditEscape);
  };
  modal.querySelector('.audit-close-btn').addEventListener('click', closeAuditModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeAuditModal();
    }
  });
  const onAuditEscape = (e) => {
    if (e.key === 'Escape') {
      closeAuditModal();
    }
  };
  document.addEventListener('keydown', onAuditEscape);
}

export {
  renderTokensPanel,
  showManageTokensModal,
  renderBansPanel,
  showManageBansModal,
  renderAuditLogPanel,
  showAuditLogModal,
};
