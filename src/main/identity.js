const path = require('path');
const fs = require('fs');
const os = require('os');

let openpgp;

function getConfigDir() {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'gimodi');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'gimodi');
  } else {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gimodi');
  }
}

function getIdentitiesPath() {
  return path.join(getConfigDir(), 'identities.json');
}

function loadIdentities() {
  try {
    const data = fs.readFileSync(getIdentitiesPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveIdentities(identities) {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getIdentitiesPath(), JSON.stringify(identities, null, 2));
}

async function getOpenpgp() {
  if (!openpgp) {
    patchAesKw();
    openpgp = await import('openpgp');
  }
  return openpgp;
}

/**
 * Electron's bundled OpenSSL doesn't support AES-KW for wrapKey/unwrapKey.
 * openpgp's wrap/unwrap functions try WebCrypto first: they call importKey
 * with { name: 'AES-KW' }, and if that throws NotSupportedError, they fall
 * back to pure-JS. We patch importKey to reject AES-KW, which triggers the
 * fallback in both wrap() and unwrap().
 */
let aesKwPatched = false;
function patchAesKw() {
  if (aesKwPatched) return;
  aesKwPatched = true;

  const nodeCrypto = require('crypto');
  const subtle = nodeCrypto.webcrypto?.subtle || globalThis.crypto?.subtle;
  if (!subtle) return;

  const origImportKey = subtle.importKey.bind(subtle);

  subtle.importKey = async function(format, keyData, algorithm, extractable, keyUsages) {
    const algoName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
    if (algoName === 'AES-KW') {
      throw new DOMException('AES-KW not supported', 'NotSupportedError');
    }
    return origImportKey(format, keyData, algorithm, extractable, keyUsages);
  };
}

async function createIdentity(name) {
  const pgp = await getOpenpgp();
  const { privateKey, publicKey } = await pgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name }],
    format: 'armored',
  });

  const parsed = await pgp.readKey({ armoredKey: publicKey });
  const fingerprint = parsed.getFingerprint();

  const identity = {
    name,
    publicKeyArmored: publicKey,
    privateKeyArmored: privateKey,
    fingerprint,
    isDefault: false,
    createdAt: Date.now(),
  };

  const identities = loadIdentities();
  if (identities.length === 0) {
    identity.isDefault = true;
  }
  identities.push(identity);
  saveIdentities(identities);

  return sanitizeIdentity(identity);
}

function deleteIdentity(fingerprint) {
  const identities = loadIdentities();
  if (identities.length <= 1) {
    throw new Error('Cannot delete the last identity.');
  }

  const idx = identities.findIndex(i => i.fingerprint === fingerprint);
  if (idx === -1) throw new Error('Identity not found.');

  const wasDefault = identities[idx].isDefault;
  identities.splice(idx, 1);

  // If we deleted the default, assign a new one
  if (wasDefault && identities.length > 0) {
    identities[0].isDefault = true;
  }

  saveIdentities(identities);
}

/**
 * @param {string} fingerprint
 * @param {string} newName
 */
function renameIdentity(fingerprint, newName) {
  const identities = loadIdentities();
  const identity = identities.find(i => i.fingerprint === fingerprint);
  if (!identity) throw new Error('Identity not found.');
  identity.name = newName;
  saveIdentities(identities);
  return sanitizeIdentity(identity);
}

function setDefaultIdentity(fingerprint) {
  const identities = loadIdentities();
  let found = false;
  for (const id of identities) {
    if (id.fingerprint === fingerprint) {
      id.isDefault = true;
      found = true;
    } else {
      id.isDefault = false;
    }
  }
  if (!found) throw new Error('Identity not found.');
  saveIdentities(identities);
}

function getDefaultIdentity() {
  const identities = loadIdentities();
  const def = identities.find(i => i.isDefault);
  return def ? sanitizeIdentity(def) : (identities[0] ? sanitizeIdentity(identities[0]) : null);
}

async function ensureDefaultIdentity() {
  await migrateIdentities();
  const identities = loadIdentities();
  if (identities.length === 0) {
    return await createIdentity('Default');
  }
  return sanitizeIdentity(identities.find(i => i.isDefault) || identities[0]);
}

/**
 * Migrate identities generated with curve25519 (IETF/v6) to curve25519Legacy.
 * Detects by checking if the public key packet uses the new format.
 */
async function migrateIdentities() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(getIdentitiesPath(), 'utf-8'));
  } catch {
    return;
  }

  const pgp = await getOpenpgp();
  let changed = false;

  for (let i = 0; i < raw.length; i++) {
    const id = raw[i];
    try {
      const key = await pgp.readKey({ armoredKey: id.publicKeyArmored });
      await pgp.encrypt({
        message: await pgp.createMessage({ text: 'test' }),
        encryptionKeys: key,
        format: 'armored',
      });
    } catch {
      // This key is broken - regenerate with the same name
      console.log(`[identity] Migrating identity "${id.name}" to curve25519Legacy...`);
      const { privateKey, publicKey } = await pgp.generateKey({
        type: 'ecc',
        curve: 'curve25519Legacy',
        userIDs: [{ name: id.name }],
        format: 'armored',
      });
      const parsed = await pgp.readKey({ armoredKey: publicKey });
      raw[i] = {
        ...id,
        publicKeyArmored: publicKey,
        privateKeyArmored: privateKey,
        fingerprint: parsed.getFingerprint(),
      };
      changed = true;
    }
  }

  if (changed) {
    saveIdentities(raw);
    console.log('[identity] Migration complete.');
  }
}

