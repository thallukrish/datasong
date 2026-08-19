import { ProgressiveRepositoryExplorerV30 } from './progressiveRepositoryExplorerV30.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const CALL_PATH_SYSTEM_V3 = `You are DataSong's CALL-PATH BUSINESS-FLOW SEED CLASSIFIER.
You receive deterministic reconstructed executable paths from the supplied repository boundary.
Do not infer implementations for external calls.
For each path decide only whether its coherent segment is a business_flow, technical, or uncertain.
A business_flow is one recognizable actor/business goal with a completion condition and outcome.
CALL/NEXT/TRIGGER normally preserve execution continuity. NAVIGATE is weak semantic continuity and may mark the end of one actor goal and entry into another.
If a semantic boundary exists, describe only the coherent prefix up to that boundary. Do not compare paths or decide containment; DataSong does that deterministically after your response.
Return strict compact JSON only.`;

export class ProgressiveRepositoryExplorerV31 extends ProgressiveRepositoryExplorerV30 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-boundary-deterministic-containment-v11';
    return state;
  }

  callPathPrompt() {
    const paths = this.topology.topCallPaths(10).map((path) => this.compactCallPath(path));
    const contract = {
      summary: 'brief assessment of the supplied executable paths',
      paths: [{
        pathId: 'exact supplied pathId',
        classification: 'business_flow|technical|uncertain',
        confidence: 0,
        flowTitle: 'title for the coherent flow segment only',
        businessActor: 'if evidenced',
        businessIntent: 'if evidenced',
        completionCondition: 'if evidenced',
        businessOutcome: 'if evidenced',
        semanticBoundaryAt: 'optional rendered signature or NAVIGATE point where another concern begins',
        coherentThroughSignature: 'last signature belonging to this flow; use the final path signature when no boundary exists',
        reason: 'short evidence-based reason'
      }]
    };
    return `MODE call-path-business-seed-classification-v3\nLONGEST_EXECUTABLE_PATHS ${JSON.stringify(paths)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- Use only supplied rendered paths, compact branch summaries, edge labels and terminal boundaries.\n- External calls terminate the known repository path; never imagine their implementation.\n- CALL/NEXT/TRIGGER normally preserve execution continuity. NAVIGATE is weak semantic continuity.\n- If behavior after a NAVIGATE serves a different actor goal, set semanticBoundaryAt and describe only the coherent prefix before that new concern.\n- Always return coherentThroughSignature for business_flow paths.\n- Do NOT compare paths, infer parent/subflow relationships, or decide which flow is broader. DataSong will calculate structural containment deterministically after clipping.\n- Mark technical/framework/navigation-only paths technical.\n- Classify every path and keep reasons short.`;
  }

  async callModel(dynamicPrompt, maxTokens) {
    if (String(dynamicPrompt || '').startsWith('MODE call-path-business-seed-classification-v3')) {
      return this.lightweightModelCall(CALL_PATH_SYSTEM_V3, dynamicPrompt, 'CALL-PATH BUSINESS-FLOW SEED CLASSIFIER V3');
    }
    return super.callModel(dynamicPrompt, maxTokens);
  }

  normalizeCallPathClassification(raw) {
    const known = new Set(this.topology.topCallPaths(10).map((path) => path.id));
    const allowed = new Set(['business_flow', 'technical', 'uncertain']);
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
          coherentThroughSignature: text(item?.coherentThroughSignature, 500),
          reason: text(item?.reason, 300)
        })),
      next: { type: 'advance' }
    };
  }

  clippedSignatures(path, item) {
    const signatures = arr(path?.signatures);
    if (!signatures.length) return [];
    const through = String(item?.coherentThroughSignature || '').trim();
    if (!through) return signatures;
    let index = signatures.findIndex((signature) => signature === through);
    if (index < 0) index = signatures.findIndex((signature) => String(signature).includes(through) || through.includes(String(signature)));
    return index >= 0 ? signatures.slice(0, index + 1) : signatures;
  }

  containsSequence(container, candidate) {
    if (!candidate.length || candidate.length >= container.length) return false;
    outer: for (let offset = 0; offset <= container.length - candidate.length; offset += 1) {
      for (let i = 0; i < candidate.length; i += 1) {
        if (container[offset + i] !== candidate[i]) continue outer;
      }
      return true;
    }
    return false;
  }

  deterministicContainment(businessItems, byPath) {
    const enriched = businessItems.map((item) => ({
      item,
      signatures: this.clippedSignatures(byPath.get(item.pathId), item),
      containedBy: '',
      contains: []
    }));

    for (const child of enriched) {
      let bestParent = null;
      for (const parent of enriched) {
        if (parent === child) continue;
        if (!this.containsSequence(parent.signatures, child.signatures)) continue;
        if (!bestParent || parent.signatures.length < bestParent.signatures.length) bestParent = parent;
      }
      if (bestParent) {
        child.containedBy = bestParent.item.pathId;
        bestParent.contains.push(child.item.pathId);
      }
    }
    return enriched;
  }

  applyDelta(parsed, observation) {
    if (!parsed?._callPathPreprocess) return super.applyDelta(parsed, observation);

    const state = this.state.callPathPreprocess;
    const paths = this.topology.topCallPaths(10);
    const byPath = new Map(paths.map((path) => [path.id, path]));
    const existingTitles = new Map(this.pass1().arcs().map((arc) => [String(arc.title || '').trim().toLowerCase(), arc]));
    const seeded = [];

    state.classifications = parsed.paths;
    state.reviewedPathIds = parsed.paths.map((item) => item.pathId);

    const qualified = parsed.paths.filter((item) =>
      item.classification === 'business_flow'
      && item.confidence >= 0.55
      && item.flowTitle && item.businessActor && item.businessIntent
      && item.completionCondition && item.businessOutcome);
    const containment = this.deterministicContainment(qualified, byPath);
    const relationById = new Map(containment.map((entry) => [entry.item.pathId, entry]));

    state.deterministicContainment = containment.map((entry) => ({
      pathId: entry.item.pathId,
      coherentFunctionCount: entry.signatures.length,
      containedBy: entry.containedBy,
      contains: entry.contains
    }));

    for (const item of qualified) {
      const relation = relationById.get(item.pathId);
      if (relation?.containedBy) continue;

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
      arc.containedCallPathIds = arr(relation?.contains);
      arc.completionCondition = item.completionCondition;
      arc.businessOutcome = item.businessOutcome;
      arc.semanticBoundaryAt = item.semanticBoundaryAt;
      arc.coherentThroughSignature = item.coherentThroughSignature;
      arc.coherentFunctionCount = relation?.signatures?.length || arr(path?.signatures).length;
      arc.seedSource = 'call_path_preprocessor';
      this.pass2().seed(arc.id);
      existingTitles.set(key, arc);
      seeded.push(arc);
    }

    state.seededArcIds = seeded.map((arc) => arc.id);
    state.status = 'complete';
    this.state.lastMessage = seeded.length
      ? `Call-path preprocessing seeded ${seeded.length} maximal coherent business flow${seeded.length === 1 ? '' : 's'}; contained paths were attached deterministically.`
      : 'Call-path preprocessing found no direct business-flow seed; Discovery continues independently.';
  }
}
