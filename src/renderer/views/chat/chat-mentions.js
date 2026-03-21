import { searchEmoji, getEmoji } from '../../services/emoji-shortcodes.js';

/**
 * Creates mention/autocomplete handler functions for the chat input.
 * @param {object} deps - Dependencies from the chat module
 * @param {() => HTMLTextAreaElement} deps.getChatInput - Returns the current chat input element
 * @param {() => import('../services/chat-providers/server.js').default|import('../services/chat-providers/dm.js').default|null} deps.getProvider - Returns the current chat provider
 * @param {() => void} deps.autoResizeInput - Resizes the chat input after text changes
 * @param {(channelId: string, channelName: string) => void} deps.openChannelViewTab - Opens a channel view tab
 * @returns {object} All mention handler functions
 */
export function createMentionHandlers(deps) {
  let mentionAutocomplete = null;
  let mentionStartPos = -1;
  let mentionTriggerChar = null;
  const selectedMentions = new Map();
  const selectedChannelMentions = new Map();

  /**
   * Determines whether a given position in the text falls inside a code block.
   * @param {string} text - The full text content
   * @param {number} pos - The character position to check
   * @returns {boolean} True if the position is inside a fenced or inline code block
   */
  function isInsideCodeBlock(text, pos) {
    const before = text.substring(0, pos);
    const tripleCount = (before.match(/```/g) || []).length;
    if (tripleCount % 2 === 1) {
      return true;
    }
    const singleCount = (before.replace(/```/g, '').match(/`/g) || []).length;
    if (singleCount % 2 === 1) {
      return true;
    }
    return false;
  }

  /**
   * Handles input events on the chat textarea to trigger mention, channel, or emoji autocomplete.
   * @returns {void}
   */
  function onChatInputForMentions() {
    const chatInput = deps.getChatInput();
    const provider = deps.getProvider();
    const cursorPos = chatInput.selectionStart;
    const text = chatInput.value.substring(0, cursorPos);

    const lastAtIndex = text.lastIndexOf('@');
    const lastHashIndex = text.lastIndexOf('#');
    const lastColonIndex = text.lastIndexOf(':');

    const triggerIndex = Math.max(lastAtIndex, lastHashIndex, lastColonIndex);
    if (triggerIndex === -1) {
      hideMentionAutocomplete();
      return;
    }
    let triggerChar;
    if (triggerIndex === lastAtIndex) {
      triggerChar = '@';
    } else if (triggerIndex === lastHashIndex) {
      triggerChar = '#';
    } else {
      triggerChar = ':';
    }

    if (triggerChar !== ':' && triggerIndex > 0 && /\S/.test(text[triggerIndex - 1])) {
      hideMentionAutocomplete();
      return;
    }

    if (isInsideCodeBlock(chatInput.value, triggerIndex)) {
      hideMentionAutocomplete();
      return;
    }

    const searchText = text.substring(triggerIndex + 1);

    if (/\s/.test(searchText)) {
      hideMentionAutocomplete();
      return;
    }

    if (triggerChar === ':' && searchText.length < 2) {
      hideMentionAutocomplete();
      return;
    }

    mentionStartPos = triggerIndex;
    mentionTriggerChar = triggerChar;

    if (triggerChar === '@') {
      const channelUsers = provider ? provider.getMentionCandidates() : window.gimodiClients || [];
      const matches = channelUsers.filter((c) => c.nickname.toLowerCase().startsWith(searchText.toLowerCase())).slice(0, 10);

      if (matches.length === 0) {
        hideMentionAutocomplete();
        return;
      }
      showMentionAutocomplete(matches);
    } else if (triggerChar === '#') {
      if (!provider?.supportsChannelMentions) {
        hideMentionAutocomplete();
        return;
      }
      const allChannels = (window.gimodiChannels || []).filter((c) => c.type !== 'group');
      const matches = allChannels.filter((c) => c.name.toLowerCase().startsWith(searchText.toLowerCase())).slice(0, 10);

      if (matches.length === 0) {
        hideMentionAutocomplete();
        return;
      }
      showChannelAutocomplete(matches);
    } else {
      const matches = searchEmoji(searchText, 10);
      if (matches.length === 0) {
        hideMentionAutocomplete();
        return;
      }
      showEmojiShortcodeAutocomplete(matches);
    }
  }

  /**
   * Displays the user mention autocomplete dropdown positioned above the chat input.
   * @param {{nickname: string, userId?: string, id?: string}[]} users - Matching user candidates
   * @returns {void}
   */
  function showMentionAutocomplete(users) {
    const chatInput = deps.getChatInput();
    if (!mentionAutocomplete) {
      mentionAutocomplete = document.createElement('div');
      mentionAutocomplete.id = 'mention-autocomplete';
      mentionAutocomplete.className = 'mention-autocomplete';
      document.body.appendChild(mentionAutocomplete);
    }

    mentionAutocomplete.innerHTML = '';
    for (let i = 0; i < users.length; i++) {
      const item = document.createElement('div');
      item.className = 'mention-autocomplete-item' + (i === 0 ? ' selected' : '');
      item.dataset.nickname = users[i].nickname;
      item.dataset.userId = users[i].userId || '';
      item.dataset.clientId = users[i].id || '';
      item.textContent = users[i].nickname;
      item.addEventListener('click', () => selectMention(users[i].nickname, users[i].userId || null, users[i].id || null));
      mentionAutocomplete.appendChild(item);
    }

    const inputRect = chatInput.getBoundingClientRect();
    mentionAutocomplete.style.left = inputRect.left + 'px';
    mentionAutocomplete.style.bottom = window.innerHeight - inputRect.top + 4 + 'px';
    mentionAutocomplete.classList.remove('hidden');
  }

  /**
   * Hides the autocomplete dropdown and resets the trigger position.
   * @returns {void}
   */
  function hideMentionAutocomplete() {
    if (mentionAutocomplete) {
      mentionAutocomplete.classList.add('hidden');
    }
    mentionStartPos = -1;
  }

  /**
   * Moves the selection highlight up or down in the autocomplete dropdown.
   * @param {number} direction - The direction to move: -1 for up, 1 for down
   * @returns {void}
   */
  function navigateMentionAutocomplete(direction) {
    if (!mentionAutocomplete) {
      return;
    }
    const items = Array.from(mentionAutocomplete.querySelectorAll('.mention-autocomplete-item'));
    const currentIndex = items.findIndex((item) => item.classList.contains('selected'));
    if (currentIndex === -1) {
      return;
    }

    items[currentIndex].classList.remove('selected');
    let newIndex = currentIndex + direction;
    if (newIndex < 0) {
      newIndex = items.length - 1;
    }
    if (newIndex >= items.length) {
      newIndex = 0;
    }
    items[newIndex].classList.add('selected');
  }

  /**
   * Inserts the selected user mention into the chat input and records it for structured resolution.
   * @param {string} nickname - The nickname to insert
   * @param {string|null} userId - The persistent user ID, if available
   * @param {string|null} clientId - The session client ID, if available
   * @returns {void}
   */
  function selectMention(nickname, userId, clientId) {
    if (mentionStartPos === -1) {
      return;
    }

    const chatInput = deps.getChatInput();
    const cursorPos = chatInput.selectionStart;
    const before = chatInput.value.substring(0, mentionStartPos);
    const after = chatInput.value.substring(cursorPos);

    chatInput.value = before + '@' + nickname + ' ' + after;
    chatInput.selectionStart = chatInput.selectionEnd = mentionStartPos + nickname.length + 2;
    chatInput.focus();
    deps.autoResizeInput();

    if (userId || clientId) {
      selectedMentions.set(nickname, { userId: userId || null, clientId: clientId || null });
    }

    hideMentionAutocomplete();
  }

  /**
   * Handles click events on channel mention links, opening the referenced channel in a view tab.
   * @param {MouseEvent} e - The click event
   * @returns {void}
   */
  function onChannelMentionClick(e) {
    const mention = e.target.closest('.channel-mention');
    if (!mention) {
      return;
    }
    const channelId = mention.dataset.channelId;
    if (!channelId) {
      return;
    }
    const channels = window.gimodiChannels || [];
    const ch = channels.find((c) => c.id === channelId);
    if (ch) {
      deps.openChannelViewTab(channelId, ch.name);
    }
  }

  /**
   * Displays the channel mention autocomplete dropdown positioned above the chat input.
   * @param {{name: string, id: string}[]} channels - Matching channel candidates
   * @returns {void}
   */
  function showChannelAutocomplete(channels) {
    const chatInput = deps.getChatInput();
    if (!mentionAutocomplete) {
      mentionAutocomplete = document.createElement('div');
      mentionAutocomplete.id = 'mention-autocomplete';
      mentionAutocomplete.className = 'mention-autocomplete';
      document.body.appendChild(mentionAutocomplete);
    }

    mentionAutocomplete.innerHTML = '';
    for (let i = 0; i < channels.length; i++) {
      const item = document.createElement('div');
      item.className = 'mention-autocomplete-item' + (i === 0 ? ' selected' : '');
      item.dataset.channelName = channels[i].name;
      item.dataset.channelId = channels[i].id;
      const icon = document.createElement('i');
      icon.className = 'bi bi-hash';
      icon.style.marginRight = '6px';
      icon.style.opacity = '0.6';
      item.appendChild(icon);
      item.appendChild(document.createTextNode(channels[i].name));
      item.addEventListener('click', () => selectChannelMention(channels[i].name, channels[i].id));
      mentionAutocomplete.appendChild(item);
    }

    const inputRect = chatInput.getBoundingClientRect();
    mentionAutocomplete.style.left = inputRect.left + 'px';
    mentionAutocomplete.style.bottom = window.innerHeight - inputRect.top + 4 + 'px';
    mentionAutocomplete.classList.remove('hidden');
  }

  /**
   * Inserts the selected channel mention into the chat input and records it for structured resolution.
   * @param {string} channelName - The channel name to insert
   * @param {string} channelId - The channel ID for structured resolution
   * @returns {void}
   */
  function selectChannelMention(channelName, channelId) {
    if (mentionStartPos === -1) {
      return;
    }

    const chatInput = deps.getChatInput();
    const cursorPos = chatInput.selectionStart;
    const before = chatInput.value.substring(0, mentionStartPos);
    const after = chatInput.value.substring(cursorPos);

    chatInput.value = before + '#' + channelName + ' ' + after;
    chatInput.selectionStart = chatInput.selectionEnd = mentionStartPos + channelName.length + 2;
    chatInput.focus();
    deps.autoResizeInput();

    if (channelId) {
      selectedChannelMentions.set(channelName, channelId);
    }

    hideMentionAutocomplete();
  }

  /**
   * Displays the emoji shortcode autocomplete dropdown positioned above the chat input.
   * @param {{shortcode: string, emoji: string}[]} matches - Matching emoji candidates
   * @returns {void}
   */
  function showEmojiShortcodeAutocomplete(matches) {
    const chatInput = deps.getChatInput();
    if (!mentionAutocomplete) {
      mentionAutocomplete = document.createElement('div');
      mentionAutocomplete.id = 'mention-autocomplete';
      mentionAutocomplete.className = 'mention-autocomplete';
      document.body.appendChild(mentionAutocomplete);
    }

    mentionAutocomplete.innerHTML = '';
    for (let i = 0; i < matches.length; i++) {
      const item = document.createElement('div');
      item.className = 'mention-autocomplete-item' + (i === 0 ? ' selected' : '');
      item.dataset.shortcode = matches[i].shortcode;
      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'emoji';
      emojiSpan.textContent = matches[i].emoji;
      emojiSpan.style.marginRight = '8px';
      item.appendChild(emojiSpan);
      item.appendChild(document.createTextNode(':' + matches[i].shortcode + ':'));
      item.addEventListener('click', () => selectEmojiShortcode(matches[i].shortcode));
      mentionAutocomplete.appendChild(item);
    }

    const inputRect = chatInput.getBoundingClientRect();
    mentionAutocomplete.style.left = inputRect.left + 'px';
    mentionAutocomplete.style.bottom = window.innerHeight - inputRect.top + 4 + 'px';
    mentionAutocomplete.classList.remove('hidden');
  }

  /**
   * Inserts the resolved emoji character for the selected shortcode into the chat input.
   * @param {string} shortcode - The emoji shortcode without surrounding colons
   * @returns {void}
   */
  function selectEmojiShortcode(shortcode) {
    if (mentionStartPos === -1) {
      return;
    }

    const emoji = getEmoji(shortcode);
    if (!emoji) {
      return;
    }

    const chatInput = deps.getChatInput();
    const cursorPos = chatInput.selectionStart;
    const before = chatInput.value.substring(0, mentionStartPos);
    const after = chatInput.value.substring(cursorPos);

    chatInput.value = before + emoji + after;
    chatInput.selectionStart = chatInput.selectionEnd = mentionStartPos + emoji.length;
    chatInput.focus();
    deps.autoResizeInput();

    hideMentionAutocomplete();
  }

  /**
   * Replaces @nickname and #channelName tokens in the message text with structured
   * @u(id) and #c(channelId) tokens based on autocomplete selections, then clears the maps.
   * @param {string} text - The raw message text containing @nickname and #channelName tokens
   * @returns {string} The text with structured mention tokens substituted
   */
  function resolveStructuredMentions(text) {
    let result = text;
    for (const [nickname, { userId, clientId }] of selectedMentions) {
      const id = userId || clientId;
      if (!id) {
        continue;
      }
      const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`@${escaped}(?=\\s|$)`, 'g'), `@u(${id})`);
    }
    selectedMentions.clear();

    for (const [channelName, channelId] of selectedChannelMentions) {
      const escaped = channelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`#${escaped}(?=\\s|$)`, 'g'), `#c(${channelId})`);
    }
    selectedChannelMentions.clear();

    return result;
  }

  return {
    isInsideCodeBlock,
    onChatInputForMentions,
    showMentionAutocomplete,
    hideMentionAutocomplete,
    navigateMentionAutocomplete,
    selectMention,
    onChannelMentionClick,
    showChannelAutocomplete,
    selectChannelMention,
    showEmojiShortcodeAutocomplete,
    selectEmojiShortcode,
    resolveStructuredMentions,
    getSelectedMentions: () => selectedMentions,
    getSelectedChannelMentions: () => selectedChannelMentions,
    isMentionAutocompleteVisible: () => !!(mentionAutocomplete && !mentionAutocomplete.classList.contains('hidden')),
    getMentionTriggerChar: () => mentionTriggerChar,
  };
}
