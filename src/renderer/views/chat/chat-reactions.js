import chatService from '../../services/chat.js';
import serverService from '../../services/server.js';
import { escapeHtml } from './chat-markdown.js';
import { showEmojiPicker, closeEmojiPicker } from '../emoji/emoji-picker.js';

/** @type {object|null} */
let _activeProvider = null;

/**
 * Sets the active chat provider for reaction events.
 * Pass null to fall back to the default channel chatService.
 * @param {object|null} provider
 */
export function setReactionProvider(provider) {
  _activeProvider = provider;
}

/**
 * Returns the active reaction handler (provider or chatService fallback).
 * @returns {{ react: Function, unreact: Function }}
 */
function reactionHandler() {
  return _activeProvider || chatService;
}

const QUICK_REACTIONS = ['👍', '👎', '❤️', '😂', '😊', '🔥'];

/**
 * Renders reaction buttons under a message element.
 * @param {HTMLElement} msgEl
 * @param {string} messageId
 * @param {Array} reactions
 */
export function renderReactions(msgEl, messageId, reactions) {
  let reactionsRow = msgEl.querySelector('.reactions-row');
  if (!reactionsRow) {
    reactionsRow = document.createElement('div');
    reactionsRow.className = 'reactions-row';
    const body = msgEl.querySelector('.chat-msg-body');
    if (body) {
      body.after(reactionsRow);
    } else {
      msgEl.appendChild(reactionsRow);
    }
  }

  reactionsRow.innerHTML = '';
  for (const r of reactions) {
    const btn = document.createElement('button');
    btn.className = `reaction-btn${r.currentUser ? ' current-user' : ''}`;
    btn.innerHTML = `${escapeHtml(r.emoji)} <span class="reaction-count">${r.count}</span>`;
    btn.title = r.userIds.length === 1 ? '1 person' : `${r.userIds.length} people`;
    btn.addEventListener('click', () => {
      if (r.currentUser) {
        reactionHandler().unreact(messageId, r.emoji);
      } else {
        reactionHandler().react(messageId, r.emoji);
      }
    });
    reactionsRow.appendChild(btn);
  }

  if (serverService.userId) {
    const addBtn = document.createElement('button');
    addBtn.className = 'reaction-btn reaction-add-btn';
    addBtn.title = 'Add Reaction';
    addBtn.innerHTML = '<i class="bi bi-plus"></i>';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = addBtn.getBoundingClientRect();
      showQuickReactionPicker(rect.left, rect.bottom + 4, messageId);
    });
    reactionsRow.appendChild(addBtn);
  }
}

/**
 * Shows a compact quick-reaction bar with common emojis and a "+" to open the full picker.
 * @param {number} x
 * @param {number} y
 * @param {string} messageId
 */
export function showQuickReactionPicker(x, y, messageId) {
  closeQuickReactionPicker();
  closeEmojiPicker();

  const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (msgEl) {
    msgEl.classList.add('picker-active');
  }

  const bar = document.createElement('div');
  bar.id = 'quick-reaction-picker';
  bar.className = 'quick-reaction-picker';
  bar._messageEl = msgEl;

  for (const emoji of QUICK_REACTIONS) {
    const btn = document.createElement('button');
    btn.className = 'quick-reaction-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      reactionHandler().react(messageId, emoji);
      closeQuickReactionPicker();
    });
    bar.appendChild(btn);
  }

  const moreBtn = document.createElement('button');
  moreBtn.className = 'quick-reaction-btn quick-reaction-more';
  moreBtn.innerHTML = '<i class="bi bi-plus-lg"></i>';
  moreBtn.title = 'More emojis';
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = moreBtn.getBoundingClientRect();
    closeQuickReactionPicker();
    showEmojiPicker({
      x: rect.left,
      y: rect.bottom + 4,
      onSelect: (emoji) => reactionHandler().react(messageId, emoji),
    });
  });
  bar.appendChild(moreBtn);

  bar.style.left = x + 'px';
  bar.style.top = y + 'px';
  document.body.appendChild(bar);

  const barRect = bar.getBoundingClientRect();
  if (barRect.right > window.innerWidth) {
    bar.style.left = window.innerWidth - barRect.width - 8 + 'px';
  }
  if (barRect.bottom > window.innerHeight) {
    bar.style.top = y - barRect.height - 8 + 'px';
  }
  if (barRect.left < 0) {
    bar.style.left = '8px';
  }

  setTimeout(() => {
    const handler = (e) => {
      if (!bar.contains(e.target)) {
        closeQuickReactionPicker();
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
    bar._closeHandler = handler;
  }, 0);
}

/**
 * Closes the quick reaction picker if open.
 */
function closeQuickReactionPicker() {
  const existing = document.getElementById('quick-reaction-picker');
  if (existing) {
    if (existing._closeHandler) {
      document.removeEventListener('mousedown', existing._closeHandler);
    }
    if (existing._messageEl) {
      existing._messageEl.classList.remove('picker-active');
    }
    existing.remove();
  }
}

/**
 * Handles reaction-update events from chatService.
 * @param {CustomEvent} e
 */
export function onReactionUpdate(e) {
  const { messageId, reactions } = e.detail;
  const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) {
    return;
  }

  const oldRow = msgEl.querySelector('.reactions-row');
  if (oldRow) {
    oldRow.remove();
  }

  if (reactions && reactions.length > 0) {
    renderReactions(msgEl, messageId, reactions);
  }
}
