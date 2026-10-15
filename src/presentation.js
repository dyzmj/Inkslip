import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import DOMPurify from 'dompurify';
import { renderDocument, imageUrl, renderingVersion } from './markdown-renderer.js';
import { getImageRoot, resolveImageSource } from './image-policy.js';
import { beginPreviewSelection } from './preview-selection.js';

export const setPreview = StateEffect.define();
export const setDocumentPath = StateEffect.define();
export const setRenderingOptions = StateEffect.define();
const documents = new WeakMap();
let mermaidPromise;

function parsedDocument(state) {
  if (documents.get(state.doc)?.version !== renderingVersion) documents.set(state.doc, { version: renderingVersion, document: renderDocument(state.doc.toString(), { showReferenceDefinitions: true }) });
  return documents.get(state.doc).document;
}

class MarkdownWidget extends WidgetType {
  constructor(block, from, documentPath, to, imageRoot) { super(); this.block = block; this.from = from; this.documentPath = documentPath; this.to = to; this.imageRoot = imageRoot; }
  eq(other) { return this.block.html === other.block.html && this.from === other.from && this.to === other.to && this.documentPath === other.documentPath && this.imageRoot === other.imageRoot; }
  toDOM(view) {
    const wrapper = document.createElement('div');
    wrapper.className = 'md-rendered';
    wrapper.dataset.sourceFrom = String(this.from);
    wrapper.dataset.sourceTo = String(this.to);
    if (this.block.type === 'table_open') wrapper.classList.add('md-table-preview');
    const template = document.createElement('template');
    template.innerHTML = this.block.html;
    template.content.querySelectorAll('img').forEach(img => {
      img.dataset.imageSource = img.getAttribute('src') || '';
      img.removeAttribute('src');
    });
    wrapper.innerHTML = DOMPurify.sanitize(template.innerHTML, { ADD_ATTR: ['data-source-line', 'data-task-line', 'data-heading-line', 'data-image-source'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'] });
    wrapper.querySelectorAll('strong').forEach(element => element.classList.add('md-strong'));
    wrapper.querySelectorAll('img').forEach(img => {
      const source = img.dataset.imageSource || '';
      const url = imageUrl(resolveImageSource(source, this.documentPath, this.imageRoot));
      img.src = url + (url.startsWith('inkslip-image:') ? `&document=${encodeURIComponent(this.documentPath || '')}` : '');
      img.loading = 'lazy';
      img.addEventListener('load', () => view.requestMeasure());
      img.addEventListener('error', () => {
        const message = document.createElement('span');
        message.className = 'md-image-error';
        message.dataset.imageSource = source;
        message.textContent = `图片加载失败：${source}${!this.documentPath && !/^https?:|^data:/i.test(source) ? '（请先保存文档）' : ''}`;
        img.replaceWith(message);
        view.requestMeasure();
      });
    });
    wrapper.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.classList.add('md-task-checkbox');
      input.disabled = !input.hasAttribute('data-task-line');
    });
    wrapper.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.target.closest('summary, input, img, a[href^="#"]') || (event.ctrlKey || event.metaKey) && event.target.closest('a')) return;
      beginPreviewSelection(view, event);
    });
    wrapper.addEventListener('click', event => {
      if (event.target.closest('summary')) return;
      const task = event.target.closest('input[data-task-line]');
      if (task) {
        const line = view.state.doc.line(Number(task.dataset.taskLine) + 1);
        const match = line.text.match(/^(?:\s*>\s*)*\s*(?:[-+*]|\d+[.)])\s+(\[[ xX]\])/);
        if (match) {
          const from = line.from + match[0].length - 3;
          view.dispatch({ changes: { from, to: from + 3, insert: match[1].toLowerCase() === '[x]' ? '[ ]' : '[x]' } });
        }
        return;
      }
      const link = event.target.closest('a');
      if (link) {
        event.preventDefault();
        const href = link.getAttribute('href') || '';
        if (href.startsWith('#')) {
          let id;
          try { id = decodeURIComponent(href.slice(1)); } catch { id = href.slice(1); }
          const heading = parsedDocument(view.state).headings.find(heading => heading.id === id);
          if (heading) {
            const anchor = view.state.doc.line(heading.line + 1).from;
            view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start' }) });
            view.focus();
            return;
          }
          const target = view.dom.querySelector(`[id="${CSS.escape(id)}"]`);
          target?.scrollIntoView({ block: 'center' });
          if (target) return;
        } else if (event.ctrlKey || event.metaKey) {
          window.desktop?.openLink(href);
          return;
        }
      }
      const line = event.target.closest('[data-heading-line]')?.dataset.headingLine
        ?? event.target.closest('[data-source-line]')?.dataset.sourceLine;
      const anchor = line !== undefined && Number(line) < view.state.doc.lines
        ? view.state.doc.line(Number(line) + 1).from : this.from;
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    });
    wrapper.querySelectorAll('.md-mermaid').forEach(async element => {
      try {
        const code = element.textContent;
        mermaidPromise ||= import('mermaid').then(({ default: mermaid }) => {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false, flowchart: { htmlLabels: false } });
          return mermaid;
        });
        const mermaid = await mermaidPromise;
        const { svg } = await mermaid.render(`diagram-${crypto.randomUUID()}`, code);
        if (wrapper.isConnected) { element.innerHTML = DOMPurify.sanitize(svg); view.requestMeasure(); }
      } catch (error) {
        if (wrapper.isConnected) {
          const message = document.createElement('div');
          message.className = 'md-diagram-error';
          message.textContent = `图表语法错误：${error.message}`;
          element.appendChild(message);
          view.requestMeasure();
        }
      }
    });
    return wrapper;
  }
  ignoreEvent() { return true; }
}

