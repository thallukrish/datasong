import { ProgressiveRepositoryExplorerV34 } from './progressiveRepositoryExplorerV34.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV35 extends ProgressiveRepositoryExplorerV34 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-pass1-pass2-ui-v15';
    if (state.callPathPreprocess) {
      state.callPathPreprocess.seededArcs = [];
      state.callPathPreprocess.topologySummary = null;
    }
    return state;
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._callPathPreprocess) return result;

    const cp = this.state.callPathPreprocess;
    const arcs = this.pass1().arcs();
    const seededIds = new Set(arr(cp?.seededArcIds));
    cp.seededArcs = arcs
      .filter((arc) => seededIds.has(arc.id) || arc.seedSource === 'call_path_preprocessor')
      .map((arc) => ({
        arcId: arc.id,
        title: arc.title || '',
        actor: arc.businessActor || '',
        intent: arc.businessIntent || '',
        confidence: Number(arc.confidence || 0),
        callPathId: arc.callPathId || '',
        coherentFunctionCount: Number(arc.coherentFunctionCount || 0),
        containedCallPathIds: arr(arc.containedCallPathIds),
        status: arc.status || 'seeded'
      }));

    const top = typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(10) : [];
    cp.topologySummary = {
      topCandidateCount: top.length,
      groupedVariantCount: top.reduce((sum, path) => sum + Number(path.branchVariantCount || 1), 0),
      alternateEntranceCount: top.reduce((sum, path) => sum + Number(path.alternateEntranceCount || 0), 0),
      classifierInput: 'compact_normalized_flow_structure',
      rerunPolicy: 'one_shot_per_repository_prepare'
    };
    return result;
  }
}
