import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexer } from './callPathIndexer.js';
import { MoquiXmlExecutionAdapter } from './moquiXmlExecutionAdapter.js';

export class ProgressiveRepositoryTopologyV9 extends ProgressiveRepositoryTopologyV7 {
  constructor(options) {
    super(options);
    this.callPathIndexer = new CallPathIndexer(this);
    this.callPathIndex = null;
    this.moquiXmlAdapter = new MoquiXmlExecutionAdapter(this);
    this.moquiXmlExecution = null;
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    this.moquiXmlExecution = await this.moquiXmlAdapter.augment();
    this.callPathIndex = this.callPathIndexer.build();
    return {
      ...prep,
      moquiXmlExecution: this.moquiXmlExecution,
      callPathIndex: {
        version: this.callPathIndex.version,
        fragmentCount: this.callPathIndex.fragmentCount,
        rawPathCount: this.callPathIndex.rawPathCount,
        rankedPathCount: this.callPathIndex.rankedPathCount,
        topPaths: this.callPathIndex.topPaths
      }
    };
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