class TaskWidget extends WidgetType {
  constructor(checked, from) { super(); this.checked = checked; this.from = from; }
  eq(other) { return this.checked === other.checked && this.from === other.from; }
  toDOM(view) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'md-task-checkbox';
    input.setAttribute('aria-label', '切换任务完成状态');
    input.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('click', () => {
      view.dispatch({ changes: { from: this.from, to: this.from + 3, insert: this.checked ? '[ ]' : '[x]' } });
    });
    return input;
  }
  ignoreEvent() { return true; }
}

// Markdown text remains the document. Decorations never serialize rendered DOM.
export function presentationRanges(state, documentPath = null) {
  const ranges = [];
  const lines = new Set();
  const selection = state.selection;
  const active = (from, to) => selection.ranges.some(range => range.from <= to && range.to >= from);
  const replaced = [];
  const imageRoot = getImageRoot(state);
  const parsed = parsedDocument(state);
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (!line.text.trim() && number > 1 && number < state.doc.lines
      && state.doc.line(number - 1).text.trim() && state.doc.line(number + 1).text.trim()
      && !active(line.from, line.to)
      && !parsed.blocks.some(block => block.fromLine !== null && block.fromLine < number && block.toLine >= number)) {
      ranges.push(Decoration.line({ class: 'md-empty-line' }).range(line.from));
    }
  }
  for (const [fromLine, toLine] of parsedDocument(state).hiddenRanges) {
    const from = state.doc.line(fromLine + 1).from;
    const to = state.doc.line(Math.min(toLine, state.doc.lines)).to;
    if (!active(from, to) && !replaced.some(range => from >= range.from && to <= range.to)) {
      ranges.push(Decoration.replace({ block: true }).range(from, to));
      replaced.push({ from, to });
    }
  }
  for (const block of parsedDocument(state).blocks) {
    if (block.fromLine === null) {
      if (block.html.trim()) ranges.push(Decoration.widget({ block: true, side: 1, widget: new MarkdownWidget(block, state.doc.length, documentPath, state.doc.length, imageRoot) }).range(state.doc.length));
      continue;
    }
    const from = state.doc.line(block.fromLine + 1).from;
    const to = state.doc.line(Math.min(block.toLine, state.doc.lines)).to;
    if (active(from, to)) continue;
    ranges.push(Decoration.replace({ block: true, widget: new MarkdownWidget(block, from, documentPath, to, imageRoot) }).range(from, to));
    replaced.push({ from, to });
  }
  const lineActive = pos => { const line = state.doc.lineAt(pos); return active(line.from, line.to); };
  const mark = (from, to, name) => { if (to > from) ranges.push(Decoration.mark({ class: name }).range(from, to)); };
  const hide = (from, to) => { if (to > from) ranges.push(Decoration.replace({}).range(from, to)); };
  const lineStyle = (from, to, name) => {
    for (let number = state.doc.lineAt(from).number; number <= state.doc.lineAt(to).number; number++) {
      const pos = state.doc.line(number).from;
      const key = `${pos}:${name}`;
      if (!lines.has(key)) { ranges.push(Decoration.line({ class: name }).range(pos)); lines.add(key); }
    }
  };
  syntaxTree(state).iterate({ enter(node) {
    if (replaced.some(range => node.from >= range.from && node.to <= range.to)) return false;
    const name = node.name;
    if (name === 'Paragraph' && !/ListItem/.test(node.node.parent?.name || '')) lineStyle(node.from, node.from, 'md-paragraph-first-line');
    if (/^ATXHeading[1-6]$/.test(name)) lineStyle(node.from, node.to, `md-heading-${name.slice(-1)}`);
    if (name === 'StrongEmphasis') mark(node.from, node.to, 'md-strong');
    if (name === 'Emphasis') mark(node.from, node.to, 'md-emphasis');
    if (name === 'Strikethrough') mark(node.from, node.to, 'md-strike');
    if (name === 'InlineCode') mark(node.from, node.to, 'md-inline-code');
    if (name === 'Link') mark(node.from, node.to, 'md-link');
    if (name === 'Blockquote') lineStyle(node.from, node.to, 'md-quote');
    if (name === 'FencedCode' || name === 'CodeBlock') { lineStyle(node.from, node.to, 'md-code-line'); return false; }
    if (name === 'HorizontalRule') lineStyle(node.from, node.to, 'md-rule');
    if (name === 'ListMark') mark(node.from, node.to, 'md-list-marker');
    if (name === 'TaskMarker' && !lineActive(node.from)) {
      ranges.push(Decoration.replace({ widget: new TaskWidget(state.doc.sliceString(node.from, node.to).toLowerCase() === '[x]', node.from) }).range(node.from, node.to));
    }
    if (['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'QuoteMark'].includes(name) && !lineActive(node.from)) {
      hide(node.from, node.to);
    }
    if (name === 'Link' && !lineActive(node.from)) {
      // Only inline links: references and images retain their exact source presentation.
      const text = state.doc.sliceString(node.from, node.to);
      const labelEnd = text.indexOf('](');
      if (text.startsWith('[') && labelEnd !== -1 && text.endsWith(')')) {
        hide(node.from, node.from + 1);
        hide(node.from + labelEnd, node.to);
        return false;
      }
    }
  } });
  return Decoration.set(ranges, true);
}

export const livePreview = StateField.define({
  create(state) { return { enabled: true, documentPath: null, decorations: presentationRanges(state) }; },
  update(value, transaction) {
    let enabled = value.enabled;
    let documentPath = value.documentPath;
    for (const effect of transaction.effects) if (effect.is(setPreview)) enabled = effect.value;
    for (const effect of transaction.effects) if (effect.is(setDocumentPath)) documentPath = effect.value;
    if (transaction.docChanged || transaction.selection || transaction.effects.some(effect => effect.is(setRenderingOptions)) || enabled !== value.enabled || documentPath !== value.documentPath || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)) {
      return { enabled, documentPath, decorations: enabled ? presentationRanges(transaction.state, documentPath) : Decoration.none };
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations)
});

export function outlineEntries(state) {
  return parsedDocument(state).headings.map(heading => ({ from: state.doc.line(heading.line + 1).from, level: heading.level, text: heading.text }));
}
