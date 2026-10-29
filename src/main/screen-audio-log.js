const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_LOG_BYTES = 5 * 1024 * 1024;

let logFile = null;

/**
 * Moves a log file to `<file>.1` once it is larger than 5 MB.
 * @param {string} file - Log file path.
 * @returns {void}
 */
function rotateIfLarge(file) {
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('[screen-audio-log] rotate failed:', e.message);
    }
  }
}

/**
 * Path of the screen share audio diagnostics log, `<logs>/screen-audio.log`.
 * @returns {string}
 */
function getLogFile() {
  if (!logFile) {
    logFile = path.join(app.getPath('logs'), 'screen-audio.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  }
  return logFile;
}

/**
 * Writes one line to the console and to the screen share audio diagnostics log.
 * @param {string} scope - Component that logs, e.g. `venmic` or `renderer:screen`.
 * @param {string} message - What happened.
 * @param {unknown} [data] - Details, written as JSON.
 * @returns {void}
 */
function log(scope, message, data) {
  const details = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  const line = `${new Date().toISOString()} [${scope}] ${message}${details}`;
  console.log(line);
  try {
    const file = getLogFile();
    rotateIfLarge(file);
    fs.appendFileSync(file, `${line}\n`);
  } catch (e) {
    console.error('[screen-audio-log] write failed:', e.message);
  }
}

module.exports = { log, getLogFile, rotateIfLarge };
