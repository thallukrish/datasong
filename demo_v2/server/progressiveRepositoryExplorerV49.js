import { ProgressiveRepositoryExplorerV47 } from './progressiveRepositoryExplorerV47.js';
import { SemanticEvidenceStore, EVIDENCE_STRENGTH } from './semanticEvidenceStore.js';

const arr = (v) => Array.isArray(v) ? v : [];
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const clean = (v = '', max = 700) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);

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

function findEntityDetail(arc, name) {
  return arr(arc?.entityDetails).find((e) => String(e?.name || '') === String(name || '')) || null;
}

export class ProgressiveRepositoryExplorerV49 extends ProgressiveRepositoryExplorerV47 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'evidence-backed-semantic-objects-v31';
    state.semanticObjects = {};
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
      seen.add(name);
    }
    for (const learned of arr(arc.entityDetails)) {
      const name = String(learned?.name || '');
      if (!name || seen.has(name)) continue;
      enriched.push({ ...learned, schemaResolved: false, schemaName: '', schemaSourcePath: '', schemaComponent: '' });
    }
    if (enriched.length) arc.entityDetails = enriched;
  }

  semanticStore() { return new SemanticEvidenceStore(this.state); }

  syncArcSemanticObjects(arc) {
    if (!arc) return;
    const store = this.semanticStore();
    const workflow = store.ensure({
      type: 'workflow', name: arc.title || arc.id, scope: arc.id,
      properties: {
        arcId: arc.id, actor: arc.businessActor || '', intent: arc.businessIntent || '',
        trigger: arc.trigger || '', outcome: arc.outcome || arc.businessOutcome || '',
        closureState: arc.closureState || '', progress: Number(arc.progress || 0)
      }
    });
    if (arc.traceability?.callPathId) store.addEvidence(workflow, {
      sourceType: 'call_path', source: arc.traceability.callPathId,
      assertion: 'This executable call path supports the existence and structure of this business workflow.',
      provenance: arc.traceability
    });
    if (arc.businessIntent || arc.trigger || arc.outcome || arc.businessOutcome) store.addEvidence(workflow, {
      sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
      assertion: 'The model interpreted the executable evidence as this business workflow.',
      property: 'businessMeaning', value: [arc.businessIntent, arc.trigger, arc.outcome || arc.businessOutcome].filter(Boolean).join(' | ')
    });

    const entityObjects = new Map();
    for (const name of arr(arc.entities)) {
      const detail = findEntityDetail(arc, name) || {};
      const entity = store.ensure({
        type: 'entity', name,
        properties: {
          description: detail.description || '', schemaResolved: !!detail.schemaResolved,
          schemaName: detail.schemaName || '', schemaSourcePath: detail.schemaSourcePath || '', schemaComponent: detail.schemaComponent || ''
        }
      });
      entityObjects.set(name, entity);
      if (detail.schemaResolved) store.addEvidence(entity, {
        sourceType: 'schema_definition', source: detail.schemaSourcePath || detail.schemaName,
        assertion: 'An authoritative framework/entity definition declares this entity.',
        provenance: { component: detail.schemaComponent || '', schemaName: detail.schemaName || '' }
      });
      if (detail.description) store.addEvidence(entity, {
        sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
        assertion: detail.description, property: 'description', value: detail.description
      });
      store.link(workflow, 'uses entity', entity, {
        sourceType: 'executable_code', source: arc.traceability?.callPathId || arc.id,
        assertion: `Workflow ${arc.title || arc.id} uses entity ${name}.`, provenance: arc.traceability || null
      });

      for (const field of arr(detail.fields)) {
        const fieldObject = store.ensure({
          type: 'field', name: `${name}.${field.name}`, scope: entity.id,
          properties: { entityId: entity.id, entityName: name, fieldName: field.name, dataType: field.type || '', isPk: !!field.isPk, description: field.description || '' }
        });
        const authoritative = !!detail.schemaResolved;
        store.addEvidence(fieldObject, {
          sourceType: authoritative ? 'schema_definition' : 'llm_inference',
          source: detail.schemaSourcePath || `pass2:${arc.id}`,
          strength: authoritative ? EVIDENCE_STRENGTH.schema_definition : EVIDENCE_STRENGTH.llm_inference,
          assertion: authoritative
            ? `The entity definition declares field ${field.name}${field.type ? ` with type ${field.type}` : ''}.`
            : `The model mentioned field ${field.name}, but no authoritative schema was resolved.`,
          property: 'field', value: field.name,
          provenance: authoritative ? { schemaName: detail.schemaName || '', component: detail.schemaComponent || '' } : null
        });
        if (field.description) store.addEvidence(fieldObject, {
          sourceType: authoritative ? 'documentation' : 'llm_interpretation',
          source: detail.schemaSourcePath || `pass2:${arc.id}`,
          assertion: field.description, property: 'description', value: field.description
        });
        store.link(entity, 'has field', fieldObject, {
          sourceType: authoritative ? 'schema_definition' : 'llm_inference',
          source: detail.schemaSourcePath || `pass2:${arc.id}`,
          assertion: `${name} has field ${field.name}.`
        });
      }
    }

    arr(arc.workflowSteps).forEach((step, index) => {
      const stepObject = store.ensure({
        type: 'step', name: step.name || `Step ${index + 1}`, scope: workflow.id,
        properties: { workflowId: workflow.id, order: index + 1, description: step.description || '', effect: step.effect || '', sourcePath: step.sourcePath || '' }
      });
      store.addEvidence(stepObject, {
        sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation',
        source: step.sourcePath || `pass2:${arc.id}`,
        assertion: step.description || step.name || 'Workflow step',
        provenance: step.sourcePath ? { sourcePath: step.sourcePath } : null
      });
      store.link(workflow, 'contains step', stepObject, {
        sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation',
        source: step.sourcePath || `pass2:${arc.id}`,
        assertion: `${arc.title || arc.id} contains ${step.name || `step ${index + 1}`}.`
      }, { order: index + 1 });
      for (const entityName of arr(step.entities)) {
        const entity = entityObjects.get(entityName) || store.ensure({ type: 'entity', name: entityName });
        entityObjects.set(entityName, entity);
        store.link(stepObject, 'touches entity', entity, {
          sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation',
          source: step.sourcePath || `pass2:${arc.id}`,
          assertion: `${step.name || 'This step'} touches ${entityName}.`
        });
      }
    });

    for (const rel of arr(arc.relationshipDetails)) {
      const from = entityObjects.get(rel.from) || store.ensure({ type: 'concept', name: rel.from || 'unknown', scope: workflow.id });
      const to = entityObjects.get(rel.to) || store.ensure({ type: 'concept', name: rel.to || 'unknown', scope: workflow.id });
      store.link(from, rel.relation || 'related to', to, {
        sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
        assertion: rel.description || `${rel.from} ${rel.relation} ${rel.to}`
      }, { workflowId: workflow.id, description: clean(rel.description) });
    }
  }

  syncAllSemanticObjects() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      this.enrichArcEntitySchemas(arc);
      this.syncArcSemanticObjects(arc);
    }
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    const arcId = parsed?._wholeFlowPass2 ? String(parsed?.arcUpdate?.arcId || this.pass1().activeArcId() || '') : '';
    const arc = arcId ? this.pass1().arcByReference(arcId) : null;
    if (arc) {
      this.enrichArcEntitySchemas(arc);
      this.syncArcSemanticObjects(arc);
    }
    this.persistSemanticMap?.();
    return result;
  }

  persistSemanticMap() {
    this.syncAllSemanticObjects();
    return super.persistSemanticMap();
  }
}
