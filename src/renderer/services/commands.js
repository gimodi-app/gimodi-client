import serverService from './server.js';

const COMMAND_REGISTRY = {
  clear: {
    description: 'Clear the current channel chat',
    /** @param {{channelId: string}} context */
    execute({ channelId }) {
      serverService.send('chat:command', { name: 'clear', channelId });
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

  const [rawName] = input.slice(1).trim().split(/\s+/);
  const name = rawName.toLowerCase();

  const cmd = COMMAND_REGISTRY[name];
  if (!cmd) return false;

  cmd.execute(context);
  return true;
}

/**
 * @param {string} input
 * @returns {boolean}
 */
export function isSlashCommand(input) {
  return /^\/[a-z]/i.test(input);
}
