import { EditorSelection, Transaction, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { openSearchPanel, findNext, findPrevious } from '@codemirror/search';
import { syntaxTree } from '@codemirror/language';
import { renderDocument, renderer } from './markdown-renderer.js';
import { codeIndentationChanges } from './code-indentation.js';
import { getImageRoot, imageSourceForRoot } from '../shared/image-paths.js';

function lineRange(state, from, to) {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
  return { from: first.from, to: last.to, first: first.number, last: last.number };
}

// Split actual Markdown cells, retaining whitespace and ignoring escaped / inline-code pipes.
export function splitTableRow(line) {
  const boundaries = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '`') {
      let end = i + 1;
      while (line[end] === '`') end++;
      const marker = line.slice(i, end);
      let close = line.indexOf(marker, end);
      while (close >= 0 && (line[close - 1] === '`' || line[close + marker.length] === '`')) close = line.indexOf(marker, close + marker.length);
      if (close >= 0) { i = close + marker.length - 1; continue; }
      i = end - 1;
    } else if (line[i] === '|') boundaries.push(i);
  }
  const leading = boundaries.length > 0 && !line.slice(0, boundaries[0]).trim();
  const trailing = boundaries.length > 0 && !line.slice(boundaries.at(-1) + 1).trim();
  const parts = [];
  let start = 0;
  for (const boundary of boundaries) { parts.push(line.slice(start, boundary)); start = boundary + 1; }
  parts.push(line.slice(start));
  if (leading) parts.shift();
  if (trailing) parts.pop();
  return { cells: parts, leading, trailing };
}

export function parseTable(source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const suffix = lines.at(-1) === '' ? (lines.pop(), eol) : '';
  const prefix = lines[0]?.match(/^\s*(?:>\s*)*/)?.[0] || '';
  const rows = lines.map(line => splitTableRow(prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line));
  const columns = rows[0]?.cells.length || 0;
  if (rows.length < 2 || !columns || rows[1].cells.length !== columns || !rows[1].cells.every(cell => /^:?-+:?$/.test(cell.trim()))) return null;
  // GFM permits short body rows; materialize their missing cells only when the table is edited.
  for (const row of rows) {
    while (row.cells.length < columns) row.cells.push(' ');
    row.cells = row.cells.slice(0, columns);
  }
  return { rows, columns, prefix, eol, suffix };
}

function tableText(table) {
  return table.rows.map(row => table.prefix + (row.leading ? '|' : '') + row.cells.join('|') + (row.trailing ? '|' : '')).join(table.eol) + table.suffix;
}

// row is the rendered row index: 0 is the header, 1 is the first body row.
export function transformTable(source, command, { row = 0, column = 0 } = {}) {
  const table = parseTable(source);
  if (!table) return null;
  const { rows, columns } = table;
  const index = row === 0 ? 0 : row + 1;
  if (column < 0 || column >= columns || index >= rows.length) return null;
  const blank = () => ({ ...rows[0], cells: Array(columns).fill(' ') });
  if (command === 'insert-row-above' || command === 'insert-row-below') {
    rows.splice(Math.max(2, index + (command === 'insert-row-below' ? 1 : 0)), 0, blank());
  } else if (command === 'delete-row') {
    if (!row) return null;
    rows.splice(index, 1);
  } else if (command === 'move-row-up' || command === 'move-row-down') {
    const target = index + (command === 'move-row-up' ? -1 : 1);
    if (!row || target < 2 || target >= rows.length) return null;
    [rows[index], rows[target]] = [rows[target], rows[index]];
  } else if (command === 'insert-column-left' || command === 'insert-column-right') {
    const target = column + (command === 'insert-column-right' ? 1 : 0);
    rows.forEach((r, i) => r.cells.splice(target, 0, i === 1 ? ' --- ' : ' '));
  } else if (command === 'delete-column') {
    if (columns < 2) return null;
    rows.forEach(r => r.cells.splice(column, 1));
  } else if (command === 'move-column-left' || command === 'move-column-right') {
    const target = column + (command === 'move-column-left' ? -1 : 1);
    if (target < 0 || target >= columns) return null;
    rows.forEach(r => { [r.cells[column], r.cells[target]] = [r.cells[target], r.cells[column]]; });
  } else if (command.startsWith('align-')) {
    const marker = command === 'align-left' ? ':---' : command === 'align-center' ? ':---:' : command === 'align-right' ? '---:' : null;
    if (!marker) return null;
    rows[1].cells[column] = ` ${marker} `;
  } else if (command === 'format-table') {
    const widths = Array.from({ length: columns }, (_, c) => Math.max(3, ...rows.filter((_, i) => i !== 1).map(r => r.cells[c].trim().length)));
    rows.forEach((r, index) => {
      r.leading = r.trailing = true;
      r.cells = r.cells.map((cell, c) => {
        if (index !== 1) return ` ${cell.trim().padEnd(widths[c])} `;
        const value = cell.trim();
        const left = value.startsWith(':') ? ':' : '';
        const right = value.endsWith(':') ? ':' : '';
        return ` ${left}${'-'.repeat(Math.max(3, widths[c] - left.length - right.length))}${right} `;
      });
    });
  } else return null;
  return tableText(table);
}

