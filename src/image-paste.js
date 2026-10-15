import { Text, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { getImageRoot, imageSourceForRoot } from '../shared/image-paths.js';

export function createImagePasteAction(view, { desktop, notify, getDocumentId }) {
  let pending = false;
  return async files => {
    if (pending) return true;
    const doc = view.state.doc, documentPath = getDocumentId();
    const selection = view.state.selection.main;
    pending = true;
    try {
      const result = files
        ? await desktop.pasteImages({ documentPath, images: await Promise.all(files.map(async file => ({
          mime: file.type, bytes: new Uint8Array(await file.arrayBuffer())
        }))) })
        : await desktop.readClipboardImages({ documentPath });
      if (result.status === 'error') throw Error(result.message);
      if (!result.sources?.length) return false;
      if (view.state.doc !== doc || getDocumentId() !== documentPath) {
        notify('文档已变化，请重新粘贴图片'); return true;
      }
      const markers = result.sources.map(source => imageSourceForRoot(source, documentPath, getImageRoot(view.state)))
        .map(source => `![](${/[\s()<>]/.test(source) ? `<${source}>` : source})`).join('\n\n');
      const before = doc.sliceString(0, selection.from);
      const insert = (before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : '') + markers + '\n\n';
      view.dispatch({ changes: { from: selection.from, to: selection.to, insert: Text.of(insert.split('\n')) },
        selection: { anchor: selection.from + insert.length },
        annotations: [Transaction.userEvent.of('input.paste'), isolateHistory.of('full')] });
      view.focus(); notify('图片已粘贴'); return true;
    } catch (error) { notify(`粘贴图片失败：${error.message}`); return true; }
    finally { pending = false; }
  };
}
