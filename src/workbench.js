import menuSpec from '../shared/menu-spec.json';
import { version } from '../package.json';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { createEditorCommands, getEditorContext, parseTable } from './editor-commands.js';
import { renderDocument } from './markdown-renderer.js';
import DOMPurify from 'dompurify';
import { installPreferences } from './preferences.js';
import { t } from './i18n.js';
import { createImageUploadAction, resolveImageContext, replaceImageSource, convertImageSyntax, deleteImage, scaleImage, imageSources } from './image-actions.js';
import { createImagePasteAction } from './image-paste.js';
import { installImagePolicies, getImageRoot, resolveImageSource, imageSourceForRoot } from './image-policy.js';
import { sortFiles } from './file-sort.js';
import { uiIcon } from './ui-icons.js';
import sidebarNew from '../assets/icons/sidebar-new.svg?raw';
import sidebarMore from '../assets/icons/sidebar-more.svg?raw';
import sidebarClose from '../assets/icons/sidebar-close.svg?raw';
import sidebarList from '../assets/icons/sidebar-list.svg?raw';
import sidebarTree from '../assets/icons/sidebar-tree.svg?raw';
import sidebarGroup from '../assets/icons/sidebar-group.svg?raw';
import sidebarNatural from '../assets/icons/sidebar-natural.svg?raw';
import sidebarName from '../assets/icons/sidebar-name.svg?raw';
import sidebarModified from '../assets/icons/sidebar-modified.svg?raw';
import sidebarCreated from '../assets/icons/sidebar-created.svg?raw';
import sidebarNaturalDesc from '../assets/icons/sidebar-natural-desc.svg?raw';
import sidebarNameDesc from '../assets/icons/sidebar-name-desc.svg?raw';
import sidebarModifiedDesc from '../assets/icons/sidebar-modified-desc.svg?raw';
import sidebarCreatedDesc from '../assets/icons/sidebar-created-desc.svg?raw';

const $ = id => document.getElementById(id);
const item = (id, label, disabled = false) => ({ id, label, disabled });
const separator = { type: 'separator' };
const editingSettings = { 'smart-quotes': 'smartQuotes', 'smart-dashes': 'smartDashes', 'unicode-punctuation': 'remapUnicodePunctuation', 'indent-first-line': 'indentFirstLine', 'visible-br': 'visibleBr', 'preserve-line-break': 'preserveLineBreaks', 'spell-check': 'spellCheck' };

