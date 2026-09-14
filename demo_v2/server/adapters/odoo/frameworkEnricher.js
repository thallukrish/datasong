import fs from 'node:fs/promises';
import path from 'node:path';
import { extractOdooModels } from './modelParser.js';
import { frameworkModelSeeds, frameworkModuleSeeds } from './frameworkSeeds.js';
import { ensureOdooSource, findOdooModelFiles, resolveOdooModuleClosure } from './frameworkSource.js';
import { OdooFrameworkMapStore } from './frameworkMapStore.js';

const arr = (value) => Array.isArray(value) ? value : [];

function addonNameFor(sourcePath) {
  const parts = String(sourcePath || '').replace(/\\/g, '/').split('/');
  const index = parts.indexOf('addons');
  return index >= 0 ? String(parts[index + 1] || '') : '';
}

function dedupeBy(items, keyFor) {
  const map = new Map();
  for (const item of items) map.set(keyFor(item), item);
  return [...map.values()];
}

function normalizeFrameworkSchema({ version, modelName, models, source }) {
  if (!models.length) return null;
  const fields = dedupeBy(
    models.flatMap((model) => arr(model.fields).map((field) => ({ ...field, ownership: 'framework' }))),
    (field) => String(field?.name || '')
  ).filter((field) => field.name);
  const relationships = dedupeBy(
    fields.filter((field) => field.relatedModel).map((field) => ({
      type: field.relation,
      relatedEntityName: field.relatedModel,
      title: field.name,
      keyMaps: []
    })),
    (relationship) => `${relationship.type}|${relationship.relatedEntityName}|${relationship.title}`
  );
  const sourcePaths = [...new Set(models.map((model) => model.sourcePath).filter(Boolean))].sort();
  const addons = [...new Set(models.map((model) => model.addon).filter(Boolean))].sort();
  const inherits = [...new Set(models.flatMap((model) => arr(model.inherits)).filter(Boolean))].sort();

  return {
    name: modelName,
    fullName: modelName,
    fields,
    relationships,
    inherits,
    stableId: `odoo${version}:model:${modelName}`,
    framework: 'odoo',
    frameworkVersion: version,
    ownership: 'framework',
    extensionOf: '',
    provenance: {
      sourcePath: sourcePaths[0] || '',
      sourcePaths,
      addons,
      repoUrl: source.repoUrl,
      commit: source.commit,
      layer: 'framework'
    }
  };
}

async function resolveFrameworkSchema({ source, version, modelName, findModelFiles }) {
  const files = await findModelFiles({ repoDir: source.repoDir, modelName });
  const models = [];
  for (const sourcePath of files) {
    const text = await fs.readFile(path.join(source.repoDir, sourcePath), 'utf8').catch(() => '');
    if (!text) continue;
    for (const model of extractOdooModels(sourcePath, text, addonNameFor(sourcePath))) {
      if (model.name === modelName || model.inherits.includes(modelName)) models.push(model);
    }
  }
  return normalizeFrameworkSchema({ version, modelName, models, source });
}

export class OdooFrameworkEnricher {
  constructor(topology, options = {}) {
    this.topology = topology;
    this.options = options;
  }

  async augment(projectSchemas = []) {
    const topology = this.topology;
    const version = String(topology?.odooDetection?.version || '');
    const maxDepth = Math.max(0, Number(this.options.maxDepth ?? 1));
    const maxModels = Math.max(1, Number(this.options.maxModels ?? 60));
    const dataRoot = this.options.dataRoot || path.dirname(topology.cacheRoot);
    const store = this.options.store || new OdooFrameworkMapStore({ dataRoot, version });
    const source = this.options.source || await ensureOdooSource({
      version,
      cacheRoot: topology.cacheRoot,
      sourceDir: this.options.sourceDir ?? process.env.ODOO_SOURCE_DIR ?? '',
      gitFactory: this.options.gitFactory
    });

    const moduleSeeds = frameworkModuleSeeds(topology?.odooDetection?.addons || []);
    const resolveModuleClosure = this.options.resolveModuleClosure || resolveOdooModuleClosure;
    const modules = this.options.allowedAddons || await resolveModuleClosure({
      repoDir: source.repoDir,
      seeds: moduleSeeds,
      maxModules: this.options.maxModules ?? 120
    });
    const allowedAddons = [...new Set(arr(modules).map(String).filter(Boolean))].sort();
    const findModelFiles = this.options.findModelFiles || ((args) => findOdooModelFiles({
      ...args,
      allowedAddons,
      gitFactory: this.options.gitFactory
    }));

    const persisted = store.load();
    const cachedByName = new Map(
      Object.values(persisted.schemas || {})
        .filter((schema) => schema?.name && schema?.provenance?.commit === source.commit)
        .map((schema) => [schema.name, schema])
    );
    const projectOnlyNames = new Set(
      arr(projectSchemas)
        .filter((schema) => schema?.ownership === 'project')
        .map((schema) => String(schema?.name || ''))
        .filter(Boolean)
    );
    const seeds = frameworkModelSeeds(projectSchemas);
    const queue = seeds.map((name) => ({ name, depth: 0 }));
    const visited = new Set();
    const selected = new Map();
    const learned = [];
    const reused = [];
    const missing = [];
    const newlyLearnedSchemas = [];

    while (queue.length && visited.size < maxModels) {
      const current = queue.shift();
      const modelName = String(current?.name || '');
      if (!modelName || visited.has(modelName) || projectOnlyNames.has(modelName)) continue;
      visited.add(modelName);

      let schema = cachedByName.get(modelName) || null;
      if (schema) {
        reused.push(modelName);
      } else {
        schema = await resolveFrameworkSchema({ source, version, modelName, findModelFiles });
        if (schema) {
          learned.push(modelName);
          newlyLearnedSchemas.push(schema);
          cachedByName.set(modelName, schema);
        } else {
          missing.push(modelName);
        }
      }
      if (!schema) continue;
      selected.set(modelName, schema);

      if (current.depth < maxDepth) {
        for (const relationship of arr(schema.relationships)) {
          const related = String(relationship?.relatedEntityName || '');
          if (!related || projectOnlyNames.has(related) || visited.has(related)) continue;
          queue.push({ name: related, depth: current.depth + 1 });
        }
      }
    }

    if (newlyLearnedSchemas.length) store.mergeSchemas({ source, schemas: newlyLearnedSchemas });

    return {
      seeds,
      moduleSeeds,
      modules: allowedAddons,
      frameworkSchemas: [...selected.values()].sort((a, b) => a.name.localeCompare(b.name)),
      learned: [...new Set(learned)].sort(),
      reused: [...new Set(reused)].sort(),
      missing: [...new Set(missing)].sort(),
      source
    };
  }
}

export { normalizeFrameworkSchema };
