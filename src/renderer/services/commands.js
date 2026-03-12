import serverService from './server.js';

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
