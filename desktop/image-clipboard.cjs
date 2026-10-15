const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return '.jpg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return '.gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return '.webp';
  if (bytes.subarray(0, 2).toString() === 'BM') return '.bmp';
  if (bytes.subarray(4, 12).toString() === 'ftypavif') return '.avif';
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return '.ico';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 4096).toString())) return '.svg';
  throw Error('剪贴板中没有受支持的图片数据');
}

function droppedFiles(bytes) {
  if (bytes.length < 20) return [];
  const offset = bytes.readUInt32LE(0);
  if (offset < 20 || offset >= bytes.length) return [];
  return bytes.subarray(offset).toString(bytes.readUInt32LE(16) ? 'utf16le' : 'latin1').split('\0').filter(Boolean);
}

async function readClipboardImages(clipboard) {
  const items = await clipboard.read();
  const images = [];
  for (const item of items) {
    const type = item.types.find(type => /^image\//i.test(type));
    if (type) {
      const blob = await item.getType(type);
      images.push({ bytes: Buffer.from(await blob.arrayBuffer()) });
      continue;
    }
    const drop = item.types.find(type => /format="?CF_HDROP"?/i.test(type));
    let files = [];
    if (drop) files = droppedFiles(Buffer.from(await (await item.getType(drop)).arrayBuffer()));
    else if (item.types.includes('text/uri-list')) {
      files = (await (await item.getType('text/uri-list')).text()).split(/\r?\n/).filter(line => /^file:/i.test(line)).map(fileURLToPath);
    }
    for (const file of files) if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path.extname(file))) {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 30 * 1024 * 1024) throw Error('图片文件不能超过 30 MB');
      images.push({ bytes: await fs.readFile(file) });
    }
  }
  return images;
}

module.exports = { imageExtension, droppedFiles, readClipboardImages };
