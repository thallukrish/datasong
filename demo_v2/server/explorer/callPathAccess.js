const arr = (value) => Array.isArray(value) ? value : [];

export const withCallPathAccess = (Base) => class CallPathAccessExplorer extends Base {
  rankedPathById(id) {
    return arr(this.topology?.callPathIndexer?.rankedPaths).find((path) => path?.id === id) || null;
  }

  groupedCallPaths() {
    const indexer = this.topology?.callPathIndexer || null;
    if (this._groupedCallPathCache?.indexer === indexer) return this._groupedCallPathCache.paths;
    const paths = typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(50) : [];
    this._groupedCallPathCache = { indexer, paths:arr(paths) };
    return this._groupedCallPathCache.paths;
  }

  groupedPathForArc(arc) {
    if (!arc) return null;
    // Grouping call paths is deterministic for a prepared topology but expensive:
    // CallPathIndexerV3.top() compares the full ranked path set before slicing.
    // Reuse that grouping across workflow handoffs instead of recomputing it for
    // every Pass-2 arc. The cache invalidates automatically when the indexer
    // instance changes on a fresh repository prepare.
    const top = this.groupedCallPaths();
    const byId = (id) => id ? (top.find((path) => path.id === id) || this.rankedPathById(id)) : null;

    // Persisted workflow state may retain any one of these evidenced path ids.
    // Treat them all as valid deterministic Pass-2 seeds instead of requiring
    // callPathId specifically.
    for (const id of [
      arc.callPathId,
      ...arr(arc.callPathVariantIds),
      ...arr(arc.containedCallPathIds),
      ...arr(arc.relatedCallPathIds)
    ]) {
      const grouped = byId(id);
      if (grouped) return grouped;
    }

    const artifactId = arc.scoutArtifactId || arc.seedArtifactId || '';
    if (!artifactId) return null;
    const containing = arr(this.topology?.callPathIndexer?.rankedPaths)
      .filter((path) => arr(path.symbolIds).includes(artifactId))
      .sort((a, b) => Number(b.functionCount || 0) - Number(a.functionCount || 0));
    return containing[0] || null;
  }
};
