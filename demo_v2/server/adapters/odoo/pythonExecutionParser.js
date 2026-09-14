import { extractOdooModels } from './modelParser.js';

const READ_METHODS = new Set(['search', 'browse', 'read', 'mapped', 'filtered', 'search_read', 'search_count']);
const WRITE_METHODS = new Set(['create', 'write']);

function indentOf(line = '') {
  return (String(line).match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;
}

function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function callsFrom(body, modelName) {
  const calls = [];
  let match;

  const envRe = /self\.env\s*\[\s*["']([^"']+)["']\s*\]\s*\.\s*([A-Za-z_]\w*)\s*\(/g;
  while ((match = envRe.exec(body))) {
    const methodName = match[2];
    const kind = WRITE_METHODS.has(methodName) ? 'write' : READ_METHODS.has(methodName) ? 'read' : 'model';
    calls.push({ kind, modelName: match[1], methodName });
  }

  const superRe = /super\s*\(\s*\)\s*\.\s*([A-Za-z_]\w*)\s*\(/g;
  while ((match = superRe.exec(body))) calls.push({ kind: 'super', modelName, methodName: match[1] });

  const selfRe = /\bself\.([A-Za-z_]\w*)\s*\(/g;
  while ((match = selfRe.exec(body))) {
    const methodName = match[1];
    const kind = WRITE_METHODS.has(methodName) ? 'write' : READ_METHODS.has(methodName) ? 'read' : 'self';
    calls.push({ kind, modelName, methodName });
  }
  return calls;
}

function classRanges(source) {
  const matches = [...source.matchAll(/^class\s+([A-Za-z_]\w*)\s*\([^\n]*models\.[A-Za-z_]\w*[^\n]*\)\s*:\s*$/gm)];
  return matches.map((match, index) => ({
    className: match[1],
    bodyStart: match.index + match[0].length,
    end: index + 1 < matches.length ? matches[index + 1].index : source.length
  }));
}

function methodRanges(source, range, model) {
  const text = source.slice(range.bodyStart, range.end);
  const lines = text.split(/\r?\n/);
  const baseLine = lineNumber(source, range.bodyStart);
  const methods = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(\s+)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:\s*$/);
    if (!match) continue;
    const indent = indentOf(lines[i]);
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const candidate = lines[j];
      if (candidate.trim() && indentOf(candidate) <= indent) break;
      bodyLines.push(candidate);
      j += 1;
    }
    const body = bodyLines.join('\n');
    methods.push({
      modelName: model.name,
      className: range.className,
      methodName: match[2],
      line: baseLine + i,
      signature: `def ${match[2]}(${match[3].trim()})`,
      body,
      calls: callsFrom(body, model.name),
      extension: model.extension,
      inherits: model.inherits
    });
    i = Math.max(i, j - 1);
  }
  return methods;
}

export function extractOdooExecution(sourcePath, source, addonName) {
  const models = extractOdooModels(sourcePath, source, addonName);
  const byClass = new Map(models.map((model) => [model.className, model]));
  const methods = [];
  for (const range of classRanges(source)) {
    const model = byClass.get(range.className);
    if (!model) continue;
    methods.push(...methodRanges(source, range, model).map((method) => ({ ...method, sourcePath, addon: addonName })));
  }
  return { models, methods };
}

export { READ_METHODS, WRITE_METHODS, indentOf, lineNumber };
