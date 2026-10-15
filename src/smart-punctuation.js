import { EditorState, EditorSelection, Transaction } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

export const writingDefaults = {
  convertSmartOnRender: false, smartQuotes: false, smartDashes: false,
  remapUnicodePunctuation: false, indentFirstLine: false, visibleBr: true, preserveLineBreaks: true
};

export function remapOnParse(options) {
  return options.remapUnicodePunctuation || !options.convertSmartOnRender && (options.smartQuotes || options.smartDashes);
}

// Remap punctuation used as Markdown syntax, retaining prose and code verbatim.
export function remapMarkdownPunctuation(source) {
  let fence;
  return source.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; return line; }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    line = line.replace(/^(\s{0,3})[〉》](?=\s|$)/, '$1>')
      .replace(/^(\s{0,3})(?:—|–|[—–-]{2,})\s*$/, '$1---')
      .replace(/^(\s{0,3})[–—](?=\s)/, '$1-')
      .replace(/^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)【([ xX])】(?=\s|$)/, '$1[$2]');
    // Inline code spans may contain arbitrary punctuation, including HTML.
    return line.split(/(`+[^`]*`+)/g).map((part, index) => index % 2 ? part : part
      .replace(/(\]\([^\n]*?\s)[“„«〝]([^”»〟\n]*)[”»〟](?=\s*\))/g, '$1"$2"')
      .replace(/<[^>\n]+>/g, tag => tag.replace(/(=\s*)[“„«〝]([^”»〟]*)[”»〟]/g, '$1"$2"').replace(/(=\s*)[‘‚‹]([^’›]*)[’›]/g, "$1'$2'"))).join('');
  }).join('\n');
}

export function smartInputChange(state, from, to, text, options) {
  if (options.convertSmartOnRender || !options.smartQuotes && !options.smartDashes || text.length !== 1 || from !== to) return null;
  let node = syntaxTree(state).resolveInner(from, -1);
  while (node) {
    if (/^(?:FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Link|Image|Autolink)$/.test(node.name)) return null;
    node = node.parent;
  }
  const line = state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  if (/\\$/.test(before) || /(^|[^\\])(?:`+[^`]*|\$[^$]*)$/.test(before)) return null;
  if (options.smartDashes && text === '-') {
    if (/–$/.test(before) || /--$/.test(before)) return { from: from - (/–$/.test(before) ? 1 : 2), to, insert: '—' };
    if (/-$/.test(before)) return { from: from - 1, to, insert: '–' };
  }
  if (options.smartDashes && text === '.' && /\.\.$/.test(before)) return { from: from - 2, to, insert: '…' };
  if (options.smartQuotes && /["']/.test(text)) {
    const opening = !before || /[\s([{—–-]$/.test(before);
    return { from, to, insert: text === '"' ? opening ? '“' : '”' : opening ? '‘' : '’' };
  }
  return null;
}

export function smartPunctuationExtension(getOptions, enabled = () => true) {
  return EditorState.transactionFilter.of(transaction => {
    if (!transaction.isUserEvent('input.type') || transaction.isUserEvent('input.type.compose') || !enabled()) return transaction;
    const changes = [];
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, insert) => changes.push({ from, to, text: insert.toString() }));
    if (changes.length !== 1) return transaction;
    const { from, to, text } = changes[0];
    const change = smartInputChange(transaction.startState, from, to, text, getOptions());
    if (!change) return transaction;
    return { changes: change, selection: EditorSelection.cursor(change.from + change.insert.length), annotations: transaction.annotation(Transaction.userEvent) ? Transaction.userEvent.of(transaction.annotation(Transaction.userEvent)) : [] };
  });
}
