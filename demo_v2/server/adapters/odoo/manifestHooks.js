import { applyOdooPatterns } from './patternRegistry.js';

function indentOf(line = '') {
  return (String(line).match(/^(\s*)/)?.[1] || '').replace(/\t/g, '    ').length;
}

function functionRange(source, functionName) {
  const lines = source.split(/\r?\n/);
  const pattern = new RegExp(`^def\\s+${functionName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\(([^)]*)\\)\\s*(?:->\\s*[^:]+)?\\s*:\\s*$`);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(pattern);
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
    return {
      functionName,
      line: i + 1,
      signature: `def ${functionName}(${match[1].trim()})`,
      body: bodyLines.join('\n')
    };
  }
  return null;
}

function callKind(methodName) {
  if (['create', 'write', 'unlink'].includes(methodName)) return 'write';
  if (['search', 'browse', 'read', 'mapped', 'filtered', 'search_read', 'search_count'].includes(methodName)) return 'read';
  return 'model';
}

function callsFromHook(sourcePath, body) {
  const calls = [];
  const boundModels = new Map();
  let match;

  // Binding across statements is contextual resolution, so keep this small piece
  // in code while the direct env-call recognizer itself comes from the registry.
  const bindRe = /\b([A-Za-z_]\w*)\s*=\s*env\s*\[\s*["']([^"']+)["']\s*\]\s*\.\s*(create|browse|search|search_read)\s*\(/g;
  while ((match = bindRe.exec(body))) boundModels.set(match[1], match[2]);

  for (const candidate of applyOdooPatterns(sourcePath, body, { ids: ['python_env_model_call'] })) {
    const modelName = candidate.captures.model;
    const methodName = candidate.captures.method;
    if (modelName && methodName) calls.push({ kind: callKind(methodName), modelName, methodName, ruleId: candidate.ruleId });
  }

  const variableCallRe = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
  while ((match = variableCallRe.exec(body))) {
    const modelName = boundModels.get(match[1]);
    if (!modelName) continue;
    const methodName = match[2];
    if (['create', 'browse', 'search', 'search_read'].includes(methodName)) continue;
    calls.push({ kind: 'model', modelName, methodName });
  }

  const seen = new Set();
  return calls.filter((call) => {
    const key = `${call.kind}:${call.modelName}.${call.methodName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractOdooManifestHooks(sourcePath, source, addonName = '') {
  return applyOdooPatterns(sourcePath, source, { ids: ['manifest_lifecycle_hook'] }).map((candidate) => ({
    addon: addonName,
    manifestPath: sourcePath,
    hookType: candidate.captures.hookType,
    functionName: candidate.captures.function,
    line: candidate.line,
    ruleId: candidate.ruleId
  }));
}

export function extractOdooHookExecution(sourcePath, source, addonName, hook) {
  const range = functionRange(source, hook?.functionName || '');
  if (!range) return null;
  return {
    ...range,
    sourcePath,
    addon: addonName,
    hookType: hook.hookType,
    manifestPath: hook.manifestPath,
    ruleId: hook.ruleId,
    calls: callsFromHook(sourcePath, range.body)
  };
}
