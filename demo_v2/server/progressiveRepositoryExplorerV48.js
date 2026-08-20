import { ProgressiveRepositoryExplorerV47 } from './progressiveRepositoryExplorerV47.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean).map(String))]; }
function clean(value, max = 520) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function mergeFieldDescriptions(schema, learnedEntity) {
  const learnedByName = new Map(arr(learnedEntity?.fields).map((field) => [String(field?.name || ''), field]));
  return arr(schema?.fields).map((field) => {
    const learned = learnedByName.get(String(field?.name || '')) || {};
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

  enrichArcEntitySchemas(arc) {
    if (!arc) return;
    const learnedByName = new Map(arr(arc.entityDetails).map((entity) => [String(entity?.name || ''), entity]));
    const names = uniq([
      ...arr(arc.entities),
      ...arr(arc.persistentObjects),
      ...arr(arc.entityDetails).map((entity) => entity?.name),
      ...arr(arc.workflowSteps).flatMap((step) => [...arr(step?.entities), ...arr(step?.persistentObjects)])
    ]);

    const enriched = [];
    const seen = new Set();
    for (const name of names) {
      const learned = learnedByName.get(name) || { name, description: '', fields: [] };
      const schema = this.topology.entitySchema?.(name) || null;
      const detail = {
        ...learned,
        name,
        description: clean(learned.description || schema?.description || '', 420),
        schemaResolved: !!schema,
        schemaName: schema?.fullName || schema?.name || '',
        schemaSourcePath: schema?.sourcePath || '',
        schemaComponent: schema?.component || '',
        fields: schema ? mergeFieldDescriptions(schema, learned) : arr(learned.fields)
      };
      enriched.push(detail);
      seen.add(name);
    }

    for (const learned of arr(arc.entityDetails)) {
      const name = String(learned?.name || '');
      if (!name || seen.has(name)) continue;
      enriched.push({ ...learned, schemaResolved: false, schemaName: '', schemaSourcePath: '', schemaComponent: '' });
    }

    if (enriched.length) arc.entityDetails = enriched;
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
