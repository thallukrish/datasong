import { normalizeExternalEffect } from '../explore/behaviorSampling.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function signature(effect = {}) { return JSON.stringify(effect); }
function touch(memory) { if (memory) memory.updatedAt = new Date().toISOString(); }

export function classifyAndRecordExecutionBehavior(memory, {
  entityId = '', semanticKey = '', sourceFieldIds = [], observedValue = '', delta = {}
} = {}) {
  const entity = memory?.entities?.[entityId];
  if (!entity) throw new Error(`Cannot record execution behavior for unknown entity ${entityId}`);
  if (!semanticKey) throw new Error('semanticKey is required for execution behavior');

  const effect = normalizeExternalEffect(delta, { sourceFieldIds });
  const effectSignature = signature(effect);
  entity.executionBehaviors ||= {};
  const classes = entity.executionBehaviors[semanticKey] ||= [];
  let behaviorClass = classes.find((item) => item.effectSignature === effectSignature) || null;
  const novel = !behaviorClass;

  if (!behaviorClass) {
    behaviorClass = {
      id: `behavior:${semanticKey}:${classes.length + 1}`,
      semanticKey,
      sourceFieldIds: [...new Set(arr(sourceFieldIds).map(String).filter(Boolean))],
      effect,
      effectSignature,
      observedValues: [],
      observations: 0,
      firstObservedAt: new Date().toISOString(),
      lastObservedAt: ''
    };
    classes.push(behaviorClass);
  }

  const value = String(observedValue ?? '');
  if (value && !behaviorClass.observedValues.includes(value)) behaviorClass.observedValues.push(value);
  behaviorClass.observations += 1;
  behaviorClass.lastObservedAt = new Date().toISOString();
  touch(memory);

  return {
    novel,
    classId: behaviorClass.id,
    effect,
    behaviorClass
  };
}

export function executionBehaviorClasses(memory, entityId, semanticKey) {
  return arr(memory?.entities?.[entityId]?.executionBehaviors?.[semanticKey]);
}
