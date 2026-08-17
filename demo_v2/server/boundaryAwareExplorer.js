import { VerticalSliceExplorer } from './verticalSliceExplorer.js';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function short(value, max = 400) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export class BoundaryAwareExplorer extends VerticalSliceExplorer {
  candidatePriority(candidate) {
    const base = super.candidatePriority(candidate);
    if (candidate?.kind === 'external_boundary') return base + 180;
    return base;
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind !== 'external_boundary') return super.buildPrompt(observation, candidates);

    const active = this.activeSlice();
    if (!active) return super.buildPrompt(observation, candidates);

    const slice = {
      id: active.id,
      title: active.title,
      progress: active.progress,
      steps: active.steps.slice(-8).map((step) => ({ id: step.id, meaning: step.meaning, relation: step.relation })),
      openQuestions: active.openQuestions.slice(0, 5)
    };

    const resumeCandidates = candidates
      .filter((candidate) => candidate.kind !== 'external_boundary')
      .slice(0, 8)
      .map((candidate) => ({
        id: candidate.id,
        symbol: candidate.label,
        relation: candidate.relation,
        hint: short(candidate.hint, 100)
      }));

    return `ACTIVE SLICE\n${JSON.stringify(slice)}\n\nEXTERNAL BOUNDARY\n${JSON.stringify({
      reference: observation.referenceName,
      relation: observation.relation,
      caller: observation.sourceSymbolName,
      provenance: observation.sourcePath,
      summary: observation.summary
    })}\n\nLOCAL RESUME CANDIDATES\n${JSON.stringify(resumeCandidates)}\n\nThe referenced implementation is NOT present in this repository. Treat it as a BLACK-BOX DEPENDENCY. Do not search for its implementation. Infer only the contract needed by the active slice from the evidence already seen.\n\nReturn only JSON shaped like:\n${JSON.stringify({
      meaning: 'what this boundary means to the use case',
      semanticRole: 'story',
      pathId: active.id,
      continuity: 0.0,
      bridge: 'how the black-box call advances the active slice',
      relation: 'subflow',
      placement: { type: 'after|before|between|unknown', afterStepId: '', beforeStepId: '', confidence: 0.0 },
      coherenceGain: 0.0,
      dependency: { label: observation.referenceName, scope: 'external', contract: 'known input/output/effect only' },
      closes: 'none|story',
      resolvesQuestionIds: [],
      openQuestion: '',
      next: { type: 'artifact|stop', artifactId: '', expectedGain: 0.0 }
    })}\n\nRules:\n- relation must be subflow and dependency.scope must be external.\n- Never return next.type=search.\n- If a local resume candidate can establish the caller's outcome/continuation, choose it.\n- Use stop only when the available local evidence is semantically sufficient or no local continuation remains.`;
  }

  async getSemanticUpdate(args) {
    const result = await super.getSemanticUpdate(args);
    const observation = args.observation;
    if (observation?.kind !== 'external_boundary') return result;

    const active = this.activeSlice();
    if (!active) return result;

    const localResume = args.candidates
      .filter((candidate) => candidate.kind !== 'external_boundary' && candidate._locality === 'local')
      .sort((a, b) => this.candidatePriority(b) - this.candidatePriority(a))[0];

    const parsed = {
      ...result.parsed,
      semanticRole: 'story',
      pathId: active.id,
      relation: 'subflow',
      continuity: Math.max(0.75, num(result.parsed?.continuity, 0.75)),
      coherenceGain: Math.max(0.55, num(result.parsed?.coherenceGain, 0.55)),
      placement: result.parsed?.placement || { type: 'unknown', confidence: 0.6 },
      dependency: {
        label: observation.referenceName || result.parsed?.dependency?.label || 'External dependency',
        scope: 'external',
        contract: short(result.parsed?.dependency?.contract || result.parsed?.meaning || observation.summary, 500)
      },
      // An unresolved implementation must never trigger a repository-wide
      // implementation search. Continue only via the caller's remaining graph.
      next: result.parsed?.next?.type === 'artifact' && result.parsed.next.artifactId
        ? result.parsed.next
        : localResume
          ? { type: 'artifact', artifactId: localResume.id, expectedGain: 0.6 }
          : { type: 'stop', expectedGain: 0 }
    };

    if (parsed.next?.type === 'search') {
      parsed.next = localResume
        ? { type: 'artifact', artifactId: localResume.id, expectedGain: 0.6 }
        : { type: 'stop', expectedGain: 0 };
    }

    return { ...result, parsed };
  }
}
