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

// Semantic identity is deliberately stricter than display text. Casing,
// whitespace and punctuation variants should converge on one object, while
// genuinely different names (Order vs OrderHeader) remain distinct.
export function semanticIdentityKey(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function canonicalScope(scope = '') {
  const s = clean(scope, 500);
  // Scope may itself be a semantic object id. Preserve those separators; for
  // ordinary human labels normalize like a semantic identity token.
  if (/^[a-z_]+:[0-9a-f]{8,}$/i.test(s)) return s.toLowerCase();
  if (s.includes('|') && s.split('|').every((part) => /^[a-z_]+:[0-9a-f]{8,}$/i.test(part))) {
    return s.split('|').map((part) => part.toLowerCase()).join('|');
  }
  return semanticIdentityKey(s);
}

export function semanticId(type, name, scope = '') {
  const canonicalType = semanticIdentityKey(type);
  const raw = `${canonicalType}|${canonicalScope(scope)}|${semanticIdentityKey(name)}`;
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
  return `${canonicalType || 'object'}:${hash}`;
}

function evidenceKey(e) {
  return [e.sourceType, e.source, e.assertion, e.property, e.value].map((v) => clean(v, 500)).join('|');
}

function equivalentKey(type, name, scope = '') {
  return `${semanticIdentityKey(type)}|${canonicalScope(scope)}|${semanticIdentityKey(name)}`;
}

export function aggregateConfidence(evidence = []) {
  let residual = 1;
  for (const item of arr(evidence)) residual *= (1 - clamp(item?.strength));
  return clamp(1 - residual);
}

function mergeObjects(target, incoming) {
  target.properties = { ...(target.properties || {}), ...(incoming.properties || {}) };
  target.aliases = [...new Set([...(target.aliases || []), incoming.name, ...(incoming.aliases || [])].filter(Boolean))];
  for (const evidence of arr(incoming.evidence)) {
    if (!arr(target.evidence).some((e) => evidenceKey(e) === evidenceKey(evidence))) target.evidence.push(evidence);
  }
  target.confidence = aggregateConfidence(target.evidence);
  target.updatedAt = new Date().toISOString();
  return target;
}

export class SemanticEvidenceStore {
  constructor(state) {
    this.state = state;
    if (!this.state.semanticObjects || typeof this.state.semanticObjects !== 'object') this.state.semanticObjects = {};
    this.equivalentByKey = new Map();
    for (const object of Object.values(this.state.semanticObjects)) {
      if (!object?.id) continue;
      this.equivalentByKey.set(equivalentKey(object.type, object.name, object.scope), object);
    }
  }

  findEquivalent(type, name, scope = '') {
    return this.equivalentByKey.get(equivalentKey(type, name, scope)) || null;
  }

  ensure({ id, type, name, scope = '', properties = {} }) {
    const objectId = id || semanticId(type, name, scope);
    let existing = this.state.semanticObjects[objectId] || this.findEquivalent(type, name, scope);

    if (existing && existing.id !== objectId && !id) {
      delete this.state.semanticObjects[existing.id];
      existing.id = objectId;
    }

    if (!existing) {
      existing = {
        id: objectId,
        type: clean(type, 80),
        name: clean(name, 500),
        aliases: [],
        scope: clean(scope, 500),
        properties: {},
        evidence: [],
        confidence: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else if (clean(name, 500) && clean(name, 500) !== existing.name) {
      existing.aliases = [...new Set([...(existing.aliases || []), clean(name, 500)])];
      // Prefer a conventional title-cased/camel-cased display form over a
      // lower-case model mention, but identity remains canonicalized.
      if (existing.name === existing.name.toLowerCase() && clean(name, 500) !== clean(name, 500).toLowerCase()) existing.name = clean(name, 500);
    }

    existing.properties = { ...existing.properties, ...properties };
    existing.updatedAt = new Date().toISOString();

    const collision = this.state.semanticObjects[objectId];
    this.state.semanticObjects[objectId] = collision && collision !== existing ? mergeObjects(existing, collision) : existing;
    this.equivalentByKey.set(equivalentKey(existing.type, existing.name, existing.scope), this.state.semanticObjects[objectId]);
    return this.state.semanticObjects[objectId];
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
