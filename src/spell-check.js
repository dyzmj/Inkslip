import { ViewPlugin, Decoration } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

export function proseWords(state) {
  const ignored = [];
  syntaxTree(state).iterate({ enter(node) { if (/^(FencedCode|CodeBlock|InlineCode|URL|LinkMark|Image|HTMLBlock|HTMLTag)$/.test(node.name)) { ignored.push([node.from, node.to]); return false; } } });
  const text = state.doc.toString();
  return [...text.matchAll(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g)].filter(match => !ignored.some(([from, to]) => match.index >= from && match.index < to)).map(match => ({ word: match[0], from: match.index, to: match.index + match[0].length }));
}

export const spellCheckExtension = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view; this.decorations = Decoration.none; this.sequence = 0;
    this.enabled = document.body.dataset.spellCheck === 'true';
    this.listener = event => { this.enabled = event.detail.appearance.spellCheck; this.refresh(); };
    document.addEventListener('inkslip-preferences-changed', this.listener);
    queueMicrotask(() => { if (!this.destroyed) this.refresh(); });
  }
  update(update) { if (update.docChanged || update.viewportChanged || update.selectionSet) this.refresh(); }
  refresh() {
    const sequence = ++this.sequence; clearTimeout(this.timer);
    this.decorations = Decoration.none;
    for (const marker of this.view.dom.querySelectorAll('.md-rendered .md-spelling-error')) marker.replaceWith(document.createTextNode(marker.textContent));
    if (!this.enabled || !window.desktop?.checkSpelling) { queueMicrotask(() => { if (sequence === this.sequence) this.view.dispatch({}); }); return; }
    this.timer = setTimeout(async () => {
      const doc = this.view.state.doc, words = proseWords(this.view.state);
      try {
        const misspelled = new Set(await window.desktop.checkSpelling(words.map(entry => entry.word)));
        if (sequence !== this.sequence || doc !== this.view.state.doc) return;
        this.decorations = Decoration.set(words.filter(entry => misspelled.has(entry.word)).map(entry => Decoration.mark({ class: 'md-spelling-error', attributes: { 'data-spelling-word': entry.word, 'data-spelling-from': String(entry.from), 'data-spelling-to': String(entry.to) } }).range(entry.from, entry.to)));
        this.view.requestMeasure(); this.view.dispatch({});
        for (const block of this.view.dom.querySelectorAll('.md-rendered[data-source-from]')) {
          const available = words.filter(entry => misspelled.has(entry.word) && entry.from >= Number(block.dataset.sourceFrom) && entry.to <= Number(block.dataset.sourceTo));
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), nodes = [];
          while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code,pre,.katex,.md-mermaid,.md-spelling-error')) nodes.push(walker.currentNode);
          for (const node of nodes) {
            const matches = [...node.textContent.matchAll(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g)].filter(match => available.some(entry => entry.word === match[0]));
            if (!matches.length) continue;
            const fragment = document.createDocumentFragment(); let from = 0;
            for (const match of matches) {
              const index = available.findIndex(entry => entry.word === match[0]); if (index < 0) continue;
              const entry = available.splice(index, 1)[0];
              fragment.append(document.createTextNode(node.textContent.slice(from, match.index)));
              const marker = document.createElement('span'); marker.className = 'md-spelling-error'; marker.textContent = match[0]; marker.dataset.spellingWord = entry.word; marker.dataset.spellingFrom = entry.from; marker.dataset.spellingTo = entry.to;
              fragment.append(marker); from = match.index + match[0].length;
            }
            fragment.append(document.createTextNode(node.textContent.slice(from))); node.replaceWith(fragment);
          }
        }
      } catch (error) { const toast = document.getElementById('toast'); toast.textContent = `拼写检查失败：${error.message}`; toast.hidden = false; }
    }, 250);
  }
  destroy() { this.destroyed = true; clearTimeout(this.timer); this.sequence++; document.removeEventListener('inkslip-preferences-changed', this.listener); }
}, { decorations: plugin => plugin.decorations });
