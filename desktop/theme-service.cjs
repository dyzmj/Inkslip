const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function isThemeFile(id) {
  return typeof id === 'string' && !id.startsWith('.') && !/[\\/\x00-\x1f<>:"|?*]/.test(id) && /\.css$/i.test(id) && !/\.user\.css$/i.test(id);
}

async function themeFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && isThemeFile(entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listThemes(bundledDir, userDir) {
  const themes = new Map();
  for (const [directory, source] of [[bundledDir, 'bundled'], [userDir, 'user']]) {
    for (const entry of await themeFiles(directory)) {
      const stem = entry.name.slice(0, -4);
      themes.set(entry.name.toLowerCase(), {
        id: entry.name,
        name: stem.charAt(0).toUpperCase() + stem.slice(1),
        source,
        url: pathToFileURL(path.resolve(directory, entry.name)).href,
      });
    }
  }
  return [...themes.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

async function loadTheme(bundledDir, userDir, id) {
  if (!isThemeFile(id)) throw Error('无效的主题文件名');
  const theme = (await listThemes(bundledDir, userDir)).find(theme => theme.id.toLowerCase() === id.toLowerCase());
  if (!theme) throw Error(`主题不存在：${id}`);
  const styles = [{ kind: 'theme', url: theme.url }];
  for (const [file, kind] of [['base.user.css', 'base-user'], [`${theme.id.slice(0, -4)}.user.css`, 'theme-user']]) {
    const location = path.resolve(userDir, file);
    try {
      if ((await fs.lstat(location)).isFile()) styles.push({ kind, url: pathToFileURL(location).href });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { ...theme, styles };
}

module.exports = { listThemes, loadTheme };
