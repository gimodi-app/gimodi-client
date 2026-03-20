import { EMOJI_NAMES, EMOJI_CATEGORIES } from './emoji-data.js';


const MAX_FREQUENT = 24;
const MAX_FREQUENT_STORED = 32;

let frequentCache = [];
let pickerEl = null;
let closeHandler = null;

/**
 * @returns {Promise<void>}
 */
async function loadFrequent() {
  const settings = (await window.gimodi.settings.load()) || {};
  frequentCache = Array.isArray(settings.emojiFrequent) ? settings.emojiFrequent : [];
}

/**
 * @param {string} emoji
 * @returns {Promise<void>}
 */
async function trackUsage(emoji) {
  frequentCache = frequentCache.filter((e) => e !== emoji);
  frequentCache.unshift(emoji);
  frequentCache = frequentCache.slice(0, MAX_FREQUENT_STORED);
  const settings = (await window.gimodi.settings.load()) || {};
  settings.emojiFrequent = frequentCache;
  window.gimodi.settings.save(settings);
}

loadFrequent();

/**
 * @param {HTMLElement} container
 * @param {HTMLElement} target
 */
function scrollToCategory(container, target) {
  target.style.position = 'relative';
  const top = target.offsetTop;
  target.style.position = '';
  container.scrollTop = top;
}

/**
 * @param {function(string): void} onSelect
 * @returns {HTMLElement}
 */
function buildPicker(onSelect) {
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';

  const searchRow = document.createElement('div');
  searchRow.className = 'emoji-picker-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search emoji...';
  searchInput.className = 'emoji-picker-search-input';
  searchRow.appendChild(searchInput);
  picker.appendChild(searchRow);

  const tabBar = document.createElement('div');
  tabBar.className = 'emoji-picker-tabs';

  const contentArea = document.createElement('div');
  contentArea.className = 'emoji-picker-content';

  const frequentEmojis = frequentCache.slice(0, MAX_FREQUENT);

  /**
   * @param {string} [filter]
   */
  function renderAll(filter) {
    contentArea.innerHTML = '';

    if (filter) {
      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      let found = 0;
      const seen = new Set();
      if (frequentEmojis.length > 0) {
        for (const emoji of frequentEmojis) {
          if (found >= 80 || seen.has(emoji)) {
            continue;
          }
          const names = EMOJI_NAMES.get(emoji) || '';
          if (names.includes(filter) || emoji.includes(filter)) {
            seen.add(emoji);
            grid.appendChild(makeEmojiBtn(emoji, onSelect));
            found++;
          }
        }
      }
      for (const cat of EMOJI_CATEGORIES) {
        for (const emoji of cat.emojis) {
          if (found >= 80 || seen.has(emoji)) {
            continue;
          }
          const names = EMOJI_NAMES.get(emoji) || '';
          if (names.includes(filter) || emoji.includes(filter)) {
            seen.add(emoji);
            grid.appendChild(makeEmojiBtn(emoji, onSelect));
            found++;
          }
        }
      }
      if (found === 0) {
        contentArea.innerHTML = '<div class="emoji-picker-empty">No emojis found</div>';
      } else {
        contentArea.appendChild(grid);
      }
      return;
    }

    if (frequentEmojis.length > 0) {
      const recentsLabel = document.createElement('div');
      recentsLabel.className = 'emoji-picker-cat-label';
      recentsLabel.textContent = 'Recents';
      recentsLabel.dataset.catId = 'recents';
      contentArea.appendChild(recentsLabel);
      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      for (const emoji of frequentEmojis) {
        grid.appendChild(makeEmojiBtn(emoji, onSelect));
      }
      contentArea.appendChild(grid);
    }

    for (const cat of EMOJI_CATEGORIES) {
      const label = document.createElement('div');
      label.className = 'emoji-picker-cat-label';
      label.textContent = cat.name;
      label.dataset.catId = cat.id;
      contentArea.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'emoji-picker-grid';
      for (const emoji of cat.emojis) {
        grid.appendChild(makeEmojiBtn(emoji, onSelect));
      }
      contentArea.appendChild(grid);
    }
  }

  if (frequentEmojis.length > 0) {
    const recentsTab = document.createElement('button');
    recentsTab.className = 'emoji-picker-tab';
    recentsTab.textContent = '🕒';
    recentsTab.title = 'Recents';
    recentsTab.addEventListener('click', () => {
      const target = contentArea.querySelector('[data-cat-id="recents"]');
      if (target) {
        scrollToCategory(contentArea, target);
      }
    });
    tabBar.appendChild(recentsTab);
  }

  for (const cat of EMOJI_CATEGORIES) {
    const tab = document.createElement('button');
    tab.className = 'emoji-picker-tab';
    tab.textContent = cat.icon;
    tab.title = cat.name;
    tab.addEventListener('click', () => {
      const target = contentArea.querySelector(`[data-cat-id="${cat.id}"]`);
      if (target) {
        scrollToCategory(contentArea, target);
      }
    });
    tabBar.appendChild(tab);
  }

  picker.appendChild(tabBar);
  picker.appendChild(contentArea);

  renderAll();

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    renderAll(q || undefined);
  });

  setTimeout(() => searchInput.focus(), 0);

  return picker;
}

