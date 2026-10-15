const SAMPLE = `<main id="write"><h1>墨简 Inkslip</h1><h2>Markdown 主题</h2><p>专注写作，记录想法。<strong>粗体文字</strong>、<em>斜体文字</em>和 <a href="#sample">链接</a>。</p><blockquote><p>让文字呈现自己的风格。</p></blockquote><ul><li>列表项目</li><li>继续写作</li></ul><table class="md-table"><thead><tr><th>主题</th><th>样式</th></tr></thead><tbody><tr><td>Markdown</td><td>预览</td></tr></tbody></table><p>行内 <code>const ink = true</code> 代码。</p><pre class="md-fences"><code>function write() {\n  return "Hello, Inkslip";\n}</code></pre></main>`;
const SCOPE = 'body:not(.source-mode) #editor .cm-content';
const PALETTE = ['paper', 'sidebar', 'panel', 'text', 'muted', 'secondary', 'border', 'accent', 'accent-soft', 'code', 'hover', 'selection'];

function splitSelectors(text) {
  const selectors = [];
  let start = 0, depth = 0, quote = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) { if (char === quote && text[index - 1] !== '\\') quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && !depth) { selectors.push(text.slice(start, index)); start = index + 1; }
  }
  selectors.push(text.slice(start));
  return selectors;
}

