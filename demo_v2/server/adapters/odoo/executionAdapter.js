import fs from 'node:fs/promises';
import path from 'node:path';
import { extractOdooExecution } from './pythonExecutionParser.js';
import { extractOdooManifestHooks, extractOdooHookExecution } from './manifestHooks.js';
import { ensureOdooSource, findOdooModelFiles } from './frameworkSource.js';

function projectMethodName(modelName, methodName) {
  return `odoo-project:${modelName}.${methodName}`;
}

function projectHookName(addon, functionName) {
  return `odoo-project:hook:${addon}.${functionName}`;
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

function relatedModelForField(topology, modelName, fieldName) {
  const schema = topology?.entitySchemaByName?.get?.(modelName)
    || (typeof topology?.entitySchema === 'function' ? topology.entitySchema(modelName) : null);
  if (!schema) return '';
  const field = (Array.isArray(schema.fields) ? schema.fields : [])
    .find((item) => item?.name === fieldName && item?.relatedModel);
  if (field?.relatedModel) return field.relatedModel;
  const relationship = (Array.isArray(schema.relationships) ? schema.relationships : [])
    .find((item) => item?.title === fieldName && item?.relatedEntityName);
  return relationship?.relatedEntityName || '';
}

export class OdooExecutionAdapter {
  constructor(topology, options = {}) {
    this.topology = topology;
    this.options = options;
  }

  async augment(input = {}) {
    const topology = this.topology;
    const version = String(topology?.odooDetection?.version || '');
    const addons = Array.isArray(topology?.odooDetection?.addons) ? topology.odooDetection.addons : [];
    const tracked = Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : [];
    const projectMethods = [];
    const projectHooks = [];
    const unresolvedCalls = [];

    for (const sourcePath of tracked.filter((file) => /(?:^|\/)models\/.*\.py$/.test(file))) {
      const addon = addonForPath(sourcePath, addons);
      if (!addon) continue;
      const source = await fs.readFile(path.join(topology.repoDir, sourcePath), 'utf8').catch(() => '');
      if (!source) continue;
      projectMethods.push(...extractOdooExecution(sourcePath, source, addon).methods);
    }

    for (const manifestPath of tracked.filter((file) => /(?:^|\/)__manifest__\.py$/.test(file))) {
      const addon = addonForPath(manifestPath, addons);
      if (!addon) continue;
      const manifestSource = await fs.readFile(path.join(topology.repoDir, manifestPath), 'utf8').catch(() => '');
      if (!manifestSource) continue;
      const hooks = extractOdooManifestHooks(manifestPath, manifestSource, addon);
      if (!hooks.length) continue;
      const addonRoot = manifestPath.replace(/\/__manifest__\.py$/, '');
      const pythonFiles = tracked.filter((file) => file.startsWith(`${addonRoot}/`) && file.endsWith('.py') && file !== manifestPath);
      for (const hook of hooks) {
        for (const sourcePath of pythonFiles) {
          const source = await fs.readFile(path.join(topology.repoDir, sourcePath), 'utf8').catch(() => '');
          if (!source) continue;
          const parsed = extractOdooHookExecution(sourcePath, source, addon, hook);
          if (!parsed) continue;
          projectHooks.push(parsed);
          break;
        }
      }
    }

    const projectByKey = new Map(projectMethods.map((method) => [`${method.modelName}.${method.methodName}`, method]));
    const projectSymbols = new Map();
    const pendingFramework = [];
    const configuredEntrypoints = Array.isArray(this.options.uiEntrypoints) ? this.options.uiEntrypoints : [];
    const suppliedEntrypoints = Array.isArray(input?.entrypoints) ? input.entrypoints : [];
    const uiEntrypoints = [...configuredEntrypoints, ...suppliedEntrypoints];
    let bridgedSuperCalls = 0;

    const queueFramework = (symbol, call, depth = 0) => {
      let targetModel = call.modelName;
      if (call.kind === 'field') {
        targetModel = relatedModelForField(topology, call.modelName, call.fieldName);
        if (!targetModel) {
          unresolvedCalls.push(`${call.modelName}.${call.fieldName}.${call.methodName}`);
          return false;
        }
      }
      if (!targetModel || !call.methodName) return false;
      const target = frameworkMethodName(version, targetModel, call.methodName);
      addReference(symbol, target, 'calls');
      pendingFramework.push({ modelName: targetModel, methodName: call.methodName, depth });
      return true;
    };

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

    for (const hook of projectHooks) {
      const symbol = topology.addSemanticFunction({
        sourcePath: hook.sourcePath,
        name: projectHookName(hook.addon, hook.functionName),
        symbolKind: 'odoo_project_hook',
        semanticType: 'odoo_executable_python',
        line: hook.line,
        signature: `${hook.hookType} ${hook.signature}`,
        body: hook.body
      });
      symbol.odooExecution = {
        layer: 'project', addon: hook.addon, hookType: hook.hookType,
        methodName: hook.functionName, manifestPath: hook.manifestPath
      };
      for (const call of hook.calls) {
        if (call.kind === 'model') {
          queueFramework(symbol, call, 0);
        } else if (call.kind === 'read' || call.kind === 'write') {
          addReference(symbol, call.modelName, call.kind === 'read' ? 'reads' : 'writes');
        }
      }
    }

    for (const method of projectMethods) {
      const symbol = projectSymbols.get(`${method.modelName}.${method.methodName}`);
      for (const call of method.calls) {
        if (call.kind === 'super') {
          queueFramework(symbol, call, 0);
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
        if (call.kind === 'model' || call.kind === 'field') {
          queueFramework(symbol, call, 0);
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
            if (call.kind === 'self' || call.kind === 'super' || call.kind === 'model' || call.kind === 'field') {
              let targetModel = call.modelName;
              if (call.kind === 'field') {
                targetModel = relatedModelForField(topology, call.modelName, call.fieldName);
                if (!targetModel) {
                  unresolvedCalls.push(`${call.modelName}.${call.fieldName}.${call.methodName}`);
                  continue;
                }
              }
              const target = frameworkMethodName(version, targetModel, call.methodName);
              addReference(symbol, target, 'calls');
              if (current.depth < maxDepth) pendingFramework.push({ modelName: targetModel, methodName: call.methodName, depth: current.depth + 1 });
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
      projectHooks: projectHooks.length,
      frameworkMethods: frameworkSymbols.size,
      bridgedSuperCalls,
      uiEntrypointSeeds: uiEntrypoints.filter((entrypoint) => entrypoint?.modelName && entrypoint?.methodName).length,
      unresolvedCalls: [...new Set(unresolvedCalls)].sort(),
      source: { repoUrl: source.repoUrl, commit: source.commit }
    };
  }
}

export { projectMethodName, projectHookName, frameworkMethodName, relatedModelForField };
