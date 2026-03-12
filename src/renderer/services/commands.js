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
  help: {
    description: 'Show available commands',
    usage: '/help',
    permission: null,
    execute() {
      const available = [];
      for (const [name, cmd] of Object.entries(COMMAND_REGISTRY)) {
        if (!cmd.permission || serverService.permissions.has(cmd.permission)) {
          available.push({ name, usage: cmd.usage, description: cmd.description });
        }
      }

      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.style.zIndex = '10000';

      const content = document.createElement('div');
      content.className = 'modal-content help-commands-modal';

      const title = document.createElement('h2');
      title.textContent = 'Chat Commands';
      content.appendChild(title);

      if (available.length <= 1) {
        const msg = document.createElement('p');
        msg.className = 'help-commands-empty';
        msg.textContent = 'You are not authorized to use any chat commands.';
        content.appendChild(msg);
      } else {
        const list = document.createElement('div');
        list.className = 'help-commands-list';
        for (const cmd of available) {
          const row = document.createElement('div');
          row.className = 'help-commands-row';
          const usage = document.createElement('span');
          usage.className = 'help-commands-usage';
          usage.textContent = cmd.usage;
          const desc = document.createElement('span');
          desc.className = 'help-commands-desc';
          desc.textContent = cmd.description;
          row.appendChild(usage);
          row.appendChild(desc);
          list.appendChild(row);
        }
        content.appendChild(list);
      }

      const btnWrap = document.createElement('div');
      btnWrap.className = 'modal-buttons';
      btnWrap.style.justifyContent = 'flex-end';
      const okBtn = document.createElement('button');
      okBtn.className = 'btn-primary';
      okBtn.textContent = 'OK';
      btnWrap.appendChild(okBtn);
      content.appendChild(btnWrap);

      overlay.appendChild(content);
      document.body.appendChild(overlay);
      okBtn.focus();

      const close = () => overlay.remove();
      okBtn.addEventListener('click', close);
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === 'Escape') close();
      });
    },
  },
  clear: {
    description: 'Clear the current channel chat',
    usage: '/clear',
    permission: 'chat.slash.clear',
    execute({ channelId }) {
      serverService.send('chat:command', { name: 'clear', channelId });
    },
  },
  purge: {
    description: 'Delete all messages from a user server-wide',
    usage: '/purge <nickname>',
    permission: 'chat.slash.purge',
    execute({ args }) {
      const nickname = args.startsWith('@') ? args.slice(1) : args;
      if (!nickname) return;
      serverService.send('chat:command', { name: 'purge', nickname });
    },
  },
  uptime: {
    description: 'Show server uptime',
    usage: '/uptime',
    permission: 'chat.slash.uptime',
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
