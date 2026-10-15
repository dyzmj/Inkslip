import localization from '../shared/i18n.cjs';

const { languages, resolveLanguage, translate } = localization;
let language = 'zh-CN';
export { languages };
export const t = text => {
  const translated = translate(text, language);
  return globalThis.window?.desktop?.platform === 'darwin' ? translated.replaceAll('Ctrl+', '⌘') : translated;
};

// Localize app chrome only. Document text and user-controlled names never enter
// the catalog lookup, even when a filename or heading equals a UI label.
const excluded = '#outline .outline-item, #file-name, .file-entry, .file-list-folder, .folder-search-hit, .file-menu-recent, .quick-open-results button, .sidebar-recent-folder > button:first-child, .theme-card, [name="appearance.theme"] option, [name="appearance.darkTheme"] option, [data-i18n-ignore], script, style, textarea';
const attributes = ['title', 'aria-label', 'placeholder'];
const originals = new WeakMap();
let observer;

function localize(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  if (!element || element.closest(excluded)) return;
  if (element.closest('#editor') && !element.closest('#md-searchpanel')) {
    if (node.nodeType === 1) for (const panel of node.querySelectorAll('#md-searchpanel')) localize(panel);
    return;
  }
  if (node.nodeType === 3) {
    const previous = originals.get(node);
    const source = previous && node.data === previous.translated ? previous.source : node.data;
    const translated = t(source);
    originals.set(node, { source, translated });
    if (node.data !== translated) node.data = translated;
  } else if (node.nodeType === 1) {
    const previous = originals.get(node) || {};
    for (const name of attributes) {
      const value = node.getAttribute(name);
      if (value === null) continue;
      const source = previous[name]?.translated === value ? previous[name].source : value;
      const translated = t(source);
      previous[name] = { source, translated };
      if (value !== translated) node.setAttribute(name, translated);
    }
    originals.set(node, previous);
    for (const child of node.childNodes) localize(child);
  }
}

function observe() { observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes }); }

export function applyLanguage(value) {
  language = resolveLanguage(value, navigator.language);
  document.documentElement.lang = language;
  observer?.disconnect();
  localize(document.body);
  if (observer) observe();
  document.dispatchEvent(new CustomEvent('inkslip-language-changed', { detail: language }));
}

export function installLocalization() {
  observer = new MutationObserver(records => {
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) localize(node);
      else localize(record.target);
    }
    observe();
  });
  applyLanguage('zh-CN');
}
