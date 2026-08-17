import { BoundaryAwareExplorer } from './boundaryAwareExplorer.js';

function short(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function edgeKey(fromId, relation, toId) {
  return `${fromId}::${relation || 'reference'}::${toId}`;
}

export class CycleSafeExplorer extends BoundaryAwareExplorer {
  emptyState() {
    const state = super.emptyState();
    state.visitedFunctions = [];
    state.visitedEdges = [];
    state.backEdges = [];
    state.currentPath = [];
    state.semanticFunctionCache = {};
    return state;
  }

  candidatesFor(observation) {
    this._currentObservationId = observation?.id || '';

    if (observation?.id && !this.state.visitedFunctions.includes(observation.id)) {
      this.state.visitedFunctions.push(observation.id);
    }
    if (observation?.id && !this.state.currentPath.includes(observation.id)) {
      this.state.currentPath.push(observation.id);
      this.state.currentPath = this.state.currentPath.slice(-120);
    }

    // Preserve graph structure when a function points back to something already
    // understood, but never traverse that target again. This covers recursion,
    // mutual recursion and ordinary call-graph cycles without losing the edge.
    for (const neighbor of Array.isArray(observation?.neighbors) ? observation.neighbors : []) {
      if (!neighbor?.id || !this.state.visited.includes(neighbor.id)) continue;
      const relation = neighbor.relation || 'reference';
      const key = edgeKey(observation.id, relation, neighbor.id);
      if (this.state.backEdges.some((edge) => edge.key === key)) continue;
      this.state.backEdges.push({
        key,
        fromId: observation.id,
        toId: neighbor.id,
        relation,
        kind: this.state.currentPath.includes(neighbor.id) ? 'cycle' : 'reuse',
        cachedMeaning: short(this.state.semanticFunctionCache?.[neighbor.id]?.meaning, 240)
      });
    }
    this.state.backEdges = this.state.backEdges.slice(-240);

    // The base explorer already excludes globally visited node IDs from local
    // and global candidates. Keeping that invariant here makes cycle avoidance
    // deterministic rather than dependent on model behavior.
    return super.candidatesFor(observation);
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (observation?.id) {
      this.state.semanticFunctionCache[observation.id] = {
        meaning: short(parsed?.meaning),
        semanticRole: parsed?.semanticRole || 'unattached',
        pathId: parsed?.pathId || '',
        bridge: short(parsed?.bridge),
        relation: parsed?.relation || '',
        sourcePath: observation.sourcePath || observation.path || '',
        symbolName: observation.symbolName || observation.label || observation.referenceName || ''
      };
    }
    return result;
  }

  async resolveNextAction(action, candidates) {
    const sourceId = this._currentObservationId || '';
    const next = await super.resolveNextAction(action, candidates);
    if (!next?.id || !sourceId) return next;

    // Never revisit a function even if a model-selected search or fallback tries
    // to route back to one. The semantic cache/back-edge already preserves it.
    if (this.state.visited.includes(next.id)) {
      const candidate = (Array.isArray(candidates) ? candidates : []).find((item) => item.id === next.id);
      this.recordTraversalEdge(sourceId, next.id, candidate?.relation || action?.type || 'reference', 'cycle_blocked');
      return this.observeUnvisitedFallback(candidates);
    }

    const candidate = (Array.isArray(candidates) ? candidates : []).find((item) => item.id === next.id);
    this.recordTraversalEdge(sourceId, next.id, candidate?.relation || action?.type || 'reference', 'traversed');
    return next;
  }

  async observeUnvisitedFallback(candidates) {
    const available = (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => candidate?.id && !this.state.visited.includes(candidate.id))
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a));
    const fallback = available[0];
    if (!fallback) return null;
    this.removeFrontier(fallback.id);
    this.recordTraversalEdge(this._currentObservationId || '', fallback.id, fallback.relation || 'fallback', 'traversed');
    return this.topology.observe(fallback.id);
  }

  recordTraversalEdge(fromId, toId, relation, status) {
    if (!fromId || !toId) return;
    const key = edgeKey(fromId, relation, toId);
    if (this.state.visitedEdges.some((edge) => edge.key === key)) return;
    this.state.visitedEdges.push({ key, fromId, toId, relation, status });
    this.state.visitedEdges = this.state.visitedEdges.slice(-400);
  }
}
