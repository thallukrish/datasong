import { ProgressiveRepositoryExplorerV32 } from './progressiveRepositoryExplorerV32.js';

const STATIC_CONTRACT = {
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
    semanticBoundaryAt: 'optional NAVIGATE point where another concern begins',
    coherentThroughSignature: 'last signature belonging to this flow; use final path signature when no boundary exists',
    reason: 'short evidence-based reason'
  }]
};

const STATIC_RULES = `Rules:
- Use only supplied rendered paths, compact branch summaries, edge labels and terminal boundaries.
- External calls terminate the known repository path; never imagine their implementation.
- CALL/NEXT/TRIGGER normally preserve execution continuity. NAVIGATE is weak semantic continuity.
- If behavior after a NAVIGATE serves a different actor goal, set semanticBoundaryAt and describe only the coherent prefix before that new concern.
- Always return coherentThroughSignature for business_flow paths.
- Do NOT compare paths, infer parent/subflow relationships, or decide which flow is broader. DataSong handles structural grouping and containment deterministically.
- Mark technical/framework/navigation-only paths technical.
- Classify every supplied path and keep reasons short.`;

export class ProgressiveRepositoryExplorerV33 extends ProgressiveRepositoryExplorerV32 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-normalized-prellm-dedupe-cache-prefix-v13';
    return state;
  }

  callPathPrompt() {
    const paths = this.topology.topCallPaths(10).map((path) => this.compactCallPath(path));
    // Keep the invariant classifier contract/rules at the start of the user
    // message. Only the repository-dependent path payload comes afterwards, so
    // providers with prefix prompt caching can reuse the stable prefix.
    return [
      'MODE call-path-business-seed-classification-v3',
      `RETURN_CONTRACT ${JSON.stringify(STATIC_CONTRACT)}`,
      STATIC_RULES,
      `DYNAMIC_LONGEST_EXECUTABLE_PATHS ${JSON.stringify(paths)}`
    ].join('\n');
  }
}
