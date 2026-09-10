# Semantic Navigation and Transactional Learning Design

## Goal
Make LeMap-Web choose navigation from model-derived workflow semantics for the current page, while preventing failed exploratory runs from contaminating the durable semantic map or user-instance graph.

## Navigation semantics
Every visible actionable UI entity is interpreted relative to the active workflow and current page. The semantic model may assign:

- `workflowRole`: `continue`, `back`, `branch`, `global`, `exit`, `commit`, `local`, or `unknown`.
- `navigationPriority`: integer 0-100. Higher means more appropriate as the next action for the active user goal from this page.
- `interaction`: `action` or `navigation` for executable navigation controls.
- `relevantToGoal`, `required`, and `consequence` retain their existing meanings.

`workflowRole` expresses direction/significance. `navigationPriority` ranks controls having otherwise compatible semantics. The browser runtime does not infer workflow direction from labels such as Continue, Skip, Help, or breadcrumb text.

Only `workflowRole=continue` is eligible for automatic forward traversal. `branch` describes an alternate goal-relevant path but is not automatically preferred over a direct continuation. `back`, `global`, and `exit` are not automatic forward continuations. `commit` remains protected by consequence policy.

For newly discovered pages and controls, the model's semantic interpretation is the primary navigation signal. Observed `transitionsTo` edges verify where a selected control actually leads and enrich the map. Transition history may prevent a known cycle, but must not substitute for semantic direction classification.

## Page/workflow graph
When a new page is reached during a run:

1. Add the page structurally to the working graph.
2. Link the active workflow entity to that page with `contains/partOfWorkflow`.
3. Link the triggering control to the page with `transitionsTo/reachedFrom`.
4. Enrich unresolved entities on that page once, then reuse their semantics in subsequent runs.

A page reached through a wrong exploratory action is therefore visible during the current run, but it is not durable unless the run is promoted.

## Transactional learning
At run start, load the canonical entity graph and canonical instance graph, then deep-clone them into working graphs. All structural additions, semantic patches, transition links, and instance writes modify only the working copies during execution.

Promote both working graphs atomically-at-run-level only when the agent stops in a clean state:

- `workflow_complete`
- `consequential_action` (the agent reached the intended protected commit boundary)

Do not promote on:

- model/browser/runtime error
- `no_executable_entity`
- `continuation_no_structural_change`
- maximum-step exhaustion
- process interruption

This makes unsuccessful exploration disposable without manual cleanup. Existing durable graph/instances remain unchanged.

## Persistence and logging
The JSONL run log remains the evidence trail for every exploratory run, including failed ones. It already records model exchanges, steps, transitions, instances, and stop reasons. The log should additionally record whether the working graph was `promoted` or `discarded` at run end.

No extra model call is introduced for promotion or transition verification.

## Migration
Existing maps produced before this behavior may already contain incorrect navigation semantics or transitions. For validation of this architecture, delete the old canonical web map and instance graph once. After that, failed runs should no longer require cleanup.

## Constraints
- Keep LeMap-Web domain-neutral; no income-tax-specific labels or rules in production code.
- Never send hidden/non-visible controls to the model.
- Group member controls remain structural implementation details and are not separate semantic questions.
- Reuse known semantic entities and user instances; do not call the model unnecessarily.
- Consequential/commit actions remain non-automatic.
