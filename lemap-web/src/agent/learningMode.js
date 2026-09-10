import { instanceForEntity } from '../graph/instanceGraph.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function semanticInput(entity = {}) {
  const semantic = entity.semantic || {};
  return ['ui_control', 'group'].includes(entity.type)
    && semantic.interaction === 'user_input'
    && semantic.relevantToGoal === true
    && semantic.required === true
    && entity.structural?.visible !== false
    && entity.structural?.disabled !== true;
}

export function learningConfigFromEnv(env = {}) {
  const mode = String(env.LEMAP_MODE || 'run').trim().toLowerCase() === 'learn' ? 'learn' : 'run';
  const enabled = mode === 'learn';
  const step = enabled ? String(env.LEMAP_LEARN_STEP ?? '1').trim() !== '0' : false;
  return { mode, enabled, step };
}

export function learningCandidates(entities = [], instances = []) {
  return arr(entities).filter((entity) => semanticInput(entity) && !instanceForEntity(instances, entity.id));
}

export function proposalForEntity(result = {}, entityId = '') {
  const item = arr(result.entities).find((entity) => entity?.id === entityId);
  if (item?.learningAnswer === undefined || item?.learningAnswer === null || item?.learningAnswer === '') return null;
  return String(item.learningAnswer);
}

export function newValidationMessages(before = {}, after = {}) {
  const beforeMessages = new Set(arr(before?.explored?.snapshot?.validations).map(String));
  return arr(after?.explored?.snapshot?.validations).map(String).filter((message) => !beforeMessages.has(message));
}
