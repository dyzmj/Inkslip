# Inkslip

English | [简体中文](README.zh-CN.md)

Inkslip is a Windows and macOS desktop Markdown editor for notes, documentation, and longer drafts. Editing and live preview share one writing surface: write Markdown, see the formatting appear, and click a rendered paragraph to continue editing its source.

Your documents stay on your computer as plain Markdown files. Organize them with a file tree and outline, paste images, upload them through PicGo, and choose your own theme and typography. Switch to source mode whenever you need precise control over the syntax; both views share the same document and undo history.

## Features

- **Markdown editing:** Headings, lists, tasks, blockquotes, tables, links, images, and syntax-highlighted code, plus math, footnotes, a table of contents, Mermaid diagrams, and alerts such as NOTE. Reference definitions show their names, URLs, and titles.
- **Text selection and navigation:** Click rendered text to place the caret at a character, drag to select multiple lines, and move by visual line with the arrow keys and Shift. Text wraps to the editor width; consecutive empty lines remain visible, and paragraph spacing follows the active theme.
- **Document navigation:** File tree, file list, outline, and quick open. The outline supports collapsible and flat views, expand/collapse all, current-heading highlighting, and its own title filter. The file sidebar offers creation, refresh, grouping, four reversible sort orders, and pinned recent locations. Folder search matches filenames and document content and can jump to a matching line. Find and Replace sit above the editor, with case-sensitive, whole-word, and regular-expression options.
- **Image handling:** Paste screenshots, browser images, and image files; upload through PicGo and replace the source URL. Copy, move, resize, convert image syntax, and manage multiple images at once.
- **Themes and typography:** Seven built-in themes, user CSS, font size, line height, content width, zoom, smart punctuation, and line-break preferences. Vue is the default theme.
- **Interface languages:** Simplified Chinese, Traditional Chinese, English, or the system language. Switch instantly under **File → Preferences → General → Language**; the choice is saved without changing document text, filenames, or paths.
- **Writing tools:** Focus mode, typewriter mode, document and selection statistics, offline English spell checking with context-menu suggestions, and automatic code indentation.
- **Local file operations:** Create, save, save as, rename, duplicate, reopen with another encoding, and inspect file properties. External changes are checked before saving to avoid overwriting newer content on disk. Unicode paths and Windows line endings are supported.
- **Import and export:** HTML, PDF, Word, and system printing. Install Pandoc to import additional document formats and export Word documents.

Try the [complete Markdown example](examples/完整Markdown示例.md) to explore the supported syntax.

The file sidebar footer aligns with the editor status bar. File tree and file list names use a consistent 14px font. Footer actions appear while the pointer is over the file area or its footer and hide elsewhere. Unpin a recent folder before removing it. Creating a file from the sidebar preserves the current document and unsaved edits. The tree shows a fixed root row and folder icons; file, subfolder, and root context menus provide the relevant creation, rename/undo, duplicate, Recycle Bin, and new-window actions.

## Run the desktop app

The current version is **0.8.0** for Windows x64, Mac Intel (x64), and Mac Apple Silicon (arm64). Launch:

```text
release/0.8.0/Inkslip-win32-x64/Inkslip.exe
```

