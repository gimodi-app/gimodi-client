import { formatTime, formatTimeShort, formatDateTime } from '../../services/timeFormat.js';
import { renderMarkdown, escapeHtml } from './chat-markdown.js';

/**
 * Creates a link preview DOM element.
 * @param {object} preview
 * @returns {HTMLElement}
 */
export function createLinkPreviewEl(preview) {
  const container = document.createElement('div');
  container.className = 'link-preview';
  if (preview.title) {
    const title = document.createElement('div');
    title.className = 'link-preview-title';
    title.textContent = preview.title;
    container.appendChild(title);
  }
  if (preview.description) {
    const desc = document.createElement('div');
    desc.className = 'link-preview-desc';
    desc.textContent = preview.description;
    container.appendChild(desc);
  }
  if (preview.image) {
    const img = document.createElement('img');
    img.className = 'link-preview-image';
    img.src = preview.image;
    container.appendChild(img);
  }
  return container;
}

/**
 * Returns a date key string for grouping messages by day.
 * @param {number} timestamp
 * @returns {string}
 */
export function getDayKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Returns a human-readable day label.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDayLabel(timestamp) {
  const d = new Date(timestamp);
  if (getDayKey(timestamp) === getDayKey(Date.now())) {
    return 'Today';
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (getDayKey(timestamp) === getDayKey(yesterday.getTime())) {
    return 'Yesterday';
  }
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Inserts a day separator into a container element if the day changed.
 * @param {HTMLElement} container
 * @param {number} timestamp
 */
export function maybeInsertDaySeparator(container, timestamp) {
  const dayKey = getDayKey(timestamp);
  const seps = container.querySelectorAll('.chat-day-separator');
  const lastKey = seps.length ? seps[seps.length - 1].dataset.dayKey : null;
  if (dayKey === lastKey) {
    return;
  }
  const sep = document.createElement('div');
  sep.className = 'chat-day-separator';
  sep.dataset.dayKey = dayKey;
  const label = document.createElement('span');
  label.textContent = formatDayLabel(timestamp);
  sep.appendChild(label);
  container.appendChild(sep);
}

/**
 * Builds a DOM element for a DM message.
 * @param {object} msg
 * @param {object} [options]
 * @param {string} [options.myUserId]
 * @param {Function} [options.onDelete]
 * @param {Function} [options.onReply]
 * @returns {HTMLElement}
 */
export function renderDmMessageEl(msg, options = {}) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.dataset.messageId = msg.id;
  el.dataset.senderUserId = msg.senderUserId || '';
  el.dataset.timestamp = msg.timestamp;

  const displayNickname = msg.senderNickname || msg.senderUserId;
  const nickColor = msg.senderRoleColor || 'var(--text-primary)';
  const compactTime = formatTimeShort(msg.timestamp);
  const fullTime = formatDateTime(msg.timestamp);
  const badgeTitle = msg.senderBadge ? escapeHtml(msg.senderBadge) : '';

  const compactRow = document.createElement('span');
  compactRow.className = 'compact-row';
  compactRow.innerHTML = `<span class="compact-time" title="${escapeHtml(fullTime)}">${compactTime}</span> <span class="compact-nick" style="color:${nickColor}" title="${badgeTitle}">${escapeHtml(displayNickname)}</span>`;
  el.appendChild(compactRow);

  const header = document.createElement('div');
  header.className = 'chat-msg-header';

  const nick = document.createElement('span');
  nick.className = 'chat-msg-nick';
  nick.textContent = displayNickname;
  if (msg.senderRoleColor) {
    nick.style.color = msg.senderRoleColor;
  }
  header.appendChild(nick);

  if (msg.senderBadge) {
    const badge = document.createElement('span');
    badge.className = 'admin-badge';
    badge.textContent = msg.senderBadge;
    header.appendChild(badge);
  }

  const time = document.createElement('span');
  time.className = 'chat-msg-time';
  time.textContent = formatTime(msg.timestamp);
  time.title = fullTime;
  header.appendChild(time);

  if (msg.editedAt) {
    const edited = document.createElement('span');
    edited.className = 'chat-msg-edited';
    edited.textContent = '(edited)';
    edited.title = formatDateTime(msg.editedAt);
    header.appendChild(edited);
  }

  el.appendChild(header);

  if (msg.replyToContent) {
    const replyRef = document.createElement('div');
    replyRef.className = 'chat-reply-ref';
    replyRef.textContent = msg.replyToContent.substring(0, 100);
    el.appendChild(replyRef);
  }

  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  body.innerHTML = renderMarkdown(escapeHtml(msg.content));
  el.appendChild(body);

  if (msg.linkPreviews && msg.linkPreviews.length > 0) {
    for (const preview of msg.linkPreviews) {
      el.appendChild(createLinkPreviewEl(preview));
    }
  }

  const isMine = options.myUserId && msg.senderUserId === options.myUserId;
  if (isMine || options.onReply) {
    const actions = document.createElement('div');
    actions.className = 'chat-msg-actions';

    if (options.onReply) {
      const replyBtn = document.createElement('button');
      replyBtn.className = 'chat-msg-action-btn';
      replyBtn.title = 'Reply';
      replyBtn.innerHTML = '<i class="bi bi-reply"></i>';
      replyBtn.addEventListener('click', () => options.onReply(msg));
      actions.appendChild(replyBtn);
    }

    if (isMine && options.onDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'chat-msg-action-btn danger';
      deleteBtn.title = 'Delete';
      deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
      deleteBtn.addEventListener('click', () => options.onDelete(msg.id));
      actions.appendChild(deleteBtn);
    }

    el.appendChild(actions);
  }

  return el;
}
