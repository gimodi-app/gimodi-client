const path = require('path');
const fs = require('fs');
const os = require('os');

let openpgp;

// --- Legacy paths (used only for migration) ---

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

function getLegacyIdentitiesPath() {
  return path.join(getConfigDir(), 'identities.json');
}

// --- Database access (lazy, set after db module initializes) ---

let _appSettingsRepo = null;

/**
 * @param {object} repo
 */
function setAppSettingsRepo(repo) {
  _appSettingsRepo = repo;
}

/**
 * @returns {object}
 */
function repo() {
  if (!_appSettingsRepo) {throw new Error('Identity module not initialized. Call setAppSettingsRepo first.');}
  return _appSettingsRepo;
}

// --- OpenPGP lazy loading ---

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
  if (aesKwPatched) {
    return;
  }
  aesKwPatched = true;

  const nodeCrypto = require('crypto');
  const subtle = nodeCrypto.webcrypto?.subtle || globalThis.crypto?.subtle;
  if (!subtle) {
    return;
  }

  const origImportKey = subtle.importKey.bind(subtle);

  subtle.importKey = async function (format, keyData, algorithm, extractable, keyUsages) {
    const algoName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
    if (algoName === 'AES-KW') {
      throw new DOMException('AES-KW not supported', 'NotSupportedError');
    }
    return origImportKey(format, keyData, algorithm, extractable, keyUsages);
  };
}

// --- Identity CRUD (uses database) ---

/**
 * @param {string} name
 * @returns {Promise<{fingerprint: string, name: string, public_key: string, created_at: number}>}
 */
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
    fingerprint,
    name,
    public_key: publicKey,
    private_key: privateKey,
    created_at: Date.now(),
  };

  repo().insertIdentity(identity);

  return {
    fingerprint: identity.fingerprint,
    name: identity.name,
    public_key: identity.public_key,
    created_at: identity.created_at,
  };
}

/**
 * @param {object} data - Parsed identity export file
 * @returns {Promise<{fingerprint: string, name: string, public_key: string, created_at: number}>}
 */
async function importIdentity(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid identity file.');
  }
  const { name, fingerprint, publicKeyArmored, privateKeyArmored } = data;
  if (!name || !fingerprint || !publicKeyArmored || !privateKeyArmored) {
    throw new Error('Identity file is missing required fields.');
  }

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

  const existing = repo().getIdentity(fingerprint);
  if (existing) {
    throw new Error('This identity is already imported.');
  }

  const identity = {
    fingerprint,
    name,
    public_key: publicKeyArmored,
    private_key: privateKeyArmored,
    created_at: data.createdAt || Date.now(),
  };

  repo().insertIdentity(identity);

  return {
    fingerprint: identity.fingerprint,
    name: identity.name,
    public_key: identity.public_key,
    created_at: identity.created_at,
  };
}

// --- Encryption / Decryption ---

/**
 * @param {string[]} recipientPublicKeys - Array of armored public key strings
 * @param {string} plaintext
 * @returns {Promise<string>}
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
 * @param {string} armoredMessage
 * @returns {Promise<string>}
 */
async function decryptMessage(armoredMessage) {
  const pgp = await getOpenpgp();

  const identities = repo().listIdentitiesWithPrivateKeys();
  if (identities.length === 0) {
    throw new Error('No identity available for decryption.');
  }

  const decryptionKeys = await Promise.all(
    identities.map((i) => pgp.readPrivateKey({ armoredKey: i.private_key }))
  );

  const message = await pgp.readMessage({ armoredMessage });

  const { data } = await pgp.decrypt({
    message,
    decryptionKeys,
  });

  return data;
}

/**
 * @returns {string}
 */
function generateSessionKey() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('base64');
}

/**
 * @param {string} base64Key
 * @param {string} plaintext
 * @returns {string}
 */
function encryptWithSessionKey(base64Key, plaintext) {
  const crypto = require('crypto');
  const key = Buffer.from(base64Key, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

/**
 * @param {string} base64Key
 * @param {string} ciphertext
 * @returns {string}
 */
function decryptWithSessionKey(base64Key, ciphertext) {
  const crypto = require('crypto');
  const key = Buffer.from(base64Key, 'base64');
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(12, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * @param {string} base64Key
 * @param {Array<{fingerprint: string, publicKeyArmored: string}>} participants
 * @returns {Promise<Record<string, string>>}
 */
async function encryptSessionKeyForParticipants(base64Key, participants) {
  const pgp = await getOpenpgp();
  const result = {};
  for (const { fingerprint, publicKeyArmored } of participants) {
    const encryptionKey = await pgp.readKey({ armoredKey: publicKeyArmored });
    const encrypted = await pgp.encrypt({
      message: await pgp.createMessage({ text: base64Key }),
      encryptionKeys: [encryptionKey],
      format: 'armored',
    });
    result[fingerprint] = encrypted;
  }
  return result;
}

/**
 * @param {string} encryptedKey
 * @returns {Promise<string>}
 */
async function decryptSessionKey(encryptedKey) {
  return decryptMessage(encryptedKey);
}

// --- Legacy Migration ---

/**
 * @returns {Array<object>|null}
 */
function loadLegacyIdentities() {
  try {
    const data = fs.readFileSync(getLegacyIdentitiesPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * @param {Array<object>} identities
 */
async function migrateLegacyIdentities(identities) {
  const pgp = await getOpenpgp();

  for (const id of identities) {
    let publicKeyArmored = id.publicKeyArmored;
    let privateKeyArmored = id.privateKeyArmored;
    let fingerprint = id.fingerprint;

    try {
      const key = await pgp.readKey({ armoredKey: publicKeyArmored });
      await pgp.encrypt({
        message: await pgp.createMessage({ text: 'test' }),
        encryptionKeys: key,
        format: 'armored',
      });
    } catch {
      console.log(`[identity] Migrating identity "${id.name}" to curve25519Legacy...`);
      const regen = await pgp.generateKey({
        type: 'ecc',
        curve: 'curve25519Legacy',
        userIDs: [{ name: id.name }],
        format: 'armored',
      });
      publicKeyArmored = regen.publicKey;
      privateKeyArmored = regen.privateKey;
      const parsed = await pgp.readKey({ armoredKey: regen.publicKey });
      fingerprint = parsed.getFingerprint();
    }

    const existing = repo().getIdentity(fingerprint);
    if (!existing) {
      repo().insertIdentity({
        fingerprint,
        name: id.name,
        public_key: publicKeyArmored,
        private_key: privateKeyArmored,
        created_at: id.createdAt || Date.now(),
      });
    }
  }
}

/**
 * @returns {string}
 */
function backupLegacyFile() {
  const src = getLegacyIdentitiesPath();
  const dest = src + '.bak';
  try {
    fs.renameSync(src, dest);
    return dest;
  } catch {
    return null;
  }
}

module.exports = {
  setAppSettingsRepo,
  createIdentity,
  importIdentity,
  encryptMessage,
  decryptMessage,
  generateSessionKey,
  encryptWithSessionKey,
  decryptWithSessionKey,
  encryptSessionKeyForParticipants,
  decryptSessionKey,
  loadLegacyIdentities,
  migrateLegacyIdentities,
  backupLegacyFile,
};
