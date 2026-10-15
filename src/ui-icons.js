// Small, independently drawn interface symbols. No icon font is required.
const shapes = {
  cut: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8 9 13 11 M8 15 21 4"/>',
  copy: '<rect x="8" y="7" width="12" height="14" rx="1"/><path d="M16 7V3H4v14h4"/>',
  paste: '<path d="M8 5H4v16h16V5h-4 M8 3h8v4H8Z M8 12h8 M8 16h6"/>',
  'delete-selection': '<path d="M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7"/>',
  bold: '<path d="M7 3h6a4.5 4.5 0 0 1 0 9H7 M7 3v18h7a4.5 4.5 0 0 0 0-9H7"/>',
  italic: '<path d="M10 3h10 M4 21h10 M15 3 9 21"/>',
  'inline-code': '<path d="m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16"/>',
  link: '<path d="m9 8 3-3a5 5 0 0 1 7 7l-3 3 M15 16l-3 3a5 5 0 0 1-7-7l3-3 M8 16l8-8"/>',
  quote: '<path d="M4 5h6v7H5c0 4-1 5-3 6 M14 5h6v7h-5c0 4-1 5-3 6"/>',
  'ordered-list': '<path d="M11 6h10 M11 12h10 M11 18h10 M4 3h1v5 M3 8h4 M3 11c3-2 5 1 1 4h3 M3 18h3l-2 2h2l-1 2H3"/>',
  'bullet-list': '<circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M10 6h11 M10 12h11 M10 18h11"/>',
  'task-list': '<path d="M3 4h6v6H3Z M3 15l2 2 4-5 M13 7h8 M13 16h8"/>',
  outdent: '<path d="M3 4h18 M11 9h10 M11 15h10 M3 20h18 M7 9l-4 3 4 3"/>',
  indent: '<path d="M3 4h18 M11 9h10 M11 15h10 M3 20h18 M3 9l4 3-4 3"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3Z"/>',
  file: '<path d="M5 3h9l5 5v13H5Z M14 3v5h5 M8 12h8 M8 16h6"/>',
  pin: '<path d="m8 3 9 2 M10 4l-1 6-4 4 11 2-2-5 1-6 M10 15l-2 7"/>',
  remove: '<path d="M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7"/>',
};

export function uiIcon(name) {
  const shape = shapes[name];
  return shape ? `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>` : '';
}
