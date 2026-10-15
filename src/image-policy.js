import { Annotation, EditorState, StateEffect, StateField, Transaction, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory, undo, redo } from '@codemirror/commands';
import { createImageUploadAction, imageSources, imageSourceInfo, imageReplacementChanges } from './image-actions.js';
import { imageProperty, withImageProperty, getImageRoot, resolveImageSource } from '../shared/image-paths.js';
export { getImageRoot, resolveImageSource, imageSourceForRoot } from '../shared/image-paths.js';

const policyChange = Annotation.define();
const installed = StateField.define({ create: () => true, update: value => value });
function sourceText(state) { return state.doc.toString(); }
export function setImageProperty(view, name, value) {
  const before = sourceText(view.state), after = withImageProperty(before, name, value);
  if (before === after) return false;
  // Change only the metadata prefix; the body retains its existing positions through change mapping.
  let suffix = 0;
  while (suffix < before.length && suffix < after.length && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  view.dispatch({ changes: { from: 0, to: before.length - suffix, insert: Text.of(after.slice(0, after.length - suffix).split('\n')) },
    annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full'), policyChange.of(true)] });
  view.focus(); return true;
}
export function getInsertImagePolicy(state, preferences = {}) {
  const setting = imageProperty(state, 'inkslip-copy-images-to');
  if (setting !== null) return setting === 'upload' ? { action: 'upload' } : { action: 'copy', folder: setting };
  return { action: preferences.image?.insertAction || 'none', folder: preferences.image?.copyFolder || '' };
}

export function createImageFileAction(view, { desktop, notify = () => {}, getDocumentId = () => null,
  confirm = message => globalThis.confirm(message), onOperation = () => {} }) {
  let pending = false;
  return async (operation, context = {}, options = {}) => {
    if (pending) return { status: 'pending' };
    if (!desktop?.imageFiles) { notify('请使用桌面版操作图片文件'); return { status: 'error' }; }
    const documentId = getDocumentId(), doc = view.state.doc;
    const selected = operation === 'delete' ? [imageSourceInfo(view, context)].filter(Boolean) : options.images || imageSources(view.state);
    if (!selected.length) { notify('没有可操作的图片'); return { status: 'empty' }; }
    if (operation === 'delete' && /^(https?:|data:)/i.test(selected[0].href)) { notify('只能删除本地图片文件'); return { status: 'error' }; }
    if (operation !== 'copy' && !options.automatic && !await confirm(operation === 'delete'
      ? '将删除这张图片的磁盘文件并移除文中图片。会检查当前文档目录及子目录的共享引用，其他目录中的引用无法自动检查。继续？'
      : '移动图片会删除原位置的文件并更新文中地址。会检查当前文档目录及子目录的共享引用，其他目录中的引用无法自动检查。继续？')) return { status: 'cancelled' };
    if (view.state.doc !== doc || getDocumentId() !== documentId) { notify('文档已变化，请重新选择图片'); return { status: 'stale' }; }
    const deletion = operation === 'delete' ? { from: selected[0].inlineFrom, to: selected[0].inlineTo, insert: '' } : null;
    const currentDocument = deletion ? sourceText(view.state).slice(0, deletion.from) + sourceText(view.state).slice(deletion.to) : sourceText(view.state);
    pending = true;
    try {
      const result = await desktop.imageFiles({ operation, sources: [...new Set(selected.map(image => image.href))], documentPath: documentId,
        rootUrl: getImageRoot(view.state), destination: options.destination, currentDocument });
      if (result?.status === 'cancelled') return result;
      if (result?.status !== 'ok') throw Error(result?.message || '图片文件操作失败');
      if (view.state.doc !== doc || getDocumentId() !== documentId) {
        const rollback = await desktop.imageFiles({ operation: 'undo', operationId: result.operationId, documentPath: documentId });
        if (rollback?.status !== 'ok') throw Error(rollback?.message || '文档已变化，图片文件回滚失败');
        notify('文档已变化，图片文件操作已回滚，请重试'); return { status: 'stale' };
      }
      const changes = deletion ? [deletion] : imageReplacementChanges(view.state, result.sources, options.images ? new Set(selected.map(image => image.inlineFrom)) : null);
      const before = sourceText(view.state);
      if (changes.length) view.dispatch({ changes, annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full'), policyChange.of(true)] });
      const after = sourceText(view.state);
      if (before !== after) onOperation({ id: result.operationId, path: documentId, before, after });
      view.focus(); notify(operation === 'delete' ? '图片文件已删除，可撤销恢复' : `已${operation === 'move' ? '移动' : '复制'} ${result.sources.length} 张图片并更新地址`);
      return result;
    } catch (error) { notify(error.message); return { status: 'error', message: error.message }; }
    finally { pending = false; }
  };
}

export function installImagePolicies(view, { desktop, getDocumentId, getPreferences = () => ({}), notify = () => {},
  confirm, uploading = () => {} }) {
  const operations = [];
  let diskQueue = Promise.resolve(), autoQueue = Promise.resolve(), installationPending = false, diskPending = 0, rollingBack = false;
  const run = createImageFileAction(view, { desktop, notify, getDocumentId, confirm, onOperation: record => operations.push(record) });
  const upload = createImageUploadAction(view, { desktop, notify, getDocumentId,
    uploadImage: source => desktop.uploadImage({ source: resolveImageSource(source, getDocumentId(), getImageRoot(view.state)), documentPath: getDocumentId() }) });
  function observe(update) {
    if (!update.docChanged || rollingBack) return;
    if (update.transactions.some(transaction => transaction.annotation(policyChange))) return;
    const before = sourceText(update.startState), after = sourceText(update.state);
    for (const record of operations) {
      const direction = update.transactions.some(transaction => transaction.isUserEvent('undo')) && before === record.after && after === record.before ? 'undo'
        : update.transactions.some(transaction => transaction.isUserEvent('redo')) && before === record.before && after === record.after ? 'redo' : null;
      if (direction) {
        diskPending++;
        diskQueue = diskQueue.then(async () => {
          if (getDocumentId() !== record.path) return;
          try {
            const result = await desktop.imageFiles({ operation: direction, operationId: record.id, documentPath: record.path, currentDocument: after });
            if (result?.status !== 'ok') throw Error(result?.message || '图片磁盘撤销失败');
          } catch (error) {
            if (getDocumentId() === record.path && sourceText(view.state) === after) {
              // Preserve the history stack while cancelling the text half of a rejected disk operation.
              const reverse = direction === 'undo' ? redo : undo;
              rollingBack = true;
              try { reverse({ state: view.state, dispatch: transaction => view.dispatch(transaction) }); }
              finally { rollingBack = false; }
            }
            notify(error.message);
          }
        }).finally(() => { diskPending--; });
      }
    }
    if (update.transactions.some(transaction => transaction.annotation(policyChange) || transaction.isUserEvent('undo') || transaction.isUserEvent('redo'))) return;
    const previous = new Set(imageSources(update.startState).map(image => update.changes.mapPos(image.inlineFrom, 1)));
    const added = imageSources(update.state).filter(image => !previous.has(image.inlineFrom) && !/^(https?:|data:)/i.test(image.href));
    if (!added.length) return;
    const documentId = getDocumentId();
    autoQueue = autoQueue.then(async () => {
      if (getDocumentId() !== documentId) return;
      const policy = getInsertImagePolicy(view.state, getPreferences());
      if (policy.action === 'none') return;
      const current = imageSources(view.state);
      const images = added.map(image => current.find(candidate => candidate.inlineFrom === image.inlineFrom && candidate.href === image.href)).filter(Boolean);
      if (!images.length) return;
      if (policy.action === 'copy') return run('copy', {}, { images, destination: policy.folder, automatic: true });
      uploading(true);
      try {
        for (const image of images.sort((a, b) => b.inlineFrom - a.inlineFrom)) {
          if (getDocumentId() !== documentId) break;
          // Existing upload tracking preserves the original marker on errors or intervening edits.
          await upload({ imageInlineFrom: image.inlineFrom });
        }
      } finally { uploading(false); }
    }).catch(error => notify(error.message));
  }
  function sync() {
    if (view.state.field(installed, false) !== undefined || installationPending) return;
    // Workbench refresh also runs inside EditorView's update listener; append after that update completes.
    installationPending = true;
    queueMicrotask(() => {
      installationPending = false;
      if (view.state.field(installed, false) === undefined) view.dispatch({ effects: StateEffect.appendConfig.of([installed,
        EditorState.transactionFilter.of(transaction => {
          if (!diskPending || rollingBack || !transaction.docChanged || transaction.annotation(policyChange)) return transaction;
          notify('正在处理图片文件撤销或重做，请稍候'); return [];
        }), EditorView.updateListener.of(observe)]) });
    });
  }
  async function choosePolicy(action) {
    const current = getInsertImagePolicy(view.state, getPreferences());
    if (current.action === action) { setImageProperty(view, 'inkslip-copy-images-to', null); return; }
    if (action === 'upload') { setImageProperty(view, 'inkslip-copy-images-to', 'upload'); return; }
    if (!getDocumentId()) { notify('请先保存文档，再设置插入图片的相对文件夹'); return; }
    const doc = view.state.doc, documentId = getDocumentId();
    const result = await desktop.chooseImageFolder({ purpose: 'copy', documentPath: documentId });
    if (result?.status === 'error') notify(result.message);
    else if (result?.path && doc === view.state.doc && documentId === getDocumentId()) setImageProperty(view, 'inkslip-copy-images-to', result.relativePath || result.path);
  }
  async function setRoot() {
    if (getImageRoot(view.state)) { setImageProperty(view, 'inkslip-root-url', null); return; }
    if (!getDocumentId()) { notify('请先保存文档，再设置图片根目录'); return; }
    const doc = view.state.doc, documentId = getDocumentId();
    const result = await desktop.chooseImageFolder({ purpose: 'root', documentPath: documentId });
    if (result?.status === 'error') notify(result.message);
    else if (result?.path && doc === view.state.doc && documentId === getDocumentId()) setImageProperty(view, 'inkslip-root-url', result.relativePath || result.path);
  }
  sync();
  return { sync, run, choosePolicy, setRoot, policy: () => getInsertImagePolicy(view.state, getPreferences()), settled: () => Promise.all([diskQueue, autoQueue]) };
}
