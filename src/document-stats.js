import { renderer } from './markdown-renderer.js';

// Match the shipped counter's mixed CJK/Latin segmentation, without executing it.
export function countWords(text) {
  if (!text.trim()) return 0;
  let singles = 0;
  text = text.replace(/[\u3040-\uABFF\uD7A4-\uFAFF]/gi, () => { singles++; return ' '; })
    .replace(/['’]\w+/g, 'b').replace(/(^|\s+)[(\u3000-\u303F)!-\/:-@\[-`{-~]+(\s+|$)/gm, ' ');
  return Math.max(0, ['d', text, 'd'].join(' ').split(/[(\u3000-\u303F)\s!-,\\:-@\[-`{-~]+/g).length - 2 + singles);
}

function textForTokens(tokens) {
  return tokens.map(token => {
    if (token.type === 'image') return '';
    if (token.children) return textForTokens(token.children);
    if (token.type === 'fence') return `\`\`\`${token.info}\n${token.content}\n\`\`\``;
    if (token.type === 'softbreak' || token.type === 'hardbreak' || token.block) return token.content + '\n';
    if (token.type === 'html_inline') return '';
    return token.content || '';
  }).join('');
}

export function documentStats(source, speed = 382) {
  const words = countWords(textForTokens(renderer.parse(source, {})));
  return { words, characters: source.length, lines: source.split(/\r\n|\n|\r/).length,
    minutes: Math.round(words / speed) };
}

export function statisticLabel(stats, delimiter) {
  return delimiter === 3 ? `${stats.minutes || '≤1'} 分钟` : delimiter === 2 ? `${stats.lines.toLocaleString()} 行`
    : delimiter === 1 ? `${stats.characters.toLocaleString()} 字符` : `${stats.words.toLocaleString()} 词`;
}
