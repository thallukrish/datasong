const arr = (value) => Array.isArray(value) ? value : [];

export const withCallPathAccess = (Base) => class CallPathAccessExplorer extends Base {
  rankedPathById(id) {
    return arr(this.topology?.callPathIndexer?.rankedPaths).find((path) => path?.id === id) || null;
  }

  groupedPathForArc(arc) {
    if (!arc) return null;
    const top = typeof this.topology?.topCallPaths === 'function' ? this.topology.topCallPaths(50) : [];
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
