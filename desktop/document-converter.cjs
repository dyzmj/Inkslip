const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

function runPandoc(executable, args, { cwd, input, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '', settled = false;
    const finish = (failure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      failure ? reject(failure) : resolve({ output, warnings: error.trim() });
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Pandoc 转换超时')); }, timeout);
    child.stdout.on('data', data => { output = (output + data.toString()).slice(-262144); });
    child.stderr.on('data', data => { error = (error + data.toString()).slice(-262144); });
    child.on('error', failure => finish(failure));
    child.on('close', code => finish(code === 0 ? null : new Error(`Pandoc 转换失败 (${code})：${error.trim() || '未输出错误信息'}`)));
    child.stdin.on('error', failure => { if (failure.code !== 'EPIPE') finish(failure); });
    child.stdin.end(input);
  });
}

async function findPandoc({ configuredPath } = {}) {
  const candidates = configuredPath ? [configuredPath] : [
    'pandoc',
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc'] : []),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Pandoc', 'pandoc.exe'),
  ].filter(Boolean);
  for (const executable of candidates) {
    try {
      const { output } = await runPandoc(executable, ['--version'], { timeout: 10000 });
      if (/^pandoc(?:\.exe)?\s+\d/im.test(output)) return executable;
    } catch { /* Try the next installed location. */ }
  }
  throw new Error('未找到 Pandoc。请安装 Pandoc，或在偏好设置中指定其可执行文件路径。');
}

async function importDocument(inputPath, outputPath, { pandocPath } = {}) {
  const executable = await findPandoc({ configuredPath: pandocPath });
  const filePath = path.resolve(outputPath);
  if (path.extname(filePath).toLowerCase() !== '.md') throw new Error('导入输出文件必须为 .md');
  if (path.resolve(inputPath) === filePath) throw new Error('导入文件不能覆盖原文件');
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const working = await fs.mkdtemp(path.join(directory, '.inkslip-import-'));
  const assetsBase = `${path.basename(filePath, path.extname(filePath))}.assets`;
  let assetsName = assetsBase;
  try {
    for (let suffix = 2; ; suffix++) {
      try { await fs.access(path.join(directory, assetsName)); assetsName = `${assetsBase}-${suffix}`; }
      catch (error) { if (error.code !== 'ENOENT') throw error; break; }
    }
    const converted = path.join(working, 'converted.md');
    const result = await runPandoc(executable, [path.resolve(inputPath), '--to=gfm-smart+tex_math_dollars-fenced_divs-bracketed_spans-raw_html', '--wrap=none',
      `--resource-path=${path.dirname(path.resolve(inputPath))}`, `--extract-media=${assetsName}`, '--output', converted], { cwd: working });
    const text = await fs.readFile(converted, 'utf8');
    let resourceDir = null;
    const extracted = path.join(working, assetsName);
    try {
      await fs.access(extracted);
      resourceDir = path.join(directory, assetsName);
      await fs.cp(extracted, resourceDir, { recursive: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(converted, filePath);
    return { filePath, text, resourceDir, warnings: result.warnings };
  } finally {
    await fs.rm(working, { recursive: true, force: true });
  }
}

async function exportDocument({ markdown, sourcePath, outputPath, pandocPath, resourcePath }) {
  if (typeof markdown !== 'string') throw new Error('导出内容必须为 Markdown 文本');
  const filePath = path.resolve(outputPath);
  if (path.extname(filePath).toLowerCase() !== '.docx') throw new Error('Word 导出文件必须为 .docx');
  const executable = await findPandoc({ configuredPath: pandocPath });
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const working = await fs.mkdtemp(path.join(directory, '.inkslip-export-'));
  const resources = [...new Set([sourcePath && path.dirname(path.resolve(sourcePath)), resourcePath && path.resolve(resourcePath), process.cwd()].filter(Boolean))];
  try {
    const converted = path.join(working, 'converted.docx');
    const result = await runPandoc(executable, ['--from=markdown+hard_line_breaks', '--to=docx',
      `--resource-path=${resources.join(path.delimiter)}`, '--output', converted], { cwd: resources[0], input: markdown });
    await fs.rename(converted, filePath);
    return { filePath, warnings: result.warnings };
  } finally {
    await fs.rm(working, { recursive: true, force: true });
  }
}

module.exports = { findPandoc, runPandoc, importDocument, exportDocument };
