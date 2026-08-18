import { ProgressiveRepositoryExplorerV6 } from './progressiveRepositoryExplorerV6.js';

const SCORING_RUBRIC = `SEMANTIC SCORING RUBRIC\nUse these scores as absolute semantic judgments, not relative rankings among the candidates in this neighborhood. Do not give the best available candidate a high score merely because it is the best of a weak set. Judge each candidate independently against these anchors.\n\nCONTINUITY — how naturally this candidate continues the current frontier of the named thread:\n0.00 = unrelated to the current frontier\n0.25 = weak/tangential connection\n0.50 = plausible continuation but not clearly the main trajectory\n0.75 = strong next-step continuation\n1.00 = near-direct continuation strongly implied by current evidence\n\nCOHERENCE — how well this candidate belongs to the overall concept/story of the named thread:\n0.00 = contradicts or belongs to another concept\n0.25 = mostly peripheral/shared infrastructure\n0.50 = relevant to the concept but could naturally belong elsewhere\n0.75 = clearly part of the same business story\n1.00 = central to the same end-to-end concept\n\nEXPECTED GAIN — how much uncertainty about the thread is likely to be reduced by inspecting this candidate:\n0.00 = repetitive/no new semantic information\n0.25 = minor detail\n0.50 = useful supporting evidence\n0.75 = likely to reveal an important missing step or branch\n1.00 = likely to resolve a major uncertainty or expose the next major stage\n\nImportant:\n- Score semantic fit, not structural reachability. A call edge, XML adjacency, shared helper, shared entity, or same-file location does not by itself justify a high score.\n- Score from the evidence supplied in this call using the same anchors every time. Do not artificially preserve or smooth scores across calls. DataSong tracks score trends itself.\n- A candidate can be the best candidate in the neighborhood and still deserve a low absolute score.\n- Shared infrastructure or parallel use elsewhere should usually have low continuity for the current thread even if its implementation is related.`;

export class ProgressiveRepositoryExplorerV7 extends ProgressiveRepositoryExplorerV6 {
  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (observation?.kind === 'semantic_neighborhood') return `${base}\n\n${SCORING_RUBRIC}`;

    // Artifact interpretation also asks for continuity/coherence against existing
    // threads and proto threads. Keep those judgments calibrated to the same
    // absolute anchors so thread assignment and neighborhood selection use the
    // same semantic scale.
    if (['semantic_function', 'xml_file', 'config_file', 'text_file'].includes(observation?.kind)) {
      return `${base}\n\n${SCORING_RUBRIC}\nFor direct artifact interpretation, EXPECTED GAIN applies to semanticGain/proto continuation where relevant; continuity and coherence use the anchors above.`;
    }
    return base;
  }
}
