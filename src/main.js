import './styles.css';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import { EditorState, Compartment, Text } from '@codemirror/state';
import { EditorView, keymap, drawSelection, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { classHighlighter } from '@lezer/highlight';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { livePreview, setPreview, setDocumentPath, setRenderingOptions, outlineEntries } from './presentation';
import { configureRendering } from './markdown-renderer.js';
import { writingDefaults, smartPunctuationExtension } from './smart-punctuation.js';
import { spellCheckExtension } from './spell-check.js';
import { documentSearchExtension } from './search-panel.js';
import { installWorkbench } from './workbench.js';
import { documentStats, statisticLabel } from './document-stats.js';
import { migrateLocalSettings } from './storage.js';
import { previewSelection } from './preview-selection.js';
import { installLocalization, t } from './i18n.js';

migrateLocalSettings(localStorage);
installLocalization();

const $ = id => document.getElementById(id);
const welcome = `# 把想法，写成自己的文字。\n\n这里是 **墨简**，一个安静的 Markdown 写作台。\n\n不必在编辑与预览之间来回切换。写下文字，格式自然浮现；光标移入段落，即可继续修改 Markdown。\n\n## 从一个小想法开始\n\n好的文字，往往始于一个简单的问题：*今天，我想记录什么？*\n\n> 写作不是把答案写下来，而是让想法慢慢清晰。\n\n## 让内容自己说话\n\n- 用标题整理思路\n- 用 **粗体** 标记重点，用 *斜体* 留下轻声的话\n- 按 Ctrl+F 查找，按 Ctrl+S 保存到本地\n\n### 今天的写作清单\n\n- [x] 留出一段安静的时间\n- [ ] 记录一个值得记住的想法\n- [ ] 给这篇文字起一个名字\n\n## 一点结构，恰到好处\n\n| 写作方式 | 适合的时刻 |\n| --- | --- |\n| 实时预览 | 专注内容，让格式自然呈现 |\n| 源码模式 | 检查语法，精确修改 Markdown |\n\n代码也可以拥有自己的角落：\n\n\`\`\`javascript\nconst idea = '从这里开始';\nconsole.log(idea);\n\`\`\`\n\n---\n\n文字留在你的电脑上。现在，开始写下第一句话吧。\n`;
let filePath = null;
let revision = null;
let savedText = null;
let live = true;
let busy = false;
let toastTimer;
const desktop = window.desktop;
let workbench;
let appearance = { readingSpeed: 382, wordCountDelimiter: 0 };
let writingOptions = { ...writingDefaults };
let countedText;
let countedStats;
const lineBreak = new Compartment();
const interfaceText = new Compartment();
const editorInterface = () => [placeholder(t('从这里开始写作…')), EditorView.contentAttributes.of({ 'aria-label': t('文档正文'), spellcheck: 'false' })];
document.addEventListener('inkslip-preferences-changed', event => {
  appearance = event.detail.appearance; countedText = undefined;
  writingOptions = { ...writingDefaults, ...appearance };
  configureRendering(writingOptions);
  document.body.classList.toggle('first-line-indent', writingOptions.indentFirstLine);
  document.body.classList.toggle('hide-br-and-line-break', !writingOptions.visibleBr);
  view.dispatch({ effects: setRenderingOptions.of(writingOptions) });
  refresh();
});
desktop?.onWindowStyle?.(style => {
  document.body.classList.toggle('window-unibody', style === 'unibody');
  $('window-controls').hidden = style !== 'unibody';
});
for (const button of document.querySelectorAll('[data-window-action]')) button.onclick = () => desktop?.windowAction(button.dataset.windowAction);
const maximizeButton = document.querySelector('[data-window-action="maximize"]');
const windowActionMenu = document.createElement('div'); windowActionMenu.id = 'window-action-menu'; windowActionMenu.hidden = true;
windowActionMenu.innerHTML = '<button type="button" data-action="fullscreen" aria-label="全屏" title="全屏"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 3V0h3m4 0h3v3m0 4v3H7m-4 0H0V7"/></svg></button><button type="button" data-action="always-on-top" aria-label="置顶" title="置顶"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="m4 0 5 5M5 1 2 5l3 3 4-3M3 7 0 10"/></svg></button>'; $('window-controls').append(windowActionMenu);
let windowActionTimer;
maximizeButton.onpointerdown = event => {
  if (event.button !== 0 || document.body.classList.contains('window-maximized') || document.body.classList.contains('window-pinned')) return;
  windowActionTimer = setTimeout(() => { windowActionMenu.hidden = false; }, 300);
};
for (const event of ['pointerup', 'pointercancel', 'pointerleave']) maximizeButton.addEventListener(event, () => clearTimeout(windowActionTimer));
maximizeButton.onclick = () => { windowActionMenu.hidden = true; desktop?.windowAction(document.body.classList.contains('window-pinned') ? 'always-on-top' : 'maximize'); };
for (const button of windowActionMenu.querySelectorAll('button')) button.onpointerup = event => { if (event.button === 0) { windowActionMenu.hidden = true; desktop?.windowAction(button.dataset.action); } };
$('menubar').addEventListener('pointerleave', () => { clearTimeout(windowActionTimer); windowActionMenu.hidden = true; });
document.addEventListener('pointerdown', event => { if (!event.target.closest('#window-action-menu, [data-window-action="maximize"]')) windowActionMenu.hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') windowActionMenu.hidden = true; });
desktop?.onWindowState?.(state => {
  const restorable = state.maximized || state.fullscreen;
  document.body.classList.toggle('window-maximized', restorable);
  document.body.classList.toggle('window-pinned', state.alwaysOnTop && !restorable);
  const button = document.querySelector('[data-window-action="maximize"]');
  button.setAttribute('aria-label', restorable ? '还原窗口' : state.alwaysOnTop ? '取消置顶' : '最大化');
});

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

const view = new EditorView({
  parent: $('editor'),
  state: createState(welcome)
});

function createState(text) {
  const state = EditorState.create({
    doc: text,
    extensions: [
      lineBreak.of(EditorState.lineSeparator.of(text.includes('\r\n') ? '\r\n' : '\n')),
      markdown({ base: markdownLanguage, extensions: GFM }),
      history(), drawSelection(), bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle), syntaxHighlighting(classHighlighter),
      previewSelection, keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      highlightSelectionMatches(), EditorView.lineWrapping,
      interfaceText.of(editorInterface()), livePreview,
      smartPunctuationExtension(() => writingOptions, () => live && !view.composing), spellCheckExtension,
      documentSearchExtension,
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) refresh();
      })
    ]
  });
  return state.update({ selection: { anchor: state.doc.length }, effects: setDocumentPath.of(filePath) }).state;
}

