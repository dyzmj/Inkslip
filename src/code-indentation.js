import { EditorState } from '@codemirror/state';
import { LanguageDescription, IndentContext, ensureSyntaxTree, getIndentation, indentUnit, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

// Code tools change indentation without rewriting tokens.
export async function codeIndentationChanges(code, language, { fromLine = 1, toLine = Infinity, indentSize = 4 } = {}) {
  const description = LanguageDescription.matchLanguageName(languages, language || '', true);
  if (!description) return null;
  const support = await description.load();
  const state = EditorState.create({ doc: code, extensions: [support, indentUnit.of(' '.repeat(indentSize))] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const overrides = new Map();
  const context = new IndentContext(state, { overrideIndentation: pos => overrides.get(pos) ?? -1 });
  const changes = [];
  for (let number = Math.max(1, fromLine); number <= Math.min(state.doc.lines, toLine); number++) {
    const line = state.doc.line(number);
    // Leading whitespace inside a multiline string is data, not indentation.
    let node = syntaxTree(state).resolveInner(line.from + (line.text.match(/^\s*/)?.[0].length || 0), 1);
    let stringLine = false;
    while (node) {
      if (/^(?:String|TemplateString|TemplateLiteral|StringContent)$/.test(node.name) && node.from < line.from) stringLine = true;
      node = node.parent;
    }
    if (stringLine) continue;
    const indent = line.text.trim() ? getIndentation(context, line.from) : 0;
    if (indent === null) continue;
    overrides.set(line.from, indent);
    const whitespace = line.text.match(/^[ \t]*/)[0];
    const insert = ' '.repeat(indent);
    if (whitespace !== insert) changes.push({ line: number, from: line.from, to: line.from + whitespace.length, insert });
  }
  return changes;
}
