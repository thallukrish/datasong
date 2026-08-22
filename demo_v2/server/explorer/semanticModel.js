import { SemanticEvidenceStore, EVIDENCE_STRENGTH } from '../semanticEvidenceStore.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 520) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const clamp01 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};
const identityKey = (value = '') => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const REPRESENTATION_RELATIONS = new Set(['represented_by', 'stored_in', 'identified_by', 'referenced_through']);

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

export const withSemanticModel = (Base) => class SemanticModelExplorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'evidence-backed-business-entity-representations-v33';
    if (!state.semanticObjects || typeof state.semanticObjects !== 'object') state.semanticObjects = {};
    return state;
  }

  wholeFlowPrompt(observation) {
    return `${super.wholeFlowPrompt(observation)}\nENTITY REPRESENTATION EXTENSION:\n- arcUpdate may additionally include entityRepresentations: [{businessEntity, physicalEntity, relation, description, confidence, evidence}].\n- Use this only when the supplied executable/schema evidence supports that a business-level entity is represented, stored, identified, or referenced through a concrete persistence/schema entity.\n- relation must be represented_by|stored_in|identified_by|referenced_through.\n- Example shape only: a business concept such as Order may be represented by one or more concrete persisted entities, but NEVER assert such a mapping merely from general knowledge.\n- physicalEntity should use the exact concrete entity/schema name when evidenced.\n- description must explain how the concrete entity represents or carries the business entity in this workflow.\n- confidence expresses strength of the semantic mapping, not strength of the physical schema definition.\n- It is valid to return an empty entityRepresentations array.`;
  }

  normalizeWholeFlowPass2(raw, observation) {
    const update = raw?.arcUpdate && typeof raw.arcUpdate === 'object'
      ? raw.arcUpdate
      : (raw?.arcFit?.arcUpdate && typeof raw.arcFit.arcUpdate === 'object' ? raw.arcFit.arcUpdate : {});
    const representations = arr(update?.entityRepresentations).map((item) => ({
      businessEntity: clean(item?.businessEntity, 160),
      physicalEntity: clean(item?.physicalEntity, 160),
      relation: REPRESENTATION_RELATIONS.has(item?.relation) ? item.relation : 'represented_by',
      description: clean(item?.description, 520),
      confidence: clamp01(item?.confidence),
      evidence: clean(item?.evidence, 420)
    })).filter((item) => item.businessEntity && item.physicalEntity && identityKey(item.businessEntity) !== identityKey(item.physicalEntity));
    const parsed = super.normalizeWholeFlowPass2(raw, observation);
    parsed._entityRepresentations = representations;
    return parsed;
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

  mergeEntityRepresentations(arc, incoming) {
    if (!arc) return;
    const byKey = new Map();
    for (const raw of [...arr(arc.entityRepresentations), ...arr(incoming)]) {
      const businessEntity = this.canonicalEntityName(raw?.businessEntity);
      const physicalEntity = this.canonicalEntityName(raw?.physicalEntity);
      if (!businessEntity || !physicalEntity || identityKey(businessEntity) === identityKey(physicalEntity)) continue;
      const relation = REPRESENTATION_RELATIONS.has(raw?.relation) ? raw.relation : 'represented_by';
      const key = `${identityKey(businessEntity)}|${relation}|${identityKey(physicalEntity)}`;
      const prior = byKey.get(key) || {};
      byKey.set(key, {
        ...prior, ...raw, businessEntity, physicalEntity, relation,
        description: clean(raw?.description || prior?.description || '', 520),
        evidence: clean(raw?.evidence || prior?.evidence || '', 420),
        confidence: Math.max(clamp01(raw?.confidence), clamp01(prior?.confidence))
      });
    }
    arc.entityRepresentations = [...byKey.values()];
  }

  representationDetailsFor(arc, businessName, learnedByKey) {
    const mappings = arr(arc?.entityRepresentations).filter((item) => identityKey(item?.businessEntity) === identityKey(businessName));
    const out = [];
    for (const mapping of mappings) {
      const schema = this.topology.entitySchema?.(mapping.physicalEntity) || null;
      const physicalName = String(schema?.name || mapping.physicalEntity || '');
      if (!physicalName) continue;
      const learnedPhysical = learnedByKey.get(identityKey(physicalName)) || {};
      const fields = schema ? mergeFieldDescriptions(schema, learnedPhysical).map((field) => ({
        ...field, sourceEntity: physicalName, schemaSourcePath: schema.sourcePath || '', authoritative: true
      })) : arr(learnedPhysical.fields).map((field) => ({ ...field, sourceEntity: physicalName, authoritative: false }));
      out.push({
        entityName: physicalName, relation: mapping.relation, description: mapping.description || '', evidence: mapping.evidence || '',
        confidence: clamp01(mapping.confidence), schemaResolved: !!schema, schemaName: schema?.fullName || schema?.name || '',
        schemaSourcePath: schema?.sourcePath || '', schemaComponent: schema?.component || '', fields
      });
    }
    return out;
  }

  enrichArcEntitySchemas(arc) {
    if (!arc) return;
    arc.entities = this.canonicalizeEntityList(arc.entities);
    arc.persistentObjects = this.canonicalizeEntityList(arc.persistentObjects);
    this.mergeEntityRepresentations(arc, []);
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
        ...prior, ...entity, name: canonicalName,
        description: clean(entity?.description || prior?.description || '', 420),
        fields: arr(entity?.fields).length ? entity.fields : arr(prior?.fields)
      });
    }

    const names = this.canonicalizeEntityList([
      ...arr(arc.entities), ...arr(arc.persistentObjects), ...arr(arc.entityDetails).map((entity) => entity?.name),
      ...arr(arc.entityRepresentations).flatMap((item) => [item?.businessEntity]),
      ...arr(arc.workflowSteps).flatMap((step) => [...arr(step?.entities), ...arr(step?.persistentObjects)])
    ]);

    const enriched = names.map((rawName) => {
      const schema = this.topology.entitySchema?.(rawName) || null;
      const name = String(schema?.name || rawName);
      const learned = learnedByKey.get(identityKey(name)) || { name, description: '', fields: [] };
      const representedBy = this.representationDetailsFor(arc, name, learnedByKey);
      let fields = schema ? mergeFieldDescriptions(schema, learned) : arr(learned.fields);
      if (!schema && representedBy.length) {
        const aggregate = [];
        const seen = new Set();
        for (const representation of representedBy) {
          for (const field of arr(representation.fields)) {
            const fieldKey = `${identityKey(representation.entityName)}|${identityKey(field.name)}`;
            if (seen.has(fieldKey)) continue;
            seen.add(fieldKey);
            aggregate.push({
              ...field,
              name: `${representation.entityName}.${field.name}`,
              physicalFieldName: field.name,
              sourceEntity: representation.entityName,
              description: field.description || `Field on ${representation.entityName}, which ${representation.relation.replaceAll('_', ' ')} ${name} in this workflow.`
            });
          }
        }
        if (aggregate.length) fields = aggregate;
      }
      return {
        ...learned, name,
        description: clean(learned.description || schema?.description || '', 420),
        schemaResolved: !!schema, schemaName: schema?.fullName || schema?.name || '', schemaSourcePath: schema?.sourcePath || '',
        schemaComponent: schema?.component || '', representedBy, fields
      };
    });

    if (enriched.length) {
      arc.entityDetails = enriched;
      arc.entities = this.canonicalizeEntityList([...arr(arc.entities), ...enriched.map((entity) => entity.name)]);
    }
  }

  semanticStore() { return new SemanticEvidenceStore(this.state); }

  materializeSchemaCatalogGraph() {
    const marker = `${this.state?.repoUrl || ''}@${this.state?.commit || ''}`;
    if (this._schemaCatalogGraphMaterializedFor === marker && marker !== '@') return;
    const store = this.semanticStore();
    const schemas = arr(this.topology?.entitySchemas);
    const entities = new Map();
    for (const schema of schemas) {
      if (!schema?.name) continue;
      const entity = store.ensure({
        type: 'entity', name: schema.name,
        properties: {
          description: clean(schema.description || '', 420), schemaResolved: true,
          schemaName: schema.fullName || schema.name, schemaSourcePath: schema.sourcePath || '',
          schemaComponent: schema.component || '', physicalRepresentation: true
        }
      });
      entities.set(identityKey(schema.name), entity);
      store.addEvidence(entity, {
        sourceType: 'schema_definition', source: schema.sourcePath || schema.fullName || schema.name,
        assertion: `The authoritative schema defines ${schema.name}.`,
        provenance: { component: schema.component || '', schemaName: schema.fullName || schema.name }
      });
      for (const field of arr(schema.fields)) {
        if (!field?.name) continue;
        const fieldObject = store.ensure({
          type: 'field', name: `${schema.name}.${field.name}`, scope: entity.id,
          properties: {
            entityId: entity.id, entityName: schema.name, fieldName: field.name,
            dataType: field.type || '', isPk: !!field.isPk, description: clean(field.description || '', 420),
            sourceEntity: schema.name, physicalFieldName: field.name, authoritative: true
          }
        });
        store.addEvidence(fieldObject, {
          sourceType: 'schema_definition', source: schema.sourcePath || schema.fullName || schema.name,
          assertion: `The schema declares ${schema.name}.${field.name}.`, property: 'field', value: field.name
        });
        store.link(entity, 'has field', fieldObject, {
          sourceType: 'schema_definition', source: schema.sourcePath || schema.fullName || schema.name,
          assertion: `${schema.name} exposes ${field.name}.`
        }, { cardinality: 'one-to-many', relationshipKind: 'schema_field' });
      }
    }
    if (typeof this.schemaRelationshipDetails === 'function') {
      for (const schema of schemas) {
        const from = entities.get(identityKey(schema?.name));
        if (!from) continue;
        for (const relationship of this.schemaRelationshipDetails(schema.name)) {
          const to = entities.get(identityKey(relationship.to));
          if (!to) continue;
          store.link(from, relationship.relation || 'references', to, {
            sourceType: 'schema_relationship', source: relationship.schemaSourcePath || relationship.sourceSchema || schema.name,
            assertion: relationship.description || `${schema.name} references ${relationship.to}.`,
            provenance: { sourceSchema: relationship.sourceSchema || '', targetSchema: relationship.targetSchema || '' }
          }, {
            cardinality: relationship.schemaRelationshipType || 'unknown', relationshipKind: 'schema_fk',
            keyMaps: arr(relationship.keyMaps).map((map) => ({ fieldName: map?.fieldName || '', relatedFieldName: map?.relatedFieldName || '', implicit: !!map?.implicit })), evidenced: relationship.evidenced !== false,
            description: clean(relationship.description || '', 520)
          });
        }
      }
    }
    this._schemaCatalogGraphMaterializedFor = marker;
  }

  syncArcSemanticObjects(arc) {
    if (!arc) return;
    const store = this.semanticStore();
    const workflow = store.ensure({
      type: 'workflow', name: arc.title || arc.id, scope: arc.id,
      properties: {
        arcId: arc.id, actor: arc.businessActor || '', intent: arc.businessIntent || '', trigger: arc.trigger || '',
        outcome: arc.outcome || arc.businessOutcome || '', closureState: arc.closureState || '', progress: Number(arc.progress || 0),
        businessPriority: Number.isFinite(Number(arc.businessPriority)) ? Number(arc.businessPriority) : null,
        priorityClass: arc.priorityClass || ''
      }
    });
    if (arc.traceability?.callPathId) store.addEvidence(workflow, {
      sourceType: 'call_path', source: arc.traceability.callPathId,
      assertion: 'This executable call path supports this business workflow.', provenance: arc.traceability
    });
    if (arc.businessIntent || arc.trigger || arc.outcome || arc.businessOutcome) store.addEvidence(workflow, {
      sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
      assertion: 'The model interpreted executable evidence as this business workflow.',
      property: 'businessMeaning', value: [arc.businessIntent, arc.trigger, arc.outcome || arc.businessOutcome].filter(Boolean).join(' | ')
    });

    const entityObjects = new Map();
    for (const name of arr(arc.entities)) {
      const detail = arr(arc.entityDetails).find((e) => identityKey(e?.name) === identityKey(name)) || {};
      const entity = store.ensure({
        type: 'entity', name,
        properties: {
          description: detail.description || '', schemaResolved: !!detail.schemaResolved, schemaName: detail.schemaName || '',
          schemaSourcePath: detail.schemaSourcePath || '', schemaComponent: detail.schemaComponent || '',
          representedBy: arr(detail.representedBy).map((item) => ({ entityName: item.entityName, relation: item.relation, confidence: item.confidence }))
        }
      });
      entityObjects.set(identityKey(name), entity);
      if (detail.schemaResolved) store.addEvidence(entity, {
        sourceType: 'schema_definition', source: detail.schemaSourcePath || detail.schemaName,
        assertion: 'An authoritative schema/entity definition declares this entity.',
        provenance: { component: detail.schemaComponent || '', schemaName: detail.schemaName || '' }
      });
      if (detail.description) store.addEvidence(entity, {
        sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
        assertion: detail.description, property: 'description', value: detail.description
      });
      store.link(workflow, 'uses entity', entity, {
        sourceType: 'executable_code', source: arc.traceability?.callPathId || arc.id,
        assertion: `${arc.title || arc.id} uses ${name}.`, provenance: arc.traceability || null
      });

      for (const field of arr(detail.fields)) {
        const fieldObject = store.ensure({
          type: 'field', name: `${name}.${field.name}`, scope: entity.id,
          properties: {
            entityId: entity.id, entityName: name, fieldName: field.name, dataType: field.type || '', isPk: !!field.isPk,
            description: field.description || '', sourceEntity: field.sourceEntity || '', physicalFieldName: field.physicalFieldName || ''
          }
        });
        const authoritative = !!detail.schemaResolved || field.authoritative === true;
        const sourceType = authoritative ? 'schema_definition' : 'llm_inference';
        const evidenceSource = field.schemaSourcePath || detail.schemaSourcePath || `pass2:${arc.id}`;
        store.addEvidence(fieldObject, {
          sourceType, source: evidenceSource,
          strength: authoritative ? EVIDENCE_STRENGTH.schema_definition : EVIDENCE_STRENGTH.llm_inference,
          assertion: authoritative
            ? `The schema declares ${field.sourceEntity ? `${field.sourceEntity}.` : ''}${field.physicalFieldName || field.name}.`
            : `The model mentioned field ${field.name}; no authoritative schema was resolved.`,
          property: 'field', value: field.name,
          provenance: authoritative ? {
            schemaName: detail.schemaName || '', component: detail.schemaComponent || '', sourceEntity: field.sourceEntity || name,
            schemaSourcePath: field.schemaSourcePath || detail.schemaSourcePath || ''
          } : null
        });
        if (field.description) store.addEvidence(fieldObject, {
          sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
          assertion: field.description, property: 'description', value: field.description
        });
        store.link(entity, 'has field', fieldObject, {
          sourceType, source: evidenceSource,
          assertion: `${name} exposes ${field.name}${field.sourceEntity ? ` through ${field.sourceEntity}` : ''}.`
        });
      }
    }

    for (const mapping of arr(arc.entityRepresentations)) {
      const business = entityObjects.get(identityKey(mapping.businessEntity)) || store.ensure({ type: 'entity', name: mapping.businessEntity });
      const schema = this.topology.entitySchema?.(mapping.physicalEntity) || null;
      const physicalName = String(schema?.name || mapping.physicalEntity || '');
      if (!physicalName) continue;
      const physical = store.ensure({
        type: 'entity', name: physicalName,
        properties: {
          schemaResolved: !!schema, schemaName: schema?.fullName || schema?.name || '', schemaSourcePath: schema?.sourcePath || '',
          schemaComponent: schema?.component || '', physicalRepresentation: true
        }
      });
      store.link(business, mapping.relation.replaceAll('_', ' '), physical, {
        sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
        strength: Math.max(EVIDENCE_STRENGTH.llm_inference, clamp01(mapping.confidence) * 0.75),
        assertion: mapping.description || `${mapping.businessEntity} ${mapping.relation.replaceAll('_', ' ')} ${physicalName}.`,
        provenance: { workflowId: arc.id, evidence: mapping.evidence || '', callPathId: arc.callPathId || '' }
      });
      if (schema) store.addEvidence(physical, {
        sourceType: 'schema_definition', source: schema.sourcePath || schema.fullName || schema.name,
        assertion: `The authoritative schema defines ${physicalName}.`,
        provenance: { component: schema.component || '', schemaName: schema.fullName || schema.name || '' }
      });
    }

    arr(arc.workflowSteps).forEach((step, index) => {
      const stepObject = store.ensure({
        type: 'step', name: step.name || `Step ${index + 1}`, scope: workflow.id,
        properties: { workflowId: workflow.id, order: index + 1, description: step.description || '', effect: step.effect || '', sourcePath: step.sourcePath || '' }
      });
      store.addEvidence(stepObject, {
        sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation', source: step.sourcePath || `pass2:${arc.id}`,
        assertion: step.description || step.name || 'Workflow step', provenance: step.sourcePath ? { sourcePath: step.sourcePath } : null
      });
      store.link(workflow, 'contains step', stepObject, {
        sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation', source: step.sourcePath || `pass2:${arc.id}`,
        assertion: `${arc.title || arc.id} contains ${step.name || `step ${index + 1}`}.`
      }, { order: index + 1 });
      for (const entityName of arr(step.entities)) {
        const entity = entityObjects.get(identityKey(entityName)) || store.ensure({ type: 'entity', name: entityName });
        store.link(stepObject, 'touches entity', entity, {
          sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation', source: step.sourcePath || `pass2:${arc.id}`,
          assertion: `${step.name || 'This step'} touches ${entityName}.`
        });
      }
    });

    for (const rel of arr(arc.relationshipDetails)) {
      const from = entityObjects.get(identityKey(rel.from)) || store.ensure({ type: 'concept', name: rel.from || 'unknown', scope: workflow.id });
      const to = entityObjects.get(identityKey(rel.to)) || store.ensure({ type: 'concept', name: rel.to || 'unknown', scope: workflow.id });
      store.link(from, rel.relation || 'related to', to, {
        sourceType: 'llm_interpretation', source: `pass2:${arc.id}`,
        assertion: rel.description || `${rel.from} ${rel.relation} ${rel.to}`
      }, {
        workflowId: workflow.id, description: clean(rel.description),
        cardinality: rel.cardinality || rel.schemaRelationshipType || 'unknown',
        relationshipKind: rel.relationshipKind || 'business',
        keyMaps: arr(rel.keyMaps).map((map) => ({ fieldName: map?.fieldName || '', relatedFieldName: map?.relatedFieldName || '', implicit: !!map?.implicit })),
        evidenced: rel.evidenced !== false
      });
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
    if (arcId) {
      const arc = this.pass1().arcByReference(arcId);
      if (arc) {
        if (arr(parsed?._entityRepresentations).length) this.mergeEntityRepresentations(arc, parsed._entityRepresentations);
        this.enrichArcEntitySchemas(arc);
        this.syncArcSemanticObjects(arc);
      }
    }
    this.persistSemanticMap?.();
    return result;
  }

  persistSemanticMap() {
    this.syncAllSemanticObjects();
    return super.persistSemanticMap();
  }
};
