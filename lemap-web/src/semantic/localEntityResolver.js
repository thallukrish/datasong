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
function compactWorkflowContext(context = {}) {
  return {
    goal: text(context.goal, 220),
    previousSemanticEntity: text(context.previousSemanticEntity, 180),
    recentSemanticPath: arr(context.recentSemanticPath).slice(-4).map((item) => text(item, 180)),
    recentSelections: arr(context.recentSelections).slice(-6).map((item) => text(item, 180))
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
You receive deterministic structural evidence for one locally explored browser context: fields, groups, actions, observed input→state effects and learned structural relationships, plus a compact semantic workflow arc.
A rendered browser context may contain one business entity or several related business entities. Browser/page boundaries are presentation evidence only.
Browser mechanics and observed behavior are already established by deterministic evidence. Interpret only their business/user meaning and do not invent unsupported behavior.
Finite-choice behavior may be supplied as behavior_classes. coverage.exhaustive=true means the represented domain was exhaustively probed; coverage.exhaustive=false means the classes come from bounded samples and are explicitly non-exhaustive. Never generalize sampled classes into proven universal behavior.
Name and describe the semantic entities, fields, relationships and actions. For user-input entities, also learn reusable interaction semantics: a concise explanation, a friendly question, useful examples, value reuse scope/policy, and confirmation wording. These interaction semantics describe HOW to ask about the application concept; they must never contain or infer a particular user's value.
Return strict compact JSON only.`;

export function buildLocalEntityPrompt({ entityGraph = {}, observations = [], learnedRelationships = [], workflowContext = {} } = {}) {
  const evidence = compactExplorationEvidence(observations, learnedRelationships);
  const payload = {
    workflowArc: compactWorkflowContext(workflowContext),
    entity: entityGraph.entity || {},
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
      valueDomain: arr(field.valueDomain)
    })),
    actions: arr(entityGraph.actions).map((action) => ({ id: action.id, label: action.label, type: action.type, enabled: !!action.visible && !action.disabled })),
    groups: arr(entityGraph.groups).map((group) => ({ id: group.id, label: group.label, groupType: group.groupType, memberFieldIds: group.memberFieldIds })),
    observations: evidence.observations,
    learnedRelationships: evidence.learnedRelationships
  };
  return `MODE web-local-entity-v1\nLOCAL STRUCTURAL ENTITY EVIDENCE:\n${JSON.stringify(payload)}\n\nTASK:\nInterpret only the supplied deterministic evidence. Browser mechanics are already established. Identify coherent semantic entities/sub-entities and their relationships. For every coherent user-input concept, return one reusable interaction entry covering the structural field(s). Keep explanations/questions concise and understandable to a normal user, explaining domain jargon when the evidence supports it. Treat sampled behavior classes as illustrative/non-exhaustive when coverage.exhaustive=false. Do not invent legal/business meaning beyond the supplied evidence/workflow arc. Return JSON with semanticName, description, subEntities:[{semanticName,description,structuralFieldIds,relationshipToParent}], fields:[{structuralFieldId,semanticName,description}], relationships:[{kind,description,evidenceIds}], actions:[{structuralFieldId,semanticName,description}], interactions:[{semanticKey,semanticName,structuralFieldIds,explanation,question,examples,valueScope,reusePolicy,confirmationQuestion}], completionInteraction:{confirmationIntro,confirmationQuestion,changeQuestion}, localCompletion, confidence. valueScope must be global|taxpayer|workflow|assessment_year|filing_instance. reusePolicy must be always|same_scope|confirm|never.`;
}

export function normalizeLocalEntityResponse(raw = {}) {
  const validScopes = new Set(['global', 'taxpayer', 'workflow', 'assessment_year', 'filing_instance']);
  const validReuse = new Set(['always', 'same_scope', 'confirm', 'never']);
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
      evidenceIds: [...new Set(arr(relationship?.evidenceIds).map(String).filter(Boolean))]
    })).filter((relationship) => relationship.kind || relationship.description),
    actions: arr(raw.actions).map((action) => ({
      structuralFieldId: text(action?.structuralFieldId, 180),
      semanticName: text(action?.semanticName, 180),
      description: text(action?.description, 420)
    })).filter((action) => action.structuralFieldId || action.semanticName),
    interactions: arr(raw.interactions).map((interaction, index) => ({
      semanticKey: text(interaction?.semanticKey || interaction?.semanticName || `interaction-${index + 1}`, 180).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      semanticName: text(interaction?.semanticName, 180),
      structuralFieldIds: [...new Set(arr(interaction?.structuralFieldIds).map(String).filter(Boolean))],
      explanation: text(interaction?.explanation, 520),
      question: text(interaction?.question, 360),
      examples: arr(interaction?.examples).slice(0, 5).map((item) => text(item, 180)).filter(Boolean),
      valueScope: validScopes.has(interaction?.valueScope) ? interaction.valueScope : 'filing_instance',
      reusePolicy: validReuse.has(interaction?.reusePolicy) ? interaction.reusePolicy : 'never',
      confirmationQuestion: text(interaction?.confirmationQuestion, 300)
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