/**
 * @param {string} emoji
 * @param {function(string): void} onSelect
 * @returns {HTMLButtonElement}
 */
function makeEmojiBtn(emoji, onSelect) {
  const btn = document.createElement('button');
  btn.className = 'emoji-picker-emoji';
  btn.textContent = emoji;
  btn.addEventListener('click', () => {
    trackUsage(emoji);
    onSelect(emoji);
  });
  return btn;
}

/**
 * Shows the emoji picker.
 * @param {object} options
 * @param {HTMLElement} [options.anchor] - Anchor element to position relative to (bottom-right aligned)
 * @param {number} [options.x] - X position (used if no anchor)
 * @param {number} [options.y] - Y position (used if no anchor)
 * @param {function(string): void} options.onSelect - Called with the selected emoji
 * @param {boolean} [options.closeOnSelect=true] - Whether to close the picker after selection
 */
export function showEmojiPicker({ anchor, x, y, onSelect, closeOnSelect = true }) {
  closeEmojiPicker();

  const wrappedOnSelect = (emoji) => {
    onSelect(emoji);
    if (closeOnSelect) {
      closeEmojiPicker();
    }
  };

  pickerEl = buildPicker(wrappedOnSelect);
  document.body.appendChild(pickerEl);

  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    pickerEl.style.bottom = window.innerHeight - rect.top + 6 + 'px';
    pickerEl.style.right = window.innerWidth - rect.right + 'px';
  } else {
    pickerEl.style.left = x + 'px';
    pickerEl.style.top = y + 'px';
  }

  // Adjust for viewport overflow (only for absolute-positioned pickers)
  if (!anchor) {
    const pickerRect = pickerEl.getBoundingClientRect();
    if (pickerRect.right > window.innerWidth) {
      pickerEl.style.left = window.innerWidth - pickerRect.width - 8 + 'px';
    }
    if (pickerRect.bottom > window.innerHeight) {
      pickerEl.style.top = y - pickerRect.height - 8 + 'px';
    }
    if (pickerRect.left < 0) {
      pickerEl.style.left = '8px';
    }
  }

  setTimeout(() => {
    closeHandler = (e) => {
      if (pickerEl && !pickerEl.contains(e.target) && !e.target.closest('.btn-emoji')) {
        closeEmojiPicker();
      }
    };
    document.addEventListener('mousedown', closeHandler);
  }, 0);
}

/**
 * Closes the emoji picker if open.
 */
export function closeEmojiPicker() {
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
  if (closeHandler) {
    document.removeEventListener('mousedown', closeHandler);
    closeHandler = null;
  }
}

/**
 * @returns {boolean}
 */
export function isPickerOpen() {
  return !!pickerEl;
}
