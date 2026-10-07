# Semantic Exploration Algorithm Review

This document summarizes the current Query v5 semantic exploration flow and highlights the main weaknesses observed from the xarray and Astropy benchmark runs.

## Current flow with observed flaws

1. Take the user issue and decompose it into one or more evidence goals only when needed.  
   Example: G1 became “find why `merge(..., combine_attrs='override')` shares the first dataset’s attrs dictionary.”  
   **Flaw: goal decomposition can create the wrong evidence obligations and later force convergence against constraints that are broader than what any one source region can prove.**

2. For each active goal, build a goal-aware search question from the full issue plus that specific obligation.  
   Example: the original xarray issue was combined with G1’s causal obligation.

3. Extract a few structural `(type, value)` identifiers from the goal text.  
   Example: `(function, merge)`, `(input_param, combine_attrs)`, `(function, merge_attrs)`, `(function, merge_core)`.  
   **Flaw: identifier extraction is model-dependent, so an important implementation concept can be missed before structural search even begins.**

4. Run PAL FILTER separately for each identifier against the structural CSV.  
   Example: PAL independently searched for `merge`, `merge_attrs`, `merge_core`, and `combine_attrs`.

5. Group matching hits by locator and collapse them to enclosing structural candidates.  
   Example: matches around `combine_attrs` were associated with their enclosing functions such as `merge_core`.

6. Keep a bounded, diverse shortlist, currently at most 2 candidates per locator and 8 overall.  
   Example: generic `merge` hits cannot consume the whole shortlist.  
   **Flaw: the fixed 2-per-locator / 8-total limits can discard the correct entry when a locator legitimately maps to several plausible functions.**

7. Ask one confirmation model to rank that shortlist and choose the top 3 entry functions overall.  
   Example: `merge_attrs`, `merge_core`, `Dataset.merge`.  
   **Flaw: this is still a model ranking step, so a bad top-3 choice can exclude the correct branch completely.**

8. Start semantic exploration directly from those top 3 entries without another semantic entry-ranking stage.  
   Example: exploration began immediately at `merge_attrs`.

9. Pick the strongest entry as the active branch and keep the other entries as alternatives.  
   Example: `merge_attrs` active, `merge_core` and `Dataset.merge` retained.  
   **Flaw: entry rank is treated rather strongly even though structural relevance does not necessarily equal causal relevance.**

10. Learn a bounded semantic window around the current node, currently depth 3.  
    Example: learn `merge_attrs`, nearby regions and calls.  
    **Flaw: fixed depth 3 is arbitrary. Sometimes the causal target is depth 1, sometimes the important dispatch target is beyond the window.**

11. Build possible next moves from immediate `contains` and `calls` edges in that learned window.  
    Example: the `"override"` branch becomes a child candidate.  
    **Major flaw: traversal is only as good as the structural call graph. In Astropy, `_operators[transform.op]` did not expose `_cstack`, so the correct path was invisible.**

12. Give the model the current hypothesis, current node semantics, known facts, candidate children and bounded lookahead.  
    Example: it sees `merge_attrs`, the current hypothesis, and the override branch.  
    **Flaw: the lookahead currently mixes internal regions, internal calls, external calls and sometimes tests too freely, which creates noisy choices.**

13. Ask the model to update the hypothesis, score it against the goal constraints, optionally request source, and rank useful next nodes.  
    Example: “override may return the original attrs dictionary.”  
    **Major flaw: one model call is doing too many jobs at once: hypothesis generation, scoring, constraint evaluation, source-request decision and navigation ranking. Errors in one part contaminate the others.**

14. If exact source is requested, inspect the current function or region source and rerun reasoning with that source.  
    Example: inspect the `"override"` return line.  
    **Flaw: source inspection is largely model-triggered. A model can keep navigating when exact source would settle the issue immediately.**

15. Extract exact supporting source ranges and run a separate grounding check against the goal constraints.  
    Example: exact line returning the first attrs mapping.  
    **Major flaw: this is currently too strict. Local source evidence is asked to satisfy global testcase constraints it cannot possibly prove. In Astropy, a ~0.7 mechanism hypothesis was reduced to 0 because the local source did not prove the entire reproduction.**

16. For causal goals, run counterfactual validation when the hypothesis is sufficiently source-grounded or otherwise appears resolved.  
    Example: copying attrs should stop mutations propagating back to `xds1`.  
    **Flaw: counterfactual validation happens too late if grounding has already zeroed a good causal hypothesis.**

17. Track hypothesis progress as strengthening, flat or weakening and maintain the best hypothesis seen on the entry branch.  
    Example: `merge_attrs → override branch` strengthens the hypothesis.  
    **Flaw: the best hypothesis is recorded, but current traversal state can still revert to an older weaker base hypothesis during backtracking.**

18. Descend only into candidates predicted to strengthen the hypothesis or help resolve an unmet hard constraint.  
    Example: follow the override branch because it directly targets aliasing.  
    **Major flaw: the candidate score is model-predicted, and unresolved hard constraints may themselves be badly defined. That is how irrelevant candidates can still look “useful.”**

19. Prune an entry branch when it falls below a stronger competing entry branch or fails counterfactual validation.  
    Example: a weak `Dataset.merge` branch loses to `merge_attrs`.  
    **Flaw: branch comparison uses hypothesis scores that may already have been distorted by the grounding problem, so the wrong branch can win.**

20. Backtrack through remaining semantic alternatives, then through the other PAL-selected entry functions if necessary.  
    Example: try another child, then `merge_core`, then `Dataset.merge`.  
    **Major flaw: preserved alternatives are too broad. In Astropy this eventually allowed traversal into `numpy.ones`, `numpy.where`, and a test function after the useful internal hypothesis had already been found.**

21. Mark the goal resolved only when its grounded hard constraints pass the closure threshold.  
    Example: source proves the shared-reference mechanism.  
    **Biggest convergence flaw: all hard constraints are treated as though they should be proven by the same local evidence. Mechanism evidence and testcase/behavior evidence need separate closure tracks.**

22. Stop when all goals resolve, otherwise return the best source-supported hypothesis found when the search budget is exhausted.  
    Example: xarray resolved cleanly, while Astropy exhausted the search with a best hypothesis.  
    **Flaw: because convergence can fail for the wrong reason, the system may burn tens of thousands of tokens after already discovering the likely mechanism.**

## Highest-priority problems

The three largest issues are:

1. **Missing structural edges for indirect dispatch.**  
   Example: Astropy’s `_operators[transform.op]` dispatch did not expose `_cstack`, so the semantic explorer could not follow the true causal path.

2. **Local source grounding is incorrectly tied to global hard constraints.**  
   A source fragment that proves the mechanism should not be scored down because it cannot independently prove the entire reproduction testcase.

3. **Semantic traversal remains too permissive after a strong internal hypothesis exists.**  
   External helpers and tests can remain in the frontier and consume large token budgets even when the likely mechanism has already been localized.

## Intended architectural direction

The desired direction is:

```text
issue
→ goal decomposition only when needed
→ structural identifier extraction
→ PAL filtering
→ top 3 confirmed structural entries
→ semantic exploration over canonical structural edges
→ source-grounded mechanism hypothesis
→ separate behavioral/counterfactual validation
→ resolved answer
```

Structural indexing should expose as many deterministic call edges as possible, including bounded indirect-dispatch targets.

Semantic knowledge should remain an overlay on canonical structural node identities rather than becoming a disconnected graph.

Mechanism evidence and reproduction/behavior evidence should be validated separately so that strong local source evidence is not invalidated by unrelated global constraints.
