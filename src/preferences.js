import './preferences.css';
import { installThemes } from './themes.js';
import { applyLanguage, languages } from './i18n.js';
import { version } from '../package.json';

const categories = [['files', '文件'], ['editor', '编辑器'], ['image', '图像'], ['markdown', 'Markdown'], ['export', '导出'], ['appearance', '外观'], ['general', '通用']];
const defaults = { general: { language: 'zh-CN' }, editor: { fontSize: 14, useCustomFontSize: false, lineHeight: 1.9, contentWidth: 800 }, appearance: { theme: 'vue.css', darkTheme: 'night.css', useSeparateDarkTheme: false, sidebar: true, statusbar: true, focus: false, typewriter: false, windowStyle: 'classic', zoomLevel: 0, zoomByMouse: false, readingSpeed: 382, wordCountDelimiter: 0, convertSmartOnRender: false, smartQuotes: false, smartDashes: false, remapUnicodePunctuation: false, indentFirstLine: false, visibleBr: true, preserveLineBreaks: true, spellCheck: false }, image: { uploader: 'picgo-app', picgoEndpoint: 'http://127.0.0.1:36677/upload', picgoPath: '', preferRelative: true, addDotSlash: true, escapeUrl: true, insertAction: 'none', copyFolder: '' }, export: { pandocPath: '' } };

