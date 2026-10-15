# 墨简 · Inkslip

[English](README.md) | 简体中文

墨简是一款适用于 Windows 和 macOS 的 Markdown 桌面编辑器，适合记录笔记、编写文档和长文写作。编辑与实时预览融入同一个写作区域：写下 Markdown，格式随文字呈现；点击已排版的段落，即可继续修改原文。

文档以普通 Markdown 文件保存在你的电脑上。你可以通过文件树和大纲整理内容，粘贴图片、使用 PicGo 上传图片，并选择适合自己的主题与排版。需要精确调整语法时，随时切换源码模式，正文和撤销历史始终保持一致。

## 功能

- **Markdown 编辑**：标题、列表、任务列表、引用、表格、链接、图片、代码高亮；支持公式、脚注、目录、Mermaid 和 NOTE 等提示块。引用定义显示名称、地址和标题。
- **文字选中与定位**：点击渲染文字能定位到对应字符，鼠标拖动可以选中多行；上下键与 Shift 选区按可见行移动，支持自动折行。段落间距跟随主题；连续回车保留逐行可见的空行。
- **文档导航**：文件树、文件列表、大纲和快速打开。大纲支持可折叠／无折叠视图、全部展开／折叠、高亮当前标题及独立的标题查找。文件栏底部支持新建、文件夹菜单、刷新、树／列表切换、分组及四种双向排序；最近位置可固定、移除与重新打开。文件夹搜索支持文件名和正文，并能跳转到匹配行。查找与替换位于编辑区顶部，支持大小写、全字匹配和正则表达式。
- **图片处理**：粘贴截图、浏览器图片和图片文件；通过 PicGo 上传并替换地址；复制、移动、缩放、语法转换及批量文件操作。
- **主题与排版**：七套内置主题、用户 CSS 和覆盖样式；字体大小、行高、内容宽度、Zoom、智能标点与换行设置。
- **界面语言**：简体中文、繁体中文、English 和跟随系统；在偏好设置 → 通用 → 语言中切换，立即生效并记忆选择。文档、文件名和路径保持原样。
- **写作工具**：专注模式、打字机模式、字数及选区统计、英文拼写检查和右键纠错、代码自动缩进。
- **本地文件操作**：新建、保存、另存为、重命名、复制、编码重开、文件属性；保存前检查外部修改，避免覆盖磁盘上的新内容。
- **导入与导出**：HTML、PDF、Word 和系统打印；安装 Pandoc 后可导入其他文档格式。

可打开 [完整 Markdown 示例](examples/完整Markdown示例.md) 体验支持的语法。

文件栏底部与编辑区状态栏位于同一行。文件树与文件列表的名称使用统一的 14px 字体。鼠标移入文件区域或底部操作区时显示底栏，移到标签栏、编辑区等其他区域时隐藏。最近目录固定后需先取消固定才能移除；侧栏新建文件会保留当前文档及未保存内容。文件树显示不可折叠的根目录与目录图标；文件、子目录和根目录各有对应右键菜单，支持目录内新建、重命名与撤销、创建副本、移至回收站，以及在新窗口中打开。

## 运行桌面版

当前版本为 **0.8.0**，支持 Windows x64、Mac Intel（x64）和 Mac Apple Silicon（arm64）。双击：

```text
release/0.8.0/Inkslip-win32-x64/Inkslip.exe
```

