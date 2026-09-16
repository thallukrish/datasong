import { extractOdooModels } from './modelParser.js';
import { applyOdooPatterns } from './patternRegistry.js';
import { extractOdooRecordsetCalls, READ_METHODS, WRITE_METHODS } from './recordsetCallResolver.js';

function indentOf(line = '') {
  return (String(line).match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;
}

function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function sqlCrud(operation = '') {
  const normalized = String(operation || '').toUpperCase();
  if (normalized === 'SELECT') return 'read';
  if (normalized === 'INSERT') return 'create';
  if (normalized === 'UPDATE') return 'update';
  if (normalized === 'DELETE') return 'delete';
  return '';
}

function parseLiteralSql(sql = '') {
  const text = String(sql || '').trim();
  const op = text.match(/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1]?.toUpperCase() || '';
  if (!op) return { sqlOperation: '', crud: '', persistedEntity: '' };
  let table = '';
  if (op === 'SELECT') table = text.match(/\bFROM\s+([A-Za-z_][\w$.]*)/i)?.[1] || '';
  else if (op === 'INSERT') table = text.match(/\bINTO\s+([A-Za-z_][\w$.]*)/i)?.[1] || '';
  else if (op === 'UPDATE') table = text.match(/^\s*UPDATE\s+([A-Za-z_][\w$.]*)/i)?.[1] || '';
  else if (op === 'DELETE') table = text.match(/\bFROM\s+([A-Za-z_][\w$.]*)/i)?.[1] || '';
  return { sqlOperation: op, crud: sqlCrud(op), persistedEntity: table };
}

function extractSqlCalls(body = '') {
  const text = String(body || '');
  const calls = [];
  const executeRe = /\b(?:(?:self\s*\.\s*)?env\s*\.\s*cr|self\s*\.\s*_cr)\s*\.\s*execute\s*\(([^\n]*)/g;
  let match;
  while ((match = executeRe.exec(text))) {
    const args = String(match[1] || '').trim();
    const literal = args.match(/^(["'])([\s\S]*?)\1/);
    if (literal) {
      const parsed = parseLiteralSql(literal[2]);
      calls.push({
        kind: 'sql',
        modelName: '',
        methodName: 'execute',
        persistenceKind: 'sql',
        ...parsed
      });
    } else {
      calls.push({
        kind: 'sql',
        modelName: '',
        methodName: 'execute',
        persistenceKind: 'sql',
        sqlOperation: '',
        crud: '',
        persistedEntity: ''
      });
    }
  }
  return calls;
}

function callsFrom(body, modelName, sourcePath) {
  const calls = [...extractOdooRecordsetCalls(body, modelName), ...extractSqlCalls(body)];

  for (const candidate of applyOdooPatterns(sourcePath, body, { ids: ['python_super_call', 'python_explicit_super_call'] })) {
    calls.push({ kind: 'super', modelName, methodName: candidate.captures.method, ruleId: candidate.ruleId });
  }

  for (const candidate of applyOdooPatterns(sourcePath, body, { ids: ['python_self_relational_field_call'] })) {
    const fieldName = candidate.captures.field;
    const methodName = candidate.captures.method;
    if (!fieldName || !methodName || fieldName === 'env') continue;
    calls.push({ kind: 'field', modelName, fieldName, methodName, ruleId: candidate.ruleId });
  }

  for (const candidate of applyOdooPatterns(sourcePath, body, { ids: ['python_env_dynamic_getattr_dispatch'] })) {
    const targetModel = candidate.captures.model;
    const methodPrefix = candidate.captures.prefix || '';
    const methodSuffix = candidate.captures.suffix || '';
    const selector = candidate.captures.selector || '';
    if (!targetModel || (!methodPrefix && !methodSuffix)) continue;
    calls.push({
      kind: 'dynamic_model',
      modelName: targetModel,
      methodPrefix,
      methodSuffix,
      selector,
      ruleId: candidate.ruleId
    });
  }

  const seen = new Set();
  return calls.filter((call) => {
    const methodKey = call.methodName || `${call.methodPrefix || ''}*${call.methodSuffix || ''}`;
    const key = call.kind === 'sql'
      ? `sql:${call.sqlOperation || ''}:${call.persistedEntity || ''}`
      : `${call.kind}:${call.modelName}.${call.fieldName || ''}.${methodKey}:${call.crud || ''}`;
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

export { READ_METHODS, WRITE_METHODS, indentOf, lineNumber, extractSqlCalls, parseLiteralSql };
