import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexerV3 } from './callPathIndexerV3.js';
import { MoquiXmlExecutionAdapter } from './moquiXmlExecutionAdapter.js';
import { MoquiEntitySchemaAdapter } from './moquiEntitySchemaAdapter.js';

export class ProgressiveRepositoryTopologyV9 extends ProgressiveRepositoryTopologyV7 {
  constructor(options) {
    super(options);
    this.callPathIndexer = new CallPathIndexerV3(this);
    this.callPathIndex = null;
    this.moquiXmlAdapter = new MoquiXmlExecutionAdapter(this);
    this.moquiXmlExecution = null;
    this.moquiEntitySchemaAdapter = new MoquiEntitySchemaAdapter(this);
    this.moquiEntitySchema = null;
    this.entitySchemas = [];
    this.entitySchemaByName = new Map();
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    this.moquiEntitySchema = await this.moquiEntitySchemaAdapter.augment();
    this.moquiXmlExecution = await this.moquiXmlAdapter.augment();
    this.callPathIndex = this.callPathIndexer.build();
    return {
      ...prep,
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
    const leaf = String(name).split(/[.#:/]/).at(-1);
    return this.entitySchemaByName.get(leaf) || this.entitySchemas.find((s) => s.name === leaf || s.fullName === name) || null;
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