function blockAt(state, lineNumber) {
  // A table/fence nested in a list or quote still has its own source map.
  const nested = renderer.parse(state.doc.toString(), {}).find(token => ['table_open', 'fence', 'code_block'].includes(token.type) && token.map && lineNumber >= token.map[0] && lineNumber < token.map[1]);
  if (nested) return { fromLine: nested.map[0], toLine: nested.map[1], type: nested.type };
  return renderDocument(state.doc.toString()).blocks.find(block => block.fromLine !== null && lineNumber >= block.fromLine && lineNumber < block.toLine);
}

function blockRange(state, block) {
  return block ? { from: state.doc.line(block.fromLine + 1).from, to: state.doc.line(Math.min(block.toLine, state.doc.lines)).to } : lineRange(state, state.selection.main.from, state.selection.main.to);
}

function inlineLinks(source) {
  const result = [];
  // The rendered href lets us distinguish multiple links/images in the same paragraph.
  const pattern = /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>]*>|(?:\\.|[^\s()\\]|\([^()]*\))*)\s*(?:["']([^"']*)["'])?\s*\)/g;
  for (const match of source.matchAll(pattern)) result.push({
    image: match[1] === '!', label: match[2], href: match[3].replace(/^<|>$/g, '').replace(/\\([()\\])/g, '$1'), title: match[4] || '',
    from: match.index, to: match.index + match[0].length
  });
  return result;
}

