import { ProgressiveRepositoryExplorerV48 } from './progressiveRepositoryExplorerV48.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 520) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const FIELD_SYSTEM = `You are lemap's FIELD SEMANTICS ENRICHER.
You receive one already-interpreted business workflow plus exact authoritative entity-schema fields discovered deterministically after workflow interpretation.
Describe only the supplied fields in concise business language using the supplied workflow context.
Never add fields, rename fields, infer values, or invent schema. If the meaning cannot be reasonably inferred from the name/type/workflow context, use an empty description.
Return strict JSON only.`;

export class ProgressiveRepositoryExplorerV50 extends ProgressiveRepositoryExplorerV48 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'post-schema-field-semantics-v34';
    return state;
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE field-semantic-enrichment-v1')) {
      return this.lightweightModelCall(FIELD_SYSTEM, dynamicPrompt, 'FIELD SEMANTIC ENRICHMENT');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  schemaPackets(parsed) {
    const names = new Set();
    for (const entity of arr(parsed?._structuredWorkflow?.entityDetails)) if (entity?.name) names.add(String(entity.name));
    for (const representation of arr(parsed?._entityRepresentations)) if (representation?.physicalEntity) names.add(String(representation.physicalEntity));
    for (const step of arr(parsed?._structuredWorkflow?.workflowSteps)) {
      for (const name of [...arr(step?.entities), ...arr(step?.persistentObjects)]) if (name) names.add(String(name));
    }

    const packets = [];
    for (const rawName of names) {
      const schema = this.topology.entitySchema?.(rawName) || null;
      if (!schema) continue;
      const exactName = String(schema.name || rawName);
      const learned = arr(parsed?._structuredWorkflow?.entityDetails).find((item) => key(item?.name) === key(exactName)) || {};
      const learnedFields = new Map(arr(learned.fields).map((field) => [key(field?.name), clean(field?.description, 420)]));
      const missing = arr(schema.fields)
        .filter((field) => field?.name)
        .filter((field) => !clean(field.description, 420) && !learnedFields.get(key(field.name)))
        .slice(0, 50)
        .map((field) => ({ name: String(field.name), type: String(field.type || ''), isPk: !!field.isPk }));
      if (!missing.length) continue;
      packets.push({
        name: exactName,
        description: clean(schema.description || learned.description || '', 300),
        fields: missing
      });
      if (packets.length >= 7) break;
    }
    return packets;
  }

  fieldContext(parsed) {
    const arcId = String(parsed?.arcUpdate?.arcId || this.pass1().activeArcId() || '');
    const arc = this.pass1().arcByReference(arcId) || this.pass1().activeArc();
    const steps = arr(parsed?._structuredWorkflow?.workflowSteps).slice(0, 12).map((step) => ({
      name: clean(step?.name, 140),
      description: clean(step?.description, 260),
      entities: arr(step?.entities).slice(0, 8),
      persistentObjects: arr(step?.persistentObjects).slice(0, 8),
      effect: clean(step?.effect, 180)
    }));
    return {
      arcId,
      title: clean(arc?.title, 180),
      actor: clean(arc?.businessActor || arc?.trigger, 140),
      intent: clean(arc?.businessIntent, 240),
      outcome: clean(arc?.outcome || arc?.businessOutcome, 240),
      steps
    };
  }

  mergeFieldMeanings(parsed, enriched) {
    if (!parsed?._structuredWorkflow || !Array.isArray(enriched?.entities)) return;
    const details = arr(parsed._structuredWorkflow.entityDetails);
    const byName = new Map(details.map((item) => [key(item?.name), item]));

    for (const entity of enriched.entities) {
      const schema = this.topology.entitySchema?.(entity?.name) || null;
      if (!schema) continue;
      const schemaFields = new Map(arr(schema.fields).map((field) => [key(field?.name), field]));
      let target = byName.get(key(schema.name));
      if (!target) {
        target = { name: String(schema.name), description: clean(schema.description, 420), fields: [] };
        details.push(target);
        byName.set(key(schema.name), target);
      }
      const current = new Map(arr(target.fields).map((field) => [key(field?.name), field]));
      for (const item of arr(entity?.fields)) {
        const schemaField = schemaFields.get(key(item?.name));
        if (!schemaField) continue;
        const description = clean(item?.description, 420);
        if (!description) continue;
        const existing = current.get(key(schemaField.name));
        if (existing) existing.description = existing.description || description;
        else {
          const added = { name: String(schemaField.name), description };
          target.fields.push(added);
          current.set(key(schemaField.name), added);
        }
      }
    }
    parsed._structuredWorkflow.entityDetails = details;
  }

  async enrichResolvedFieldMeanings(parsed, observation) {
    if (!parsed?._wholeFlowPass2 || observation?.canonical?.kind === 'call_graph_branch_summary') return;
    const entities = this.schemaPackets(parsed);
    if (!entities.length) return;
    const workflow = this.fieldContext(parsed);
    const contract = { entities: [{ name: 'exact supplied entity name', fields: [{ name: 'exact supplied field name', description: 'brief business meaning or empty' }] }] };
    const prompt = [
      'MODE field-semantic-enrichment-v1',
      `WORKFLOW ${JSON.stringify(workflow)}`,
      `AUTHORITATIVE_SCHEMA_FIELDS ${JSON.stringify(entities)}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Return only supplied entity and field names.',
      '- Describe meaning in the context of this workflow where evidence permits.',
      '- Do not fabricate meanings merely to avoid an empty description.',
      '- Keep each description to one short sentence.'
    ].join('\n');

    try {
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: {
          id: `field-semantics:${workflow.arcId || this.state.step}`,
          path: observation?.path || '',
          kind: 'field_semantic_enrichment',
          canonical: { arcId: workflow.arcId, entityCount: entities.length }
        },
        candidates: [],
        before: this.snapshot(),
        maxTokens: undefined,
        retry: false
      });
      const enriched = JSON.parse(result.raw || '{}');
      this.mergeFieldMeanings(parsed, enriched);
      await this.appendRunLog({
        type: 'field_semantics_enriched',
        call: result.callNumber,
        explorationStep: this.state.step,
        timestamp: new Date().toISOString(),
        arcId: workflow.arcId,
        entityCount: entities.length,
        parsedResponse: enriched
      });
      this.printCallSummary(result.usage, result.callNumber, `described schema fields for ${entities.length} entit${entities.length === 1 ? 'y' : 'ies'}`);
    } catch (error) {
      await this.appendRunLog({
        type: 'field_semantics_enrichment_skipped',
        explorationStep: this.state.step,
        timestamp: new Date().toISOString(),
        arcId: workflow.arcId,
        error: error.message
      });
      // Field descriptions are useful enrichment, never a reason to reject an otherwise valid workflow interpretation.
    }
  }

  async getSemanticUpdate(args) {
    const result = await super.getSemanticUpdate(args);
    if (result?.parsed?._wholeFlowPass2) await this.enrichResolvedFieldMeanings(result.parsed, args.observation);
    return result;
  }
}
