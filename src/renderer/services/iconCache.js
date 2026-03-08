/**
 * @param {string} serverAddress
 * @param {string} iconHash
 * @returns {Promise<string|null>}
 */
export async function getServerIcon(serverAddress, iconHash) {
  if (!iconHash) return null;
  const cached = await window.gimodi.iconCache.get(serverAddress, iconHash);
  if (cached) return 'file://' + cached;
  try {
    const buffer = await window.gimodi.iconCache.fetch(serverAddress);
    if (!buffer) return null;
    const path = await window.gimodi.iconCache.save(serverAddress, iconHash, new Uint8Array(buffer));
    return 'file://' + path;
  } catch {
    return null;
  }
}
