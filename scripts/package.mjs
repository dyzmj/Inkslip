import assert from 'node:assert/strict';
import { packager } from '@electron/packager';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify, parseArgs } from 'node:util';

const executeFile = promisify(execFile);
const { values } = parseArgs({ options: { platform: { type: 'string', default: process.platform }, arch: { type: 'string', default: process.arch }, verify: { type: 'boolean', default: false } } });
const { platform, arch } = values;
if (!['win32', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw Error('Supported targets: win32/darwin, x64/arm64.');
if (platform !== process.platform) throw Error('Build Windows on Windows and macOS on macOS to preserve native metadata and signatures.');
const project = JSON.parse(await readFile('package.json', 'utf8'));
const electronVersion = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version;
const output = path.resolve('release', project.version);
await access('dist/index.html');
await mkdir(output, { recursive: true });

let icon = path.resolve('assets/inkslip.ico');
if (platform === 'darwin') {
  const iconset = path.join(output, 'Inkslip.iconset');
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await executeFile('sips', ['-z', String(size * scale), String(size * scale), 'assets/inkslip.png', '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
    }
  }
  icon = path.join(output, 'Inkslip.icns');
  await executeFile('iconutil', ['-c', 'icns', '-o', icon, iconset]);
  await rm(iconset, { recursive: true });
}

const outputs = await packager({
  dir: '.', name: 'Inkslip', platform, arch, appVersion: project.version, electronVersion,
  out: output, overwrite: true, icon, asar: true, prune: true,
  electronZipDir: process.env.INKSLIP_ELECTRON_ZIP_DIR || undefined,
  appBundleId: 'io.github.dyzmj.inkslip', appCategoryType: 'public.app-category.productivity',
  darwinDarkModeSupport: true,
  ...(platform === 'darwin' ? { osxSign: { identity: '-', identityValidation: false, hardenedRuntime: false, gatekeeperAssess: false, preAutoEntitlements: false, continueOnError: false } } : {}),
  ignore: [/^\/(evidence|docs|tests|scripts|release|src|\.github)(\/|$)/, /^\/(README(?:\.zh-CN)?\.md|vite\.config\.js|index\.html|package-lock\.json|\.gitignore)$/],
});
const bundle = outputs[0];
const application = platform === 'darwin' ? path.join(bundle, 'Inkslip.app') : bundle;
const executable = platform === 'darwin' ? path.join(application, 'Contents/MacOS/Inkslip') : path.join(bundle, 'Inkslip.exe');
await access(executable);
if (platform === 'darwin') await executeFile('codesign', ['--verify', '--deep', '--strict', application]);

if (values.verify) {
  const { _electron: electron } = await import('playwright-core');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'inkslip-package-'));
  const file = path.join(profile, 'package-check.md');
  const text = '# Package check\n\n| Name | Value |\n| --- | --- |\n| Ink | Slip |\n';
  await writeFile(file, text);
  const env = { ...process.env, INKSLIP_TEST_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.SHOW_MD_DEV_URL;
  const app = await electron.launch({ executablePath: executable, env, timeout: 60000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.body.dataset.theme === 'vue.css');
    assert.equal((await page.evaluate(() => window.desktop.listThemes())).length, 7);
    await app.evaluate(({ BrowserWindow, dialog }, file) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      dialog.showMessageBoxSync = () => 1;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', 'open');
    }, file);
    await page.waitForFunction(() => document.getElementById('file-name').textContent === 'package-check.md');
    assert.equal(await page.locator('#editor table th').count(), 2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', 'source'));
    await page.locator('.cm-content').focus();
    await page.keyboard.press(platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('Package save verified');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', 'save'));
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存到本地');
    assert.ok((await readFile(file, 'utf8')).includes('Package save verified'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', 'preferences'));
    await page.locator('.preferences-tabs [data-section="general"]').click();
    for (const [language, title] of [['en', 'Preferences'], ['zh-TW', '偏好設定'], ['zh-CN', '偏好设置']]) {
      await page.locator('[name="general.language"]').selectOption(language);
      await page.waitForFunction(({ language, title }) => document.documentElement.lang === language && document.getElementById('preferences-title').textContent === title, { language, title });
      await page.waitForFunction(async language => (await window.desktop.getPreferences()).general.language === language, language);
      if (platform === 'darwin') {
        const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map(item => item.label));
        assert.ok(labels.includes(title));
      }
    }
    await page.locator('.preferences-close').click();
    assert.deepEqual(errors, []);
    console.log(`Verified ${platform}/${arch}: packaged startup, themes, table rendering, edit/save and three interface languages.`);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
}

const target = `${platform === 'darwin' ? 'macos' : 'windows'}-${arch}`;
const zip = path.join(output, `Inkslip-${project.version}-${target}.zip`);
await rm(zip, { force: true });
if (platform === 'darwin') await executeFile('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', application, zip]);
else await executeFile('tar.exe', ['-a', '-c', '-f', zip, '-C', path.dirname(bundle), path.basename(bundle)], { windowsHide: true });
const hash = createHash('sha256');
for await (const chunk of createReadStream(zip)) hash.update(chunk);
const sha256 = hash.digest('hex');
await writeFile(`${zip}.sha256`, `${sha256}  ${path.basename(zip)}\n`);
await writeFile(path.join(output, `${target}.json`), JSON.stringify({ version: project.version, platform, arch, zip: path.basename(zip), sha256 }, null, 2) + '\n');
console.log(`ZIP: ${zip}\nSHA-256: ${sha256}`);
