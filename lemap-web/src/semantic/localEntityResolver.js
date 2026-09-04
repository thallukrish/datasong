import { callJsonModel } from './modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 800) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function integer(value, fallback = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function compactWorkflowContext(context = {}) {
  return {
    goal: text(context.goal, 220),
    previousSemanticEntity: text(context.previousSemanticEntity, 180),
    recentSemanticPath: arr(context.recentSemanticPath).slice(-4).map((item) => text(item, 180)),
    recentSelections: arr(context.recentSelections).slice(-6).map((item) => text(item, 180))
  };
}

function compactHierarchy(node = {}, depth = 0) {
  if (!node || depth > 6) return null;
  return {
    label: text(node.label, 180),
    fieldIds: arr(node.fieldIds).map(String).filter(Boolean).slice(0, 80),
    regions: arr(node.regions).slice(0, 30).map((region) => compactHierarchy(region, depth + 1)).filter(Boolean)
  };
}

function compactExplorationEvidence(observations = [], learnedRelationships = []) {
  const relationships = arr(learnedRelationships);
  const behaviorClasses = relationships.filter((relationship) => relationship?.kind === 'behavior_classes');
  const coveredFieldIds = new Set(behaviorClasses.flatMap((relationship) => [
    relationship?.sourceFieldId,
    ...arr(relationship?.memberFieldIds)
  ]).map(String).filter(Boolean));

  const compactObservations = arr(observations).filter((observation) => {
    if (!coveredFieldIds.has(String(observation?.fieldId || ''))) return true;
    return observation?.action?.purpose === 'representative-combination';
  });
  const compactRelationships = relationships.filter((relationship) => !(
    relationship?.kind === 'action_effect'
    && coveredFieldIds.has(String(relationship?.sourceFieldId || ''))
  ));

  return {
    observations: compactObservations.slice(0, 80),
    learnedRelationships: compactRelationships.slice(0, 120)
  };
}

const SYSTEM = `You are DataSong LeMap-Web's LOCAL ENTITY SEMANTIC RESOLVER.
You receive deterministic structural evidence for one rendered browser context: fields, groups, actions, hierarchy, current state, observed execution effects and learned structural relationships, plus a compact workflow arc and the original user goal.
A rendered browser context may contain one business entity or several related/nested entities. Browser/page boundaries are presentation evidence only.
Browser mechanics and observed behavior are deterministic evidence. Interpret their business/user meaning; never invent browser behavior.
For a newly seen context, identify where goal-relevant user interaction should begin. Use element type, labels, available option/domain evidence, current enabled state and hierarchy to return an ordered semantic interaction plan. Do not simply mirror DOM order.
For each user-input concept, give reusable explanation/question/examples, generic value scope/reuse policy, goal relevance, requiredness, dependencies and priority. Classify application-wide/global controls separately from local workflow inputs when the evidence supports it.
For each action, classify whether it is a local entity action, branch action, workflow continuation/reverse, global navigation or unknown. Consequence/safety is decided by the navigation scout, not here.
You may propose a behavior generalization hypothesis for finite-choice interactions, such as likely same external effect across the option domain. This is only a semantic prior. Real execution is authoritative and can falsify it.
When execution evidence reveals new nested regions, overlays, fields or entities, interpret the resulting entity/sub-entity relationships and preserve the triggering semantic interaction / behavior-class evidence when supplied.
These semantics describe HOW the application concept works and how to ask about it; they must never contain or infer a particular user's private value.
Return strict compact JSON only.`;

