function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 600) { const s = String(value || '').trim().replace(/\s+/g, ' '); return s.length > max ? `${s.slice(0, max)}…` : s; }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

export const PASS1_SYSTEM = `You are DataSong LeMap-Web PASS 1.
You receive a bounded deterministic STRUCTURAL WORKFLOW path over a shared entity graph.
Interpret business intent and broad workflow stages only from supplied evidence.
Do not infer browser mechanics, repository code, database schemas or facts not evidenced here.
Return strict compact JSON only.`;

export function buildPass1Prompt({ workflowPath = {}, workflowGraph = {}, entities = {} } = {}) {
  const entityEvidence = arr(workflowPath.entityIds).map((id) => entities[id]).filter(Boolean).map((entity) => ({
    id: entity.id,
    label: entity.label,
    fields: arr(entity.fields).map((field) => ({ id: field.id, label: field.label, type: field.type }))
  }));
  return `MODE web-pass1-v1\nSTRUCTURAL WORKFLOW:\n${JSON.stringify({ workflowId: workflowGraph.id || '', pathId: workflowPath.id || '', edges: arr(workflowPath.edges), entities: entityEvidence }, null, 2)}\n\nReturn JSON:\n{\n  "title":"",\n  "businessActor":"",\n  "businessIntent":"",\n  "majorStages":[],\n  "branchMeanings":[{"edgeId":"","meaning":"","evidenceIds":[]}],\n  "completionCondition":"",\n  "outcome":"",\n  "confidence":0,\n  "evidenceIds":[]\n}`;
}

export function normalizePass1Response(raw = {}) {
  return {
    title: text(raw.title, 180),
    businessActor: text(raw.businessActor, 180),
    businessIntent: text(raw.businessIntent, 320),
    majorStages: arr(raw.majorStages).map((item) => text(item, 240)).filter(Boolean),
    branchMeanings: arr(raw.branchMeanings).map((item) => ({ edgeId: text(item?.edgeId, 160), meaning: text(item?.meaning, 360), evidenceIds: [...new Set(arr(item?.evidenceIds).map(String).filter(Boolean))] })).filter((item) => item.edgeId || item.meaning),
    completionCondition: text(raw.completionCondition, 320),
    outcome: text(raw.outcome, 320),
    confidence: clamp01(raw.confidence),
    evidenceIds: [...new Set(arr(raw.evidenceIds).map(String).filter(Boolean))]
  };
}
