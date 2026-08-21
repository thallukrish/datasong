import { ProgressiveRepositoryExplorerV50 } from './progressiveRepositoryExplorerV50.js';

const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 520) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const REPRESENTATION_SYSTEM = `You are lemap's BUSINESS-TO-PHYSICAL ENTITY RESOLVER.
You receive an already-interpreted workflow, unresolved business entities, and a deterministic list of candidate physical/schema entities.
For each unresolved business entity, select only candidate physical entities that the supplied workflow evidence supports as representing, storing, identifying, or referencing that business entity.
Never invent an entity name and never use general framework knowledge beyond the supplied candidates/evidence.
It is valid to return no mapping when evidence is insufficient.
Return strict JSON only.`;

export class ProgressiveRepositoryExplorerV51 extends ProgressiveRepositoryExplorerV50 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'post-pass2-business-physical-resolution-v35';
    return state;
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE business-physical-resolution-v1')) {
      return this.lightweightModelCall(REPRESENTATION_SYSTEM, dynamicPrompt, 'BUSINESS ENTITY REPRESENTATION');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  unresolvedBusinessEntities(parsed) {
    const mapped = new Set(arr(parsed?._entityRepresentations).map((item) => key(item?.businessEntity)));
    return arr(parsed?._structuredWorkflow?.entityDetails)
      .map((item) => String(item?.name || ''))
      .filter(Boolean)
      .filter((name) => !this.topology.entitySchema?.(name))
      .filter((name) => !mapped.has(key(name)))
      .slice(0, 8);
  }

  candidateSchemasFor(businessName, parsed) {
    const businessKey = key(businessName);
    const candidates = new Map();
    const add = (schema, score, why) => {
      if (!schema?.name) return;
      const name = String(schema.name);
      const prior = candidates.get(name);
      if (!prior || score > prior.score) candidates.set(name, {
        name,
        fullName: String(schema.fullName || ''),
        description: clean(schema.description, 220),
        fieldNames: arr(schema.fields).map((f) => String(f?.name || '')).filter(Boolean).slice(0, 18),
        score,
        why
      });
    };

    // Any concrete schema already touched by the interpreted workflow is a strong contextual candidate.
    const mentioned = new Set();
    for (const entity of arr(parsed?._structuredWorkflow?.entityDetails)) if (entity?.name) mentioned.add(String(entity.name));
    for (const step of arr(parsed?._structuredWorkflow?.workflowSteps)) {
      for (const name of [...arr(step?.entities), ...arr(step?.persistentObjects)]) if (name) mentioned.add(String(name));
    }
    for (const rawName of mentioned) {
      const schema = this.topology.entitySchema?.(rawName);
      if (schema) add(schema, 5, 'Concrete schema entity already touched by this workflow');
    }

    // Name-related schema entities are deterministic candidates, not asserted mappings.
    for (const schema of arr(this.topology.entitySchemas)) {
      const schemaKey = key(schema?.name);
      if (!schemaKey || schemaKey === businessKey) continue;
      let score = 0;
      if (schemaKey.startsWith(businessKey)) score += 8;
      else if (schemaKey.includes(businessKey)) score += 5;
      const idField = `${businessKey}id`;
      if (arr(schema?.fields).some((field) => key(field?.name) === idField)) score += 3;
      if (score) add(schema, score, 'Name/identifier similarity to unresolved business entity');
    }

    return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 14);
  }

  workflowEvidence(parsed, observation) {
    return {
      workflow: this.fieldContext(parsed),
      flowSequence: arr(observation?.canonical?.executableFlow?.flowSequence).slice(0, 20),
      signatures: arr(observation?.canonical?.executableFlow?.signatures).slice(0, 24).map((v) => clean(v, 260)),
      sourcePaths: arr(observation?.canonical?.executableFlow?.sourcePaths).slice(0, 8)
    };
  }

  mergeRepresentations(parsed, resolved, allowedByBusiness) {
    if (!Array.isArray(resolved?.mappings)) return 0;
    const existing = arr(parsed._entityRepresentations);
    const seen = new Set(existing.map((item) => `${key(item?.businessEntity)}|${key(item?.physicalEntity)}|${String(item?.relation || 'represented_by')}`));
    let added = 0;
    for (const mapping of resolved.mappings) {
      const businessEntity = String(mapping?.businessEntity || '');
      const allowed = allowedByBusiness.get(key(businessEntity));
      if (!allowed) continue;
      for (const item of arr(mapping?.physicalEntities)) {
        const physicalEntity = String(item?.name || item?.physicalEntity || '');
        if (!allowed.has(physicalEntity)) continue;
        const relation = ['represented_by','stored_in','identified_by','referenced_through'].includes(item?.relation) ? item.relation : 'represented_by';
        const compound = `${key(businessEntity)}|${key(physicalEntity)}|${relation}`;
        if (seen.has(compound)) continue;
        seen.add(compound);
        existing.push({
          businessEntity,
          physicalEntity,
          relation,
          description: clean(item?.description, 420),
          confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
          evidence: clean(item?.evidence, 420)
        });
        added += 1;
      }
    }
    parsed._entityRepresentations = existing;
    return added;
  }

  async resolveMissingRepresentations(parsed, observation) {
    if (!parsed?._wholeFlowPass2 || observation?.canonical?.kind === 'call_graph_branch_summary') return 0;
    const unresolved = this.unresolvedBusinessEntities(parsed);
    if (!unresolved.length) return 0;

    const candidateSets = [];
    const allowedByBusiness = new Map();
    for (const businessEntity of unresolved) {
      const candidates = this.candidateSchemasFor(businessEntity, parsed);
      if (!candidates.length) continue;
      allowedByBusiness.set(key(businessEntity), new Set(candidates.map((c) => c.name)));
      candidateSets.push({ businessEntity, candidates });
    }
    if (!candidateSets.length) return 0;

    const contract = {
      mappings: [{
        businessEntity: 'exact supplied business entity',
        physicalEntities: [{ name: 'exact supplied candidate name', relation: 'represented_by|stored_in|identified_by|referenced_through', confidence: 0.0, description: 'short explanation', evidence: 'specific supplied workflow evidence' }]
      }]
    };
    const prompt = [
      'MODE business-physical-resolution-v1',
      `WORKFLOW_EVIDENCE ${JSON.stringify(this.workflowEvidence(parsed, observation))}`,
      `UNRESOLVED_AND_CANDIDATES ${JSON.stringify(candidateSets)}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Use only supplied candidate names.',
      '- Prefer no mapping over a weak guess.',
      '- Multiple physical entities are allowed when the workflow evidence shows the business entity spans them.',
      '- The mapping is semantic evidence; the physical schema itself remains authoritative deterministic evidence.'
    ].join('\n');

    try {
      const result = await this.callAndRecordAttempt({
        dynamicPrompt: prompt,
        observation: {
          id: `entity-representation:${this.fieldContext(parsed).arcId || this.state.step}`,
          path: observation?.path || '',
          kind: 'business_entity_representation_resolution',
          canonical: { unresolvedCount: candidateSets.length }
        },
        candidates: [], before: this.snapshot(), maxTokens: undefined, retry: false
      });
      const resolved = JSON.parse(result.raw || '{}');
      const added = this.mergeRepresentations(parsed, resolved, allowedByBusiness);
      await this.appendRunLog({
        type: 'business_entity_representations_resolved', call: result.callNumber,
        explorationStep: this.state.step, timestamp: new Date().toISOString(),
        unresolved, added, parsedResponse: resolved
      });
      this.printCallSummary(result.usage, result.callNumber, `resolved ${added} business→physical representation${added === 1 ? '' : 's'}`);
      return added;
    } catch (error) {
      await this.appendRunLog({
        type: 'business_entity_representation_resolution_skipped', explorationStep: this.state.step,
        timestamp: new Date().toISOString(), unresolved, error: error.message
      });
      return 0;
    }
  }

  async getSemanticUpdate(args) {
    const result = await super.getSemanticUpdate(args);
    if (!result?.parsed?._wholeFlowPass2) return result;
    const added = await this.resolveMissingRepresentations(result.parsed, args.observation);
    if (added > 0) await this.enrichResolvedFieldMeanings(result.parsed, args.observation);
    return result;
  }
}