export function getEditorContext(view, event) {
  const state = view.state;
  const element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
  const target = element?.closest?.('img, a, td, th, pre, blockquote');
  let position = state.selection.main.head;
  const sourceNode = element?.closest?.('[data-source-line]') || target?.closest?.('[data-source-line]');
  if (sourceNode && Number.isInteger(Number(sourceNode.dataset.sourceLine))) position = state.doc.line(Math.min(state.doc.lines, Number(sourceNode.dataset.sourceLine) + 1)).from;
  else if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) position = view.posAtCoords?.({ x: event.clientX, y: event.clientY }) ?? position;
  const line = state.doc.lineAt(position);
  const block = blockAt(state, line.number - 1);
  const range = blockRange(state, block);
  const context = { kind: 'text', ...range, line: line.number - 1 };
  if (target?.matches('td, th')) {
    context.kind = 'table';
    context.column = target.cellIndex;
    context.row = [...target.closest('table').rows].indexOf(target.closest('tr'));
  } else if (target?.matches('img, a')) {
    context.kind = target.matches('img') ? 'image' : 'link';
    const href = target.dataset.imageSource || target.getAttribute('href') || target.getAttribute('src');
    const source = state.doc.sliceString(range.from, range.to);
    const matches = inlineLinks(source).filter(link => link.image === (context.kind === 'image'));
    const match = matches.find(link => link.href === href) || matches.find(link => link.label === (target.getAttribute('alt') || target.textContent));
    if (match) Object.assign(context, { label: match.label, href: match.href, title: match.title, inlineFrom: range.from + match.from, inlineTo: range.from + match.to });
    else {
      // Reference links are identified from the clicked label without rewriting the definition.
      const label = target.getAttribute('alt') || target.textContent || '';
      const start = source.indexOf(`${context.kind === 'image' ? '!' : ''}[${label}]`);
      if (start >= 0) {
        const tail = source.slice(start).match(/^!?\[[^\]]*\](?:\[[^\]]*\])?/);
        context.inlineFrom = range.from + start;
        context.inlineTo = context.inlineFrom + tail[0].length;
      }
      context.label = label;
      context.href = href;
    }
    if (context.kind === 'image') context.imageSource = context.href;
  } else if (target?.matches('pre')) {
    context.kind = 'code';
    context.code = target.textContent || '';
  } else if (target?.matches('blockquote')) context.isQuote = true;
  else if (block?.type === 'table_open') {
    context.kind = 'table'; context.column = 0;
    context.row = Math.max(0, line.number - block.fromLine - 2);
    const table = parseTable(state.doc.sliceString(range.from, range.to));
    if (table) {
      const raw = line.text.slice(table.prefix.length);
      const parts = splitTableRow(raw);
      let cellStart = parts.leading ? raw.indexOf('|') + 1 : 0;
      const offset = position - line.from - table.prefix.length;
      for (let column = 0; column < parts.cells.length; column++) {
        context.column = Math.min(column, table.columns - 1);
        if (offset <= cellStart + parts.cells[column].length) break;
        cellStart += parts.cells[column].length + 1;
      }
    }
  } else if (block?.type === 'fence' || block?.type === 'code_block') context.kind = 'code';
  // Context describes the clicked block; never erase a user's existing nonempty selection here.
  return context;
}

