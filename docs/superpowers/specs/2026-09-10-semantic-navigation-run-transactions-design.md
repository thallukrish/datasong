# Semantic Navigation and Transactional Learning Design

## Goal
Make LeMap-Web navigate from learned browser topology where the destination is already structurally known, use model semantics only for unresolved navigation, and prevent failed exploratory runs from contaminating the durable semantic map or user-instance graph.

## Navigation resolution hierarchy
Navigation is resolved in this order:

1. **Observed topology.** A visible enabled control with a learned `transitionsTo` target that is earlier in the active workflow trail is deterministically treated as `back` and is excluded from model ranking.
2. **Stable link target evidence.** A link whose `href` uniquely resolves to an earlier page route is also treated as `back` before execution. URI evidence is supporting evidence only; when the target route is the same as the current route, SPA state is ambiguous and the model remains responsible unless a learned page-level transition exists.
3. **Repeated global navigation.** Page-scoped link entities with the same stable link target and label observed under at least two distinct page entities are treated as global site navigation and excluded from workflow ranking. Repeated buttons without a stable target are not assumed to be global.
4. **Semantic model.** Only remaining visible enabled actionable controls are ranked relative to the current goal/page state.

The graph therefore becomes progressively more authoritative as transitions and repeated site structure are learned. The model bootstraps unknown navigation rather than repeatedly rediscovering facts already present in the map.

## Navigation semantics
For unresolved actionable UI entities the semantic model may assign:

- `workflowRole`: `continue`, `back`, `branch`, `global`, `exit`, `commit`, `local`, or `unknown`.
- `navigationPriority`: integer 0-100. Higher means more appropriate as the next action for the active user goal from this page.
- `interaction`: `action` or `navigation`.
- `relevantToGoal`, `required`, and `consequence` retain their existing meanings.

`workflowRole` and `navigationPriority` are current-state semantics, not immutable properties of a control. Only `workflowRole=continue` is eligible for automatic forward traversal. `back`, `global`, `branch`, and `exit` are not automatic forward continuations. `commit` remains protected by consequence policy.

Topology may veto a candidate as known-back or known-global. It does not invent forward workflow meaning for an unknown action. Unknown or ambiguous actions still require semantic interpretation.

## Global navigation identity
Normal UI-control entity IDs remain page-scoped. LeMap does not merge header/footer controls from different pages into one entity merely because their labels match.

For topology analysis only, a page-independent link signature may be derived from a normalized stable target plus normalized label. A repeated signature across distinct page parents is evidence of global navigation. This keeps page-local structural identity intact while preventing repeated site chrome from consuming semantic-model attention on every page.

Do not infer global identity from label repetition alone. Controls such as `Continue`, `Save`, or `Proceed` can legitimately recur throughout a workflow.

## Page/workflow graph
When a new page is reached during a run:

1. Add the page structurally to the working graph.
2. Link the active workflow entity to that page with `contains/partOfWorkflow`.
3. Link the triggering control to the page with `transitionsTo/reachedFrom`.
4. On later decisions, use those transition edges before model navigation semantics.
5. Enrich unresolved non-navigation semantics and unresolved/ambiguous navigation as needed.

A page reached through a wrong exploratory action is visible during the current run, but it is not durable unless the run is promoted.

## SPA state handling
Page entity identity, not URI alone, is authoritative for learned transitions. Distinct rendered states may share a URI or hash route. Therefore:

- a learned `transitionsTo` page ID can identify a prior state even when URI is unchanged;
- URI/href inference must not classify same-route navigation as back by itself;
- same-route ambiguous controls remain model candidates until their transition is observed.

## Transactional learning
At run start, load the canonical entity graph and canonical instance graph, then deep-clone them into working graphs. All structural additions, semantic patches, transition links, and instance writes modify only the working copies during execution.

Promote both working graphs at run level only when the agent stops in a clean state:

- `workflow_complete`
- `consequential_action`

Do not promote on:

- model/browser/runtime error
- `no_executable_entity`
- `continuation_no_structural_change`
- maximum-step exhaustion
- process interruption

This makes unsuccessful exploration disposable without manual cleanup. Existing durable graph/instances remain unchanged.

Topology-derived current roles (`back`/`global`) may be applied ephemerally to the current capture. The durable fact is the graph structure (`transitionsTo`, page membership, repeated stable link evidence), not a stale workflow-relative role copied forever onto the control.

## Persistence and logging
The JSONL run log remains the evidence trail for every exploratory run, including failed ones. It records model exchanges, steps, transitions, instances, stop reasons, and whether working state was promoted or discarded.

No extra model call is introduced for topology resolution or persistence.

## Migration
Existing maps produced before transactional learning may contain contaminated navigation edges. Those require one-time cleanup only when known to predate the transactional protection or when persisted identity/schema changes. Failed transactional runs do not require manual cleanup.

## Constraints
- Keep LeMap-Web domain-neutral; no income-tax-specific labels or rules in production code.
- Never send hidden/non-visible controls to the model.
- Group member controls remain structural implementation details and are not separate semantic questions.
- Prefer learned topology over repeating model work when destination facts are already known.
- Do not infer forward progress from topology unless it is actually established; unknown forward actions remain semantic.
- Consequential/commit actions remain non-automatic.
