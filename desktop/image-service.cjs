const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const executeFile = promisify(execFile);
const defaults = {
  general: { language: 'zh-CN' },
  editor: { fontSize: 14, useCustomFontSize: false, lineHeight: 1.9, contentWidth: 800 },
  appearance: { theme: 'vue.css', darkTheme: 'night.css', useSeparateDarkTheme: false, sidebar: true, statusbar: true, focus: false, typewriter: false, windowStyle: 'classic', zoomLevel: 0, zoomByMouse: false, readingSpeed: 382, wordCountDelimiter: 0, convertSmartOnRender: false, smartQuotes: false, smartDashes: false, remapUnicodePunctuation: false, indentFirstLine: false, visibleBr: true, preserveLineBreaks: true, spellCheck: false },
  image: { uploader: 'picgo-app', picgoEndpoint: 'http://127.0.0.1:36677/upload', picgoPath: '', preferRelative: true, addDotSlash: true, escapeUrl: true, insertAction: 'none', copyFolder: '' },
  export: { pandocPath: '' }
};
function normalizePreferences(input = {}) {
  const result = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { ...value, ...input[key] }]));
  if (!['system', 'zh-CN', 'zh-TW', 'en'].includes(result.general.language)) throw Error('语言设置无效。');
  if (typeof input.editor?.fontSize === 'number' && input.editor.useCustomFontSize === undefined) {
    result.editor.useCustomFontSize = true;
    if (Number.isInteger(input.editor.fontSize) && input.editor.fontSize > 24 && input.editor.fontSize <= 32) result.editor.fontSize = 24;
  }
  for (const [key, label, min, max] of [['fontSize', '字号', 9, 24], ['lineHeight', '行距', 1.2, 3], ['contentWidth', '正文宽度', 480, 1400]]) {
    const value = result.editor[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${label}超出允许范围。`);
  }
  if (typeof result.editor.useCustomFontSize !== 'boolean' || !Number.isInteger(result.editor.fontSize)) throw Error('字号设置无效。');
  const legacyThemes = { light: 'github.css', dark: 'night.css' };
  result.appearance.theme = legacyThemes[result.appearance.theme] || result.appearance.theme;
  for (const key of ['theme', 'darkTheme']) if (typeof result.appearance[key] !== 'string' || !/^[^./\\\x00-\x1f<>:"|?*][^/\\\x00-\x1f<>:"|?*]*\.css$/i.test(result.appearance[key]) || /\.user\.css$/i.test(result.appearance[key])) throw Error('主题文件名无效。');
  if (['sidebar', 'statusbar', 'focus', 'typewriter', 'useSeparateDarkTheme'].some(key => typeof result.appearance[key] !== 'boolean')) throw Error('外观设置无效。');
  if (['convertSmartOnRender', 'smartQuotes', 'smartDashes', 'remapUnicodePunctuation', 'indentFirstLine', 'visibleBr', 'preserveLineBreaks', 'spellCheck'].some(key => typeof result.appearance[key] !== 'boolean')) throw Error('编辑设置无效。');
  if (!['classic', 'unibody'].includes(result.appearance.windowStyle) || !Number.isInteger(result.appearance.zoomLevel) || result.appearance.zoomLevel < -3 || result.appearance.zoomLevel > 6 || typeof result.appearance.zoomByMouse !== 'boolean') throw Error('外观设置无效。');
  if (!Number.isInteger(result.appearance.readingSpeed) || result.appearance.readingSpeed < 1 || result.appearance.readingSpeed > 999) throw Error('阅读速度须为 1 到 999 词每分钟。');
  if (!Number.isInteger(result.appearance.wordCountDelimiter) || result.appearance.wordCountDelimiter < 0 || result.appearance.wordCountDelimiter > 3) throw Error('字数统计设置无效。');
  if (!['picgo-app', 'picgo-cli'].includes(result.image.uploader) || typeof result.image.picgoPath !== 'string') throw Error('图片上传设置无效。');
  if (['preferRelative', 'addDotSlash', 'escapeUrl'].some(key => typeof result.image[key] !== 'boolean')) throw Error('图片语法设置无效。');
  if (!['none', 'copy', 'upload'].includes(result.image.insertAction) || typeof result.image.copyFolder !== 'string') throw Error('图片插入策略无效。');
  if (typeof result.export.pandocPath !== 'string') throw Error('Pandoc 路径无效。');
  let endpoint;
  try { endpoint = new URL(result.image.picgoEndpoint); } catch { throw Error('请输入本机 PicGo 服务地址。'); }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.hash) throw Error('PicGo 服务地址必须是本机 HTTP 地址。');
  result.image.picgoEndpoint = endpoint.href;
  // Persist only implemented fields, never unrelated uploader credentials.
  for (const key of Object.keys(result)) result[key] = Object.fromEntries(Object.keys(defaults[key]).map(field => [field, result[key][field]]));
  return result;
}
async function loadPreferences(file) {
  try { return normalizePreferences(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return normalizePreferences(); throw error; }
}
async function savePreferences(file, input) {
  const result = normalizePreferences(input);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(result, null, 2), { flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return result;
}
function uploadedUrl(value) {
  if (typeof value !== 'string') throw Error('PicGo 未返回有效图片地址。');
  let url; try { url = new URL(value); } catch { throw Error('PicGo 未返回有效图片地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('PicGo 未返回 HTTP(S) 图片地址。');
  return url.href;
}
function parseCliResult(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const marker = clean.lastIndexOf('[PicGo SUCCESS]');
  if (marker < 0 || clean.includes('[PicGo ERROR]')) throw Error('PicGo-Core 上传失败，未返回成功结果。');
  const urls = clean.slice(marker).split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line));
  if (urls.length !== 1) throw Error('PicGo-Core 返回的图片地址数量不符。');
  return uploadedUrl(urls[0]);
}
const imageTypes = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.gif': 'gif', '.webp': 'webp', '.svg': 'svg', '.bmp': 'bmp', '.avif': 'avif', '.ico': 'ico' };
const sizeLimit = 30 * 1024 * 1024;
async function responseBytes(response) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > sizeLimit) throw Error('图片超过 30 MB，未上传。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function prepareImage(source, documentPath, timeoutMs) {
  if (typeof source !== 'string' || !source || source.length > sizeLimit * 2) throw Error('图片地址无效。');
  let bytes, extension;
  if (/^data:image\//i.test(source)) {
    const match = source.match(/^data:image\/(png|jpeg|gif|webp|svg\+xml|bmp|avif|x-icon);base64,([\s\S]+)$/i);
    if (!match) throw Error('暂不支持此内嵌图片格式。');
    bytes = Buffer.from(match[2], 'base64'); extension = { jpeg: 'jpg', 'svg+xml': 'svg', 'x-icon': 'ico' }[match[1]] || match[1];
  } else if (/^https?:/i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw Error(`下载图片失败（HTTP ${response.status}）。`);
    const type = (response.headers.get('content-type') || '').split(';')[0];
    extension = Object.keys(imageTypes).find(ext => type === `image/${ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext === '.svg' ? 'svg+xml' : imageTypes[ext]}`)?.slice(1);
    if (!extension) throw Error('图片地址未返回支持的图片类型。');
    bytes = await responseBytes(response);
  } else {
    let local;
    if (/^file:/i.test(source)) local = fileURLToPath(source);
    else {
      const decoded = decodeURIComponent(source);
      if (!path.isAbsolute(decoded) && !documentPath) throw Error('请先保存文档，以解析相对图片路径。');
      local = path.resolve(documentPath ? path.dirname(documentPath) : '.', decoded);
    }
    local = await fs.realpath(local);
    const stat = await fs.stat(local);
    if (!stat.isFile() || !imageTypes[path.extname(local).toLowerCase()]) throw Error('请选择支持的本地图片文件。');
    if (stat.size > sizeLimit) throw Error('图片超过 30 MB，未上传。');
    return { file: local, cleanup: async () => {} };
  }
  if (!bytes.length || bytes.length > sizeLimit) throw Error('图片为空或超过 30 MB，未上传。');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'inkslip-image-'));
  try {
    const file = path.join(folder, `image.${extension}`); await fs.writeFile(file, bytes);
    return { file, cleanup: () => fs.rm(folder, { recursive: true, force: true }) };
  } catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error; }
}
async function requestUpload(endpoint, file, timeoutMs) {
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list: [file] }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const failure = Error('无法连接 PicGo。请启动 PicGo 并开启 PicGo-Server，检查服务地址。');
    // Only a refused connection is safe to retry: a timeout may already have uploaded.
    failure.connectionRefused = error.cause?.code === 'ECONNREFUSED';
    throw failure;
  }
  if (!response.ok) throw Error(`PicGo 上传失败（HTTP ${response.status}）。`);
  let result;
  try { result = JSON.parse((await responseBytes(response)).toString()); }
  catch { throw Error('PicGo 返回的数据不是有效 JSON。'); }
  if (result.success !== true) throw Error(typeof result.message === 'string' ? result.message : 'PicGo 上传失败，请检查图床配置和 PicGo 日志。');
  if (!Array.isArray(result.result) || result.result.length !== 1) throw Error('PicGo 返回的图片地址数量不符。');
  return uploadedUrl(result.result[0]);
}
async function launchPicgo(executable) {
  if (!path.isAbsolute(executable) || !(process.platform === 'darwin' ? /\.app$/i : /\.exe$/i).test(executable)) throw Error('请选择 PicGo 应用的完整路径。');
  await fs.access(executable);
  await new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.platform === 'darwin' ? '/usr/bin/open' : executable, process.platform === 'darwin' ? ['-a', executable] : [], { env, detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function uploadImage({ source, documentPath, preferences, timeoutMs = 60000 }) {
  const config = normalizePreferences(preferences).image;
  const prepared = await prepareImage(source, documentPath, timeoutMs);
  try {
    if (config.uploader === 'picgo-cli') {
      if (!path.isAbsolute(config.picgoPath) || (process.platform === 'win32' && !/\.(exe|[cm]?js)$/i.test(config.picgoPath))) throw Error('请选择 PicGo-Core 可执行文件的完整路径。');
      const js = /\.[cm]?js$/i.test(config.picgoPath);
      const env = { ...process.env }; if (js) env.ELECTRON_RUN_AS_NODE = '1'; else delete env.ELECTRON_RUN_AS_NODE;
      const { stdout } = await executeFile(js ? process.execPath : config.picgoPath, [...(js ? [config.picgoPath] : []), 'upload', prepared.file], { env, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
      return { status: 'ok', url: parseCliResult(stdout) };
    }
    let url;
    try { url = await requestUpload(config.picgoEndpoint, prepared.file, timeoutMs); }
    catch (error) {
      if (!error.connectionRefused || !config.picgoPath) throw error;
      await launchPicgo(config.picgoPath);
      await new Promise(resolve => setTimeout(resolve, 5000));
      url = await requestUpload(config.picgoEndpoint, prepared.file, timeoutMs);
    }
    return { status: 'ok', url };
  } finally { await prepared.cleanup(); }
}
module.exports = { normalizePreferences, loadPreferences, savePreferences, uploadImage, parseCliResult, prepareImage };
