function arr(value) { return Array.isArray(value) ? value : []; }

function dependencyReady(item = {}, byKey = new Map()) {
  return arr(item.dependsOnSemanticKeys).every((semanticKey) => {
    const dependency = byKey.get(String(semanticKey));
    if (!dependency) return false;
    return !['missing', 'blocked'].includes(dependency.status);
  });
}

export function orderedInteractionItems(items = []) {
  const byKey = new Map(arr(items).map((item) => [String(item.semanticKey || ''), item]));
  return arr(items)
    .filter((item) => item?.status === 'missing')
    .filter((item) => item?.requiredForGoal !== false)
    .filter((item) => dependencyReady(item, byKey))
    .sort((a, b) => {
      const priorityA = Number.isFinite(Number(a?.priority)) ? Number(a.priority) : 100;
      const priorityB = Number.isFinite(Number(b?.priority)) ? Number(b.priority) : 100;
      if (priorityA !== priorityB) return priorityA - priorityB;
      const relevanceA = Number.isFinite(Number(a?.goalRelevance)) ? Number(a.goalRelevance) : 0.5;
      const relevanceB = Number.isFinite(Number(b?.goalRelevance)) ? Number(b.goalRelevance) : 0.5;
      return relevanceB - relevanceA || String(a?.semanticKey || '').localeCompare(String(b?.semanticKey || ''));
    });
}
