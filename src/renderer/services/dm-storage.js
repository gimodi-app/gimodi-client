const MSG_STORAGE_PREFIX = 'dm_messages_';
const CONV_STORAGE_PREFIX = 'dm_conversations_';
const PURGE_LOG_PREFIX = 'dm_purged_';
const REACTIONS_STORAGE_PREFIX = 'dm_reactions_';

/**
 * Loads all DM messages for the given identity from localStorage.
 * @param {string} ownFingerprint
 * @returns {import('./dm.js').DmMessage[]}
 */
export function loadMessages(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${MSG_STORAGE_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persists all DM messages for the given identity to localStorage.
 * @param {string} ownFingerprint
 * @param {import('./dm.js').DmMessage[]} messages
 * @returns {void}
 */
export function saveMessages(ownFingerprint, messages) {
  localStorage.setItem(`${MSG_STORAGE_PREFIX}${ownFingerprint}`, JSON.stringify(messages));
}

/**
 * Loads all conversations for the given identity from localStorage.
 * @param {string} ownFingerprint
 * @returns {import('./dm.js').Conversation[]}
 */
export function loadConversations(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${CONV_STORAGE_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persists all conversations for the given identity to localStorage.
 * Strips the in-memory sessionKey before saving.
 * @param {string} ownFingerprint
 * @param {import('./dm.js').Conversation[]} conversations
 * @returns {void}
 */
export function saveConversations(ownFingerprint, conversations) {
  const toSave = conversations.map((c) => ({ ...c, sessionKey: undefined }));
  localStorage.setItem(`${CONV_STORAGE_PREFIX}${ownFingerprint}`, JSON.stringify(toSave));
}

/**
 * Loads the purge log for the given identity from localStorage.
 * @param {string} ownFingerprint
 * @returns {Record<string, number>}
 */
export function loadPurgeLog(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${PURGE_LOG_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persists the purge log for the given identity to localStorage.
 * @param {string} ownFingerprint
 * @param {Record<string, number>} log
 * @returns {void}
 */
export function savePurgeLog(ownFingerprint, log) {
  localStorage.setItem(`${PURGE_LOG_PREFIX}${ownFingerprint}`, JSON.stringify(log));
}

/**
 * Loads DM reactions for the given identity from localStorage.
 * @param {string} ownFingerprint
 * @returns {Record<string, string[]>}
 */
export function loadReactions(ownFingerprint) {
  try {
    const raw = localStorage.getItem(`${REACTIONS_STORAGE_PREFIX}${ownFingerprint}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Persists DM reactions for the given identity to localStorage.
 * @param {string} ownFingerprint
 * @param {Record<string, string[]>} data
 * @returns {void}
 */
export function saveReactions(ownFingerprint, data) {
  localStorage.setItem(`${REACTIONS_STORAGE_PREFIX}${ownFingerprint}`, JSON.stringify(data));
}
