import { search, SearchQuery, getSearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel } from '@codemirror/search';
import regexpIcon from '../assets/icons/search-regexp.svg?raw';
import caseIcon from '../assets/icons/search-case.svg?raw';
import wordIcon from '../assets/icons/search-word.svg?raw';

// Two aligned rows, matching options and result navigation.
function createPanel(view) {
  const dom = document.createElement('div');
  dom.id = 'md-searchpanel'; dom.className = 'cm-search'; dom.dataset.replace = 'false';
  dom.innerHTML = '<div class="search-group"><div class="search-labels"><span>查找</span><span class="replace-row" hidden>替换</span></div><div class="search-inputs"><div class="search-row"><input name="search" aria-label="查找" placeholder="查找" main-field="true" autocomplete="off"><div class="search-options"><button type="button" data-option="regexp" title="正则表达式" aria-label="正则表达式" aria-pressed="false">.*</button><button type="button" data-option="caseSensitive" title="区分大小写" aria-label="区分大小写" aria-pressed="false">Aa</button><button type="button" data-option="wholeWord" title="全字匹配" aria-label="全字匹配" aria-pressed="false">ab</button></div></div><div class="search-row replace-row" hidden><input name="replace" aria-label="替换为" placeholder="替换为" autocomplete="off"></div></div><div class="search-actions"><div class="search-row"><span class="search-status" role="status"></span><button type="button" name="prev" title="上一个" aria-label="上一个">↑</button><button type="button" name="next" title="下一个" aria-label="下一个">↓</button><button type="button" name="close" title="关闭" aria-label="关闭查找">×</button></div><div class="search-row replace-row" hidden><button type="button" name="replace-one">替换</button><button type="button" name="replace-all">全部替换</button></div></div></div>';
  const input = dom.querySelector('[name="search"]'), replacement = dom.querySelector('[name="replace"]');
  const status = dom.querySelector('.search-status');
  for (const [name, svg] of Object.entries({ regexp: regexpIcon, caseSensitive: caseIcon, wholeWord: wordIcon })) dom.querySelector(`[data-option="${name}"]`).innerHTML = svg;
  for (const name of ['prev', 'next', 'close']) dom.querySelector(`[name="${name}"]`).textContent = '';
  const searchLabel = dom.querySelector('.search-labels > span:first-child'), replaceLabel = dom.querySelector('.search-labels > span:last-child');
  function label(node, name, expand) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
    button.className = expand ? 'search-expand-label' : 'search-collapse-label'; button.setAttribute('aria-label', expand ? '展开替换' : '收起替换');
    button.onclick = () => { mode(expand); if (expand) replacement.focus(); };
    node.replaceChildren(button);
  }
  label(searchLabel, '查找', true); label(replaceLabel, '替换', false);
  const topActions = dom.querySelector('.search-actions > .search-row');
  topActions.insertBefore(topActions.querySelector('[name="prev"]'), status);
  topActions.insertBefore(topActions.querySelector('[name="next"]'), status);
  const bottomActions = dom.querySelector('.search-actions > .replace-row');
  bottomActions.prepend(bottomActions.querySelector('[name="replace-all"]'));
  function position() {
    const box = document.querySelector('.workspace').getBoundingClientRect();
    dom.style.left = `${box.left}px`; dom.style.top = `${box.top}px`; dom.style.width = `${box.width}px`;
  }
  function mode(replace) {
    dom.dataset.replace = String(replace);
    dom.querySelectorAll('.replace-row').forEach(row => { row.hidden = !replace; });
    document.body.style.setProperty('--document-search-height', replace ? '74px' : '39px');
    position(); input.focus();
  }
  function sync() {
    const query = getSearchQuery(view.state);
    if (input.value !== query.search) input.value = query.search;
    if (replacement.value !== query.replace) replacement.value = query.replace;
    for (const button of dom.querySelectorAll('[data-option]')) button.setAttribute('aria-pressed', String(query[button.dataset.option]));
    let total = 0, current = 0;
    if (query.valid) for (const match of query.getCursor(view.state)) {
      total++;
      if (match.from === view.state.selection.main.from && match.to === view.state.selection.main.to) current = total;
    }
    status.textContent = query.search ? query.valid ? `${current} / ${total}` : '无效表达式' : '';
    input.setAttribute('aria-invalid', String(Boolean(query.search) && !query.valid));
  }
  function updateQuery() {
    const options = Object.fromEntries([...dom.querySelectorAll('[data-option]')].map(button => [button.dataset.option, button.getAttribute('aria-pressed') === 'true']));
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value, replace: replacement.value, ...options })) });
  }
  input.oninput = replacement.oninput = updateQuery;
  for (const button of dom.querySelectorAll('[data-option]')) button.onclick = () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')); updateQuery(); input.focus();
  };
  const commands = { prev: findPrevious, next: findNext, 'replace-one': replaceNext, 'replace-all': replaceAll, close: closeSearchPanel };
  for (const [name, command] of Object.entries(commands)) dom.querySelector(`[name="${name}"]`).onclick = () => command(view);
  dom.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearchPanel(view); view.focus(); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); (event.target === replacement ? replaceNext : event.shiftKey ? findPrevious : findNext)(view); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); mode(false); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') { event.preventDefault(); event.stopPropagation(); mode(true); }
  });
  dom.addEventListener('inkslip-search-mode', event => mode(event.detail === 'replace'));
  const observer = new ResizeObserver(position);
  return {
    dom, top: true,
    mount() {
      document.body.classList.add('document-search-open');
      observer.observe(document.querySelector('.workspace')); observer.observe(document.querySelector('.menubar'));
      mode(false); sync();
    },
    update() { sync(); },
    destroy() { observer.disconnect(); document.body.classList.remove('document-search-open'); document.body.style.removeProperty('--document-search-height'); }
  };
}

export const documentSearchExtension = search({ top: true, createPanel });
