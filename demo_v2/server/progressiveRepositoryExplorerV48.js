import { ProgressiveRepositoryExplorerV47 } from './progressiveRepositoryExplorerV47.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean).map(String))]; }
function clean(value, max = 520) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function identityKey(value = '') {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function mergeFieldDescriptions(schema, learnedEntity) {
  const learnedByName = new Map(arr(learnedEntity?.fields).map((field) => [identityKey(field?.name), field]));
  return arr(schema?.fields).map((field) => {
    const learned = learnedByName.get(identityKey(field?.name)) || {};
    return {
      name: String(field?.name || ''),
      type: String(field?.type || ''),
      isPk: !!field?.isPk,
      description: clean(learned?.description || field?.description || '', 420),
      sourceField: String(field?.sourceField || ''),
      entityAlias: String(field?.entityAlias || '')
    };
  }).filter((field) => field.name);
}

export class ProgressiveRepositoryExplorerV48 extends ProgressiveRepositoryExplorerV47 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'structured-workflow-post-schema-enrichment-v30';
    return state;
  }

  canonicalEntityName(name) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    const schema = this.topology.entitySchema?.(raw) || null;
    return String(schema?.name || raw);
  }

  canonicalizeEntityList(values) {
    const byKey = new Map();
    for (const raw of arr(values)) {
      const canonical = this.canonicalEntityName(raw);
      const key = identityKey(canonical);
      if (!key) continue;
      const prior = byKey.get(key);
      if (!prior || (prior === prior.toLowerCase() && canonical !== canonical.toLowerCase())) byKey.set(key, canonical);
    }
    return [...byKey.values()];
  }

  enrichArcEntitySchemas(arc) {
    if (!arc) return;

    // Normalize semantic mentions before enrichment so `order`, `Order`, and
    // punctuation/whitespace variants do not fragment the enterprise map.
    arc.entities = this.canonicalizeEntityList(arc.entities);
    arc.persistentObjects = this.canonicalizeEntityList(arc.persistentObjects);
    arc.workflowSteps = arr(arc.workflowSteps).map((step) => ({
      ...step,
      entities: this.canonicalizeEntityList(step?.entities),
      persistentObjects: this.canonicalizeEntityList(step?.persistentObjects)
    }));

    const learnedByKey = new Map();
    for (const entity of arr(arc.entityDetails)) {
      const canonicalName = this.canonicalEntityName(entity?.name);
      const key = identityKey(canonicalName);
      if (!key) continue;
      const prior = learnedByKey.get(key) || {};
      learnedByKey.set(key, {
        ...prior,
        ...entity,
        name: canonicalName,
        description: clean(entity?.description || prior?.description || '', 420),
        fields: arr(entity?.fields).length ? entity.fields : arr(prior?.fields)
      });
    }

    const names = this.canonicalizeEntityList([
      ...arr(arc.entities),
      ...arr(arc.persistentObjects),
      ...arr(arc.entityDetails).map((entity) => entity?.name),
      ...arr(arc.workflowSteps).flatMap((step) => [...arr(step?.entities), ...arr(step?.persistentObjects)])
    ]);

    const enriched = [];
    for (const rawName of names) {
      const schema = this.topology.entitySchema?.(rawName) || null;
      const name = String(schema?.name || rawName);
      const learned = learnedByKey.get(identityKey(name)) || { name, description: '', fields: [] };
      enriched.push({
        ...learned,
        name,
        description: clean(learned.description || schema?.description || '', 420),
        schemaResolved: !!schema,
        schemaName: schema?.fullName || schema?.name || '',
        schemaSourcePath: schema?.sourcePath || '',
        schemaComponent: schema?.component || '',
        fields: schema ? mergeFieldDescriptions(schema, learned) : arr(learned.fields)
      });
    }

    if (enriched.length) {
      arc.entityDetails = enriched;
      arc.entities = this.canonicalizeEntityList([...arr(arc.entities), ...enriched.map((entity) => entity.name)]);
    }
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    const arcId = parsed?._wholeFlowPass2 ? String(parsed?.arcUpdate?.arcId || this.pass1().activeArcId() || '') : '';
    if (!arcId) return result;
    const arc = this.pass1().arcByReference(arcId);
    if (!arc) return result;
    this.enrichArcEntitySchemas(arc);
    this.persistSemanticMap?.();
    return result;
  }
}