function scopeSelector(selector) {
  let scoped = selector.trim();
  const sourceMode = /\.cm-s-inkslip-default\b/.test(scoped);
  const scope = sourceMode ? 'body.source-mode #editor .cm-content' : SCOPE;
  if (/^(?::root|html|body)(?:\s+(?:html|body))*$/.test(scoped)) return '';
  scoped = scoped.replace(/^(?:(?:html|body|:root)\s+)+/, '');
  scoped = scoped.replace(/#write\b/g, '__INKSLIP_WRITE__');
  scoped = scoped.replace(/table\.md-table\b/g, 'table');
  scoped = scoped.replace(/\.md-diagram-panel(?:-preview)?\b/g, '.md-mermaid').replace(/\.md-mermaid\s+\.md-mermaid\b/g, '.md-mermaid');
  scoped = scoped.replace(/\.CodeMirror-code\b/g, '.cm-content').replace(/\.CodeMirror-cursor\b/g, '.cm-cursor').replace(/\.CodeMirror\b/g, '.cm-editor');
  scoped = scoped.replace(/^(?:\.cm-editor|\.cm-content)\s+/, '');
  scoped = scoped.replace(/\.cm-s-inner\b/g, ':is(pre,.md-code-line)');
  scoped = scoped.replace(/\.cm-s-inkslip-default\s*/g, '');
  const tokens = { keyword: 'keyword', string: 'string', 'string-2': 'string2', comment: 'comment', number: 'number', operator: 'operator', property: 'propertyName', attribute: 'propertyName', tag: 'typeName', variable: 'variableName', atom: 'atom,.tok-bool', header: sourceMode ? 'heading,.tok-meta' : 'heading', link: 'link,.tok-url', def: 'definition', meta: 'meta', builtin: 'variableName2', code: 'meta:not(.tok-heading)' };
  scoped = scoped.replace(/\.cm-(keyword|string-2|string|comment|number|operator|property|attribute|tag|variable|atom|header|link|def|meta|builtin|code)\b/g, (match, token) => `:is(${match},.hljs-${token === 'atom' ? 'literal' : token},.tok-${tokens[token]})`);
  const tags = { strong: ':is(strong,.md-strong)', b: ':is(b,.md-strong)', em: ':is(em,.md-emphasis)', i: ':is(i,.md-emphasis)', a: ':is(a,.md-link)', blockquote: ':is(blockquote,.md-quote)', code: ':is(code,.md-inline-code)', pre: ':is(pre,.md-code-line,.md-code-fence)', p: ':is(p,.cm-line:not([class*="md-heading-"]):not(.md-code-line):not(.md-code-fence):not(.md-quote))' };
  scoped = scoped.replace(/(^|[\s>+~(,])(h[1-6]|strong|b|em|i|a|blockquote|code|pre|p)(?=[.#\s:>+~\[\]),]|$)/g, (_, prefix, tag) => `${prefix}${/^h[1-6]$/.test(tag) ? `:is(${tag},.md-heading-${tag[1]})` : tags[tag]}`);
  scoped = scoped.replace(/\.md-fences\b/g, ':is(.md-fences,pre,.md-code-line,.md-code-fence)');
  if (scoped.includes('__INKSLIP_WRITE__')) return scoped.replaceAll('__INKSLIP_WRITE__', scope);
  return `${scope} ${scoped}`;
}

function absoluteUrls(css, base) {
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi, (_, double, single, bare) => {
    const url = new URL(double ?? single ?? bare, base).href;
    return `url(${JSON.stringify(url)})`;
  });
}

function contentCss(sheet, parentUrl, seen = new Set()) {
  if (!sheet) throw Error(`无法加载主题导入样式：${parentUrl}`);
  if (seen.has(sheet)) return '';
  seen.add(sheet);
  const base = sheet.href || parentUrl;
  let rules;
  try { rules = [...sheet.cssRules]; }
  catch { throw Error(`无法读取主题样式：${base}`); }
  function compile(rule) {
    if (rule.type === 3) {
      const imported = contentCss(rule.styleSheet, rule.href, seen);
      return rule.media.mediaText ? `@media ${rule.media.mediaText}{${imported}}` : imported;
    }
    if (rule.type === 1) {
      const selectors = splitSelectors(rule.selectorText).map(scopeSelector).filter(Boolean);
      return selectors.length ? `${selectors.join(',')}{${absoluteUrls(rule.style.cssText, base)}}` : '';
    }
    if (rule.type === 5 || rule.type === 7) return absoluteUrls(rule.cssText, base);
    if (rule.cssRules) {
      const prefix = rule.cssText.slice(0, rule.cssText.indexOf('{'));
      return `${prefix}{${[...rule.cssRules].map(compile).join('\n')}}`;
    }
    return '';
  }
  return rules.map(compile).join('\n');
}

function frameFor(styles, preview = false, name = '') {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('aria-label', preview ? '主题样式预览' : '主题样式加载');
  iframe.width = preview ? '150' : '960';
  iframe.height = preview ? '200' : '700';
  iframe.style.cssText = preview ? 'display:block;border:0;pointer-events:none' : 'position:fixed;left:-2000px;top:0;opacity:0;pointer-events:none;border:0';
  const ready = new Promise((resolve, reject) => {
    iframe.onload = async () => {
      try {
        const doc = iframe.contentDocument;
        if (preview) doc.querySelector('h1').textContent = name;
        const links = [];
        for (const style of styles) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = style.url;
          links.push({ link, promise: new Promise((resolve, reject) => { link.onload = resolve; link.onerror = () => reject(Error(`无法加载主题样式：${style.url}`)); }) });
          doc.head.append(link);
        }
        await Promise.all(links.map(item => item.promise));
        if (preview) {
          const layout = doc.createElement('style');
          layout.textContent = 'html{padding-left:16px}body{padding-top:16px}#write{padding:0!important}#write h1{margin-top:0!important;padding-top:0!important;text-align:left!important}';
          doc.head.append(layout);
        }
        // Request layout so font loading also settles while the window is hidden.
        doc.body.getBoundingClientRect();
        await Promise.all([...doc.fonts].filter(font => font.status !== 'unloaded').map(font => font.loaded));
        const failedFonts = [...doc.fonts].filter(font => font.status === 'error');
        if (failedFonts.length) throw Error(`无法加载主题字体：${failedFonts.map(font => font.family).join('、')}`);
        resolve({ iframe, doc, sheets: links.map(item => item.link.sheet) });
      } catch (error) { reject(error); }
    };
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>html{font-size:16px}body{margin:0;background:var(--bg-color,#fff);color:var(--text-color,#333);font-family:"Segoe UI",sans-serif}#write{padding:20px;max-width:860px;margin:auto}table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px}pre{white-space:pre-wrap}.CodeMirror{font-family:"Cascadia Code",Consolas,monospace}${preview ? 'html{width:400px;zoom:.7;overflow:hidden}body{overflow:hidden}' : ''}</style></head><body>${SAMPLE}</body></html>`;
  });
  return { iframe, ready };
}

function sampleTheme(doc) {
  const codeMirror = doc.createElement('div'); codeMirror.className = 'CodeMirror cm-s-inner';
  doc.querySelector('pre').append(codeMirror);
  const computed = (selector, pseudo) => doc.defaultView.getComputedStyle(doc.querySelector(selector), pseudo);
  const root = computed('html'), body = computed('body'), write = computed('#write');
  const custom = name => write.getPropertyValue(name).trim() || root.getPropertyValue(name).trim();
  const visible = color => color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)';
  const background = (...colors) => colors.find(visible);
  const paper = background(write.backgroundColor, body.backgroundColor, root.backgroundColor, custom('--bg-color'), '#fff');
  const sidebar = background(custom('--side-bar-bg-color'), paper);
  const code = background(computed('pre').backgroundColor, custom('--code-block-bg-color'), custom('--block-bg-color'), computed('code').backgroundColor, sidebar);
  const accent = custom('--primary-color') || computed('a').color;
  const secondary = custom('--control-text-color') || computed('blockquote').color;
  const palette = { paper, sidebar, panel: paper, text: write.color, muted: secondary, secondary, border: computed('td').borderTopColor, accent, 'accent-soft': background(custom('--active-file-bg-color'), code), code, hover: background(custom('--item-hover-bg-color'), sidebar), selection: background(custom('--select-text-bg-color'), computed('p', '::selection').backgroundColor, code) };
  const variables = new Map();
  for (const style of [root, write]) for (const property of style) if (property.startsWith('--') && !['--editor-font-size', '--editor-line-height', '--editor-content-width'].includes(property)) variables.set(property, style.getPropertyValue(property));
  const swatch = doc.createElement('span');
  swatch.style.color = paper;
  doc.body.append(swatch);
  const channels = doc.defaultView.getComputedStyle(swatch).color.match(/[\d.]+/g)?.map(Number) || [255, 255, 255];
  swatch.remove();
  const dark = (299 * channels[0] + 587 * channels[1] + 114 * channels[2]) / 256000 < .5;
  const fontSize = parseFloat(write.fontSize) || 16;
  const headings = Array.from({ length: 6 }, (_, index) => {
    const tag = `h${index + 1}`;
    let heading = doc.querySelector(tag);
    if (!heading) { heading = doc.createElement(tag); heading.textContent = 'Markdown'; doc.querySelector('#write').append(heading); }
    const style = doc.defaultView.getComputedStyle(heading);
    return { ratio: parseFloat(style.fontSize) / fontSize, fontFamily: style.fontFamily };
  });
  const textFonts = ['p', 'li'].map(selector => ({ selector, size: computed(selector).fontSize, lineHeight: computed(selector).lineHeight }));
  return { palette, variables, dark, fontSize, fontFamily: write.fontFamily, lineHeight: write.lineHeight, headings, textFonts, codeColor: computed('.CodeMirror').color, codeFont: computed('.CodeMirror').fontFamily };
}

export function installThemes({ view, desktop, notify } = {}) {
  let themes = [], sequence = 0;
  const themeStyle = document.createElement('style');
  themeStyle.id = 'inkslip-theme-style';
  document.head.append(themeStyle);
  let variableNames = [];
  async function refresh() {
    if (!desktop?.listThemes) return themes;
    const found = await desktop.listThemes();
    if (found?.error) throw Error(found.error);
    themes = found;
    return themes;
  }
  const ready = refresh();
  async function load(id) {
    const theme = await desktop.loadTheme(id);
    if (theme?.error) throw Error(theme.error);
    return theme;
  }
  async function apply(id) {
    if (!desktop?.loadTheme) return { id: 'light', dark: false };
    const request = ++sequence;
    let probe;
    try {
      await ready;
      const theme = await load(id);
      if (request !== sequence) return null;
      probe = frameFor(theme.styles);
      document.body.append(probe.iframe);
      const { doc, sheets } = await probe.ready;
      const css = sheets.map((sheet, index) => contentCss(sheet, theme.styles[index].url)).join('\n');
      const sample = sampleTheme(doc);
      if (request !== sequence) return null;
      const typography = `${SCOPE},body:not(.source-mode) #editor .cm-scroller,${SCOPE} .md-rendered{font-family:${sample.fontFamily};font-size:var(--editor-font-size,${sample.fontSize}px)!important;line-height:var(--editor-line-height,${sample.lineHeight})!important;}`;
      const textFonts = sample.textFonts.map(font => `${scopeSelector(font.selector)}{font-size:var(--editor-font-size,${font.size})!important;line-height:var(--editor-line-height,${font.lineHeight})!important;}`).join('\n');
      const headings = sample.headings.map((heading, index) => `${SCOPE} :is(h${index + 1},.md-heading-${index + 1}){font-family:${heading.fontFamily};font-size:calc(var(--editor-font-size,${sample.fontSize}px) * ${heading.ratio})!important;}`).join('\n');
      const codeBlocks = `${SCOPE} pre{background:${sample.palette.code};color:${sample.codeColor};font-family:${sample.codeFont}}${SCOPE} pre>code{display:block;background:transparent;color:inherit;padding:0;margin:0;font:inherit}`;
      const paragraph = doc.querySelector('#write p');
      const paragraphStyle = getComputedStyle(paragraph);
      const sourceSpacing = `${SCOPE} .md-rendered>:last-child{margin-bottom:0!important}${SCOPE} .cm-line{margin-top:0!important;margin-bottom:0!important}${SCOPE} .cm-line.md-paragraph-first-line{margin-top:${paragraphStyle.marginTop}!important}${SCOPE} .cm-line.md-empty-line{height:0;min-height:0;line-height:0!important;font-size:0!important;margin:0!important;padding:0}`;
      themeStyle.textContent = `${css}\n${typography}\n${textFonts}\n${headings}\n${codeBlocks}\n${sourceSpacing}`;
      const editor = document.querySelector('#editor');
      for (const name of variableNames) editor.style.removeProperty(name);
      for (const [name, value] of sample.variables) editor.style.setProperty(name, value);
      variableNames = [...sample.variables.keys()];
      for (const name of PALETTE) document.body.style.setProperty(`--${name}`, sample.palette[name]);
      document.body.classList.toggle('dark', sample.dark);
      document.body.dataset.theme = theme.id;
      view?.requestMeasure();
      return { id: theme.id, dark: sample.dark };
    } catch (error) {
      if (request !== sequence) return null;
      throw error;
    } finally { probe?.iframe.remove(); }
  }
  function preview(theme, container) {
    let frame, destroyed = false;
    const id = typeof theme === 'string' ? theme : theme.id;
    const loaded = load(id).then(theme => {
      if (destroyed) return null;
      frame = frameFor(theme.styles, true, theme.name);
      container.append(frame.iframe);
      return frame.ready.then(({ sheets }) => { sheets.forEach((sheet, index) => contentCss(sheet, theme.styles[index].url)); return frame.iframe; });
    });
    return { get iframe() { return frame?.iframe; }, ready: loaded, destroy() { destroyed = true; frame?.iframe.remove(); } };
  }
  return { ready, list: () => [...themes], refresh, apply, preview };
}
