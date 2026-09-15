import fs from 'node:fs/promises';
import path from 'node:path';
import { extractOdooExecution } from './pythonExecutionParser.js';
import { ensureOdooSource, findOdooModelFiles } from './frameworkSource.js';

function projectMethodName(modelName, methodName) {
  return `odoo-project:${modelName}.${methodName}`;
}

function frameworkMethodName(version, modelName, methodName) {
  return `odoo${version}:${modelName}.${methodName}`;
}

function addonForPath(sourcePath, addons = []) {
  const parts = String(sourcePath || '').replace(/\\/g, '/').split('/');
  for (const addon of addons) if (parts.includes(addon?.name)) return addon.name;
  return '';
}

function addReference(symbol, name, relation) {
  if (!symbol || !name) return;
  if (!Array.isArray(symbol.references)) symbol.references = [];
  if (!symbol.references.some((ref) => ref.name === name && ref.relation === relation)) {
    symbol.references.push({ name, simpleName: String(name).split(/[.:/]/).at(-1), relation, explicit: true });
  }
}

export class OdooExecutionAdapter {
  constructor(topology, options = {}) {
    this.topology = topology;
    this.options = options;
  }

  async augment() {
    const topology = this.topology;
    const version = String(topology?.odooDetection?.version || '');
    const addons = Array.isArray(topology?.odooDetection?.addons) ? topology.odooDetection.addons : [];
    const tracked = Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : [];
    const projectMethods = [];

    for (const sourcePath of tracked.filter((file) => /(?:^|\/)models\/.*\.py$/.test(file))) {
      const addon = addonForPath(sourcePath, addons);
      if (!addon) continue;
      const source = await fs.readFile(path.join(topology.repoDir, sourcePath), 'utf8').catch(() => '');
      if (!source) continue;
      projectMethods.push(...extractOdooExecution(sourcePath, source, addon).methods);
    }

    const projectByKey = new Map(projectMethods.map((method) => [`${method.modelName}.${method.methodName}`, method]));
    const projectSymbols = new Map();
    const pendingFramework = [];
    const uiEntrypoints = Array.isArray(this.options.uiEntrypoints) ? this.options.uiEntrypoints : [];
    let bridgedSuperCalls = 0;

    for (const entrypoint of uiEntrypoints) {
      if (!entrypoint?.modelName || !entrypoint?.methodName) continue;
      pendingFramework.push({ modelName: entrypoint.modelName, methodName: entrypoint.methodName, depth: 0 });
    }

    for (const method of projectMethods) {
      const symbol = topology.addSemanticFunction({
        sourcePath: method.sourcePath,
        name: projectMethodName(method.modelName, method.methodName),
        symbolKind: 'odoo_project_method',
        semanticType: 'odoo_executable_python',
        line: method.line,
        signature: `${method.modelName}.${method.signature}`,
        body: method.body
      });
      symbol.odooExecution = { layer: 'project', modelName: method.modelName, methodName: method.methodName, addon: method.addon };
      projectSymbols.set(`${method.modelName}.${method.methodName}`, symbol);
    }

    for (const method of projectMethods) {
      const symbol = projectSymbols.get(`${method.modelName}.${method.methodName}`);
      for (const call of method.calls) {
        if (call.kind === 'super') {
          const target = frameworkMethodName(version, call.modelName, call.methodName);
          addReference(symbol, target, 'calls');
          pendingFramework.push({ modelName: call.modelName, methodName: call.methodName, depth: 0 });
          bridgedSuperCalls += 1;
          continue;
        }
        if (call.kind === 'self') {
          const projectTarget = projectByKey.has(`${call.modelName}.${call.methodName}`)
            ? projectMethodName(call.modelName, call.methodName)
            : frameworkMethodName(version, call.modelName, call.methodName);
          addReference(symbol, projectTarget, 'calls');
          if (!projectByKey.has(`${call.modelName}.${call.methodName}`)) {
            pendingFramework.push({ modelName: call.modelName, methodName: call.methodName, depth: 0 });
          }
          continue;
        }
        if (call.kind === 'model') {
          const target = frameworkMethodName(version, call.modelName, call.methodName);
          addReference(symbol, target, 'calls');
          pendingFramework.push({ modelName: call.modelName, methodName: call.methodName, depth: 0 });
          continue;
        }
        if (call.kind === 'read' || call.kind === 'write') addReference(symbol, call.modelName, call.kind === 'read' ? 'reads' : 'writes');
      }
    }

    const source = this.options.source || await ensureOdooSource({
      version,
      cacheRoot: topology.cacheRoot,
      sourceDir: this.options.sourceDir ?? process.env.ODOO_SOURCE_DIR ?? '',
      gitFactory: this.options.gitFactory
    });
    const allowedAddons = Array.isArray(this.options.allowedAddons)
      ? this.options.allowedAddons
      : Array.isArray(topology?.odooFramework?.modules) ? topology.odooFramework.modules : [];
    const findModelFiles = this.options.findModelFiles || ((args) => findOdooModelFiles({ ...args, allowedAddons, gitFactory: this.options.gitFactory }));
    const maxDepth = Math.max(0, Number(this.options.maxDepth ?? 6));
    const maxFrameworkMethods = Math.max(1, Number(this.options.maxFrameworkMethods ?? 250));
    const frameworkSymbols = new Map();
    const visited = new Set();
    const unresolvedCalls = [];

    while (pendingFramework.length && visited.size < maxFrameworkMethods) {
      const current = pendingFramework.shift();
      const key = `${current.modelName}.${current.methodName}`;
      if (!current.modelName || !current.methodName || visited.has(key)) continue;
      visited.add(key);

      const files = await findModelFiles({ repoDir: source.repoDir, modelName: current.modelName });
      let found = false;
      for (const sourcePath of files) {
        const text = await fs.readFile(path.join(source.repoDir, sourcePath), 'utf8').catch(() => '');
        if (!text) continue;
        const addon = sourcePath.replace(/\\/g, '/').split('/')[1] || '';
        const parsed = extractOdooExecution(sourcePath, text, addon);
        for (const method of parsed.methods.filter((item) => item.modelName === current.modelName && item.methodName === current.methodName)) {
          found = true;
          const logicalName = frameworkMethodName(version, method.modelName, method.methodName);
          const syntheticSource = `@odoo${version}/${method.sourcePath}`;
          const symbol = topology.addSemanticFunction({
            sourcePath: syntheticSource,
            name: logicalName,
            symbolKind: 'odoo_framework_method',
            semanticType: 'odoo_executable_python',
            line: method.line,
            signature: `${method.modelName}.${method.signature}`,
            body: method.body
          });
          symbol.odooExecution = {
            layer: 'framework', modelName: method.modelName, methodName: method.methodName,
            sourcePath: method.sourcePath, repoUrl: source.repoUrl, commit: source.commit
          };
          frameworkSymbols.set(`${method.sourcePath}:${key}`, symbol);

          for (const call of method.calls) {
            if (call.kind === 'self' || call.kind === 'super' || call.kind === 'model') {
              const target = frameworkMethodName(version, call.modelName, call.methodName);
              addReference(symbol, target, 'calls');
              if (current.depth < maxDepth) pendingFramework.push({ modelName: call.modelName, methodName: call.methodName, depth: current.depth + 1 });
            } else if (call.kind === 'read' || call.kind === 'write') {
              addReference(symbol, call.modelName, call.kind === 'read' ? 'reads' : 'writes');
            }
          }
        }
      }
      if (!found) unresolvedCalls.push(key);
    }

    topology.reindexAllSymbols();
    topology.rebuildCallers();
    return {
      adapter: 'odoo-execution-v1',
      projectMethods: projectMethods.length,
      frameworkMethods: frameworkSymbols.size,
      bridgedSuperCalls,
      uiEntrypointSeeds: uiEntrypoints.filter((entrypoint) => entrypoint?.modelName && entrypoint?.methodName).length,
      unresolvedCalls: [...new Set(unresolvedCalls)].sort(),
      source: { repoUrl: source.repoUrl, commit: source.commit }
    };
  }
}

export { projectMethodName, frameworkMethodName };