export function installWorkbench({ view, actions, desktop }) {
  const editor = createEditorCommands(view, { notify: actions.notify, desktop, getDocumentId: () => info.path });
  const importLock = new Compartment(); let importing = false;
  let info = {};
  const pasteImage = createImagePasteAction(view, { desktop, notify: actions.notify, getDocumentId: () => info.path });
  view.dom.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (!files.length || !desktop?.pasteImages) return;
    event.preventDefault(); event.stopPropagation(); pasteImage(files);
  }, true);
  const preferences = installPreferences({ view, desktop, notify: actions.notify });
  const themeId = id => menuSpec.find(menu => menu.label === '主题').items.find(entry => entry.id === id)?.theme || (id?.startsWith('theme:') ? id.slice(6) : null);
  function themeItems() {
    return [...preferences.themes.list().map(theme => ({ id: menuSpec.find(menu => menu.label === '主题').items.find(entry => entry.theme === theme.id)?.id || `theme:${theme.id}`, label: theme.name, theme: theme.id })), separator, item('theme-folder', '打开主题文件夹'), item('theme-reload', '重新加载主题')];
  }
  document.addEventListener('inkslip-theme-changed', () => {
    for (const card of document.querySelectorAll('.theme-card')) { const selected = card.dataset.theme === document.body.dataset.theme; card.classList.toggle('active', selected); card.setAttribute('aria-pressed', String(selected)); }
  });
  const statistics = document.createElement('div'); statistics.id = 'word-count-panel'; statistics.hidden = true;
  statistics.setAttribute('role', 'menu'); statistics.setAttribute('aria-label', '文档统计'); document.body.append(statistics);
  let latestStatistics;
  function drawStatistics() {
    if (!latestStatistics) return;
    statistics.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = '全文'; statistics.append(heading);
    const delimiter = preferences.getPreferences().appearance.wordCountDelimiter;
    for (const [value, label, count] of [[3, '分钟', latestStatistics.stats.minutes || '≤1'], [2, '行', latestStatistics.stats.lines], [0, '词', latestStatistics.stats.words], [1, '字符', latestStatistics.stats.characters]]) {
      const button = document.createElement('button'); button.dataset.delimiter = value; button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(delimiter === value));
      const name = document.createElement('span'); name.textContent = label; const number = document.createElement('span'); number.textContent = count.toLocaleString(); button.append(name, number);
      button.onclick = () => { statistics.hidden = true; preferences.updateAppearance({ wordCountDelimiter: value }); view.focus(); }; statistics.append(button);
    }
    if (latestStatistics.selection) {
      const selected = document.createElement('div'); selected.className = 'selection-stats';
      selected.innerHTML = `<h3>选中内容</h3><p><span>词</span><span>${latestStatistics.selection.words.toLocaleString()}</span></p><p><span>字符</span><span>${latestStatistics.selection.characters.toLocaleString()}</span></p>`; statistics.append(selected);
    }
  }
  document.addEventListener('inkslip-statistics-changed', event => { latestStatistics = event.detail; drawStatistics(); });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#word-count, #word-count-panel')) statistics.hidden = true; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') statistics.hidden = true; });
  window.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const config = preferences.getPreferences().appearance;
    if (config.zoomByMouse) preferences.updateAppearance({ zoomLevel: Math.max(-3, Math.min(6, config.zoomLevel + (event.deltaY < 0 ? 1 : -1))) });
  }, { passive: false });
  const uploadSelectedImage = createImageUploadAction(view, { uploadImage: source => desktop.uploadImage({ source: resolveImageSource(source, info.path, getImageRoot(view.state)), documentPath: info.path }), notify: actions.notify, getDocumentId: () => info.path });
  let uploadPending = false;
  let recentDocuments = [];
  desktop?.recentDocuments?.().then(files => { recentDocuments = files; });
  let lastClosedPath;
  let lastContext;
  const fileMenu = document.createElement('section'); fileMenu.id = 'file-menu'; fileMenu.hidden = true;
  fileMenu.setAttribute('aria-label', '文件菜单'); fileMenu.innerHTML = '<nav id="file-menu-nav" aria-label="文件操作"></nav><div id="file-menu-content"></div>';
  document.body.append(fileMenu);
  const fileNavigation = [['back', '‹'], ['new', '新建'], ['open-panel', '打开'], ['save', '保存'], ['save-as', '另存为'], ['export-panel', '导出'], ['print', '打印'], ['themes-panel', '主题'], ['preferences', '偏好设置'], ['about', '关于墨简'], ['close', '关闭']];
  for (const [id, label] of fileNavigation) {
    const button = document.createElement('button'); button.textContent = label; button.dataset.command = id;
    if (id === 'back') { button.className = 'file-menu-back'; button.setAttribute('aria-label', '返回编辑器'); button.innerHTML = '<span aria-hidden="true">←</span><span class="menu-back-default">菜单</span><span class="menu-back-hover">返回</span>'; }
    button.onclick = () => {
      if (id.endsWith('-panel')) return drawFilePage(id);
      if (['save', 'save-as', 'print'].includes(id)) return run(id, menuContext());
      closeMenus(); return id === 'back' ? view.focus() : run(id, menuContext());
    };
    $('file-menu-nav').append(button);
    if (['save-as', 'print', 'about'].includes(id)) { const divider = document.createElement('div'); divider.className = 'file-nav-divider'; $('file-menu-nav').append(divider); }
  }
  function drawFilePage(id) {
    const content = $('file-menu-content'); content.replaceChildren();
    for (const button of $('file-menu-nav').querySelectorAll('button')) button.setAttribute('aria-current', button.dataset.command === id ? 'page' : 'false');
    const heading = document.createElement('h2'); heading.textContent = ({ 'open-panel': '打开', 'export-panel': '导出', 'themes-panel': '主题' })[id]; content.append(heading);
    if (id === 'themes-panel') {
      const grid = document.createElement('div'); grid.className = 'theme-grid'; content.append(grid);
      for (const theme of preferences.themes.list()) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'theme-card'; button.dataset.theme = theme.id; button.dataset.command = themeItems().find(entry => entry.theme === theme.id).id;
        button.setAttribute('aria-label', theme.name); button.title = theme.name; button.classList.toggle('active', theme.id === document.body.dataset.theme); button.setAttribute('aria-pressed', String(theme.id === document.body.dataset.theme));
        const preview = preferences.themes.preview(theme, button); preview.ready.catch(error => { button.title = `${theme.name}：${error.message}`; });
        button.onclick = () => preferences.setTheme(theme.id); grid.append(button);
      }
      const controls = document.createElement('div'); controls.className = 'theme-controls'; content.append(controls);
      for (const [command, label] of [['theme-folder', '打开主题文件夹'], ['theme-reload', '重新加载主题']]) { const button = document.createElement('button'); button.textContent = label; button.onclick = async () => { await run(command); if (command === 'theme-reload') drawFilePage(id); }; controls.append(button); }
      return;
    }
    const controls = document.createElement('div'); controls.className = 'file-menu-actions'; content.append(controls);
    const entries = id === 'open-panel' ? [item('open', '打开…')]
      : id === 'export-panel' ? menuSpec[0].items.find(entry => entry.label === '导出').items
      : menuSpec.find(entry => entry.label === '主题').items;
    for (const entry of entries.filter(entry => entry.id)) {
      const button = document.createElement('button'); button.textContent = entry.label; button.dataset.command = entry.id; button.disabled = entry.enabled === false; if (entry.reason) button.title = entry.reason;
      button.onclick = () => { closeMenus(); run(entry.id, menuContext()); }; controls.append(button);
    }
    if (id === 'open-panel') {
      const importTitle = document.createElement('h3'); importTitle.textContent = '导入'; content.append(importTitle);
      const importEntry = menuSpec[0].items.find(entry => entry.id === 'import-doc');
      const importer = document.createElement('button'); importer.className = 'file-menu-import'; importer.textContent = '导入…　docx/wiki/rst/org/…'; importer.dataset.command = 'import-doc'; importer.onclick = () => { closeMenus(); run('import-doc'); }; content.append(importer);
      const title = document.createElement('h3'); title.textContent = '最近文件'; content.append(title);
      const filters = document.createElement('div'); filters.className = 'file-menu-filter'; content.append(filters);
      const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索…'; search.setAttribute('aria-label', '搜索最近文件'); filters.append(search);
      const more = document.createElement('details'); more.innerHTML = '<summary aria-label="最近文件操作">···</summary><button type="button">清除最近文件</button>'; filters.append(more);
      const table = document.createElement('table'); table.id = 'file-menu-recent'; table.innerHTML = '<thead><tr><th>文件名</th><th>路径</th></tr></thead><tbody></tbody>'; content.append(table);
      const recent = table.querySelector('tbody');
      const draw = () => {
        recent.replaceChildren(); const matches = recentDocuments.filter(path => path.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
        if (!matches.length) { const row = recent.insertRow(); const cell = row.insertCell(); cell.colSpan = 2; cell.textContent = '（无最近文件）'; }
        for (const path of matches) {
          const row = recent.insertRow(), cell = row.insertCell(), location = row.insertCell(); row.dataset.i18nIgnore = '';
          const button = document.createElement('button'); button.className = 'file-menu-recent'; button.textContent = path.split(/[\\/]/).pop(); cell.append(button); location.textContent = path; location.title = path;
          button.onclick = () => { closeMenus(); run('open-recent', { path }); };
        }
      };
      more.querySelector('button').onclick = async () => { await run('clear-recent'); more.open = false; draw(); };
      search.oninput = draw; draw();
    }
  }
  function showFileMenu() { closeMenus(); drawFilePage('open-panel'); fileMenu.hidden = false; document.body.classList.add('file-menu-open'); $('window-menu').setAttribute('aria-expanded', 'true'); document.querySelector('#file-menu-nav [data-command="open-panel"]').focus(); }
  $('window-menu').onclick = () => fileMenu.hidden ? showFileMenu() : (closeMenus(), view.focus());
  const uploadOverlay = document.createElement('div');
  uploadOverlay.id = 'image-upload-progress'; uploadOverlay.hidden = true;
  uploadOverlay.setAttribute('role', 'status'); uploadOverlay.setAttribute('aria-live', 'polite');
  uploadOverlay.innerHTML = '<div class="image-upload-panel"><span class="image-upload-spinner" aria-hidden="true"></span><span>正在通过 PicGo 上传图片…</span></div>';
  document.body.append(uploadOverlay);
  const imagePolicies = installImagePolicies(view, { desktop, getDocumentId: () => info.path || null, getPreferences: preferences.getPreferences, notify: actions.notify,
    confirm: async message => Boolean(await ask(message, [])), uploading: pending => { uploadPending = pending; uploadOverlay.hidden = !pending; } });
  let folderRoot = null;
  let libraryUndoLabel = null;
  let sidebarTab = 'outline';
  let treeMode = true;
  let collapsibleOutline = localStorage.getItem('inkslip-outline-collapsible') === 'true';
  const collapsedHeadings = new Set();
  const outlineFilter = document.createElement('div'); outlineFilter.id = 'outline-filter'; outlineFilter.hidden = true;
  outlineFilter.innerHTML = '<input type="search" placeholder="查找" aria-label="查找大纲" autocomplete="off"><button type="button" aria-label="关闭大纲查找"></button>';
  $('panel-outline').insertBefore(outlineFilter, $('outline'));
  const outlineQuery = outlineFilter.querySelector('input');
  outlineQuery.oninput = () => updateOutline();
  outlineQuery.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); toggleOutlineFilter(false); } };
  outlineFilter.querySelector('button').onclick = () => toggleOutlineFilter(false);

  function toggleOutlineFilter(show = outlineFilter.hidden) {
    outlineFilter.hidden = !show;
    if (show) outlineQuery.focus();
    else { outlineQuery.value = ''; view.focus(); }
    updateOutline();
  }

  function updateOutline() {
    const rows = [...$('outline').querySelectorAll('.outline-item')];
    const ancestors = [], query = outlineFilter.hidden ? '' : outlineQuery.value.toLocaleLowerCase();
    $('outline').classList.toggle('outline-flat', !collapsibleOutline);
    $('outline').classList.toggle('outline-filtering', !outlineFilter.hidden);
    for (const [index, row] of rows.entries()) {
      const level = Number(row.dataset.level), id = row.dataset.outlineId;
      while (ancestors.length && ancestors.at(-1).level >= level) ancestors.pop();
      const hasChildren = Number(rows[index + 1]?.dataset.level) > level;
      const expander = row.querySelector('.outline-expander'), label = row.querySelector('.outline-label');
      const text = row.title || '无标题', match = query ? text.toLocaleLowerCase().indexOf(query) : -1;
      row.hidden = query ? match < 0 : outlineFilter.hidden && collapsibleOutline && ancestors.some(parent => collapsedHeadings.has(parent.id));
      row.classList.toggle('outline-open', !collapsedHeadings.has(id));
      expander.disabled = !hasChildren;
      expander.setAttribute('aria-label', `${t(collapsedHeadings.has(id) ? '展开' : '折叠')} ${text}`);
      if (hasChildren) expander.setAttribute('aria-expanded', String(!collapsedHeadings.has(id))); else expander.removeAttribute('aria-expanded');
      expander.onclick = () => { if (collapsedHeadings.has(id)) collapsedHeadings.delete(id); else collapsedHeadings.add(id); updateOutline(); };
      label.replaceChildren();
      if (match >= 0) {
        const hit = document.createElement('strong'); hit.className = 'outline-hit'; hit.textContent = text.slice(match, match + query.length);
        label.append(text.slice(0, match), hit, text.slice(match + query.length));
      } else label.textContent = text;
      ancestors.push({ level, id });
    }
  }
  let menuOpener;
  const folders = new Map();
  const expanded = new Set();
  let listFiles = [], folderMatches = null, folderSearchVersion = 0, folderMenuVersion = 0, searchTimer;
  let fileViews = { tree: { sort: 'natural', descending: false, group: true }, list: { sort: 'natural', descending: false, group: true } };
  try { fileViews = { ...fileViews, ...JSON.parse(localStorage.getItem('inkslip-file-views') || '{}') }; } catch {}
  const fileOptions = () => fileViews[treeMode ? 'tree' : 'list'];

  function closeMenus() {
    folderMenuVersion++;
    fileMenu.hidden = true; document.body.classList.remove('file-menu-open'); $('window-menu').setAttribute('aria-expanded', 'false');
    for (const id of ['menu-popup', 'context-menu']) { $(id).hidden = true; $(id).replaceChildren(); }
    document.querySelectorAll('.menubar button[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    $('sidebar-files-menu').hidden = true; $('sidebar-menu').setAttribute('aria-expanded', 'false'); $('sidebar-footer').classList.remove('menu-open');
    document.querySelectorAll('.file-entry.context-selected').forEach(node => node.classList.remove('context-selected'));
  }

  function checked(id) {
    if (id === 'outline-filter') return !outlineFilter.hidden;
    if (id === 'outline-collapsible' || id === 'outline-flat') return collapsibleOutline === (id === 'outline-collapsible');
    if (id === 'file-tree' || id === 'file-list') return treeMode === (id === 'file-tree');
    if (id === 'search-folder') return !$('folder-search').hidden;
    if (themeId(id)) return themeId(id) === document.body.dataset.theme;
    const appearance = preferences.getPreferences().appearance;
    if (id === 'punctuation-input') return !appearance.convertSmartOnRender;
    if (id === 'punctuation-rendering') return appearance.convertSmartOnRender;
    if (id === 'unicode-punctuation' && !appearance.convertSmartOnRender && (appearance.smartQuotes || appearance.smartDashes)) return true;
    if (editingSettings[id]) return appearance[editingSettings[id]];
    if (id === 'insert-image-policy-copy' || id === 'insert-image-policy-upload') return imagePolicies.policy().action === (id.endsWith('copy') ? 'copy' : 'upload');
    if (id === 'image-root') return Boolean(getImageRoot(view.state));
    return ({ source: !info.live, focus: document.body.classList.contains('focus-mode'),
      typewriter: document.body.classList.contains('typewriter-mode'), sidebar: !document.body.classList.contains('sidebar-hidden'),
      outline: sidebarTab === 'outline', files: sidebarTab === 'files',
      'statusbar': !document.body.classList.contains('statusbar-hidden'), 'eol-crlf': view.state.lineBreak === '\r\n', 'eol-lf': view.state.lineBreak === '\n',
      'ensure-final-newline': localStorage.getItem('inkslip-final-newline') === 'true' })[id];
  }

  function menuContext() {
    const context = lastContext && lastContext.doc === view.state.doc && lastContext.selection === view.state.selection ? { ...lastContext } : getEditorContext(view, {});
    const images = imageSources(view.state);
    if (context.kind !== 'image') {
      const cursor = view.state.selection.main.head;
      const image = images.find(image => image.inlineFrom <= cursor && image.inlineTo >= cursor);
      if (image) Object.assign(context, { kind: 'image', imageInlineFrom: image.inlineFrom, imageSource: image.href, href: image.href,
        target: [...view.dom.querySelectorAll('img')].find(node => node.dataset.imageSource === image.href) });
    }
    return context;
  }

  function mainMenuItems(entries, context) {
    if (entries === menuSpec.find(menu => menu.label === '主题').items && preferences.themes.list().length) entries = themeItems();
    const imageCommands = /^(?:open-image|reveal-image|copy-image-to|move-image-to|upload-image|delete-image|copy-image-content)$|^image-(?:scale|syntax)-/;
    const tableCommands = /^(?:insert-(row|column)-|delete-(row|column)$|move-(row|column)-|copy-table|format-table|delete-table)/;
    return entries.filter(entry => entry.context !== 'image' || context.kind === 'image').map(entry => {
      if (entry.id === 'recent-documents') return { ...entry, items: [...(recentDocuments.length ? recentDocuments.map(path => ({ id: 'open-recent', label: path.split(/[\\/]/).pop(), context: { path }, reason: path })) : [entry.items[0]]), ...entry.items.slice(1)] };
      const table = context.kind === 'table' ? parseTable(view.state.doc.sliceString(context.from, context.to)) : null;
      const disabled = entry.enabled === false || imageCommands.test(entry.id || '') && context.kind !== 'image'
        || tableCommands.test(entry.id || '') && context.kind !== 'table'
        || entry.id === 'delete-row' && !context.row || entry.id === 'delete-column' && table?.columns < 2
        || /^(?:rename-file|duplicate-file|delete-file|show-in-sidebar|encoding-)/.test(entry.id || '') && !info.path
        || entry.id === 'copy-code' && context.kind !== 'code'
        || entry.id === 'file-properties' && !info.path
        || entry.id === 'unicode-punctuation' && !preferences.getPreferences().appearance.convertSmartOnRender && (preferences.getPreferences().appearance.smartQuotes || preferences.getPreferences().appearance.smartDashes);
      return { ...entry, disabled, ...(entry.items ? { items: mainMenuItems(entry.items, context) } : {}) };
    });
  }

  function populateMenu(host, entries, context) {
    for (const entry of entries) {
      if (entry.type === 'separator') { const rule = document.createElement('div'); rule.className = 'menu-divider'; rule.setAttribute('role', 'separator'); host.append(rule); continue; }
      if (entry.tools) {
        const group = document.createElement('div'); group.className = 'menu-tools'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', entry.label);
        for (const tool of entry.tools) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'menu-tool'; button.dataset.command = tool.id;
          const icon = uiIcon(tool.id);
          if (icon) button.innerHTML = icon; else button.textContent = tool.symbol;
          button.disabled = Boolean(tool.disabled); button.setAttribute('role', 'menuitem'); button.setAttribute('aria-label', tool.label); button.title = tool.label + (tool.shortcut ? ` · ${tool.shortcut}` : '');
          button.onclick = () => { closeMenus(); run(tool.id, context); }; group.append(button);
        }
        host.append(group); continue;
      }
      const row = document.createElement('div'); row.className = 'menu-row';
      const button = document.createElement('button');
      button.className = 'menu-item'; button.type = 'button'; button.disabled = Boolean(entry.disabled || entry.enabled === false || entry.id === 'reveal-file' && !info.path);
      button.dataset.command = entry.id || ''; button.setAttribute('role', 'menuitem');
      if (checked(entry.id) !== undefined) { button.setAttribute('role', 'menuitemcheckbox'); button.setAttribute('aria-checked', String(checked(entry.id))); }
      const mark = document.createElement('span'); mark.className = 'menu-check'; mark.textContent = checked(entry.id) ? host.closest('#context-menu') ? '√' : '✓' : '';
      const label = document.createElement('span'); label.className = 'menu-label'; label.textContent = entry.label;
      if (entry.context?.path || entry.theme || entry.id === 'spelling-replace') label.dataset.i18nIgnore = '';
      const hint = document.createElement('span'); hint.className = `menu-shortcut${entry.items ? ' menu-submenu-caret' : ''}`; hint.textContent = entry.items ? '›' : (entry.shortcut || '').replaceAll('CommandOrControl', 'Ctrl');
      button.append(mark, label, hint); row.append(button); host.append(row);
      if (entry.reason) button.title = entry.reason;
      if (entry.items) {
        button.setAttribute('aria-haspopup', 'menu');
        const openChild = () => {
          if (button.disabled) return;
          host.querySelectorAll(':scope > .menu-row > .submenu-popup').forEach(child => child.remove());
          const child = document.createElement('div'); child.className = 'menu-popup submenu-popup'; child.setAttribute('role', 'menu');
          populateMenu(child, entry.items, context); row.append(child);
          const buttonRect = button.getBoundingClientRect();
          child.style.position = 'fixed'; child.style.left = `${buttonRect.right - 2}px`; child.style.top = `${buttonRect.top - 5}px`;
          const rect = child.getBoundingClientRect();
          if (rect.right > window.innerWidth) child.style.left = `${Math.max(6, buttonRect.left - rect.width + 2)}px`;
          child.style.top = `${Math.max(6, Math.min(buttonRect.top - 5, window.innerHeight - rect.height - 6))}px`;
        };
        button.addEventListener('mouseenter', openChild);
        button.onclick = openChild;
        button.onkeydown = event => { if (event.key === 'ArrowRight') { event.preventDefault(); openChild(); row.querySelector('.submenu-popup button:not(:disabled)')?.focus(); } };
      } else {
        button.onmouseenter = () => host.querySelectorAll(':scope > .menu-row > .submenu-popup').forEach(child => child.remove());
        button.onclick = () => { closeMenus(); run(entry.id, { ...context, ...(typeof entry.context === 'object' ? entry.context : {}) }); };
      }
    }
    host.onkeydown = event => {
      const buttons = [...host.querySelectorAll(':scope > .menu-row > button:not(:disabled), :scope > .menu-tools > button:not(:disabled)')];
      const position = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (position + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      } else if (event.key === 'ArrowLeft' && host.classList.contains('submenu-popup')) { event.preventDefault(); event.stopPropagation(); host.parentElement.querySelector('button').focus(); host.remove(); }
    };
  }

  function showMenu(entries, x, y, context = {}, opener = null, isContext = false) {
    closeMenus(); menuOpener = opener;
    const host = $(isContext ? 'context-menu' : 'menu-popup');
    host.classList.toggle('library-context-menu', Boolean(context.library));
    host.classList.toggle('outline-context-menu', context.kind === 'outline');
    populateMenu(host, entries, context); host.hidden = false;
    host.style.maxHeight = `${window.innerHeight - 12}px`; host.style.overflowY = 'visible';
    host.style.left = `${x}px`; host.style.top = `${y}px`;
    const rect = host.getBoundingClientRect();
    if (host.scrollHeight > window.innerHeight - 12) host.style.overflowY = 'auto';
    host.style.left = `${Math.max(6, Math.min(x, window.innerWidth - rect.width - 6))}px`;
    host.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))}px`;
    opener?.setAttribute('aria-expanded', 'true');
  }

  for (const [index, menu] of menuSpec.entries()) {
    const button = document.createElement('button'); button.textContent = menu.label; button.type = 'button';
    button.setAttribute('role', 'menuitem'); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.dataset.menu = String(index);
    const open = () => { const rect = button.getBoundingClientRect(); const context = menuContext(); showMenu(mainMenuItems(menu.items, context), rect.left, rect.bottom, context, button); };
    button.onclick = () => button.getAttribute('aria-expanded') === 'true' ? closeMenus() : open();
    button.onmouseenter = () => { if (!$('menu-popup').hidden && button.getAttribute('aria-expanded') !== 'true') open(); };
    button.onkeydown = event => {
      if (['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(); $('menu-popup').querySelector('button:not(:disabled)')?.focus(); }
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const buttons = [...$('menu-items').children]; buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
    };
    $('menu-items').append(button);
  }
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.menu-popup, .menubar, #file-menu, #sidebar-footer')) closeMenus(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('sidebar-files-menu').hidden) { event.preventDefault(); closeMenus(); $('sidebar-menu').focus({ preventScroll: true }); return; }
    const unibody = document.body.classList.contains('window-unibody');
    if (unibody && event.key === 'Escape' && !fileMenu.hidden) { event.preventDefault(); closeMenus(); view.focus(); return; }
    const index = ['f', 'e', 'p', 'o', 'v', 't', 'h'].indexOf(event.key.toLowerCase());
    if (unibody && event.altKey && !event.ctrlKey && !event.shiftKey && index >= 0) {
      event.preventDefault();
      if (index === 0) showFileMenu();
      else { const context = menuContext(); showMenu(mainMenuItems(menuSpec[index].items, context), 0, 28, context); }
      return;
    }
    if (event.key === 'Escape' && (!$('menu-popup').hidden || !$('context-menu').hidden)) { event.preventDefault(); closeMenus(); (menuOpener || view.contentDOM).focus(); }
    if (event.key === 'F10' || (event.altKey && event.key === 'm')) {
      event.preventDefault();
      if (unibody) { const context = menuContext(); showMenu(menuSpec.map(menu => ({ ...menu, items: mainMenuItems(menu.items, context) })), 0, 28, context); $('menu-popup').querySelector('button')?.focus(); }
      else $('menu-items').firstElementChild?.focus();
    }
  });
  $('menubar').addEventListener('contextmenu', event => {
    if (!document.body.classList.contains('window-unibody') || event.target.closest('#window-controls')) return;
    event.preventDefault(); const context = menuContext(); showMenu(menuSpec.map(menu => ({ ...menu, items: mainMenuItems(menu.items, context) })), event.clientX, event.clientY, context);
  });
  const shortcutItems = menuSpec.flatMap(function flatten(menu) { return menu.items ? menu.items.flatMap(flatten) : [menu]; }).filter(entry => entry.shortcut && entry.enabled !== false);
  window.addEventListener('keydown', event => {
    if (event.isComposing || $('command-dialog').open || $('preferences-dialog')?.open || $('quick-open-dialog')?.open) return;
    // Text fields retain their own copy/paste/undo behavior.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const command = shortcutItems.find(entry => {
      const parts = entry.shortcut.toLowerCase().split('+');
      const key = parts.at(-1);
      const code = { '=': 'Equal', '-': 'Minus', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight' }[key] || (/^[0-9]$/.test(key) ? `Digit${key}` : null);
      const matchesKey = event.key.toLowerCase() === key || code && event.code === code;
      return matchesKey && Boolean(event.ctrlKey || event.metaKey) === parts.includes('ctrl') && event.altKey === parts.includes('alt') && event.shiftKey === parts.includes('shift');
    });
    if (command) { event.preventDefault(); event.stopPropagation(); closeMenus(); run(command.id, menuContext()); }
  }, true);
  window.addEventListener('resize', closeMenus);
  document.querySelector('.document-scroll').addEventListener('scroll', () => { $('context-menu').hidden = true; $('context-menu').replaceChildren(); });

  function contextItems(context) {
    const selected = !view.state.selection.main.empty;
    const clipboard = [item('cut', '剪切', !selected), item('copy', '复制', !selected), item('paste', '粘贴')];
    const clipboardTools = { label: '剪切、复制、粘贴和删除选中内容', tools: [
      { ...item('cut', '剪切', !selected), symbol: '剪切', shortcut: 'Ctrl+X' }, { ...item('copy', '复制', !selected), symbol: '复制', shortcut: 'Ctrl+C' }, { ...item('paste', '粘贴'), symbol: '粘贴', shortcut: 'Ctrl+V' }, { ...item('delete-selection', '删除选中内容', !selected), symbol: '删除' }
    ] };
    if (context.spelling) return [...context.suggestions.map(word => ({ id: 'spelling-replace', label: word, context: { ...context.spelling, replacement: word } })), { id: 'spelling-learn', label: '加入词典', context: context.spelling }, separator, ...clipboard];
    if (!info.live) return clipboard;
    if (context.kind === 'table') return [
      item('insert-row-above', '上方插入行'), item('insert-row-below', '下方插入行'),
      item('insert-column-left', '左侧插入列'), item('insert-column-right', '右侧插入列'), separator,
      item('move-row-up', '上移该行', context.row <= 1), item('move-row-down', '下移该行', context.row === 0 || context.row >= context.bodyCount), item('move-column-left', '左移该列', context.column === 0), item('move-column-right', '右移该列', context.column >= context.columnCount - 1), separator,
      item('delete-row', '删除行', context.row === 0), item('delete-column', '删除列', context.columnCount === 1),
      { label: '对齐方式', items: [item('align-left', '左对齐'), item('align-center', '居中'), item('align-right', '右对齐')] }, separator,
      item('copy-table', '复制表格'), item('format-table', '格式化表格源码'), item('select-block', '选择表格'), item('delete-table', '删除表格')];
    if (context.kind === 'image') {
      const local = !/^(https?:|data:)/i.test(context.imageSource || '');
      const loaded = context.target?.complete && context.target?.naturalWidth > 0;
      return [
        ...(local ? [item('reveal-image', '打开图片位置…'), item('open-image', '打开图片…'), item('copy-image-to', '复制图片到…'), item('move-image-to', '重命名/移动到…')] : [item('open-image', '在浏览器中打开图片…')]),
        ...(loaded ? [item('upload-image', uploadPending ? '正在上传图片…' : '上传图片', uploadPending)] : []),
        { label: '缩放图片', items: [item('image-scale-50', '50%'), item('image-scale-80', '80%'), item('image-scale-100', '原始尺寸'), item('zoom-image', '适应编辑区')] },
        { label: '转换图片语法', items: [item('image-syntax-markdown', 'Markdown'), item('image-syntax-html', 'HTML')] },
        separator, item('edit-image', '编辑图片…'), item('copy-image-address', '复制图片地址'), item('delete-image', '删除图片'), ...(local ? [item('delete-image-file', '删除图片文件…')] : []), separator,
        clipboardTools, item('upload-image-settings', '图像偏好设置…')
      ];
    }
    if (context.kind === 'link') return [item('open-link', '打开链接'), item('copy-link-address', '复制链接地址'), item('edit-link', '编辑链接'), item('remove-link', '移除链接'), separator, ...clipboard];
    if (context.kind === 'code') return [item('copy-code', '复制代码块内容'), item('indent', '增加缩进'), item('outdent', '减少缩进'), separator, ...clipboard, separator, item('select-block', '选择代码块'), item('delete-block', '删除代码块')];
    return [clipboardTools, { label: '复制 / 粘贴为…', items: [item('copy-markdown', 'Markdown', !selected), item('copy-html', 'HTML 代码', !selected), item('paste-plain', '粘贴为纯文本')] }, separator,
      { label: '行内格式', tools: [{ ...item('bold', '加粗'), symbol: 'B', shortcut: 'Ctrl+B' }, { ...item('italic', '斜体'), symbol: 'I', shortcut: 'Ctrl+I' }, { ...item('inline-code', '代码'), symbol: '</>' }, { ...item('link', '超链接'), symbol: '链接', shortcut: 'Ctrl+K' }] },
      { label: '引用与列表', tools: [{ ...item('quote', '引用'), symbol: '引用' }, { ...item('ordered-list', '有序列表'), symbol: '1.' }, { ...item('bullet-list', '无序列表'), symbol: '•' }, { ...item('task-list', '任务列表'), symbol: '☑' }] },
      ...(context.isQuote || /^\s*(?:[-+*]|\d+[.)])\s/.test(view.state.doc.line(context.line + 1).text) ? [{ label: '调整缩进', tools: [{ ...item('outdent', '减少缩进'), symbol: '←' }, { ...item('indent', '增加缩进'), symbol: '→' }] }] : []), separator,
      { label: '段落', items: [...Array.from({ length: 6 }, (_, i) => item(`heading-${i + 1}`, `标题 ${i + 1}`)), item('paragraph', '正文')] },
      { label: '插入', items: [item('image', '图像'), item('footnote', '脚注'), item('reference-link', '链接引用'), item('horizontal-rule', '水平分割线'), item('table', '表格'), item('code-block', '代码块'), item('math-block', '公式块'), item('toc', '目录'), item('front-matter', 'YAML'), separator, item('insert-paragraph-before', '段落（之前）'), item('insert-paragraph-after', '段落（之后）')] }, separator,
      item('delete-block', context.isQuote ? '删除引用' : '删除段落')];
  }
  view.dom.addEventListener('contextmenu', async event => {
    event.preventDefault();
    let context = getEditorContext(view, event);
    if (context.kind === 'image') context = resolveImageContext(view, context, event.target.closest('img'));
    context.target = event.target.closest('img');
    context.columnCount = event.target.closest('table')?.rows[0]?.cells.length;
    context.bodyCount = (event.target.closest('table')?.rows.length || 1) - 1;
    const spelling = event.target.closest('[data-spelling-word]');
    if (spelling) {
      const doc = view.state.doc;
      context.spelling = { word: spelling.dataset.spellingWord, from: Number(spelling.dataset.spellingFrom), to: Number(spelling.dataset.spellingTo), doc };
      try { context.suggestions = await desktop.spellingSuggestions(context.spelling.word); }
      catch (error) { actions.notify(`拼写建议加载失败：${error.message}`); return; }
      if (doc !== view.state.doc) return;
    }
    lastContext = { ...context, doc: view.state.doc, selection: view.state.selection };
    showMenu(contextItems(context), event.clientX, event.clientY, context, null, true);
  });
  $('outline').addEventListener('contextmenu', event => {
    event.preventDefault();
    const entries = [item('outline-highlight', '高亮当前标题'), separator, item('outline-filter', '查找')];
    if (outlineFilter.hidden) {
      if (collapsibleOutline) entries.push(separator, item('outline-expand', '全部展开'), item('outline-collapse', '全部折叠'));
      entries.push(separator, item('outline-collapsible', '大纲视图（可折叠）'), item('outline-flat', '大纲视图（无折叠）'));
    }
    showMenu(entries, event.clientX, event.clientY, { kind: 'outline' }, null, true);
  });

  function ask(title, fields) {
    return new Promise(resolve => {
      const dialog = $('command-dialog'); $('dialog-title').textContent = title; $('dialog-fields').replaceChildren();
      for (const field of fields) {
        const label = document.createElement('label'); label.textContent = field.label;
        const input = document.createElement('input'); input.name = field.name; input.type = field.type || 'text'; input.value = field.value ?? ''; input.required = Boolean(field.required);
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        label.append(input); $('dialog-fields').append(label);
      }
      const closed = () => {
        const values = dialog.returnValue === 'ok' ? Object.fromEntries([...dialog.querySelectorAll('input')].map(input => [input.name, input.type === 'number' ? Number(input.value) : input.value])) : null;
        resolve(values); view.focus();
      };
      dialog.addEventListener('close', closed, { once: true }); dialog.returnValue = 'cancel'; dialog.showModal(); dialog.querySelector('input')?.focus();
    });
  }

  function showSidebar(tab) {
    sidebarTab = tab; document.body.classList.remove('sidebar-hidden');
    preferences.updateAppearance({ sidebar: true });
    for (const name of ['files', 'outline']) { $(`panel-${name}`).hidden = name !== tab; $(`tab-${name}`).setAttribute('aria-selected', String(name === tab)); }
    $('sidebar-footer').hidden = tab !== 'files' || !$('folder-search').hidden;
    closeMenus();
  }
  for (const tab of ['files', 'outline']) $(`tab-${tab}`).onclick = () => showSidebar(tab);
  $('show-sidebar').onclick = () => run('sidebar');
  $('mode-label').onclick = () => { statistics.hidden = true; actions.setMode(!info.live); };

  function libraryMenu(entry) {
    const root = entry.path === folderRoot, directory = entry.isDirectory;
    if (folderMatches !== null) return [item('open-selected-file', '打开'), item('open-library-window', '在新窗口中打开'), ...(libraryUndoLabel ? [item('undo-library-operation', `撤销 ${libraryUndoLabel}`), separator] : []), item('new-library-file', '新建文件'), item('new-library-folder', '新建文件夹'), separator, item('search-folder', '搜索'), separator, item('copy-file-path', '复制文件路径'), item('reveal-selected-file', '打开文件位置'), separator, item('search-expand-all', '全部展开'), item('search-collapse-all', '全部折叠')];
    const entries = [ ...(!directory ? [item('open-selected-file', '打开')] : []), item('open-library-window', '在新窗口中打开') ];
    if (!root) entries.push(separator);
    if (libraryUndoLabel) entries.push(item('undo-library-operation', `撤销 ${libraryUndoLabel}`), separator);
    entries.push(item('new-library-file', '新建文件'));
    entries.push(item('new-library-folder', '新建文件夹'));
    entries.push(separator, item('search-folder', '搜索'), separator, item('file-list', '文档列表'), item('file-tree', '文档树'));
    if (!root) {
      entries.push(separator, item('rename-library-entry', '重命名'));
      if (!directory) entries.push(item('duplicate-library-file', '创建副本'));
      entries.push(separator, item('delete-library-entry', '删除'), separator, item('properties-library-entry', '属性'));
    } else entries.push(separator);
    entries.push(item('copy-file-path', '复制文件路径'), item('reveal-selected-file', '打开文件位置'));
    return entries;
  }
  function fileButton(entry, depth) {
    const button = document.createElement('button'); button.className = 'file-entry'; button.setAttribute('role', 'treeitem');
    const root = treeMode && folderMatches === null && entry.path === folderRoot;
    button.style.paddingLeft = `${8 + depth * 8}px`; button.dataset.path = entry.path; button.setAttribute('aria-level', String(depth + 1)); button.classList.toggle('file-root', root);
    button.classList.toggle('current', entry.path === info.path);
    if (!root) { const caret = document.createElement('span'); caret.className = 'file-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = entry.isDirectory ? expanded.has(entry.path) ? '▾' : '▸' : ''; button.append(caret); }
    const icon = document.createElement('i'); icon.className = 'file-node-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = uiIcon(entry.isDirectory ? 'folder' : 'file');
    const name = document.createElement('span'); name.className = 'file-entry-name';
    const extension = !entry.isDirectory ? entry.name.lastIndexOf('.') : -1;
    name.append(extension < 0 ? entry.name : entry.name.slice(0, extension));
    if (extension >= 0) { const suffix = document.createElement('span'); suffix.className = 'file-entry-extension'; suffix.textContent = entry.name.slice(extension); name.append(suffix); }
    button.append(icon, name);
    button.title = entry.path;
    if (entry.isDirectory) button.setAttribute('aria-expanded', String(root || expanded.has(entry.path)));
    button.onclick = async event => {
      if (event.ctrlKey || event.metaKey) return run('open-library-window', { file: entry });
      if (root) return;
      if (entry.isDirectory) {
        if (expanded.has(entry.path)) expanded.delete(entry.path);
        else {
          const result = await desktop?.listFolder(entry.path);
          if (result?.status) { actions.notify(result.message || '无法读取文件夹'); return; }
          folders.set(entry.path, result.entries); expanded.add(entry.path);
        }
        drawFiles();
      } else await actions.openPath(entry.path);
    };
    button.oncontextmenu = event => { event.preventDefault(); showMenu(libraryMenu(entry), event.clientX, event.clientY, { file: entry, library: true }, null, true); button.classList.add('context-selected'); button.focus({ preventScroll: true }); };
    return button;
  }
  function drawFiles() {
    $('file-tree').replaceChildren();
    $('file-tree').classList.toggle('tree-mode', treeMode && folderMatches === null);
    $('folder-empty').hidden = Boolean(folderRoot);
    $('sidebar-new-file').hidden = $('sidebar-switch-view').hidden = !folderRoot;
    $('sidebar-folder-label').textContent = folderRoot?.split(/[\\/]/).filter(Boolean).pop() || '打开文件夹…';
    $('sidebar-folder-label').toggleAttribute('data-i18n-ignore', Boolean(folderRoot));
    $('sidebar-menu').title = folderRoot || '打开文件夹…';
    $('sidebar-footer').classList.toggle('file-tree-mode', treeMode && Boolean(folderRoot));
    $('sidebar-switch-view').innerHTML = treeMode ? sidebarList : sidebarTree;
    $('sidebar-switch-view').title = treeMode ? '切换为文件列表' : '切换为文件树';
    $('sidebar-switch-view').setAttribute('aria-label', $('sidebar-switch-view').title);
    if (folderMatches !== null) {
      for (const match of folderMatches) {
        const button = fileButton(match, 0); $('file-tree').append(button);
        for (const hit of match.hits) {
          const line = document.createElement('button'); line.className = 'folder-search-hit'; line.textContent = `${hit.line}: ${hit.text}`; line.title = hit.text;
          line.onclick = async () => { await actions.openPath(match.path); if (info.path !== match.path) return; const pos = view.state.doc.line(Math.min(hit.line, view.state.doc.lines)).from; view.dispatch({ selection: { anchor: pos }, scrollIntoView: true }); view.focus(); }; $('file-tree').append(line);
        }
      }
      return;
    }
    function append(entries, depth) {
      for (const entry of sortFiles(entries || [], fileOptions())) {
        $('file-tree').append(fileButton(entry, depth));
        if (expanded.has(entry.path)) append(folders.get(entry.path), depth + 1);
      }
    }
    if (treeMode && folderRoot) { $('file-tree').append(fileButton({ path: folderRoot, name: folderRoot.split(/[\\/]/).filter(Boolean).pop() || folderRoot, isDirectory: true }, 0)); append(folders.get(folderRoot), 1); }
    else {
      let parent;
      const entries = sortFiles(listFiles, fileOptions());
      if (fileOptions().group) entries.sort((a, b) => a.path.slice(0, -a.name.length).localeCompare(b.path.slice(0, -b.name.length)));
      for (const entry of entries) {
        const directory = entry.path.slice(0, -entry.name.length);
        if (fileOptions().group && parent !== directory) { const label = document.createElement('div'); label.className = 'file-list-folder'; label.textContent = directory.slice(folderRoot.length).replace(/^[\\/]|[\\/]$/g, '') || '.'; $('file-tree').append(label); parent = directory; }
        const button = fileButton(entry, 0); button.classList.add('file-list-entry'); $('file-tree').append(button);
      }
    }
  }
  $('folder-open').onclick = () => run('open-folder');
  $('sidebar-new-file').innerHTML = sidebarNew; $('sidebar-more-icon').innerHTML = sidebarMore;
  $('sidebar-new-file').onclick = () => run('new-library-file');
  $('sidebar-switch-view').onclick = () => run(treeMode ? 'file-list' : 'file-tree');
  $('sidebar-menu').onmousedown = event => event.preventDefault();
  $('sidebar-menu').onclick = () => $('sidebar-files-menu').hidden ? showFolderMenu() : closeMenus();
  $('sidebar-files-menu').onmousedown = event => { if (event.target.closest('button')) event.preventDefault(); };
  $('sidebar-files-menu').onfocusout = event => { if (!$('sidebar-files-menu').contains(event.relatedTarget)) closeMenus(); };
  $('folder-search-close').onclick = () => { folderSearchVersion++; clearTimeout(searchTimer); $('folder-search').hidden = true; $('sidebar-footer').hidden = sidebarTab !== 'files'; $('folder-search-input').value = ''; folderMatches = null; drawFiles(); view.focus(); };
  $('folder-search-input').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); $('folder-search-close').click(); } };
  $('folder-search-input').oninput = () => { clearTimeout(searchTimer); const version = ++folderSearchVersion; searchTimer = setTimeout(async () => {
    $('folder-search-status').textContent = '搜索中…';
    try { const matches = await desktop.searchFolder($('folder-search-input').value); if (version !== folderSearchVersion) return; if (matches.status) throw Error(matches.message); folderMatches = $('folder-search-input').value.trim() ? matches : null; $('folder-search-status').textContent = folderMatches ? `${matches.length} 个文件，${matches.reduce((count, match) => count + match.hits.length, 0)} 处匹配` : ''; drawFiles(); }
    catch (error) { if (version === folderSearchVersion) $('folder-search-status').textContent = error.message; }
  }, 200); };

  async function showFolderMenu() {
    closeMenus(); const version = folderMenuVersion, host = $('sidebar-files-menu');
    host.replaceChildren(); host.hidden = false; $('sidebar-menu').setAttribute('aria-expanded', 'true'); $('sidebar-footer').classList.add('menu-open'); host.focus({ preventScroll: true });
    function label(text, close = false) { const row = document.createElement('div'); row.className = 'sidebar-menu-label'; row.textContent = text; host.append(row); if (close) { const button = document.createElement('button'); button.innerHTML = sidebarClose; button.setAttribute('aria-label', '关闭文件夹菜单'); button.onclick = closeMenus; row.append(button); } return row; }
    function command(id, text, action) { const button = document.createElement('button'); button.dataset.command = id; button.textContent = text; button.setAttribute('role', 'menuitem'); button.onclick = () => { closeMenus(); action ? action() : run(id); }; host.append(button); return button; }
    if (folderRoot) {
      label('操作', true);
      for (const [id, text] of [['new-library-file', '新建文件'], ['search-folder', '搜索'], ['reveal-folder', '在资源管理器中显示'], ['open-folder', '打开文件夹…'], ['refresh-files', '刷新']]) command(id, text);
      const row = label('排序'), tools = document.createElement('span'); tools.className = 'sidebar-sort-tools'; row.append(tools);
      for (const [key, title, icon] of [['group', '按文件夹分组', sidebarGroup], ['natural', '自然排序', sidebarNatural], ['name', '按文件名排序', sidebarName], ['modified', '按修改时间排序', sidebarModified], ['created', '按创建时间排序', sidebarCreated]]) {
        const button = document.createElement('button'), options = fileOptions(), active = key === 'group' ? options.group : options.sort === key;
        button.dataset.sort = key; button.innerHTML = icon; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(Boolean(active))); button.title = key === 'group' ? title : `${title}（${options.descending && active ? '降序' : '升序'}）`; button.setAttribute('aria-label', button.title);
        if (key !== 'group' && options.descending && active) button.innerHTML = ({ natural: sidebarNaturalDesc, name: sidebarNameDesc, modified: sidebarModifiedDesc, created: sidebarCreatedDesc })[key];
        button.onclick = () => { if (key === 'group') options.group = !options.group; else { options.descending = active ? !options.descending : false; options.sort = key; } localStorage.setItem('inkslip-file-views', JSON.stringify(fileViews)); drawFiles(); showFolderMenu(); }; tools.append(button);
      }
    }
    const locationLabel = !folderRoot ? label('目录') : null;
    if (!folderRoot) command('open-folder', '打开文件夹…');
    const history = await desktop?.recentFolders?.();
    if (host.hidden || version !== folderMenuVersion) return;
    if (history?.status === 'error') actions.notify(history.message);
    if (Array.isArray(history) && history.length) {
      const recentLabel = label('最近使用的目录'); host.insertBefore(recentLabel, locationLabel);
      const current = history.find(folder => folder.path === folderRoot);
      const rowHeight = host.querySelector('[data-command]')?.getBoundingClientRect().height || 24;
      const limit = Math.max(0, Math.min(6, Math.floor(($('panel-files').clientHeight - host.clientHeight - (current ? rowHeight : 0) - 20) / rowHeight)));
      const visible = history.filter(folder => folder !== current).slice(0, limit); if (current) visible.push(current);
      if (!visible.length) recentLabel.remove();
      for (const folder of visible) {
        const row = document.createElement('div'); row.className = 'sidebar-recent-folder'; row.classList.toggle('current', folder.path === folderRoot); row.dataset.pinned = String(Boolean(folder.pinned)); host.insertBefore(row, locationLabel);
        const open = document.createElement('button'), name = document.createElement('span'), folderIcon = document.createElement('i'); folderIcon.className = 'sidebar-folder-glyph'; folderIcon.innerHTML = uiIcon('folder'); folderIcon.setAttribute('aria-hidden', 'true'); name.textContent = folder.name; open.append(folderIcon, name); open.title = folder.path; open.setAttribute('role', 'menuitem'); open.dataset.path = folder.path; open.onclick = () => { closeMenus(); run('open-folder', { path: folder.path }); }; row.append(open);
        for (const [action, text] of [['pin', folder.pinned ? '取消固定' : '固定'], ['remove', '移除最近位置']]) {
          const button = document.createElement('button'), icon = document.createElement('i'); icon.className = 'sidebar-folder-glyph'; icon.innerHTML = uiIcon(action); icon.setAttribute('aria-hidden', 'true'); button.append(icon); button.className = `sidebar-folder-${action}`; button.title = text; button.setAttribute('aria-label', text); button.onclick = async () => { const result = await desktop.recentFolders({ path: folder.path, action }); if (result.status) actions.notify(result.message); else showFolderMenu(); }; row.append(button);
        }
      }
    }
  }

  async function refreshFiles() {
    if (!folderRoot) return;
    for (const path of [folderRoot, ...expanded]) { const result = await desktop.listFolder(path); if (!result.status) folders.set(path, result.entries); else { expanded.delete(path); folders.delete(path); } }
    const result = await desktop.scanFolder(); if (Array.isArray(result)) listFiles = result;
    drawFiles();
    if (!$('folder-search').hidden) $('folder-search-input').oninput();
  }
  function editLibraryName(file, directory = false, creating = false) {
    const button = [...$('file-tree').querySelectorAll('.file-entry')].find(node => node.dataset.path === file);
    if (!button) return;
    const input = document.createElement('input'); input.className = 'file-rename'; input.setAttribute('aria-label', creating ? directory ? '新文件夹名称' : '新文件名称' : '重命名'); input.value = file.split(/[\\/]/).pop(); button.querySelector('.file-entry-name').replaceWith(input); input.focus(); input.setSelectionRange(0, directory ? input.value.length : input.value.lastIndexOf('.'));
    let committed = false;
    async function commit() {
      if (committed) return; committed = true;
      const result = await desktop.renameLibraryFile({ path: file, name: input.value });
      if (result.status === 'error') actions.notify(result.message);
      else { if (result.undoLabel) libraryUndoLabel = result.undoLabel; if (result.documentPath && result.documentPath !== info.path) actions.renamePath(result.documentPath); if (directory && expanded.delete(file)) expanded.add(result.path); }
      await refreshFiles();
    }
    input.onkeydown = event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); commit(); } else if (event.key === 'Escape') { event.preventDefault(); committed = true; drawFiles(); view.focus(); } };
    input.onclick = event => event.stopPropagation(); input.onblur = commit;
  }
  async function revealCreatedEntry(file) {
    const parent = file.slice(0, Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')));
    if (parent !== folderRoot) expanded.add(parent);
    await refreshFiles();
  }
  drawFiles();
  preferences.ready.then(async () => {
    const result = await desktop?.startupDocument?.();
    if (!result) return;
    if (result.status === 'error') { actions.notify(result.message); return; }
    folderRoot = result.root; folders.set(folderRoot, result.entries); showSidebar('files'); actions.loadDocument(result.document); drawFiles();
  }).catch(error => actions.notify(error.message));

  async function exportDocument(format) {
    const rendered = renderDocument(view.state.sliceDoc(), { showBrMarkers: false }).html;
    const template = document.createElement('template'); template.innerHTML = DOMPurify.sanitize(rendered);
    if (info.path) {
      for (const img of template.content.querySelectorAll('img')) {
        const source = img.getAttribute('src') || '';
        if (!/^(https?:|data:)/i.test(source)) img.setAttribute('src', resolveImageSource(source, info.path, getImageRoot(view.state)));
      }
    }
    const css = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; } }).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: https: http:; style-src 'unsafe-inline'; font-src file: data:"><style>${css}\nbody {overflow:visible;margin:40px;background:white;color:#333} .md-rendered {max-width:800px;margin:auto} pre {white-space:pre-wrap}</style></head><body><article class="md-rendered">${template.innerHTML}</article></body></html>`;
    const result = await desktop?.exportDocument({ format, html });
    if (!result) actions.notify('请使用桌面版导出或打印');
    else if (result.status === 'error') actions.notify(result.message);
    else if (result.status !== 'cancelled') actions.notify(result.path ? `已导出：${result.path}` : '已发送到打印机');
  }

  async function quickOpen() {
    await preferences.ready;
    const quick = document.createElement('dialog'); quick.id = 'quick-open-dialog';
    quick.innerHTML = '<input type="search" placeholder="搜索最近文件或已打开文件夹" aria-label="快速打开"><div class="quick-open-results"></div><button class="quick-open-close">取消</button>';
    document.body.append(quick);
    const candidates = [...new Set([...recentDocuments, ...[...folders.values()].flat().filter(entry => !entry.isDirectory).map(entry => entry.path)])];
    function draw() {
      const query = quick.querySelector('input').value.toLocaleLowerCase();
      const host = quick.querySelector('.quick-open-results'); host.replaceChildren();
      for (const path of candidates.filter(path => path.toLocaleLowerCase().includes(query))) {
        const button = document.createElement('button'); button.textContent = path.split(/[\\/]/).pop(); button.title = path;
        button.onclick = async () => { quick.close(); if (recentDocuments.includes(path)) await run('open-recent', { path }); else await actions.openPath(path); }; host.append(button);
      }
      if (!host.children.length) host.textContent = '没有匹配的文件';
    }
    quick.querySelector('input').oninput = draw;
    quick.querySelector('input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); quick.querySelector('.quick-open-results button')?.click(); } };
    quick.querySelector('.quick-open-close').onclick = () => quick.close();
    quick.addEventListener('close', () => { quick.remove(); view.focus(); }, { once: true });
    draw(); quick.showModal(); quick.querySelector('input').focus();
  }

  async function run(id, context = {}) {
    try {
      if (importing) { actions.notify('正在导入文档，请稍候'); return; }
      if (themeId(id) || id === 'theme-select') return await preferences.setTheme(context.theme || themeId(id));
      if (editingSettings[id]) return await preferences.updateAppearance({ [editingSettings[id]]: !preferences.getPreferences().appearance[editingSettings[id]] });
      switch (id) {
        case 'punctuation-input': case 'punctuation-rendering': return await preferences.updateAppearance({ convertSmartOnRender: id === 'punctuation-rendering' });
        case 'spelling-replace':
          if (context.doc !== view.state.doc || view.state.doc.sliceString(context.from, context.to) !== context.word) return;
          view.dispatch({ changes: { from: context.from, to: context.to, insert: context.replacement }, selection: { anchor: context.from + context.replacement.length }, userEvent: 'input.spelling' }); view.focus(); return;
        case 'spelling-learn': await desktop.learnSpelling(context.word); document.dispatchEvent(new CustomEvent('inkslip-preferences-changed', { detail: preferences.getPreferences() })); return;
        case 'file-properties': { const result = await desktop?.fileProperties(); if (result?.message) actions.notify(result.message); return; }
        case 'import-doc': {
          importing = true;
          view.dispatch({ effects: (importLock.get(view.state) === undefined ? StateEffect.appendConfig.of(importLock.of([EditorState.readOnly.of(true), EditorView.editable.of(false)])) : importLock.reconfigure([EditorState.readOnly.of(true), EditorView.editable.of(false)])) });
          const progress = document.createElement('div'); progress.id = 'document-import-progress'; progress.className = 'document-conversion-progress'; progress.innerHTML = '<div class="image-upload-panel"><span class="image-upload-spinner" aria-hidden="true"></span><span>正在导入文档…</span></div>'; document.body.append(progress);
          try {
            const result = await desktop?.convertDocument({ action: 'import' });
            if (result?.content !== undefined) actions.loadDocument(result);
            if (result?.warnings || result?.message) actions.notify(result.warnings || result.message);
          } finally { progress.remove(); importing = false; if (importLock.get(view.state) !== undefined) view.dispatch({ effects: importLock.reconfigure([]) }); }
          return;
        }
        case 'export-docx': {
          const result = await desktop?.convertDocument({ action: 'export-docx', markdown: view.state.sliceDoc() });
          if (result?.status === 'ok') actions.notify(result.warnings ? `Word 已导出，提示：${result.warnings}` : 'Word 已导出');
          else if (result?.message) actions.notify(result.message); return;
        }
        case 'devtools': return await desktop?.windowAction('devtools');
        case 'delete-image-file': return await imagePolicies.run('delete', context);
        case 'copy-all-images': return await imagePolicies.run('copy');
        case 'move-all-images': return await imagePolicies.run('move');
        case 'insert-image-policy-copy': case 'insert-image-policy-upload': return await imagePolicies.choosePolicy(id.endsWith('copy') ? 'copy' : 'upload');
        case 'image-root': return await imagePolicies.setRoot();
        case 'theme-folder': return await desktop?.openThemesFolder?.();
        case 'theme-reload': return await preferences.reloadThemes();
        case 'quick-open': return await quickOpen();
        case 'open-recent': case 'reopen-closed': {
          const result = await desktop?.documentOperation({ action: 'open-recent', path: id === 'reopen-closed' ? lastClosedPath || recentDocuments[0] : context.path });
          if (result?.content !== undefined) actions.loadDocument(result); else if (result?.message) actions.notify(result.message); return;
        }
        case 'clear-recent': await desktop?.documentOperation({ action: 'clear-recent' }); recentDocuments = []; return;
        case 'save-all': return await actions.saveFile();
        case 'duplicate-file': case 'rename-file': case 'delete-file': {
          const result = await desktop?.documentOperation({ action: id === 'duplicate-file' ? 'duplicate' : id === 'rename-file' ? 'rename' : 'delete' });
          if (result?.content !== undefined) actions.loadDocument(result); else if (result?.message) actions.notify(result.message); return;
        }
        case 'show-in-sidebar': showSidebar('files'); drawFiles(); return;
        case 'eol-crlf': case 'eol-lf': actions.setLineSeparator(id === 'eol-crlf' ? '\r\n' : '\n'); return;
        case 'ensure-final-newline': localStorage.setItem('inkslip-final-newline', String(localStorage.getItem('inkslip-final-newline') !== 'true')); return;
        case 'math-refresh': case 'reload-images': {
          actions.setMode(false); actions.setMode(true); actions.notify(id === 'math-refresh' ? '数学公式已刷新' : '图片已重新加载'); return;
        }
        case 'copy-image-content': {
          const result = await desktop?.copyImageContent({ source: resolveImageSource(context.imageSource || context.href, info.path, getImageRoot(view.state)), documentPath: info.path });
          actions.notify(result?.status === 'ok' ? '图片已复制' : result?.message || '无法复制图片'); return;
        }
        case 'upload-images': {
          if (uploadPending) return;
          uploadPending = true; uploadOverlay.hidden = false;
          const documentId = info.path;
          const sources = [...new Set(imageSources(view.state).filter(image => !/^https?:/i.test(image.href)).map(image => image.href))];
          try {
            let count = 0;
            for (const source of sources) {
              while (documentId === info.path) {
                const image = imageSources(view.state).find(image => image.href === source);
                if (!image) break;
                const result = await uploadSelectedImage({ imageInlineFrom: image.inlineFrom });
                if (result.status !== 'ok') return;
                count++;
              }
            }
            actions.notify(count ? `已上传 ${count} 张本地图片并替换地址` : '没有需要上传的本地图片');
          } finally { uploadPending = false; uploadOverlay.hidden = true; }
          return;
        }
        case 'paste': {
          if (desktop?.readClipboardImages && await pasteImage()) return;
          return await editor(id, context);
        }
        case 'new': return await actions.newFile();
        case 'open': return await actions.openFile();
        case 'save': return await actions.saveFile();
        case 'save-as': return await actions.saveFile(true);
        case 'close': case 'fullscreen': case 'always-on-top': return await desktop?.windowAction(id);
        case 'zoom-in': case 'zoom-out': case 'zoom-reset': {
          const level = preferences.getPreferences().appearance.zoomLevel;
          return await preferences.updateAppearance({ zoomLevel: id === 'zoom-reset' ? 0 : Math.max(-3, Math.min(6, level + (id === 'zoom-in' ? 1 : -1))) });
        }
        case 'source': return actions.setMode(!info.live);
        case 'focus': document.body.classList.toggle('focus-mode'); return;
        case 'typewriter': document.body.classList.toggle('typewriter-mode'); view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) }); return;
        case 'sidebar': document.body.classList.toggle('sidebar-hidden'); $('show-sidebar').setAttribute('aria-pressed', String(!document.body.classList.contains('sidebar-hidden'))); return;
        case 'statusbar': document.body.classList.toggle('statusbar-hidden'); return;
        case 'outline': showSidebar(id); return;
        case 'search': return await editor('find');
        case 'files': case 'files-tree': case 'files-list': case 'file-tree': case 'file-list':
          treeMode = !['files-list', 'file-list'].includes(id); showSidebar('files');
          if (!treeMode && folderRoot) { const result = await desktop.scanFolder(); if (result.status) actions.notify(result.message); else listFiles = result; }
          drawFiles(); return;
        case 'reveal-file': case 'reveal-selected-file': return await desktop?.revealFile(context.file?.path);
        case 'copy-file-path': return await desktop?.writeClipboard(context.file.path);
        case 'open-selected-file': return await actions.openPath(context.file.path);
        case 'open-folder': {
          const result = await desktop?.openFolder(context.path);
          if (!result) { actions.notify('请使用桌面版打开文件夹'); return; }
          if (result.status) { if (result.status === 'error') actions.notify(result.message); return; }
          folderSearchVersion++; clearTimeout(searchTimer); folderMatches = null; $('folder-search').hidden = true; $('folder-search-input').value = '';
          folderRoot = result.root; libraryUndoLabel = null; folders.clear(); expanded.clear(); listFiles = []; folders.set(folderRoot, result.entries); showSidebar('files');
          if (!treeMode) { const files = await desktop.scanFolder(); if (!files.status) listFiles = files; }
          drawFiles(); return;
        }
        case 'refresh-files': return await refreshFiles();
        case 'reveal-folder': { const result = await desktop.openLibraryFolder(); if (result.status === 'error') actions.notify(result.message); return; }
        case 'search-folder': if (context.library && !$('folder-search').hidden) { $('folder-search-close').click(); return; } showSidebar('files'); $('folder-search').hidden = false; $('sidebar-footer').hidden = true; $('folder-search-input').focus(); return;
        case 'search-expand-all': case 'search-collapse-all': $('file-tree').querySelectorAll('.folder-search-hit').forEach(node => { node.hidden = id === 'search-collapse-all'; }); return;
        case 'rename-library-entry': editLibraryName(context.file.path, context.file.isDirectory); return;
        case 'open-library-window': case 'properties-library-entry': {
          const result = await desktop.libraryOperation({ action: id === 'open-library-window' ? 'open-window' : 'properties', path: context.file.path });
          if (result.status === 'error') actions.notify(result.message); return;
        }
        case 'undo-library-operation': case 'new-library-folder': case 'duplicate-library-file': case 'delete-library-entry': {
          const operation = { 'undo-library-operation': 'undo', 'new-library-folder': 'new-folder', 'duplicate-library-file': 'duplicate', 'delete-library-entry': 'delete' }[id];
          const result = await desktop.libraryOperation({ action: operation, path: context.file?.path || folderRoot });
          if (result.status === 'error') { actions.notify(result.message); return; } if (result.status === 'cancelled') return;
          libraryUndoLabel = null;
          if (result.document) actions.loadDocument(result.document);
          else if (result.documentPath && result.documentPath !== info.path) actions.renamePath(result.documentPath);
          if (['new-folder', 'duplicate'].includes(operation)) { await revealCreatedEntry(result.path); editLibraryName(result.path, operation === 'new-folder', true); }
          else { await refreshFiles(); }
          return;
        }
        case 'new-library-file': {
          const result = await desktop.newLibraryFile(context.file?.path);
          if (result.status === 'error') { actions.notify(result.message); return; }
          libraryUndoLabel = null;
          if (result.status !== 'created') actions.loadDocument(result);
          await revealCreatedEntry(result.path); editLibraryName(result.path, false, true); return;
        }
        case 'outline-collapse': case 'outline-expand':
          collapsedHeadings.clear();
          if (id === 'outline-collapse') $('outline').querySelectorAll('.outline-item').forEach(row => collapsedHeadings.add(row.dataset.outlineId));
          updateOutline(); return;
        case 'outline-collapsible': case 'outline-flat':
          collapsibleOutline = id === 'outline-collapsible'; collapsedHeadings.clear();
          localStorage.setItem('inkslip-outline-collapsible', String(collapsibleOutline)); updateOutline(); return;
        case 'outline-filter': toggleOutlineFilter(); return;
        case 'outline-highlight': {
          const active = $('outline').querySelector('.active');
          if (active) {
            const rows = [...$('outline').querySelectorAll('.outline-item')]; let level = Number(active.dataset.level);
            for (let index = rows.indexOf(active) - 1; index >= 0; index--) if (Number(rows[index].dataset.level) < level) { collapsedHeadings.delete(rows[index].dataset.outlineId); level = Number(rows[index].dataset.level); }
            updateOutline(); active.scrollIntoView({ block: 'center' });
          }
          return;
        }
        case 'open-image': return /^https?:/i.test(context.imageSource) ? await desktop?.openLink(context.imageSource) : await desktop?.imageFile({ action: 'open', source: resolveImageSource(context.imageSource, info.path, getImageRoot(view.state)), documentPath: info.path });
        case 'reveal-image': case 'copy-image-to': case 'move-image-to': {
          const document = view.state.doc, documentPath = info.path;
          const result = await desktop?.imageFile({ action: id === 'reveal-image' ? 'reveal' : id === 'copy-image-to' ? 'copy' : 'move', source: resolveImageSource(context.imageSource, documentPath, getImageRoot(view.state)), documentPath });
          if (result?.status === 'error') actions.notify(result.message);
          else if (result?.source) {
            if (document !== view.state.doc || documentPath !== info.path) actions.notify(`文件操作完成，文档已变化，请手动更新图片地址：${result.source}`);
            else replaceImageSource(view, context, imageSourceForRoot(result.source, documentPath, getImageRoot(view.state)));
          }
          return;
        }
        case 'image-syntax-markdown': case 'image-syntax-html': {
          if (!convertImageSyntax(view, context, id.endsWith('html') ? 'html' : 'markdown')) actions.notify('未转换图片语法：请检查图片原文，带尺寸或样式的 HTML 图片需保留 HTML 语法。');
          return;
        }
        case 'image-scale-25': case 'image-scale-33': case 'image-scale-50': case 'image-scale-67': case 'image-scale-80': case 'image-scale-100': case 'image-scale-150': case 'image-scale-200': {
          const width = context.target?.naturalWidth;
          if (width) scaleImage(view, context, width * Number(id.split('-').at(-1)) / 100);
          else actions.notify('图片尚未加载，无法确定缩放尺寸。');
          return;
        }
        case 'zoom-image': {
          const width = context.target?.naturalWidth;
          if (width) scaleImage(view, context, Math.min(width, view.contentDOM.clientWidth));
          return;
        }
        case 'delete-image': deleteImage(view, context); return;
        case 'export-html': return await exportDocument('html');
        case 'export-pdf': return await exportDocument('pdf');
        case 'print': return await exportDocument('print');
        case 'preferences': return await preferences.open();
        case 'upload-image-settings': return await preferences.open('image');
        case 'upload-image': {
          if (uploadPending) return;
          if (!desktop?.uploadImage) { actions.notify('请使用桌面版上传图片'); return; }
          uploadPending = true; uploadOverlay.hidden = false; context.target?.classList.add('md-image-uploading');
          try { return await uploadSelectedImage(context); }
          finally { uploadPending = false; uploadOverlay.hidden = true; context.target?.classList.remove('md-image-uploading'); }
        }
        case 'about': return await ask(`关于墨简 · Inkslip ${version}`, []);
        case 'help': case 'markdown-reference': {
          const result = await desktop?.openExample();
          if (result?.content !== undefined) actions.loadDocument(result);
          else actions.notify(result?.message || '帮助示例：examples/完整Markdown示例.md'); return;
        }
        case 'keyboard-shortcuts': return await ask('墨简快捷键：Ctrl+N 新建 · Ctrl+O 打开 · Ctrl+S 保存 · Ctrl+/ 源码 · Ctrl+Shift+L 侧栏 · Ctrl+P 快速打开 · Ctrl+F 查找 · Ctrl+Z 撤消', []);
        case 'changelog': return await ask(`墨简 ${version}：修正段间距、鼠标选字与可见行移动；补齐提示块和引用定义显示；文件栏底部新增文件夹菜单、新建、搜索、刷新、排序、视图切换及最近位置管理。`, []);
        case 'dependency-licenses': return await ask('墨简使用 Electron、CodeMirror、markdown-it、KaTeX、Mermaid、DOMPurify 和 iconv-lite 等开源组件；许可证保留在程序目录 node_modules 各组件中。', []);
        case 'word-count': drawStatistics(); statistics.hidden = !statistics.hidden; return;
        case 'link': case 'edit-link': {
          const values = await ask('超链接', [{ name: 'url', label: '链接地址', required: true, value: context.href || 'https://' }, { name: 'text', label: '显示文字', value: context.label || view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) }]);
          if (!values) return; context = { ...context, values }; break;
        }
        case 'edit-image': {
          const values = await ask('编辑图片', [{ name: 'source', label: '图片路径 / URL', required: true, value: context.imageSource || '' }, { name: 'alt', label: '替代文字', value: context.label || '' }]);
          if (!values) return; context = { ...context, values }; break;
        }
        case 'table': {
          const values = await ask('插入表格', [{ name: 'rows', label: '正文行数', type: 'number', min: 1, max: 100, value: 3 }, { name: 'columns', label: '列数', type: 'number', min: 1, max: 20, value: 3 }]);
          if (!values) return; context = { ...context, values }; break;
        }
      }
      if (Number.isInteger(context.from) && view.state.selection.main.empty && context.kind === 'text') {
        view.dispatch({ selection: { anchor: context.from } });
      }
      if (context.kind === 'code' && ['indent', 'outdent'].includes(id) && view.state.selection.main.empty) {
        const first = view.state.doc.lineAt(context.from);
        const last = view.state.doc.lineAt(context.to);
        const fenced = /^\s*(`{3,}|~{3,})/.test(first.text) && last.number > first.number;
        view.dispatch({ selection: { anchor: fenced ? first.to + 1 : context.from, head: fenced ? Math.max(first.to + 1, last.from - 1) : context.to } });
      }
      if (id === 'insert-local-image') id = 'image';
      if (id.startsWith('encoding-')) {
        const result = await desktop?.documentOperation({ action: 'reopen-encoding', encoding: id.slice(9) });
        if (result?.content !== undefined) actions.loadDocument(result); else if (result?.message) actions.notify(result.message); return;
      }
      let handled = await editor(id, context);
      if (handled?.prompt) {
        const values = handled.prompt === 'link'
          ? await ask('链接引用', [{ name: 'url', label: '链接地址', required: true, value: 'https://' }, { name: 'text', label: '显示文字', value: view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) }])
          : await ask('插入图片', [{ name: 'source', label: '图片路径 / URL', required: true }, { name: 'alt', label: '替代文字' }]);
        if (values) handled = await editor(id, { ...context, values });
      }
      if (handled === true && !['find', 'replace', 'find-next', 'find-previous'].includes(id)) view.focus();
    } catch (error) { actions.notify(`操作失败：${error.message}`); }
    finally {
      if (['sidebar', 'statusbar', 'focus', 'typewriter'].includes(id)) preferences.updateAppearance({ sidebar: !document.body.classList.contains('sidebar-hidden'), statusbar: !document.body.classList.contains('statusbar-hidden'), focus: document.body.classList.contains('focus-mode'), typewriter: document.body.classList.contains('typewriter-mode') });
      update(info);
    }
  }
  $('word-count').onclick = () => run('word-count');
  desktop?.onCommand((id, context) => run(id, { ...menuContext(), ...context }));
  view.dom.addEventListener('keyup', () => {
    if (document.body.classList.contains('typewriter-mode')) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
  });

  function update(nextInfo) {
    const previousPath = info.path; info = nextInfo;
    imagePolicies.sync();
    if (previousPath !== info.path) { if (previousPath) lastClosedPath = previousPath; desktop?.recentDocuments?.().then(files => { recentDocuments = files; }); }
    $('menu-document-title').classList.toggle('dirty', Boolean(info.dirty));
    const save = $('file-menu-nav').querySelector('[data-command="save"]'); save.textContent = info.dirty ? '保存' : '已保存　✓'; save.disabled = !info.dirty;
    if (previousPath !== info.path) collapsedHeadings.clear();
    updateOutline();
    if (previousPath !== info.path && folderRoot) drawFiles();
  }
  return { update, run };
}
