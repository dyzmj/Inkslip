import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import tasks from 'markdown-it-task-lists';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import { full as emoji } from 'markdown-it-emoji';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
import { writingDefaults, remapOnParse, remapMarkdownPunctuation } from './smart-punctuation.js';

let writingOptions = { ...writingDefaults };
export let renderingVersion = 0;
export function configureRendering(options) {
  writingOptions = { ...writingDefaults, ...options };
  renderer.set({ breaks: writingOptions.preserveLineBreaks, typographer: writingOptions.convertSmartOnRender && writingOptions.smartQuotes });
  renderingVersion++;
}

export const renderer = new MarkdownIt({
  html: true, linkify: true, breaks: true,
  highlight(code, language) {
    return language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '';
  }
}).use(footnote).use(tasks, { enabled: true }).use(mark).use(sub).use(sup)
  .use(deflist).use(abbr).use(emoji).use(texmath, {
    engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false, strict: 'ignore', trust: false }
  });
// Smart dashes include ellipses, while preserving (c)/(tm).
renderer.core.ruler.disable('replacements');
renderer.core.ruler.before('normalize', 'unicode_punctuation', state => {
  if (remapOnParse(writingOptions)) state.src = remapMarkdownPunctuation(state.src);
});
renderer.core.ruler.push('smart_dashes', state => {
  if (!writingOptions.convertSmartOnRender || !writingOptions.smartDashes) return;
  const transform = tokens => {
    for (const token of tokens || []) {
      if (token.type === 'text') token.content = token.content.replace(/---/g, '—').replace(/--/g, '–').replace(/\.{3}/g, '…');
      else if (token.children) transform(token.children);
    }
  };
  transform(state.tokens);
});
const htmlInlineRule = renderer.renderer.rules.html_inline;
renderer.renderer.rules.html_inline = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (/^<br\s*\/?\s*>$/i.test(token.content) && env.showBrMarkers !== false && writingOptions.visibleBr) {
    return `<span class="md-br-marker" aria-label="显式换行">${renderer.utils.escapeHtml(token.content)}</span><br>`;
  }
  return htmlInlineRule(tokens, index, options, env, self);
};

const validateLink = renderer.validateLink.bind(renderer);
renderer.validateLink = value => /^file:/i.test(value) || /^[a-z]:[\\/]/i.test(value) || validateLink(value);
renderer.block.ruler.before('hr', 'front_matter', (state, startLine, endLine, silent) => {
  if (startLine !== 0 || state.src.slice(state.bMarks[0], state.eMarks[0]).trim() !== '---') return false;
  let end = 1;
  while (end < endLine && !/^(---|\.\.\.)\s*$/.test(state.src.slice(state.bMarks[end], state.eMarks[end]))) end++;
  if (end === endLine) return false;
  if (silent) return true;
  const token = state.push('fence', 'code', 0);
  token.info = 'yaml';
  token.content = state.getLines(1, end, 0, true);
  token.map = [0, end + 1];
  token.meta = { frontMatter: true };
  state.line = end + 1;
  return true;
});

renderer.core.ruler.before('inline', 'alerts', state => {
  for (let index = 0; index < state.tokens.length; index++) {
    const block = state.tokens[index];
    const paragraph = state.tokens[index + 1];
    const inline = state.tokens[index + 2];
    if (block.type !== 'blockquote_open' || paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const match = inline.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i);
    if (!match) continue;
    const kind = match[1].toLowerCase();
    block.attrJoin('class', `md-alert md-alert-${kind}`);
    const title = new block.constructor('html_block', '', 0);
    title.content = `<div class="md-alert-text md-alert-text-${kind}" data-source-line="${inline.map[0]}">${match[1].toUpperCase()}</div>\n`;
    inline.content = inline.content.slice(match[0].length);
    if (inline.map[1] > inline.map[0] + 1) {
      inline.map = [inline.map[0] + 1, inline.map[1]];
      paragraph.map = [...inline.map];
    }
    state.tokens.splice(index + 1, 0, title);
  }
});

renderer.core.ruler.push('source_positions', state => {
  const usedTasks = new Set();
  const headingIds = new Map();
  const sourceLines = state.src.split('\n');
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1) token.attrSet('data-source-line', String(token.map[0]));
    if (token.type === 'heading_open') {
      const inline = state.tokens[state.tokens.indexOf(token) + 1];
      const label = (inline.children || []).filter(child => ['text', 'code_inline'].includes(child.type)).map(child => child.content).join('');
      const slug = label.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'section';
      const count = headingIds.get(slug) || 0;
      headingIds.set(slug, count + 1);
      token.attrSet('id', count ? `${slug}-${count}` : slug);
    }
    if (token.type !== 'inline' || !token.children || !token.map) continue;
    for (const child of token.children) {
      if (child.type !== 'html_inline' || !child.content.includes('task-list-item-checkbox')) continue;
      for (let line = token.map[0]; line < token.map[1]; line++) {
        const match = sourceLines[line]?.match(/^(?:\s*>\s*)*\s*(?:[-+*]|\d+[.)])\s+(\[[ xX]\])/);
        if (match && !usedTasks.has(line)) {
          child.content = child.content.replace('<input ', `<input data-task-line="${line}" `);
          usedTasks.add(line);
          break;
        }
      }
    }
  }
});

