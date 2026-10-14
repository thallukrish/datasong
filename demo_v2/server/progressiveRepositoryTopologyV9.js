import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexerV3 } from './callPathIndexerV3.js';
import { createMoquiAdapters } from './adapters/moqui/index.js';
import { analyzePythonRepository } from './languages/python/adapter.js';
import { buildPythonDataStructureGraph } from './languages/python/dataStructureGraph.js';
import { buildWorkflowGraph, mergeStructuralEvidenceNodes } from './semantics/code/structuralEvidenceGraph.js';
import { materializeStructuralEvidenceRows } from './semantics/code/structuralPalEvidenceRows.js';
import { buildCompactCallFlows } from './semantics/code/compactCallFlows.js';

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
    this.moduleRegions = [];
    this.pythonCodeFacts = [];
    this.pythonDataObservations = [];
    this.pythonDataTransfers = [];
    this.pythonEntityNodes = [];
    this.pythonEntityLinks = [];
    this.workflowGraphNodes = [];
    this.workflowLinks = [];
    this.structuralEvidenceNodes = [];
  }

  async prepareIndexOnly(repoUrl) {
    this.callPathIndex = null;
    this.moquiEntitySchema = null;
    this.moquiXmlExecution = null;
    this.entitySchemas = [];
    this.entitySchemaByName = new Map();
    this.externalSymbols = [];
    this.moduleRegions = [];
    this.pythonCodeFacts = [];
    this.pythonDataObservations = [];
    this.pythonDataTransfers = [];
    this.pythonEntityNodes = [];
    this.pythonEntityLinks = [];
    this.workflowGraphNodes = [];
    this.workflowLinks = [];
    this.structuralEvidenceNodes = [];
    this.symbols = [];
    this.symbolById.clear();
    this.nameIndex.clear();
    this.callers.clear();

    const prep = await super.prepareIndexOnly(repoUrl);
    if (!Array.isArray(this.files) || !this.files.some(file => String(file).toLowerCase().endsWith('.py'))) {
      return prep;
    }

    const startedAt = Date.now();
    const pythonAst = await this.augmentPythonAstGraph();
    console.log(`[profile-index] python function graph hydrated ${Date.now()-startedAt}ms symbols=${pythonAst.symbolCount}`);

    const structuralEvidence = await this.persistPythonStructuralEvidence({
      logPrefix:'profile-index'
    });

    const constructIndex = this.constructIndexMeta ? {
      status:this.constructIndexMeta.status,
      language:this.constructIndexMeta.language,
      recordCount:this.constructIndexMeta.recordCount,
      csvRowCount:this.constructIndexMeta.csvRowCount,
      reused:!!this.constructIndexMeta.reused,
      commit:this.constructIndexMeta.commit,
      schemaVersion:this.constructIndexMeta.schemaVersion,
      analyzerVersion:this.constructIndexMeta.analyzerVersion,
      incremental:!!this.constructIndexMeta.incremental,
      incrementalFrom:this.constructIndexMeta.incrementalFrom||'',
      affectedFiles:Array.isArray(this.constructIndexMeta.affectedFiles)?this.constructIndexMeta.affectedFiles:[]
    } : prep?.constructIndex;

    return {
      ...prep,
      pythonAst,
      structuralEvidence,
      constructIndex
    };
  }

  async persistPythonStructuralEvidence({ logPrefix='repo-prepare' } = {}) {
    const persistStage = async (stage, rows) => {
      this.codeStructureRows = rows;
      const csvPath = await this.persistCodeStructureCsv({
        language:'python',
        rows:this.codeStructureRows
      });
      const palPaths = await this.persistPalIndexes({
        language:'python',
        rows:this.codeStructureRows
      });

      if (this.constructIndexMeta) {
        this.constructIndexMeta = {
          ...this.constructIndexMeta,
          csvPath,
          uniqueIndexPath:palPaths.uniqueIndexPath,
          valuesIndexPath:palPaths.valuesIndexPath,
          csvRowCount:this.codeStructureRows.length,
          recordCount:this.codeStructureRows.length
        };
      }

      console.log(
        `[${logPrefix}] ${stage} persisted+indexed rows=${this.codeStructureRows.length}`
      );
      return {csvPath,palPaths};
    };

    // Stage 1 is already materialized by the base topology: function/region
    // rows and deterministic calls edges are in codeStructureRows and PAL.
    const functionRows = this.codeStructureRows.filter(row=>row?.type==='function').length;
    console.log(
      `[${logPrefix}] function graph ready functions=${functionRows} rows=${this.codeStructureRows.length}`
    );

    // Stage 2 derives compact execution flows only from the authoritative
    // function call graph, then persists and indexes those workflow rows.
    const flowStarted = Date.now();
    const compactFlows = buildCompactCallFlows({ symbols:this.symbols });
    const workflowGraph = buildWorkflowGraph({
      groupedPaths: compactFlows.paths,
      symbols: this.symbols
    });
    this.workflowGraphNodes = workflowGraph.nodes;
    this.workflowLinks = workflowGraph.workflowLinks;

    const functionAndFlowRows = materializeStructuralEvidenceRows({
      baseRows: this.codeStructureRows,
      workflowNodes: this.workflowGraphNodes
    });
    await persistStage('flow graph', functionAndFlowRows);

    console.log(
      `[${logPrefix}] flow graph built ${Date.now()-flowStarted}ms ` +
      `functions=${compactFlows.functionCount} edges=${compactFlows.edgeCount} ` +
      `flows=${compactFlows.paths.length} workflowLinks=${this.workflowLinks.length}`
    );

    // Stage 3 derives entity identity from raw dataflow evidence constrained by
    // the function graph and compact flow slices. Scalars remain dataflow-only.
    const entityStarted = Date.now();
    const entityGraph = buildPythonDataStructureGraph({
      symbols:this.symbols,
      observations:this.pythonDataObservations,
      transfers:this.pythonDataTransfers,
      flowSlices:compactFlows.paths,
      codeFacts:this.pythonCodeFacts,
      externalSymbols:this.externalSymbols
    });
    this.pythonEntityNodes = Array.isArray(entityGraph?.nodes) ? entityGraph.nodes : [];
    this.pythonEntityLinks = Array.isArray(entityGraph?.entityLinks) ? entityGraph.entityLinks : [];

    this.structuralEvidenceNodes = mergeStructuralEvidenceNodes(
      this.workflowGraphNodes,
      this.pythonEntityNodes
    );

    const unifiedRows = materializeStructuralEvidenceRows({
      baseRows:functionAndFlowRows,
      entityNodes:this.pythonEntityNodes,
      entityLinks:this.pythonEntityLinks,
      workflowNodes:this.workflowGraphNodes
    });
    await persistStage('entity graph', unifiedRows);

    console.log(
      `[${logPrefix}] entity graph built ${Date.now()-entityStarted}ms ` +
      `entities=${this.pythonEntityNodes.length} entityLinks=${this.pythonEntityLinks.length} ` +
      `rows=${this.codeStructureRows.length}`
    );

    return {
      nodeCount:this.structuralEvidenceNodes.length,
      entityNodeCount:this.pythonEntityNodes.length,
      entityLinkCount:this.pythonEntityLinks.length,
      workflowNodeCount:this.workflowGraphNodes.length,
      workflowLinkCount:this.workflowLinks.length,
      compactFlowCount:compactFlows.paths.length,
      compactFlowEdgeCount:compactFlows.edgeCount,
      csvPath:this.codeStructureCsvPath('python')
    };
  }

  async prepareCodeQuery(repoUrl) {
    const startedAt=Date.now();
    console.log('[code-query-prepare] START structural query topology');

    this.callPathIndex = null;
    this.moquiEntitySchema = null;
    this.moquiXmlExecution = null;
    this.entitySchemas = [];
    this.entitySchemaByName = new Map();

    const prep = await super.prepareIndexOnly(repoUrl);
    if (!Array.isArray(this.codeStructureRows) || !this.codeStructureRows.length) {
      console.log('[code-query-prepare] structural CSV unavailable; falling back to full topology preparation');
      return this.prepare(repoUrl);
    }

    this.symbols = [];
    this.symbolById.clear();
    this.nameIndex.clear();
    this.callers.clear();
    this.externalSymbols = [];
    this.moduleRegions = [];
    this.pythonCodeFacts = [];
    this.pythonDataObservations = [];
    this.pythonDataTransfers = [];
    this.pythonEntityNodes = [];
    this.pythonEntityLinks = [];
    this.workflowGraphNodes = [];
    this.workflowLinks = [];
    this.structuralEvidenceNodes = [];

    const t=Date.now();
    const pythonAst = await this.augmentPythonAstGraph();
    console.log(`[code-query-prepare] AST call graph hydrated ${Date.now()-t}ms symbols=${pythonAst.symbolCount} external=${pythonAst.externalSymbolCount}`);
    console.log(`[code-query-prepare] DONE ${Date.now()-startedAt}ms globalCallPaths=skipped`);

    return {
      ...prep,
      pythonAst,
      codeQueryTopology:true,
      callPathIndex:null
    };
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
    const structuralEvidence = await this.persistPythonStructuralEvidence({
      logPrefix:'repo-prepare'
    });

    console.log(`[repo-prepare] DONE ${Date.now()-startedAt}ms`);
    return {
      ...prep,
      pythonAst,
      structuralEvidence,
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
    this.moduleRegions = Array.isArray(result?.moduleRegions) ? result.moduleRegions : [];
    this.pythonCodeFacts = Array.isArray(result?.codeFacts) ? result.codeFacts : [];
    this.pythonDataObservations = Array.isArray(result?.dataObservations) ? result.dataObservations : [];
    this.pythonDataTransfers = Array.isArray(result?.dataTransfers) ? result.dataTransfers : [];
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
