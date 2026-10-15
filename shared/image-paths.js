// Image settings are scalar properties in document front matter.
function sourceText(source) { return typeof source === 'string' ? source : source.doc.toString(); }
function frontMatter(source) {
  const text = sourceText(source);
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(text);
  return match?.index === 0 ? { text, match, body: match[1] } : null;
}
export function imageProperty(source, name) {
  const metadata = frontMatter(source);
  if (!metadata) return null;
  const property = metadata.body.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
  const value = property?.[1]?.trim();
  if (!value) return null;
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return null; } }
  if (value.startsWith("'")) return /^'(?:[^']|'')*'$/.test(value) ? value.slice(1, -1).replaceAll("''", "'") : null;
  return value.replace(/[ \t]+#.*$/, '').trim() || null;
}
export function withImageProperty(source, name, value) {
  const text = sourceText(source), newline = text.includes('\r\n') ? '\r\n' : '\n';
  const metadata = frontMatter(text);
  if (value !== null && (typeof value !== 'string' || /[\x00-\x1f]/.test(value))) throw Error('图片设置路径无效');
  const line = value === null ? '' : `${name}: ${JSON.stringify(value)}${newline}`;
  if (!metadata) return line ? `---${newline}${line}---${newline}${newline}${text}` : text;
  const body = metadata.body.replace(new RegExp(`^${name}:[^\\r\\n]*(?:\\r?\\n|$)`, 'gm'), '');
  const prefix = metadata.match[0].indexOf('\n') + 1;
  const replacement = metadata.match[0].slice(0, prefix) + body + line + metadata.match[0].slice(prefix + metadata.body.length);
  return replacement + text.slice(metadata.match[0].length);
}
export function getImageRoot(source) { return imageProperty(source, 'inkslip-root-url'); }
function encodedPath(value) { return value.replaceAll('\\', '/').split('/').map(part => encodeURIComponent(part)).join('/').replace(/^([a-z])%3A/i, '$1:'); }
function decoded(value) { try { return decodeURIComponent(value); } catch { return value; } }
function fileUrl(value) {
  if (/^file:/i.test(value)) return new URL(value).href;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('//')) return 'file:' + encodedPath(normalized);
  return 'file://' + (/^[a-z]:\//i.test(normalized) ? '/' : '') + encodedPath(normalized);
}
export function resolveImageSource(source, documentPath, rootUrl = null) {
  if (/^(https?:|data:|file:)/i.test(source)) return source;
  if (source.startsWith('//')) return 'https:' + source;
  const local = decoded(source);
  if (/^[a-z]:[\\/]|^\\\\/i.test(local)) return fileUrl(local);
  let base = documentPath ? new URL('.', fileUrl(documentPath)).href : null;
  if (rootUrl) {
    if (/^file:/i.test(rootUrl)) base = rootUrl.replace(/\/?$/, '/');
    else if (/^[a-z]:[\\/]|^[\\/]/i.test(rootUrl)) base = fileUrl(rootUrl).replace(/\/?$/, '/');
    else if (base) base = new URL(encodedPath(decoded(rootUrl)).replace(/\/?$/, '/'), base).href;
    else return source;
  }
  if (!rootUrl && local.startsWith('/')) return fileUrl(local);
  return base ? new URL(encodedPath(rootUrl ? local.replace(/^[\\/]+/, '') : local), base).href : source;
}

// Clipboard and file dialogs return paths relative to the document, regardless of its image root.
export function imageSourceForRoot(source, documentPath, rootUrl) {
  if (!rootUrl || /^(https?:|data:)/i.test(source)) return source;
  const target = new URL(resolveImageSource(source, documentPath));
  const base = new URL(resolveImageSource('.', documentPath, rootUrl));
  if (target.protocol !== 'file:' || base.protocol !== 'file:' || target.host !== base.host) return target.href;
  const targetParts = target.pathname.split('/'), baseParts = base.pathname.replace(/\/$/, '').split('/');
  if (/^\/[a-z]:/i.test(target.pathname) && targetParts[1].toLowerCase() !== baseParts[1]?.toLowerCase()) return target.href;
  let common = 0;
  while (common < targetParts.length && common < baseParts.length && targetParts[common].toLowerCase() === baseParts[common].toLowerCase()) common++;
  return (common === baseParts.length ? './' : '../'.repeat(baseParts.length - common)) + targetParts.slice(common).join('/');
}