const inlineRule = renderer.renderer.rules.inline;
renderer.renderer.rules.inline = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const html = inlineRule ? inlineRule(tokens, index, options, env, self) : self.renderInline(token.children, options, env);
  return token.map ? `<span data-source-line="${token.map[0]}">${html}</span>` : html;
};
const fenceRule = renderer.renderer.rules.fence;
renderer.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.info.trim() === 'mermaid') return `<div class="md-mermaid" data-source-line="${token.map[0]}"><pre>${renderer.utils.escapeHtml(token.content)}</pre></div>`;
  const html = fenceRule(tokens, index, options, env, self).replace(/<code\b/, `<code data-source-line="${token.map[0] + 1}"`);
  return token.meta?.frontMatter ? `<div class="md-front-matter">${html}</div>` : html;
};

export function renderDocument(text, { showBrMarkers = true, showReferenceDefinitions = false } = {}) {
  const env = { showBrMarkers };
  const tokens = renderer.parse(text, env);
  const headings = tokens.flatMap((token, index) => token.type === 'heading_open' ? [{
    line: token.map[0], id: token.attrGet('id'), level: Number(token.tag.slice(1)), text: tokens[index + 1].content
  }] : []);
  for (const token of tokens) {
    if (token.type === 'inline' && /^\[toc\]$/i.test(token.content.trim())) {
      token.children = [];
      const html = new token.constructor('html_inline', '', 0);
      html.content = `<nav class="md-toc">${headings.map(h => `<a href="#${h.id}" data-heading-line="${h.line}" style="padding-left:${(h.level - 1) * 16}px">${renderer.utils.escapeHtml(h.text)}</a>`).join('')}</nav>`;
      token.children.push(html);
    }
  }
  const blocks = [];
  const hiddenRanges = [];
  // Reference and abbreviation definitions have no rendered tokens.
  const sourceLines = text.split('\n');
  const covered = Array(sourceLines.length).fill(false);
  for (const token of tokens) if (token.map) covered.fill(true, token.map[0], token.map[1]);
  for (let line = 0; line < sourceLines.length; line++) {
    if (covered[line] || !sourceLines[line].trim()) continue;
    const definition = showReferenceDefinitions && sourceLines[line].match(/^\s{0,3}\[([^\]^]+)\]:/);
    if (definition) {
      const referenceEnv = {};
      let end = line + 1;
      while (end < sourceLines.length && !covered[end] && sourceLines[end].trim() && !/^\s*\[.+\]:/.test(sourceLines[end])) end++;
      renderer.parse(sourceLines.slice(line, end).join('\n'), referenceEnv);
      const reference = Object.values(referenceEnv.references || {})[0];
      if (reference) {
        const escape = renderer.utils.escapeHtml;
        blocks.push({ fromLine: line, toLine: end, type: 'reference_definition', html: `<div class="md-reference-definition" data-source-line="${line}"><span class="md-def-name">${escape(definition[1])}</span> <span class="md-def-url">${escape(reference.href)}</span>${reference.title ? ` <span class="md-def-title">${escape(reference.title)}</span>` : ''}</div>` });
        line = end - 1;
        continue;
      }
    }
    hiddenRanges.push([line, line + 1]);
  }
  for (let index = 0; index < tokens.length;) {
    const start = index;
    let depth = tokens[index].nesting;
    index++;
    while (depth > 0 && index < tokens.length) depth += tokens[index++].nesting;
    const group = tokens.slice(start, index);
    const maps = group.filter(t => t.map).map(t => t.map);
    if (group.every(token => token.hidden)) { hiddenRanges.push(...maps); continue; }
    if (group[0].type === 'footnote_block_open') hiddenRanges.push(...maps);
    blocks.push({
      fromLine: maps.length && group[0].type !== 'footnote_block_open' ? Math.min(...maps.map(m => m[0])) : null,
      toLine: maps.length && group[0].type !== 'footnote_block_open' ? Math.max(...maps.map(m => m[1])) : null,
      html: renderer.renderer.render(group, renderer.options, env),
      type: group[0].type
    });
  }
  if (showReferenceDefinitions) blocks.sort((a, b) => (a.fromLine ?? Infinity) - (b.fromLine ?? Infinity));
  return { blocks, headings, hiddenRanges, html: renderer.renderer.render(tokens, renderer.options, env) };
}

export function imageUrl(source) {
  if (/^(https?:|data:image\/)/i.test(source)) return source;
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^file:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) return '';
  return `inkslip-image://document/?src=${encodeURIComponent(source)}`;
}