export function buildLocalEntityPrompt({ entityGraph = {}, observations = [], learnedRelationships = [], workflowContext = {} } = {}) {
  const evidence = compactExplorationEvidence(observations, learnedRelationships);
  const payload = {
    workflowArc: compactWorkflowContext(workflowContext),
    entity: entityGraph.entity || {},
    hierarchy: compactHierarchy(entityGraph.hierarchy || {}),
    fields: arr(entityGraph.fields).map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      groupId: field.parentGroupId || '',
      enabled: !!field.visible && !field.disabled,
      visible: !!field.visible,
      required: !!field.required,
      checked: typeof field.checked === 'boolean' ? field.checked : null,
      hasValue: field.value !== null && field.value !== undefined && String(field.value).trim() !== '',
      valueDomain: arr(field.valueDomain).slice(0, 40)
    })),
    actions: arr(entityGraph.actions).map((action) => ({
      id: action.id,
      label: action.label,
      type: action.type,
      enabled: !!action.visible && !action.disabled
    })),
    groups: arr(entityGraph.groups).map((group) => ({
      id: group.id,
      label: group.label,
      groupType: group.groupType,
      memberFieldIds: group.memberFieldIds
    })),
    observations: evidence.observations,
    learnedRelationships: evidence.learnedRelationships
  };
  return `MODE web-local-entity-v2\nLOCAL STRUCTURAL ENTITY EVIDENCE:\n${JSON.stringify(payload)}\n\nTASK:\nInterpret only the supplied deterministic evidence. Identify coherent semantic entities/sub-entities and relationships. Decide which user-facing controls are relevant to the ORIGINAL GOAL and where user interaction should begin. Return an ordered interaction plan rather than DOM order. Disabled controls may still be meaningful but should depend on the interaction(s) likely to make them available. For every coherent user-input concept return one interaction entry covering its structural fields. Explain domain jargon only when supported by evidence/context. For finite choices, behaviorHypothesis may propose same_effect_across_domain, value_specific or unknown with a confidence score; this is a hypothesis, not proof. Return JSON with semanticName, description, subEntities:[{semanticName,description,structuralFieldIds,relationshipToParent}], fields:[{structuralFieldId,semanticName,description}], relationships:[{kind,description,evidenceIds,triggerSemanticKey,behaviorClassId}], actions:[{structuralFieldId,semanticName,description,role}], interactions:[{semanticKey,semanticName,structuralFieldIds,explanation,question,examples,valueScope,reusePolicy,confirmationQuestion,goalRelevance,priority,requiredForGoal,dependsOnSemanticKeys,behaviorHypothesis:{mode,confidence,description}}], completionInteraction:{confirmationIntro,confirmationQuestion,changeQuestion}, localCompletion, confidence. valueScope must be application|actor|workflow|workflow_instance. reusePolicy must be always|same_scope|confirm|never. action role must be local_entity_action|branch_action|workflow_continuation|workflow_reverse|global_navigation|unknown.`;
}