function refresh() {
  const text = view.state.sliceDoc();
  const dirty = savedText === null || text !== savedText;
  desktop?.setDirty(dirty);
  const filename = filePath ? filePath.split(/[\\/]/).pop() : t('未命名.md');
  $('file-name').textContent = filename;
  document.title = `${dirty ? '● ' : ''}${filename} · ${t('墨简')}`;
  $('save-state').textContent = busy ? '正在保存…' : dirty ? '有未保存的修改' : '已保存到本地';
  $('save-dot').classList.toggle('dirty', dirty);
  if (countedText !== text) { countedText = text; countedStats = documentStats(text, appearance.readingSpeed); }
  $('word-count').textContent = statisticLabel(countedStats, appearance.wordCountDelimiter);
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  $('cursor-position').textContent = `行 ${line.number}，列 ${head - line.from + 1}`;
  const headings = outlineEntries(view.state);
  $('heading-count').textContent = headings.length;
  $('outline').replaceChildren(...headings.map((entry, index) => {
    const button = document.createElement('div');
    button.className = 'outline-item';
    button.dataset.level = entry.level;
    button.dataset.outlineId = `${entry.level}:${entry.text}:${index}`;
    const expander = document.createElement('button'); expander.type = 'button'; expander.className = 'outline-expander';
    const label = document.createElement('button'); label.type = 'button'; label.className = 'outline-label'; label.textContent = entry.text || '无标题';
    button.append(expander, label);
    button.title = entry.text;
    button.classList.toggle('active', head >= entry.from && (head < (headings[index + 1]?.from ?? Infinity)));
    label.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: entry.from }, effects: EditorView.scrollIntoView(entry.from, { y: 'start' }) });
      view.focus();
    });
    return button;
  }));
  workbench?.update({ path: filePath, filename, dirty, live });
  document.dispatchEvent(new CustomEvent('inkslip-statistics-changed', { detail: { stats: countedStats, selection: view.state.selection.main.empty ? null : documentStats(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), appearance.readingSpeed) } }));
}

