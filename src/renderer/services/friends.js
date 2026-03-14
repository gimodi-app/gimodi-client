const STORAGE_KEY_PREFIX = 'dm_friends_';

/**
 * Returns the localStorage key for the friends list of a given identity fingerprint.
 * @param {string} ownFingerprint
 * @returns {string}
 */
function storageKey(ownFingerprint) {
  return `${STORAGE_KEY_PREFIX}${ownFingerprint}`;
}

/**
 * Loads the friends list for the given fingerprint from localStorage.
 * @param {string} ownFingerprint
 * @returns {Array<{fingerprint: string, nickname: string, addedAt: number}>}
 */
function loadFriends(ownFingerprint) {
  try {
    const raw = localStorage.getItem(storageKey(ownFingerprint));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the friends list for the given fingerprint to localStorage.
 * @param {string} ownFingerprint
 * @param {Array<{fingerprint: string, nickname: string, addedAt: number}>} friends
 */
function saveFriends(ownFingerprint, friends) {
  localStorage.setItem(storageKey(ownFingerprint), JSON.stringify(friends));
}

/**
 * Manages the local friends list tied to an identity fingerprint.
 */
export class FriendsService {
  /** @param {string} ownFingerprint - The current user's OpenPGP fingerprint */
  constructor(ownFingerprint) {
    this._fingerprint = ownFingerprint;
  }

  /**
   * Returns all friends.
   * @returns {Array<{fingerprint: string, nickname: string, addedAt: number}>}
   */
  getFriends() {
    return loadFriends(this._fingerprint);
  }

  /**
   * Returns a single friend by fingerprint, or null if not found.
   * @param {string} fingerprint
   * @returns {{fingerprint: string, nickname: string, addedAt: number}|null}
   */
  getFriend(fingerprint) {
    return loadFriends(this._fingerprint).find((f) => f.fingerprint === fingerprint) ?? null;
  }

  /**
   * Adds a friend. Does nothing if the fingerprint is already in the list.
   * @param {string} fingerprint
   * @param {string} nickname
   */
  addFriend(fingerprint, nickname) {
    const friends = loadFriends(this._fingerprint);
    if (friends.some((f) => f.fingerprint === fingerprint)) {
      return;
    }
    friends.push({ fingerprint, nickname, addedAt: Date.now() });
    saveFriends(this._fingerprint, friends);
  }

  /**
   * Updates the nickname for an existing friend.
   * @param {string} fingerprint
   * @param {string} nickname
   */
  renameFriend(fingerprint, nickname) {
    const friends = loadFriends(this._fingerprint);
    const friend = friends.find((f) => f.fingerprint === fingerprint);
    if (friend) {
      friend.nickname = nickname;
      saveFriends(this._fingerprint, friends);
    }
  }

  /**
   * Removes a friend by fingerprint.
   * @param {string} fingerprint
   */
  removeFriend(fingerprint) {
    const friends = loadFriends(this._fingerprint).filter((f) => f.fingerprint !== fingerprint);
    saveFriends(this._fingerprint, friends);
  }

  /**
   * Returns true if the given fingerprint is already a friend.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  isFriend(fingerprint) {
    return loadFriends(this._fingerprint).some((f) => f.fingerprint === fingerprint);
  }
}
