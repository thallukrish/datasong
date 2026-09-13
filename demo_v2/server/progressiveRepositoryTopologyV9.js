import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexerV3 } from './callPathIndexerV3.js';
import { resolveFrameworkAdapters } from './adapters/frameworkResolver.js';

const identityKey = (value = '') => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

export class ProgressiveRepositoryTopologyV9 extends ProgressiveRepositoryTopologyV7 {
  constructor(options) {
    super(options);
    this.callPathIndexer = new CallPathIndexerV3(this);
    this.callPathIndex = null;

    this.frameworkKind = 'generic';
    this.frameworkDetection = { detected: false };
    this.frameworkAdapters = null;
    this.frameworkEntitySchema = null;
    this.frameworkExecution = null;

    // Compatibility aliases for existing Moqui consumers. They are populated
    // only when the repository is actually detected as Moqui.
    this.moquiXmlAdapter = null;
    this.moquiEntitySchemaAdapter = null;
    this.moquiXmlExecution = null;
    this.moquiEntitySchema = null;

    this.odooDetection = null;
    this.entitySchemas = [];
    this.entitySchemaByName = new Map();
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    const resolved = await resolveFrameworkAdapters(this);

    this.frameworkKind = resolved.kind;
    this.frameworkDetection = resolved.detection;
    this.frameworkAdapters = resolved.adapters;
    this.odooDetection = resolved.kind === 'odoo' ? resolved.detection : null;

    this.moquiXmlAdapter = resolved.kind === 'moqui' ? resolved.adapters?.execution || null : null;
    this.moquiEntitySchemaAdapter = resolved.kind === 'moqui' ? resolved.adapters?.entitySchema || null : null;

    this.frameworkEntitySchema = resolved.adapters?.entitySchema
      ? await resolved.adapters.entitySchema.augment()
      : null;
    this.frameworkExecution = resolved.adapters?.execution
      ? await resolved.adapters.execution.augment()
      : null;

    this.moquiEntitySchema = resolved.kind === 'moqui' ? this.frameworkEntitySchema : null;
    this.moquiXmlExecution = resolved.kind === 'moqui' ? this.frameworkExecution : null;

    this.callPathIndex = this.callPathIndexer.build();
    return {
      ...prep,
      frameworkKind: this.frameworkKind,
      frameworkDetection: this.frameworkDetection,
      frameworkEntitySchema: this.frameworkEntitySchema,
      frameworkExecution: this.frameworkExecution,
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
