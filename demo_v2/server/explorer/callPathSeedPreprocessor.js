const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 360) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const clamp01 = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

export const withCallPathSeedPreprocessor = (Base) => class CallPathSeedPreprocessorExplorer extends Base {
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
    const qualified = parsed.paths.filter((item) => item.classification === 'business_flow' && item.confidence >= 0.55 && item.flowTitle && item.businessActor && item.businessIntent && item.completionCondition && item.businessOutcome);
    const containment = this.deterministicContainment(qualified, byPath);
    const relationById = new Map(containment.map((entry) => [entry.item.pathId, entry]));
    state.deterministicContainment = containment.map((entry) => ({ pathId: entry.item.pathId, coherentFunctionCount: entry.signatures.length, containedBy: entry.containedBy, contains: entry.contains }));

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
      const arc = this.pass1().createArc({ title: item.flowTitle, concept: item.reason, businessActor: item.businessActor, businessIntent: item.businessIntent, confidence: item.confidence, qualifiesAsBusinessUseCase: true, qualification: 'call_path_preprocessor' }, { id: path?.entrySymbolId || '', path: path?.sourcePaths?.[0] || '' });
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
      : 'Call-path preprocessing found no direct business-flow seed.';
  }
};
