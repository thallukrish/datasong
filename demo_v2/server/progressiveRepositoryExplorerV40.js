import { ProgressiveRepositoryExplorerV39 } from './progressiveRepositoryExplorerV39.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean))]; }

export class ProgressiveRepositoryExplorerV40 extends ProgressiveRepositoryExplorerV39 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callgraph-pass1-pass2-navigator-v20';
    state.pass2GraphByArc = {};
    return state;
  }

  ensureGraphState() {
    if (!this.state.pass2GraphByArc) this.state.pass2GraphByArc = {};
    return this.state.pass2GraphByArc;
  }

  rankedPathById(id) {
    return arr(this.topology?.callPathIndexer?.rankedPaths).find((path) => path?.id === id) || null;
  }

  groupedPathForArc(arc) {
    if (!arc) return null;
    const top = typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(50) : [];
    if (arc.callPathId) return top.find((path) => path.id === arc.callPathId) || this.rankedPathById(arc.callPathId);

    const artifactId = arc.scoutArtifactId || arc.seedArtifactId || '';
    if (!artifactId) return null;
    const containing = arr(this.topology?.callPathIndexer?.rankedPaths)
      .filter((path) => arr(path.symbolIds).includes(artifactId))
      .sort((a, b) => Number(b.functionCount || 0) - Number(a.functionCount || 0));
    return containing[0] || null;
  }

  familyPaths(grouped) {
    if (!grouped) return [];
    const ids = uniq([grouped.id, ...arr(grouped.alternatives).map((item) => item.pathId)]);
    return ids.map((id) => this.rankedPathById(id)).filter(Boolean);
  }

  attachGraphNavigator(arc) {
    if (!arc) return null;
    const map = this.ensureGraphState();
    if (map[arc.id]) return map[arc.id];

    const grouped = this.groupedPathForArc(arc);
    if (!grouped) return null;
    const paths = this.familyPaths(grouped);
    if (!paths.length) return null;

    let startId = arc.seedArtifactId || arc.scoutArtifactId || grouped.entrySymbolId || paths[0].entrySymbolId || '';
    if (!paths.some((path) => arr(path.symbolIds).includes(startId))) startId = grouped.entrySymbolId || paths[0].entrySymbolId || '';
    if (!startId) return null;

    map[arc.id] = {
      groupedPathId: grouped.id || '',
      pathIds: paths.map((path) => path.id),
      currentSymbolId: startId,
      visitedSymbolIds: [],
      stack: [],
      started: false,
      exhausted: false
    };
    arc.graphPathId = grouped.id || '';
    arc.graphNavigation = true;
    return map[arc.id];
  }

  graphSymbolCandidate(id, relation = 'call_graph') {
    const symbol = this.topology.symbolById?.get(id);
    if (!symbol) return null;
    return {
      id: symbol.id,
      path: `${symbol.sourcePath || ''}#${symbol.name || symbol.id}`,
      kind: 'function',
      relation,
      label: symbol.name || symbol.simpleName || symbol.id,
      hint: symbol.signature || symbol.name || symbol.id
    };
  }

  nextGraphIds(graph, currentId) {
    const paths = arr(graph?.pathIds).map((id) => this.rankedPathById(id)).filter(Boolean);
    const next = [];
    for (const path of paths) {
      const ids = arr(path.symbolIds);
      for (let i = 0; i < ids.length; i += 1) {
        if (ids[i] !== currentId) continue;
        const target = ids[i + 1];
        if (target) next.push(target);
      }
    }
    const visited = new Set(arr(graph?.visitedSymbolIds));
    return uniq(next).filter((id) => !visited.has(id));
  }

  graphNeighborhood(arc, graph, symbolId) {
    if (!arc || !graph || !symbolId) return null;
    const symbol = this.topology.symbolById?.get(symbolId);
    if (!symbol) return null;
    const nextIds = this.nextGraphIds(graph, symbolId);
    const neighbors = nextIds.map((id) => this.graphSymbolCandidate(id)).filter(Boolean);

    return {
      id: `pass2-callgraph:${arc.id}:${encodeURIComponent(symbolId)}`,
      path: `${symbol.sourcePath || ''}#${symbol.name || symbolId}`,
      kind: 'semantic_neighborhood',
      summary: `Compressed call-graph position for ${arc.title}`,
      canonical: {
        kind: 'call_graph_navigation',
        arcId: arc.id,
        groupedPathId: graph.groupedPathId,
        anchor: {
          id: symbol.id,
          function: symbol.name || symbol.simpleName || symbol.id,
          kind: symbol.semanticType || symbol.symbolKind || 'function',
          provenance: symbol.sourcePath || ''
        },
        next: neighbors.map((candidate) => ({ id: candidate.id, relation: candidate.relation, function: candidate.label, signature: candidate.hint })),
        terminal: neighbors.length === 0,
        policy: 'Pass 2 navigates only the precomputed compressed call-path family; repository frontier is not used.'
      },
      neighbors,
      sourceCoverage: null
    };
  }

  startGraphArc(arc) {
    const graph = this.attachGraphNavigator(arc);
    if (!graph || graph.started) return null;
    graph.started = true;
    graph.currentSymbolId = graph.currentSymbolId || arc.seedArtifactId || arc.scoutArtifactId || '';
    graph.visitedSymbolIds = uniq([...arr(graph.visitedSymbolIds), graph.currentSymbolId]);
    this.state.executionStack = [];
    this.state.frontier = [];
    this.state.lastMessage = `Pass 2 navigating compressed call graph for ${arc.title}.`;
    this.pass1().syncStories();
    this.emit?.();
    return this.graphNeighborhood(arc, graph, graph.currentSymbolId);
  }

  async startArcAtSeed(arc) {
    const graphObservation = this.startGraphArc(arc);
    if (graphObservation) {
      arc.seedStarted = true;
      return graphObservation;
    }
    return super.startArcAtSeed(arc);
  }

  async resumePass2Arc(arcId) {
    const arc = this.pass1().arcByReference(arcId);
    const graph = this.attachGraphNavigator(arc);
    if (graph) {
      if (!graph.started) return this.startGraphArc(arc);
      if (graph.exhausted) return null;
      return this.graphNeighborhood(arc, graph, graph.currentSymbolId);
    }
    return super.resumePass2Arc(arcId);
  }

  chooseGraphCandidate(action, candidates, graph) {
    const available = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    const requested = action?.artifactId && available.get(action.artifactId);
    if (requested) return requested;

    const scored = arr(action?.candidateScores || this._lastParsedCandidateScores)
      .filter((item) => available.has(item?.artifactId))
      .map((item) => ({ item, candidate: available.get(item.artifactId), score: this.scoreCandidate(item) }))
      .filter((entry) => entry.score >= 0.25)
      .sort((a, b) => b.score - a.score);
    if (scored.length) return scored[0].candidate;

    const nextIds = this.nextGraphIds(graph, graph.currentSymbolId);
    return nextIds.map((id) => available.get(id)).find(Boolean) || null;
  }

  advanceGraph(arc, graph, candidate) {
    if (!candidate?.id) return null;
    if (graph.currentSymbolId) graph.stack.push(graph.currentSymbolId);
    graph.currentSymbolId = candidate.id;
    graph.visitedSymbolIds = uniq([...arr(graph.visitedSymbolIds), candidate.id]);
    this.state.lastMessage = `Pass 2 ${arc.title}: ${candidate.label || candidate.id}`;
    return this.graphNeighborhood(arc, graph, candidate.id);
  }

  backtrackGraph(arc, graph) {
    while (graph.stack.length) {
      const previous = graph.stack.pop();
      const alternatives = this.nextGraphIds(graph, previous);
      if (!alternatives.length) continue;
      graph.currentSymbolId = previous;
      this.state.lastMessage = `Pass 2 backtracked within ${arc.title}.`;
      return this.graphNeighborhood(arc, graph, previous);
    }
    graph.exhausted = true;
    this.state.lastMessage = `Pass 2 exhausted compressed call graph for ${arc.title}; Pass 1 will schedule another arc.`;
    return null;
  }

  async resolveNextAction(action, candidates) {
    const arc = this.pass1().activeArc();
    const graph = this.attachGraphNavigator(arc);
    if (graph && graph.started) {
      const request = action || { type: 'advance' };
      if (request.type === 'advance' || request.type === 'getArtifact' || request.type === 'getFunction' || request.type === 'getNeighbors') {
        const candidate = this.chooseGraphCandidate(request, candidates, graph);
        if (candidate) return this.advanceGraph(arc, graph, candidate);
        return this.backtrackGraph(arc, graph);
      }
      if (request.type === 'backtrack' || request.type === 'stop') return this.backtrackGraph(arc, graph);
      if (request.type === 'searchSemantic') {
        // Pass 2 may not leave the indexed graph on its own. Search is Scout's job.
        this.scout().ensureState().pendingReason = `Pass 2 requested evidence outside compressed graph for ${arc.id}`;
        return this.backtrackGraph(arc, graph);
      }
    }
    return super.resolveNextAction(action, candidates);
  }
}
