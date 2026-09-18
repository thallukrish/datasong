import fs from 'node:fs/promises';
import path from 'node:path';
import { extractOdooExecution } from './pythonExecutionParser.js';
import { extractOdooManifestHooks, extractOdooHookExecution } from './manifestHooks.js';
import { ensureOdooSource, findOdooModelFiles, findOdooMethodFiles, findOdooUiFiles } from './frameworkSource.js';
import { extractOdooModels } from './modelParser.js';
import { extractOdooUiEntrypoints } from './uiEntrypoints.js';
import { runtimeObservedMethodKeys, selectRuntimeMethodCandidates } from './runtimeTraversal.js';

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

function referenceIdentity(name, relation, data = {}) {
  return [
    name,
    relation,
    data?.boundaryKind || '',
    data?.persistenceKind || '',
    data?.crud || '',
    data?.logicalEntity || '',
    data?.persistedEntity || ''
  ].join('|');
}

function addReference(symbol, name, relation, data = undefined) {
  if (!symbol || !name) return false;
  if (!Array.isArray(symbol.references)) symbol.references = [];
  const identity = referenceIdentity(name, relation, data || {});
  const exists = symbol.references.some((ref) => referenceIdentity(ref.name, ref.relation, ref.data || {}) === identity);
  if (exists) return false;
  symbol.references.push({
    name,
    simpleName: String(name).split(/[.:/]/).at(-1),
    relation,
    explicit: true,
    ...(data && Object.keys(data).length ? { data } : {})
  });
  return true;
}

function boundaryData(sourceModel, targetModel) {
  if (!sourceModel || !targetModel) return {};
  return {
    framework: 'odoo',
    boundaryKind: sourceModel === targetModel ? 'same_model' : 'cross_model',
    sourceModel,
    targetModel
  };
}