/**
 * Returns identity data safe to send to renderer (includes public key but not private key).
 */
function sanitizeIdentity(identity) {
  return {
    name: identity.name,
    fingerprint: identity.fingerprint,
    publicKeyArmored: identity.publicKeyArmored,
    isDefault: identity.isDefault,
    createdAt: identity.createdAt,
  };
}

function loadAllSanitized() {
  return loadIdentities().map(sanitizeIdentity);
}

/**
 * Get the full identity (including private key) - only used internally in main process.
 */
function getFullIdentity(fingerprint) {
  const identities = loadIdentities();
  return identities.find(i => i.fingerprint === fingerprint) || null;
}

/**
 * Encrypt plaintext for a recipient (and optionally the sender) using openpgp.
 * recipientPublicKeys: array of armored public key strings.
 */
async function encryptMessage(recipientPublicKeys, plaintext) {
  const pgp = await getOpenpgp();

  const encryptionKeys = [];
  for (const armoredKey of recipientPublicKeys) {
    encryptionKeys.push(await pgp.readKey({ armoredKey }));
  }

  const encrypted = await pgp.encrypt({
    message: await pgp.createMessage({ text: plaintext }),
    encryptionKeys,
    format: 'armored',
  });

  return encrypted;
}

/**
 * Decrypt an armored PGP message using the current default identity's private key.
 */
async function decryptMessage(armoredMessage) {
  const pgp = await getOpenpgp();
  const identities = loadIdentities();
  const defaultIdentity = identities.find(i => i.isDefault) || identities[0];
  if (!defaultIdentity) throw new Error('No identity available for decryption.');

  // We need the full private key, but loadIdentities() strips it.
  // Load raw from file.
  const rawIdentities = JSON.parse(require('fs').readFileSync(getIdentitiesPath(), 'utf-8'));
  const raw = rawIdentities.find(i => i.fingerprint === defaultIdentity.fingerprint);
  if (!raw || !raw.privateKeyArmored) throw new Error('Private key not found.');

  const privateKey = await pgp.readPrivateKey({ armoredKey: raw.privateKeyArmored });
  const message = await pgp.readMessage({ armoredMessage });

  const { data } = await pgp.decrypt({
    message,
    decryptionKeys: privateKey,
  });

  return data;
}

/**
 * Export a single identity (including private key) as a JSON object.
 * Returns null if not found.
 */
function exportIdentity(fingerprint) {
  const identities = loadIdentities(); // sanitized (no private key)
  // Load full (private key) from raw file
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(getIdentitiesPath(), 'utf-8'));
  } catch {
    raw = [];
  }
  const full = raw.find(i => i.fingerprint === fingerprint);
  if (!full) throw new Error('Identity not found.');
  return {
    version: 1,
    name: full.name,
    fingerprint: full.fingerprint,
    publicKeyArmored: full.publicKeyArmored,
    privateKeyArmored: full.privateKeyArmored,
    createdAt: full.createdAt,
  };
}

/**
 * Import an identity from a parsed JSON object.
 * Returns sanitized identity. Throws if invalid or duplicate.
 */
async function importIdentity(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid identity file.');
  const { name, fingerprint, publicKeyArmored, privateKeyArmored } = data;
  if (!name || !fingerprint || !publicKeyArmored || !privateKeyArmored) {
    throw new Error('Identity file is missing required fields.');
  }

  // Validate key pair
  const pgp = await getOpenpgp();
  let parsedKey;
  try {
    parsedKey = await pgp.readKey({ armoredKey: publicKeyArmored });
  } catch {
    throw new Error('Invalid public key in identity file.');
  }
  try {
    await pgp.readPrivateKey({ armoredKey: privateKeyArmored });
  } catch {
    throw new Error('Invalid private key in identity file.');
  }

  const actualFingerprint = parsedKey.getFingerprint();
  if (actualFingerprint !== fingerprint) {
    throw new Error('Fingerprint mismatch - identity file may be corrupt.');
  }

  // Check for duplicate
  const existing = loadIdentities(); // sanitized
  if (existing.some(i => i.fingerprint === fingerprint)) {
    throw new Error('This identity is already imported.');
  }

  // Load raw and append
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(getIdentitiesPath(), 'utf-8'));
  } catch {
    raw = [];
  }

  const identity = {
    name,
    fingerprint,
    publicKeyArmored,
    privateKeyArmored,
    isDefault: raw.length === 0,
    createdAt: data.createdAt || Date.now(),
  };
  raw.push(identity);
  saveIdentities(raw);

  return sanitizeIdentity(identity);
}

module.exports = {
  loadIdentities: loadAllSanitized,
  createIdentity,
  deleteIdentity,
  renameIdentity,
  setDefaultIdentity,
  getDefaultIdentity,
  ensureDefaultIdentity,
  getFullIdentity,
  encryptMessage,
  decryptMessage,
  exportIdentity,
  importIdentity,
};
