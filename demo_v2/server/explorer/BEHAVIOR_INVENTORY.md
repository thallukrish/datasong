# RepositoryExplorer behavior inventory

This is the regression contract and peel ledger for removing the historical `ProgressiveRepositoryExplorerV*` inheritance chain.

Rule: before deleting a historical layer, preserve every intentional current behavior in one focused owner module. Superseded traversal/policy code is deleted, not hidden underneath newer overrides.

## Current live composition

Checkpoint 2026-08-21:

`ProgressiveRepositoryExplorerV8`
→ `withPass1State`
→ `withCallPathPreprocessLifecycle`
→ `withCallPathSeedPreprocessor`
→ `withInitialCallPathClassifier`
→ `withBusinessMapAccumulation`
→ `withInitialCallPathSeeds`
→ `withCallPathAccess`
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

Only `RepositoryExplorer` is public/live for new server code.

## Checkpoint discipline

- Work in small coherent batches, normally 2–4 historical layers.
- Classify each delta as required / superseded / ambiguous.
- Extract only required behavior.
- Delete superseded behavior physically.
- Update this ledger and commit before continuing.
- Verify no live import points to a deleted layer.
- Never resurrect node-by-node Pass-2 traversal or the retired Discovery architecture.
- Ask before changing ambiguous product semantics.

## Current behavior contract

### Learning and scheduling
- Build deterministic repository topology/call-path indexes.
- Initial bounded call-path classification seeds genuine business workflows.
- Technical paths are not shown as business workflows.
- Scout continues through unseen call-path batches until exhausted.
- Existing unranked workflows can be reranked without rebuilding the map.
- Business priority controls workflow ordering/scheduling.
- Stop persists the map and later resume continues from learned state.

### Pass 1
- Pass-1 workflow state is owned by `Pass1ArcScheduler` through `withPass1State`.
- Business-use-case admission/update normalization remains compact and explicit.
- Actor, intent, outcome, priority and traceability remain durable workflow properties.
- Initial call-path and Scout classifications create/update Pass-1 workflows.

### Pass 2
- Pass 2 consumes the complete compact deterministic call-path family, not repository frontier nodes.
- Produces ordered workflow steps, entities, relationships, persistent objects and external effects.
- Whole-flow result normalization is explicitly owned by `wholeFlowPass2.js` and feeds the Pass-1 normalized delta contract.
- Only materially unresolved supplied branches receive bounded follow-up passes.
- Once whole-flow Pass 2 starts, node-by-node DFS/navigation is forbidden.

### Semantic model
- Workflows, entities, fields and relations are first-class semantic objects.
- Entity identity is canonicalized without collapsing genuinely distinct concepts.
- Authoritative schema evidence is distinguished from model interpretation.
- Business entities can map to evidenced physical representations without pretending to be physical schemas.
- Missing entity mappings/field descriptions reconcile across workflow batches with bounded model calls.

### Persistence and query-facing map
- Semantic state is persisted per repository revision/enterprise context.
- Traceability, priorities, semantic identities and reconciliation state survive restart.
- Query-facing workflows expose steps, entity details/fields, relationships and representation evidence.
- Missing workflows/entities/fields are reported rather than invented.

## Peel ledger

### Current → V48
Preserved: `entityReconciliation.js` — cross-workflow unresolved-entity reconciliation, bounded field descriptions, final bounded reconciliation.

### V48 → V47
Preserved: `semanticModel.js`, `businessPriorityScout.js` — semantic identity/evidence/schema representation plus business-priority ranking/scheduling.

### V47 → V46
Preserved: `persistedMap.js`, `structuredWorkflow.js` — restore lifecycle, ordered workflow reconstruction, schema-constrained field semantics, structured relations, evidence-depth closure.

### V46 → V45
Preserved: `mapPersistence.js` — persisted semantic map, traceability enrichment, stop/persist behavior.

### V45 → V44
Discarded: old Scout ranking/admission policy. Superseded by `businessPriorityScout.js`.

### V44 → V43
Preserved: `scoutLifecycle.js` — Scout state, unseen-batch exhaustion, fallback to Scout before termination, unchanged-batch retirement.

### V43 → V42
Preserved: `wholeFlowScheduler.js` — completion handoff/resume between admitted workflows. Old ordering discarded; business-priority ordering owns it now.

### V42 → V41
Preserved: `wholeFlowPass2.js` — whole-flow state, compact flow packaging, bounded branch follow-up, model routing/retry/accounting. Old shallow semantic contract discarded in favor of `structuredWorkflow.js`.

### V41 → V40
Discarded completely: node-by-node call-graph interpreter and graph navigator.