export function normalizeLocalEntityResponse(raw = {}) {
  const validScopes = new Set(['application', 'actor', 'workflow', 'workflow_instance']);
  const validReuse = new Set(['always', 'same_scope', 'confirm', 'never']);
  const validActionRoles = new Set(['local_entity_action', 'branch_action', 'workflow_continuation', 'workflow_reverse', 'global_navigation', 'unknown']);
  const validBehaviorModes = new Set(['same_effect_across_domain', 'value_specific', 'unknown']);
  return {
    semanticName: text(raw.semanticName, 180),
    description: text(raw.description, 600),
    subEntities: arr(raw.subEntities).map((entity) => ({
      semanticName: text(entity?.semanticName, 180),
      description: text(entity?.description, 520),
      structuralFieldIds: [...new Set(arr(entity?.structuralFieldIds).map(String).filter(Boolean))],
      relationshipToParent: text(entity?.relationshipToParent, 260)
    })).filter((entity) => entity.semanticName || entity.structuralFieldIds.length),
    fields: arr(raw.fields).map((field) => ({
      structuralFieldId: text(field?.structuralFieldId, 180),
      semanticName: text(field?.semanticName, 180),
      description: text(field?.description, 420)
    })).filter((field) => field.structuralFieldId || field.semanticName),
    relationships: arr(raw.relationships).map((relationship) => ({
      kind: text(relationship?.kind, 120),
      description: text(relationship?.description, 520),
      evidenceIds: [...new Set(arr(relationship?.evidenceIds).map(String).filter(Boolean))],
      triggerSemanticKey: text(relationship?.triggerSemanticKey, 180),
      behaviorClassId: text(relationship?.behaviorClassId, 180)
    })).filter((relationship) => relationship.kind || relationship.description),
    actions: arr(raw.actions).map((action) => ({
      structuralFieldId: text(action?.structuralFieldId, 180),
      semanticName: text(action?.semanticName, 180),
      description: text(action?.description, 420),
      role: validActionRoles.has(action?.role) ? action.role : 'unknown'
    })).filter((action) => action.structuralFieldId || action.semanticName),
    interactions: arr(raw.interactions).map((interaction, index) => ({
      semanticKey: text(interaction?.semanticKey || interaction?.semanticName || `interaction-${index + 1}`, 180).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      semanticName: text(interaction?.semanticName, 180),
      structuralFieldIds: [...new Set(arr(interaction?.structuralFieldIds).map(String).filter(Boolean))],
      explanation: text(interaction?.explanation, 520),
      question: text(interaction?.question, 360),
      examples: arr(interaction?.examples).slice(0, 5).map((item) => text(item, 180)).filter(Boolean),
      valueScope: validScopes.has(interaction?.valueScope) ? interaction.valueScope : 'workflow_instance',
      reusePolicy: validReuse.has(interaction?.reusePolicy) ? interaction.reusePolicy : 'never',
      confirmationQuestion: text(interaction?.confirmationQuestion, 300),
      goalRelevance: interaction?.goalRelevance === undefined ? 0.5 : clamp01(interaction.goalRelevance),
      priority: integer(interaction?.priority, 100),
      requiredForGoal: interaction?.requiredForGoal !== false,
      dependsOnSemanticKeys: [...new Set(arr(interaction?.dependsOnSemanticKeys).map((item) => text(item, 180).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))],
      behaviorHypothesis: {
        mode: validBehaviorModes.has(interaction?.behaviorHypothesis?.mode) ? interaction.behaviorHypothesis.mode : 'unknown',
        confidence: clamp01(interaction?.behaviorHypothesis?.confidence),
        description: text(interaction?.behaviorHypothesis?.description, 420)
      }
    })).filter((interaction) => interaction.structuralFieldIds.length && interaction.question),
    completionInteraction: {
      confirmationIntro: text(raw.completionInteraction?.confirmationIntro, 320),
      confirmationQuestion: text(raw.completionInteraction?.confirmationQuestion, 320),
      changeQuestion: text(raw.completionInteraction?.changeQuestion, 260)
    },
    localCompletion: text(raw.localCompletion, 520),
    confidence: clamp01(raw.confidence)
  };
}

export function expandInteractionBindings(semanticEntity = {}, entityGraph = {}) {
  const groups = arr(entityGraph.groups).filter((group) => ['radio', 'checkbox'].includes(String(group?.groupType || '')));
  return {
    ...semanticEntity,
    interactions: arr(semanticEntity.interactions).map((interaction) => {
      const ids = new Set(arr(interaction.structuralFieldIds).map(String));
      for (const group of groups) {
        const members = arr(group.memberFieldIds).map(String);
        if (members.some((fieldId) => ids.has(fieldId))) members.forEach((fieldId) => ids.add(fieldId));
      }
      return { ...interaction, structuralFieldIds: [...ids] };
    })
  };
}

export async function resolveLocalEntity({ client, model, entityGraph, observations = [], learnedRelationships = [], workflowContext = {} } = {}) {
  const userPrompt = buildLocalEntityPrompt({ entityGraph, observations, learnedRelationships, workflowContext });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return expandInteractionBindings(normalizeLocalEntityResponse(response.parsed), entityGraph);
}
