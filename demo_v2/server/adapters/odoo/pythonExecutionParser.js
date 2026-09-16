import { extractOdooModels } from './modelParser.js';
import { applyOdooPatterns } from './patternRegistry.js';
import { extractOdooRecordsetCalls, READ_METHODS, WRITE_METHODS } from './recordsetCallResolver.js';

function indentOf(line = '') {
  return (String(line).match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;
}

function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function callsFrom(body, modelName, sourcePath) {
  const calls = extractOdooRecordsetCalls(body, modelName);

  for (const candidate of applyOdooPatterns(sourcePath, body, { ids: ['python_super_call', 'python_explicit_super_call'] })) {
    calls.push({ kind: 'super', modelName, methodName: candidate.captures.method, ruleId: candidate.ruleId });
  }

  for (const candidate of applyOdooPatterns(sourcePath, body, { ids: ['python_self_relational_field_call'] })) {
    const fieldName = candidate.captures.field;
    const methodName = candidate.captures.method;
    if (!fieldName || !methodName || fieldName === 'env') continue;
    calls.push({ kind: 'field', modelName, fieldName, methodName, ruleId: candidate.ruleId });
  }

  const seen = new Set();
  return calls.filter((call) => {
    const key = `${call.kind}:${call.modelName}.${call.fieldName || ''}.${call.methodName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classRanges(source) {
  const matches = [...source.matchAll(/^class\s+([A-Za-z_]\w*)\s*\([^\n]*models\.[A-Za-z_]\w*[^\n]*\)\s*:\s*$/gm)];
  return matches.map((match, index) => ({
    className: match[1],
    bodyStart: match.index + match[0].length,
    end: index + 1 < matches.length ? matches[index + 1].index : source.length
  }));
}

function methodRanges(source, range, model, sourcePath) {
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
      calls: callsFrom(body, model.name, sourcePath),
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
    methods.push(...methodRanges(source, range, model, sourcePath).map((method) => ({ ...method, sourcePath, addon: addonName })));
  }
  return { models, methods };
}

export { READ_METHODS, WRITE_METHODS, indentOf, lineNumber };
