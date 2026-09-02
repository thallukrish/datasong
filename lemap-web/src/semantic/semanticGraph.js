function arr(value) { return Array.isArray(value) ? value : []; }

export function materializeSemanticGraph({ pass1 = {}, pass2 = {} } = {}) {
  const nodes = [];
  const edges = [];
  const evidence = new Set(arr(pass1.evidenceIds));
  const workflowId = `semantic-workflow:${String(pass1.title || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}`;
  nodes.push({
    id: workflowId,
    type: 'workflow',
    name: pass1.title || 'Workflow',
    actor: pass1.businessActor || '',
    intent: pass1.businessIntent || '',
    stages: arr(pass1.majorStages),
    completionCondition: pass1.completionCondition || '',
    outcome: pass1.outcome || '',
    confidence: Number(pass1.confidence || 0),
    evidenceIds: arr(pass1.evidenceIds)
  });

  const entityNodeBySource = new Map();
  for (const item of arr(pass2.entities)) {
    for (const id of arr(item.evidenceIds)) evidence.add(id);
    const id = `semantic-entity:${item.structuralEntityId || item.semanticName}`;
    const node = {
      id,
      type: 'entity',
      name: item.semanticName || item.structuralEntityId,
      sourceEntityId: item.structuralEntityId || '',
      description: item.description || '',
      fields: arr(item.fields),
      evidenceIds: arr(item.evidenceIds)
    };
    nodes.push(node);
    if (item.structuralEntityId) entityNodeBySource.set(item.structuralEntityId, node);
    edges.push({ from: workflowId, relation: 'uses_entity', to: id, evidenceIds: arr(item.evidenceIds) });
  }

  for (const relation of arr(pass2.relationships)) {
    for (const id of arr(relation.evidenceIds)) evidence.add(id);
    const from = entityNodeBySource.get(relation.fromEntityId)?.id || `structural:${relation.fromEntityId}`;
    const to = entityNodeBySource.get(relation.toEntityId)?.id || `structural:${relation.toEntityId}`;
    edges.push({ from, relation: relation.relation || 'related_to', to, description: relation.description || '', evidenceIds: arr(relation.evidenceIds) });
  }

  for (const rule of arr(pass2.rules)) for (const id of arr(rule.evidenceIds)) evidence.add(id);
  for (const step of arr(pass2.steps)) for (const id of arr(step.evidenceIds)) evidence.add(id);
  return {
    version: 1,
    nodes,
    edges,
    rules: arr(pass2.rules),
    steps: arr(pass2.steps),
    unresolvedBranches: arr(pass2.unresolvedBranches),
    evidenceIds: [...evidence]
  };
}
