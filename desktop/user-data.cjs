const fs = require('node:fs/promises');
const path = require('node:path');

async function migrateUserData(directory, legacyDirectory) {
  await fs.mkdir(directory, { recursive: true });
  const files = [['inkpage-preferences.json', 'inkslip-preferences.json'], ['recent-documents.json', 'recent-documents.json'], ['spelling-words.json', 'spelling-words.json']];
  for (const [source, destination] of files) {
    try { await fs.copyFile(path.join(legacyDirectory, source), path.join(directory, destination), require('node:fs').constants.COPYFILE_EXCL); }
    catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
  }
  for (const name of ['themes', 'pasted-images']) {
    const destination = path.join(directory, name);
    try { await fs.access(destination); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fs.cp(path.join(legacyDirectory, name), destination, { recursive: true, force: false, errorOnExist: true }); }
      catch (copyError) { if (copyError.code !== 'ENOENT') throw copyError; }
    }
  }
}

module.exports = { migrateUserData };
