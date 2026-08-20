import { ProgressiveRepositoryExplorerV47 } from './progressiveRepositoryExplorerV47.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function uniq(values) { return [...new Set(arr(values).filter(Boolean).map(String))]; }

export class ProgressiveRepositoryExplorerV48 extends ProgressiveRepositoryExplorerV47 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'structured-workflow-semantics-v28';
    return state;
  }

  compactFlowPackage(arc) {
    const base = super.compactFlowPackage(arc);
    if (!base) return null;
    const grouped = this.groupedPathForArc(arc);
    return {
      ...base,
      sourcePaths: uniq(grouped?.sourcePaths),
      entrySymbolId: grouped?.entrySymbolId || '',
      signatures: arr(grouped?.signatures)
    };
  }

  wholeFlowPrompt(observation) {
    const arc = this.pass1().activeArc();
    const state = this.flowState(arc);
    const flow = observation?.canonical?.executableFlow || {};
    const branchCount = arr(flow?.flow?.branches).length;
    const arcView = arc ? {
      arcId: arc.id,
      title: arc.title || '',
      actor: arc.businessActor || arc.trigger || '',
      intent: arc.businessIntent || '',
      completionCondition: arc.completionCondition || '',
      businessOutcome: arc.businessOutcome || arc.outcome || '',
      knownStages: arr(arc.majorStages),
      knownEntities: arr(arc.entities),
      knownPersistentObjects: arr(arc.persistentObjects),
      knownRelationships: arr(arc.relationships)
    } : null;

    const contract = {
      meaning: 'brief business interpretation of the supplied complete flow or branch',
      arcFit: { continuity: 0, coherence: 0, expectedGain: 0, reason: 'brief' },
      arcUpdate: {
        evidenceRole: 'major|supporting|trivial',
        trigger: 'business event or actor action that starts this workflow, only when evidenced',
        majorStages: ['short stage labels for compatibility'],
        workflowSteps: [{
          name: 'short business step name',
          description: 'what actually happens in this step and why it matters',
          entities: ['business entities participating in this step'],
          persistentObjects: ['records/documents/tables persisted or read in this step'],
          effect: 'state change or visible result of this step',
          sourcePath: 'best matching supplied source path when directly inferable, else empty'
        }],
        outcome: 'business outcome/effect evidenced by this supplied flow',
        entities: ['major business entity names for compatibility'],
        entityDetails: [{
          name: 'entity name',
          description: 'business meaning of this entity in the workflow'
        }],
        persistentObjects: ['persisted records/entities/documents directly evidenced'],
        relationships: ['short relationship labels for compatibility, e.g. Customer places Order'],
        relationshipDetails: [{
          from: 'source entity or step',
          relation: 'business relationship/action',
          to: 'target entity or step',
          description: 'scenario explaining what this relation means in this workflow'
        }],
        externalEffects: ['externally visible effects directly evidenced'],
        status: 'forming|broadly_complete|unresolved'
      },
      unresolvedBranches: [{ branchIndex: '0-based exact branch index', reason: 'why branch needs separate pass' }],
      flowAction: 'complete|inspect_branches|scout'
    };

    return [
      'MODE pass2-whole-compressed-flow-v1',
      'SCHEMA structured-workflow-semantics-v2',
      `ACTIVE_ARC ${JSON.stringify(arcView)}`,
      `EXECUTABLE_FLOW ${JSON.stringify(flow)}`,
      `ALREADY_INTERPRETED_BRANCHES ${JSON.stringify(arr(state?.interpretedBranchIndexes))}`,
      `RETURN ${JSON.stringify(contract)}`,
      'Rules:',
      '- Reconstruct a business workflow, not a bag of labels.',
      '- workflowSteps must be ordered in executable/business sequence.',
      '- Every step description must explain what happens; do not return only a noun or verb phrase.',
      '- Attach entities and persistent objects to the particular step that touches them when evidenced.',
      '- relationshipDetails must explicitly connect from -> relation -> to and explain the business scenario.',
      '- entityDetails must explain what each entity represents in this workflow.',
      '- sourcePath is provenance, not semantics. Use a supplied source path only when it reasonably matches the step; otherwise leave empty.',
      '- Use only evidence in the supplied deterministic flow. Never invent database objects or business behavior.',
      '- unresolvedBranches is normally empty; use only for materially ambiguous supplied branches.',
      `- Valid unresolved branch indexes are 0..${Math.max(-1, branchCount - 1)}.`,
      '- flowAction=complete when this supplied flow is semantically interpreted.',
      '- Never request repository artifacts, neighbors, or searches.',
      '- Keep output compact but descriptive.'
    ].join('\n');
  }

  normalizeWholeFlowPass2(raw, observation) {
    const parsed = super.normalizeWholeFlowPass2(raw, observation);
    const update = raw?.arcUpdate && typeof raw.arcUpdate === 'object'
      ? raw.arcUpdate
      : (raw?.arcFit?.arcUpdate && typeof raw.arcFit.arcUpdate === 'object' ? raw.arcFit.arcUpdate : {});
    parsed._structuredWorkflow = {
      trigger: text(update.trigger, 260),
      workflowSteps: arr(update.workflowSteps).map((step) => ({
        name: text(step?.name, 180),
        description: text(step?.description, 520),
        entities: uniq(step?.entities).slice(0, 12),
        persistentObjects: uniq(step?.persistentObjects).slice(0, 12),
        effect: text(step?.effect, 320),
        sourcePath: text(step?.sourcePath, 320)
      })).filter((step) => step.name || step.description),
      entityDetails: arr(update.entityDetails).map((entity) => ({
        name: text(entity?.name, 160),
        description: text(entity?.description, 420)
      })).filter((entity) => entity.name),
      relationshipDetails: arr(update.relationshipDetails).map((rel) => ({
        from: text(rel?.from, 180),
        relation: text(rel?.relation, 180),
        to: text(rel?.to, 180),
        description: text(rel?.description, 520)
      })).filter((rel) => rel.from || rel.relation || rel.to)
    };
    return parsed;
  }

  applyDelta(parsed, observation) {
    const arcId = parsed?._wholeFlowPass2 ? String(parsed?.arcUpdate?.arcId || this.pass1().activeArcId() || '') : '';
    const result = super.applyDelta(parsed, observation);
    if (!arcId || !parsed?._structuredWorkflow) return result;
    const arc = this.pass1().arcByReference(arcId);
    if (!arc) return result;
    const detail = parsed._structuredWorkflow;
    if (detail.trigger) arc.trigger = detail.trigger;
    if (detail.workflowSteps.length) arc.workflowSteps = detail.workflowSteps;
    if (detail.entityDetails.length) arc.entityDetails = detail.entityDetails;
    if (detail.relationshipDetails.length) arc.relationshipDetails = detail.relationshipDetails;
    this.persistSemanticMap?.();
    return result;
  }
}
