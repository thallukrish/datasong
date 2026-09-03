import { controlScope } from './controlScope.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export function coveredInteractionFieldIds(graph = {}, semanticEntity = {}) {
  const covered = new Set(arr(semanticEntity.interactions)
    .flatMap((item) => arr(item.structuralFieldIds))
    .map(String));

  for (const group of arr(graph.groups)) {
    if (!['radio', 'checkbox'].includes(String(group?.groupType || ''))) continue;
    const members = arr(group.memberFieldIds).map(String);
    if (members.some((fieldId) => covered.has(fieldId))) members.forEach((fieldId) => covered.add(fieldId));
  }
  return covered;
}

export function uncoveredUserInputFields(graph = {}, state = {}, semanticEntity = {}, options = {}) {
  const covered = coveredInteractionFieldIds(graph, semanticEntity);
  const inputTypes = new Set(['text', 'number', 'date', 'select', 'autocomplete', 'radio', 'checkbox']);
  const memory = options.memory || null;
  const entityId = options.entityId || graph.entity?.id || '';

  return arr(graph.fields).filter((field) => inputTypes.has(field.type)
    && state.fields?.[field.id]?.visible
    && state.fields?.[field.id]?.enabled
    && !covered.has(String(field.id))
    && (!memory || controlScope(memory, field, entityId) !== 'application'));
}
