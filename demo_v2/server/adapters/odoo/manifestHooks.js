function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

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

function callsFromHook(body) {
  const calls = [];
  const boundModels = new Map();
  let match;

  const bindRe = /\b([A-Za-z_]\w*)\s*=\s*env\s*\[\s*["']([^"']+)["']\s*\]\s*\.\s*(create|browse|search|search_read)\s*\(/g;
  while ((match = bindRe.exec(body))) boundModels.set(match[1], match[2]);

  const envRe = /\benv\s*\[\s*["']([^"']+)["']\s*\]\s*\.\s*([A-Za-z_]\w*)\s*\(/g;
  while ((match = envRe.exec(body))) {
    const methodName = match[2];
    const kind = methodName === 'create' || methodName === 'write' || methodName === 'unlink'
      ? 'write'
      : ['search', 'browse', 'read', 'mapped', 'filtered', 'search_read', 'search_count'].includes(methodName)
        ? 'read'
        : 'model';
    calls.push({ kind, modelName: match[1], methodName });
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
  const hooks = [];
  const hookRe = /["'](pre_init_hook|post_init_hook|uninstall_hook)["']\s*:\s*["']([^"']+)["']/g;
  let match;
  while ((match = hookRe.exec(source))) {
    hooks.push({
      addon: addonName,
      manifestPath: sourcePath,
      hookType: match[1],
      functionName: match[2],
      line: lineNumber(source, match.index)
    });
  }
  return hooks;
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
    calls: callsFromHook(range.body)
  };
}
