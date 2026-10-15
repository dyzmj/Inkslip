function stylesheetCss(sheet, baseUrl, seen = new Set()) {
  if (seen.has(sheet)) return '';
  seen.add(sheet);
  const base = sheet.href || baseUrl;
  const absoluteUrls = css => css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi, (match, double, single, bare) => {
    const url = double ?? single ?? bare;
    return url.startsWith('#') ? match : `url(${JSON.stringify(new URL(url, base).href)})`;
  });
  return [...sheet.cssRules].map(rule => {
    if (rule.type === 3) {
      const css = stylesheetCss(rule.styleSheet, rule.href, seen);
      return rule.media.mediaText ? `@media ${rule.media.mediaText}{${css}}` : css;
    }
    return absoluteUrls(rule.cssText);
  }).join('\n');
}

export function createExportHtml(doc, content) {
  const html = doc.createElement('html');
  html.lang = doc.documentElement.lang;
  html.style.cssText = doc.documentElement.style.cssText;
  // Chromium paints the root background across the printable page, including
  // the space below the document and around the body margins.
  html.style.backgroundColor = doc.defaultView.getComputedStyle(doc.body).backgroundColor;
  const head = doc.createElement('head');
  const charset = doc.createElement('meta'); charset.charset = 'utf-8';
  const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; img-src file: data: https: http:; style-src 'unsafe-inline'; font-src file: data:";
  const style = doc.createElement('style');
  const css = [...doc.styleSheets].map(sheet => stylesheetCss(sheet, doc.baseURI)).join('\n');
  style.textContent = `${css}\nhtml,body{width:auto;height:auto;min-height:0;overflow:visible}body{margin:40px;background:var(--paper);color:var(--text);print-color-adjust:exact;-webkit-print-color-adjust:exact}#editor{min-height:0;max-width:var(--editor-content-width,800px);margin:auto}pre{white-space:pre-wrap}`.replaceAll('<', '\\3c ');
  head.append(charset, policy, style);
  const body = doc.createElement('body');
  body.style.cssText = doc.body.style.cssText;
  for (const name of ['dark', 'first-line-indent']) if (doc.body.classList.contains(name)) body.classList.add(name);
  body.dataset.theme = doc.body.dataset.theme || '';
  const editor = doc.createElement('main'); editor.id = 'editor';
  editor.style.cssText = doc.getElementById('editor').style.cssText;
  const container = doc.createElement('div'); container.className = 'cm-content';
  const article = doc.createElement('article'); article.className = 'md-rendered'; article.innerHTML = content;
  container.append(article); editor.append(container); body.append(editor); html.append(head, body);
  return '<!doctype html>' + html.outerHTML;
}
