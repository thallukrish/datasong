# RepositoryExplorer behavior inventory

This file is the regression contract for dismantling the historical `ProgressiveRepositoryExplorerV*` inheritance chain.

The rule for the refactor is simple: **before removing any historical layer, the canonical `RepositoryExplorer` plus focused modules must preserve every behavior listed here.**

## Current live composition

As of the latest peel, the live runtime composition is:

`ProgressiveRepositoryExplorerV41`
→ `withWholeFlowPass2`
→ `withWholeFlowScheduler`
→ `withScoutLifecycle`
→ `withMapPersistence`
→ `withPersistedMap`
→ `withStructuredWorkflow`
→ `withSemanticModel`
→ `withBusinessPriorityScout`
→ `withEntityReconciliation`
→ `RepositoryExplorer`

Only `RepositoryExplorer` is public/live for new server code. The remaining numbered base is temporary and will be peeled one layer at a time.

## Continuity / coherence rules

For every peel, verify all three:

- **Continuity:** no currently observable behavior disappears unless it is intentionally obsolete.
- **Coherence:** one responsibility has one owning module; avoid keeping older parallel policies under newer overrides.
- **No accidental duplication:** if a newer module fully supersedes an older method/policy, discard the older implementation rather than re-extracting it.

If it is unclear whether an older behavior is still intended product behavior, stop and ask before preserving or deleting it.

## Peel ledger

### Current RepositoryExplorer → V48

Preserved and extracted:
- Batch/cross-workflow unresolved-entity reconciliation.
- Bounded field-description enrichment.
- Final bounded reconciliation pass.

Module:
- `explorer/entityReconciliation.js`

### V48 → V47

Preserved and extracted:
- Canonical semantic entity identity.
- Schema/entity enrichment and authoritative field provenance.
- Business↔physical entity representation links.
- Semantic evidence objects and evidence strengths/provenance.
- Business-priority Scout reranking across legacy workflows and unseen path families.
- Priority-based scheduling/promotion.

Modules:
- `explorer/semanticModel.js`
- `explorer/businessPriorityScout.js`

Discarded:
- Nothing from this layer was judged fully obsolete at extraction time.

### V47 → V46

Preserved and extracted:
- Startup/latest-map restoration lifecycle.
- Repo-specific persisted-map restore behavior.
- Structured Pass-2 workflow reconstruction with ordered steps.
- Entity/field descriptions constrained to supplied schema evidence.
- Structured entity/relationship details.
- Evidence-depth based workflow closure semantics.

Modules:
- `explorer/persistedMap.js`
- `explorer/structuredWorkflow.js`

### V46 → V45

Preserved and extracted:
- Semantic-map persistence keyed by repository revision.
- Traceability fingerprint/source-path enrichment.
- Stop request persistence and stop-after-current-step behavior.
- Persistence hooks on emit/apply-delta.

Module:
- `explorer/mapPersistence.js`

### V45 → V44

Discarded as fully superseded:
- Old Scout `runScout()` policy.
- Old direct Pass-1 promotion/ranking logic in `promoteScoutDirections()`.

Reason:
- `explorer/businessPriorityScout.js` owns the current Scout ranking, legacy-workflow reranking, path promotion and scheduling policy.
- Keeping V45 logic would retain a dead parallel policy underneath an override and reduce coherence.

No V45 module was created.

### V44 → V43

Preserved and extracted:
- `ScoutLayerV2` ownership/state accessor.
- Batch-by-batch unseen-call-path exhaustion lifecycle.
- Fallback from drained admitted workflows into Scout before terminating exploration.
- Deterministic retirement of unchanged Scout batches to prevent spinning.

Module:
- `explorer/scoutLifecycle.js`

Discarded/not carried from this layer:
- No separate ranking/admission policy; current ranking remains owned by `businessPriorityScout.js`.

### V43 → V42

Preserved and extracted:
- Completion handoff from one admitted whole-flow workflow to the next.
- `_wholeFlowNextArcId` scheduling/resume mechanism.
- Immediate Pass-2 resume of the next admitted workflow before returning to the outer legacy loop.
- Retirement and rescheduling when an admitted workflow cannot produce a deterministic flow package.

Module:
- `explorer/wholeFlowScheduler.js`

Discarded as superseded:
- V43's `unfinishedWholeFlowArcs()` ordering by started/opportunity score.

