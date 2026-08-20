import fs from 'node:fs';
import path from 'node:path';
import { ProgressiveRepositoryExplorerV46 } from './progressiveRepositoryExplorerV46.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function uniq(values) { return [...new Set(arr(values).filter(Boolean).map(String))]; }
function text(value, max = 520) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function meaningfulOutcome(value) {
  const s = String(value || '').trim();
  return !!s && !/^(no outcome|none|unknown|not evidenced)/i.test(s);
}

export class ProgressiveRepositoryExplorerV47 extends ProgressiveRepositoryExplorerV46 {
  constructor(args) {
    super(args);
    this.loadMostRecentPersistedMap();
  }

  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'structured-workflow-semantics-v28';
    return state;
  }

  async run(repoUrl) {
    this._mapRestoreAttempted = false;
    this._mapRestored = false;
    this._stoppedByUser = false;
    return super.run(repoUrl);
  }

  persistedMaps() {
    const dir = this.mapDirectory();
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = path.join(dir, name);
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Number(saved?.version || 0) !== 2 || !saved?.semanticState || !saved?.repoUrl || !saved?.commit) continue;
        out.push(saved);
      } catch {}
    }
    return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  installPersistedMap(saved) {
    if (!saved?.semanticState) return null;
    const restored = clone(saved.semanticState);
    restored.repoUrl = saved.repoUrl;
    restored.commit = saved.commit;
    restored.status = 'complete';
    restored.stopRequested = false;
    restored.currentArtifact = null;
    restored.frontier = [];
    restored.executionStack = [];
    restored.mapPersistence = {
      restored: true,
      savedAt: saved.savedAt || '',
      repoUrl: saved.repoUrl,
      commit: saved.commit,
      version: Number(saved.version || 2)
    };
    restored.lastMessage = 'Loaded the existing enterprise map. Start learning to continue from where it stopped.';
    this.state = restored;
    this._mapRestoreAttempted = true;
    this._mapRestored = true;
    this._stoppedByUser = false;
    return this.snapshot();
  }

  loadMostRecentPersistedMap() {
    const saved = this.persistedMaps()[0];
    return saved ? this.installPersistedMap(saved) : null;
  }

  loadLatestPersistedMapForRepo(repoUrl) {
    const wanted = String(repoUrl || '').trim();
    if (!wanted) return null;
    const saved = this.persistedMaps().find((item) => String(item.repoUrl || '').trim() === wanted);
    return saved ? this.installPersistedMap(saved) : null;
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
        trigger: 'business event or actor action that starts the workflow, if evidenced',
        workflowSteps: [{
          name: 'short business step name',
          description: 'what actually happens in this step and why it matters',
          entities: ['business entities participating in this step'],
          persistentObjects: ['records/documents persisted or read in this step'],
          effect: 'state change or visible result',
          sourcePath: 'best matching supplied source path, else empty'
        }],
        entityDetails: [{ name: 'entity name', description: 'business meaning of this entity in this workflow' }],
        relationshipDetails: [{
          from: 'source entity or step',
          relation: 'business relationship/action',
          to: 'target entity or step',
          description: 'scenario explaining what this relationship means here'
        }],
        outcome: 'business outcome/effect evidenced by this flow',
        persistentObjects: ['persisted records/entities/documents directly evidenced'],
        externalEffects: ['externally visible effects directly evidenced'],
        status: 'forming|broadly_complete|unresolved'
      },
      unresolvedBranches: [{ branchIndex: '0-based exact branch index', reason: 'why branch needs separate semantic pass' }],
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
      '- Reconstruct an ordered business workflow, not a bag of labels.',
      '- workflowSteps must follow executable/business sequence from trigger to outcome.',
      '- Every step description must explain what happens, which entities/records participate, and the effect when evidenced.',
      '- relationshipDetails must explicitly connect from -> relation -> to and explain the business scenario.',
      '- entityDetails must explain what each entity represents in this workflow.',
      '- Attach sourcePath to the individual step when a supplied source path reasonably matches it; otherwise leave empty.',
      '- Use only evidence in the supplied deterministic flow. Never invent persistence or behavior.',
      '- unresolvedBranches is normally empty and only for materially ambiguous supplied branches.',
      `- Valid unresolved branch indexes are 0..${Math.max(-1, branchCount - 1)}.`,
      '- flowAction=complete when the supplied flow is semantically interpreted.',
      '- Never request repository artifacts, neighbors, or searches.',
      '- Keep output compact but descriptive.'
    ].join('\n');
  }

  normalizeWholeFlowPass2(raw, observation) {
    const fit = raw?.arcFit && typeof raw.arcFit === 'object' ? raw.arcFit : {};
    const repaired = { ...(raw || {}) };
    if ((!repaired.arcUpdate || typeof repaired.arcUpdate !== 'object') && fit.arcUpdate && typeof fit.arcUpdate === 'object') repaired.arcUpdate = fit.arcUpdate;
    if (!Array.isArray(repaired.unresolvedBranches) && Array.isArray(fit.unresolvedBranches)) repaired.unresolvedBranches = fit.unresolvedBranches;
    if (!repaired.flowAction && fit.flowAction) repaired.flowAction = fit.flowAction;

    const update = repaired.arcUpdate && typeof repaired.arcUpdate === 'object' ? repaired.arcUpdate : {};
    const steps = arr(update.workflowSteps).map((step) => ({
      name: text(step?.name, 180), description: text(step?.description, 520), entities: uniq(step?.entities).slice(0, 12),
      persistentObjects: uniq(step?.persistentObjects).slice(0, 12), effect: text(step?.effect, 320), sourcePath: text(step?.sourcePath, 320)
    })).filter((step) => step.name || step.description);
    const entityDetails = arr(update.entityDetails).map((entity) => ({
      name: text(entity?.name, 160), description: text(entity?.description, 420)
    })).filter((entity) => entity.name);
    const relationshipDetails = arr(update.relationshipDetails).map((rel) => ({
      from: text(rel?.from, 180), relation: text(rel?.relation, 180), to: text(rel?.to, 180), description: text(rel?.description, 520)
    })).filter((rel) => rel.from || rel.relation || rel.to);

    repaired.arcUpdate = {
      ...update,
      majorStages: steps.map((step) => {
        const body = [step.description, step.effect ? `Effect: ${step.effect}` : ''].filter(Boolean).join(' ');
        return body ? `${step.name} — ${body}` : step.name;
      }),
      entities: uniq([...(arr(update.entities)), ...entityDetails.map((entity) => entity.name), ...steps.flatMap((step) => step.entities)]),
      persistentObjects: uniq([...(arr(update.persistentObjects)), ...steps.flatMap((step) => step.persistentObjects)]),
      relationships: relationshipDetails.map((rel) => {
        const edge = [rel.from, rel.relation, rel.to].filter(Boolean).join(' → ');
        return rel.description ? `${edge} — ${rel.description}` : edge;
      })
    };

    const parsed = super.normalizeWholeFlowPass2(repaired, observation);
    parsed._structuredWorkflow = {
      trigger: text(update.trigger, 260), workflowSteps: steps, entityDetails, relationshipDetails
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

  evidenceDepth(arc) {
    const stages = arr(arc?.workflowSteps).length ? arr(arc.workflowSteps) : arr(arc?.majorStages);
    const entities = arr(arc?.entities);
    const persistent = arr(arc?.persistentObjects);
    const relationships = arr(arc?.relationshipDetails).length ? arr(arc.relationshipDetails) : arr(arc?.relationships);
    const effects = arr(arc?.externalEffects);
    const outcome = arc?.outcome || arc?.businessOutcome || '';
    const dimensions = [stages.length >= 2, entities.length >= 2, persistent.length >= 1, relationships.length >= 1, effects.length >= 1].filter(Boolean).length;
    return { stages: stages.length, entities: entities.length, persistentObjects: persistent.length, relationships: relationships.length,
      externalEffects: effects.length, hasOutcome: meaningfulOutcome(outcome), dimensions,
      sufficient: dimensions >= 2 || stages.length >= 3 || (entities.length >= 2 && meaningfulOutcome(outcome)) };
  }

  closeCompletedArcs() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const flow = this.state?.pass2WholeFlowByArc?.[arc.id];
      if (!flow) continue;
      const noPendingBranches = arr(flow.pendingBranchIndexes).length === 0;
      const interpreted = Number(flow.wholeFlowCalls || 0) > 0 || Number(flow.branchCalls || 0) > 0;
      if (!interpreted || !noPendingBranches) continue;
      const depth = this.evidenceDepth(arc);
      flow.businessEvidenceDepth = depth;
      if (depth.sufficient && flow.completed) {
        arc.closureState = 'closed'; arc.closureReason = 'compressed path interpreted with sufficient business evidence';
        arc.closedAt = arc.closedAt || new Date().toISOString(); arc.progress = 100;
        if (arc.status !== 'unresolved') arc.status = 'broadly_complete'; arc.opportunityScore = 0;
      } else if (flow.completed) {
        arc.closureState = 'needs_more_evidence';
        arc.closureReason = 'path interpreted but insufficient business steps/entities/relationships were evidenced';
        arc.progress = Math.min(Number(arc.progress || 0), 60); arc.status = 'unresolved'; arc.opportunityScore = 0;
      }
    }
  }
}
