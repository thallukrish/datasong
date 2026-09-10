import { instanceForEntity } from '../graph/instanceGraph.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? '').trim().toLowerCase(); }
function visibleAndEnabled(entity = {}) {
  const structural = entity.structural || {};
  return structural.visible !== false && structural.disabled !== true;
}

function semanticInput(entity = {}) {
  if (!['ui_control', 'group'].includes(entity.type)) return false;
  const semantic = entity.semantic || {};
  return semantic.interaction === 'user_input'
    && semantic.relevantToGoal === true
    && semantic.required === true;
}

function groupedChoiceMember(entity, byId) {
  if (entity.type !== 'ui_control') return false;
  return arr(entity.links)
    .filter((link) => link.relationship === 'partOf')
    .map((link) => byId.get(link.id))
    .some((group) => group?.type === 'group');
}

function normalizedSet(value) {
  return new Set(arr(value).map(normalize));
}

function currentValueMatches(entity = {}, value) {
  const structural = entity.structural || {};
  if (entity.type === 'group' && structural.groupType === 'checkbox') {
    const current = normalizedSet(structural.value);
    const wanted = normalizedSet(value);
    return current.size === wanted.size && [...current].every((item) => wanted.has(item));
  }
  if (entity.type === 'group' && structural.groupType === 'choice') return false;
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
    if (groupedChoiceMember(entity, byId)) return false;
    if (!visibleAndEnabled(entity)) return false;
    return !instanceForEntity(instances, entity.id);
  }) || null;
}

export function selectReusableUserInput(entities = [], instances = [], skipEntityIds = new Set()) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  const skipped = skipEntityIds instanceof Set ? skipEntityIds : new Set(arr(skipEntityIds).map(String));
  for (const entity of all) {
    if (skipped.has(entity.id)) continue;
    if (!semanticInput(entity)) continue;
    if (groupedChoiceMember(entity, byId)) continue;
    if (!visibleAndEnabled(entity)) continue;
    const instance = instanceForEntity(instances, entity.id);
    if (!instance || currentValueMatches(entity, instance.value)) continue;
    return { entity, instance };
  }
  return null;
}

function selectionRuleFor(entity = {}) {
  if (entity.type !== 'group') return 'exactlyOne';
  if (entity.semantic?.selectionRule) return entity.semantic.selectionRule;
  if (entity.structural?.cardinality) return entity.structural.cardinality;
  if (entity.structural?.groupType === 'radio' || entity.structural?.groupType === 'choice') return 'exactlyOne';
  if (entity.structural?.groupType === 'checkbox') return 'zeroOrMore';
  return 'exactlyOne';
}

function instructionForSelectionRule(rule = 'exactlyOne') {
  if (rule === 'exactlyOne') return 'Choose one.';
  if (rule === 'atLeastOne') return 'Choose one or more (comma-separated).';
  if (rule === 'allOf') return 'Select all options.';
  return 'Choose any that apply (comma-separated), or none.';
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
  const selectionRule = selectionRuleFor(entity);
  const multiple = entity.type === 'group' && selectionRule !== 'exactlyOne';
  return {
    entityId: entity.id,
    label: semantic.question || entity.name || `Provide ${entity.name || 'value'}`,
    information: semantic.explanation || '',
    caveats: [...arr(semantic.caveats)],
    examples: [...arr(semantic.examples)],
    options,
    finite: options.length > 0,
    selectionRule,
    multiple,
    instruction: entity.type === 'group' ? instructionForSelectionRule(selectionRule) : ''
  };
}

function resolveOneOption(options = [], token = '') {
  const raw = String(token ?? '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < options.length) return options[index];
  }
  const wanted = normalize(raw);
  return options.find((option) => normalize(option) === wanted) ?? null;
}

export function resolveEntityAnswer(question = {}, rawAnswer = '') {
  const raw = String(rawAnswer ?? '').trim();
  if (!raw) return null;
  const options = arr(question.options);
  if (!options.length) return raw;

  if (!question.multiple) return resolveOneOption(options, raw);

  const rule = question.selectionRule || 'zeroOrMore';
  if (/^(none|no|nothing)$/i.test(raw)) return rule === 'zeroOrMore' || rule === 'anyOf' ? [] : null;
  if (/^all$/i.test(raw)) return [...options];

  const tokens = raw.split(',').map((item) => item.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const selected = [];
  for (const token of tokens) {
    const option = resolveOneOption(options, token);
    if (!option) return null;
    if (!selected.includes(option)) selected.push(option);
  }
  if (rule === 'atLeastOne' && selected.length < 1) return null;
  if (rule === 'allOf' && selected.length !== options.length) return null;
  return selected;
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
    return entity.type === 'ui_control'
      && visibleAndEnabled(entity)
      && semantic.relevantToGoal === true
      && semantic.workflowRole === 'continue'
      && semantic.consequence === 'reversible'
      && ['navigation', 'action'].includes(semantic.interaction);
  }) || null;
}