### V40 → V39
Preserved: `callPathAccess.js` — deterministic ranked/grouped call-path lookup. Duplicate `callPathLookup.js` removed.

### V39 → V38
Discarded: old XML/node-walker compression/navigation behavior.

### V38 → V37
Preserved: `initialCallPathSeeds.js` — deterministic seed attachment/projection and initial Pass-2 handoff. Seed-local DFS discarded.

### V37 → V36
Preserved: `businessMapAccumulation.js` — Discovery disabled; persistent objects/external effects accumulated as business evidence. Old Scout/Discovery policy discarded.

### V36 → V35
Preserved only corrected initial seed projection/scheduling in `initialCallPathSeeds.js`. Superseded runtime/UI/stop bookkeeping discarded.

### V35 → V34
Discarded: obsolete UI/topology projection duplication.

### V34 → V33
Preserved: `initialCallPathClassifier.js` — bounded initial call-path business-flow classification and priority/admission.

### V33 → V32
Discarded: superseded older classifier prompt/schema layer.

### V32 → V31
Discarded: older call-path packing policy.

### V31 → V30
Preserved: `callPathSeedPreprocessor.js` — deterministic ranked path preparation and accepted-classification conversion into Pass-1 seeds.

### V30 → V29
Discarded: superseded model-containment/prompt-routing layer.

### V29 → V28
Preserved: `callPathPreprocessLifecycle.js` — initial preprocessing state/detection/routing.

### V28 → V27
No separate current responsibility survives; useful preprocessing behavior is already owned by focused modules.

### V27 → V26
Discarded: old Discovery qualification loop.

### V26 → V25
Discarded: Scout-to-Discovery bridging from retired architecture.

### V25 → V24
Discarded: retired Discovery infrastructure.

### V24 → V23
Discarded: old pre-admission broad/frontier traversal.

### V23 → V22
Discarded: pre-admission frontier walk/search/fallback traversal. Deterministic call-path classification/seeding and Scout own candidate discovery.

### V22 → V21
Preserved in `pass1State.js`: business-use-case normalization/admission contract. Old mixed Pass1/Pass2 prompt and candidate navigation discarded.

### V21 → V20
Preserved in `pass1State.js`: `Pass1ArcScheduler` ownership, compatibility `Pass2ArcExplorerState` accessor, Pass-1 delta application and compact semantic helpers. Per-arc DFS/navigation discarded.

Additional fix: `wholeFlowPass2.js` explicitly owns `normalizeWholeFlowPass2()` instead of inheriting it historically.

### V20 → V19
Discarded completely: semantic-source-container browse request normalization and source-container prompt hint. Current learning does not ask the model to navigate repository artifacts.

### V19 → V18
Discarded completely: durable-thread ID vs Pass-1 arc-title compatibility. Current semantic map uses explicit Pass-1 workflows/semantic objects rather than the old thread-placement contract.

### V18 → V17
Discarded completely: typed XML/file browse normalization, XML-node validation and XML hierarchy prompt compaction. Deterministic call-path preprocessing replaces this browse path.

### V17 → V16
Discarded completely: old compact Pass-1 artifact/candidate prompt, thread/proto boards and generic `callModel` routing. Current model modes have focused owners.

### V16 → V15
Discarded completely: old semantic-neighborhood candidate scoring prompt/descriptor used by frontier traversal.

### V15 → V14
Discarded completely: lazy XML/JMX hierarchy navigation prompt policy.

### V14 → V13
Discarded completely: repeated-directory normalization and directory-choice browse observations.

### V13 → V12
Discarded completely: ordered semantic-search plans/retries and semantic-fit based search switching.

### V12 → V11
Discarded completely: repeated-artifact guard plus semantic escape/backtrack behavior from the old broad frontier walker.

### V11 → V10
Discarded as implementation: old broad artifact-driven Pass-1 discovery, arc seed search/switching and prompt contract. Its required state/admission/update behavior is already owned by `Pass1ArcScheduler` + `pass1State.js`.

### V10 → V9
Discarded completely: semantically-pruned DFS backtracking and goal-directed semantic escape.

### V9 → V8
Discarded completely: model browse-path canonicalization for `getArtifact` requests.

## Physical cleanup status

Deleted from the live inheritance chain through this checkpoint:
- V9–V48 as applicable to the modern runtime, with surviving responsibilities extracted above.
- The canonical runtime is now based on `ProgressiveRepositoryExplorerV8`.
- No new numbered explorer classes may be introduced.

## Next peel target

Inspect V8 → V7 → V6. Preserve only stable mechanics still called by focused modules; continue deleting traversal-era behavior. The eventual destination is the non-numbered stable base plus focused `explorer/` modules.