Reason:
- `explorer/businessPriorityScout.js` now owns `unfinishedWholeFlowArcs()` and orders pending workflows by persisted business priority before older opportunity heuristics.
- `wholeFlowScheduler.js` intentionally dispatches to the current composed `unfinishedWholeFlowArcs()` rather than preserving V43's old ordering.

### V42 → V41

Preserved and extracted:
- Per-workflow whole-flow Pass-2 state (`started`, `completed`, unresolved/interpreted branches and call counts).
- Compact call-path family packaging for Pass 2.
- Whole-flow and bounded branch observations built from the precomputed call graph.
- Prompt routing/model-call routing for whole-flow Pass 2.
- Whole-flow retry/logging/accounting behavior.
- Start/resume behavior for a selected Pass-1 workflow.
- Explicit prevention of fallback into node-by-node repository/frontier traversal once an indexed whole-flow workflow has started.

Module:
- `explorer/wholeFlowPass2.js`

Discarded as superseded:
- V42's older shallow Pass-2 response contract (`majorStages`, flat entity/relationship lists).
- V42's older `wholeFlowPrompt()` and `normalizeWholeFlowPass2()` implementations.

Reason:
- `explorer/structuredWorkflow.js` owns the current richer Pass-2 semantic contract: ordered workflow steps, entity details/field descriptions and structured relationship details.
- `wholeFlowPass2.js` retains only the execution engine and dynamically calls the currently composed `wholeFlowPrompt()` / `normalizeWholeFlowPass2()`, preserving the richer behavior rather than duplicating the old schema.

## Runtime contract

- `server/index.js` imports and instantiates only `RepositoryExplorer`.
- `RepositoryExplorer` is the only public explorer class for new code.
- No new `ProgressiveRepositoryExplorerV*` classes are added.
- Existing persisted semantic maps must remain loadable unless a deliberate migration is introduced.

## Repository learning lifecycle

- Clone/load the selected repository and build the repository topology/call-path index.
- Scout works from compressed/maximal call paths rather than rediscovering executable frontiers in Pass 2.
- Call paths are structurally ranked first and business-priority-ranked by the model in bounded batches.
- Scout continues admitting new path families until the path population is exhausted.
- Existing legacy/unranked workflows can be business-priority ranked without requiring the map to be rebuilt.
- User can stop an active learning run and later continue from persisted state.
- User can target a workflow/path from search when automatic learning is stopped.

## Pass 1 behavior

- Classifies a candidate path as business flow / technical / uncertain.
- Creates or updates a business workflow arc only when evidence supports a business use case.
- Maintains actor, intent, outcome/completion condition, priority and path traceability.
- Avoids displaying technical flows as business workflow threads.
- Schedules Pass 2 for admitted business workflows.

## Pass 2 behavior

- Uses the already-built compressed call graph/path evidence to reconstruct the selected end-to-end workflow.
- Produces workflow steps, not merely labels/stages.
- Steps retain compact traceability back to source artifacts/call-path evidence.
- Produces entities, persistent objects, relationships and external effects when supported by evidence.
- Supports entity representation evidence, e.g. a business entity may be represented/stored/referenced through concrete schema entities.
- Does not invent physical schema entities or fields.
- Completion of one admitted whole-flow workflow schedules the next uninterpreted admitted workflow before falling back to Scout or the legacy outer loop.
- Once a deterministic whole-flow Pass-2 interpretation starts, it never regresses to node-by-node frontier exploration; only explicitly unresolved supplied branches may receive bounded follow-up passes.

## Canonical semantic identity

- Case/spacing/punctuation variants of the same semantic name converge to the same semantic identity (`order`, `Order`, `ORDER`).
- Preferred display names are preserved.
- Distinct concepts such as `Order` and `OrderHeader` remain separate semantic objects.
- Canonicalization applies to arc entities, persistent objects and step-level entity mentions.

## Schema/entity enrichment

- Directly resolvable schema entities receive authoritative schema metadata and fields from the framework adapter.
- Business entities without a direct schema remain separate from their concrete persistence representation.
- Representation links preserve the physical source entity and provenance of inherited/exposed fields.
- A business entity may expose fields from multiple supported physical representations without flattening them into a fake physical schema.
- Field provenance identifies the concrete source entity/schema.

