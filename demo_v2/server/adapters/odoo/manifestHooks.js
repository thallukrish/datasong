import { applyOdooPatterns } from './patternRegistry.js';
import { extractOdooRecordsetCalls } from './recordsetCallResolver.js';
import { extractSqlCalls } from './pythonExecutionParser.js';

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
  const lifecycleCalls = [...extractOdooRecordsetCalls(range.body), ...extractSqlCalls(range.body)];
  return {
    ...range,
    sourcePath,
    addon: addonName,
    hookType: hook.hookType,
    manifestPath: hook.manifestPath,
    ruleId: hook.ruleId,
    executionKind: 'lifecycle_setup',
    // Lifecycle hooks are installation/setup evidence, not normal runtime
    // business-flow entrypoints. Preserve deterministic persistence facts but
    // do not emit model-method calls into the executable call topology.
    calls: lifecycleCalls.filter((call) => ['read', 'write', 'sql'].includes(call.kind)),
    lifecycleCalls
  };
}
