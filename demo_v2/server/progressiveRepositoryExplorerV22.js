import { ProgressiveRepositoryExplorerV21 } from './progressiveRepositoryExplorerV21.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 400) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const PASS12_SYSTEM = `You are DataSong's semantic navigator in a two-layer exploration system.
The objective is to discover end-to-end BUSINESS USE CASES from the point of view of a business actor/end user/external business participant.
Technical setup, framework wiring, dependency registration, screen registration, tests, configuration and infrastructure are useful evidence and orientation, but are NOT business-use-case arcs by themselves.
Pass 1 owns global business-use-case admission and scheduling. You decide semantically whether a proposed arc actually qualifies as a business use case. A qualifying arc must express a business actor/participant, an intent/capability they are trying to accomplish, and evidence of business behavior beyond application assembly.
If evidence is promising but insufficient, keep it as a hypothesis. If it is merely technical/orientation evidence, say so; do not turn technical coherence into a schedulable arc.
Pass 2 explores locally only inside arcs that Pass 1 has admitted. Candidate artifacts are signatures only. DataSong owns per-arc DFS mechanics.
Return strict compact JSON matching the supplied contract.`;

export class ProgressiveRepositoryExplorerV22 extends ProgressiveRepositoryExplorerV21 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'pass1-business-use-case-admission-pass2-per-arc-dfs-v2';
    return state;
  }

  buildPrompt(observation, candidates) {
    if (!this.semanticMode(observation)) return super.buildPrompt(observation, candidates);

    const arcs = this.pass1().arcBoard();
    const hypotheses = this.pass1().hypothesisBoard();
    const activeArcId = this.pass1().activeArcId();
    const current = this.compactCurrent(observation);
    const available = this.compactCandidates(candidates);
    const isNeighborhood = observation?.kind === 'semantic_neighborhood';

    const contract = {
      meaning: isNeighborhood ? 'brief meaning of this candidate set' : 'brief semantic meaning of current evidence',
      evidenceClassification: 'business_use_case|business_supporting|hypothesis|orientation|technical',
      arcFits: [{ arcId: 'each admitted arc id', continuity: 0, coherence: 0, expectedGain: 0, reason: 'brief' }],
      hypothesisJudgments: [{
        hypothesisId: 'existing hypothesis id',
        decision: 'admit|retain|reject',
        qualifiesAsBusinessUseCase: false,
        businessActor: 'actor/participant if known',
        businessIntent: 'what they are trying to accomplish',
        confidence: 0,
        reason: 'brief qualification reason'
      }],
      bestArc: 'existing admitted arc id | NEW | UNATTACHED',
      newArcs: [{
        title: 'candidate business-use-case title',
        concept: 'brief concept',
        qualification: 'business_use_case|hypothesis|orientation|technical',
        qualifiesAsBusinessUseCase: false,
        businessActor: 'actor/participant if known',
        businessIntent: 'what they are trying to accomplish',
        confidence: 0,
        reason: 'why it does/does not qualify',
        majorStages: ['broad stage if known'],
        outcome: 'business outcome if known'
      }],
      arcUpdate: {
        arcId: 'admitted arc id or empty',
        evidenceRole: 'major|supporting|trivial',
        trigger: 'business actor/intent if learned',
        majorStages: ['new broad stage only'],
        outcome: 'business/persistence/external outcome if learned',
        entities: ['major entity'],
        relationships: ['major relationship'],
        status: 'forming|broadly_complete|unresolved'
      },
      candidateScores: [{
        artifactId: 'exact supplied candidate id',
        arcId: 'admitted arc this candidate would continue',
        continuity: 0,
        coherence: 0,
        expectedGain: 0,
        reason: 'brief'
      }],
      evidenceRequest: {
        type: 'advance|getArtifact|getFunction|getNeighbors|searchSemantic|backtrack|stop',
        artifactId: 'exact supplied/known id when used',
        depth: 2,
        query: 'keywords only for searchSemantic',
        alternateQueries: ['optional'],
        reason: 'brief'
      }
    };

    return `MODE pass1-business-use-case-admission -> pass2-local-explorer\nACTIVE_ADMITTED_ARC ${activeArcId || 'NONE'}\nADMITTED_ARCS ${JSON.stringify(arcs)}\nHYPOTHESES_NOT_SCHEDULABLE ${JSON.stringify(hypotheses)}\nCURRENT ${JSON.stringify(current)}\nCANDIDATES_SIGNATURE_ONLY ${JSON.stringify(available)}\nRETURN ${JSON.stringify(contract)}\nRules:\n- First decide what CURRENT evidence is: business use case, supporting business evidence, hypothesis evidence, orientation, or technical evidence.\n- A BUSINESS USE CASE is something a business actor/end user/external business participant is trying to accomplish. Application setup/registration/dependencies/framework mechanics do not qualify merely because they form a coherent technical story.\n- For every NEW candidate arc, explicitly decide qualifiesAsBusinessUseCase. If uncertain, qualification=hypothesis. Technical/orientation candidates never become schedulable arcs.\n- Re-evaluate every supplied hypothesis: admit only when accumulated evidence now supports a genuine business actor + intent/capability; retain when plausible but insufficient; reject when it is a technical narrative rather than a business use case.\n- Score CURRENT against every ADMITTED arc. Only admitted arcs may appear in candidateScores and receive Pass-2 DFS state.\n- When there is no admitted arc yet, continue orientation/evidence acquisition with evidenceRequest rather than inventing an arc.\n- Candidate signatures may suggest where to inspect next but do not by themselves prove a new business use case.\n- Pass 1 schedules admitted arcs; Pass 2 preserves independent DFS state per admitted arc.\n- Keep text brief.`;
  }

  async callModel(dynamicPrompt) {
    if (String(dynamicPrompt || '').startsWith('MODE pass1-business-use-case-admission')) {
      return this.lightweightModelCall(PASS12_SYSTEM, dynamicPrompt, 'PASS 1 BUSINESS-USE-CASE ADMISSION / PASS 2 EXPLORER');
    }
    return super.callModel(dynamicPrompt);
  }

  normalizePass12(parsed, candidates) {
    const out = parsed && typeof parsed === 'object' ? parsed : {};
    out.meaning = text(out.meaning, 500);
    out.evidenceClassification = ['business_use_case', 'business_supporting', 'hypothesis', 'orientation', 'technical'].includes(out.evidenceClassification)
      ? out.evidenceClassification : 'orientation';

    out.arcFits = arr(out.arcFits).map((fit) => ({
      arcId: String(fit?.arcId || '').trim(),
      continuity: clamp01(fit?.continuity),
      coherence: clamp01(fit?.coherence),
      expectedGain: clamp01(fit?.expectedGain),
      reason: text(fit?.reason, 220)
    }));
    const seen = new Set(out.arcFits.map((fit) => fit.arcId));
    for (const arc of this.pass1().arcs()) {
      if (!seen.has(arc.id)) out.arcFits.push({ arcId: arc.id, continuity: 0, coherence: 0, expectedGain: 0, reason: '' });
    }

    out.hypothesisJudgments = arr(out.hypothesisJudgments).map((judgment) => ({
      hypothesisId: String(judgment?.hypothesisId || '').trim(),
      decision: ['admit', 'retain', 'reject'].includes(judgment?.decision) ? judgment.decision : 'retain',
      qualifiesAsBusinessUseCase: judgment?.qualifiesAsBusinessUseCase === true,
      businessActor: text(judgment?.businessActor, 260),
      businessIntent: text(judgment?.businessIntent, 300),
      confidence: clamp01(judgment?.confidence),
      reason: text(judgment?.reason, 300)
    }));

    out.newArcs = arr(out.newArcs || (out.newArc ? [out.newArc] : [])).map((seed) => {
      const qualification = ['business_use_case', 'hypothesis', 'orientation', 'technical'].includes(seed?.qualification)
        ? seed.qualification : (seed?.qualifiesAsBusinessUseCase === true ? 'business_use_case' : 'hypothesis');
      return {
        title: text(seed?.title, 180),
        concept: text(seed?.concept, 320),
        qualification,
        qualifiesAsBusinessUseCase: qualification === 'business_use_case' && seed?.qualifiesAsBusinessUseCase === true,
        businessActor: text(seed?.businessActor || seed?.actor || seed?.trigger, 260),
        businessIntent: text(seed?.businessIntent || seed?.intent, 300),
        confidence: clamp01(seed?.confidence),
        reason: text(seed?.reason, 300),
        trigger: text(seed?.trigger, 260),
        outcome: text(seed?.outcome, 260),
        majorStages: arr(seed?.majorStages).map((v) => text(v, 240)).filter(Boolean),
        entities: arr(seed?.entities).map((v) => text(v, 180)).filter(Boolean),
        relationships: arr(seed?.relationships).map((v) => text(v, 240)).filter(Boolean)
      };
    }).filter((seed) => seed.title);

    // NEW is meaningful only if the model explicitly admitted a business use case.
    if (String(out.bestArc || '').toUpperCase() === 'NEW' && !out.newArcs.some((seed) => seed.qualifiesAsBusinessUseCase)) {
      out.bestArc = 'UNATTACHED';
    }

    const update = out.arcUpdate && typeof out.arcUpdate === 'object' ? out.arcUpdate : {};
    out.arcUpdate = {
      arcId: String(update.arcId || '').trim(),
      evidenceRole: ['major', 'supporting', 'trivial'].includes(update.evidenceRole) ? update.evidenceRole : 'supporting',
      title: text(update.title, 180),
      trigger: text(update.trigger, 300),
      majorStages: arr(update.majorStages).map((v) => text(v, 240)).filter(Boolean),
      outcome: text(update.outcome, 350),
      entities: arr(update.entities).map((v) => text(v, 180)).filter(Boolean),
      relationships: arr(update.relationships).map((v) => text(v, 240)).filter(Boolean),
      status: ['forming', 'broadly_complete', 'unresolved'].includes(update.status) ? update.status : 'forming'
    };

    const knownCandidateIds = new Set(arr(candidates).map((candidate) => candidate.id));
    const admittedArcIds = new Set(this.pass1().arcs().map((arc) => arc.id));
    out.candidateScores = arr(out.candidateScores)
      .filter((score) => knownCandidateIds.has(score?.artifactId) && admittedArcIds.has(String(score?.arcId || '').trim()))
      .map((score) => ({
        artifactId: score.artifactId,
        arcId: String(score?.arcId || '').trim(),
        continuity: clamp01(score?.continuity),
        coherence: clamp01(score?.coherence),
        expectedGain: clamp01(score?.expectedGain),
        reason: text(score?.reason, 220)
      }));

    const allowed = new Set(['advance', 'getArtifact', 'getFunction', 'getNeighbors', 'searchSemantic', 'backtrack', 'stop']);
    const request = out.evidenceRequest && typeof out.evidenceRequest === 'object' ? out.evidenceRequest : { type: 'advance' };
    if (!allowed.has(request.type)) request.type = out.candidateScores.length ? 'advance' : 'backtrack';
    out.evidenceRequest = request;
    out.next = request;
    out._pass12 = true;
    return out;
  }
}
