import { ProgressiveRepositoryExplorerV15 } from './progressiveRepositoryExplorerV15.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function short(value, max = 360) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const COMPACT_SCORING = `SCORING\ncontinuity: 0 unrelated, .25 weak, .5 plausible, .75 strong next step, 1 near-direct continuation.\ncoherence: 0 another concept, .25 peripheral/shared, .5 relevant but could belong elsewhere, .75 same business story, 1 central.\nexpectedGain: 0 repetitive, .25 minor detail, .5 useful, .75 important missing stage/branch, 1 major uncertainty resolved.\nScore absolute semantic fit, not merely the best available candidate.`;

export class ProgressiveRepositoryExplorerV16 extends ProgressiveRepositoryExplorerV15 {
  candidateDescriptor(candidate) {
    if (!candidate) return null;
    return {
      id: candidate.id,
      name: candidate.label || candidate.name || candidate.id,
      kind: candidate.kind,
      relation: candidate.relation,
      source: candidate.path,
      signature: short(candidate.hint || candidate.signature || candidate.label || candidate.name, 360),
      ...(candidate.searchMatch ? { searchMatch: candidate.searchMatch } : {})
    };
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind !== 'semantic_neighborhood') return super.buildPrompt(observation, candidates);

    const available = arr(candidates).map((candidate) => this.candidateDescriptor(candidate)).filter(Boolean);
    const activeArc = typeof this.activeArcTitle === 'function' ? this.activeArcTitle() : '';
    const query = observation?.canonical?.query || observation?.path || '';
    const alternateQueriesRemaining = arr(observation?.canonical?.alternateQueriesRemaining);
    const anchor = observation?.canonical?.anchor;

    const context = {
      activeBusinessArc: activeArc || undefined,
      searchQuery: observation?.canonical?.kind === 'semantic_search_results' ? query : undefined,
      alternateQueriesRemaining: alternateQueriesRemaining.length ? alternateQueriesRemaining : undefined,
      anchor: anchor ? {
        id: anchor.id,
        function: anchor.function,
        kind: anchor.kind,
        source: anchor.provenance?.source
      } : undefined
    };

    const contract = {
      candidateScores: [{
        artifactId: 'exact candidate id',
        threadId: 'existing thread id | NEW | UNATTACHED',
        continuity: 0.0,
        coherence: 0.0,
        expectedGain: 0.0,
        reason: 'brief reason'
      }],
      evidenceRequest: {
        type: 'advance|getArtifact|getNeighbors|searchSemantic|backtrack|stop',
        artifactId: 'exact known id when applicable',
        depth: '1-4 only for getNeighbors',
        query: 'primary keyword phrase for searchSemantic',
        alternateQueries: ['optional alternate keyword phrase'],
        reason: 'brief semantic intent'
      }
    };

    return `MODE: COMPACT CANDIDATE EVALUATION\n\nCONTEXT\n${JSON.stringify(context)}\n\nCANDIDATES — SIGNATURE LEVEL ONLY\n${JSON.stringify(available)}\n\n${COMPACT_SCORING}\n\nRETURN\n${JSON.stringify(contract)}\n\nRules:\n- The current detailed artifact was interpreted in the previous step. This call is ONLY for choosing/scoring possible continuations.\n- Candidate bodies/details are intentionally absent. Do not infer implementation detail beyond the supplied signature.\n- Score only supplied candidates.\n- If one is admissible, use advance or getArtifact; DataSong will then fetch that ONE candidate as detailed evidence.\n- If lexical search results are weak, use supplied alternate keywords or provide a better searchSemantic query; if the arc is exhausted, backtrack/switch.\n- Keep reasons brief.`;
  }
}
