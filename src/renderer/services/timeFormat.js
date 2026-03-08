/** @type {string} */
let currentFormat = 'locale';

/**
 * @param {string} fmt
 */
export function setTimeFormat(fmt) {
  currentFormat = fmt;
}

/**
 * @returns {string}
 */
export function getTimeFormat() {
  return currentFormat;
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function formatTime(timestamp) {
  const d = new Date(timestamp);
  switch (currentFormat) {
    case 'eu-24h':
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    case 'us-12h':
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    case 'iso-24h':
      return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    default:
      return d.toLocaleTimeString();
  }
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function formatTimeShort(timestamp) {
  const d = new Date(timestamp);
  switch (currentFormat) {
    case 'eu-24h':
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
    case 'us-12h':
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    case 'iso-24h':
      return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', hour12: false });
    default:
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function formatDateShort(timestamp) {
  const d = new Date(timestamp);
  switch (currentFormat) {
    case 'eu-24h':
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'us-12h':
      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    case 'iso-24h':
      return d.toLocaleDateString('sv-SE');
    default:
      return d.toLocaleDateString();
  }
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function formatRelativeTime(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const time = formatTimeShort(timestamp);

  if (msgDay.getTime() === today.getTime()) {
    return time;
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return `Yesterday ${time}`;
  }
  return `${formatDateShort(timestamp)}, ${time}`;
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDateTime(timestamp) {
  const d = new Date(timestamp);
  switch (currentFormat) {
    case 'eu-24h': {
      const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return `${date} ${time}`;
    }
    case 'us-12h': {
      const date = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
      const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      return `${date} ${time}`;
    }
    case 'iso-24h': {
      const date = d.toLocaleDateString('sv-SE');
      const time = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return `${date} ${time}`;
    }
    default:
      return d.toLocaleString();
  }
}
