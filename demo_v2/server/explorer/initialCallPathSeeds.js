const arr = (value) => Array.isArray(value) ? value : [];

export const withInitialCallPathSeeds = (Base) => class InitialCallPathSeedsExplorer extends Base {
  attachDeterministicSeedStarts() {
    const byPath = new Map(
      (typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(10) : [])
        .map((path) => [path.id, path])
    );
    for (const arc of this.pass1().arcs()) {
      if (arc.seedSource !== 'call_path_preprocessor' || !arc.callPathId) continue;
      const path = byPath.get(arc.callPathId);
      if (!path) continue;
      arc.seedArtifactId = path.entrySymbolId || arc.seedArtifactId || '';
      arc.seedSourcePath = arr(path.sourcePaths)[0] || arc.seedSourcePath || '';
      if (arc.seedStarted == null) arc.seedStarted = false;
      if (this.state.pass2DfsByArc) delete this.state.pass2DfsByArc[arc.id];
    }
  }

  projectInitialSeedArcs() {
    const cp = this.state.callPathPreprocess || {};
    const seededIds = arr(cp.seededArcIds);
    const arcsById = new Map(this.pass1().arcs().map((arc) => [arc.id, arc]));
    cp.seededArcs = seededIds.map((id) => arcsById.get(id)).filter(Boolean).map((arc) => ({
      arcId: arc.id,
      title: arc.title || '',
      actor: arc.trigger || arc.businessActor || '',
      intent: arc.businessIntent || '',
      confidence: Number(arc.opportunityScore || arc.confidence || 0),
      callPathId: arc.callPathId || '',
      coherentFunctionCount: Number(arc.coherentFunctionCount || 0),
      containedCallPathIds: arr(arc.containedCallPathIds),
      status: arc.status || 'seeded'
    }));
    for (const id of seededIds) this.pass2().seed(id);
    return seededIds;
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._callPathPreprocess) return result;

    this.attachDeterministicSeedStarts();
    const seededIds = this.projectInitialSeedArcs();
    const chosen = this.pass1().chooseNextArc(seededIds[0] || '');
    if (chosen) {
      this._pendingSeedArcId = chosen.id;
      this.state.lastMessage = `Pass 1 scheduled ${chosen.title}; Pass 2 will start from its deterministic call-path flow.`;
      this.pass1().syncStories();
    }
    return result;
  }

  async resolveNextAction(action, candidates) {
    if (this._pendingSeedArcId) {
      const arcId = this._pendingSeedArcId;
      this._pendingSeedArcId = '';
      const observation = await this.resumePass2Arc(arcId);
      if (observation) return observation;
    }
    return super.resolveNextAction(action, candidates);
  }
};
