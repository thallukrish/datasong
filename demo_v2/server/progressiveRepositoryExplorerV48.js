import { ProgressiveRepositoryExplorerV47 } from './progressiveRepositoryExplorerV47.js';
import { SemanticEvidenceStore, EVIDENCE_STRENGTH } from './semanticEvidenceStore.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function uniq(values) { return [...new Set(arr(values).filter(Boolean).map(String))]; }
function clean(value, max = 520) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function identityKey(value = '') {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

const PRIORITY_CLASSES = new Set([
  'core_end_user', 'revenue_critical', 'core_business', 'operational',
  'support', 'reporting', 'admin', 'configuration', 'technical'
]);
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

export class ProgressiveRepositoryExplorerV48 extends ProgressiveRepositoryExplorerV47 {
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
        ...prior,
        ...raw,
        businessEntity,
        physicalEntity,
        relation,
        description: clean(raw?.description || prior?.description || '', 520),
        evidence: clean(raw?.evidence || prior?.evidence || '', 420),
        confidence: Math.max(clamp01(raw?.confidence), clamp01(prior?.confidence))
      });
    }
    arc.entityRepresentations = [...byKey.values()];
  }

  representationDetailsFor(arc, businessName, learnedByKey) {
    const mappings = arr(arc?.entityRepresentations)
      .filter((item) => identityKey(item?.businessEntity) === identityKey(businessName));
    const out = [];
    for (const mapping of mappings) {
      const schema = this.topology.entitySchema?.(mapping.physicalEntity) || null;
      const physicalName = String(schema?.name || mapping.physicalEntity || '');
      if (!physicalName) continue;
      const learnedPhysical = learnedByKey.get(identityKey(physicalName)) || {};
      const fields = schema ? mergeFieldDescriptions(schema, learnedPhysical).map((field) => ({
        ...field,
        sourceEntity: physicalName,
        schemaSourcePath: schema.sourcePath || '',
        authoritative: true
      })) : arr(learnedPhysical.fields).map((field) => ({ ...field, sourceEntity: physicalName, authoritative: false }));
      out.push({
        entityName: physicalName,
        relation: mapping.relation,
        description: mapping.description || '',
        evidence: mapping.evidence || '',
        confidence: clamp01(mapping.confidence),
        schemaResolved: !!schema,
        schemaName: schema?.fullName || schema?.name || '',
        schemaSourcePath: schema?.sourcePath || '',
        schemaComponent: schema?.component || '',
        fields
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
      ...arr(arc.entities), ...arr(arc.persistentObjects),
      ...arr(arc.entityDetails).map((entity) => entity?.name),
      ...arr(arc.entityRepresentations).flatMap((item) => [item?.businessEntity]),
      ...arr(arc.workflowSteps).flatMap((step) => [...arr(step?.entities), ...arr(step?.persistentObjects)])
    ]);

    const enriched = names.map((rawName) => {
      const schema = this.topology.entitySchema?.(rawName) || null;
      const name = String(schema?.name || rawName);
      const learned = learnedByKey.get(identityKey(name)) || { name, description: '', fields: [] };
      const representedBy = this.representationDetailsFor(arc, name, learnedByKey);
      let fields = schema ? mergeFieldDescriptions(schema, learned) : arr(learned.fields);

      // A business entity may not have a physical schema of the same name. In
      // that case expose authoritative fields from the concrete representations,
      // but keep the physical source in the field name/provenance so this is not
      // mistaken for a direct schema declaration on the business entity itself.
      if (!schema && representedBy.length) {
        const aggregate = [];
        const seen = new Set();
        for (const representation of representedBy) {
          for (const field of arr(representation.fields)) {
            const key = `${identityKey(representation.entityName)}|${identityKey(field.name)}`;
            if (seen.has(key)) continue;
            seen.add(key);
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
        schemaResolved: !!schema,
        schemaName: schema?.fullName || schema?.name || '',
        schemaSourcePath: schema?.sourcePath || '',
        schemaComponent: schema?.component || '',
        representedBy,
        fields
      };
    });

    if (enriched.length) {
      arc.entityDetails = enriched;
      arc.entities = this.canonicalizeEntityList([...arr(arc.entities), ...enriched.map((entity) => entity.name)]);
    }
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
        closureState: arc.closureState || '', progress: Number(arc.progress || 0),
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
          description: detail.description || '', schemaResolved: !!detail.schemaResolved,
          schemaName: detail.schemaName || '', schemaSourcePath: detail.schemaSourcePath || '', schemaComponent: detail.schemaComponent || '',
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
            schemaName: detail.schemaName || '', component: detail.schemaComponent || '',
            sourceEntity: field.sourceEntity || name, schemaSourcePath: field.schemaSourcePath || detail.schemaSourcePath || ''
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
          schemaResolved: !!schema, schemaName: schema?.fullName || schema?.name || '',
          schemaSourcePath: schema?.sourcePath || '', schemaComponent: schema?.component || '', physicalRepresentation: true
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
        sourceType: step.sourcePath ? 'executable_code' : 'llm_interpretation',
        source: step.sourcePath || `pass2:${arc.id}`, assertion: step.description || step.name || 'Workflow step',
        provenance: step.sourcePath ? { sourcePath: step.sourcePath } : null
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
      }, { workflowId: workflow.id, description: clean(rel.description) });
    }
  }

  syncAllSemanticObjects() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      this.enrichArcEntitySchemas(arc);
      this.syncArcSemanticObjects(arc);
    }
  }

  prioritySummary(arc) {
    return {
      itemId: `arc:${arc.id}`, kind: 'existing_workflow', arcId: arc.id,
      title: clean(arc.title, 180), actor: clean(arc.businessActor || arc.trigger, 140),
      intent: clean(arc.businessIntent, 220), outcome: clean(arc.outcome || arc.businessOutcome, 220),
      progress: Number(arc.progress || 0),
      mapState: arc.closureState === 'closed' ? 'complete' : (Number(arc.progress || 0) > 0 ? 'explored' : 'identified'),
      currentPriority: Number.isFinite(Number(arc.businessPriority)) ? Number(arc.businessPriority) : null,
      priorityModelVersion: arc.priorityModelVersion || ''
    };
  }

  legacyUnrankedWorkflows(limit = 8) {
    return this.pass1().arcs()
      .filter((arc) => arc?.id && arc.qualifiesAsBusinessUseCase !== false)
      .filter((arc) => !Number.isFinite(Number(arc.businessPriority)) || arc.priorityModelVersion !== 'business-priority-v1')
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  scoutPriorityBatch(candidates) { return arr(candidates).slice(0, 10); }

  candidatePrioritySummary(candidate) {
    const callPathId = arr(candidate?.callPathIds)[0] || '';
    const grouped = callPathId ? (this.rankedPathById?.(callPathId) || this.topology.topCallPaths?.(500)?.find((p) => p.id === callPathId)) : null;
    const compact = grouped ? this.compactCallPath(grouped) : null;
    return {
      itemId: `path:${candidate.id}`, kind: 'unseen_path_family', artifactId: candidate.id,
      callPathIds: arr(candidate.callPathIds), functionCount: Number(grouped?.functionCount || compact?.functionCount || 0),
      flow: compact?.flow || null, flowSequence: arr(compact?.flowSequence), terminal: compact?.terminal || null,
      sourcePaths: arr(grouped?.sourcePaths).slice(0, 3)
    };
  }

  scoutPriorityPrompt(candidates) {
    const legacy = this.legacyUnrankedWorkflows(8).map((arc) => this.prioritySummary(arc));
    const paths = this.scoutPriorityBatch(candidates).map((candidate) => this.candidatePrioritySummary(candidate));
    const covered = this.pass1().arcs()
      .filter((arc) => Number.isFinite(Number(arc.businessPriority)) && Number(arc.progress || 0) >= 80)
      .sort((a, b) => Number(b.businessPriority || 0) - Number(a.businessPriority || 0)).slice(0, 12)
      .map((arc) => ({ title: clean(arc.title, 160), priority: Number(arc.businessPriority || 0), progress: Number(arc.progress || 0) }));
    const contract = { summary: 'brief ranking rationale', rankings: [{
      itemId: 'exact supplied itemId', businessPriority: 0,
      priorityClass: 'core_end_user|revenue_critical|core_business|operational|support|reporting|admin|configuration|technical',
      businessUseCaseLikelihood: 0, novelty: 0, pursue: true,
      suggestedArcTitle: 'for unseen paths', businessActor: 'if evidenced', businessIntent: 'if evidenced', reason: 'short reason'
    }] };
    return [
      'MODE scout-business-priority-v1',
      `CURRENTLY_WELL_COVERED ${JSON.stringify(covered)}`,
      `ITEMS_TO_RANK ${JSON.stringify([...legacy, ...paths])}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Rank every supplied item by business importance, novelty, and expected semantic gain.',
      '- Prefer core end-user/customer journeys and revenue-critical flows, then core business, operational, support, reporting, admin/configuration, technical.',
      '- Existing workflows and new path families compete in one ranking; discovery age is irrelevant.',
      '- Avoid prioritizing variants of already well-covered workflows.',
      '- Low-priority business flows remain valid future work; ranking controls order only.',
      '- Mark clearly technical/framework paths pursue=false.',
      '- Use only supplied evidence and return compact valid JSON.'
    ].join('\n');
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE scout-business-priority-v1')) {
      return this.lightweightModelCall(
        `You are lemap's BUSINESS-PRIORITY SCOUT. Rank supplied existing workflows and unseen executable path families by business importance, novelty, and expected semantic gain. Do not invent behavior. Return strict JSON only.`,
        dynamicPrompt, 'SCOUT BUSINESS PRIORITY RERANKER'
      );
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizePriorityResult(raw, candidates) {
    const pathIds = new Set(this.scoutPriorityBatch(candidates).map((c) => `path:${c.id}`));
    const arcIds = new Set(this.legacyUnrankedWorkflows(50).map((a) => `arc:${a.id}`));
    return arr(raw?.rankings)
      .filter((item) => pathIds.has(item?.itemId) || arcIds.has(item?.itemId))
      .map((item) => ({
        itemId: String(item.itemId), businessPriority: clamp01(item.businessPriority),
        priorityClass: PRIORITY_CLASSES.has(item.priorityClass) ? item.priorityClass : 'core_business',
        businessUseCaseLikelihood: clamp01(item.businessUseCaseLikelihood), novelty: clamp01(item.novelty),
        pursue: item.pursue !== false, suggestedArcTitle: clean(item.suggestedArcTitle, 180),
        businessActor: clean(item.businessActor, 180), businessIntent: clean(item.businessIntent, 260), reason: clean(item.reason, 320)
      }))
      .sort((a, b) => b.businessPriority - a.businessPriority || (b.novelty * b.businessUseCaseLikelihood) - (a.novelty * a.businessUseCaseLikelihood));
  }

  applyLegacyRankings(rankings) {
    for (const item of arr(rankings).filter((r) => r.itemId.startsWith('arc:'))) {
      const arc = this.pass1().arcByReference(item.itemId.slice(4));
      if (!arc) continue;
      arc.businessPriority = item.businessPriority;
      arc.priorityClass = item.priorityClass;
      arc.priorityReason = item.reason;
      arc.priorityModelVersion = 'business-priority-v1';
      arc.priorityRankedAt = new Date().toISOString();
    }
  }

  promotePriorityPaths(rankings, candidates) {
    const byArtifact = new Map(this.scoutPriorityBatch(candidates).map((candidate) => [candidate.id, candidate]));
    const existingTitles = new Set(this.pass1().arcs().map((arc) => String(arc.title || '').trim().toLowerCase()));
    const created = [];
    for (const item of arr(rankings).filter((r) => r.itemId.startsWith('path:'))) {
      if (!item.pursue || item.businessUseCaseLikelihood < 0.55 || item.novelty < 0.45 || created.length >= 3) continue;
      const candidate = byArtifact.get(item.itemId.slice(5));
      if (!candidate) continue;
      const title = item.suggestedArcTitle || clean(candidate.label || candidate.id, 180);
      if (!title || existingTitles.has(title.toLowerCase())) continue;
      const callPathId = arr(candidate.callPathIds)[0] || '';
      const grouped = callPathId ? (this.rankedPathById?.(callPathId) || this.topology.topCallPaths?.(500)?.find((p) => p.id === callPathId)) : null;
      if (!callPathId || !grouped) continue;
      const arc = this.pass1().createArc({
        title, concept: item.reason, businessActor: item.businessActor, businessIntent: item.businessIntent,
        confidence: Math.max(item.businessUseCaseLikelihood, item.novelty, item.businessPriority),
        qualifiesAsBusinessUseCase: true, qualification: 'business_use_case'
      }, { id: candidate.id, path: candidate.path || '' });
      if (!arc) continue;
      Object.assign(arc, {
        seedSource: 'scout_call_path', scoutArtifactId: candidate.id, scoutNovelty: item.novelty,
        callPathId, callPathVariantIds: arr(grouped.alternatives).map((alt) => alt.pathId),
        seedArtifactId: grouped.entrySymbolId || candidate.id, seedSourcePath: arr(grouped.sourcePaths)[0] || candidate.path || '',
        status: 'forming', progress: 0, businessPriority: item.businessPriority, priorityClass: item.priorityClass,
        priorityReason: item.reason, priorityModelVersion: 'business-priority-v1', priorityRankedAt: new Date().toISOString()
      });
      this.pass2().seed(arc.id);
      this.flowState(arc);
      existingTitles.add(title.toLowerCase());
      created.push({ arc, item, candidate });
    }
    return created;
  }

  markScoutBatchReviewed(candidates) {
    const scout = this.scout().ensureState();
    for (const candidate of this.scoutPriorityBatch(candidates)) {
      for (const id of arr(candidate.callPathIds)) if (!scout.reviewedCallPathIds.includes(id)) scout.reviewedCallPathIds.push(id);
    }
  }

  unfinishedWholeFlowArcs(excludeArcId = '') {
    return this.pass1().arcs()
      .filter((arc) => arc?.id && arc.id !== excludeArcId && !this.flowState(arc)?.completed)
      .sort((a, b) => {
        const ap = Number.isFinite(Number(a.businessPriority)) ? Number(a.businessPriority) : -1;
        const bp = Number.isFinite(Number(b.businessPriority)) ? Number(b.businessPriority) : -1;
        if (ap !== bp) return bp - ap;
        const as = this.flowState(a)?.started ? 1 : 0;
        const bs = this.flowState(b)?.started ? 1 : 0;
        if (as !== bs) return as - bs;
        return Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0) || Number(a.createdStep || 0) - Number(b.createdStep || 0);
      });
  }

  async runScout(candidates) {
    const before = this.snapshot();
    const batch = this.scoutPriorityBatch(candidates);
    const observation = { id: `scout-priority:${this.state.step}`, path: 'business-priority scout', kind: 'scout_review', canonical: { phase: 'scout', policy: 'business_priority_rerank' } };
    const dynamicPrompt = this.scoutPriorityPrompt(candidates);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${dynamicPrompt}\nRETRY: return complete valid JSON only.` : dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation, candidates: batch, before, maxTokens: undefined, retry });
      try {
        const raw = JSON.parse(result.raw);
        const rankings = this.normalizePriorityResult(raw, candidates);
        this.applyLegacyRankings(rankings);
        this.markScoutBatchReviewed(candidates);
        const created = this.promotePriorityPaths(rankings, candidates);
        const next = this.unfinishedWholeFlowArcs('')[0] || null;
        if (next) {
          const scheduler = this.pass1().ensureState();
          scheduler.activeArcId = next.id;
          next.lastScheduledStep = Number(this.state.step || 0);
        }
        const scout = this.scout().ensureState();
        scout.runs.push({
          step: this.state.step, reason: scout.pendingReason, candidateCount: batch.length,
          candidateWindow: Number(scout.candidateWindow || 0), reviewedCallPathCount: scout.reviewedCallPathIds.length,
          rankedExistingWorkflowCount: rankings.filter((r) => r.itemId.startsWith('arc:')).length,
          createdArcIds: created.map((c) => c.arc.id), chosenArcId: next?.id || '', summary: clean(raw?.summary, 400)
        });
        scout.runs = scout.runs.slice(-120);
        scout.lastFingerprint = this.scout().fingerprint(candidates);
        scout.pendingReason = '';
        this.pass1().syncStories();
        this.syncAllSemanticObjects();
        this.persistSemanticMap?.();
        await this.appendRunLog({
          type: 'scout_business_priority_applied', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), rankings, createdArcIds: created.map((c) => c.arc.id), chosenArcId: next?.id || ''
        });
        this.printCallSummary(result.usage, result.callNumber, next ? `Scout ranked priorities; next ${next.title}` : 'Scout ranked batch');
        return next ? { arc: next, rankings, created } : null;
      } catch (error) {
        lastError = error;
        await this.appendRunLog({
          type: 'llm_invalid_scout_business_priority', call: result.callNumber, explorationStep: this.state.step,
          retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw,
          usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage }
        });
      }
    }
    throw new Error(`No valid Scout business-priority response after retry: ${lastError?.message || 'unknown error'}`);
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
}
