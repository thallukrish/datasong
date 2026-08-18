import { ProgressiveRepositoryExplorerV12 } from './progressiveRepositoryExplorerV12.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function cleanQuery(value) { return String(value || '').trim().replace(/\s+/g, ' '); }

const MIN_SEMANTIC_FIT = 0.25;

const SEARCH_PLAN_PROMPT = `PASS-1 SEARCH POLICY
searchSemantic is deterministic ordered WORD-LEVEL search, not embedding similarity.
When useful, provide alternateQueries with the FIRST search request so DataSong can retry the same business intent without another keyword-generation call.
Example:
{"type":"searchSemantic","query":"order detail","alternateQueries":["view order","order display","customer order detail"],"reason":"find the product/business stage"}

The primary query is tried first. You will score its returned candidates for continuity/coherence/gain. If every returned candidate is semantically weak, DataSong tries the next alternate query for the SAME active business arc. Only after the supplied alternatives are exhausted should the arc be abandoned/suspended in favor of another promising business-use-case thread, unless you explicitly provide a new better searchSemantic query.`;

export class ProgressiveRepositoryExplorerV13 extends ProgressiveRepositoryExplorerV12 {
  emptyState() {
    const state = super.emptyState();
    state.pass1SearchPlans = [];
    state.pass1ActiveSearchPlan = null;
    return state;
  }

  buildPrompt(observation, candidates) {
    return `${super.buildPrompt(observation, candidates)}\n\n${SEARCH_PLAN_PROMPT}`;
  }

  searchQueries(request) {
    const primary = cleanQuery(request?.query);
    const alternatives = arr(request?.alternateQueries).map(cleanQuery).filter(Boolean);
    return [...new Set([primary, ...alternatives].filter(Boolean))];
  }

  async searchObservation(query, plan, reason = '') {
    const hits = arr(await this.topology.searchSemantic(query))
      .filter((hit) => hit?.id && !this.state.visited.includes(hit.id));

    const observationId = `pass1-word-search:${encodeURIComponent(query)}:${this.state.step}:${plan.index}`;
    plan.observationId = observationId;
    plan.query = query;
    plan.hitCount = hits.length;
    plan.reason = reason || plan.reason || '';
    plan.history.push({ query, hitCount: hits.length, step: this.state.step });

    this.state.pass1ActiveSearchPlan = plan;
    this.state.pass1SearchPlans.push({
      id: plan.id,
      activeArcTitle: plan.activeArcTitle,
      queries: [...plan.queries],
      index: plan.index,
      currentQuery: query,
      hitCount: hits.length,
      status: 'results_pending_model_judgment',
      step: this.state.step
    });
    this.state.pass1SearchPlans = this.state.pass1SearchPlans.slice(-100);

    return {
      id: observationId,
      path: query,
      kind: 'semantic_neighborhood',
      summary: `Pass-1 ordered word search: ${query}`,
      canonical: {
        kind: 'semantic_search_results',
        query,
        searchPolicy: 'ordered_word_level',
        activeBusinessArc: plan.activeArcTitle || '',
        alternateQueriesRemaining: plan.queries.slice(plan.index + 1),
        nodes: hits.map((hit) => this.candidateDescriptor(hit)),
        note: 'Results are deterministically ranked by exact/ordered word match. Score semantic usefulness against the active business arc; weak results will trigger the next supplied alternate query.'
      },
      neighbors: hits,
      sourceCoverage: null
    };
  }

  activeArcTitle() {
    const pursuingSeed = this.state.pass1ArcSeeds.find((seed) => seed.status === 'pursuing');
    if (pursuingSeed?.title) return pursuingSeed.title;
    const forming = [...this.state.pass1Arcs]
      .filter((arc) => arc.status === 'forming')
      .sort((a, b) => Number(b.updatedStep || b.createdStep || 0) - Number(a.updatedStep || a.createdStep || 0))[0];
    return forming?.title || this.state.pass1Arcs.at(-1)?.title || '';
  }

  strongestSemanticFit(scores, candidates) {
    const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
    let strongest = 0;
    for (const score of arr(scores)) {
      const candidate = byId.get(score?.artifactId);
      if (!candidate) continue;
      strongest = Math.max(strongest, this.semanticScore(score, candidate));
    }
    return strongest;
  }

  async beginSearchPlan(request) {
    const queries = this.searchQueries(request);
    if (!queries.length) return null;
    const plan = {
      id: `search-plan-${this.state.step}-${this.state.pass1SearchPlans.length + 1}`,
      activeArcTitle: this.activeArcTitle(),
      queries,
      index: 0,
      query: queries[0],
      reason: String(request?.reason || ''),
      history: [],
      status: 'active'
    };
    return this.searchObservation(queries[0], plan, request?.reason);
  }

  async tryNextAlternate(plan) {
    if (!plan || plan.index + 1 >= plan.queries.length) return null;
    plan.index += 1;
    plan.status = 'active';
    return this.searchObservation(plan.queries[plan.index], plan, plan.reason);
  }

  finishSearchPlan(status) {
    const plan = this.state.pass1ActiveSearchPlan;
    if (!plan) return;
    plan.status = status;
    this.state.pass1SearchPlans.push({
      id: plan.id,
      activeArcTitle: plan.activeArcTitle,
      queries: [...plan.queries],
      index: plan.index,
      currentQuery: plan.query,
      hitCount: plan.hitCount,
      status,
      step: this.state.step
    });
    this.state.pass1SearchPlans = this.state.pass1SearchPlans.slice(-100);
    this.state.pass1ActiveSearchPlan = null;
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };
    const currentId = this._currentObservationId || '';
    const plan = this.state.pass1ActiveSearchPlan;

    // Intercept explicit semantic searches before V11's broad-arc switching logic.
    // A search request is for the currently pursued arc; merely having some
    // previously completed arc must not redirect it to another pending seed.
    if (request.type === 'searchSemantic') {
      this.finishSearchPlan('replaced_by_model_query');
      const observation = await this.beginSearchPlan(request);
      if (observation) return observation;
      return super.resolveNextAction(request, candidates);
    }

    // The model has now judged the current word-search results. If all scored
    // results are below the semantic floor (or there were no candidates), try
    // the next keyword alternative for the SAME business arc before switching.
    if (plan && currentId === plan.observationId && ['advance', 'backtrack', 'stop'].includes(request.type)) {
      const scores = arr(request.candidateScores);
      const strongest = this.strongestSemanticFit(scores, candidates);
      const weak = !candidates?.length || !scores.length || strongest < MIN_SEMANTIC_FIT;

      if (weak) {
        const alternate = await this.tryNextAlternate(plan);
        if (alternate) return alternate;
        this.finishSearchPlan('weak_alternates_exhausted');

        // At this point the lexical search plan for this arc is exhausted. Allow
        // Pass 1 to suspend/switch the arc rather than forcing unrelated matches.
        const pursuingSeed = this.state.pass1ArcSeeds.find((seed) => seed.status === 'pursuing' && seed.title === plan.activeArcTitle);
        if (pursuingSeed) pursuingSeed.status = 'unresolved';
        const nextSeed = this.nextPendingArcSeed();
        if (nextSeed) {
          const switched = await this.switchToArcSeed(currentId, nextSeed);
          if (switched) return switched;
        }
        return super.resolveNextAction({ type: 'backtrack', candidateScores: scores }, candidates);
      }

      // There is at least one semantically admissible search result; normal
      // scored DFS/advance behavior takes over and the search plan is complete.
      this.finishSearchPlan('admissible_result_found');
    }

    return super.resolveNextAction(request, candidates);
  }
}
