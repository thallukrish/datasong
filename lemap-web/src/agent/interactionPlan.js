function arr(value) { return Array.isArray(value) ? value : []; }
function priorityOf(item = {}) { return Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 100; }
function relevanceOf(item = {}) { return Number.isFinite(Number(item?.goalRelevance)) ? Number(item.goalRelevance) : 0.5; }

function compareInteractions(a = {}, b = {}) {
  const priorityDelta = priorityOf(a) - priorityOf(b);
  if (priorityDelta) return priorityDelta;
  const relevanceDelta = relevanceOf(b) - relevanceOf(a);
  return relevanceDelta || String(a?.semanticKey || '').localeCompare(String(b?.semanticKey || ''));
}

function dependencyReady(item = {}, byKey = new Map()) {
  return arr(item.dependsOnSemanticKeys).every((semanticKey) => {
    const dependency = byKey.get(String(semanticKey));
    if (!dependency) return false;
    return !['missing', 'blocked', 'optional'].includes(dependency.status);
  });
}

export function sortInteractionItems(items = []) {
  return [...arr(items)].sort(compareInteractions);
}

export function orderedInteractionItems(items = []) {
  const sorted = sortInteractionItems(items);
  const byKey = new Map(sorted.map((item) => [String(item.semanticKey || ''), item]));
  return sorted
    .filter((item) => item?.status === 'missing')
    .filter((item) => item?.requiredForGoal !== false)
    .filter((item) => dependencyReady(item, byKey));
}
