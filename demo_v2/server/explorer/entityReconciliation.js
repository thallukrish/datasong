import crypto from 'node:crypto';

const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 420) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const hash = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');

const RECONCILE_SYSTEM = `You are lemap's BATCH SEMANTIC RECONCILER.
You receive only unresolved business entities whose evidence changed since the last attempt, plus a small set of deterministic physical-schema candidates and compact workflow contexts. You may also receive already-resolved schema entities whose exact fields still need short business descriptions.
Use only supplied evidence. Never invent an entity, field, workflow, relationship, or persistence structure.
Prefer leaving an entity pending over making a weak mapping.
Return strict JSON only.`;

/**
 * Cross-workflow entity reconciliation layer.
 *
 * Extracted from the former RepositoryExplorer/V52 delta. It intentionally owns
 * only the behavior added above the V48 core: unresolved business-entity
 * reconciliation, bounded field-description enrichment, and reconciliation at
 * Scout batch/final exhaustion boundaries.
 */
export const withEntityReconciliation = (Base) => class EntityReconciliationExplorer extends Base {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'batch-entity-reconciliation-v36';
    state.entityReconciliation = {
      version: 1,
      batchSize: 10,
      attemptsByEntity: {},
      descriptionAttempts: {},
      runs: [],
      finalPasses: 0,
      lastRunAtReviewedCount: 0
    };
    return state;
  }

  reconciliationState() {
    if (!this.state.entityReconciliation || typeof this.state.entityReconciliation !== 'object') this.state.entityReconciliation = {};
    const state = this.state.entityReconciliation;
    if (!state.attemptsByEntity || typeof state.attemptsByEntity !== 'object') state.attemptsByEntity = {};
    if (!state.descriptionAttempts || typeof state.descriptionAttempts !== 'object') state.descriptionAttempts = {};
    if (!Array.isArray(state.runs)) state.runs = [];
    state.version = 1;
    state.batchSize = 10;
    state.finalPasses = Number(state.finalPasses || 0);
    state.lastRunAtReviewedCount = Number(state.lastRunAtReviewedCount || 0);
    return state;
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE batch-entity-reconciliation-v1')) {
      return this.lightweightModelCall(RECONCILE_SYSTEM, dynamicPrompt, 'BATCH ENTITY RECONCILIATION');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  businessArcs() {
    return this.pass1().arcs().filter((arc) => arc?.id && arc.qualifiesAsBusinessUseCase !== false);
  }

  entityNamesForArc(arc) {
    return uniq([
      ...arr(arc?.entities),
      ...arr(arc?.persistentObjects),
      ...arr(arc?.entityDetails).map((item) => item?.name),
      ...arr(arc?.workflowSteps).flatMap((step) => [...arr(step?.entities), ...arr(step?.persistentObjects)]),
      ...arr(arc?.entityRepresentations).flatMap((item) => [item?.businessEntity, item?.physicalEntity])
    ]);
  }

  entityContextInArc(arc, entityName) {
    const wanted = key(entityName);
    const steps = arr(arc?.workflowSteps)
      .filter((step) => [...arr(step?.entities), ...arr(step?.persistentObjects)].some((name) => key(name) === wanted))
      .slice(0, 3)
      .map((step) => ({ name: clean(step?.name, 120), description: clean(step?.description, 220), effect: clean(step?.effect, 150) }));
    const relationships = arr(arc?.relationshipDetails)
      .filter((rel) => key(rel?.from) === wanted || key(rel?.to) === wanted || key(rel?.relation).includes(wanted))
      .slice(0, 3)
      .map((rel) => ({ from: clean(rel?.from, 100), relation: clean(rel?.relation, 120), to: clean(rel?.to, 100), description: clean(rel?.description, 200) }));
    const detail = arr(arc?.entityDetails).find((item) => key(item?.name) === wanted);
    return {
      workflowId: arc.id,
      workflow: clean(arc.title, 140),
      intent: clean(arc.businessIntent, 180),
      outcome: clean(arc.outcome || arc.businessOutcome, 180),
      currentMeaning: clean(detail?.description, 180),
      steps,
      relationships
    };
  }

  contextsFor(entityName, max = 3) {
    const wanted = key(entityName);
    return this.businessArcs()
      .filter((arc) => this.entityNamesForArc(arc).some((name) => key(name) === wanted))
      .map((arc) => this.entityContextInArc(arc, entityName))
      .filter((context) => context.workflow || context.steps.length || context.relationships.length)
      .slice(0, max);
  }

  existingMappingsFor(entityName) {
    const wanted = key(entityName);
    return this.businessArcs().flatMap((arc) => arr(arc?.entityRepresentations)
      .filter((item) => key(item?.businessEntity) === wanted)
      .map((item) => ({ physicalEntity: String(item.physicalEntity || ''), relation: String(item.relation || 'represented_by'), confidence: Number(item.confidence || 0) })))
      .filter((item) => item.physicalEntity);
  }

  candidateSchemasFor(entityName) {
    const wanted = key(entityName);
    const contexts = this.contextsFor(entityName, 4);
    const contextWorkflowIds = new Set(contexts.map((item) => item.workflowId));
    const candidates = new Map();
    const add = (schema, score, reason) => {
      if (!schema?.name || key(schema.name) === wanted) return;
      const name = String(schema.name);
      const prior = candidates.get(name);
      if (!prior || score > prior.score) candidates.set(name, {
        name,
        score,
        reason,
        description: clean(schema.description, 140),
        fields: arr(schema.fields).slice(0, 8).map((field) => String(field?.name || '')).filter(Boolean)
      });
    };

    for (const arc of this.businessArcs().filter((item) => contextWorkflowIds.has(item.id))) {
      for (const rawName of this.entityNamesForArc(arc)) {
        const schema = this.topology.entitySchema?.(rawName);
        if (schema) add(schema, 10, 'resolved schema entity in the same workflow context');
      }
      for (const mapping of arr(arc.entityRepresentations)) {
        const schema = this.topology.entitySchema?.(mapping?.physicalEntity);
        if (schema) add(schema, 9, 'physical representation already evidenced in a related workflow context');
      }
    }

    for (const schema of arr(this.topology.entitySchemas)) {
      const schemaKey = key(schema?.name);
      if (!schemaKey || schemaKey === wanted) continue;
      let score = 0;
      if (schemaKey.startsWith(wanted)) score += 8;
      else if (schemaKey.includes(wanted)) score += 5;
      if (arr(schema?.fields).some((field) => key(field?.name) === `${wanted}id`)) score += 3;
      if (score) add(schema, score, 'name or identifier similarity');
    }

    return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  }

  unresolvedTargets() {
    const names = uniq(this.businessArcs().flatMap((arc) => this.entityNamesForArc(arc)));
    const state = this.reconciliationState();
    const out = [];
    for (const name of names) {
      if (this.topology.entitySchema?.(name)) continue;
      if (this.existingMappingsFor(name).length) continue;
      const contexts = this.contextsFor(name, 3);
      if (!contexts.length) continue;
      const candidates = this.candidateSchemasFor(name);
      if (!candidates.length) continue;
      const fingerprint = hash({ name: key(name), contexts, candidates: candidates.map((c) => ({ name: c.name, score: c.score })) });
      if (state.attemptsByEntity[key(name)]?.fingerprint === fingerprint) continue;
      out.push({ name, contexts, candidates, fingerprint });
    }
    return out.slice(0, 6);
  }

  fieldDescriptionTargets() {
    const state = this.reconciliationState();
    const bySchema = new Map();
    for (const arc of this.businessArcs()) {
      for (const rawName of this.entityNamesForArc(arc)) {
        const schema = this.topology.entitySchema?.(rawName);
        if (!schema?.name) continue;
        const exactName = String(schema.name);
        const learned = arr(arc.entityDetails).find((item) => key(item?.name) === key(exactName)) || {};
        const learnedByField = new Map(arr(learned.fields).map((field) => [key(field?.name), clean(field?.description, 260)]));
        const missing = arr(schema.fields)
          .filter((field) => field?.name && !clean(field?.description, 260) && !learnedByField.get(key(field.name)))
          .map((field) => ({ name: String(field.name), type: String(field.type || ''), isPk: !!field.isPk }));
        if (!missing.length) continue;
        const prior = bySchema.get(exactName) || { name: exactName, fields: [], contexts: this.contextsFor(exactName, 2) };
        const seen = new Set(prior.fields.map((field) => key(field.name)));
        for (const field of missing) if (!seen.has(key(field.name)) && prior.fields.length < 18) { prior.fields.push(field); seen.add(key(field.name)); }
        bySchema.set(exactName, prior);
      }
    }

    const out = [];
    let remainingFields = 54;
    for (const target of bySchema.values()) {
      if (remainingFields <= 0 || out.length >= 5) break;
      target.fields = target.fields.slice(0, Math.min(18, remainingFields));
      if (!target.fields.length) continue;
      const fingerprint = hash({ name: key(target.name), fields: target.fields.map((f) => f.name), contexts: target.contexts });
      if (state.descriptionAttempts[key(target.name)]?.fingerprint === fingerprint) continue;
      target.fingerprint = fingerprint;
      out.push(target);
      remainingFields -= target.fields.length;
    }
    return out;
  }

  reconciliationPacket() {
    return { unresolved: this.unresolvedTargets(), descriptions: this.fieldDescriptionTargets() };
  }

  applyMappings(mappings, allowedByBusiness) {
    let added = 0;
    for (const mapping of arr(mappings)) {
      const businessEntity = String(mapping?.businessEntity || '');
      const allowed = allowedByBusiness.get(key(businessEntity));
      if (!allowed) continue;
      for (const physical of arr(mapping?.physicalEntities)) {
        const physicalEntity = String(physical?.name || physical?.physicalEntity || '');
        if (!allowed.has(physicalEntity)) continue;
        const relation = ['represented_by','stored_in','identified_by','referenced_through'].includes(physical?.relation) ? physical.relation : 'represented_by';
        for (const arc of this.businessArcs()) {
          if (!this.entityNamesForArc(arc).some((name) => key(name) === key(businessEntity))) continue;
          const before = arr(arc.entityRepresentations).length;
          this.mergeEntityRepresentations(arc, [{
            businessEntity,
            physicalEntity,
            relation,
            confidence: Math.max(0, Math.min(1, Number(physical?.confidence || 0))),
            description: clean(physical?.description, 360),
            evidence: clean(physical?.evidence, 300)
          }]);
          if (arr(arc.entityRepresentations).length > before) added += 1;
        }
      }
    }
    return added;
  }

  applyDescriptions(result, packet) {
    let changed = 0;
    const allowedFields = new Map(packet.descriptions.map((target) => [key(target.name), new Set(target.fields.map((field) => key(field.name)))]));
    const entityMeanings = new Map(arr(result?.entityDescriptions)
      .filter((item) => item?.name && item?.description)
      .map((item) => [key(item.name), clean(item.description, 360)]));
    const fieldMeanings = new Map();
    for (const entity of arr(result?.fieldDescriptions)) {
      const allowed = allowedFields.get(key(entity?.entityName));
      if (!allowed) continue;
      for (const field of arr(entity?.fields)) {
        if (!field?.name || !field?.description || !allowed.has(key(field.name))) continue;
        fieldMeanings.set(`${key(entity.entityName)}|${key(field.name)}`, clean(field.description, 300));
      }
    }

    for (const arc of this.businessArcs()) {
      const details = arr(arc.entityDetails);
      const byName = new Map(details.map((item) => [key(item?.name), item]));
      for (const [entityKey, description] of entityMeanings) {
        const matchingName = this.entityNamesForArc(arc).find((name) => key(name) === entityKey);
        if (!matchingName) continue;
        let detail = byName.get(entityKey);
        if (!detail) { detail = { name: matchingName, description: '', fields: [] }; details.push(detail); byName.set(entityKey, detail); }
        if (!detail.description && description) { detail.description = description; changed += 1; }
      }
      for (const target of packet.descriptions) {
        const schema = this.topology.entitySchema?.(target.name);
        if (!schema) continue;
        const appears = this.entityNamesForArc(arc).some((name) => key(name) === key(target.name));
        if (!appears) continue;
        let detail = byName.get(key(target.name));
        if (!detail) { detail = { name: schema.name, description: clean(schema.description, 360), fields: [] }; details.push(detail); byName.set(key(target.name), detail); }
        const byField = new Map(arr(detail.fields).map((field) => [key(field?.name), field]));
        for (const field of target.fields) {
          const meaning = fieldMeanings.get(`${key(target.name)}|${key(field.name)}`);
          if (!meaning) continue;
          const existing = byField.get(key(field.name));
          if (existing) {
            if (!existing.description) { existing.description = meaning; changed += 1; }
          } else {
            detail.fields.push({ name: field.name, description: meaning });
            byField.set(key(field.name), detail.fields.at(-1));
            changed += 1;
          }
        }
      }
      arc.entityDetails = details;
    }
    return changed;
  }

  markAttempts(packet) {
    const state = this.reconciliationState();
    const timestamp = new Date().toISOString();
    for (const target of packet.unresolved) state.attemptsByEntity[key(target.name)] = { fingerprint: target.fingerprint, attemptedAt: timestamp, contextCount: target.contexts.length, candidateCount: target.candidates.length };
    for (const target of packet.descriptions) state.descriptionAttempts[key(target.name)] = { fingerprint: target.fingerprint, attemptedAt: timestamp, fieldCount: target.fields.length };
  }

  async reconcileEntityBatch(reason = 'batch') {
    const packet = this.reconciliationPacket();
    if (!packet.unresolved.length && !packet.descriptions.length) return { called: false, changed: 0 };

    const allowedByBusiness = new Map(packet.unresolved.map((target) => [key(target.name), new Set(target.candidates.map((candidate) => candidate.name))]));
    const compactPacket = {
      unresolved: packet.unresolved.map((target) => ({ name: target.name, contexts: target.contexts, candidates: target.candidates })),
      fieldDescriptionTargets: packet.descriptions.map((target) => ({ name: target.name, contexts: target.contexts, fields: target.fields }))
    };
    const contract = {
      mappings: [{ businessEntity: 'exact supplied unresolved name', physicalEntities: [{ name: 'exact supplied candidate name', relation: 'represented_by|stored_in|identified_by|referenced_through', confidence: 0.0, description: 'short', evidence: 'specific supplied context' }] }],
      entityDescriptions: [{ name: 'exact supplied entity name', description: 'short business meaning grounded in supplied contexts' }],
      fieldDescriptions: [{ entityName: 'exact supplied field-description target', fields: [{ name: 'exact supplied field name', description: 'one short business meaning or empty' }] }]
    };
    const prompt = [
      'MODE batch-entity-reconciliation-v1',
      `REASON ${reason}`,
      `EVIDENCE_PACKET ${JSON.stringify(compactPacket)}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Map an unresolved business entity only to supplied candidate schema entities.',
      '- Multiple workflow contexts may support one semantic entity; reason across them together.',
      '- Prefer no mapping when evidence is still incomplete; the entity can wait for a later batch.',
      '- Describe only exact supplied schema fields. Never add or rename fields.',
      '- Keep descriptions to one short sentence and leave them empty if the meaning is not supportable.',
      '- Keep output minimal.'
    ].join('\n');

    try {
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: {
          id: `entity-reconcile:${this.state.step}:${reason}`,
          path: 'cross-workflow entity reconciliation',
          kind: 'entity_batch_reconciliation',
          canonical: { unresolvedCount: packet.unresolved.length, descriptionEntityCount: packet.descriptions.length }
        },
        candidates: [],
        before: this.snapshot(),
        maxTokens: undefined,
        retry: false
      });
      const parsed = JSON.parse(result.raw || '{}');
      const mappingChanges = this.applyMappings(parsed.mappings, allowedByBusiness);
      const descriptionChanges = this.applyDescriptions(parsed, packet);
      this.markAttempts(packet);

      for (const arc of this.businessArcs()) {
        this.enrichArcEntitySchemas(arc);
        this.syncArcSemanticObjects(arc);
      }
      this.persistSemanticMap?.();

      const changed = mappingChanges + descriptionChanges;
      const state = this.reconciliationState();
      state.lastRunAtReviewedCount = arr(this.scout().ensureState().reviewedCallPathIds).length;
      state.runs.push({
        step: this.state.step,
        timestamp: new Date().toISOString(),
        reason,
        unresolvedSent: packet.unresolved.map((item) => item.name),
        descriptionEntitiesSent: packet.descriptions.map((item) => item.name),
        mappingChanges,
        descriptionChanges
      });
      state.runs = state.runs.slice(-80);
      await this.appendRunLog({
        type: 'entity_batch_reconciliation_applied',
        call: result.callNumber,
        explorationStep: this.state.step,
        timestamp: new Date().toISOString(),
        reason,
        unresolvedSent: packet.unresolved.map((item) => item.name),
        descriptionEntitiesSent: packet.descriptions.map((item) => item.name),
        mappingChanges,
        descriptionChanges,
        parsedResponse: parsed
      });
      this.printCallSummary(result.usage, result.callNumber, `batch reconciliation +${changed} semantic updates`);
      return { called: true, changed };
    } catch (error) {
      await this.appendRunLog({ type: 'entity_batch_reconciliation_failed', explorationStep: this.state.step, timestamp: new Date().toISOString(), reason, error: error.message });
      return { called: true, changed: 0, error: error.message };
    }
  }

  async runScout(candidates) {
    await this.reconcileEntityBatch('before-next-scout-batch');
    return super.runScout(candidates);
  }

  async finalReconciliation() {
    const state = this.reconciliationState();
    let totalChanged = 0;
    for (let i = 0; i < 3; i += 1) {
      const result = await this.reconcileEntityBatch(`final-${i + 1}`);
      state.finalPasses += 1;
      totalChanged += Number(result.changed || 0);
      if (!result.called || !result.changed) break;
    }
    return totalChanged;
  }

  async resolveNextAction(action, candidates) {
    const next = await super.resolveNextAction(action, candidates);
    if (next) return next;
    await this.finalReconciliation();
    this.state.lastMessage = 'All call-path batches are exhausted; final semantic reconciliation is complete.';
    this.persistSemanticMap?.();
    return null;
  }
};

export default withEntityReconciliation;
