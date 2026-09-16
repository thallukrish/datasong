import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexerV3 } from './callPathIndexerV3.js';
import { createMoquiAdapters } from './adapters/moqui/index.js';
import { resolveOdooRuntime } from './adapters/odoo/runtime.js';
import { composeOdooSchemas } from './adapters/odoo/composeSchemas.js';

const identityKey = (value = '') => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

export class ProgressiveRepositoryTopologyV9 extends ProgressiveRepositoryTopologyV7 {
  constructor(options) {
    super(options);
    this.callPathIndexer = new CallPathIndexerV3(this);
    this.callPathIndex = null;

    // Preserve the existing Moqui path unchanged. Odoo is detected and run
    // independently; a shared cross-framework contract comes after ACME is proven.
    this.frameworkAdapters = createMoquiAdapters(this);
    this.moquiXmlAdapter = this.frameworkAdapters.execution;
    this.moquiEntitySchemaAdapter = this.frameworkAdapters.entitySchema;
    this.moquiXmlExecution = null;
    this.moquiEntitySchema = null;

    this.odooDetection = null;
    this.odooAdapters = null;
    this.odooEntitySchema = null;
    this.odooFramework = null;
    this.odooExecution = null;
    this.odooPatternEvidence = [];
    this.odooUiEvidence = { entrypoints: [], modelActions: [] };
    this.frameworkKind = '';

    this.entitySchemas = [];
    this.entitySchemaByName = new Map();
  }

  setEntitySchemas(schemas = []) {
    this.entitySchemas = Array.isArray(schemas) ? schemas : [];
    this.entitySchemaByName = new Map();
    for (const schema of this.entitySchemas) {
      if (schema?.name) this.entitySchemaByName.set(schema.name, schema);
      if (schema?.fullName) this.entitySchemaByName.set(schema.fullName, schema);
    }
  }

  async enrichOdooFrameworkSchemas(projectSchemas = this.entitySchemas) {
    this.odooFramework = this.odooAdapters?.frameworkEnricher
      ? await this.odooAdapters.frameworkEnricher.augment(projectSchemas)
      : { seeds: [], moduleSeeds: [], modules: [], frameworkSchemas: [], learned: [], reused: [], missing: [], source: null };

    this.setEntitySchemas(composeOdooSchemas({
      frameworkSchemas: this.odooFramework.frameworkSchemas,
      projectSchemas
    }));
    return this.odooFramework;
  }

  odooFrameworkSummary() {
    const framework = this.odooFramework || {};
    return {
      seeds: Array.isArray(framework.seeds) ? framework.seeds : [],
      moduleSeeds: Array.isArray(framework.moduleSeeds) ? framework.moduleSeeds : [],
      modules: Array.isArray(framework.modules) ? framework.modules : [],
      learned: Array.isArray(framework.learned) ? framework.learned : [],
      reused: Array.isArray(framework.reused) ? framework.reused : [],
      missing: Array.isArray(framework.missing) ? framework.missing : [],
      frameworkSchemaCount: Array.isArray(framework.frameworkSchemas) ? framework.frameworkSchemas.length : 0,
      source: framework.source ? {
        repoUrl: framework.source.repoUrl || '',
        commit: framework.source.commit || ''
      } : null
    };
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    const odooRuntime = await resolveOdooRuntime(this);

    if (odooRuntime) {
      this.frameworkKind = 'odoo';
      this.odooDetection = odooRuntime.detection;
      this.odooAdapters = odooRuntime.adapters;
      this.odooPatternEvidence = this.odooAdapters?.adapter?.collectPatternEvidence
        ? await this.odooAdapters.adapter.collectPatternEvidence()
        : [];
      this.odooUiEvidence = this.odooAdapters?.adapter?.collectUiEvidence
        ? await this.odooAdapters.adapter.collectUiEvidence()
        : { entrypoints: [], modelActions: [] };
      this.odooEntitySchema = this.odooAdapters?.entitySchema
        ? await this.odooAdapters.entitySchema.augment()
        : null;

      const projectSchemas = [...this.entitySchemas];
      await this.enrichOdooFrameworkSchemas(projectSchemas);
      this.odooExecution = this.odooAdapters?.execution
        ? await this.odooAdapters.execution.augment({ entrypoints: this.odooUiEvidence.entrypoints })
        : null;

      this.moquiEntitySchema = null;
      this.moquiXmlExecution = null;
      this.callPathIndex = this.callPathIndexer.build();
      return {
        ...prep,
        frameworkKind: this.frameworkKind,
        odooDetection: this.odooDetection,
        odooPatterns: this.odooPatternEvidence,
        odooUi: this.odooUiEvidence,
        odooEntitySchema: this.odooEntitySchema,
        odooFramework: this.odooFrameworkSummary(),
        odooExecution: this.odooExecution,
        moquiEntitySchema: null,
        moquiXmlExecution: null,
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

    // Non-Odoo repositories continue through the existing Moqui behavior.
    this.frameworkKind = 'moqui';
    this.odooDetection = null;
    this.odooAdapters = null;
    this.odooEntitySchema = null;
    this.odooFramework = null;
    this.odooExecution = null;
    this.odooPatternEvidence = [];
    this.odooUiEvidence = { entrypoints: [], modelActions: [] };
    this.moquiEntitySchema = await this.moquiEntitySchemaAdapter.augment();
    this.moquiXmlExecution = await this.moquiXmlAdapter.augment();
    this.callPathIndex = this.callPathIndexer.build();
    return {
      ...prep,
      frameworkKind: this.frameworkKind,
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
