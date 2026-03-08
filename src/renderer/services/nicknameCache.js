import serverService from './server.js';

/** @type {Map<string, string>} */
const cache = new Map();

/**
 * @param {string} userId
 * @param {string} nickname
 */
export function setNickname(userId, nickname) {
  if (userId && nickname) cache.set(userId, nickname);
}

/**
 * @param {string} userId
 */
export function invalidateNickname(userId) {
  cache.delete(userId);
}

/**
 * @param {string} userId
 * @returns {string|null}
 */
export function getCachedNickname(userId) {
  return cache.get(userId) ?? null;
}

/**
 * @param {string[]} userIds
 * @returns {Promise<Object<string, string|null>>}
 */
export async function resolveNicknames(userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const missing = unique.filter(id => !cache.has(id));

  if (missing.length > 0) {
    try {
      const result = await serverService.request('user:get-nicknames', { userIds: missing });
      for (const [userId, nickname] of Object.entries(result.nicknames || {})) {
        cache.set(userId, nickname);
      }
    } catch {
    }
  }

  return Object.fromEntries(unique.map(id => [id, cache.get(id) ?? null]));
}
