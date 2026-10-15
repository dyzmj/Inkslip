export function migrateLocalSettings(storage) {
  for (const setting of ['preferences', 'final-newline']) {
    const key = `inkslip-${setting}`, previous = storage.getItem(`inkpage-${setting}`);
    if (storage.getItem(key) === null && previous !== null) storage.setItem(key, previous);
  }
}
