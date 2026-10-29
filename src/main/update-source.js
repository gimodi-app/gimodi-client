const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

const ASSET_PATTERNS = {
  linux: {
    deb: /_amd64\.deb$/,
    appimage: /\.AppImage$/,
    zip: /^Gimodi-linux-x64-.+\.zip$/,
  },
  win: {
    squirrel: /Setup\.exe$/i,
    zip: /^Gimodi-win32-x64-.+\.zip$/,
  },
  darwin: {
    zip: /^Gimodi-darwin-x64-.+\.zip$/,
  },
};

/**
 * Splits a version string like `1.11.0` or `v1.12.0-beta.1` into its parts.
 * @param {string} version - Version or tag name.
 * @returns {{core: number[], pre: string[]}|null} Null when the string is not a version.
 */
function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    return null;
  }
  return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] };
}

/**
 * Compares two prerelease identifier lists by semver rules; an empty list is a release.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number} Negative, zero or positive like a sort comparator.
 */
function comparePrerelease(a, b) {
  if (!a.length || !b.length) {
    return b.length - a.length;
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const bothNumeric = /^\d+$/.test(a[i]) && /^\d+$/.test(b[i]);
    const order = bothNumeric ? Number(a[i]) - Number(b[i]) : a[i].localeCompare(b[i]);
    if (order !== 0) {
      return order;
    }
  }
  return a.length - b.length;
}

/**
 * Compares two parsed versions.
 * @param {{core: number[], pre: string[]}} a
 * @param {{core: number[], pre: string[]}} b
 * @returns {number} Negative, zero or positive like a sort comparator.
 */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) {
      return a.core[i] - b.core[i];
    }
  }
  return comparePrerelease(a.pre, b.pre);
}

/**
 * Whether `candidate` is a higher version than `current`.
 * @param {string} candidate - Offered version.
 * @param {string} current - Running version.
 * @returns {boolean} False when either string is not a version.
 */
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return Boolean(a && b) && compareVersions(a, b) > 0;
}

/**
 * Picks the release an update channel offers: the highest version that is
 * not a draft, and for `stable` also not a prerelease.
 * @param {object[]} releases - Releases from the GitHub releases API.
 * @param {string} channel - `stable`, `beta` or `nightly`.
 * @returns {object|null}
 */
function selectRelease(releases, channel) {
  const candidates = releases.filter((release) => !release.draft && (channel !== 'stable' || !release.prerelease) && parseVersion(release.tag_name));
  candidates.sort((a, b) => compareVersions(parseVersion(b.tag_name), parseVersion(a.tag_name)));
  return candidates[0] ?? null;
}

/**
 * Finds the file of a release that updates the given installation.
 * @param {object} release - Release from the GitHub releases API.
 * @param {'linux'|'win'|'darwin'} platform - Platform key.
 * @param {string} installType - `deb`, `appimage`, `zip` or `squirrel`.
 * @returns {{version: string, name: string, url: string, size: number}|null}
 */
function findAsset(release, platform, installType) {
  const pattern = ASSET_PATTERNS[platform]?.[installType];
  const asset = pattern && release.assets.find((candidate) => pattern.test(candidate.name));
  if (!asset) {
    return null;
  }
  return { version: release.tag_name.replace(/^v/, ''), name: asset.name, url: asset.browser_download_url, size: asset.size };
}

module.exports = { isNewerVersion, selectRelease, findAsset };
