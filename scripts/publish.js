#!/usr/bin/env node

// Publishes a built installer artifact to GRS (Gimodi Release Server).
//
// Usage:
//   node scripts/publish.js --platform <win|linux|darwin> --format <format> [--channel <channel>]
//
// Formats:
//   win:    squirrel, zip
//   darwin: zip
//   linux:  deb, appimage, zip
//
// Environment variables (required):
//   GRS_URL           - GRS base URL (e.g. https://releases.gimodi.com)
//   GRS_CLIENT_ID     - Admin client ID
//   GRS_CLIENT_SECRET - Admin client secret
//
// This script expects `electron-forge make` to have already been run.
// It finds the artifact in out/make/<maker-dir>/, authenticates with GRS,
// creates the release version, and uploads the file.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Maps --format to the maker output directory and expected file extension.
const FORMAT_CONFIG = {
  squirrel: { dir: 'squirrel.windows', ext: '.exe', platform: 'win' },
  deb: { dir: 'deb', ext: '.deb', platform: 'linux' },
  appimage: { dir: 'AppImage', ext: '.AppImage', platform: 'linux' },
  zip: { dir: 'zip', ext: '.zip', platform: null },
};

const VALID_PLATFORMS = ['win', 'linux', 'darwin'];
const VALID_CHANNELS = ['stable', 'beta', 'nightly'];

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function usage() {
  console.error('Usage: node scripts/publish.js --platform <win|linux|darwin> --format <format> [--channel <channel>]');
  console.error('');
  console.error('Formats: squirrel (win), deb, appimage (linux), zip (any)');
  console.error('Channels: stable (default), beta, nightly');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let platform = null;
  let format = null;
  let channel = 'stable';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      platform = args[++i];
    } else if (args[i] === '--format' && args[i + 1]) {
      format = args[++i];
    } else if (args[i] === '--channel' && args[i + 1]) {
      channel = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      usage();
    }
  }

  if (!platform) die('--platform is required');
  if (!format) die('--format is required');
  if (!VALID_PLATFORMS.includes(platform)) die(`Invalid platform: ${platform} (expected: ${VALID_PLATFORMS.join(', ')})`);
  if (!VALID_CHANNELS.includes(channel)) die(`Invalid channel: ${channel} (expected: ${VALID_CHANNELS.join(', ')})`);
  if (!FORMAT_CONFIG[format]) die(`Invalid format: ${format} (expected: ${Object.keys(FORMAT_CONFIG).join(', ')})`);
  if (FORMAT_CONFIG[format].platform !== null && FORMAT_CONFIG[format].platform !== platform) {
    die(`Format "${format}" is for platform "${FORMAT_CONFIG[format].platform}", not "${platform}"`);
  }

  return { platform, format, channel };
}

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function findArtifact(format) {
  const config = FORMAT_CONFIG[format];
  const makeDir = path.join(__dirname, '..', 'out', 'make');
  if (!fs.existsSync(makeDir)) {
    die(`out/make/ directory not found. Run "npm run make" first.`);
  }

  const makerDir = path.join(makeDir, config.dir);
  if (!fs.existsSync(makerDir)) {
    die(`Maker directory not found: out/make/${config.dir}/\nRun the matching deploy command first.`);
  }

  // Walk to find matching files (handles arch subdirs like x64/, arm64/)
  const candidates = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(config.ext)) {
        candidates.push(full);
      }
    }
  }
  walk(makerDir);

  if (candidates.length === 0) {
    die(`No ${config.ext} file found in out/make/${config.dir}/`);
  }

  // Pick the largest (e.g. full installer over delta nupkg)
  candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return candidates[0];
}

async function login(grsUrl, clientId, clientSecret) {
  const body = JSON.stringify({ client_id: clientId, client_secret: clientSecret });
  const res = await request(
    `${grsUrl}/v2/admin/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    body,
  );

  if (res.status !== 200) {
    die(`GRS login failed (${res.status}): ${res.body}`);
  }
  return JSON.parse(res.body).accessToken;
}

async function createRelease(grsUrl, token, version) {
  const body = JSON.stringify({ version });
  const res = await request(
    `${grsUrl}/v2/admin/releases`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
      },
    },
    body,
  );

  // 204 = created, 409/conflict = already exists (both are fine)
  if (res.status !== 204 && res.status !== 409) {
    die(`Failed to create release (${res.status}): ${res.body}`);
  }
}

function uploadFile(grsUrl, token, version, platform, channel, format, filePath) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(filePath);
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;
    const boundary = `----GimodiPublish${Date.now()}`;

    const prelude = Buffer.from(`--${boundary}\r\n` + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` + `Content-Type: application/octet-stream\r\n\r\n`);
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
    const totalLength = prelude.length + fileSize + epilogue.length;

    const url = `${grsUrl}/v2/admin/releases/${version}/${platform}/${channel}/${format}`;
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalLength,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode !== 204) {
            reject(new Error(`Upload failed (${res.statusCode}): ${body}`));
          } else {
            resolve();
          }
        });
      },
    );

    req.on('error', reject);
    req.write(prelude);
    fileStream.on('data', (chunk) => req.write(chunk));
    fileStream.on('end', () => {
      req.write(epilogue);
      req.end();
    });
    fileStream.on('error', reject);
  });
}

async function main() {
  const { platform, format, channel } = parseArgs();

  const grsUrl = (process.env.GRS_URL || '').replace(/\/v[0-9]+\/?$/, '');
  const clientId = process.env.GRS_CLIENT_ID;
  const clientSecret = process.env.GRS_CLIENT_SECRET;

  if (!grsUrl) die('GRS_URL environment variable is required');
  if (!clientId) die('GRS_CLIENT_ID environment variable is required');
  if (!clientSecret) die('GRS_CLIENT_SECRET environment variable is required');

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  const version = pkg.version;

  console.log(`Publishing v${version} for ${platform}/${channel} (${format})`);

  // Find artifact
  const artifact = findArtifact(format);
  const artifactSize = (fs.statSync(artifact).size / (1024 * 1024)).toFixed(1);
  console.log(`Artifact: ${path.basename(artifact)} (${artifactSize} MB)`);

  // Authenticate
  console.log('Authenticating with GRS...');
  const token = await login(grsUrl, clientId, clientSecret);

  // Create release version
  console.log(`Creating release v${version}...`);
  await createRelease(grsUrl, token, version);

  // Upload
  console.log('Uploading...');
  await uploadFile(grsUrl, token, version, platform, channel, format, artifact);

  console.log('Published successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
