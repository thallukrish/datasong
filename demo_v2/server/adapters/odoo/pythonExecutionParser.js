import { extractOdooModels } from './modelParser.js';

const READ_METHODS = new Set(['search', 'browse', 'read', 'mapped', 'filtered', 'search_read', 'search_count']);
const WRITE_METHODS = new Set(['create', 'write']);

function indentOf(line = '') {
  return (String(line).match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;
}

function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

export function extractOdooExecution(sourcePath, source, addonName) {
  return { models: extractOdooModels(sourcePath, source, addonName), methods: [] };
}

export { READ_METHODS, WRITE_METHODS, indentOf, lineNumber };
