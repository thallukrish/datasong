import { instanceForEntity } from '../graph/instanceGraph.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? '').trim().toLowerCase(); }
function visibleAndEnabled(entity = {}) {
  const structural = entity.structural || {};
  return structural.visible !== false && structural.disabled !== true;
}

function semanticInput(entity = {}) {
  const semantic = entity.semantic || {};
  return semantic.interaction === 'user_input'
    && semantic.relevantToGoal === true
    && semantic.required === true;
}

function shadowedBySemanticGroup(entity, byId) {
  if (entity.type !== 'ui_control') return false;
  return arr(entity.links)
    .filter((link) => link.relationship === 'partOf')
    .map((link) => byId.get(link.id))
    .some((group) => group?.type === 'group' && semanticInput(group));
}

function currentValueMatches(entity = {}, value) {
  const structural = entity.structural || {};
  if (entity.type === 'group') return normalize(structural.value) === normalize(value);
  if (structural.controlType === 'checkbox') return !!structural.checked === !!value;
  if (structural.controlType === 'radio') return structural.checked === true;
  if (structural.value === null || structural.value === undefined || structural.value === '') return false;
  return normalize(structural.value) === normalize(value);
}

export function selectNextUserInput(entities = [], instances = []) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  return all.find((entity) => {
    if (!semanticInput(entity)) return false;
    if (shadowedBySemanticGroup(entity, byId)) return false;
    if (!visibleAndEnabled(entity)) return false;
    return !instanceForEntity(instances, entity.id);
  }) || null;
}

export function selectReusableUserInput(entities = [], instances = []) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  for (const entity of all) {
    if (!semanticInput(entity)) continue;
    if (shadowedBySemanticGroup(entity, byId)) continue;
    if (!visibleAndEnabled(entity)) continue;
    const instance = instanceForEntity(instances, entity.id);
    if (!instance || currentValueMatches(entity, instance.value)) continue;
    return { entity, instance };
  }
  return null;
}

export function buildEntityQuestion(entity = {}, entities = []) {
  const structural = entity.structural || {};
  const semantic = entity.semantic || {};
  let options = [...arr(structural.values)];
  if (!options.length && entity.type === 'group') {
    const byId = new Map(arr(entities).map((item) => [item.id, item]));
    options = arr(entity.links)
      .filter((link) => link.relationship === 'contains')
      .map((link) => byId.get(link.id))
      .filter(Boolean)
      .map((member) => member.name || member.structural?.value)
      .filter(Boolean);
  }
  return {
    entityId: entity.id,
    label: semantic.question || `Provide ${entity.name || 'value'}`,
    information: semantic.explanation || '',
    caveats: [...arr(semantic.caveats)],
    examples: [...arr(semantic.examples)],
    options,
    finite: options.length > 0
  };
}

export function resolveEntityAnswer(question = {}, rawAnswer = '') {
  const raw = String(rawAnswer ?? '').trim();
  if (!raw) return null;
  const options = arr(question.options);
  if (!options.length) return raw;
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < options.length) return options[index];
  }
  const normalized = raw.toLowerCase();
  const exact = options.find((option) => String(option).trim().toLowerCase() === normalized);
  return exact ?? null;
}

export function ignoredSourceEntityIds(entity = {}) {
  return [
    entity.id,
    ...arr(entity.links).filter((link) => link.relationship === 'contains').map((link) => link.id)
  ].filter(Boolean);
}

export function selectWorkflowContinuation(entities = []) {
  return arr(entities).find((entity) => {
    const semantic = entity.semantic || {};
    return visibleAndEnabled(entity)
      && semantic.relevantToGoal === true
      && semantic.workflowRole === 'continue'
      && semantic.consequence === 'reversible'
      && ['navigation', 'action'].includes(semantic.interaction);
  }) || null;
}
