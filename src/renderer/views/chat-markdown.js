import { replaceEmojiShortcodes } from '../services/emoji-shortcodes.js';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import typescript from 'highlight.js/lib/languages/typescript';
import { getCachedNickname } from '../services/nicknameCache.js';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c++', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch {
          // Fall through to no highlighting
        }
      }
      return code;
    },
  }),
);
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    // Escape raw HTML tokens to prevent XSS. Code block content is handled
    // by marked internally, so pre-escaping the entire input is not needed.
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

/**
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export const EMOTICON_MAP = {
  ':)': '\u{1F642}',
  ':-)': '\u{1F642}',
  ':(': '\u{1F641}',
  ':-(': '\u{1F641}',
  ':D': '\u{1F604}',
  ':-D': '\u{1F604}',
  ';)': '\u{1F609}',
  ';-)': '\u{1F609}',
  ':P': '\u{1F61B}',
  ':-P': '\u{1F61B}',
  ':p': '\u{1F61B}',
  ':-p': '\u{1F61B}',
  xD: '\u{1F606}',
  XD: '\u{1F606}',
  ':O': '\u{1F62E}',
  ':-O': '\u{1F62E}',
  ':o': '\u{1F62E}',
  ':-o': '\u{1F62E}',
  ":'(": '\u{1F622}',
  ":'-(": '\u{1F622}',
  ':*': '\u{1F618}',
  ':-*': '\u{1F618}',
  '<3': '\u{2764}\u{FE0F}',
  '</3': '\u{1F494}',
  'B)': '\u{1F60E}',
  'B-)': '\u{1F60E}',
  ':/': '\u{1F615}',
  ':-/': '\u{1F615}',
  ':\\': '\u{1F615}',
  ':-\\': '\u{1F615}',
  ':S': '\u{1F616}',
  ':-S': '\u{1F616}',
  '>:(': '\u{1F620}',
  '>:-(': '\u{1F620}',
  ':3': '\u{1F60A}',
  'o.O': '\u{1F928}',
  'O.o': '\u{1F928}',
  '^_^': '\u{1F60A}',
  '-_-': '\u{1F611}',
  T_T: '\u{1F62D}',
};

// Build regex: sort by length descending so longer emoticons match first
export const EMOTICON_RE = new RegExp(
  '(?<=^|\\s)(' +
    Object.keys(EMOTICON_MAP)
      .sort((a, b) => b.length - a.length)
      .map((k) => k.replace(/([.*+?^${}()|[\]\\/<>])/g, '\\$1'))
      .join('|') +
    ')(?=$|\\s)',
  'g',
);

export const EMOJI_RE = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\u{FE0F}|\u{200D}|\p{Emoji_Modifier}|\p{Emoji_Component}|\p{Emoji_Presentation}|\p{Extended_Pictographic})*/gu;

/**
 * @param {string} text
 * @returns {string}
 */
export function replaceEmoticons(text) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      const withShortcodes = replaceEmojiShortcodes(part);
      return withShortcodes.replace(EMOTICON_RE, (m) => EMOTICON_MAP[m] || m);
    })
    .join('');
}

/**
 * @param {string} text
 * @returns {string}
 */
export function autoLinkUrls(text) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      return part.replace(/(?<!\]\()https?:\/\/[^\s<>)\]]+/g, (url) => `[${url}](${url})`);
    })
    .join('');
}

/**
 * @param {string} html
 * @returns {string}
 */
export function wrapEmojis(html) {
  return html
    .replace(/(<[^>]+>)|(<code[\s\S]*?<\/code>)/gi, '\0$&\0')
    .split('\0')
    .map((part) => {
      if (part.startsWith('<')) {
        return part;
      }
      return part.replace(EMOJI_RE, '<span class="emoji">$&</span>');
    })
    .join('');
}

/**
 * @param {string} html
 * @returns {string}
 */
export function highlightMentions(html) {
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code>[^<]*<\/code>)/gi);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      return part.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
        if (tag) {
          return tag;
        }
        let result = text.replace(/@u\(([^)]+)\)/g, (full, id) => {
          let nick = null;
          if (window.gimodiClients) {
            const c = window.gimodiClients.find((cl) => cl.userId === id || cl.id === id);
            nick = c?.nickname ?? null;
          }
          if (!nick) {
            nick = getCachedNickname(id);
          }
          if (!nick) {
            nick = id.slice(0, 8);
          }
          return `<span class="mention">@${escapeHtml(nick)}</span>`;
        });
        result = result.replace(/#c\(([^)]+)\)/g, (full, channelId) => {
          const channels = window.gimodiChannels || [];
          const ch = channels.find((c) => c.id === channelId);
          const name = ch ? ch.name : channelId.slice(0, 8);
          return `<span class="channel-mention" data-channel-id="${escapeHtml(channelId)}">#${escapeHtml(name)}</span>`;
        });
        return result;
      });
    })
    .join('');
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isEmojiOnly(text) {
  // eslint-disable-next-line no-misleading-character-class
  const stripped = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\p{Emoji_Modifier}\p{Emoji_Component}\s]/gu, '');
  return stripped.length === 0 && text.trim().length > 0;
}

/**
 * Renders message text to HTML with emoji, markdown, mentions, and code highlighting.
 * @param {string} text
 * @returns {string}
 */
export function renderMarkdown(text) {
  const withEmoji = replaceEmoticons(text);
  const linked = autoLinkUrls(withEmoji);

  const segments = linked.split(/(```[\s\S]*?```)/g);
  let html = '';

  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) {
      html += marked.parse(segments[i]).replace(/\n$/, '');
    } else {
      const lines = segments[i].split('\n');
      html += lines.map((line) => marked.parseInline(line)).join('<br>');
    }
  }

  const withMentions = highlightMentions(html);
  return wrapEmojis(withMentions);
}
