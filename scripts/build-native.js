const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const crateDir = path.join(__dirname, '..', 'native', 'screencast');
const target = path.join(crateDir, 'screencast.node');

/**
 * Number of parallel cargo jobs: CARGO_BUILD_JOBS or half of the CPU cores.
 * @returns {string}
 */
function cargoJobs() {
  return process.env.CARGO_BUILD_JOBS || String(Math.max(1, Math.floor(os.cpus().length / 2)));
}

/**
 * Builds the native screen capture module and copies it next to its loader.
 * Skips on non-Linux platforms and when cargo is not installed.
 * @returns {void}
 * @throws {Error} When the cargo build fails.
 */
function buildNative() {
  if (process.platform !== 'linux') {
    console.log('[build-native] skipped: the screen capture module is Linux only');
    return;
  }
  if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.log('[build-native] skipped: cargo not found, Wayland portal capture will be unavailable');
    return;
  }
  execFileSync(
    'cargo',
    ['build', '--release', '--jobs', cargoJobs(), '--manifest-path', path.join(crateDir, 'Cargo.toml'), '-p', 'gimodi-screencast'],
    { stdio: 'inherit' },
  );
  fs.copyFileSync(path.join(crateDir, 'target', 'release', 'libgimodi_screencast.so'), target);
  console.log(`[build-native] built ${path.relative(process.cwd(), target)}`);
}

buildNative();
