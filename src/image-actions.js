import MarkdownIt from 'markdown-it';
import { Text, Transaction, StateEffect, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { renderer } from './markdown-renderer.js';

// Keep source offsets on parsed images rather than reconstructing alt text or titles.
const parser = new MarkdownIt({ html: true });
parser.validateLink = renderer.validateLink;
for (const name of ['image', 'html_inline']) {
  const rule = parser.inline.ruler.__rules__.find(rule => rule.name === name).fn;
  parser.inline.ruler.at(name, (state, silent) => {
    const from = state.pos;
    const count = state.tokens.length;
    const result = rule(state, silent);
    if (result && !silent && state.tokens.length > count) {
      const token = state.tokens.at(-1);
      token.meta = { ...token.meta, sourceFrom: from, sourceTo: state.pos };
    }
    return result;
  });
}
const referenceRule = parser.block.ruler.__rules__.find(rule => rule.name === 'reference').fn;
parser.block.ruler.at('reference', (state, line, end, silent) => {
  const from = state.bMarks[line] + state.tShift[line];
  const result = referenceRule(state, line, end, silent);
  if (result && !silent) {
    const source = state.src.slice(from, state.eMarks[state.line - 1]);
    const label = source.match(/^\[((?:\\.|[^\]\\])*)\]:\s*/);
    if (label) {
      const destination = parser.helpers.parseLinkDestination(source, label[0].length, source.length);
      if (destination.ok) {
        const key = parser.utils.normalizeReference(label[1]);
        (state.env.imageReferences ||= {})[key] ||= {
          from: from + label[0].length, to: from + destination.pos,
          href: parser.normalizeLink(destination.str), syntax: 'markdown', reference: key
        };
      }
    }
  }
  return result;
});

