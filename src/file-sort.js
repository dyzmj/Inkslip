export function sortFiles(entries, { sort = 'natural', descending = false, group = true } = {}) {
  return [...entries].sort((a, b) => {
    if (group && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let result;
    if (sort === 'modified' || sort === 'created') result = a[sort] - b[sort];
    else if (sort === 'name') {
      const name = item => item.name.toLowerCase().replace(/\..+/, '');
      const left = name(a), right = name(b);
      result = left === right ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : left < right ? -1 : 1;
    } else result = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    return (descending ? -1 : 1) * (result || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  });
}