export function createEditorCommands(view, { notify = () => {}, desktop = {}, getDocumentId = () => null } = {}) {
  function replace(from, to, insert, anchor = from + insert.length, head = anchor) {
    // Text.of uses CM's internal line model, so LF-generated snippets do not become
    // literal newlines inside a CRLF document's lines.
    view.dispatch({ changes: { from, to, insert: Text.of(insert.split(/\r\n|\n|\r/)) }, selection: EditorSelection.single(anchor, head), annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] });
    view.focus();
    return true;
  }
  function wrap(before, after = before, fallback = '') {
    const { from, to } = view.state.selection.main;
    const text = view.state.doc.sliceString(from, to);
    if (from >= before.length && view.state.doc.sliceString(from - before.length, from) === before && view.state.doc.sliceString(to, to + after.length) === after) {
      return replace(from - before.length, to + after.length, text, from - before.length, from - before.length + text.length);
    }
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
      const insert = text.slice(before.length, text.length - after.length);
      return replace(from, to, insert, from, from + insert.length);
    }
    const inner = text || fallback;
    return replace(from, to, before + inner + after, from + before.length, from + before.length + inner.length);
  }
  function lines(transform) {
    const state = view.state;
    const { from, to, first, last } = lineRange(state, state.selection.main.from, state.selection.main.to);
    const insert = Array.from({ length: last - first + 1 }, (_, i) => transform(state.doc.line(first + i).text, i)).join('\n');
    return replace(from, to, insert, from, from + insert.length);
  }
  function toggleLines(pattern, prefix, list = false) {
    const state = view.state;
    const { first, last } = lineRange(state, state.selection.main.from, state.selection.main.to);
    const remove = Array.from({ length: last - first + 1 }, (_, i) => state.doc.line(first + i).text).every(text => pattern.test(text));
    return lines((text, i) => {
      if (remove) return text.replace(pattern, '$1');
      const content = list ? text.replace(/^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '$1') : text;
      return content.replace(/^(\s*)/, (_, space) => space + (typeof prefix === 'function' ? prefix(i) : prefix));
    });
  }
  function block(before, after = '') {
    const { from, to } = view.state.selection.main;
    const selection = view.state.doc.sliceString(from, to);
    const prefix = from > 0 && view.state.doc.sliceString(from - 1, from) !== '\n' ? '\n\n' : '';
    const suffix = to < view.state.doc.length && view.state.doc.sliceString(to, to + 1) !== '\n' ? '\n\n' : '';
    return replace(from, to, prefix + before + selection + after + suffix, from + prefix.length + before.length, from + prefix.length + before.length + selection.length);
  }
  async function clipboard(text) {
    if (desktop.writeClipboard) await desktop.writeClipboard(text);
    else if (globalThis.navigator?.clipboard) await navigator.clipboard.writeText(text);
    else { notify('当前环境无法访问剪贴板'); return false; }
    return true;
  }
  function selectedOrContext(context) {
    const selection = view.state.selection.main;
    return !selection.empty ? selection : Number.isInteger(context.from) ? context : selection;
  }
  function currentInline(context, image) {
    if (context.kind === (image ? 'image' : 'link') && Number.isInteger(context.from)) return { ...context, from: context.inlineFrom ?? context.from, to: context.inlineTo ?? context.to };
    const state = view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    const match = inlineLinks(line.text).find(link => link.image === image && line.from + link.from <= state.selection.main.head && line.from + link.to >= state.selection.main.head);
    return match && { ...match, from: line.from + match.from, to: line.from + match.to };
  }
  function destination(url) { return /\s|[()]/.test(url) ? `<${url.replace(/[<>]/g, '')}>` : url; }

  return async function run(id, context = {}) {
    const state = view.state;
    const selection = state.selection.main;
    const values = context.values || {};
    if (id === 'undo') return undo(view);
    if (id === 'redo') return redo(view);
    if (id === 'delete-selection') return selection.empty ? false : replace(selection.from, selection.to, '');
    if (id === 'select-format') {
      let node = syntaxTree(state).resolveInner(selection.head, -1);
      while (node && !/^(?:Emphasis|StrongEmphasis|Strikethrough|InlineCode|Link|Image)$/.test(node.name)) node = node.parent;
      if (!node) return run('select-word');
      view.dispatch({ selection: { anchor: node.from, head: node.to } }); view.focus(); return true;
    }
    if (['delete-word', 'delete-line', 'delete-format'].includes(id)) {
      const action = id === 'delete-word' ? 'select-word' : id === 'delete-line' ? 'select-line' : 'select-format';
      await run(action, context);
      return run('delete-selection');
    }
    if (id === 'jump-line-start' || id === 'jump-line-end' || id === 'jump-selection') {
      const line = state.doc.lineAt(selection.head);
      const anchor = id === 'jump-line-start' ? line.from : id === 'jump-line-end' ? line.to : selection.head;
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) }); view.focus(); return true;
    }
    if (id === 'find' || id === 'replace') {
      const opened = openSearchPanel(view);
      globalThis.document?.querySelector('.cm-search')?.dispatchEvent(new CustomEvent('inkslip-search-mode', { detail: id }));
      return opened;
    }
    if (id === 'find-next') return findNext(view);
    if (id === 'find-previous') return findPrevious(view);
    if (id === 'select-all') {
      view.dispatch({ selection: { anchor: 0, head: state.doc.length } }); view.focus(); return true;
    }
    if (id === 'select-word') {
      const line = state.doc.lineAt(selection.head);
      const offset = selection.head - line.from;
      const before = line.text.slice(0, offset).match(/[\p{L}\p{N}_]+$/u)?.[0].length || 0;
      const after = line.text.slice(offset).match(/^[\p{L}\p{N}_]+/u)?.[0].length || 0;
      const from = selection.head - before;
      const to = selection.head + (after || (!before && selection.head < line.to ? 1 : 0));
      view.dispatch({ selection: { anchor: from, head: to } }); view.focus(); return true;
    }
    if (id === 'select-line') {
      const range = lineRange(state, selection.from, selection.to);
      view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus(); return true;
    }
    if (id === 'select-block' || id === 'delete-block') {
      const range = Number.isInteger(context.from) ? context : blockRange(state, blockAt(state, state.doc.lineAt(selection.head).number - 1));
      if (id === 'delete-block') return replace(range.from, range.to, '');
      view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus(); return true;
    }
    if (id === 'jump-top' || id === 'jump-bottom') {
      const anchor = id === 'jump-top' ? 0 : state.doc.length;
      view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start' }) }); view.focus(); return true;
    }
    if (id === 'insert-paragraph-before' || id === 'insert-paragraph-after') {
      const range = Number.isInteger(context.from) ? context : blockRange(state, blockAt(state, state.doc.lineAt(selection.head).number - 1));
      const position = id.endsWith('before') ? range.from : range.to;
      return replace(position, position, '\n\n', position + (id.endsWith('after') ? 2 : 0));
    }
    if (['copy', 'cut', 'copy-markdown', 'copy-html', 'copy-plain', 'copy-simplified'].includes(id)) {
      const range = selectedOrContext(context);
      if (range.from === range.to) return false;
      const text = state.doc.sliceString(range.from, range.to, state.lineBreak);
      let copied = id === 'copy-html' ? renderDocument(text, { showBrMarkers: false }).html : text;
      if (id === 'copy-plain' || id === 'copy-simplified') {
        const plain = children => children.map(token => token.children ? plain(token.children) : token.type === 'image' ? '' : token.type === 'softbreak' || token.type === 'hardbreak' ? '\n' : token.type === 'html_inline' ? '' : token.content || '').join('');
        copied = renderer.parse(text, {}).filter(token => token.type === 'inline' || ['fence', 'code_block', 'html_block'].includes(token.type)).map(token => token.children ? plain(token.children) : token.content).join('\n');
      }
      if (!await clipboard(copied)) return false;
      return id === 'cut' ? replace(range.from, range.to, '') : true;
    }
    if (id === 'paste' || id === 'paste-plain') {
      const text = desktop.readClipboard ? await desktop.readClipboard() : await globalThis.navigator?.clipboard?.readText();
      return typeof text === 'string' ? replace(selection.from, selection.to, text.replace(/\r\n/g, '\n')) : false;
    }
    const inline = { bold: '**', italic: '*', strike: '~~', highlight: '==', 'inline-code': '`', 'inline-math': '$', sup: '^', sub: '~' };
    if (inline[id]) return wrap(inline[id]);
    if (id === 'underline') return wrap('<u>', '</u>');
    if (id === 'comment') return wrap('<!-- ', ' -->');
    if (/^heading-[1-6]$/.test(id)) return lines(text => text.replace(/^(\s*)(?:#{1,6}\s+)?/, `$1${'#'.repeat(Number(id.at(-1)))} `));
    if (id === 'paragraph') return lines(text => text.replace(/^(\s*)#{1,6}\s+/, '$1'));
    if (id === 'increase-heading' || id === 'decrease-heading') return lines(text => {
      const match = text.match(/^(\s*)(#{1,6})\s+(.*)$/);
      const level = match ? match[2].length : 0;
      const next = Math.max(0, Math.min(6, level + (id === 'increase-heading' ? 1 : -1)));
      return `${match?.[1] || ''}${next ? '#'.repeat(next) + ' ' : ''}${match ? match[3] : text.trimStart()}`;
    });
    if (id === 'quote') return toggleLines(/^(\s*)>\s?/, '> ');
    if (id === 'bullet-list') return toggleLines(/^(\s*)[-+*]\s+(?!\[[ xX]\])/, '- ', true);
    if (id === 'ordered-list') return toggleLines(/^(\s*)\d+[.)]\s+/, i => `${i + 1}. `, true);
    if (id === 'task-list') return toggleLines(/^(\s*)[-+*]\s+\[[ xX]\]\s*/, '- [ ] ', true);
    if (id === 'task-toggle') return lines(text => /^\s*[-+*]\s+\[[ xX]\]/.test(text) ? text.replace(/^(\s*[-+*]\s+)\[([ xX])\]/, (_, prefix, check) => `${prefix}[${check === ' ' ? 'x' : ' '}]`) : text.replace(/^(\s*)(?:[-+*]\s+)?/, '$1- [ ] '));
    if (id === 'task-complete' || id === 'task-incomplete') return lines(text => text.replace(/^(\s*[-+*]\s+)\[[ xX]\]/, `$1[${id === 'task-complete' ? 'x' : ' '}]`));
    if (id === 'indent') return lines(text => '    ' + text);
    if (id === 'outdent') return lines(text => text.replace(/^(?: {1,4}|\t)/, ''));
    if (id === 'code-format-selection' || id === 'code-format-block') {
      const reference = Number.isInteger(context.from) ? context.from : selection.head;
      const number = state.doc.lineAt(reference).number - 1;
      const token = renderer.parse(state.doc.toString(), {}).find(token => token.type === 'fence' && token.map && number >= token.map[0] && number < token.map[1]);
      if (!token) { notify('请将光标或选区放在代码块内'); return false; }
      const contentLines = token.content.replace(/\n$/, '').split('\n');
      const records = contentLines.map((content, index) => {
        const line = state.doc.line(token.map[0] + index + 2);
        return { line, content, prefix: line.text.endsWith(content) ? line.text.slice(0, line.text.length - content.length) : null };
      });
      if (records.some(record => record.prefix === null)) { notify('无法确定此嵌套代码块的缩进范围'); return false; }
      const chosen = id === 'code-format-selection' && !selection.empty ? lineRange(state, selection.from, selection.to) : null;
      const changed = await codeIndentationChanges(contentLines.join('\n'), token.info.trim().split(/\s+/)[0], {
        fromLine: chosen ? Math.max(1, chosen.first - token.map[0] - 1) : id === 'code-format-selection' ? Math.max(1, state.doc.lineAt(selection.head).number - token.map[0] - 1) : 1,
        toLine: chosen ? Math.min(records.length, chosen.last - token.map[0] - 1) : id === 'code-format-selection' ? state.doc.lineAt(selection.head).number - token.map[0] - 1 : Infinity
      });
      if (!changed) { notify('请先为代码块选择可识别的语言，再调整缩进'); return false; }
      if (view.state.doc !== state.doc) { notify('文档已修改，请再次调整代码缩进'); return false; }
      const changes = changed.map(change => {
        const record = records[change.line - 1];
        const from = record.line.from + record.prefix.length;
        return { from, to: from + (change.to - change.from), insert: change.insert };
      });
      if (changes.length) view.dispatch({ changes, annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] });
      view.focus(); return true;
    }
    if (id === 'code-block') return block(`\`\`\`${String(values.language || '').replace(/[\r\n]/g, '')}\n`, '\n```');
    if (id === 'math-block') return block('$$\n', '\n$$');
    if (id === 'horizontal-rule') return block('---\n');
    if (id === 'toc') return block('[TOC]\n');
    if (/^alert-(note|tip|important|warning|caution)$/.test(id)) {
      const source = state.doc.sliceString(selection.from, selection.to);
      const text = `> [!${id.slice(6).toUpperCase()}]\n` + (source || '提示内容').split('\n').map(line => `> ${line}`).join('\n');
      return replace(selection.from, selection.to, text);
    }
    if (id === 'footnote' || id === 'reference-link') {
      const source = state.doc.toString();
      if (id === 'reference-link' && !values.url) return { prompt: 'link', values: {} };
      const stem = id === 'footnote' ? 'note' : 'link';
      let number = 1;
      while (source.includes(`[${id === 'footnote' ? '^' : ''}${stem}-${number}]`)) number++;
      const reference = `${id === 'footnote' ? '^' : ''}${stem}-${number}`;
      const chosen = state.doc.sliceString(selection.from, selection.to);
      const marker = id === 'footnote' ? `[${reference}]` : `[${values.text || chosen || '链接'}][${reference}]`;
      const definition = id === 'footnote' ? chosen || values.text || '脚注内容' : destination(values.url);
      const append = `\n\n[${reference}]: ${definition.replace(/\n/g, '\n    ')}\n`;
      view.dispatch({ changes: [{ from: selection.from, to: selection.to, insert: marker }, { from: state.doc.length, insert: Text.of(append.split('\n')) }], selection: { anchor: selection.from + marker.length }, annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] });
      view.focus(); return true;
    }
    if (id === 'front-matter') {
      if (/^---\n/.test(state.doc.toString())) { notify('文档已包含 YAML 头信息'); return false; }
      return replace(0, 0, '---\ntitle: \n---\n\n', 11);
    }
    if (id === 'table') {
      const columns = Math.max(1, Math.min(30, Math.floor(Number(values.columns)) || 3));
      const rows = Math.max(1, Math.min(100, Math.floor(Number(values.rows)) || 3));
      const row = cells => `| ${cells.join(' | ')} |`;
      const text = [row(Array.from({ length: columns }, (_, i) => `列 ${i + 1}`)), row(Array(columns).fill('---')), ...Array.from({ length: rows }, () => row(Array(columns).fill(' ')))].join('\n');
      return block(text + '\n');
    }
    if (['link', 'image', 'edit-link', 'edit-image'].includes(id)) {
      const image = id.includes('image');
      const existing = id.startsWith('edit-') ? currentInline(context, image) : null;
      let url = image ? values.source || values.url : values.url;
      if (!url && image && !id.startsWith('edit-') && desktop.pickImage) {
        const result = await desktop.pickImage();
        if (result?.status === 'cancelled') return false;
        if (result?.status === 'error') { notify(result.message || '选择图片失败'); return false; }
        url = typeof result === 'string' ? result : result?.path;
        if (url) url = imageSourceForRoot(url, getDocumentId(), getImageRoot(view.state));
      }
      if (!url) return { prompt: image ? 'image' : 'link', values: existing || {} };
      if (image) url = url.replace(/\\/g, '/');
      const range = existing || selection;
      const label = (image ? values.alt : values.text) ?? existing?.label ?? state.doc.sliceString(range.from, range.to) ?? '';
      const safeLabel = (label || (image ? '图片' : '链接')).replace(/[\[\]]/g, '\\$&');
      const title = values.title ? ` "${values.title.replace(/"/g, '&quot;')}"` : '';
      return replace(range.from, range.to, `${image ? '!' : ''}[${safeLabel}](${destination(url)}${title})`);
    }
    if (['copy-image-address', 'copy-link-address', 'open-link', 'remove-link', 'delete-image'].includes(id)) {
      const image = id.includes('image');
      const link = currentInline(context, image);
      if (!link) return false;
      if (id.startsWith('copy-')) return clipboard(link.href || link.imageSource || '');
      if (id === 'open-link') { await desktop.openLink?.(link.href); return true; }
      return replace(link.from, link.to, image ? '' : link.label || '');
    }
    if (id === 'copy-code') {
      const range = Number.isInteger(context.from) ? context : blockRange(state, blockAt(state, state.doc.lineAt(selection.head).number - 1));
      const source = state.doc.sliceString(range.from, range.to);
      const code = context.code ?? source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n/, '').replace(/\n\s*(`{3,}|~{3,})\s*$/, '');
      return clipboard(code.replace(/\n/g, state.lineBreak));
    }
    if (id === 'copy-table' || id === 'delete-table' || /^(insert-(row|column)-|delete-(row|column)$|align-|move-(row|column)-|format-table$)/.test(id)) {
      const range = Number.isInteger(context.from) ? context : blockRange(state, blockAt(state, state.doc.lineAt(selection.head).number - 1));
      const source = state.doc.sliceString(range.from, range.to);
      if (id === 'copy-table') return clipboard(source.replace(/\n/g, state.lineBreak));
      if (id === 'delete-table') return replace(range.from, range.to, '');
      const transformed = transformTable(source, id, context);
      return transformed !== null ? replace(range.from, range.to, transformed) : false;
    }
    if (id === 'clear-format') {
      const { from, to } = selectedOrContext(context);
      const source = state.doc.sliceString(from, to);
      const clean = source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\s*\1\s*$/gm, '$2')
        .replace(/^(\s*)(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)/gm, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|==|\*|_|`)(.+?)\1/g, '$2').replace(/<\/?u>/gi, '');
      return replace(from, to, clean, from, from + clean.length);
    }
    return false;
  };
}
