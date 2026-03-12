import serverService from './server.js';
import { customAlert } from './dialogs.js';

/**
 * @param {number} ms
 * @returns {string}
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

const COMMAND_REGISTRY = {
  clear: {
    description: 'Clear the current channel chat',
    /** @param {{channelId: string}} context */
    execute({ channelId }) {
      serverService.send('chat:command', { name: 'clear', channelId });
    },
  },
  purge: {
    description: 'Delete all messages from a user server-wide',
    /** @param {{args: string}} context */
    execute({ args }) {
      const nickname = args.startsWith('@') ? args.slice(1) : args;
      if (!nickname) return;
      serverService.send('chat:command', { name: 'purge', nickname });
    },
  },
  uptime: {
    description: 'Show server uptime',
    /** @param {object} context */
    async execute() {
      try {
        const data = await serverService.request('chat:command', { name: 'uptime' });
        const started = new Date(data.startedAt);
        const uptime = formatUptime(data.uptimeMs);
        customAlert(`Server Uptime: ${uptime}\nOnline since: ${started.toLocaleString()}`);
      } catch (err) {
        customAlert(err.message || 'Failed to retrieve uptime.');
      }
    },
  },
};

/**
 * @param {string} input
 * @param {{channelId: string}} context
 * @returns {boolean}
 */
export function tryHandleCommand(input, context) {
  if (!input.startsWith('/')) return false;

  const trimmed = input.slice(1).trim();
  const spaceIdx = trimmed.indexOf(' ');
  const name = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  const cmd = COMMAND_REGISTRY[name];
  if (!cmd) return false;

  cmd.execute({ ...context, args });
  return true;
}

/**
 * @param {string} input
 * @returns {boolean}
 */
export function isSlashCommand(input) {
  return /^\/[a-z]/i.test(input);
}
