const { test } = require('node:test');
const assert = require('node:assert');
const { isNewerVersion, selectRelease, findAsset } = require('../src/main/update-source');

/**
 * GitHub release object as returned by the releases API.
 * @param {string} tag
 * @param {object} [flags]
 * @param {string[]} [assetNames]
 * @returns {object}
 */
function release(tag, { draft = false, prerelease = false } = {}, assetNames = []) {
  return {
    tag_name: tag,
    draft,
    prerelease,
    assets: assetNames.map((name) => ({ name, size: 10, browser_download_url: `https://github.com/gimodi-app/gimodi-client/releases/download/${tag}/${name}` })),
  };
}

const ASSETS_1_11 = [
  'gimodi_1.11.0_amd64.deb',
  'Gimodi.AppImage',
  'Gimodi-linux-x64-1.11.0.zip',
  'Gimodi-1.11.0.Setup.exe',
  'Gimodi-win32-x64-1.11.0.zip',
  'Gimodi-darwin-x64-1.11.0.zip',
];

test('a higher version is newer', () => {
  assert.strictEqual(isNewerVersion('1.11.0', '1.10.0'), true);
  assert.strictEqual(isNewerVersion('2.0.0', '1.99.9'), true);
});

test('the same or a lower version is not newer', () => {
  assert.strictEqual(isNewerVersion('1.10.0', '1.10.0'), false);
  assert.strictEqual(isNewerVersion('1.9.0', '1.10.0'), false);
});

test('a release is newer than its prereleases, a prerelease is not newer than its release', () => {
  assert.strictEqual(isNewerVersion('1.11.0', '1.11.0-beta.1'), true);
  assert.strictEqual(isNewerVersion('1.11.0-beta.1', '1.11.0'), false);
  assert.strictEqual(isNewerVersion('1.11.0-beta.2', '1.11.0-beta.1'), true);
});

test('stable picks the highest release that is neither draft nor prerelease', () => {
  const releases = [release('v1.12.0-beta.1', { prerelease: true }), release('v1.12.0', { draft: true }), release('v1.11.0'), release('v1.10.0')];
  assert.strictEqual(selectRelease(releases, 'stable').tag_name, 'v1.11.0');
});

test('beta and nightly also take prereleases but never drafts', () => {
  const releases = [release('v1.12.0', { draft: true }), release('v1.12.0-beta.1', { prerelease: true }), release('v1.11.0')];
  assert.strictEqual(selectRelease(releases, 'beta').tag_name, 'v1.12.0-beta.1');
  assert.strictEqual(selectRelease(releases, 'nightly').tag_name, 'v1.12.0-beta.1');
});

test('the highest version wins, not the list order', () => {
  const releases = [release('v1.10.1'), release('v1.11.0')];
  assert.strictEqual(selectRelease(releases, 'stable').tag_name, 'v1.11.0');
});

test('tags that are not versions are ignored', () => {
  assert.strictEqual(selectRelease([release('nightly-build'), release('v1.11.0')], 'nightly').tag_name, 'v1.11.0');
  assert.strictEqual(selectRelease([release('nightly-build')], 'nightly'), null);
});

test('each install type finds its own file', () => {
  const latest = release('v1.11.0', {}, ASSETS_1_11);
  const names = [
    ['linux', 'deb'],
    ['linux', 'appimage'],
    ['linux', 'zip'],
    ['win', 'squirrel'],
    ['win', 'zip'],
    ['darwin', 'zip'],
  ].map(([platform, installType]) => findAsset(latest, platform, installType)?.name);
  assert.deepStrictEqual(names, ASSETS_1_11);
});

test('an asset carries the version, download URL and size', () => {
  const asset = findAsset(release('v1.11.0', {}, ASSETS_1_11), 'linux', 'deb');
  assert.deepStrictEqual(asset, {
    version: '1.11.0',
    name: 'gimodi_1.11.0_amd64.deb',
    url: 'https://github.com/gimodi-app/gimodi-client/releases/download/v1.11.0/gimodi_1.11.0_amd64.deb',
    size: 10,
  });
});

test('a missing file gives no asset', () => {
  assert.strictEqual(findAsset(release('v1.11.0', {}, ['Gimodi.AppImage']), 'win', 'squirrel'), null);
});
