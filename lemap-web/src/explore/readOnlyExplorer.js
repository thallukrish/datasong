import crypto from 'node:crypto';
import { snapshotPage } from '../browserCapture.js';
import { preprocessEntity } from '../graph/entityPreprocessor.js';
import { projectEntityState } from '../graph/entityState.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function stateId(state) {
  return `state:${crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 12)}`;
}

function methodSafety(graph = {}, fieldId = '') {
  const method = arr(graph.methods).find((candidate) => candidate.fieldId === fieldId);
  return arr(method?.actions)[0]?.safety || 'policy-required';
}

export async function exploreReadOnlyEntity(page) {
  const snapshot = await snapshotPage(page);
  const graph = preprocessEntity(snapshot);
  const state = projectEntityState(snapshot, graph);
  const id = stateId(state);
  const valueDomains = {};
  const learnedRelationships = [];

  for (const field of arr(graph.fields)) {
    const values = arr(state.options?.[field.id]);
    if (!values.length) continue;
    valueDomains[field.id] = [...values];
    learnedRelationships.push({
      kind: 'value_domain',
      sourceFieldId: field.id,
      values: [...values],
      evidenceIds: []
    });
  }

  return {
    entity: structuredClone(graph.entity),
    graph,
    state,
    initialStateId: id,
    finalStateId: id,
    observations: [],
    learnedRelationships,
    valueDomains,
    probeBehavior: false,
    outgoingCandidates: arr(graph.actions).map((actionField) => ({
      fieldId: actionField.id,
      label: actionField.label,
      type: actionField.type,
      href: actionField.href || '',
      executableNow: !!(actionField.visible && !actionField.disabled),
      safety: methodSafety(graph, actionField.id)
    })),
    restored: true,
    errors: []
  };
}
