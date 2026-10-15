const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { prepareImage } = require('./image-service.cjs');
const parser = new MarkdownIt({ html: true });
const validateLink = parser.validateLink.bind(parser);
parser.validateLink = value => /^file:/i.test(value) || /^[a-z]:[\\/]/i.test(value) || validateLink(value);
const extensions = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
async function digest(file) { return createHash('sha256').update(await fs.readFile(file)).digest('hex'); }
async function exists(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function localReferences(source) {
  const references = [];
  function visit(tokens) {
    for (const token of tokens) {
      if (token.type === 'image') references.push({ source: token.attrGet('src'), kind: 'image' });
      if (token.type === 'link_open') references.push({ source: token.attrGet('href'), kind: 'link' });
      if (token.type.startsWith('html')) for (const match of token.content.matchAll(/\b(?:src|href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
        references.push({ source: parser.utils.unescapeAll(match[1].replace(/^["']|["']$/g, '')), kind: /^<img\b/i.test(token.content) ? 'image' : 'link' });
      }
      visit(token.children || []);
    }
  }
  visit(parser.parse(source, {}));
  return references;
}
async function sharedReferences(files, documentPath, currentDocument, deleting) {
  if (!documentPath) return [];
  const { getImageRoot, resolveImageSource } = await import('../shared/image-paths.js');
  const targets = new Set(files.map(file => canonical(file)));
  const hits = [], queue = [path.dirname(documentPath)];
  let count = 0;
  while (queue.length) {
    const folder = queue.pop();
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (++count > 10000) throw Error('共享引用检查超过 10000 个文件，请缩小文档所在目录后重试。');
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', '.svn'].includes(entry.name)) queue.push(file);
      if (!entry.isFile() || !/\.(md|markdown|mdown|mkd|mdx)$/i.test(entry.name)) continue;
      const active = canonical(path.resolve(file)) === canonical(path.resolve(documentPath));
      const text = active && typeof currentDocument === 'string' ? currentDocument : await fs.readFile(file, 'utf8');
      for (const reference of localReferences(text)) {
        // All image occurrences are replaced by a bulk move. Ordinary links still retain their old address.
        if (active && !deleting && reference.kind === 'image') continue;
        const url = resolveImageSource(reference.source, file, getImageRoot(text));
        if (!/^file:/i.test(url)) continue;
        try { if (targets.has(canonical(await fs.realpath(fileURLToPath(url))))) { hits.push(file); break; } }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  return [...new Set(hits)];
}
function destinationUrl(file, documentPath, rootUrl, config = {}) {
  // Relative output addresses use the same root that the document uses to read them.
  const base = rootUrl ? require('node:url').fileURLToPath(rootUrl) : documentPath ? path.dirname(documentPath) : null;
  let value = file.replaceAll('\\', '/');
  if (base && config.preferRelative !== false) {
    const relative = path.relative(base, file);
    if (!path.isAbsolute(relative)) value = (config.addDotSlash !== false && !relative.startsWith('..') ? './' : '') + relative.replaceAll('\\', '/');
  }
  if (config.escapeUrl !== false) value = value.split('/').map(part => encodeURIComponent(part).replaceAll('%3A', ':')).join('/');
  return value;
}
function createImageFileOperations() {
  const journals = new Map();
  async function restore(record, currentDocument) {
    // Refuse to erase or overwrite changes made outside the editor after the operation.
    for (const item of record.files) {
      if (item.unchanged) continue;
      if (item.target && await exists(item.target) && await digest(item.target) !== item.hash) throw Error('目标图片已被其他程序修改，未撤销磁盘操作。');
      if (item.local && await exists(item.original) && await digest(item.original) !== item.hash) throw Error('原位置已有不同图片，未覆盖该文件。');
    }
    const targets = record.files.filter(item => item.target && !item.unchanged).map(item => item.target);
    if (targets.length) {
      const shared = await sharedReferences(targets, record.documentPath,
        typeof currentDocument === 'string' ? currentDocument : record.currentDocument, true);
      if (shared.length) throw Error(`目标图片仍被文档引用，未撤销磁盘操作：${shared.slice(0, 3).join('；')}。检查范围为当前文档目录及子目录。`);
    }
    for (const item of record.files) {
      if (item.unchanged) continue;
      if (item.local && record.operation !== 'copy' && !await exists(item.original)) await fs.copyFile(item.backup, item.original, constants.COPYFILE_EXCL);
      if (item.target && await exists(item.target)) await fs.unlink(item.target);
    }
    record.active = false;
  }
  async function redo(record, options, currentDocument) {
    for (const item of record.files) {
      if (item.unchanged) continue;
      if (item.target && await exists(item.target)) throw Error('目标位置已有文件，未覆盖。');
      if (item.local && record.operation !== 'copy' && (!await exists(item.original) || await digest(item.original) !== item.hash)) throw Error('原图片已变化，未重做磁盘操作。');
    }
    if (record.operation !== 'copy') {
      const shared = await sharedReferences(record.files.filter(item => item.local && !item.unchanged).map(item => item.original),
        record.documentPath, typeof currentDocument === 'string' ? currentDocument : record.currentDocument, record.operation === 'delete');
      if (shared.length) throw Error(`图片仍被文档引用，未重做${record.operation === 'delete' ? '删除' : '移动'}：${shared.slice(0, 3).join('；')}。检查范围为当前文档目录及子目录。`);
    }
    const copied = [];
    try {
      for (const item of record.files) if (item.target) { await fs.copyFile(item.backup, item.target, constants.COPYFILE_EXCL); copied.push(item.target); }
      for (const item of record.files) if (!item.unchanged && item.local && record.operation !== 'copy') {
        if (record.operation === 'delete' && options.trashItem) await options.trashItem(item.original);
        else await fs.unlink(item.original);
      }
      record.active = true;
    } catch (error) {
      for (const item of record.files) if (item.local && !await exists(item.original)) await fs.copyFile(item.backup, item.original, constants.COPYFILE_EXCL);
      for (const file of copied) await fs.unlink(file);
      throw error;
    }
  }
  return async function imageFiles(request, options = {}) {
    if (!request || typeof request.documentPath !== 'string' && request.documentPath !== null) throw Error('图片文件请求无效。');
    if (['undo', 'redo'].includes(request.operation)) {
      const record = journals.get(request.operationId);
      if (!record || record.documentPath !== request.documentPath) throw Error('找不到此文档的图片操作记录。');
      if (request.operation === 'undo' && record.active) await restore(record, request.currentDocument);
      if (request.operation === 'redo' && !record.active) await redo(record, options, request.currentDocument);
      return { status: 'ok', operationId: request.operationId };
    }
    if (!['copy', 'move', 'delete'].includes(request.operation) || !Array.isArray(request.sources) || !request.sources.length || request.sources.length > 500 || request.sources.some(source => typeof source !== 'string' || !source || /[\x00-\x1f]/.test(source))) throw Error('图片文件请求无效。');
    const { resolveImageSource } = await import('../shared/image-paths.js');
    const root = request.rootUrl ? resolveImageSource('.', request.documentPath, request.rootUrl) : null;
    if (root && !/^file:/i.test(root)) throw Error('图片根目录必须是本地文件夹。');
    let destination = request.destination;
    if (request.operation !== 'delete') {
      if (typeof destination !== 'string' || !destination || /[\x00-\x1f]/.test(destination)) throw Error('请选择图片目标文件夹。');
      destination = destination.replaceAll('${filename}', request.documentPath ? path.parse(request.documentPath).name : 'untitled');
      destination = path.resolve(request.documentPath ? path.dirname(request.documentPath) : '.', destination);
      await fs.mkdir(destination, { recursive: true });
      destination = await fs.realpath(destination);
    }
    const files = [], prepared = [], unique = new Map();
    const id = randomUUID(), backup = path.join(options.backupDirectory || path.join(os.tmpdir(), 'inkslip-image-history'), id);
    const record = { operation: request.operation, documentPath: request.documentPath, currentDocument: request.currentDocument, files, active: false };
    try {
      for (const source of [...new Set(request.sources)]) {
        const resolved = resolveImageSource(source, request.documentPath, request.rootUrl);
        const local = /^file:/i.test(resolved) || !/^[a-z][a-z\d+.-]*:/i.test(resolved);
        if (request.operation === 'delete' && !local) throw Error('只能删除本地图片文件。');
        const image = await prepareImage(resolved, request.documentPath, 60000); prepared.push(image);
        const original = await fs.realpath(image.file);
        if (!extensions.test(original)) throw Error('不支持的图片文件。');
        const key = canonical(original);
        if (unique.has(key)) { unique.get(key).sources.push(source); continue; }
        const item = { original, local, sources: [source], hash: await digest(original), backup: path.join(backup, String(files.length) + path.extname(original)) };
        files.push(item); unique.set(key, item);
      }
      if (request.operation !== 'copy') {
        const shared = await sharedReferences(files.filter(file => file.local).map(file => file.original), request.documentPath, request.currentDocument, request.operation === 'delete');
        if (shared.length) throw Error(`图片仍被文档引用，未${request.operation === 'delete' ? '删除' : '移动'}：${shared.slice(0, 3).join('；')}。检查范围为当前文档目录及子目录。`);
      }
      await fs.mkdir(backup, { recursive: true });
      for (const item of files) {
        await fs.copyFile(item.original, item.backup, constants.COPYFILE_EXCL);
        if (request.operation === 'delete') continue;
        const parsed = path.parse(item.original);
        if (canonical(path.join(destination, parsed.base)) === canonical(item.original)) { item.unchanged = true; continue; }
        for (let suffix = 0; ; suffix++) {
          const target = path.join(destination, `${parsed.name}${suffix ? ` (${suffix + 1})` : ''}${parsed.ext}`);
          try { await fs.copyFile(item.backup, target, constants.COPYFILE_EXCL); item.target = target; break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
      }
      for (const item of files) if (item.local && !item.unchanged && request.operation !== 'copy') {
        if (request.operation === 'delete' && options.trashItem) await options.trashItem(item.original);
        else await fs.unlink(item.original);
      }
      record.active = true; journals.set(id, record);
      return { status: 'ok', operationId: id, sharedCheckScope: '当前文档目录及子目录', sources: files.flatMap(item => item.sources.map(source => ({ source, path: item.target || item.original, url: item.unchanged ? source : item.target ? destinationUrl(item.target, request.documentPath, root, options.preferences?.image) : null }))) };
    } catch (error) {
      if (files.some(item => item.target || item.backup && backup)) {
        for (const item of files) {
          if (item.local && await exists(item.backup) && !await exists(item.original)) await fs.copyFile(item.backup, item.original, constants.COPYFILE_EXCL);
          if (item.target && await exists(item.target)) await fs.unlink(item.target);
        }
      }
      await fs.rm(backup, { recursive: true, force: true });
      throw error;
    } finally { await Promise.all(prepared.map(item => item.cleanup())); }
  };
}
module.exports = { createImageFileOperations, sharedReferences, localReferences };
