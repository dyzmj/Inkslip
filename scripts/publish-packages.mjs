import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify, parseArgs } from 'node:util';

const executeFile = promisify(execFile);
const { values } = parseArgs({ options: { directory: { type: 'string', default: 'release-assets' }, publish: { type: 'boolean', default: false } } });
const repository = process.env.GITHUB_REPOSITORY || 'dyzmj/Inkslip';
const owner = repository.split('/')[0].toLowerCase();
const directory = path.resolve(values.directory);
const manifests = (await readdir(directory)).filter(file => /^(windows|macos)-(x64|arm64)\.json$/.test(file));
if (!manifests.length) throw Error('No desktop package manifests found.');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const file of manifests) {
  const manifest = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  const { version, platform, arch, zip, sha256 } = manifest;
  const expected = `Inkslip-${version}-${platform === 'darwin' ? 'macos' : 'windows'}-${arch}.zip`;
  if (!['win32', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) || zip !== expected) throw Error(`Invalid package manifest: ${file}`);
  const archive = path.join(directory, zip);
  // Each platform gets its own package, below GitHub's 256 MB npm tarball limit.
  if ((await stat(archive)).size > 250 * 1024 * 1024) throw Error(`${zip} exceeds the package size budget.`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest('hex') !== sha256) throw Error(`Checksum mismatch: ${zip}`);
  const name = `@${owner}/inkslip-${platform}-${arch}`;
  const output = path.join(directory, 'packages', `${platform}-${arch}`);
  await mkdir(output, { recursive: true });
  await copyFile(archive, path.join(output, zip));
  await writeFile(path.join(output, 'package.json'), JSON.stringify({ name, version, description: `Inkslip desktop ZIP for ${platform} ${arch}`, repository: { type: 'git', url: `https://github.com/${repository}.git` }, files: ['*.zip', 'SHA256SUMS.txt'], publishConfig: { registry: 'https://npm.pkg.github.com' } }, null, 2) + '\n');
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${sha256}  ${zip}\n`);
  await writeFile(path.join(output, 'README.md'), `# ${name}\n\nInkslip ${version} desktop application for ${platform}/${arch}. Extract the ZIP before launching. Direct downloads: https://github.com/${repository}/releases/tag/v${version}\n`);
  if (values.publish) {
    let exists = false;
    try { await executeFile(npm, ['view', `${name}@${version}`, 'version', '--registry=https://npm.pkg.github.com']); exists = true; }
    catch (error) { if (!/E404/.test(error.stderr || '')) throw error; }
    if (exists) console.log(`Already published: ${name}@${version}`);
    else {
      const { stdout } = await executeFile(npm, ['publish', output, '--registry=https://npm.pkg.github.com', '--ignore-scripts', '--tag', version.includes('-') ? 'next' : 'latest'], { maxBuffer: 1024 * 1024 });
      console.log(stdout.trim());
    }
  } else console.log(`Prepared ${name}@${version} in ${output}`);
}