function setMode(enabled) {
  live = enabled;
  view.dispatch({ effects: setPreview.of(live) });
  document.body.classList.toggle('source-mode', !live);
  $('mode-label').setAttribute('aria-pressed', String(!live));
  $('mode-label').setAttribute('aria-label', live ? '启用源代码模式' : '退出源代码模式');
  $('mode-label').title = live ? '启用源代码模式 · Ctrl+/' : '退出源代码模式 · Ctrl+/';
  $('source-exit-label').hidden = live;
  refresh();
  view.focus();
}

function loadDocument(result) {
  filePath = result.path;
  revision = result.revision;
  savedText = result.content;
  view.setState(createState(result.content));
  setMode(live);
  notify('文档已打开');
}

async function openPath(path) {
  if (busy || !desktop) return;
  busy = true;
  try {
    const result = await desktop.openPath(path);
    if (result.status === 'error') notify(result.message);
    else if (result.status !== 'cancelled') loadDocument(result);
  } catch (error) { notify(`打开失败：${error.message}`); }
  finally { busy = false; refresh(); }
}

async function openFile() {
  if (busy) return;
  if (!desktop) { notify('请使用桌面版打开本地文件：npm start'); return; }
  busy = true;
  try {
    const result = await desktop.openDocument();
    if (result.status === 'cancelled') return;
    if (result.status === 'error') { notify(result.message); return; }
    loadDocument(result);
  } catch (error) { notify(`打开失败：${error.message}`); }
  finally { busy = false; refresh(); }
}

async function saveFile(saveAs = false) {
  if (busy) return;
  if (!desktop) { notify('请使用桌面版保存本地文件：npm start'); return; }
  if (localStorage.getItem('inkslip-final-newline') === 'true' && view.state.doc.length && !view.state.doc.toString().endsWith('\n')) view.dispatch({ changes: { from: view.state.doc.length, insert: Text.of(['', '']) } });
  const text = view.state.sliceDoc();
  busy = true;
  refresh();
  try {
    const result = await desktop.saveDocument({ path: filePath, content: text, expectedRevision: revision, saveAs });
    if (result.status === 'cancelled') return;
    if (result.status === 'conflict') { notify('磁盘文件已被其他程序修改。请另存为（Ctrl+Shift+S）保留当前内容。'); return; }
    if (result.status === 'error') { notify(result.message); return; }
    filePath = result.path;
    revision = result.revision;
    savedText = text;
    view.dispatch({ effects: setDocumentPath.of(filePath) });
    notify('已保存到本地');
  } catch (error) { notify(`保存失败：${error.message}`); }
  finally { busy = false; refresh(); }
}

async function newFile() {
  if (busy) return;
  if (desktop) {
    const result = await desktop.newDocument();
    if (result.status === 'cancelled') return;
    if (result.status === 'error') { notify(result.message); return; }
  } else if ((savedText === null || view.state.sliceDoc() !== savedText) && !window.confirm(t('当前文档尚未保存。放弃修改并新建文档？'))) return;
  filePath = revision = null;
  savedText = '';
  view.setState(createState(''));
  setMode(live);
  refresh();
}

workbench = installWorkbench({ view, desktop, actions: { notify, newFile, openFile, openPath, saveFile, loadDocument, setMode,
  renamePath: path => { filePath = path; view.dispatch({ effects: setDocumentPath.of(path) }); refresh(); },
  setLineSeparator: separator => { view.dispatch({ effects: lineBreak.reconfigure(EditorState.lineSeparator.of(separator)) }); refresh(); } } });
document.addEventListener('inkslip-language-changed', () => {
  view.dispatch({ effects: interfaceText.reconfigure(editorInterface()) });
  refresh();
});
refresh();