Download the ZIP for your platform from [Releases](https://github.com/dyzmj/Inkslip/releases), then extract it. On macOS, move `Inkslip.app` to Applications.

Keep the entire application directory together; the EXE is not a standalone file. Save your documents and close the previous version before launching an update.

Preferences, recent files, the user dictionary, themes, and pasted images for unsaved documents live in the application data directory, usually `%APPDATA%\Inkslip` on Windows or `~/Library/Application Support/Inkslip` on macOS. Upgrades copy legacy application data without overwriting existing new settings or deleting the original data and documents.

## Common actions

| Action | Shortcut |
| --- | --- |
| New / Open | Ctrl+N / Ctrl+O |
| Save / Save As | Ctrl+S / Ctrl+Shift+S |
| Toggle source mode | Ctrl+/ |
| Find / Replace | Ctrl+F / Ctrl+H |
| Next / Previous match | F3 / Shift+F3 |
| Close Find | Esc |
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Quick Open | Ctrl+P |
| Show / Hide Sidebar | Ctrl+Shift+L |
| Focus mode | F8 |

On macOS, use Command instead of Ctrl for the listed shortcuts. Classic windows use the top menu bar. Unibody windows start with the menu collapsed: use the top-left menu button for file navigation, or Alt+F and F10 to access menus. The sidebar has File and Outline tabs; sidebar visibility and source-mode controls sit in the bottom status bar.

## Images and PicGo

### Paste images

Press Ctrl+V to insert screenshots, images copied from a browser, or image files copied in File Explorer. For saved documents, pasted images go into a `document-name.assets` folder beside the document. Images for unsaved documents are stored in the application data directory first.

### Configure uploads

1. Configure your image host in PicGo and enable PicGo-Server.
2. Open **File → Preferences → Image**, select **PicGo (app)**, and choose `PicGo.exe` (Windows) or `/Applications/PicGo.app` (macOS). The default upload endpoint is `http://127.0.0.1:36677/upload`.
3. Use the upload verification control to upload a test image.
4. Right-click an image and choose **Upload Image**, or use the image menu to upload local images in the document.

A translucent progress overlay appears during uploads. On success, the returned URL replaces the original source while preserving alternative text and titles; on failure, the source stays intact. Upload edits can be undone, but undo does not delete files from the server. PicGo-Core mode accepts executables and `.js/.cjs/.mjs` entry points. PicGo manages image host settings and credentials.

### Document-level image settings

Configure image behavior through the image menu or YAML front matter:

```yaml
---
inkslip-root-url: ./images
inkslip-copy-images-to: ./assets
---
```

`inkslip-root-url` sets the image root. `inkslip-copy-images-to` sets the destination for newly inserted images; use `upload` to upload them automatically. Document settings override global insertion preferences.

Image copies use available filenames to avoid overwriting existing files. Moves and deletions check shared references within the document directory and its subdirectories, up to 10,000 files; references outside that scope are not checked. Batch image operations support undo/redo for both document edits and file operations. File-operation history lasts for the current application session.

## Themes and preferences

Inkslip includes seven independently written writing presets, using system fonts: Github, Newsprint, Night, Pixyll, Whitey, Lapis, and Vue. Their filenames are stable configuration identifiers; they are not copies of external theme packages. **Vue is the default for new installations and configurations without a selected theme.** Existing theme choices are preserved. Theme changes apply immediately and persist after restart, keeping unsaved text, source mode, and undo history intact.

Use **Open Theme Folder** to add `.css` files and their relative font or image resources, then reload themes. A user theme with the same filename overrides its built-in counterpart. Styles apply in this order:

```text
Theme CSS → base.user.css → <theme-name>.user.css
```

Preferences include Classic/Unibody windows, automatic/custom font size, line height, content width, zoom, the status bar, reading speed, and a separate theme for system dark mode. Window-style changes require a restart; other preferences are saved immediately. External theme rules that depend on a specific editor DOM or plugin may not be fully compatible.

## Import and export

HTML, PDF, and printing work out of the box. Word export and document import require **Pandoc**; its executable path can also be set in Preferences.

Import converts documents into Markdown and extracts local media resources. The editor is temporarily locked during conversion. Word export supports tables and resolvable image resources. Mermaid diagrams remain code text in exported documents; check complex math fonts and pagination in the resulting output.

## Run from source

You need Windows or macOS, Node.js 24 or newer, and npm. The project has been verified with **Node.js 24.20.0**.

```powershell
npm ci
npm start
```

`npm start` builds the frontend and launches the desktop application. For browser-based development:

```powershell
npm run dev
```

The browser preview is intended for development. Local file operations, image upload services, and system integrations require the desktop app. If Electron cannot be downloaded, set a mirror in the current PowerShell session and retry:

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm start
```

## Development and packaging

| Directory | Purpose |
| --- | --- |
| `src/` | Editor, live preview, menus, preferences, and theme adaptation |
| `desktop/` | Electron main process, preload, local files, uploads, and conversion services |
| `shared/` | Menu specifications, interface translations, and shared image-path logic |
| `assets/` | Application logo, independently drawn SVG icons, and built-in CSS presets |
| `examples/` | Markdown examples |
| `scripts/` | Build desktop bundles, generate ZIPs, publish Packages, and generate application icons |
| `.github/workflows/release.yml` | Build Windows and Mac packages and publish versioned releases |

```powershell
# Build the frontend
npm run build

# Package for the current operating system and CPU, including a ZIP and SHA-256 checksum
npm run package

# Windows x64 (run on Windows)
npm run package:win

# Mac Apple Silicon / Intel (run on macOS)
npm run package:mac -- --arch=arm64
npm run package:mac -- --arch=x64
```

Build output is written to `dist/`; packaged applications are written to `release/`. These directories are excluded from Git. Local tests, investigation scripts, generated development notes, logs, screenshots, and the entire `evidence/` directory are also excluded and are not required to build or run a checkout.

The application uses an [M-centered logo](assets/inkslip.svg), with a shared [ICO](assets/inkslip.ico) for the window and EXE. Run `node scripts/generate-icon.mjs` to regenerate PNG and ICO assets; this also requires Python and Pillow.

## Automated releases

Every push to `main` and every pull request builds and launch-checks three packages on native GitHub runners: Windows x64, macOS x64, and macOS arm64. Download their ZIPs and checksums from the workflow's Artifacts section. Local packaging also ends with a ZIP under `release/<version>/`.

To publish a version, update `package.json` and `package-lock.json`, commit, then push a matching version tag:

```bash
git tag v0.8.0
git push origin v0.8.0
```

The workflow waits for all three builds and desktop checks to pass, publishes the platform ZIPs as GitHub npm Packages, and creates a GitHub Release with the ZIPs and `SHA256SUMS.txt`. It uses the repository's built-in `GITHUB_TOKEN` with `contents: write` and `packages: write`; no npm.org token is required. The workflow can also be run manually, with publishing enabled if desired.

Release filenames are `Inkslip-<version>-windows-x64.zip`, `Inkslip-<version>-macos-x64.zip`, and `Inkslip-<version>-macos-arm64.zip`. Packages are `@dyzmj/inkslip-win32-x64`, `@dyzmj/inkslip-darwin-x64`, and `@dyzmj/inkslip-darwin-arm64`, each containing its ZIP and checksum. GitHub Packages may require GitHub authentication to download; Release assets provide direct downloads.

macOS ZIPs preserve application permissions and symbolic links and use an ad-hoc signature. They are not Apple Developer ID signed or notarized, so macOS may require explicit approval in Privacy & Security. Windows builds are also unsigned. These builds are distributed outside app stores.

## Current scope

- Documents are saved manually. Autosave, crash recovery, and automatic updates are not available yet.
- Spell checking uses an offline English dictionary. Chinese grammar checking and automatic language detection are not included.
- Code formatting uses language-aware indentation and does not rewrite expressions.
- Folder search covers the open folder and its subfolders. Global search across independent folders is not available yet.

Third-party dependency licenses remain in their respective packages. Built-in resource details are documented in the [theme notes](assets/themes/NOTICE.md) and [icon notes](assets/icons/NOTICE.md).
