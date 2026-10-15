import { EditorSelection } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { parser, GFM } from '@lezer/markdown';

const inlineParser = parser.configure(GFM);

// Match rendered characters to source characters, skipping Markdown delimiters.
// The offsets refer to UTF-16, as do DOM ranges and CodeMirror positions.
export function sourceOffset(source, rendered, offset, literal = false) {
  offset = Math.max(0, Math.min(offset, rendered.length));
  const positions = [];
  const hidden = new Set();
  if (!literal) inlineParser.parse(source).iterate({ enter(node) {
    if (['HeaderMark', 'QuoteMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark'].includes(node.name)
      || ['URL', 'LinkTitle', 'LinkLabel'].includes(node.name) && ['Link', 'Image'].includes(node.node.parent?.name)) {
      for (let pos = node.from; pos < node.to; pos++) hidden.add(pos);
    }
  } });
  let from = 0;
  for (let index = 0; index < rendered.length; index++) {
    let found = source.indexOf(rendered[index], from);
    while (found >= 0 && hidden.has(found)) found = source.indexOf(rendered[index], found + 1);
    if (found < 0) { positions.push(from); continue; }
    positions.push(found);
    from = found + 1;
  }
  return offset < positions.length ? positions[offset] : from;
}

export function renderedPosition(view, x, y) {
  const element = document.elementFromPoint(x, y);
  const widget = element?.closest('.md-rendered');
  if (!widget || !view.dom.contains(widget)) {
    const caret = document.caretRangeFromPoint(x, y);
    const line = (caret?.startContainer.nodeType === 1 ? caret.startContainer : caret?.startContainer.parentElement)?.closest('.cm-line');
    return line && view.dom.contains(line) ? view.posAtDOM(caret.startContainer, caret.startOffset) : view.posAtCoords({ x, y });
  }
  const caret = document.caretRangeFromPoint(x, y);
  if (!caret || !widget.contains(caret.startContainer)) return Number(widget.dataset.sourceFrom);
  const leaf = (caret.startContainer.nodeType === 1 ? caret.startContainer : caret.startContainer.parentElement).closest('[data-source-line]');
  if (!leaf) return Number(widget.dataset.sourceFrom);
  const before = document.createRange();
  before.setStart(leaf, 0);
  before.setEnd(caret.startContainer, caret.startOffset);
  const text = leaf.textContent;
  const offset = before.toString().length;
  const lineIndex = text.slice(0, offset).split('\n').length - 1;
  const lineNumber = Math.min(Number(leaf.dataset.sourceLine) + lineIndex + 1, view.state.doc.lines);
  const sourceLine = view.state.doc.line(lineNumber);
  const renderedLine = text.split('\n')[lineIndex] || '';
  const lineOffset = offset - (text.slice(0, offset).lastIndexOf('\n') + 1);
  return sourceLine.from + sourceOffset(sourceLine.text, renderedLine, lineOffset, !!leaf.closest('pre'));
}

export function beginPreviewSelection(view, event) {
  if (event.button !== 0) return;
  const anchorAtPoint = renderedPosition(view, event.clientX, event.clientY);
  if (anchorAtPoint === null) return;
  event.preventDefault();
  const anchor = event.shiftKey ? view.state.selection.main.anchor : anchorAtPoint;
  view.dispatch({ selection: { anchor, head: anchorAtPoint } });
  view.focus();
  const move = event => {
    const head = renderedPosition(view, event.clientX, event.clientY);
    if (head !== null) view.dispatch({ selection: { anchor, head } });
  };
  const end = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', end);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', end, { once: true });
}

const goals = new WeakMap();
function moveAcrossPreview(view, down, extend) {
  if (document.body.classList.contains('source-mode')) return false;
  const range = view.state.selection.main;
  const rect = view.coordsAtPos(range.head, down ? 1 : -1);
  if (!rect) return false;
  const previous = goals.get(view);
  const x = previous?.head === range.head ? previous.x : rect.left;
  const lineHeight = rect.bottom - rect.top;
  // Search the next visual line, skipping collapsed paragraph separators.
  for (let step = 1; step <= 3; step++) {
    const y = down ? rect.bottom + lineHeight * (step - .5) : rect.top - lineHeight * (step - .5);
    const element = document.elementFromPoint(x, y);
    if (!element?.closest('.md-rendered, .cm-line:not(.md-empty-line)')) continue;
    const head = renderedPosition(view, x, y);
    if (head === null || head === range.head) continue;
    view.dispatch({ selection: EditorSelection.single(extend ? range.anchor : head, head), scrollIntoView: true });
    goals.set(view, { head, x });
    return true;
  }
  goals.delete(view);
  return false;
}

export const previewSelection = [
  keymap.of([
    { key: 'ArrowDown', run: view => moveAcrossPreview(view, true, false), shift: view => moveAcrossPreview(view, true, true) },
    { key: 'ArrowUp', run: view => moveAcrossPreview(view, false, false), shift: view => moveAcrossPreview(view, false, true) },
  ]),
  EditorView.domEventHandlers({ mousedown(event, view) {
    // Drags beginning in ordinary editable lines retain native CodeMirror handling.
    if (!event.target.closest('.md-rendered')) goals.delete(view);
    return false;
  } }),
];
