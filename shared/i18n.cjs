const messages = require('./locales/messages.json');

const languages = [
  { id: 'system', label: '跟随系统' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
];

function resolveLanguage(language, systemLanguage = 'zh-CN') {
  if (language === 'system') language = systemLanguage;
  if (/^zh(?:-|$)/i.test(language || '')) return /(?:TW|HK|MO|Hant)/i.test(language) ? 'zh-TW' : 'zh-CN';
  return /^en(?:-|$)/i.test(language || '') ? 'en' : 'zh-CN';
}

const patterns = Object.entries(messages).filter(([source]) => /\{\d+\}/.test(source)).map(([source, translations]) => {
  const parts = source.split(/(\{\d+\})/g), slots = [];
  const expression = parts.map(part => /^\{\d+\}$/.test(part) ? (slots.push(part), '([\\s\\S]*?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return { regex: new RegExp(`^${expression}$`), translations, slots };
});

function translate(text, language = 'zh-CN') {
  if (typeof text !== 'string' || language === 'zh-CN') return text;
  const source = text.trim();
  const entry = messages[source];
  let translated = entry?.[language];
  if (translated === undefined) {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(source);
      if (!match) continue;
      translated = pattern.translations[language]?.replace(/\{\d+\}/g, slot => match[pattern.slots.indexOf(slot) + 1]);
      break;
    }
  }
  if (translated === undefined) return text;
  return text.slice(0, text.indexOf(source)) + translated + text.slice(text.indexOf(source) + source.length);
}

function translateDialog(options, language) {
  const result = { ...options };
  for (const key of ['title', 'message', 'detail']) if (result[key]) result[key] = translate(result[key], language);
  if (result.buttons) result.buttons = result.buttons.map(text => translate(text, language));
  if (result.filters) result.filters = result.filters.map(filter => ({ ...filter, name: translate(filter.name, language) }));
  return result;
}

module.exports = { languages, resolveLanguage, translate, translateDialog };