function htmlAttribute(tag, name) {
  const value = tag.match(new RegExp(`\\s+${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i'))?.[1];
  if (value === undefined) return null;
  return parser.utils.unescapeAll(/^["']/.test(value) ? value.slice(1, -1) : value);
}

function htmlImages(source, offset) {
  const images = [];
  for (const tag of source.matchAll(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const src = tag[0].match(/\s+src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
    if (!src) continue;
    const start = tag.index + src.index + src[0].length - src[1].length;
    const quote = /^["']/.test(src[1]) ? src[1][0] : '';
    const href = parser.utils.unescapeAll(quote ? src[1].slice(1, -1) : src[1]);
    images.push({ inlineFrom: offset + tag.index, inlineTo: offset + tag.index + tag[0].length,
      from: offset + start, to: offset + start + src[1].length, href, syntax: 'html', quote,
      alt: htmlAttribute(tag[0], 'alt') || '', title: htmlAttribute(tag[0], 'title') || '',
      width: htmlAttribute(tag[0], 'width'), height: htmlAttribute(tag[0], 'height'), style: htmlAttribute(tag[0], 'style') });
  }
  return images;
}

function contentPosition(state, content, firstLine, firstColumn = 0) {
  const contentLines = content.split('\n');
  return position => {
    const before = content.slice(0, position).split('\n');
    const lineIndex = before.length - 1;
    const line = state.doc.line(firstLine + lineIndex + 1);
    const column = line.text.indexOf(contentLines[lineIndex], lineIndex === 0 ? firstColumn : 0);
    return column < 0 ? null : line.from + column + before.at(-1).length;
  };
}

export function imageSources(state) {
  const source = state.doc.toString();
  const env = {};
  const tokens = parser.parse(source, env);
  const images = [];
  let tableLine = null;
  let tableColumn = 0;
  for (const token of tokens) {
    if (token.type === 'tr_open') { tableLine = token.map?.[0] ?? null; tableColumn = 0; }
    if (token.type === 'tr_close') tableLine = null;
    if (token.type === 'html_block' && token.map) {
      const position = contentPosition(state, token.content.replace(/\n$/, ''), token.map[0]);
      for (const image of htmlImages(token.content, 0)) {
        const mapped = Object.fromEntries(['inlineFrom', 'inlineTo', 'from', 'to'].map(key => [key, position(image[key])]));
        if (Object.values(mapped).every(value => value !== null)) images.push({ ...image, ...mapped });
      }
      continue;
    }
    if (token.type !== 'inline' || (!token.map && tableLine === null)) continue;
    const firstLine = token.map?.[0] ?? tableLine;
    const firstColumn = token.map ? 0 : state.doc.line(firstLine + 1).text.indexOf(token.content, tableColumn);
    if (firstColumn < 0) continue;
    if (!token.map) tableColumn = firstColumn + token.content.length;
    const sourceOffset = contentPosition(state, token.content, firstLine, firstColumn);
    const visit = children => {
      for (const child of children || []) {
        if (child.meta?.sourceFrom === undefined) continue;
        const inlineFrom = sourceOffset(child.meta.sourceFrom);
        const inlineTo = sourceOffset(child.meta.sourceTo);
        if (inlineFrom === null || inlineTo === null) continue;
        if (child.type === 'html_inline') {
          for (const image of htmlImages(child.content, 0)) {
            const mapped = Object.fromEntries(['inlineFrom', 'inlineTo', 'from', 'to'].map(key => [key, sourceOffset(child.meta.sourceFrom + image[key])]));
            if (Object.values(mapped).every(value => value !== null)) images.push({ ...image, ...mapped });
          }
        } else if (child.type === 'image') {
          const raw = source.slice(inlineFrom, inlineTo);
          const inlineState = new parser.inline.State(raw, parser, env, []);
          const labelEnd = parser.helpers.parseLinkLabel(inlineState, 1, false);
          let destination;
          if (raw[labelEnd + 1] === '(') {
            const start = labelEnd + 2 + (raw.slice(labelEnd + 2).match(/^\s*/)?.[0].length || 0);
            const result = parser.helpers.parseLinkDestination(raw, start, raw.length);
            if (result.ok) destination = { from: inlineFrom + start, to: inlineFrom + result.pos, syntax: 'markdown' };
          } else destination = env.imageReferences?.[child.meta.label];
          if (destination) images.push({ ...destination, inlineFrom, inlineTo, href: child.attrGet('src'),
            alt: parser.renderer.renderInlineAsText(child.children, parser.options, env), title: child.attrGet('title') || '' });
        }
        // Link children retain their containing inline offsets; image alt children don't.
        if (child.type !== 'image') visit(child.children);
      }
    };
    visit(token.children);
  }
  return images.sort((a, b) => a.inlineFrom - b.inlineFrom);
}

export function findImageSourceRange(state, context) {
  const images = imageSources(state);
  if (Number.isInteger(context.imageInlineFrom)) return images.find(image => image.inlineFrom === context.imageInlineFrom) || null;
  if (Number.isInteger(context.inlineFrom)) {
    const exact = images.find(image => image.inlineFrom === context.inlineFrom);
    if (exact) return exact;
  }
  const candidates = images.filter(image => image.inlineFrom >= (context.from ?? 0) && image.inlineTo <= (context.to ?? state.doc.length)
    && image.href === (context.imageSource || context.href));
  return candidates.length === 1 ? candidates[0] : null;
}

export function resolveImageContext(view, context, element) {
  const scope = element?.closest?.('.md-rendered');
  const from = scope?.dataset?.sourceFrom !== undefined ? Number(scope.dataset.sourceFrom) : context.from;
  const to = scope?.dataset?.sourceTo !== undefined ? Number(scope.dataset.sourceTo) : context.to;
  const images = imageSources(view.state).filter(image => image.inlineFrom >= from && image.inlineTo <= to);
  const nodes = scope ? [...scope.querySelectorAll('img, .md-image-error[data-image-source]')] : [];
  const index = nodes.indexOf(element);
  if (scope && (nodes.length !== images.length || index < 0)) return { ...context, imageInlineFrom: -1 };
  const image = nodes.length === images.length && index >= 0 ? images[index] : findImageSourceRange(view.state, context);
  return image ? { ...context, imageSource: image.href, href: image.href, inlineFrom: image.inlineFrom,
    inlineTo: image.inlineTo, imageInlineFrom: image.inlineFrom, imageReference: image.reference || null } : context;
}

function uploadedDestination(url, image) {
  if (image.syntax === 'html') {
    const quote = image.quote || '"';
    const value = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&#39;');
    return quote + value + quote;
  }
  return /\s|[()<>]/.test(url) ? `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : url;
}

function replace(view, from, to, insert) {
  view.dispatch({ changes: { from, to, insert: Text.of(insert.split(/\r\n|\n|\r/)) },
    annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] });
  view.focus();
  return true;
}

export function imageSourceInfo(view, context) {
  const image = findImageSourceRange(view.state, context);
  return image && { ...image, source: image.href };
}

export function replaceImageSource(view, context, url) {
  const image = findImageSourceRange(view.state, context);
  if (!image || typeof url !== 'string' || !url || /[\r\n\x00-\x1f]/.test(url)) return false;
  return replace(view, image.from, image.to, uploadedDestination(url, image));
}

export function imageReplacementChanges(state, replacements, selectedImages = null) {
  const urls = new Map(replacements.map(entry => [entry.source, entry.url]));
  const changes = new Map();
  for (const image of imageSources(state)) {
    if (selectedImages && !selectedImages.has(image.inlineFrom)) continue;
    const url = urls.get(image.href);
    if (typeof url !== 'string' || !url || /[\r\n\x00-\x1f]/.test(url)) continue;
    changes.set(`${image.from}:${image.to}`, { from: image.from, to: image.to, insert: uploadedDestination(url, image) });
  }
  return [...changes.values()].sort((a, b) => a.from - b.from);
}

export function replaceImageSources(view, replacements) {
  const changes = imageReplacementChanges(view.state, replacements);
  if (!changes.length) return false;
  view.dispatch({ changes, annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] });
  view.focus();
  return true;
}

export function deleteImage(view, context) {
  const image = findImageSourceRange(view.state, context);
  return image ? replace(view, image.inlineFrom, image.inlineTo, '') : false;
}

