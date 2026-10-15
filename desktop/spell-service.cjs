const fs = require('node:fs/promises');
const path = require('node:path');
const nspell = require('nspell');

async function createSpellService(file) {
  const { default: dictionary } = await import('dictionary-en');
  const spell = nspell(dictionary);
  let learned = [];
  try { learned = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const word of learned) spell.add(word);
  return {
    check(words) { return [...new Set(words)].filter(word => !spell.correct(word)); },
    suggest(word) { return spell.suggest(word).slice(0, 6); },
    async learn(word) {
      if (!/^[A-Za-z][A-Za-z'-]{0,79}$/.test(word)) throw Error('词典词条无效');
      if (!learned.includes(word)) { learned.push(word); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(learned)); spell.add(word); }
    },
  };
}
module.exports = { createSpellService };
