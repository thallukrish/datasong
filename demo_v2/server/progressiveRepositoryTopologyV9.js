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
    this.externalSymbols = [];
  }

  async prepareIndexOnly(repoUrl) {
    this.callPathIndex = null;
    this.moquiEntitySchema = null;
    this.moquiXmlExecution = null;
    this.entitySchemas = [];
    this.entitySchemaByName = new Map();
    this.externalSymbols = [];
    return super.prepareIndexOnly(repoUrl);
  }

  async prepare(repoUrl) {
    const startedAt=Date.now();
    let t=Date.now();
    console.log('[repo-prepare] START full deterministic topology preparation');
    const prep = await super.prepare(repoUrl);
    console.log(`[repo-prepare] base topology ${Date.now()-t}ms symbols=${this.symbols.length}`);

    t=Date.now();
    const pythonAst = await this.augmentPythonAstGraph();
    console.log(`[repo-prepare] python AST graph ${Date.now()-t}ms symbols=${pythonAst.symbolCount} external=${pythonAst.externalSymbolCount}`);

    const isMoqui = Array.isArray(this.trackedFiles) && this.trackedFiles.some((file)=>String(file).replaceAll('\\','/').toLowerCase()==='component.xml');
    if (isMoqui) {
      console.log('[repo-prepare] framework=moqui detected');
      t=Date.now();
      this.moquiEntitySchema = await this.moquiEntitySchemaAdapter.augment();
      console.log(`[repo-prepare] moqui schema adapter ${Date.now()-t}ms`);

      t=Date.now();
      this.moquiXmlExecution = await this.moquiXmlAdapter.augment();
      console.log(`[repo-prepare] moqui execution adapter ${Date.now()-t}ms`);
    } else {
      this.moquiEntitySchema = null;
      this.moquiXmlExecution = null;
      this.entitySchemas = [];
      this.entitySchemaByName = new Map();
      console.log('[repo-prepare] framework=moqui skipped');
    }

    t=Date.now();
    this.callPathIndex = this.callPathIndexer.build();
    console.log(`[repo-prepare] call-path index ${Date.now()-t}ms ranked=${this.callPathIndex.rankedPathCount} grouped=${this.callPathIndex.groupedPathCount}`);
    console.log(`[repo-prepare] DONE ${Date.now()-startedAt}ms`);
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
    const result = this.pythonAnalysis || await analyzePythonRepository({ repoDir: this.repoDir, files: this.files });
    this.pythonAnalysis = result;
    const pythonSymbols = Array.isArray(result?.symbols) ? result.symbols : [];
    this.externalSymbols = Array.isArray(result?.externalSymbols) ? result.externalSymbols : [];
    if (!pythonSymbols.length) return { version: Number(result?.version || 1), symbolCount: 0, externalSymbolCount: this.externalSymbols.length, resolvedCallCount: 0, unresolvedCallCount: 0 };

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
      externalSymbolCount: this.externalSymbols.length,
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
