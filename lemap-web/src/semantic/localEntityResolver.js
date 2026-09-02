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

const SYSTEM = `You are DataSong LeMap-Web's LOCAL ENTITY SEMANTIC RESOLVER.
You receive deterministic structural evidence for one locally explored browser entity: fields, groups, actions, observed input→state effects and learned structural relationships.
Do not rediscover browser mechanics. Do not invent behavior not present in evidence.
Name and describe the business/user-level entity, fields, relationships and actions that the evidence supports.
Return strict compact JSON only.`;

export function buildLocalEntityPrompt({ entityGraph = {}, observations = [], learnedRelationships = [] } = {}) {
  const payload = {
    entity: entityGraph.entity || {},
    fields: arr(entityGraph.fields).map((field) => ({ id: field.id, label: field.label, type: field.type, groupId: field.parentGroupId || '' })),
    actions: arr(entityGraph.actions).map((action) => ({ id: action.id, label: action.label, type: action.type })),
    groups: arr(entityGraph.groups).map((group) => ({ id: group.id, label: group.label, groupType: group.groupType, memberFieldIds: group.memberFieldIds })),
    observations,
    learnedRelationships
  };
  return `MODE web-local-entity-v1\nLOCAL STRUCTURAL ENTITY EVIDENCE:\n${JSON.stringify(payload)}\n\nTASK:\nInterpret only the supplied deterministic evidence. Do not infer browser mechanics; those are already established. Return JSON with semanticName, description, fields:[{structuralFieldId,semanticName,description}], relationships:[{kind,description,evidenceIds}], actions:[{structuralFieldId,semanticName,description}], localCompletion, confidence.`;
}

export function normalizeLocalEntityResponse(raw = {}) {
  return {
    semanticName: text(raw.semanticName, 180),
    description: text(raw.description, 600),
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
    localCompletion: text(raw.localCompletion, 520),
    confidence: clamp01(raw.confidence)
  };
}

export async function resolveLocalEntity({ client, model, entityGraph, observations = [], learnedRelationships = [] } = {}) {
  const userPrompt = buildLocalEntityPrompt({ entityGraph, observations, learnedRelationships });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeLocalEntityResponse(response.parsed);
}
