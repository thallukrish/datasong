import { odooRecordsetPreservingMethods } from './patternRegistry.js';

export const READ_METHODS = new Set(['search', 'browse', 'read', 'mapped', 'filtered', 'search_read', 'search_count']);
export const WRITE_METHODS = new Set(['create', 'write', 'unlink']);

export function ormCrudForMethod(methodName = '') {
  if (methodName === 'create') return 'create';
  if (READ_METHODS.has(methodName)) return 'read';
  if (methodName === 'write') return 'update';
  if (methodName === 'unlink') return 'delete';
  return '';
}

function skipSpace(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function matchingParen(text, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseMethodChain(text, start) {
  const methods = [];
  let cursor = start;
  while (cursor < text.length) {
    cursor = skipSpace(text, cursor);
    if (text[cursor] !== '.') break;
    cursor = skipSpace(text, cursor + 1);
    const nameMatch = text.slice(cursor).match(/^([A-Za-z_]\w*)/);
    if (!nameMatch) break;
    const methodName = nameMatch[1];
    cursor = skipSpace(text, cursor + methodName.length);
    if (text[cursor] !== '(') break;
    const close = matchingParen(text, cursor);
    if (close < 0) break;
    methods.push(methodName);
    cursor = close + 1;
  }
  return methods;
}

function callKind(methodName, baseKind) {
  if (WRITE_METHODS.has(methodName)) return 'write';
  if (READ_METHODS.has(methodName)) return 'read';
  return baseKind === 'self' ? 'self' : 'model';
}

function inferVariableModels(body) {
  const bindings = new Map();
  const regex = /\b([A-Za-z_]\w*)\s*=\s*(?:self\s*\.\s*)?env\s*\[\s*["']([^"']+)["']\s*\]/g;
  let match;
  while ((match = regex.exec(body))) bindings.set(match[1], match[2]);
  return bindings;
}

function uniqueCalls(calls) {
  const seen = new Set();
  return calls.filter((call) => {
    const key = `${call.kind}:${call.modelName}.${call.methodName}:${call.crud || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractOdooRecordsetCalls(body, currentModel = '') {
  const text = String(body || '');
  const preserving = new Set(odooRecordsetPreservingMethods());
  const calls = [];

  const addResolvedChain = (modelName, baseKind, methods) => {
    if (!modelName || !methods.length) return;
    for (const methodName of methods) {
      if (preserving.has(methodName)) continue;
      const crud = ormCrudForMethod(methodName);
      calls.push({
        kind: callKind(methodName, baseKind),
        modelName,
        methodName,
        crud,
        persistenceKind: crud ? 'odoo_orm' : ''
      });
      break;
    }
  };

  let match;
  const envRe = /\b(?:self\s*\.\s*)?env\s*\[\s*["']([^"']+)["']\s*\]/g;
  while ((match = envRe.exec(text))) {
    addResolvedChain(match[1], 'model', parseMethodChain(text, envRe.lastIndex));
  }

  if (currentModel) {
    const selfRe = /\bself\b/g;
    while ((match = selfRe.exec(text))) {
      const after = text.slice(selfRe.lastIndex);
      if (/^\s*\.\s*env\b/.test(after)) continue;
      addResolvedChain(currentModel, 'self', parseMethodChain(text, selfRe.lastIndex));
    }
  }

  for (const [variable, modelName] of inferVariableModels(text)) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const variableRe = new RegExp(`\\b${escaped}\\b`, 'g');
    while ((match = variableRe.exec(text))) {
      const before = text.slice(Math.max(0, match.index - 3), match.index);
      if (/=\s*$/.test(before)) continue;
      addResolvedChain(modelName, 'model', parseMethodChain(text, variableRe.lastIndex));
    }
  }

  return uniqueCalls(calls);
}

export { inferVariableModels, parseMethodChain };
