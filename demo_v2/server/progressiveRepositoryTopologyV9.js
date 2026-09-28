import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexerV3 } from './callPathIndexerV3.js';
import { createMoquiAdapters } from './adapters/moqui/index.js';
import { analyzePythonRepository } from './languages/python/adapter.js';

const identityKey = (value = '') => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

export class ProgressiveRepositoryTopologyV9 extends ProgressiveRepositoryTopologyV7 {
  constructor(options) {
    super(options);
    this.callPathIndexer = new CallPathIndexerV3(this);
    this.callPathIndex = null;

    // Framework-specific behavior is isolated behind the adapter bundle. The
    // core topology only orchestrates normalized adapter outputs.
    this.frameworkAdapters = createMoquiAdapters(this);
    this.moquiXmlAdapter = this.frameworkAdapters.execution;
    this.moquiEntitySchemaAdapter = this.frameworkAdapters.entitySchema;
    this.moquiXmlExecution = null;
    this.moquiEntitySchema = null;
    this.entitySchemas = [];
    this.entitySchemaByName = new Map();
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    const pythonAst = await this.augmentPythonAstGraph();
    this.moquiEntitySchema = await this.moquiEntitySchemaAdapter.augment();
    this.moquiXmlExecution = await this.moquiXmlAdapter.augment();
    this.callPathIndex = this.callPathIndexer.build();
    return {
      ...prep,
      pythonAst,
      moquiEntitySchema: this.moquiEntitySchema,
      moquiXmlExecution: this.moquiXmlExecution,
      callPathIndex: {
        version: this.callPathIndex.version,
        fragmentCount: this.callPathIndex.fragmentCount,
        rawPathCount: this.callPathIndex.rawPathCount,
        rankedPathCount: this.callPathIndex.rankedPathCount,
        groupedPathCount: this.callPathIndex.groupedPathCount,
        topPaths: this.callPathIndex.topPaths
      }
    };
  }


  async augmentPythonAstGraph() {
    const result = await analyzePythonRepository({ repoDir: this.repoDir, files: this.files });
    const pythonSymbols = Array.isArray(result?.symbols) ? result.symbols : [];
    if (!pythonSymbols.length) return { version: Number(result?.version || 1), symbolCount: 0, resolvedCallCount: 0, unresolvedCallCount: 0 };

    const pythonPaths = new Set(pythonSymbols.map((symbol) => symbol.sourcePath));
    this.symbols = this.symbols.filter((symbol) => !pythonPaths.has(symbol.sourcePath));
    this.symbols.push(...pythonSymbols);

    this.symbolById.clear();
    this.nameIndex.clear();
    this.callers.clear();
    for (const symbol of this.symbols) {
      this.symbolById.set(symbol.id, symbol);
      for (const key of new Set([String(symbol.name || '').toLowerCase(), String(symbol.simpleName || '').toLowerCase()])) {
        if (!key) continue;
        if (!this.nameIndex.has(key)) this.nameIndex.set(key, []);
        this.nameIndex.get(key).push(symbol.id);
      }
    }
    for (const symbol of this.symbols) {
      for (const ref of Array.isArray(symbol.references) ? symbol.references : []) {
        for (const target of this.resolveOutboundReference(symbol, ref)) {
          if (!this.callers.has(target.id)) this.callers.set(target.id, []);
          this.callers.get(target.id).push({ sourceId: symbol.id, relation: ref.relation });
        }
      }
    }
    const pythonRefs = pythonSymbols.flatMap((symbol) => Array.isArray(symbol.references) ? symbol.references : []);
    return {
      version: Number(result?.version || 1),
      symbolCount: pythonSymbols.length,
      resolvedCallCount: pythonRefs.filter((ref) => ref.targetSymbolId).length,
      unresolvedCallCount: pythonRefs.filter((ref) => !ref.targetSymbolId).length
    };
  }

  entitySchema(name) {
    if (!name) return null;
    if (this.entitySchemaByName.has(name)) return this.entitySchemaByName.get(name);
    const raw = String(name);
    const leaf = raw.split(/[.#:/]/).at(-1);
    if (this.entitySchemaByName.has(leaf)) return this.entitySchemaByName.get(leaf);

    const wanted = identityKey(leaf);
    return this.entitySchemas.find((schema) =>
      identityKey(schema?.name) === wanted ||
      identityKey(schema?.fullName) === identityKey(raw) ||
      identityKey(String(schema?.fullName || '').split(/[.#:/]/).at(-1)) === wanted
    ) || null;
  }

  topCallPaths(limit = 10) {
    return this.callPathIndexer.top(limit).map((path) => ({
      ...path,
      rendered: this.callPathIndexer.render(path)
    }));
  }

  callPathScoutCandidates(limit = 10) {
    return this.callPathIndexer.scoutCandidates(limit);
  }
}
