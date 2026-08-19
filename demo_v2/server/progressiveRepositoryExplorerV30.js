import { ProgressiveRepositoryExplorerV29 } from './progressiveRepositoryExplorerV29.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const CALL_PATH_SYSTEM_V2 = `You are DataSong's CALL-PATH BUSINESS-FLOW SEED CLASSIFIER.
You receive only deterministic reconstructed executable-path signatures from the supplied repository boundary.
Do not reconstruct source code and do not assume implementations for external calls.
Classify each grouped path as business_flow, technical, subflow, or uncertain.
A business_flow should represent one coherent recognizable actor/business goal with a completion condition and outcome. A subflow is meaningful business behavior that is contained in a broader supplied flow.
Edge labels matter: CALL/NEXT/TRIGGER usually continue execution. NAVIGATE is a weak semantic-continuity edge and may mark the end of one actor goal and entry into another.
If a semantic boundary exists, classify and name only the coherent prefix up to that boundary; do not merge the behavior after the boundary into the same flow.
Compare the supplied paths with one another. Identify when one is a broader flow, a subflow of another, an alternate entrance, or independent.
Return strict compact JSON only.`;

export class ProgressiveRepositoryExplorerV30 extends ProgressiveRepositoryExplorerV29 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-boundary-containment-pass1-pass2-v10';
    return state;
  }

  compactCallPath(path) {
    return {
      pathId: path.id,
      functionCount: path.functionCount,
      branchVariantCount: Number(path.branchVariantCount || 1),
      rendered: path.rendered,
      branchSummary: arr(path.alternatives).length
        ? arr(path.alternatives).slice(0, 8).map((alt) => ({
          pathId: alt.pathId,
          functionCount: alt.functionCount,
          terminal: alt.terminal?.type || 'end',
          divergentTail: arr(alt.signatures).slice(-3)
        }))
        : [],
      terminal: path.terminal?.type === 'external'
        ? { type: 'external', calls: arr(path.terminal.calls).map((call) => ({ relation: call.relation, name: call.name })) }
        : path.terminal?.type === 'cycle'
          ? { type: 'cycle' }
          : { type: 'end' }
    };
  }

  callPathPrompt() {
    const paths = this.topology.topCallPaths(10).map((path) => this.compactCallPath(path));
    const contract = {
      summary: 'brief assessment of the supplied longest grouped executable paths',
      paths: [{
        pathId: 'exact supplied pathId',
        classification: 'business_flow|technical|subflow|uncertain',
        confidence: 0,
        flowTitle: 'title for the coherent flow segment only',
        businessActor: 'if evidenced',
        businessIntent: 'if evidenced',
        completionCondition: 'if evidenced',
        businessOutcome: 'if evidenced',
        semanticBoundaryAt: 'optional rendered signature or NAVIGATE point where another concern begins',
        relationToOtherPaths: 'broader_flow|subflow|alternate_entrance|independent',
        relatedPathId: 'optional exact supplied pathId',
        coherentThroughSignature: 'optional last signature that belongs to this flow before a semantic boundary',
        reason: 'short evidence-based reason'
      }]
    };
    return `MODE call-path-business-seed-classification-v2\nLONGEST_EXECUTABLE_PATHS ${JSON.stringify(paths)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- Use only supplied rendered paths, compact branch summaries, edge labels and terminal boundaries.\n- Branch variants have already been grouped deterministically; do not expand them into separate flows.\n- External calls terminate the known repository path; never imagine their implementation.\n- CALL/NEXT/TRIGGER normally preserve execution continuity. NAVIGATE is weak semantic continuity.\n- When behavior after a NAVIGATE serves a different actor goal, set semanticBoundaryAt and describe only the coherent prefix as this flow. Never combine both concerns into one flow title/intent/outcome.\n- Compare all supplied paths. If one path substantially contains another business journey, mark the larger one broader_flow and the contained one subflow. If paths reach the same flow from different prefixes, mark alternate_entrance. Otherwise independent.\n- Prefer seeding the broadest coherent business flow; subflows remain useful evidence but should not compete as independent top-level arcs when a supplied broader flow contains them.\n- Mark technical/framework/navigation-only paths technical.\n- Classify every path and keep reasons short.`;
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v2')) {
      return this.lightweightModelCall(CALL_PATH_SYSTEM_V2, dynamicPrompt, 'CALL-PATH BUSINESS-FLOW SEED CLASSIFIER V2');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizeCallPathClassification(raw) {
    const known = new Set(this.topology.topCallPaths(10).map((path) => path.id));
    const allowed = new Set(['business_flow', 'technical', 'subflow', 'uncertain']);
    const relations = new Set(['broader_flow', 'subflow', 'alternate_entrance', 'independent']);
    return {
      _callPathPreprocess: true,
      summary: text(raw?.summary, 400),
      paths: arr(raw?.paths)
        .filter((item) => known.has(item?.pathId))
        .map((item) => ({
          pathId: item.pathId,
          classification: allowed.has(item?.classification) ? item.classification : 'uncertain',
          confidence: clamp01(item?.confidence),
          flowTitle: text(item?.flowTitle, 180),
          businessActor: text(item?.businessActor, 220),
          businessIntent: text(item?.businessIntent, 280),
          completionCondition: text(item?.completionCondition, 300),
          businessOutcome: text(item?.businessOutcome, 320),
          semanticBoundaryAt: text(item?.semanticBoundaryAt, 300),
          relationToOtherPaths: relations.has(item?.relationToOtherPaths) ? item.relationToOtherPaths : 'independent',
          relatedPathId: known.has(item?.relatedPathId) ? item.relatedPathId : '',
          coherentThroughSignature: text(item?.coherentThroughSignature, 320),
          reason: text(item?.reason, 300)
        })),
      next: { type: 'advance' }
    };
  }

  applyDelta(parsed, observation) {
    if (!parsed?._callPathPreprocess) return super.applyDelta(parsed, observation);

    const state = this.state.callPathPreprocess;
    const paths = this.topology.topCallPaths(10);
    const byPath = new Map(paths.map((path) => [path.id, path]));
    const existingTitles = new Map(this.pass1().arcs().map((arc) => [String(arc.title || '').trim().toLowerCase(), arc]));
    const seeded = [];
    const classificationById = new Map(parsed.paths.map((item) => [item.pathId, item]));

    state.classifications = parsed.paths;
    state.reviewedPathIds = parsed.paths.map((item) => item.pathId);

    for (const item of parsed.paths) {
      if (item.classification !== 'business_flow' || item.confidence < 0.55) continue;
      if (!item.flowTitle || !item.businessActor || !item.businessIntent || !item.completionCondition || !item.businessOutcome) continue;

      // A contained flow should not compete with an explicitly supplied broader flow.
      if (item.relationToOtherPaths === 'subflow' && item.relatedPathId) {
        const parent = classificationById.get(item.relatedPathId);
        if (parent?.classification === 'business_flow' && parent?.confidence >= 0.55) continue;
      }

      // Alternate entrances to an already-seeded flow become evidence on that arc.
      if (item.relationToOtherPaths === 'alternate_entrance' && item.relatedPathId) {
        const parent = classificationById.get(item.relatedPathId);
        const parentKey = String(parent?.flowTitle || '').trim().toLowerCase();
        const existing = parentKey ? existingTitles.get(parentKey) : null;
        if (existing) {
          if (!Array.isArray(existing.alternateCallPathIds)) existing.alternateCallPathIds = [];
          if (!existing.alternateCallPathIds.includes(item.pathId)) existing.alternateCallPathIds.push(item.pathId);
          continue;
        }
      }

      const key = item.flowTitle.toLowerCase();
      if (existingTitles.has(key)) {
        const existing = existingTitles.get(key);
        if (!Array.isArray(existing.relatedCallPathIds)) existing.relatedCallPathIds = [];
        if (!existing.relatedCallPathIds.includes(item.pathId)) existing.relatedCallPathIds.push(item.pathId);
        continue;
      }

      const path = byPath.get(item.pathId);
      const arc = this.pass1().createArc({
        title: item.flowTitle,
        concept: item.reason,
        businessActor: item.businessActor,
        businessIntent: item.businessIntent,
        confidence: item.confidence,
        qualifiesAsBusinessUseCase: true,
        qualification: 'call_path_preprocessor'
      }, { id: path?.entrySymbolId || '', path: path?.sourcePaths?.[0] || '' });
      if (!arc) continue;
      arc.callPathId = item.pathId;
      arc.callPathVariantIds = arr(path?.alternatives).map((alt) => alt.pathId);
      arc.completionCondition = item.completionCondition;
      arc.businessOutcome = item.businessOutcome;
      arc.semanticBoundaryAt = item.semanticBoundaryAt;
      arc.coherentThroughSignature = item.coherentThroughSignature;
      arc.pathRelation = item.relationToOtherPaths;
      arc.relatedCallPathId = item.relatedPathId;
      arc.seedSource = 'call_path_preprocessor';
      this.pass2().seed(arc.id);
      existingTitles.set(key, arc);
      seeded.push(arc);
    }

    state.seededArcIds = seeded.map((arc) => arc.id);
    state.status = 'complete';
    this.state.lastMessage = seeded.length
      ? `Call-path preprocessing seeded ${seeded.length} coherent business-flow candidate${seeded.length === 1 ? '' : 's'} directly into Pass 1; contained subflows/alternate entrances were attached instead of competing.`
      : 'Call-path preprocessing found no direct business-flow seed; Discovery continues independently.';
  }
}
