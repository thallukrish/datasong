import { ProgressiveRepositoryTopologyV7 } from './progressiveRepositoryTopologyV7.js';
import { CallPathIndexer } from './callPathIndexer.js';

export class ProgressiveRepositoryTopologyV8 extends ProgressiveRepositoryTopologyV7 {
  constructor(options) {
    super(options);
    this.callPathIndexer = new CallPathIndexer(this);
    this.callPathIndex = null;
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    this.callPathIndex = this.callPathIndexer.build();
    return {
      ...prep,
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
