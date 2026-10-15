import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// Rasterize our vector with Chromium; Pillow writes the standard multi-size ICO.
const env = { ...process.env, INKSLIP_TEST_USER_DATA: await mkdtemp(path.join(os.tmpdir(), 'inkslip-icon-')) };
delete env.ELECTRON_RUN_AS_NODE; delete env.SHOW_MD_DEV_URL;
const app = await electron.launch({ executablePath: electronPath, args: ['.'], env });
try {
  const page = await app.firstWindow();
  const svg = await readFile('assets/inkslip.svg', 'utf8');
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:512px;height:512px}</style>${svg}`);
  await page.locator('svg').screenshot({ path: 'assets/inkslip.png', omitBackground: true });
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await app.close();
}
execFileSync('python', ['-c', "from PIL import Image; im=Image.open('assets/inkslip.png'); im.save('assets/inkslip.ico', sizes=[(n,n) for n in (16,20,24,32,40,48,64,128,256)])"], { stdio: 'inherit', windowsHide: true });
console.log('Generated assets/inkslip.png and inkslip.ico from the original SVG');
