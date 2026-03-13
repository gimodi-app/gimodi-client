import serverService from '../services/server.js';
import { resolveNicknames, getCachedNickname } from '../services/nicknameCache.js';
import { formatDateTime } from '../services/timeFormat.js';
import { escapeHtml, highlightMentions } from './chat-markdown.js';
import { scrollToMessage } from './chat.js';

const panel = document.getElementById('side-panel');
const btnClose = document.getElementById('btn-close-side-panel');
const searchInput = document.getElementById('side-panel-search-input');
const resultsContainer = document.getElementById('side-panel-results');

let currentChannelIdFn = null;

/**
 * Initializes the side panel with a function to get the current channel ID.
 * @param {Function} getChannelId
 */
export function initSidePanel(getChannelId) {
  currentChannelIdFn = getChannelId;

  btnClose.addEventListener('click', closeSidePanel);

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const serverView = document.getElementById('view-server');
      if (!serverView.classList.contains('active')) {
        return;
      }
      e.preventDefault();
      openSearchPanel();
    }
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      closeSidePanel();
    }
  });
}

/**
 * Opens the side panel with the search view.
 */
function openSearchPanel() {
  panel.classList.remove('hidden');
  requestAnimationFrame(() => {
    panel.classList.add('open');
    searchInput.focus({ preventScroll: true });
    searchInput.select();
  });
}

/**
 * Closes the side panel.
 */
export function closeSidePanel() {
  panel.classList.remove('open');
  panel.addEventListener(
    'transitionend',
    () => {
      if (!panel.classList.contains('open')) {
        panel.classList.add('hidden');
      }
    },
    { once: true },
  );
}

/**
 * Performs a search request to the server.
 */
async function performSearch() {
  const query = searchInput.value.trim();
  if (query.length < 3) {
    resultsContainer.innerHTML = '<div class="search-no-results">Enter at least 3 characters</div>';
    return;
  }

  const channelId = currentChannelIdFn ? currentChannelIdFn() : null;
  if (!channelId) {
    resultsContainer.innerHTML = '<div class="search-no-results">No channel selected</div>';
    return;
  }

  resultsContainer.innerHTML = '<div class="search-no-results">Searching...</div>';

  try {
    const result = await serverService.request('chat:search', { channelId, query });
    renderResults(result.messages || [], query);
  } catch {
    resultsContainer.innerHTML = '<div class="search-no-results">Search failed</div>';
  }
}

/**
 * Renders search results into the results container.
 * @param {object[]} messages
 * @param {string} query
 */
async function renderResults(messages, query) {
  if (messages.length === 0) {
    resultsContainer.innerHTML = '<div class="search-no-results">No results found</div>';
    return;
  }

  const userIds = [...new Set(messages.map((m) => m.userId).filter(Boolean))];
  if (userIds.length > 0) {
    await resolveNicknames(userIds);
  }

  resultsContainer.innerHTML = '';
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = 'search-result-item';

    const nickname = msg.userId ? getCachedNickname(msg.userId) || 'Unknown' : 'Unknown';
    const time = formatDateTime(msg.timestamp);
    const snippet = createSnippet(msg.content, query);

    div.innerHTML = `<span class="search-result-nickname">${escapeHtml(nickname)}</span><span class="search-result-time">${escapeHtml(time)}</span><div class="search-result-snippet">${snippet}</div>`;
    div.style.cursor = 'pointer';
    div.addEventListener('click', () => {
      scrollToMessage(msg.id, msg.timestamp);
      closeSidePanel();
    });
    resultsContainer.appendChild(div);
  }
}

/**
 * Creates a snippet from message content with the search term highlighted.
 * @param {string} content
 * @param {string} query
 * @returns {string}
 */
function createSnippet(content, query) {
  const escaped = escapeHtml(content);
  const escapedQuery = escapeHtml(query);
  const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  let snippet = highlightMentions(escaped);
  snippet = snippet.replace(regex, '<mark>$1</mark>');
  if (snippet.length > 200) {
    const idx = snippet.toLowerCase().indexOf(escapedQuery.toLowerCase());
    const start = Math.max(0, idx - 60);
    const end = Math.min(snippet.length, idx + escapedQuery.length + 60);
    snippet = (start > 0 ? '...' : '') + snippet.substring(start, end) + (end < snippet.length ? '...' : '');
  }
  return snippet;
}
