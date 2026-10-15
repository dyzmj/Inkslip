const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  newDocument: () => ipcRenderer.invoke('desktop:new'),
  convertDocument: request => ipcRenderer.invoke('desktop:convert-document', request),
  pickPandoc: () => ipcRenderer.invoke('desktop:pandoc-pick'),
  fileProperties: () => ipcRenderer.invoke('desktop:file-properties'),
  imageFiles: request => ipcRenderer.invoke('desktop:image-files', request),
  chooseImageFolder: request => ipcRenderer.invoke('desktop:image-folder', request),
  checkSpelling: words => ipcRenderer.invoke('desktop:spelling-check', words),
  spellingSuggestions: word => ipcRenderer.invoke('desktop:spelling-suggest', word),
  learnSpelling: word => ipcRenderer.invoke('desktop:spelling-learn', word),
  openExample: () => ipcRenderer.invoke('desktop:open-example'),
  recentDocuments: () => ipcRenderer.invoke('desktop:recent-documents'),
  documentOperation: (request) => ipcRenderer.invoke('desktop:document-operation', request),
  copyImageContent: (request) => ipcRenderer.invoke('desktop:image-copy-content', request),
  openFolder: path => ipcRenderer.invoke('desktop:open-folder', path),
  recentFolders: request => ipcRenderer.invoke('desktop:recent-folders', request),
  scanFolder: () => ipcRenderer.invoke('desktop:scan-folder'),
  searchFolder: query => ipcRenderer.invoke('desktop:search-folder', query),
  newLibraryFile: path => ipcRenderer.invoke('desktop:new-library-file', path),
  libraryOperation: request => ipcRenderer.invoke('desktop:library-operation', request),
  startupDocument: () => ipcRenderer.invoke('desktop:startup-document'),
  renameLibraryFile: request => ipcRenderer.invoke('desktop:rename-library-file', request),
  openLibraryFolder: () => ipcRenderer.invoke('desktop:open-library-folder'),
  listFolder: (path) => ipcRenderer.invoke('desktop:list-folder', path),
  openPath: (path) => ipcRenderer.invoke('desktop:open-path', path),
  revealFile: (path) => ipcRenderer.invoke('desktop:reveal-file', path),
  readClipboard: () => ipcRenderer.invoke('desktop:clipboard-read'),
  readClipboardImages: (request) => ipcRenderer.invoke('desktop:clipboard-images', request),
  pasteImages: (request) => ipcRenderer.invoke('desktop:paste-images', request),
  writeClipboard: (text) => ipcRenderer.invoke('desktop:clipboard-write', text),
  pickImage: () => ipcRenderer.invoke('desktop:pick-image'),
  getPreferences: () => ipcRenderer.invoke('desktop:preferences-get'),
  setPreferences: (preferences) => ipcRenderer.invoke('desktop:preferences-set', preferences),
  listThemes: () => ipcRenderer.invoke('desktop:themes-list'),
  loadTheme: (id) => ipcRenderer.invoke('desktop:theme-load', id),
  openThemesFolder: () => ipcRenderer.invoke('desktop:theme-folder'),
  systemTheme: () => ipcRenderer.invoke('desktop:system-theme'),
  themeApplied: (id, dark, separate) => ipcRenderer.send('desktop:theme-applied', id, dark, separate),
  onSystemTheme: (callback) => {
    const listener = (_event, dark) => callback(dark);
    ipcRenderer.on('desktop:system-theme-changed', listener);
    return () => ipcRenderer.removeListener('desktop:system-theme-changed', listener);
  },
  pickPicgoPath: (kind) => ipcRenderer.invoke('desktop:picgo-pick', kind),
  uploadImage: (request) => ipcRenderer.invoke('desktop:image-upload', request),
  testImageUpload: (preferences) => ipcRenderer.invoke('desktop:image-upload-test', preferences),
  imageFile: (request) => ipcRenderer.invoke('desktop:image-file', request),
  windowAction: (command) => ipcRenderer.invoke('desktop:window-action', command),
  applyWindowPreferences: (appearance) => ipcRenderer.invoke('desktop:window-preferences', appearance),
  onWindowStyle: (callback) => {
    const listener = (_event, style) => callback(style);
    ipcRenderer.on('desktop:window-style', listener);
    return () => ipcRenderer.removeListener('desktop:window-style', listener);
  },
  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:window-state', listener);
    return () => ipcRenderer.removeListener('desktop:window-state', listener);
  },
  exportDocument: ({ format, html }) => ipcRenderer.invoke('desktop:export', { format, html }),
  onCommand: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('onCommand requires a callback');
    const listener = (_event, command, context) => callback(command, context);
    ipcRenderer.on('desktop:command', listener);
    return () => ipcRenderer.removeListener('desktop:command', listener);
  },
  openDocument: () => ipcRenderer.invoke('desktop:open'),
  saveDocument: ({ path, content, expectedRevision, saveAs = false }) => ipcRenderer.invoke('desktop:save', {
    path,
    content,
    expectedRevision,
    saveAs,
  }),
  setDirty: (dirty) => ipcRenderer.send('desktop:dirty', Boolean(dirty)),
  openLink: (url) => ipcRenderer.invoke('desktop:link', url),
}));
