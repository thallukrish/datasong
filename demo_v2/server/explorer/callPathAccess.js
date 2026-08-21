const arr = (value) => Array.isArray(value) ? value : [];

export const withCallPathAccess = (Base) => class CallPathAccessExplorer extends Base {
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
};