function persistenceData(call, logicalEntity = '') {
  return {
    operationKind: 'persistence',
    persistenceKind: call.persistenceKind || 'odoo_orm',
    crud: call.crud || '',
    ...(logicalEntity ? { logicalEntity } : {}),
    ...(call.persistedEntity ? { persistedEntity: call.persistedEntity } : {})
  };
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

function emptyStructuralStats() {
  return {
    firstClassMethods: 0,
    crossModelCalls: 0,
    sameModelCalls: 0,
    helperCalls: 0,
    ormReads: 0,
    ormCreates: 0,
    ormUpdates: 0,
    ormDeletes: 0,
    sqlReads: 0,
    sqlCreates: 0,
    sqlUpdates: 0,
    sqlDeletes: 0
  };
}

function odooDebugEnabled() {
  return /^(?:1|true|yes|on)$/i.test(String(process.env.ODOO_EXEC_DEBUG || '').trim());
}

function odooDebugMatches(value = '') {
  const filter = String(process.env.ODOO_EXEC_DEBUG_MATCH || '').trim().toLowerCase();
  return !filter || String(value || '').toLowerCase().includes(filter);
}

function odooDebug(scope, message) {
  if (!odooDebugEnabled()) return;
  console.error(`[odoo:${scope}] ${message}`);
}

function uniqueEntrypoints(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const modelName = String(item?.modelName || '');
    const methodName = String(item?.methodName || '');
    if (!modelName || !methodName) return false;
    const key = `${modelName}|${methodName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class OdooExecutionAdapter {
  constructor(topology, options = {}) {
    this.topology = topology;
    this.options = options;
  }

  async augment(input = {}) {
    const topology = this.topology;
    const runtimeMethodKeys = runtimeObservedMethodKeys(input?.runtimeTrace);
    const runtimeTraversalStats = {
      enabled: runtimeMethodKeys.size > 0,
      uiEntrypointsBefore: 0,
      uiEntrypointsAfter: 0,
      frameworkBranchPoints: 0,
      prunedFrameworkBranchPoints: 0,
      prunedFrameworkEdges: 0
    };
    const version = String(topology?.odooDetection?.version || '');
    const addons = Array.isArray(topology?.odooDetection?.addons) ? topology.odooDetection.addons : [];
    const tracked = Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : [];
    const projectMethods = [];
    const projectHooks = [];
    const unresolvedCalls = [];
    const unresolvedPersistence = [];
    const structuralStats = emptyStructuralStats();

    const recordBoundary = (inserted, data = {}) => {
      if (!inserted) return;
      if (data.boundaryKind === 'cross_model') structuralStats.crossModelCalls += 1;
      else if (data.boundaryKind === 'same_model') structuralStats.sameModelCalls += 1;
      else if (data.boundaryKind === 'helper_or_library') structuralStats.helperCalls += 1;
    };

    const recordPersistence = (inserted, call) => {
      if (!inserted) return;
      const prefix = call.persistenceKind === 'sql' ? 'sql' : 'orm';
      const suffix = call.crud === 'read' ? 'Reads'
        : call.crud === 'create' ? 'Creates'
          : call.crud === 'update' ? 'Updates'
            : call.crud === 'delete' ? 'Deletes' : '';
      if (suffix && Object.hasOwn(structuralStats, `${prefix}${suffix}`)) structuralStats[`${prefix}${suffix}`] += 1;
    };

    const attachPersistence = (symbol, call) => {
      if (call.kind === 'sql') {
        if (!call.persistedEntity || !call.crud) {
          unresolvedPersistence.push(`sql:${call.sqlOperation || 'dynamic'}:${call.persistedEntity || '(target unresolved)'}`);
          return;
        }
        const relation = call.crud === 'read' ? 'reads' : 'writes';
        const inserted = addReference(symbol, call.persistedEntity, relation, persistenceData(call));
        recordPersistence(inserted, call);
        return;
      }
      if (call.kind !== 'read' && call.kind !== 'write') return;
      if (!call.modelName || !call.crud) return;
      const relation = call.kind === 'read' ? 'reads' : 'writes';
      const inserted = addReference(symbol, call.modelName, relation, persistenceData(call, call.modelName));
      recordPersistence(inserted, call);
    };

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

    const source = this.options.source || await ensureOdooSource({
      version,
      cacheRoot: topology.cacheRoot,
      sourceDir: this.options.sourceDir ?? process.env.ODOO_SOURCE_DIR ?? '',
      gitFactory: this.options.gitFactory
    });
    const allowedAddons = Array.isArray(this.options.allowedAddons)
      ? this.options.allowedAddons
      : Array.isArray(topology?.odooFramework?.modules) ? topology.odooFramework.modules : [];
    const findModelFiles = this.options.findModelFiles
      || ((args) => findOdooModelFiles({ ...args, allowedAddons, gitFactory: this.options.gitFactory }));
    const findMethodFiles = this.options.findMethodFiles
      || (this.options.findModelFiles
        ? ((args) => findModelFiles(args))
        : ((args) => findOdooMethodFiles({ ...args, allowedAddons, gitFactory: this.options.gitFactory })));
    const findUiFiles = this.options.findUiFiles
      || ((args) => findOdooUiFiles({ ...args, allowedAddons, gitFactory: this.options.gitFactory }));

    const frameworkModelNames = [...new Set((Array.isArray(topology?.odooFramework?.frameworkSchemas)
      ? topology.odooFramework.frameworkSchemas : [])
      .map((schema) => String(schema?.name || ''))
      .filter(Boolean))].sort();
    const relevantFrameworkModels = new Set(frameworkModelNames);
    const frameworkUiEntrypoints = [];
    if (frameworkModelNames.length) {
      const uiFiles = await findUiFiles({ repoDir: source.repoDir, modelNames: frameworkModelNames });
      for (const sourcePath of uiFiles) {
        const xml = await fs.readFile(path.join(source.repoDir, sourcePath), 'utf8').catch(() => '');
        if (!xml) continue;
        const parsed = extractOdooUiEntrypoints(sourcePath, xml);
        frameworkUiEntrypoints.push(...(Array.isArray(parsed?.entrypoints) ? parsed.entrypoints : [])
          .filter((entrypoint) => relevantFrameworkModels.has(String(entrypoint?.modelName || ''))));
      }
    }

    const projectByKey = new Map(projectMethods.map((method) => [`${method.modelName}.${method.methodName}`, method]));
    const projectSymbols = new Map();
    const pendingFramework = [];
    const configuredEntrypoints = Array.isArray(this.options.uiEntrypoints) ? this.options.uiEntrypoints : [];
    const suppliedEntrypoints = Array.isArray(input?.entrypoints) ? input.entrypoints : [];
    const uiEntrypoints = uniqueEntrypoints([...configuredEntrypoints, ...suppliedEntrypoints, ...frameworkUiEntrypoints]);
    runtimeTraversalStats.uiEntrypointsBefore = uiEntrypoints.length;
    const runtimeEntrypointSelection = selectRuntimeMethodCandidates(uiEntrypoints, runtimeMethodKeys);
    const traversalEntrypoints = runtimeEntrypointSelection.candidates;
    runtimeTraversalStats.uiEntrypointsAfter = traversalEntrypoints.length;
    let bridgedSuperCalls = 0;

    const queueFramework = (symbol, call, depth = 0, sourceModel = '') => {
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
      const data = boundaryData(sourceModel, targetModel);
      recordBoundary(addReference(symbol, target, 'calls', data), data);
      pendingFramework.push({ modelName: targetModel, methodName: call.methodName, depth });
      return true;
    };

    for (const entrypoint of traversalEntrypoints) {
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
      symbol.odooExecution = {
        layer: 'project',
        modelName: method.modelName,
        methodName: method.methodName,
        addon: method.addon,
        firstClassEntity: true,
        firstClassMethod: true
      };
      structuralStats.firstClassMethods += 1;
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
        methodName: hook.functionName, manifestPath: hook.manifestPath,
        firstClassEntity: false, firstClassMethod: false
      };
      for (const call of hook.calls) {
        if (call.kind === 'model') queueFramework(symbol, call, 0, '');
        else attachPersistence(symbol, call);
      }
    }

    for (const method of projectMethods) {
      const symbol = projectSymbols.get(`${method.modelName}.${method.methodName}`);
      for (const call of method.calls) {
        if (call.kind === 'super') {
          queueFramework(symbol, call, 0, method.modelName);
          bridgedSuperCalls += 1;
          continue;
        }
        if (call.kind === 'self') {
          const isProjectTarget = projectByKey.has(`${call.modelName}.${call.methodName}`);
          const projectTarget = isProjectTarget
            ? projectMethodName(call.modelName, call.methodName)
            : frameworkMethodName(version, call.modelName, call.methodName);
          const data = boundaryData(method.modelName, call.modelName);
          recordBoundary(addReference(symbol, projectTarget, 'calls', data), data);
          if (!isProjectTarget) pendingFramework.push({ modelName: call.modelName, methodName: call.methodName, depth: 0 });
          continue;
        }
        if (call.kind === 'model' || call.kind === 'field') {
          queueFramework(symbol, call, 0, method.modelName);
          continue;
        }
        attachPersistence(symbol, call);
      }
    }

    const maxFrameworkMethods = Math.max(1, Number(this.options.maxFrameworkMethods ?? 250));
    const frameworkSymbols = new Map();
    const visited = new Set();
    const relatedModelCache = new Map();
    const dynamicFamilyCache = new Map();

    const resolveFrameworkRelatedModel = async (modelName, fieldName) => {
      const local = relatedModelForField(topology, modelName, fieldName);
      if (local) return local;
      const cacheKey = `${modelName}.${fieldName}`;
      if (relatedModelCache.has(cacheKey)) return relatedModelCache.get(cacheKey);

      const files = await findModelFiles({ repoDir: source.repoDir, modelName });
      for (const sourcePath of files) {
        const text = await fs.readFile(path.join(source.repoDir, sourcePath), 'utf8').catch(() => '');
        if (!text) continue;
        const addon = sourcePath.replace(/\\/g, '/').split('/')[1] || '';
        const models = extractOdooModels(sourcePath, text, addon)
          .filter((model) => model.name === modelName || model.inherits.includes(modelName));
        for (const model of models) {
          const field = (Array.isArray(model.fields) ? model.fields : [])
            .find((item) => item?.name === fieldName && item?.relatedModel);
          if (field?.relatedModel) {
            relatedModelCache.set(cacheKey, field.relatedModel);
            return field.relatedModel;
          }
        }
      }
      relatedModelCache.set(cacheKey, '');
      return '';
    };

    const resolveDynamicFrameworkMethods = async (call) => {
      const modelName = call.modelName;
      const prefix = call.methodPrefix || '';
      const suffix = call.methodSuffix || '';
      const cacheKey = `${modelName}:${prefix}*${suffix}`;
      if (dynamicFamilyCache.has(cacheKey)) return dynamicFamilyCache.get(cacheKey);

      const found = new Set();
      const files = await findModelFiles({ repoDir: source.repoDir, modelName });
      for (const sourcePath of files) {
        const text = await fs.readFile(path.join(source.repoDir, sourcePath), 'utf8').catch(() => '');
        if (!text) continue;
        const addon = sourcePath.replace(/\\/g, '/').split('/')[1] || '';
        const parsed = extractOdooExecution(sourcePath, text, addon);
        for (const method of parsed.methods) {
          if (method.modelName !== modelName) continue;
          if (prefix && !method.methodName.startsWith(prefix)) continue;
          if (suffix && !method.methodName.endsWith(suffix)) continue;
          found.add(method.methodName);
        }
      }
      const methods = [...found].sort();
      dynamicFamilyCache.set(cacheKey, methods);
      return methods;
    };

    while (pendingFramework.length && visited.size < maxFrameworkMethods) {
      const current = pendingFramework.shift();
      const descendants = [];
      const key = `${current.modelName}.${current.methodName}`;
      if (!current.modelName || !current.methodName || visited.has(key)) continue;
      visited.add(key);

      const implementationFiles = await findMethodFiles({
        repoDir: source.repoDir,
        modelName: current.modelName,
        methodName: current.methodName
      });
      const modelFiles = await findModelFiles({ repoDir: source.repoDir, modelName: current.modelName });
      const files = [...new Set([...implementationFiles, ...modelFiles])];
      if (odooDebugMatches(key)) {
        odooDebug(
          'traverse',
          `${key} depth=${current.depth} implementations=${implementationFiles.length} modelFiles=${modelFiles.length} candidates=${files.length}`
        );
        if (implementationFiles.length) {
          odooDebug('traverse', `${key} implementation files: ${implementationFiles.join(' | ')}`);
        }
      }
      let found = false;
      for (const sourcePath of files) {
        const text = await fs.readFile(path.join(source.repoDir, sourcePath), 'utf8').catch(() => '');
        if (!text) continue;
        const addon = sourcePath.replace(/\\/g, '/').split('/')[1] || '';
        const parsed = extractOdooExecution(sourcePath, text, addon);
        for (const method of parsed.methods.filter((item) => item.modelName === current.modelName && item.methodName === current.methodName)) {
          found = true;
          if (odooDebugMatches(key)) {
            odooDebug(
              'traverse',
              `loaded ${key} from ${method.sourcePath} addon=${method.addon || '(unknown)'} extension=${Boolean(method.extension)}`
            );
          }
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
            sourcePath: method.sourcePath, repoUrl: source.repoUrl, commit: source.commit,
            addon: method.addon, extension: Boolean(method.extension),
            firstClassEntity: true, firstClassMethod: true
          };
          structuralStats.firstClassMethods += 1;
          frameworkSymbols.set(`${method.sourcePath}:${key}`, symbol);

          for (const call of method.calls) {
            if (call.kind === 'dynamic_model') {
              const targets = await resolveDynamicFrameworkMethods(call);
              if (!targets.length) {
                unresolvedCalls.push(`${call.modelName}.${call.methodPrefix || ''}*${call.methodSuffix || ''}`);
                continue;
              }
              for (const methodName of targets) {
                const data = boundaryData(method.modelName, call.modelName);
                recordBoundary(addReference(symbol, frameworkMethodName(version, call.modelName, methodName), 'calls', data), data);
                descendants.push({ modelName: call.modelName, methodName, depth: current.depth + 1 });
              }
              continue;
            }
            if (call.kind === 'self' || call.kind === 'super' || call.kind === 'model' || call.kind === 'field') {
              let targetModel = call.modelName;
              if (call.kind === 'field') {
                targetModel = await resolveFrameworkRelatedModel(call.modelName, call.fieldName);
                if (!targetModel) {
                  unresolvedCalls.push(`${call.modelName}.${call.fieldName}.${call.methodName}`);
                  continue;
                }
              }
              const target = frameworkMethodName(version, targetModel, call.methodName);
              const data = boundaryData(method.modelName, targetModel);
              recordBoundary(addReference(symbol, target, 'calls', data), data);
              descendants.push({ modelName: targetModel, methodName: call.methodName, depth: current.depth + 1 });
            } else {
              attachPersistence(symbol, call);
            }
          }
        }
      }
      if (!found) {
        if (odooDebugMatches(key)) odooDebug('traverse', `UNRESOLVED ${key}`);
        unresolvedCalls.push(key);
      }

      // Follow descendants of the current entrypoint before moving on to the
      // next unrelated UI seed. When runtime evidence exists, use it here to
      // prune static branch explosion before deeper Odoo framework traversal.
      if (descendants.length) {
        const uniqueDescendants = [...new Map(descendants.map((item) => [
          `${item.modelName}.${item.methodName}`,
          item
        ])).values()];
        const selected = selectRuntimeMethodCandidates(uniqueDescendants, runtimeMethodKeys);
        if (uniqueDescendants.length > 1) runtimeTraversalStats.frameworkBranchPoints += 1;
        if (selected.prunedCount > 0) {
          runtimeTraversalStats.prunedFrameworkBranchPoints += 1;
          runtimeTraversalStats.prunedFrameworkEdges += selected.prunedCount;
        }
        pendingFramework.unshift(...selected.candidates);
      }
    }

    const truncated = pendingFramework.length > 0 && visited.size >= maxFrameworkMethods;
    topology.reindexAllSymbols();
    topology.rebuildCallers();
    return {
      adapter: 'odoo-execution-v2',
      projectMethods: projectMethods.length,
      projectHooks: projectHooks.length,
      frameworkMethods: frameworkSymbols.size,
      bridgedSuperCalls,
      frameworkUiEntrypointSeeds: uniqueEntrypoints(frameworkUiEntrypoints).length,
      uiEntrypointSeeds: uiEntrypoints.length,
      traversalUiEntrypointSeeds: traversalEntrypoints.length,
      runtimeTraversal: runtimeTraversalStats,
      unresolvedCalls: [...new Set(unresolvedCalls)].sort(),
      unresolvedPersistence: [...new Set(unresolvedPersistence)].sort(),
      truncated,
      remainingFrameworkQueue: pendingFramework.length,
      maxFrameworkMethods,
      structuralStats,
      source: { repoUrl: source.repoUrl, commit: source.commit }
    };
  }
}

export { projectMethodName, projectHookName, frameworkMethodName, relatedModelForField, boundaryData, persistenceData };