export function installPreferences({ view, desktop, notify }) {
  let preferences = structuredClone(defaults);
  let saving = Promise.resolve();
  let active = 'files';
  const themes = installThemes({ view, desktop, notify });
  let systemDark = false;
  let applyingTheme;
  let themeReady = Promise.resolve();
  const dialog = document.createElement('dialog');
  dialog.id = 'preferences-dialog'; dialog.setAttribute('aria-labelledby', 'preferences-title');
  dialog.innerHTML = `<header class="preferences-header"><h2 id="preferences-title">偏好设置</h2><button type="button" aria-label="关闭偏好设置" class="preferences-close">×</button></header>
    <div class="preferences-layout"><nav class="preferences-nav" aria-label="偏好设置分类"><input type="search" placeholder="搜索偏好设置" aria-label="搜索偏好设置"><div class="preferences-tabs" role="tablist"></div></nav><main class="preferences-content">
    <section data-section="files" role="tabpanel"><h3>文件</h3><div class="preferences-group"><h4>保存与恢复</h4><p>使用 Ctrl+S 保存，另存为使用 Ctrl+Shift+S。关闭未保存的文档时会提示保存。</p><p>保存前检查磁盘上的文件是否被修改；文件内容保留原有换行符。</p></div><div class="preferences-group"><h4>文件侧栏</h4><label class="preferences-check"><input type="checkbox" name="appearance.sidebar">显示侧栏</label><p class="preferences-hint">通过“文件 → 打开文件夹”浏览文件树；侧栏可切换文件列表和大纲，查找与替换位于编辑区上方。</p></div><div class="preferences-group"><h4>自动保存</h4><p class="preferences-hint">当前版本使用手动保存，尚未提供自动保存、版本历史与恢复设置。</p></div></section>
    <section data-section="editor" role="tabpanel"><h3>编辑器</h3><div class="preferences-group"><h4>排版</h4><label class="preferences-field">行高<span><input type="number" name="editor.lineHeight" min="1.2" max="3" step="0.1"> 倍</span></label><label class="preferences-field">内容宽度<span><input type="number" name="editor.contentWidth" min="480" max="1400" step="20"> px</span></label><p class="preferences-hint">设置立即应用到编辑区和实时预览。窄窗口下内容宽度自动适应窗口。</p></div><div class="preferences-group"><h4>编辑模式</h4><p>单一编辑区支持实时预览与源码模式；点击已渲染的段落可继续编辑原文。</p><p class="preferences-hint">Ctrl+/ 切换源码模式。撤销与重做在同一份文档中进行。</p></div></section>
    <section data-section="image" role="tabpanel"><h3>图像</h3><div class="preferences-group"><h4>插入图片时…</h4><label class="preferences-field">默认行为<select disabled aria-label="插入图片时的默认行为"><option>无特殊操作</option></select></label><p>保留原始图片位置。选中本地图片并右键，选择“上传图片”将其上传并替换为返回的网址。</p><p class="preferences-hint">上传由你手动发起，插入、打开和保存文档不会自动上传图片。</p></div><div class="preferences-group"><h4>图片语法偏好</h4><label class="preferences-check"><input type="checkbox" name="image.preferRelative">优先使用相对路径</label><label class="preferences-check"><input type="checkbox" name="image.addDotSlash">为相对路径添加 ./</label><label class="preferences-check"><input type="checkbox" name="image.escapeUrl">插入时自动转义图片 URL</label><p class="preferences-hint">用于插入本地图片；有已保存文档时可计算相对路径。空格等字符转义为 %20，可提高 Markdown 兼容性。</p></div><div class="preferences-group"><h4>上传服务设定</h4><label class="preferences-field">上传服务<select name="image.uploader"><option value="picgo-app">PicGo (app)</option><option value="picgo-cli">PicGo-Core (command line)</option></select></label><label class="preferences-field preferences-path">PicGo 路径<span><input type="text" name="image.picgoPath" placeholder="选择 PicGo 可执行文件"><button type="button" data-action="pick-picgo">浏览…</button></span></label><label class="preferences-field" data-app-only>服务地址<input type="url" name="image.picgoEndpoint" placeholder="http://127.0.0.1:36677/upload"></label><p class="preferences-hint" data-app-only>在 PicGo 中配置图床并启用 Server，默认端口 36677。未启动时可通过上方路径启动 PicGo。</p><p class="preferences-hint" data-cli-only>选择 PicGo-Core 的可执行文件。图床和认证信息由 PicGo 自身的配置管理。</p><div class="preferences-upload-actions"><button type="button" data-action="test-uploader">验证图片上传选项</button><a href="https://picgo.github.io/PicGo-Doc/zh/guide/config.html#picgo-server设置" data-help-link>说明</a></div><p class="preferences-hint">验证时将先选择一张测试图片，再通过当前服务上传。验证不会修改当前文档。</p><p class="preferences-upload-result" role="status" aria-live="polite"></p></div></section>
    <section data-section="markdown" role="tabpanel"><h3>Markdown</h3><div class="preferences-group"><h4>语法支持</h4><p>标题、列表、任务列表、引用、表格、代码、图片与链接，以及脚注、定义列表、目录、上下标、高亮、emoji、数学公式和 Mermaid 图表已启用。</p></div><div class="preferences-group"><h4>换行</h4><p>连续文本中的普通回车显示换行；空行用于分段。无需在行尾额外输入两个空格。</p></div><div class="preferences-group"><h4>扩展语法设置</h4><p class="preferences-hint">当前版本统一启用受支持的语法，尚未提供逐项语法开关、智能标点与自动配对设置。</p></div></section>
    <section data-section="export" role="tabpanel"><h3>导出</h3><div class="preferences-group"><h4>HTML / PDF</h4><p>通过“文件 → 导出”生成 HTML 或 PDF。HTML 会嵌入本地图片；PDF 使用系统打印排版。</p><p>通过“文件 → 打印”选择打印机及纸张。</p></div><div class="preferences-group"><h4>更多格式</h4><p class="preferences-hint">当前版本尚未接入 Pandoc，也未提供导出专用主题、页眉页脚或逐文件 YAML 导出配置。</p></div></section>
    <section data-section="appearance" role="tabpanel"><h3>外观</h3>
      <div class="preferences-group"><h4>窗口样式</h4><div class="preferences-options"><label class="preferences-check"><input type="radio" name="appearance.windowStyle" value="classic">经典</label><label class="preferences-check"><input type="radio" name="appearance.windowStyle" value="unibody">一体化</label></div><p class="preferences-hint">重启应用后生效。</p><p class="preferences-restart" role="status" hidden>窗口样式已保存，请重新启动应用以应用此设置。</p></div>
      <div class="preferences-group"><h4>字体大小</h4><div class="preferences-options"><label class="preferences-check"><input type="radio" name="editor.useCustomFontSize" value="false">自动（推荐）</label><label class="preferences-check"><input type="radio" name="editor.useCustomFontSize" value="true">自定义</label></div><label class="preferences-field preferences-custom-font">自定义字体大小<span><input type="number" name="editor.fontSize" min="9" max="24" step="1"> px</span></label></div>
      <div class="preferences-group"><h4>Zoom</h4><label class="preferences-field">Zoom<span><select name="appearance.zoomLevel"><option value="-3">57%</option><option value="-2">69%</option><option value="-1">83%</option><option value="0">100%</option><option value="1">120%</option><option value="2">144%</option><option value="3">172%</option><option value="4">207%</option><option value="5">248%</option><option value="6">298%</option></select><button type="button" data-action="reset-zoom">重置</button></span></label><label class="preferences-check"><input type="checkbox" name="appearance.zoomByMouse">按住 Ctrl 时使用鼠标滑轮缩放</label></div>
      <div class="preferences-group"><h4>状态栏</h4><label class="preferences-check"><input type="checkbox" name="appearance.statusbar">显示状态栏</label></div>
      <div class="preferences-group"><h4>字数统计</h4><label class="preferences-field">阅读速度<span><input type="number" name="appearance.readingSpeed" min="1" max="999" step="1">词每分钟</span></label><div class="preferences-reset-speed"><button type="button" data-action="reset-reading-speed">重置</button><details><summary aria-label="阅读速度预设">▾</summary><div role="menu"><button type="button" role="menuitem" data-reading-speed="120">慢（120 词每分钟）</button><button type="button" role="menuitem" data-reading-speed="240">中（240 词每分钟）</button><button type="button" role="menuitem" data-reading-speed="382">快（382 词每分钟）</button></div></details></div></div>
      <div class="preferences-group"><h4>主题</h4><label class="preferences-field"><span data-theme-label>主题</span><select name="appearance.theme" aria-label="主题"></select></label><label class="preferences-check"><input type="checkbox" name="appearance.useSeparateDarkTheme">深色模式下使用单独的主题</label><label class="preferences-field" data-dark-theme hidden>深色主题<select name="appearance.darkTheme" aria-label="深色主题"></select></label><button type="button" data-action="theme-folder">打开主题文件夹</button></div>
    </section>
    <section data-section="general" role="tabpanel"><h3>通用</h3><div class="preferences-group"><h4>语言</h4><label class="preferences-field">界面语言<select name="general.language">${languages.map(language => `<option value="${language.id}"${language.id === 'system' ? '' : ' data-i18n-ignore'}>${language.label}</option>`).join('')}</select></label><p class="preferences-hint">立即生效，不修改文档内容。</p></div><div class="preferences-group"><h4>偏好设置</h4><p>修改会自动保存，在下次启动时恢复。</p><p class="preferences-hint">桌面版配置保存在应用的用户数据目录。PicGo 的图床密钥由 PicGo 管理，编辑器仅保存上传方式、服务地址和可执行文件路径。</p></div></section>
    <p class="preferences-no-results" hidden>没有匹配的偏好设置。</p></main></div><footer class="preferences-footer"><span class="preferences-save-state" role="status" aria-live="polite"></span><button type="button" class="preferences-done">关闭</button></footer>`;
  dialog.querySelector('[data-section="markdown"]').innerHTML = `<h3>Markdown</h3><div class="preferences-group"><h4>智能标点</h4><label class="preferences-check"><input type="radio" name="appearance.convertSmartOnRender" value="false">输入时转换</label><label class="preferences-check"><input type="radio" name="appearance.convertSmartOnRender" value="true">渲染时转换</label><label class="preferences-check"><input type="checkbox" name="appearance.smartQuotes">智能引号</label><label class="preferences-check"><input type="checkbox" name="appearance.smartDashes">智能破折号</label><label class="preferences-check"><input type="checkbox" name="appearance.remapUnicodePunctuation">解析 Markdown 时允许并转化 Unicode 标点</label></div><div class="preferences-group"><h4>空格与换行</h4><label class="preferences-check"><input type="checkbox" name="appearance.indentFirstLine">首行缩进</label><label class="preferences-check"><input type="checkbox" name="appearance.visibleBr">显示 &lt;br/&gt;</label><label class="preferences-check"><input type="checkbox" name="appearance.preserveLineBreaks">保留单换行符</label></div>`;
  dialog.querySelector('[data-section="editor"]').insertAdjacentHTML('beforeend', '<div class="preferences-group"><h4>拼写检查</h4><label class="preferences-check"><input type="checkbox" name="appearance.spellCheck">启用英文拼写检查</label><p class="preferences-hint">离线词典；右键标记词可选择建议或加入用户词典。跳过代码和图片路径。</p></div>');
  dialog.querySelector('[data-section="export"]').innerHTML = '<h3>导出</h3><div class="preferences-group"><h4>Pandoc</h4><label class="preferences-field">可执行文件<input type="text" name="export.pandocPath" placeholder="自动查找已安装的 Pandoc"></label><button type="button" data-action="pick-pandoc">选择 Pandoc…</button><p class="preferences-hint">用于非 Markdown 导入及 Word 导出，HTML / PDF 导出使用内置功能。</p></div>';
  const imagePolicy = dialog.querySelector('[data-section="image"] .preferences-group');
  imagePolicy.innerHTML = '<h4>插入图片时…</h4><label class="preferences-field">默认行为<select name="image.insertAction"><option value="none">无特殊操作</option><option value="copy">复制图片到文件夹</option><option value="upload">上传图片</option></select></label><label class="preferences-field">复制到<input type="text" name="image.copyFolder" placeholder="文档名.assets"></label><button type="button" data-action="pick-image-folder">选择文件夹…</button><p class="preferences-hint">只处理新插入的本地图片。文档 YAML 策略优先于此默认设置；失败时保留原图片。</p>';
  const updateGroup = document.createElement('div'); updateGroup.className = 'preferences-group';
  updateGroup.innerHTML = `<h4>软件更新</h4><p>当前版本：${version}</p><button type="button" data-action="check-updates">检查更新…</button><p class="preferences-hint">从 GitHub Releases 检测新版本，选择下载后在浏览器中获取对应系统的软件包。</p>`;
  const updateButton = updateGroup.querySelector('button');
  updateButton.onclick = async () => {
    if (!desktop?.checkForUpdates) return;
    updateButton.disabled = true; updateButton.textContent = '正在检查更新…';
    try { await desktop.checkForUpdates(); }
    finally { updateButton.disabled = false; updateButton.textContent = '检查更新…'; }
  };
  dialog.querySelector('[data-section="general"]').append(updateGroup);
  document.body.append(dialog);
  const tabs = dialog.querySelector('.preferences-tabs');
  for (const [id, label] of categories) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.id = `preferences-tab-${id}`; tab.textContent = label; tab.dataset.section = id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `preferences-panel-${id}`); tab.onclick = () => select(id); tabs.append(tab);
    const panel = dialog.querySelector(`section[data-section="${id}"]`); panel.id = `preferences-panel-${id}`; panel.setAttribute('aria-labelledby', tab.id);
  }
  function select(section) {
    active = categories.some(([id]) => id === section) ? section : 'files';
    dialog.querySelector('.preferences-no-results').hidden = true;
    tabs.querySelectorAll('button').forEach(tab => { const selected = tab.dataset.section === active; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    dialog.querySelectorAll('section').forEach(panel => { panel.hidden = panel.dataset.section !== active; });
    dialog.querySelector('.preferences-content').scrollTop = 0;
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const available = [...tabs.children].filter(tab => !tab.hidden);
    const current = available.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length;
    event.preventDefault(); if (available[next]) { select(available[next].dataset.section); available[next].focus(); }
  });
  dialog.querySelector('input[type="search"]').oninput = event => {
    const query = event.target.value.trim().toLowerCase();
    for (const tab of tabs.children) { const panel = dialog.querySelector(`section[data-section="${tab.dataset.section}"]`); tab.hidden = query !== '' && !`${tab.textContent} ${panel.textContent}`.toLowerCase().includes(query); }
    const firstMatch = [...tabs.children].find(tab => !tab.hidden);
    if (!firstMatch) { dialog.querySelectorAll('section').forEach(panel => { panel.hidden = true; }); dialog.querySelector('.preferences-no-results').hidden = false; }
    else if (tabs.querySelector(`[data-section="${active}"]`).hidden || !dialog.querySelector('.preferences-no-results').hidden) select(firstMatch.dataset.section);
  };
  function sync() {
    for (const input of dialog.querySelectorAll('[name]')) { const [group, key] = input.name.split('.'); if (input.type === 'checkbox') input.checked = preferences[group][key]; else if (input.type === 'radio') input.checked = String(preferences[group][key]) === input.value; else input.value = preferences[group][key]; }
    dialog.querySelectorAll('[data-app-only]').forEach(node => { node.hidden = preferences.image.uploader !== 'picgo-app'; });
    dialog.querySelectorAll('[data-cli-only]').forEach(node => { node.hidden = preferences.image.uploader !== 'picgo-cli'; });
    dialog.querySelector('[name="image.addDotSlash"]').disabled = !preferences.image.preferRelative;
    dialog.querySelector('[name="editor.fontSize"]').disabled = !preferences.editor.useCustomFontSize;
    dialog.querySelector('[data-dark-theme]').hidden = !preferences.appearance.useSeparateDarkTheme;
    dialog.querySelector('[data-theme-label]').textContent = preferences.appearance.useSeparateDarkTheme ? '浅色主题' : '主题';
    const unicode = dialog.querySelector('[name="appearance.remapUnicodePunctuation"]');
    unicode.disabled = !preferences.appearance.convertSmartOnRender && (preferences.appearance.smartQuotes || preferences.appearance.smartDashes);
    if (unicode.disabled) unicode.checked = true;
  }
  function themeOptions() {
    for (const select of dialog.querySelectorAll('[name="appearance.theme"], [name="appearance.darkTheme"]')) select.replaceChildren(...themes.list().map(theme => { const option = document.createElement('option'); option.value = theme.id; option.textContent = theme.name; return option; }));
  }
  function applyTheme(force = false) {
    const id = preferences.appearance.useSeparateDarkTheme && systemDark ? preferences.appearance.darkTheme : preferences.appearance.theme;
    if (!force && applyingTheme === id) return themeReady;
    applyingTheme = id;
    themeReady = themes.apply(id).then(result => { if (result) { desktop?.themeApplied?.(result.id, result.dark, preferences.appearance.useSeparateDarkTheme); document.dispatchEvent(new CustomEvent('inkslip-theme-changed', { detail: result })); } }).catch(async error => {
      applyingTheme = null; notify(`主题加载失败：${error.message}`);
      if (!document.body.dataset.theme && id !== 'github.css') { const fallback = await themes.apply('github.css'); if (fallback) desktop?.themeApplied?.(fallback.id, fallback.dark, preferences.appearance.useSeparateDarkTheme); }
    });
    return themeReady;
  }
  function apply() {
    applyLanguage(preferences.general.language);
    document.body.dataset.spellCheck = String(preferences.appearance.spellCheck);
    const style = document.documentElement.style;
    if (preferences.editor.useCustomFontSize) { style.fontSize = `${preferences.editor.fontSize}px`; style.setProperty('--editor-font-size', `${preferences.editor.fontSize}px`); }
    else { style.removeProperty('font-size'); style.removeProperty('--editor-font-size'); }
    style.setProperty('--editor-line-height', String(preferences.editor.lineHeight)); style.setProperty('--editor-content-width', `${preferences.editor.contentWidth}px`);
    document.body.classList.toggle('sidebar-hidden', !preferences.appearance.sidebar); document.body.classList.toggle('statusbar-hidden', !preferences.appearance.statusbar); document.body.classList.toggle('focus-mode', preferences.appearance.focus); document.body.classList.toggle('typewriter-mode', preferences.appearance.typewriter);
    document.getElementById('show-sidebar')?.setAttribute('aria-pressed', String(preferences.appearance.sidebar));
    document.getElementById('show-sidebar')?.setAttribute('aria-label', preferences.appearance.sidebar ? '隐藏侧边栏' : '显示侧边栏');
    document.getElementById('show-sidebar')?.setAttribute('title', preferences.appearance.sidebar ? '隐藏侧边栏' : '显示侧边栏');
    document.getElementById('theme')?.setAttribute('aria-pressed', String(preferences.appearance.theme === 'dark')); view.requestMeasure();
    document.dispatchEvent(new CustomEvent('inkslip-preferences-changed', { detail: structuredClone(preferences) }));
    desktop?.applyWindowPreferences?.(structuredClone(preferences.appearance))?.then(result => { dialog.querySelector('.preferences-restart').hidden = !result?.restartRequired; }).catch(error => notify(`应用窗口设置失败：${error.message}`));
    return applyTheme();
  }
  const status = dialog.querySelector('.preferences-save-state');
  function save() {
    const snapshot = structuredClone(preferences); status.textContent = '正在保存…';
    saving = saving.catch(() => {}).then(async () => {
      if (desktop?.setPreferences) { const result = await desktop.setPreferences(snapshot); if (result?.error) throw new Error(result.error); }
      else localStorage.setItem('inkslip-preferences', JSON.stringify(snapshot));
      status.textContent = '已保存';
    }).catch(error => { status.textContent = `保存失败：${error.message}`; notify(`偏好设置保存失败：${error.message}`); });
    return saving;
  }
  dialog.addEventListener('change', event => {
    const input = event.target; if (!input.name) return;
    if (input.type === 'radio' && !input.checked) return;
    if (['editor.fontSize', 'appearance.readingSpeed'].includes(input.name) && input.value === '') { sync(); return; }
    if (input.name === 'editor.fontSize' && input.value !== '' && Number.isFinite(Number(input.value))) input.value = Math.max(9, Math.min(24, Math.trunc(Number(input.value))));
    if (input.name === 'appearance.readingSpeed' && input.value !== '' && Number.isFinite(Number(input.value))) input.value = Math.max(1, Math.min(999, Math.trunc(Number(input.value))));
    if (!input.checkValidity()) { input.reportValidity(); sync(); return; }
    const [group, key] = input.name.split('.'); preferences[group][key] = input.type === 'checkbox' ? input.checked : ['useCustomFontSize', 'convertSmartOnRender'].includes(key) ? input.value === 'true' : input.type === 'number' || key === 'zoomLevel' ? Number(input.value) : input.value.trim();
    sync();
    if (['appearance.theme', 'appearance.darkTheme', 'appearance.useSeparateDarkTheme'].includes(input.name)) save().then(async () => { if (input.name === 'appearance.useSeparateDarkTheme' && preferences.appearance.useSeparateDarkTheme) systemDark = await desktop?.systemTheme?.() || false; return apply(); });
    else { apply(); save(); }
  });
  function setAppearance(patch) { Object.assign(preferences.appearance, patch); apply(); sync(); save(); }
  dialog.querySelector('[data-action="reset-zoom"]').onclick = () => setAppearance({ zoomLevel: 0 });
  dialog.querySelector('[data-action="theme-folder"]').onclick = () => desktop?.openThemesFolder?.().catch(error => notify(error.message));
  dialog.querySelector('[data-action="pick-image-folder"]').onclick = async () => { const result = await desktop?.chooseImageFolder?.(); if (result?.path) { preferences.image.copyFolder = result.path; sync(); await save(); } };
  dialog.querySelector('[data-action="pick-pandoc"]').onclick = async () => { const result = await desktop?.pickPandoc?.(); if (result?.path) { preferences.export.pandocPath = result.path; sync(); await save(); } };
  dialog.querySelector('[data-action="reset-reading-speed"]').onclick = () => setAppearance({ readingSpeed: 382 });
  dialog.querySelectorAll('[data-reading-speed]').forEach(button => { button.onclick = () => { setAppearance({ readingSpeed: Number(button.dataset.readingSpeed) }); button.closest('details').open = false; }; });
  dialog.querySelector('[data-action="pick-picgo"]').onclick = async () => {
    try { const path = await desktop?.pickPicgoPath?.(preferences.image.uploader); if (path) { preferences.image.picgoPath = path; sync(); await save(); } }
    catch (error) { notify(error.message); }
  };
  dialog.querySelector('[data-action="test-uploader"]').onclick = async event => {
    const button = event.currentTarget; const result = dialog.querySelector('.preferences-upload-result'); button.disabled = true; result.textContent = '请选择测试图片…';
    try { if (!desktop?.testImageUpload) throw new Error('请在桌面版中验证图片上传'); const response = await desktop.testImageUpload(structuredClone(preferences)); result.textContent = response.message || response.error || (response.ok ? '上传成功' : '验证已取消'); }
    catch (error) { result.textContent = `验证失败：${error.message}`; }
    finally { button.disabled = false; }
  };
  dialog.querySelector('[data-help-link]').onclick = event => { event.preventDefault(); desktop?.openLink?.(event.currentTarget.href); };
  function close() { dialog.close(); view.focus(); }
  dialog.querySelector('.preferences-close').onclick = close; dialog.querySelector('.preferences-done').onclick = close;
  dialog.addEventListener('cancel', () => { view.focus(); });
  const ready = (async () => {
    try { const stored = desktop?.getPreferences ? await desktop.getPreferences() : JSON.parse(localStorage.getItem('inkslip-preferences') || 'null'); if (stored?.error) throw new Error(stored.error); if (stored) for (const group of Object.keys(defaults)) preferences[group] = { ...defaults[group], ...stored[group] }; if (stored?.editor?.fontSize !== undefined && stored.editor.useCustomFontSize === undefined) { preferences.editor.useCustomFontSize = true; preferences.editor.fontSize = Math.max(9, Math.min(24, stored.editor.fontSize)); } preferences.appearance.theme = ({ light: 'github.css', dark: 'night.css' })[preferences.appearance.theme] || preferences.appearance.theme; await themes.ready; systemDark = await desktop?.systemTheme?.() || false; themeOptions(); await apply(); sync(); select(active); }
    catch (error) { notify(`读取偏好设置失败：${error.message}`); sync(); select(active); }
  })();
  desktop?.onSystemTheme?.(dark => { systemDark = dark; if (preferences.appearance.useSeparateDarkTheme) applyTheme(); });
  return { ready, themes, getPreferences: () => structuredClone(preferences), async setTheme(id) { await ready; preferences.appearance[preferences.appearance.useSeparateDarkTheme && systemDark ? 'darkTheme' : 'theme'] = id; await save(); sync(); return applyTheme(); }, async reloadThemes() { await ready; await themes.refresh(); themeOptions(); sync(); await applyTheme(true); }, async updateAppearance(patch) { await ready; Object.assign(preferences.appearance, patch); const applying = apply(); sync(); await save(); await applying; }, async open(section = 'files') { await ready; dialog.querySelector('input[type="search"]').value = ''; for (const tab of tabs.children) tab.hidden = false; select(section); sync(); if (!dialog.open) dialog.showModal(); tabs.querySelector(`[data-section="${active}"]`).focus(); } };
}
