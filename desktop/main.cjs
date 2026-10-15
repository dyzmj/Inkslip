const { app, BrowserWindow, clipboard, ClipboardItem, nativeImage, nativeTheme, dialog, ipcMain, Menu, protocol, shell } = require('electron');
const iconv = require('iconv-lite');
const menuSpec = require('../shared/menu-spec.json');
const { resolveLanguage, translate, translateDialog } = require('../shared/i18n.cjs');
const { fileURLToPath } = require('node:url');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const imageService = require('./image-service.cjs');
const imageClipboard = require('./image-clipboard.cjs');
const library = require('./library-service.cjs');
const themeService = require('./theme-service.cjs');
const converter = require('./document-converter.cjs');
const imageFiles = require('./image-file-operations.cjs').createImageFileOperations();
const { createSpellService } = require('./spell-service.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);
const { migrateUserData } = require('./user-data.cjs');
app.setName('Inkslip');
if (process.env.INKSLIP_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.INKSLIP_TEST_USER_DATA));
const windowSession = process.argv.includes('--inkslip-window') ? require('node:fs').mkdtempSync(path.join(app.getPath('temp'), 'inkslip-window-')) : null;
if (windowSession) app.setPath('sessionData', windowSession);

let window;
let windowStyle = 'classic';
let interfaceLanguage = 'zh-CN';
const t = text => translate(text, interfaceLanguage);
const localizedDialog = Object.fromEntries(['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showMessageBoxSync'].map(method => [method, (...args) => {
  args[args.length - 1] = translateDialog(args.at(-1), interfaceLanguage);
  return dialog[method](...args);
}]));
let dirty = false;
let activePath = null;
let activeEncoding = 'utf8';
let recentFiles = [];
let operationBusy = false;
let folderRoot = null;
let libraryUndo = null;
const selectedImages = new Set();
let imageUploadBusy = false;
let preferencesWrite = Promise.resolve();
const preferencesFile = () => path.join(app.getPath('userData'), 'inkslip-preferences.json');
const bundledThemes = path.join(__dirname, '../assets/themes');
const userThemes = () => path.join(app.getPath('userData'), 'themes');
let availableThemes = [];
let selectedTheme;
let spellService;
const getSpellService = () => spellService ||= createSpellService(path.join(app.getPath('userData'), 'spelling-words.json'));
async function getPreferences() {
  const config = await imageService.loadPreferences(preferencesFile());
  if (!config.image.picgoPath) {
    const candidates = process.platform === 'darwin'
      ? ['/Applications/PicGo.app', path.join(app.getPath('home'), 'Applications/PicGo.app')]
      : [path.join(app.getPath('appData'), '../Local/Programs/PicGo/PicGo.exe'), 'C:\\software\\PicGo\\PicGo.exe', 'D:\\Software\\PicGo\\PicGo.exe'];
    for (const executable of candidates) {
      if (await fs.access(executable).then(() => true, () => false)) { config.image.picgoPath = executable; break; }
    }
  }
  return config;
}
const indexPath = path.join(__dirname, '../dist/index.html');
const devUrl = process.env.SHOW_MD_DEV_URL;
protocol.registerSchemesAsPrivileged([{ scheme: 'inkslip-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (devUrl) {
  const url = new URL(devUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('SHOW_MD_DEV_URL must be an HTTP loopback URL.');
  }
}

const revision = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function diskRevision(filePath) {
  try {
    return revision(await fs.readFile(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function trustedSender(event) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}

function mayDiscard() {
  if (!dirty) return true;
  return localizedDialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['取消', '放弃更改'],
    defaultId: 0,
    cancelId: 0,
    title: '有尚未保存的更改',
    message: '当前文档尚未保存。',
    detail: '放弃更改后，这些内容将无法恢复。',
    noLink: true,
  }) === 1;
}

async function fileOperation(event, action) {
  if (!trustedSender(event)) return { status: 'error', message: '无效的窗口请求。' };
  if (operationBusy) return { status: 'error', message: '文件操作正在进行，请稍后重试。' };
  operationBusy = true;
  try {
    return await action();
  } catch (error) {
    return { status: 'error', message: error.message };
  } finally {
    operationBusy = false;
  }
}

async function rememberDocument(filePath) {
  recentFiles = [filePath, ...recentFiles.filter(file => file !== filePath)].slice(0, 20);
  await fs.writeFile(path.join(app.getPath('userData'), 'recent-documents.json'), JSON.stringify(recentFiles));
  refreshNativeMenu();
}
async function readDocument(filePath, encoding = 'auto') {
  const bytes = await fs.readFile(filePath);
  activeEncoding = encoding === 'auto' ? bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf16be' : 'utf8' : encoding;
  if (!iconv.encodingExists(activeEncoding)) throw Error('不支持的文件编码');
  activePath = filePath;
  await rememberDocument(filePath);
  dirty = false;
  return { path: filePath, content: iconv.decode(bytes, activeEncoding), revision: revision(bytes), encoding: activeEncoding };
}

const markdownExtensions = new Set(['.md', '.markdown', '.mdown', '.txt']);

async function libraryPath(value) {
  if (!folderRoot || typeof value !== 'string') throw new Error('请先打开文件夹。');
  const resolved = await fs.realpath(value);
  const relative = path.relative(folderRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('只能访问已打开文件夹中的内容。');
  }
  return resolved;
}

async function folderEntries(folder) {
  return library.entries(folder);
}

ipcMain.handle('desktop:new', event => fileOperation(event, async () => {
  if (!mayDiscard()) return { status: 'cancelled' };
  activePath = null;
  activeEncoding = 'utf8';
  dirty = false;
  return { status: 'ok' };
}));

ipcMain.handle('desktop:open-folder', (event, requestedPath) => fileOperation(event, async () => {
  const history = path.join(app.getPath('userData'), 'recent-folders.json');
  if (requestedPath && !(await library.recent(history)).some(item => item.path === requestedPath)) throw Error('请选择最近位置中的文件夹。');
  const result = requestedPath ? { filePaths: [requestedPath] } : await localizedDialog.showOpenDialog(window, {
    title: '打开文件夹', defaultPath: folderRoot || app.getPath('documents'), properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
  const root = await fs.realpath(result.filePaths[0]);
  const entries = await folderEntries(root);
  await library.updateRecent(history, root);
  folderRoot = root;
  libraryUndo = null;
  return { root, entries };
}));

ipcMain.handle('desktop:recent-folders', (event, request = {}) => fileOperation(event, async () => {
  const file = path.join(app.getPath('userData'), 'recent-folders.json');
  if (request.action) {
    if (!['pin', 'remove'].includes(request.action) || !(await library.recent(file)).some(item => item.path === request.path)) throw Error('无效的最近位置操作。');
    return library.updateRecent(file, request.path, request.action);
  }
  return library.recent(file);
}));
ipcMain.handle('desktop:scan-folder', event => fileOperation(event, async () => library.scan(await libraryPath(folderRoot))));
ipcMain.handle('desktop:search-folder', (event, query) => fileOperation(event, async () => library.search(await libraryPath(folderRoot), query)));
async function creationFolder(selected) {
  const target = await libraryPath(selected || folderRoot);
  return (await fs.stat(target)).isDirectory() ? target : path.dirname(target);
}
ipcMain.handle('desktop:new-library-file', (event, selected) => fileOperation(event, async () => {
  const file = await library.newFile(await creationFolder(selected));
  libraryUndo = null;
  if (dirty || activePath) return { status: 'created', path: file };
  return readDocument(file);
}));
ipcMain.handle('desktop:rename-library-file', (event, request) => fileOperation(event, async () => {
  const source = await libraryPath(request.path), name = request.name?.trim();
  const directory = (await fs.stat(source)).isDirectory();
  if (source === folderRoot) throw Error('不能重命名已打开的根文件夹。');
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || !directory && !markdownExtensions.has(path.extname(name).toLowerCase())) throw Error('请输入有效的文件或文件夹名称。');
  const target = path.join(path.dirname(source), name);
  if (source === target) return { path: target };
  try { await fs.access(target); throw Error('同名文件已经存在。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(source, target);
  libraryUndo = { from: source, to: target };
  if (activePath === source || directory && activePath?.startsWith(source + path.sep)) { activePath = target + activePath.slice(source.length); await rememberDocument(activePath); }
  return { path: target, documentPath: activePath, undoLabel: '重命名' };
}));
ipcMain.handle('desktop:library-operation', (event, request) => fileOperation(event, async () => {
  if (request?.action === 'undo') {
    if (!libraryUndo) throw Error('没有可撤销的文件操作。');
    const { from, to } = libraryUndo;
    await libraryPath(to);
    try { await fs.access(from); throw Error('原名称已被占用，无法撤销。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(to, from); libraryUndo = null;
    if (activePath === to || activePath?.startsWith(to + path.sep)) { activePath = from + activePath.slice(to.length); await rememberDocument(activePath); }
    return { path: from, documentPath: activePath, undoLabel: null };
  }
  const target = await libraryPath(request?.path), directory = (await fs.stat(target)).isDirectory();
  if (request.action === 'new-folder') { libraryUndo = null; return { path: await library.newFolder(await creationFolder(target)) }; }
  if (request.action === 'open-window') {
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--inkslip-window', '--inkslip-root', directory ? target : folderRoot, '--inkslip-open', target];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = require('node:child_process').spawn(process.execPath, args, { env, detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    return { status: 'ok' };
  }
  if (request.action === 'properties') return showProperties(target);
  if (target === folderRoot) throw Error('不能修改已打开的根文件夹。');
  if (request.action === 'duplicate' && !directory) {
    libraryUndo = null; const result = { path: await library.duplicate(target) };
    if (!activePath && !dirty || activePath === target && !dirty) result.document = await readDocument(result.path);
    return result;
  }
  if (request.action === 'delete') {
    const affectsDocument = activePath === target || directory && activePath?.startsWith(target + path.sep);
    const answer = await localizedDialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '移至回收站'], defaultId: 0, cancelId: 0, message: `将${directory ? '文件夹' : '文件'}移至回收站？`, detail: target });
    if (answer.response !== 1 || affectsDocument && !mayDiscard()) return { status: 'cancelled' };
    await shell.trashItem(target); libraryUndo = null;
    recentFiles = recentFiles.filter(file => file !== target && !(directory && file.startsWith(target + path.sep)));
    await fs.writeFile(path.join(app.getPath('userData'), 'recent-documents.json'), JSON.stringify(recentFiles)); refreshNativeMenu();
    if (affectsDocument) { activePath = null; dirty = false; activeEncoding = 'utf8'; }
    return { removed: target, ...(affectsDocument ? { document: { path: null, content: '', revision: null } } : {}) };
  }
  throw Error('无效的文件操作。');
}));
let startupLoaded = false;
ipcMain.handle('desktop:startup-document', event => fileOperation(event, async () => {
  if (startupLoaded || !windowSession) return null;
  startupLoaded = true;
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  if (!process.argv.includes('--inkslip-root') || !process.argv.includes('--inkslip-open')) throw Error('启动路径不完整。');
  folderRoot = await fs.realpath(arg('--inkslip-root'));
  const target = await libraryPath(arg('--inkslip-open'));
  await library.updateRecent(path.join(app.getPath('userData'), 'recent-folders.json'), folderRoot);
  return { root: folderRoot, entries: await folderEntries(folderRoot), document: (await fs.stat(target)).isDirectory() ? { path: null, content: '', revision: null } : await readDocument(target) };
}));
ipcMain.handle('desktop:open-library-folder', event => fileOperation(event, async () => {
  const error = await shell.openPath(await libraryPath(folderRoot));
  if (error) throw Error(error);
  return { status: 'ok' };
}));

ipcMain.handle('desktop:list-folder', (event, value) => fileOperation(event, async () => {
  const folder = await libraryPath(value);
  return { path: folder, entries: await folderEntries(folder) };
}));

ipcMain.handle('desktop:open-path', (event, value) => fileOperation(event, async () => {
  const filePath = await libraryPath(value);
  if (!markdownExtensions.has(path.extname(filePath).toLowerCase())) throw new Error('请选择 Markdown 或文本文件。');
  if (!mayDiscard()) return { status: 'cancelled' };
  return readDocument(filePath);
}));

ipcMain.handle('desktop:open-example', event => fileOperation(event, async () => {
  if (!mayDiscard()) return { status: 'cancelled' };
  return readDocument(path.join(app.getAppPath(), 'examples', '完整Markdown示例.md'));
}));

ipcMain.handle('desktop:open', (event) => fileOperation(event, async () => {
  if (!mayDiscard()) return { status: 'cancelled' };
  const result = await localizedDialog.showOpenDialog(window, {
    title: '打开 Markdown 文档',
    defaultPath: activePath || app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
  const filePath = result.filePaths[0];
  return readDocument(filePath);
}));

ipcMain.handle('desktop:save', (event, request) => fileOperation(event, async () => {
  if (!request || typeof request.content !== 'string') {
    return { status: 'error', message: '文档内容无效。' };
  }
  let filePath = request.path;
  let expectedRevision = request.expectedRevision;
  if (request.saveAs || !filePath) {
    const result = await localizedDialog.showSaveDialog(window, {
      title: '保存 Markdown 文档',
      defaultPath: request.path === activePath && activePath
        ? activePath
        : path.join(app.getPath('documents'), '未命名.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    filePath = result.filePath;
    if (filePath !== activePath || typeof expectedRevision !== 'string') {
      expectedRevision = await diskRevision(filePath);
    }
  } else if (filePath !== activePath || typeof expectedRevision !== 'string') {
    return { status: 'error', message: '请先打开文档，或使用另存为。' };
  }

  const conflict = { status: 'conflict', message: '文件已被其他程序修改。请另存为，或重新打开文件后再编辑。' };
  if (await diskRevision(filePath) !== expectedRevision) return conflict;
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const bytes = iconv.encode(request.content, activeEncoding, { addBOM: /^utf16/.test(activeEncoding) });
  let tempCreated = false;
  try {
    const handle = await fs.open(tempPath, 'wx');
    tempCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (await diskRevision(filePath) !== expectedRevision) return conflict;
    await fs.rename(tempPath, filePath);
    tempCreated = false;
    activePath = filePath;
    await rememberDocument(filePath);
    return { path: filePath, revision: revision(bytes) };
  } finally {
    if (tempCreated) await fs.unlink(tempPath).catch(() => {});
  }
}));

ipcMain.on('desktop:dirty', (event, value) => {
  if (trustedSender(event) && typeof value === 'boolean') dirty = value;
});
ipcMain.handle('desktop:link', async (event, value) => {
  if (!trustedSender(event) || typeof value !== 'string' || !/^(https?:|mailto:)/i.test(value)) return;
  await shell.openExternal(value);
});


ipcMain.handle('desktop:clipboard-read', event => trustedSender(event) ? clipboard.readText() : '');
ipcMain.handle('desktop:spelling-check', async (event, words) => {
  if (!trustedSender(event) || !Array.isArray(words) || words.some(word => typeof word !== 'string' || word.length > 100)) throw Error('拼写请求无效');
  return (await getSpellService()).check(words);
});
ipcMain.handle('desktop:spelling-suggest', async (event, word) => {
  if (!trustedSender(event) || typeof word !== 'string' || word.length > 100) throw Error('拼写请求无效');
  return (await getSpellService()).suggest(word);
});
ipcMain.handle('desktop:spelling-learn', async (event, word) => {
  if (!trustedSender(event)) throw Error('拼写请求无效'); await (await getSpellService()).learn(word); return { status: 'ok' };
});
ipcMain.handle('desktop:pandoc-pick', event => fileOperation(event, async () => {
  const result = await localizedDialog.showOpenDialog(window, { title: '选择 Pandoc', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Pandoc', extensions: ['exe'] }] } : {}) });
  return result.canceled ? { status: 'cancelled' } : { status: 'ok', path: result.filePaths[0] };
}));
ipcMain.handle('desktop:image-folder', (event, request = {}) => fileOperation(event, async () => {
  if (request.documentPath !== undefined && request.documentPath !== activePath) throw Error('文档已切换');
  const result = await localizedDialog.showOpenDialog(window, { title: request.purpose === 'root' ? '设置图片根目录' : '选择图片文件夹', defaultPath: activePath ? path.dirname(activePath) : app.getPath('pictures'), properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
  const folder = await fs.realpath(result.filePaths[0]);
  const relative = activePath ? path.relative(path.dirname(activePath), folder) : '';
  return { status: 'ok', path: folder, relativePath: activePath && !path.isAbsolute(relative) ? relative.replaceAll('\\', '/') || '.' : folder.replaceAll('\\', '/') };
}));
ipcMain.handle('desktop:image-files', (event, request) => fileOperation(event, async () => {
  if (!request || !['undo', 'redo'].includes(request.operation) && request.documentPath !== activePath) throw Error('文档已切换');
  if (['copy', 'move'].includes(request.operation) && !request.destination) {
    const result = await localizedDialog.showOpenDialog(window, { title: request.operation === 'copy' ? '复制所有图片到' : '移动所有图片到', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
    request.destination = result.filePaths[0];
  }
  const result = await imageFiles(request, { preferences: await getPreferences(), trashItem: file => shell.trashItem(file), backupDirectory: path.join(app.getPath('userData'), 'image-history') });
  for (const entry of result.sources || []) if (entry.path) selectedImages.add(entry.path);
  return result;
}));
ipcMain.handle('desktop:convert-document', (event, request) => fileOperation(event, async () => {
  if (!request || !['import', 'export-docx'].includes(request.action)) throw Error('文档转换请求无效');
  const config = await getPreferences();
  await converter.findPandoc({ configuredPath: config.export.pandocPath });
  if (request.action === 'import') {
    if (!mayDiscard()) return { status: 'cancelled' };
    const source = await localizedDialog.showOpenDialog(window, { title: '导入文档', properties: ['openFile'], filters: [{ name: 'Pandoc 文档', extensions: ['docx', 'odt', 'html', 'htm', 'rst', 'org', 'wiki', 'tex', 'epub', 'rtf', 'txt'] }] });
    if (source.canceled || !source.filePaths[0]) return { status: 'cancelled' };
    const output = await localizedDialog.showSaveDialog(window, { title: '保存导入的 Markdown 文档', defaultPath: path.join(path.dirname(source.filePaths[0]), path.parse(source.filePaths[0]).name + '.md'), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (output.canceled || !output.filePath) return { status: 'cancelled' };
    const result = await converter.importDocument(source.filePaths[0], output.filePath, { pandocPath: config.export.pandocPath });
    return { ...await readDocument(result.filePath), warnings: result.warnings };
  }
  if (typeof request.markdown !== 'string') throw Error('导出内容无效');
  const output = await localizedDialog.showSaveDialog(window, { title: '导出 Word', defaultPath: path.join(activePath ? path.dirname(activePath) : app.getPath('documents'), (activePath ? path.parse(activePath).name : '未命名') + '.docx'), filters: [{ name: 'Word', extensions: ['docx'] }] });
  if (output.canceled || !output.filePath) return { status: 'cancelled' };
  if (activePath && path.resolve(output.filePath).toLowerCase() === activePath.toLowerCase()) throw Error('导出文件不能覆盖当前文档');
  const { getImageRoot, resolveImageSource } = await import('../shared/image-paths.js');
  const root = getImageRoot(request.markdown), resourceUrl = root && resolveImageSource('.', activePath, root);
  const result = await converter.exportDocument({ markdown: request.markdown, sourcePath: activePath, outputPath: output.filePath, pandocPath: config.export.pandocPath, resourcePath: resourceUrl && /^file:/i.test(resourceUrl) ? fileURLToPath(resourceUrl) : undefined });
  return { status: 'ok', path: result.filePath, warnings: result.warnings };
}));
async function showProperties(file) {
  await fs.access(file);
  if (process.platform === 'darwin') {
    await executeFile('osascript', ['-e', 'on run argv\n tell application "Finder" to open information window of (POSIX file (item 1 of argv) as alias)\nend run', file], { timeout: 15000 });
    return { status: 'ok', path: file };
  }
  // PowerShell cannot read scripts inside app.asar; materialize the bundled helper for this invocation.
  const helperDirectory = await fs.mkdtemp(path.join(app.getPath('temp'), 'inkslip-properties-'));
  try {
    const helper = path.join(helperDirectory, 'show-file-properties.ps1');
    await fs.writeFile(helper, await fs.readFile(path.join(__dirname, '../assets/show-file-properties.ps1')));
    await executeFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', helper, '-DocumentPath', file], { windowsHide: true, timeout: 15000 });
  } finally { await fs.rm(helperDirectory, { recursive: true, force: true }); }
  return { status: 'ok', path: file };
}
ipcMain.handle('desktop:file-properties', event => fileOperation(event, async () => {
  if (!activePath) throw Error('请先保存或打开文档');
  return showProperties(activePath);
}));
ipcMain.handle('desktop:recent-documents', event => trustedSender(event) ? recentFiles : []);
ipcMain.handle('desktop:document-operation', (event, request) => fileOperation(event, async () => {
  if (!request || typeof request.action !== 'string') throw Error('文件操作无效');
  if (request.action === 'clear-recent') { recentFiles = []; await fs.writeFile(path.join(app.getPath('userData'), 'recent-documents.json'), '[]'); refreshNativeMenu(); return { status: 'ok' }; }
  if (request.action === 'open-recent') {
    if (!recentFiles.includes(request.path) || !mayDiscard()) return { status: 'cancelled' };
    return readDocument(request.path);
  }
  if (!activePath) throw Error('请先保存当前文档');
  if (request.action === 'reopen-encoding') {
    if (!mayDiscard()) return { status: 'cancelled' };
    if (typeof request.encoding !== 'string' || !iconv.encodingExists(request.encoding === 'auto' ? 'utf8' : request.encoding)) throw Error('不支持的文件编码');
    return readDocument(activePath, request.encoding);
  }
  if (request.action === 'duplicate' || request.action === 'rename') {
    if (dirty) throw Error('请先保存当前修改');
    const result = await localizedDialog.showSaveDialog(window, { title: request.action === 'duplicate' ? '创建副本' : '重命名 / 移动文档', defaultPath: activePath, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled) return { status: 'cancelled' };
    if (path.resolve(result.filePath) === path.resolve(activePath)) return { status: 'cancelled' };
    await fs.copyFile(activePath, result.filePath, 1);
    if (request.action === 'rename') await fs.unlink(activePath);
    return readDocument(result.filePath, activeEncoding);
  }
  if (request.action === 'delete') {
    const answer = await localizedDialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '移至回收站'], defaultId: 0, cancelId: 0, message: '将当前文档移至回收站？', detail: activePath });
    if (answer.response !== 1 || !mayDiscard()) return { status: 'cancelled' };
    const removed = activePath; await shell.trashItem(removed);
    recentFiles = recentFiles.filter(file => file !== removed); activePath = null; activeEncoding = 'utf8'; dirty = false;
    return { path: null, content: '', revision: null };
  }
  throw Error('未知的文件操作');
}));
ipcMain.handle('desktop:clipboard-write', async (event, value) => {
  if (!trustedSender(event) || typeof value !== 'string') return { status: 'error', message: '无效的剪贴板请求。' };
  await clipboard.writeText(value);
  return { status: 'ok' };
});
async function pasteImages(event, request, fromClipboard = false) {
  try {
    if (!trustedSender(event) || !request || request.documentPath !== activePath) throw Error('文档已切换，请重新粘贴');
    const documentPath = activePath;
    const images = fromClipboard ? await imageClipboard.readClipboardImages(clipboard) : request.images;
    if (!Array.isArray(images) || images.length > 20) throw Error('一次最多粘贴 20 张图片');
    const prepared = images.map(image => {
      const bytes = Buffer.from(image.bytes);
      if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw Error('图片不能超过 30 MB');
      return { bytes, extension: imageClipboard.imageExtension(bytes) };
    });
    if (!prepared.length) return { status: 'ok', sources: [] };
    await preferencesWrite;
    const config = (await getPreferences()).image;
    const folder = documentPath ? path.join(path.dirname(documentPath), path.parse(documentPath).name + '.assets') : path.join(app.getPath('userData'), 'pasted-images');
    await fs.mkdir(folder, { recursive: true });
    const sources = [];
    for (const image of prepared) {
      const imagePath = path.join(folder, `image-${randomUUID()}${image.extension}`);
      await fs.writeFile(imagePath, image.bytes, { flag: 'wx' });
      selectedImages.add(await fs.realpath(imagePath));
      let source = documentPath && config.preferRelative ? path.relative(path.dirname(documentPath), imagePath).replaceAll('\\', '/') : imagePath.replaceAll('\\', '/');
      if (documentPath && config.preferRelative && config.addDotSlash) source = './' + source;
      if (config.escapeUrl) source = source.split('/').map(part => encodeURIComponent(part).replaceAll('%3A', ':')).join('/');
      sources.push(source);
    }
    if (activePath !== documentPath) throw Error('文档已切换，请重新粘贴');
    return { status: 'ok', sources };
  } catch (error) { return { status: 'error', message: error.message }; }
}
ipcMain.handle('desktop:clipboard-images', (event, request) => pasteImages(event, request, true));
ipcMain.handle('desktop:paste-images', (event, request) => pasteImages(event, request));
ipcMain.handle('desktop:pick-image', event => fileOperation(event, async () => {
  const result = await localizedDialog.showOpenDialog(window, {
    title: '插入本地图片', defaultPath: activePath ? path.dirname(activePath) : app.getPath('pictures'),
    properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
  const imagePath = await fs.realpath(result.filePaths[0]);
  selectedImages.add(imagePath);
  const config = (await getPreferences()).image;
  let source = imagePath.replaceAll('\\', '/');
  if (activePath && config.preferRelative) {
    const relative = path.relative(path.dirname(activePath), imagePath);
    if (!path.isAbsolute(relative)) {
      source = relative.replaceAll('\\', '/');
      if (config.addDotSlash && !source.startsWith('../')) source = './' + source;
    }
  }
  if (config.escapeUrl) source = source.split('/').map(part => encodeURIComponent(part).replaceAll('%3A', ':')).join('/');
  return { status: 'ok', path: source };
}));
ipcMain.handle('desktop:preferences-get', async event => {
  if (!trustedSender(event)) throw Error('无效的窗口请求。');
  await preferencesWrite;
  return getPreferences();
});
ipcMain.handle('desktop:themes-list', async event => {
  if (!trustedSender(event)) throw Error('无效的窗口请求。');
  availableThemes = await themeService.listThemes(bundledThemes, userThemes()); refreshNativeMenu(); return availableThemes;
});
ipcMain.handle('desktop:theme-load', async (event, id) => {
  if (!trustedSender(event)) throw Error('无效的窗口请求。');
  return themeService.loadTheme(bundledThemes, userThemes(), id);
});
ipcMain.handle('desktop:theme-folder', async event => {
  if (!trustedSender(event)) throw Error('无效的窗口请求。');
  await fs.mkdir(userThemes(), { recursive: true }); const error = await shell.openPath(userThemes()); if (error) throw Error(error);
  return userThemes();
});
ipcMain.handle('desktop:system-theme', event => {
  if (!trustedSender(event)) return false;
  nativeTheme.themeSource = 'system'; return nativeTheme.shouldUseDarkColors;
});
ipcMain.on('desktop:theme-applied', (event, id, dark, separate) => {
  if (!trustedSender(event)) return;
  selectedTheme = id;
  if (!separate && typeof dark === 'boolean') nativeTheme.themeSource = dark ? 'dark' : 'system';
  refreshNativeMenu();
});
ipcMain.handle('desktop:preferences-set', (event, input) => {
  if (!trustedSender(event)) throw Error('无效的窗口请求。');
  const config = imageService.normalizePreferences(input);
  const pending = preferencesWrite.then(async () => {
    const saved = await imageService.savePreferences(preferencesFile(), config);
    interfaceLanguage = resolveLanguage(saved.general.language, app.getLocale());
    refreshNativeMenu();
    return saved;
  });
  preferencesWrite = pending.catch(() => {});
  return pending;
});
ipcMain.handle('desktop:picgo-pick', (event, kind) => fileOperation(event, async () => {
  const result = await localizedDialog.showOpenDialog(window, {
    title: kind === 'picgo-cli' ? '选择 PicGo-Core' : '选择 PicGo 应用', properties: ['openFile'],
    ...(process.platform === 'win32' ? { filters: [{ name: 'PicGo', extensions: kind === 'picgo-cli' ? ['exe', 'js', 'cjs', 'mjs'] : ['exe'] }] } : {}),
  });
  return result.canceled ? null : result.filePaths[0];
}));
async function runImageUpload(event, request, test = false) {
  if (!trustedSender(event)) return { status: 'error', message: '无效的窗口请求。' };
  if (imageUploadBusy) return { status: 'error', message: '正在上传图片，请等待完成。' };
  imageUploadBusy = true;
  try {
    if (!test && (!request || request.documentPath !== activePath)) throw Error('文档已经切换，请重新选择图片。');
    let source = request?.source;
    if (test) {
      const result = await localizedDialog.showOpenDialog(window, { title: '选择一张测试图片（将上传至当前 PicGo 图床）', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'] }] });
      if (result.canceled) return { ok: false, status: 'cancelled', message: '已取消验证。' };
      source = result.filePaths[0];
    }
    await preferencesWrite;
    const preferences = test && request ? imageService.normalizePreferences(request) : await getPreferences();
    const result = await imageService.uploadImage({ source, documentPath: activePath, preferences });
    return test ? { ...result, ok: true, message: `验证成功：${result.url}` } : result;
  } catch (error) { return { status: 'error', ok: false, message: error.message }; }
  finally { imageUploadBusy = false; }
}
ipcMain.handle('desktop:image-upload', (event, request) => runImageUpload(event, request));
ipcMain.handle('desktop:image-upload-test', (event, preferences) => runImageUpload(event, preferences, true));
ipcMain.handle('desktop:image-copy-content', (event, request) => fileOperation(event, async () => {
  if (!request || request.documentPath !== activePath) throw Error('文档已切换');
  const prepared = await imageService.prepareImage(request.source, activePath, 60000);
  try {
    const image = nativeImage.createFromBuffer(await fs.readFile(prepared.file));
    if (image.isEmpty()) throw Error('无法复制此图片格式');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
    return { status: 'ok' };
  } finally { await prepared.cleanup(); }
}));
ipcMain.handle('desktop:image-file', (event, request) => fileOperation(event, async () => {
  if (!request || request.documentPath !== activePath || !['reveal', 'open', 'copy', 'move'].includes(request.action) || typeof request.source !== 'string' || /^(https?:|data:)/i.test(request.source)) throw Error('图片文件请求无效。');
  const original = await fs.realpath(/^file:/i.test(request.source) ? fileURLToPath(request.source) : path.resolve(activePath ? path.dirname(activePath) : '.', decodeURIComponent(request.source)));
  if (!/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(original)) throw Error('不支持的图片文件。');
  if (request.action === 'reveal') { shell.showItemInFolder(original); return { status: 'ok' }; }
  if (request.action === 'open') { const error = await shell.openPath(original); if (error) throw Error(error); return { status: 'ok' }; }
  const result = await localizedDialog.showSaveDialog(window, { title: request.action === 'copy' ? '复制图片到' : '重命名/移动图片到', defaultPath: original, filters: [{ name: '图片', extensions: [path.extname(original).slice(1)] }] });
  if (result.canceled) return { status: 'cancelled' };
  const target = path.resolve(result.filePath);
  if (target.toLowerCase() === original.toLowerCase()) return { status: 'cancelled' };
  if (activePath && target.toLowerCase() === path.resolve(activePath).toLowerCase()) throw Error('图片文件不能覆盖当前 Markdown 文档。');
  await fs.copyFile(original, target, require('node:fs').constants.COPYFILE_EXCL);
  if (request.action === 'move') {
    try { await fs.unlink(original); }
    catch (error) { await fs.unlink(target); throw error; }
  }
  selectedImages.add(target);
  const config = (await getPreferences()).image;
  let source = target.replaceAll('\\', '/');
  if (activePath && config.preferRelative) {
    const relative = path.relative(path.dirname(activePath), target);
    if (!path.isAbsolute(relative)) source = (config.addDotSlash && !relative.startsWith('..') ? './' : '') + relative.replaceAll('\\', '/');
  }
  if (config.escapeUrl) source = source.split('/').map(part => encodeURIComponent(part).replaceAll('%3A', ':')).join('/');
  return { status: 'ok', source };
}));
ipcMain.handle('desktop:reveal-file', (event, value) => fileOperation(event, async () => {
  if (value !== undefined && typeof value !== 'string') throw new Error('文件路径无效。');
  if (!value && !activePath) return { status: 'error', message: '请先保存或打开文档。' };
  const filePath = !value || value === activePath ? activePath : await libraryPath(value);
  shell.showItemInFolder(filePath);
  return { status: 'ok' };
}));
ipcMain.handle('desktop:window-action', (event, command) => {
  if (!trustedSender(event)) return { status: 'error', message: '无效的窗口请求。' };
  if (command === 'close') window.close();
  else if (command === 'devtools') window.webContents.isDevToolsOpened() ? window.webContents.closeDevTools() : window.webContents.openDevTools({ mode: 'detach' });
  else if (command === 'minimize') window.minimize();
  else if (command === 'maximize') window.isFullScreen() ? window.setFullScreen(false) : window.isMaximized() ? window.unmaximize() : window.maximize();
  else if (command === 'always-on-top') window.setAlwaysOnTop(!window.isAlwaysOnTop());
  else if (command === 'fullscreen') window.setFullScreen(!window.isFullScreen());
  else if (command === 'zoom-reset') window.webContents.setZoomFactor(1);
  else if (command === 'zoom-in' || command === 'zoom-out') {
    const zoom = window.webContents.getZoomFactor() + (command === 'zoom-in' ? 0.1 : -0.1);
    window.webContents.setZoomFactor(Math.max(0.5, Math.min(2, Math.round(zoom * 10) / 10)));
  } else return { status: 'error', message: '未知的窗口操作。' };
  return { status: 'ok' };
});

ipcMain.handle('desktop:window-preferences', (event, appearance) => {
  if (!trustedSender(event) || !appearance || !['classic', 'unibody'].includes(appearance.windowStyle) || !Number.isInteger(appearance.zoomLevel) || appearance.zoomLevel < -3 || appearance.zoomLevel > 6) return { status: 'error', message: '窗口设置无效' };
  window.webContents.setZoomLevel(appearance.zoomLevel);
  return { windowStyle, zoomLevel: appearance.zoomLevel, restartRequired: windowStyle !== appearance.windowStyle };
});

async function exportHtml(html) {
  const imageTags = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)];
  const replacements = await Promise.all(imageTags.map(async match => {
    const source = match[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (/^(https?:|data:)/i.test(source)) return null;
    try {
      let imagePath;
      if (/^inkslip-image:/i.test(source)) {
        const local = new URL(source).searchParams.get('src');
        if (!local) return null;
        imagePath = /^file:/i.test(local) ? fileURLToPath(local) : path.resolve(activePath ? path.dirname(activePath) : app.getPath('documents'), decodeURIComponent(local));
      } else {
        imagePath = /^file:/i.test(source) ? fileURLToPath(source) : path.resolve(activePath ? path.dirname(activePath) : app.getPath('documents'), decodeURIComponent(source));
      }
      if (!activePath && !selectedImages.has(imagePath)) return null;
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon' };
      const type = types[path.extname(imagePath).toLowerCase()];
      if (!type) return null;
      const bytes = await fs.readFile(imagePath);
      return { from: match[0], to: match[0].replace(match[2], 'data:' + type + ';base64,' + bytes.toString('base64')) };
    } catch {
      return null;
    }
  }));
  for (const replacement of replacements) if (replacement) html = html.replace(replacement.from, replacement.to);
  return html;
}

ipcMain.handle('desktop:export', (event, request) => fileOperation(event, async () => {
  if (!request || !['html', 'pdf', 'print'].includes(request.format) || typeof request.html !== 'string') {
    return { status: 'error', message: '导出内容无效。' };
  }
  let exportPath;
  if (request.format !== 'print') {
    const result = await localizedDialog.showSaveDialog(window, {
      title: request.format === 'pdf' ? '导出 PDF' : '导出 HTML',
      defaultPath: path.join(activePath ? path.dirname(activePath) : app.getPath('documents'),
        (activePath ? path.basename(activePath, path.extname(activePath)) : '未命名') + '.' + request.format),
      filters: [{ name: request.format.toUpperCase(), extensions: [request.format] }],
    });
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    exportPath = result.filePath;
    if (activePath && path.resolve(exportPath).toLowerCase() === path.resolve(activePath).toLowerCase()) {
      return { status: 'error', message: '导出文件不能覆盖当前 Markdown 文档。' };
    }
  }
  const html = await exportHtml(request.html);
  if (request.format === 'html') {
    await fs.writeFile(exportPath, html, 'utf8');
    return { status: 'ok', path: exportPath };
  }
  const printWindow = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  printWindow.webContents.on('will-navigate', event => event.preventDefault());
  try {
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    if (request.format === 'pdf') {
      const bytes = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
      await fs.writeFile(exportPath, bytes);
      return { status: 'ok', path: exportPath };
    }
    const result = await new Promise(resolve => printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      resolve(success ? { status: 'ok' } : { status: 'error', message: failureReason || '打印已取消。' });
    }));
    return result;
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}));

function nativeMenuItems(items) {
  items = items.map(item => item.id === 'recent-documents' ? { ...item, items: [...(recentFiles.length ? recentFiles.map(file => ({ id: 'open-recent', label: path.basename(file), context: { path: file } })) : [item.items[0]]), ...item.items.slice(1)] } : item);
  return items.map(item => item.type === 'separator' ? { type: 'separator' } : {
    label: item.context?.path ? item.label : t(item.label),
    enabled: item.enabled !== false,
    ...(item.shortcut ? { accelerator: item.shortcut.replace(/Arrow/g, '').replace(/^Ctrl\+/, 'CommandOrControl+'), registerAccelerator: false } : {}),
    ...(item.items ? { submenu: nativeMenuItems(item.items) } : { click: () => window?.webContents.send('desktop:command', item.id, item.context) }),
  });
}

function refreshNativeMenu() {
  const appMenu = { label: 'Inkslip', submenu: [
    { role: 'about', label: t('关于墨简') }, { type: 'separator' },
    { label: t('偏好设置'), accelerator: 'Command+,', click: () => window?.webContents.send('desktop:command', 'preferences') },
    { type: 'separator' }, { role: 'services', label: t('服务') }, { type: 'separator' },
    { role: 'hide', label: t('隐藏墨简') }, { role: 'hideOthers', label: t('隐藏其他应用') }, { role: 'unhide', label: t('显示全部') },
    { type: 'separator' }, { role: 'quit', label: t('退出墨简') },
  ] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [appMenu] : []), ...menuSpec.map(group => ({ label: t(group.label), submenu: group.label === '主题' && availableThemes.length ? [
    ...availableThemes.map(theme => ({ label: theme.name, type: 'radio', checked: selectedTheme === theme.id, click: () => window?.webContents.send('desktop:command', 'theme-select', { theme: theme.id }) })),
    { type: 'separator' }, { label: t('打开主题文件夹'), click: () => window?.webContents.send('desktop:command', 'theme-folder') },
    { label: t('重新加载主题'), click: () => window?.webContents.send('desktop:command', 'theme-reload') },
  ] : nativeMenuItems(group.items) }))]));
  if (process.platform !== 'darwin' && windowStyle === 'unibody' && window) window.removeMenu();
}

async function createWindow() {
  const preferences = await getPreferences();
  interfaceLanguage = resolveLanguage(preferences.general.language, app.getLocale());
  refreshNativeMenu();
  windowStyle = preferences.appearance.windowStyle || 'classic';
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 780,
    minHeight: 560,
    title: t('墨简'),
    icon: path.join(__dirname, process.platform === 'win32' ? '../assets/inkslip.ico' : '../assets/inkslip.png'),
    frame: windowStyle === 'classic',
    autoHideMenuBar: true,
    backgroundColor: '#f6f4f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform !== 'darwin') {
    window.setMenuBarVisibility(false);
    if (windowStyle === 'unibody') window.removeMenu();
  }
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomLevel(preferences.appearance.zoomLevel || 0);
    window.webContents.send('desktop:window-style', windowStyle);
    sendWindowState();
  });
  function sendWindowState(changed = {}) { window.webContents.send('desktop:window-state', { maximized: window.isMaximized(), fullscreen: window.isFullScreen(), alwaysOnTop: window.isAlwaysOnTop(), ...changed }); }
  // Electron can emit the transition before its isFullScreen() getter updates.
  for (const [event, key, value] of [['maximize', 'maximized', true], ['unmaximize', 'maximized', false], ['enter-full-screen', 'fullscreen', true], ['leave-full-screen', 'fullscreen', false]]) window.on(event, () => sendWindowState({ [key]: value }));
  window.on('always-on-top-changed', (_event, value) => sendWindowState({ alwaysOnTop: value }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (operationBusy || !mayDiscard()) event.preventDefault();
  });
  window.on('closed', () => {
    window = null;
    activePath = null;
    folderRoot = null;
    dirty = false;
  });
  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(indexPath);
}

app.whenReady().then(async () => {
  if (!process.env.INKSLIP_TEST_USER_DATA || process.env.INKSLIP_TEST_LEGACY_USER_DATA) {
    await migrateUserData(app.getPath('userData'), process.env.INKSLIP_TEST_LEGACY_USER_DATA || path.join(app.getPath('appData'), 'inkpage'));
  }
  nativeTheme.on('updated', () => window?.webContents.send('desktop:system-theme-changed', nativeTheme.shouldUseDarkColors));
  protocol.handle('inkslip-image', async request => {
    try {
      const source = new URL(request.url).searchParams.get('src');
      if (!source) return new Response('', { status: 400 });
      const decoded = decodeURIComponent(source);
      if (!activePath && !/^file:/i.test(decoded) && !path.isAbsolute(decoded)) {
        return new Response('请先保存文档以解析相对图片路径。', { status: 404 });
      }
      const imagePath = /^file:/i.test(source) ? fileURLToPath(source)
        : path.resolve(activePath ? path.dirname(activePath) : app.getPath('documents'), decoded);
      if (!activePath && !selectedImages.has(imagePath)) return new Response('', { status: 403 });
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon' };
      const type = types[path.extname(imagePath).toLowerCase()];
      if (!type) return new Response('', { status: 415 });
      return new Response(await fs.readFile(imagePath), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
  refreshNativeMenu();
  fs.readFile(path.join(app.getPath('userData'), 'recent-documents.json'), 'utf8').then(content => {
    const files = JSON.parse(content); if (Array.isArray(files)) recentFiles = files.filter(file => typeof file === 'string').slice(0, 20);
    }).catch(() => {}).then(() => { refreshNativeMenu(); return createWindow(); });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