## Cross-workflow entity reconciliation

- Exploration does not force an unresolved business entity to resolve immediately.
- Context for unresolved entities accumulates across multiple workflows.
- Reconciliation runs at Scout batch boundaries (nominally every ~10 path families) and at final path exhaustion.
- Reconciliation considers only unresolved entities whose evidence fingerprint changed since the previous attempt.
- Deterministic schema candidates are generated before model reasoning.
- The model may choose only from supplied schema candidates.
- If evidence is insufficient, the entity remains pending for a later batch.
- Mapping and missing field-description enrichment are combined into one bounded model call when possible.
- Final reconciliation uses a small fixed-point loop and terminates when nothing changes.
- Failed reconciliation calls do not mark the evidence fingerprint as completed, allowing retry later.

## Token/cost controls

- Do not dump the whole semantic map into model calls when a compact evidence packet is sufficient.
- Scout ranking operates on bounded candidate batches.
- Pass 2 sends the complete compact precomputed flow family once, with follow-up only for explicitly unresolved supplied branches; it does not rediscover or walk repository nodes incrementally.
- Entity reconciliation sends only changed unresolved entities, compact workflow contexts and a small candidate-schema set.
- Field-description enrichment sends exact fields/types only and cannot add or rename fields.
- Unchanged unresolved entities cost zero model tokens until new evidence arrives.
- Final reconciliation is bounded; no open-ended retry loop.

## Semantic evidence

- Workflows, entities, fields and relationships are first-class semantic objects.
- Evidence sources retain provenance and differing strengths (schema definition, executable evidence, model interpretation/inference, etc.).
- Authoritative schema evidence is distinguished from semantic/model interpretation.
- Business-to-physical representation is recorded as semantic evidence rather than hardcoded framework knowledge.

## Persistence

- Learned map/state is persisted per enterprise/repository context.
- Previously learned flows are restored rather than relearned automatically.
- Persisted workflow priority, semantic identity, entity representation and reconciliation state survive restart.
- Traceability remains available after restore.

## Learning UI-facing behavior

- Workflow list reflects current business-priority order.
- Center learning panel receives rich workflow details and is independently scrollable.
- Map explorer can navigate workflows, entities and relations without exposing implementation/token details.
- Workflow detail contains meaningful steps, related entities/relations and source traceability.
- Entity detail exposes descriptions, fields and physical representation/provenance when available.
- Overall completion is derived from explored/reviewed path coverage.

## Targeted learning search

- Search is disabled while automatic learning is running.
- Search spans already identified/learned workflows and compressed unlearned call paths.
- Results can show compact matched path fragments with gaps rather than dumping raw path structure.
- Selecting an already-known workflow prioritizes it.
- Selecting an unlearned path performs a bounded business-flow classification and, if valid, creates/targets a Pass-1 workflow seed.
- User starts/continues learning explicitly after targeting a flow.

## Query-facing semantic map

- Rich workflow detail includes workflow steps, entity details/fields, representation links and structured relationship details.
- Query logic may use explored workflows as grounded evidence and identified/unexplored areas only as clearly labelled leads.
- Missing workflows/entities/fields are reported rather than invented.
- Analytical queries should be able to infer useful fact/dimension views from the map even when there is no literal entity matching the business word (for example, sales may be derived from orders/order-items when evidence supports it).

## Refactor procedure

For each historical layer, working backwards:

1. Compare the current canonical explorer/module set against the next inherited `ProgressiveRepositoryExplorerVn` class.
2. Identify exactly what behavior/method overrides that layer contributes relative to `V(n-1)`.
3. For each contribution, classify it as **still required**, **fully superseded**, or **ambiguous**.
4. Preserve only still-required behavior, grouped into focused responsibilities (`scout`, `pass1`, `pass2`, `persistence`, `semanticEvidence`, `entityReconciliation`, etc.).
5. Discard fully superseded behavior rather than reproducing it underneath newer overrides.
6. Ask before acting on ambiguous behavior.
7. Keep `RepositoryExplorer` as a thin orchestrator/delegator.
8. Update the peel ledger and current live composition in this file.
9. Verify every applicable behavior-contract item still holds.
10. Only then change the inheritance boundary/remove that historical version.
11. Repeat with the next version.

The inventory itself must be updated whenever intentional product behavior changes.