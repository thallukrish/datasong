function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) { const s = String(value || '').trim().replace(/\s+/g, ' '); return s.length > max ? `${s.slice(0, max)}…` : s; }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

export const PASS2_SYSTEM = `You are DataSong LeMap-Web PASS 2 WHOLE-FLOW INTERPRETER.
Pass 1 has already identified the broad business workflow.
You receive the WHOLE STRUCTURAL FLOW for one bounded branch plus the touched shared-entity subgraph and deterministic state-transition evidence.
Interpret entity meanings, relationships, workflow-step semantics and business rules only from supplied evidence.
Do not request repository traversal or invent backend/database semantics.
Return strict compact JSON only.`;

export function buildPass2Prompt({ pass1 = {}, workflowPath = {}, workflowGraph = {}, entities = {} } = {}) {
  const entityEvidence = arr(workflowPath.entityIds).map((id) => entities[id]).filter(Boolean);
  return `MODE web-pass2-whole-flow-v1\nPASS 1:\n${JSON.stringify(pass1, null, 2)}\n\nWHOLE STRUCTURAL FLOW:\n${JSON.stringify({ workflowId: workflowGraph.id || '', pathId: workflowPath.id || '', edges: arr(workflowPath.edges), entities: entityEvidence }, null, 2)}\n\nReturn JSON:\n{\n  "entities":[{"structuralEntityId":"","semanticName":"","description":"","fields":[{"fieldId":"","semanticName":"","description":""}],"evidenceIds":[]}],\n  "relationships":[{"fromEntityId":"","toEntityId":"","relation":"","description":"","evidenceIds":[]}],\n  "rules":[{"description":"","entityIds":[],"fieldIds":[],"evidenceIds":[]}],\n  "steps":[{"title":"","description":"","entityIds":[],"edgeIds":[],"evidenceIds":[]}],\n  "unresolvedBranches":[{"edgeId":"","reason":""}],\n  "confidence":0\n}`;
}

export function normalizePass2Response(raw = {}) {
  return {
    entities: arr(raw.entities).map((item) => ({
      structuralEntityId: text(item?.structuralEntityId, 180),
      semanticName: text(item?.semanticName, 180),
      description: text(item?.description, 520),
      fields: arr(item?.fields).map((field) => ({ fieldId: text(field?.fieldId, 180), semanticName: text(field?.semanticName, 180), description: text(field?.description, 420) })).filter((field) => field.fieldId || field.semanticName),
      evidenceIds: [...new Set(arr(item?.evidenceIds).map(String).filter(Boolean))]
    })).filter((item) => item.structuralEntityId || item.semanticName),
    relationships: arr(raw.relationships).map((item) => ({
      fromEntityId: text(item?.fromEntityId, 180), toEntityId: text(item?.toEntityId, 180), relation: text(item?.relation, 160),
      description: text(item?.description, 520), evidenceIds: [...new Set(arr(item?.evidenceIds).map(String).filter(Boolean))]
    })).filter((item) => item.fromEntityId && item.toEntityId),
    rules: arr(raw.rules).map((item) => ({ description: text(item?.description, 520), entityIds: [...new Set(arr(item?.entityIds).map(String).filter(Boolean))], fieldIds: [...new Set(arr(item?.fieldIds).map(String).filter(Boolean))], evidenceIds: [...new Set(arr(item?.evidenceIds).map(String).filter(Boolean))] })).filter((item) => item.description),
    steps: arr(raw.steps).map((item) => ({ title: text(item?.title, 220), description: text(item?.description, 520), entityIds: [...new Set(arr(item?.entityIds).map(String).filter(Boolean))], edgeIds: [...new Set(arr(item?.edgeIds).map(String).filter(Boolean))], evidenceIds: [...new Set(arr(item?.evidenceIds).map(String).filter(Boolean))] })).filter((item) => item.title || item.description),
    unresolvedBranches: arr(raw.unresolvedBranches).map((item) => ({ edgeId: text(item?.edgeId, 180), reason: text(item?.reason, 420) })).filter((item) => item.edgeId),
    confidence: clamp01(raw.confidence)
  };
}