从 [Releases](https://github.com/dyzmj/Inkslip/releases) 下载对应平台的 ZIP 并解压；macOS 将 `Inkslip.app` 放入“应用程序”。

保留整个程序目录，不能只复制 EXE。更新前保存并关闭旧版，然后启动新版。

偏好设置、最近文件、用户词典、主题和未保存文档的粘贴图片存放在应用数据目录，Windows 通常为 `%APPDATA%\Inkslip`，macOS 为 `~/Library/Application Support/Inkslip`。升级时会复制旧版已有的应用数据；已有的新配置不会被覆盖，原目录及文档保留。

## 常用操作

| 操作 | 快捷键 |
| --- | --- |
| 新建／打开 | Ctrl+N／Ctrl+O |
| 保存／另存为 | Ctrl+S／Ctrl+Shift+S |
| 切换源码模式 | Ctrl+/ |
| 查找／替换 | Ctrl+F／Ctrl+H |
| 下一个／上一个匹配 | F3／Shift+F3 |
| 关闭查找栏 | Esc |
| 撤销／重做 | Ctrl+Z／Ctrl+Y |
| 快速打开 | Ctrl+P |
| 显示／隐藏侧栏 | Ctrl+Shift+L |
| 专注模式 | F8 |

macOS 使用 Command 替代上表快捷键中的 Ctrl。经典窗口通过顶部菜单操作；一体化窗口的菜单默认收起，点击左上角菜单图标打开文件导航，Alt+F 或 F10 可访问菜单。侧栏只包含“文件”和“大纲”，侧栏与源码切换按钮位于底部状态栏。

## 图片与 PicGo

### 粘贴图片

Ctrl+V 可以插入截图、浏览器复制的图片和资源管理器复制的图片文件。已保存文档的图片默认存入同目录的 `文档名.assets` 文件夹；未保存文档的图片先存入应用数据目录。

### 配置上传

1. 在 PicGo 中配置图床，启用 PicGo-Server。
2. 打开“文件 → 偏好设置 → 图像”，选择 **PicGo (app)** 并指定 `PicGo.exe`（Windows）或 `/Applications/PicGo.app`（macOS）。默认上传地址为 `http://127.0.0.1:36677/upload`。
3. 使用“验证图片上传选项”上传一张测试图片。
4. 右键图片选择“上传图片”，或在图像菜单上传文档中的本地图片。

上传期间显示半透明进度提示；成功后用返回的地址替换原文，保留替代文字与标题；失败时保留原地址。上传可以撤销，服务器上的文件不会随正文撤销而删除。PicGo-Core 模式支持可执行文件及 `.js/.cjs/.mjs` 入口，图床和密钥由 PicGo 管理。

### 文档级图片设置

可以在图像菜单设置，也可以使用文档开头的 YAML：

```yaml
---
inkslip-root-url: ./images
inkslip-copy-images-to: ./assets
---
```

`inkslip-root-url` 指定图片根目录；`inkslip-copy-images-to` 指定新插入图片的复制目录，设为 `upload` 时自动上传。文档设置优先于全局插图偏好。

复制图片使用避让文件名，避免覆盖同名文件。移动和删除会检查当前文档目录及子目录中的共享引用，最多检查一万文件；其他目录的引用不在检查范围。批量图片操作支持正文与磁盘同步撤销／重做，磁盘历史限当前程序会话。

## 主题与偏好设置

七套内置 CSS 主题均为墨简独立编写，使用系统字体。主题文件名保留为已有配置的标识，不分发外部主题包的副本。

内置 Github、Newsprint、Night、Pixyll、Whitey、Lapis 和 Vue 七套主题。新安装或未设置主题时默认使用 Vue；已有主题选择保持不变。主题切换即时生效，重启恢复选择；切换保留未保存正文、源码模式和撤销历史。

通过“打开主题文件夹”添加 `.css` 及相对字体／图片资源，再重新加载主题。同名用户主题覆盖内置主题。样式按以下顺序应用：

```text
主题 CSS → base.user.css → <主题名>.user.css
```

偏好设置支持经典／一体化窗口、自动／自定义字号、行高、内容宽度、Zoom、状态栏、阅读速度和独立系统深色主题。窗口样式重启后生效，其他设置即时保存。外部主题中依赖特定编辑器 DOM 或插件的规则不保证全部兼容。

## 导入与导出

HTML、PDF 和打印可以直接使用。Word 导出及文档导入需要安装 **Pandoc**，也可在偏好设置中指定 Pandoc 可执行文件路径。

导入会转换为 Markdown，并提取本地媒体资源；导入期间暂时锁定编辑区。Word 导出支持表格及可解析的图片资源。Mermaid 在文档导出中保留代码文本，复杂公式字体和分页效果需自行检查。

## 从源码运行

需要 Windows 或 macOS、Node.js 24 及以上版本和 npm。本项目使用 **Node.js 24.20.0** 验证。

```powershell
npm ci
npm start
```

`npm start` 会构建前端并启动桌面应用。浏览器预览使用：

```powershell
npm run dev
```

浏览器预览用于开发，本地文件操作、图片上传服务及系统功能需要桌面版。如果 Electron 下载失败，可在当前 PowerShell 中设置镜像后重试：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm start
```

## 开发与打包

| 目录 | 用途 |
| --- | --- |
| `src/` | 编辑器、实时排版、菜单、偏好设置和主题适配 |
| `desktop/` | Electron 主进程、preload、本地文件、上传和转换服务 |
| `shared/` | 菜单规格、界面翻译及共享图片路径逻辑 |
| `assets/` | 应用 Logo、独立绘制的 SVG 图标和内置 CSS 主题 |
| `examples/` | Markdown 示例 |
| `scripts/` | 构建桌面应用、生成 ZIP、发布 Packages 和生成应用图标 |
| `.github/workflows/release.yml` | 自动构建 Windows 与 Mac 包并发布版本 |

```powershell
# 构建前端
npm run build

# 按当前系统和 CPU 打包，生成 ZIP 及 SHA-256 校验文件
npm run package

# Windows x64（在 Windows 执行）
npm run package:win

# Mac Apple Silicon / Intel（在 macOS 执行）
npm run package:mac -- --arch=arm64
npm run package:mac -- --arch=x64
```

前端产物位于 `dist/`，桌面包位于 `release/`，均不提交 Git。测试、研究脚本、自动生成的开发说明、日志、截图以及整个 `evidence/` 目录也仅保留在本地；从仓库构建和运行无需这些文件。

应用使用以字母 M 为中心的 [Logo](assets/inkslip.svg)，窗口和 EXE 共用 [ICO](assets/inkslip.ico)。`node scripts/generate-icon.mjs` 可重新生成 PNG 和 ICO，另需 Python 和 Pillow。

## 自动构建与发布

每次推送到 `main` 或创建 Pull Request，GitHub Actions 都会在对应系统上构建并启动检查 Windows x64、macOS x64 和 macOS arm64 三个版本。ZIP 和校验文件可在工作流的 Artifacts 中下载。本地打包同样会在 `release/<版本>/` 生成 ZIP。

发布版本时，同步修改 `package.json` 和 `package-lock.json` 中的版本号并提交，再推送相同版本的标签：

```bash
git tag v0.8.0
git push origin v0.8.0
```

三个平台的构建和桌面检查全部成功后，工作流自动将平台 ZIP 封装为 GitHub npm Packages，并创建包含三个 ZIP 和 `SHA256SUMS.txt` 的 GitHub Release。使用仓库内置的 `GITHUB_TOKEN`，授予 `contents: write` 与 `packages: write`，无需 npm.org Token。也可以手动运行工作流并选择是否发布。

Release 文件分别为 `Inkslip-<版本>-windows-x64.zip`、`Inkslip-<版本>-macos-x64.zip` 和 `Inkslip-<版本>-macos-arm64.zip`。Packages 分别为 `@dyzmj/inkslip-win32-x64`、`@dyzmj/inkslip-darwin-x64` 和 `@dyzmj/inkslip-darwin-arm64`，各包含 ZIP 和校验文件。GitHub Packages 下载可能需要登录认证；Release 附件可直接下载。

macOS ZIP 保留应用权限与符号链接，使用临时签名（ad-hoc），尚未使用 Apple Developer ID 签名和公证，因此 macOS 可能要求在“隐私与安全性”中手动批准。Windows 包也未进行代码签名。当前通过应用商店以外的渠道分发。

## 当前范围

- 文档手动保存；尚未提供自动保存、崩溃恢复和自动更新。
- 拼写检查使用离线英文词典，不提供中文语法检查或自动多语言检测。
- 代码整理使用语言服务自动缩进，不重排表达式。
- 文件夹搜索覆盖当前打开的目录及其子目录；尚未提供跨独立目录的全局搜索。

第三方依赖保留各自包内的许可证。内置资源见 [主题说明](assets/themes/NOTICE.md) 和 [图标说明](assets/icons/NOTICE.md)。
