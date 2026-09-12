import { findInstance } from '../graph/instanceGraph.js';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function idSet(values = []) {
  return values instanceof Set
    ? new Set([...values].map(String))
    : new Set(arr(values).filter(Boolean).map(String));
}

function visibleAndEnabled(entity = {}, visibleEntityIds = null) {
  if (visibleEntityIds) {
    const visible = idSet(visibleEntityIds);
    if (!visible.has(String(entity.id || ''))) return false;
  } else if (entity.structural?.visible === false) {
    return false;
  }
  return entity.structural?.disabled !== true;
}

function requiredUserInput(entity = {}) {
  if (!['ui_control', 'ui_group'].includes(entity.type)) return false;
  const semantic = entity.semantic || {};
  return semantic.interaction === 'user_input'
    && semantic.relevantToGoal === true
    && semantic.required === true;
}

function groupedMember(entity = {}, byId = new Map()) {
  if (entity.type !== 'ui_control') return false;
  return arr(entity.links)
    .filter((link) => link.relationship === 'memberOf')
    .map((link) => byId.get(link.id))
    .some((owner) => owner?.type === 'ui_group');
}

function eligibleInputs(entities = [], visibleEntityIds = null) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  return all.filter((entity) => (
    requiredUserInput(entity)
    && !groupedMember(entity, byId)
    && visibleAndEnabled(entity, visibleEntityIds)
  ));
}

export function selectNextRequiredInput({
  entities = [],
  instanceGraph,
  visibleEntityIds = null
} = {}) {
  if (!instanceGraph || !Array.isArray(instanceGraph.instances)) {
    throw new Error('An instance graph with instances is required.');
  }

  return eligibleInputs(entities, visibleEntityIds)
    .find((entity) => !findInstance(instanceGraph, entity.id)) || null;
}

export function selectReusableInput({
  entities = [],
  instanceGraph,
  appliedEntityIds = [],
  visibleEntityIds = null
} = {}) {
  if (!instanceGraph || !Array.isArray(instanceGraph.instances)) {
    throw new Error('An instance graph with instances is required.');
  }

  const applied = idSet(appliedEntityIds);
  for (const entity of eligibleInputs(entities, visibleEntityIds)) {
    if (applied.has(String(entity.id))) continue;
    const instance = findInstance(instanceGraph, entity.id);
    if (instance) return { entity, instance };
  }
  return null;
}

function groupMemberOptions(entity = {}, entities = []) {
  if (entity.type !== 'ui_group') return [];
  const byId = new Map(arr(entities).map((candidate) => [candidate.id, candidate]));
  const memberIds = arr(entity.structural?.memberIds);
  return memberIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((member) => member.name || member.structural?.label)
    .filter(Boolean);
}

export function buildInputQuestion(entity = {}, entities = []) {
  if (!requiredUserInput(entity)) {
    throw new Error('A required user-input entity is required.');
  }

  const semantic = entity.semantic || {};
  const structural = entity.structural || {};
  let options = arr(structural.values).filter((value) => value !== undefined && value !== null);
  if (!options.length) options = groupMemberOptions(entity, entities);

  return {
    entityId: entity.id,
    label: semantic.question || entity.name || 'Provide a value',
    information: semantic.explanation || '',
    examples: [...arr(semantic.examples)],
    options: [...options],
    finite: options.length > 0,
    selectionRule: semantic.selectionRule || (entity.type === 'ui_group' ? structural.cardinality || 'exactlyOne' : 'exactlyOne')
  };
}

export function selectNavigationCandidates(entities = [], {
  visibleEntityIds = null,
  appliedEntityIds = []
} = {}) {
  const applied = idSet(appliedEntityIds);
  return arr(entities).filter((entity) => {
    if (entity?.type !== 'ui_control') return false;
    if (applied.has(String(entity.id || ''))) return false;
    if (!['button', 'link'].includes(String(entity.structural?.controlType || ''))) return false;
    if (!visibleAndEnabled(entity, visibleEntityIds)) return false;

    const semantic = entity.semantic || {};
    if (semantic.relevantToGoal === false) return false;
    const interaction = String(semantic.interaction || '');
    if (interaction && !['navigation', 'action'].includes(interaction)) return false;
    return true;
  });
}

export function workflowComplete({
  entities = [],
  instanceGraph,
  visibleEntityIds = null,
  appliedEntityIds = []
} = {}) {
  if (!instanceGraph || !Array.isArray(instanceGraph.instances)) {
    throw new Error('An instance graph with instances is required.');
  }

  if (selectNextRequiredInput({ entities, instanceGraph, visibleEntityIds })) return false;
  if (selectNavigationCandidates(entities, { visibleEntityIds, appliedEntityIds }).length) return false;
  return true;
}