function htmlImage(image, width) {
  const escaped = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<img src="${escaped(image.href)}" alt="${escaped(image.alt)}"${image.title ? ` title="${escaped(image.title)}"` : ''}${width ? ` width="${width}"` : ''}>`;
}

export function scaleImage(view, context, width) {
  const image = findImageSourceRange(view.state, context);
  if (!image || !Number.isFinite(width) || width <= 0) return false;
  const pixels = String(Math.max(1, Math.round(width)));
  let insert = htmlImage(image, pixels);
  if (image.syntax === 'html') {
    insert = view.state.doc.sliceString(image.inlineFrom, image.inlineTo);
    const attribute = name => new RegExp(`\\s+${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const existingWidth = insert.match(attribute('width'));
    insert = existingWidth ? insert.replace(attribute('width'), existingWidth[0].slice(0, existingWidth[0].length - existingWidth[1].length) + `"${pixels}"`)
      : insert.replace(/(\s*\/?>)$/, ` width="${pixels}"$1`);
    insert = insert.replace(attribute('height'), '');
    const style = insert.match(attribute('style'));
    if (style) {
      const quote = /^["']/.test(style[1]) ? style[1][0] : '';
      const value = quote ? style[1].slice(1, -1) : style[1];
      const resized = value.replace(/(^|;)\s*(?:width|height)\s*:[^;]*(?=;|$)/gi, '$1');
      const replacement = resized.replace(/[;\s]/g, '') ? style[0].slice(0, style[0].length - style[1].length) + quote + resized + quote : '';
      insert = insert.replace(attribute('style'), replacement);
    }
  }
  return replace(view, image.inlineFrom, image.inlineTo, insert);
}

export function convertImageSyntax(view, context, syntax) {
  const image = findImageSourceRange(view.state, context);
  if (!image || !['markdown', 'html'].includes(syntax) || image.syntax === syntax) return false;
  let insert;
  if (syntax === 'html') {
    insert = htmlImage(image);
  } else {
    // Plain Markdown has no equivalent for HTML dimensions or CSS. Retain the
    // existing HTML rather than silently discarding its presentation attributes.
    if (image.width !== null || image.height !== null || image.style !== null) return false;
    const alt = image.alt.replace(/[\\\[\]]/g, '\\$&');
    const title = image.title ? ` "${image.title.replace(/[\\"]/g, '\\$&')}"` : '';
    insert = `![${alt}](${uploadedDestination(image.href, { syntax: 'markdown' })}${title})`;
  }
  return replace(view, image.inlineFrom, image.inlineTo, insert);
}

const trackUpload = StateEffect.define();
const uploadingImage = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(trackUpload)) return effect.value;
    if (!value || !transaction.docChanged) return value;
    let valid = value.valid;
    transaction.changes.iterChangedRanges((from, to) => {
      for (const [start, end] of [[value.inlineFrom, value.inlineTo], [value.from, value.to]]) {
        if (from === to ? from > start && from < end : from < end && to > start) valid = false;
      }
    });
    return { ...value, valid,
      from: transaction.changes.mapPos(value.from, 1), to: transaction.changes.mapPos(value.to, -1),
      inlineFrom: transaction.changes.mapPos(value.inlineFrom, 1), inlineTo: transaction.changes.mapPos(value.inlineTo, -1) };
  }
});

export function createImageUploadAction(view, { uploadImage, notify = () => {}, getDocumentId = () => null }) {
  return async context => {
    const documentId = getDocumentId();
    const image = findImageSourceRange(view.state, context);
    if (!image) {
      const message = '无法准确定位图片原文，未执行上传';
      notify(message);
      return { status: 'error', message };
    }
    const token = Symbol('upload');
    if (view.state.field(uploadingImage, false) === undefined) view.dispatch({ effects: StateEffect.appendConfig.of(uploadingImage) });
    view.dispatch({ effects: trackUpload.of({ ...image, token, valid: true }) });
    try {
      const result = await uploadImage(image.href);
      const url = typeof result === 'string' ? result : result?.url;
      if (result?.status === 'error') throw new Error(result.message || '图片上传失败');
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || /[\r\n\x00-\x1f]/.test(url)) throw new Error('上传服务未返回有效的 HTTP 图片地址');
      const target = view.state.field(uploadingImage, false);
      if (!target?.valid || target.token !== token || getDocumentId() !== documentId) {
        notify(`图片已上传，但原图片已修改或文档已切换，未替换原文：${url}`);
        return { status: 'stale', url };
      }
      replace(view, target.from, target.to, uploadedDestination(url, image));
      notify(image.reference ? '图片已上传并更新引用定义，共用此引用的图片和链接也将更新' : '图片已上传，原文地址已替换');
      return { status: 'ok', url };
    } catch (error) {
      const message = error.message || String(error);
      notify(message);
      return { status: 'error', message };
    } finally {
      if (view.state.field(uploadingImage, false)?.token === token) view.dispatch({ effects: trackUpload.of(null) });
    }
  };
}
