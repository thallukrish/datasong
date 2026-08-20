import crypto from 'node:crypto';

const arr = (v) => Array.isArray(v) ? v : [];
const clean = (v = '', max = 800) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(n || 0)));

export const EVIDENCE_STRENGTH = Object.freeze({
  schema_definition: 0.99,
  schema_relationship: 0.97,
  executable_code: 0.90,
  call_path: 0.88,
  test_evidence: 0.82,
  code_shape: 0.78,
  service_contract: 0.78,
  sql_projection: 0.76,
  documentation: 0.64,
  conversation: 0.56,
  llm_interpretation: 0.52,
  llm_inference: 0.35
});

export function semanticId(type, name, scope = '') {
  const raw = `${clean(type, 80)}|${clean(scope, 300)}|${clean(name, 500)}`;
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
  return `${clean(type, 80)}:${hash}`;
}

function evidenceKey(e) {
  return [e.sourceType, e.source, e.assertion, e.property, e.value].map((v) => clean(v, 500)).join('|');
}

export function aggregateConfidence(evidence = []) {
  let residual = 1;
  for (const item of arr(evidence)) residual *= (1 - clamp(item?.strength));
  return clamp(1 - residual);
}

export class SemanticEvidenceStore {
  constructor(state) {
    this.state = state;
    if (!this.state.semanticObjects || typeof this.state.semanticObjects !== 'object') this.state.semanticObjects = {};
  }

  ensure({ id, type, name, scope = '', properties = {} }) {
    const objectId = id || semanticId(type, name, scope);
    const existing = this.state.semanticObjects[objectId] || {
      id: objectId,
      type: clean(type, 80),
      name: clean(name, 500),
      scope: clean(scope, 500),
      properties: {},
      evidence: [],
      confidence: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    existing.properties = { ...existing.properties, ...properties };
    existing.updatedAt = new Date().toISOString();
    this.state.semanticObjects[objectId] = existing;
    return existing;
  }

  addEvidence(objectOrId, evidence = {}) {
    const object = typeof objectOrId === 'string' ? this.state.semanticObjects[objectOrId] : objectOrId;
    if (!object) return null;
    const sourceType = clean(evidence.sourceType || 'llm_inference', 120);
    const item = {
      sourceType,
      source: clean(evidence.source, 700),
      strength: clamp(evidence.strength ?? EVIDENCE_STRENGTH[sourceType] ?? 0.4),
      assertion: clean(evidence.assertion, 900),
      property: clean(evidence.property, 180),
      value: clean(evidence.value, 900),
      observedAt: evidence.observedAt || new Date().toISOString(),
      provenance: evidence.provenance || null
    };
    const key = evidenceKey(item);
    if (!arr(object.evidence).some((e) => evidenceKey(e) === key)) object.evidence.push(item);
    object.confidence = aggregateConfidence(object.evidence);
    object.updatedAt = new Date().toISOString();
    return item;
  }

  link(fromObject, relation, toObject, evidence = {}, properties = {}) {
    if (!fromObject || !toObject) return null;
    const name = `${fromObject.name} ${clean(relation, 180)} ${toObject.name}`;
    const rel = this.ensure({
      type: 'relation',
      name,
      scope: `${fromObject.id}|${toObject.id}`,
      properties: { fromId: fromObject.id, toId: toObject.id, relation: clean(relation, 180), ...properties }
    });
    this.addEvidence(rel, evidence);
    return rel;
  }
}
