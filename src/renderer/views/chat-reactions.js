import chatService from '../services/chat.js';
import serverService from '../services/server.js';
import { escapeHtml } from './chat-markdown.js';
import { showEmojiPicker } from './emoji-picker.js';

export const COMMON_REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🎉', '🔥'];

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
    // Insert after .chat-msg-body so it's visible below the message text
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
        chatService.unreact(messageId, r.emoji);
      } else {
        chatService.react(messageId, r.emoji);
      }
    });
    reactionsRow.appendChild(btn);
  }

  // Add a "+" button to add more reactions
  if (serverService.userId) {
    const addBtn = document.createElement('button');
    addBtn.className = 'reaction-btn reaction-add-btn';
    addBtn.title = 'Add Reaction';
    addBtn.innerHTML = '<i class="bi bi-plus"></i>';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = addBtn.getBoundingClientRect();
      showReactionPicker(rect.left, rect.bottom + 4, messageId);
    });
    reactionsRow.appendChild(addBtn);
  }
}

/**
 * Shows the emoji picker popup for reactions.
 * @param {number} x
 * @param {number} y
 * @param {string} messageId
 */
export function showReactionPicker(x, y, messageId) {
  showEmojiPicker({
    x,
    y,
    quickReactions: COMMON_REACTIONS,
    onSelect: (emoji) => chatService.react(messageId, emoji)
  });
}

/**
 * Handles reaction-update events from chatService.
 * @param {CustomEvent} e
 */
export function onReactionUpdate(e) {
  const { messageId, reactions } = e.detail;
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  const msgEl = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
  if (!msgEl) return;

  // Remove old reactions row if exists
  const oldRow = msgEl.querySelector('.reactions-row');
  if (oldRow) oldRow.remove();

  // Render new reactions if any
  if (reactions && reactions.length > 0) {
    renderReactions(msgEl, messageId, reactions);
  }
}
