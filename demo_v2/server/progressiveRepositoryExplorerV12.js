import { ProgressiveRepositoryExplorerV11 } from './progressiveRepositoryExplorerV11.js';

function sameArtifactRequest(request, currentId) {
  if (request?.type !== 'getArtifact') return false;
  const requested = String(request.artifactId || '').trim();
  return Boolean(requested && requested === currentId);
}

const PASS1_OVERRIDE = `PASS-1 CONTROL OVERRIDE
Pass 1 is a BROAD MULTI-ARC DISCOVERY pass. It does not lock onto one slice until implementation closure.
Several business-use-case arcs may coexist. Once one arc is broadly coherent enough for Pass 1, preserve it and move to another promising arc seed.
Do not repeatedly request the artifact already being shown. If the current artifact has yielded all broad business signal available at this pass, navigate elsewhere, backtrack, or search for another major stage/arc.`;

export class ProgressiveRepositoryExplorerV12 extends ProgressiveRepositoryExplorerV11 {
  buildPrompt(observation, candidates) {
    return `${super.buildPrompt(observation, candidates)}\n\n${PASS1_OVERRIDE}`;
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };
    this.normalizeRepositoryRequest(request, candidates);
    const currentId = this._currentObservationId || '';

    // Reopening the exact artifact that produced the current observation cannot
    // reveal new evidence. Treat it as an exhausted local move instead of
    // spending another LLM call on the same payload. This is especially
    // important for unknown/opaque artifacts and for large direct-text files.
    if (sameArtifactRequest(request, currentId)) {
      this.state.pass1CollapsedEvidence.push({
        step: this.state.step,
        artifactId: currentId,
        meaning: 'Skipped repeated inspection of the current artifact; no new Pass-1 evidence can result from reopening the same observation.',
        reason: 'deterministic no-repeat guard'
      });
      this.state.pass1CollapsedEvidence = this.state.pass1CollapsedEvidence.slice(-200);

      const seed = this.nextPendingArcSeed();
      if (seed) {
        const switched = await this.switchToArcSeed(currentId, seed);
        if (switched) return switched;
      }

      const escaped = await this.semanticEscape(currentId, []);
      if (escaped) return escaped;

      return super.resolveNextAction({ type: 'backtrack' }, candidates);
    }

    return super.resolveNextAction(request, candidates);
  }
}
