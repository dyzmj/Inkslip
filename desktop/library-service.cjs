const fs = require('node:fs/promises');
const path = require('node:path');
const iconv = require('iconv-lite');

const extensions = new Set(['.md', '.markdown', '.mdown', '.txt']);
async function entries(folder) {
  const items = await fs.readdir(folder, { withFileTypes: true });
  return Promise.all(items.filter(item => item.isDirectory() || item.isFile() && extensions.has(path.extname(item.name).toLowerCase())).map(async item => {
    const filePath = path.join(folder, item.name), stat = await fs.stat(filePath);
    return { name: item.name, path: filePath, isDirectory: item.isDirectory(), modified: stat.mtimeMs, created: stat.birthtimeMs };
  }));
}
async function scan(folder) {
  const result = [];
  for (const item of await entries(folder)) {
    if (item.isDirectory) result.push(...await scan(item.path));
    else result.push(item);
  }
  return result;
}
async function search(folder, query) {
  const needle = String(query || '').trim().toLocaleLowerCase(), matches = [];
  if (!needle) return matches;
  for (const item of await scan(folder)) {
    const bytes = await fs.readFile(item.path);
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf16be' : 'utf8';
    const lines = iconv.decode(bytes, encoding).split(/\r?\n/), hits = [];
    lines.forEach((text, index) => { if (text.toLocaleLowerCase().includes(needle)) hits.push({ line: index + 1, text }); });
    if (hits.length || item.name.toLocaleLowerCase().includes(needle)) matches.push({ ...item, hits });
  }
  return matches;
}
async function recent(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')).filter(item => typeof item.path === 'string'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function updateRecent(file, folder, action = 'open') {
  let folders = await recent(file), current = folders.find(item => item.path === folder);
  folders = folders.filter(item => item.path !== folder);
  if (action !== 'remove') folders.unshift({ path: folder, name: path.basename(folder) || folder, pinned: action === 'pin' ? !current?.pinned : Boolean(current?.pinned) });
  const pinned = folders.filter(item => item.pinned), ordinary = folders.filter(item => !item.pinned).slice(0, 20);
  folders = [...pinned, ...ordinary];
  await fs.writeFile(file, JSON.stringify(folders));
  return folders;
}
async function newFile(folder) {
  for (let index = 0; ; index++) {
    const file = path.join(folder, `Untitled${index ? ` ${index}` : ''}.md`);
    try { await fs.writeFile(file, '', { flag: 'wx' }); return file; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
async function newFolder(folder) {
  for (let index = 0; ; index++) {
    const target = path.join(folder, `Untitled Folder${index ? ` ${index}` : ''}`);
    try { await fs.mkdir(target); return target; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
async function duplicate(file) {
  const { dir, name, ext } = path.parse(file);
  let base = name;
  for (;;) {
    base += ' (copy)';
    const target = path.join(dir, base + ext);
    try { await fs.copyFile(file, target, 1); return target; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
module.exports = { entries, scan, search, recent, updateRecent, newFile, newFolder, duplicate };
