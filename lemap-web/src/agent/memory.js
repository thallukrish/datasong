function arr(value) { return Array.isArray(value) ? value : []; }

export function createSemanticMemory(userGoal = '') {
  return {
    version: 1,
    userGoal: String(userGoal || ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entities: {},
    workflow: { nodes: [], edges: [] },
    sessions: []
  };
}

function touch(memory) { memory.updatedAt = new Date().toISOString(); }

export function recordEntityKnowledge(memory, { structuralEntity = {}, structuralGraph = {}, semanticEntity = {}, learnedRelationships = [], observations = [] } = {}) {
  if (!memory?.entities) throw new Error('Invalid semantic memory');
  const id = String(structuralEntity.id || '');
  if (!id) return null;
  const previous = memory.entities[id] || {};
  const evidenceIds = [...new Set([
    ...arr(previous.evidenceIds),
    ...arr(observations).map((observation) => observation?.id).filter(Boolean),
    ...arr(learnedRelationships).flatMap((relationship) => arr(relationship?.evidenceIds))
  ])];
  const structure = {
    fields: arr(structuralGraph.fields).map((field) => ({ id: field.id, label: field.label, type: field.type, groupId: field.parentGroupId || '' })),
    groups: arr(structuralGraph.groups).map((group) => ({ id: group.id, label: group.label, groupType: group.groupType, memberFieldIds: [...arr(group.memberFieldIds)] })),
    actions: arr(structuralGraph.actions).map((action) => ({ id: action.id, label: action.label, type: action.type }))
  };
  const entry = {
    ...previous,
    id,
    label: structuralEntity.label || previous.label || '',
    presentation: structuralEntity.presentation || previous.presentation || {},
    structure,
    semantic: semanticEntity,
    learnedRelationships,
    evidenceIds,
    lastObservedAt: new Date().toISOString()
  };
  memory.entities[id] = entry;
  if (!memory.workflow.nodes.includes(id)) memory.workflow.nodes.push(id);
  touch(memory);
  return entry;
}

export function startQuerySession(memory, userGoal = '') {
  const session = {
    id: `session:${memory.sessions.length + 1}`,
    userGoal: String(userGoal || ''),
    startedAt: new Date().toISOString(),
    path: [],
    answers: []
  };
  memory.sessions.push(session);
  memory.userGoal = session.userGoal;
  touch(memory);
  return session;
}

export function recordSessionAnswer(memory, session, answer = {}) {
  session.answers.push({ ...answer, recordedAt: new Date().toISOString() });
  touch(memory);
}

export function recordSelectedTransition(memory, { sourceEntityId = '', targetEntityId = '', candidate = {}, score = {}, alternatives = [], session = null } = {}) {
  if (!memory?.workflow?.edges) throw new Error('Invalid semantic memory');
  const edge = {
    id: `transition:${memory.workflow.edges.length + 1}`,
    sourceEntityId: String(sourceEntityId || ''),
    targetEntityId: String(targetEntityId || ''),
    candidateId: String(candidate.id || ''),
    label: String(candidate.label || ''),
    kind: String(candidate.kind || ''),
    href: String(candidate.href || ''),
    role: String(score.role || 'unknown'),
    goalRelevance: Number(score.goalRelevance || 0),
    continuity: Number(score.continuity || 0),
    forwardProgress: Number(score.forwardProgress || 0),
    retainedCandidateIds: arr(alternatives).map((item) => String(item.id || '')).filter(Boolean),
    traversedAt: new Date().toISOString()
  };
  memory.workflow.edges.push(edge);
  for (const entityId of [edge.sourceEntityId, edge.targetEntityId]) if (entityId && !memory.workflow.nodes.includes(entityId)) memory.workflow.nodes.push(entityId);
  if (session) session.path.push(edge.id);
  touch(memory);
  return edge;
}
