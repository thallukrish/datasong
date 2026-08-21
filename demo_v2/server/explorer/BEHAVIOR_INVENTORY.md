# RepositoryExplorer behavior inventory

This is the regression contract and peel ledger for the explorer refactor.

Rule: preserve intentional current behavior in one focused owner module; delete superseded traversal/policy code rather than leaving it hidden underneath newer overrides.

## Current live composition

Checkpoint 2026-08-21:

`ModelDirectedExplorerV2`
→ `withLightweightModelCall`
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

Only `RepositoryExplorer` is public/live for new server code. There are no remaining `ProgressiveRepositoryExplorer*` imports in the repository and no new numbered explorer classes may be introduced.

## Checkpoint discipline

- Work in small coherent batches.
- Classify each historical delta as required / superseded / ambiguous.
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
- Workflow state is owned by `Pass1ArcScheduler` through `withPass1State`.
- Business-use-case admission/update normalization is explicit and compact.
- Actor, intent, outcome, priority and traceability remain durable workflow properties.
- Initial call-path and Scout classifications create/update workflows.

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

## Focused owners extracted from the historical chain

- `entityReconciliation.js` — cross-workflow unresolved-entity reconciliation and bounded field-description enrichment.
- `semanticModel.js` — canonical semantic identity, evidence, schema representation and business↔physical mappings.
- `businessPriorityScout.js` — business-priority reranking/scheduling across learned and unseen flows.
- `persistedMap.js` — startup/repository-specific restore lifecycle.
- `structuredWorkflow.js` — ordered workflow steps, entity/field semantics, structured relationships and evidence-depth closure.
- `mapPersistence.js` — semantic-map persistence, traceability and stop/persist behavior.
- `scoutLifecycle.js` — Scout state, unseen-batch exhaustion and fallback before termination.
- `wholeFlowScheduler.js` — completion handoff/resume between admitted workflows.
- `wholeFlowPass2.js` — compact whole-flow interpretation, bounded branch follow-up and its result normalizer.
- `callPathAccess.js` — deterministic ranked/grouped call-path lookup.
- `initialCallPathSeeds.js` — deterministic seed attachment/projection and initial Pass-2 handoff.
- `businessMapAccumulation.js` — persistent objects/external effects accumulation; Discovery disabled.
- `initialCallPathClassifier.js` — bounded initial business-flow classification and priority/admission.
- `callPathSeedPreprocessor.js` — deterministic ranked-path preparation and conversion into Pass-1 seeds.
- `callPathPreprocessLifecycle.js` — preprocessing state/detection/routing.
- `pass1State.js` — Pass1 scheduler ownership, normalization/admission contract and minimal delta handoff; legacy Pass2 DFS state retained only as compatibility state where existing seed/persisted contracts still touch it.
- `modelCall.js` — focused lightweight JSON model call utility, including optional single-step console gating.

## Historical peel ledger

### V48 → V41
- V48 current delta preserved as `entityReconciliation.js`.
- V48/V47 semantic identity/evidence/schema representation and business-priority behavior preserved as `semanticModel.js` + `businessPriorityScout.js`.
- V47/V46 restore and structured-workflow behavior preserved as `persistedMap.js` + `structuredWorkflow.js`.
- V46/V45 persistence/stop/traceability behavior preserved as `mapPersistence.js`.
- V45 old Scout policy discarded as superseded.
- V44 Scout lifecycle preserved as `scoutLifecycle.js`.
- V43 completion handoff preserved as `wholeFlowScheduler.js`; old ordering discarded.
- V42 whole-flow engine preserved as `wholeFlowPass2.js`; shallow output contract discarded.
- V41 node-by-node graph interpreter discarded completely.

### V40 → V23
- V40 deterministic call-path lookup preserved as `callPathAccess.js`; graph navigation discarded.
- V39 XML/node-walker traversal discarded.
- V38 deterministic seed handoff preserved as `initialCallPathSeeds.js`; seed-local DFS discarded.
- V37 durable persistent/external-effect accumulation preserved as `businessMapAccumulation.js`; Scout/Discovery policy discarded.
- V36 corrected initial seed projection absorbed into `initialCallPathSeeds.js`; old runtime/UI bookkeeping discarded.
- V35 UI/topology duplication discarded.
- V34 initial business classifier preserved as `initialCallPathClassifier.js`.
- V33 old classifier prompt discarded.
- V32 old call-path packing discarded.
- V31 seed preprocessing preserved as `callPathSeedPreprocessor.js`.
- V30 old model-containment routing discarded.
- V29 preprocessing lifecycle preserved as `callPathPreprocessLifecycle.js`.
- V28 had no separate surviving responsibility.
- V27/V26/V25 Discovery-era qualification/bridging/infrastructure discarded.
- V24 pre-admission broad traversal discarded.
- V23 pre-admission frontier/search fallback discarded.

### V22 → V18
- V22 business-use-case normalization/admission contract preserved in `pass1State.js`; mixed Pass1/Pass2 prompt and candidate navigation discarded.
- V21 Pass1 scheduler ownership/minimal delta handoff preserved in `pass1State.js`; per-arc DFS/navigation discarded.
- `wholeFlowPass2.js` was made to explicitly own `normalizeWholeFlowPass2()` rather than inheriting it accidentally.
- V20 semantic-source-container browse normalization discarded.
- V19 durable-thread/arc-title compatibility discarded.
- V18 typed XML/file browse normalization and XML hierarchy compaction discarded.

### V17 → V9
- V17 compact artifact/candidate navigator discarded.
- V16 candidate-scoring prompt/descriptor discarded.
- V15 lazy XML/JMX hierarchy prompt discarded.
- V14 repeated-directory handling discarded.
- V13 ordered semantic-search plan/retry machinery discarded.
- V12 repeated-artifact/no-repeat escape behavior discarded.
- V11 old artifact-driven Pass-1 discovery implementation discarded; required state/admission/update behavior already lives in `Pass1ArcScheduler` + `pass1State.js`.
- V10 semantic DFS escape/backtracking discarded.
- V9 browse-path canonicalization discarded.

### V8 → V6
- V8 business-flow objective prompt decoration discarded as implementation; the product intent is enforced by the current call-path classifiers and Scout.
- V7 semantic-scoring rubric discarded with the old candidate walker.
- V6 semantic branch flattening/scored DFS/backtracking discarded completely.

### V5 → V2
- V5 `lightweightModelCall()` preserved as `modelCall.js`; repository-orientation/source-index prompt routes discarded.
- V4 proto-thread machinery discarded; first-class Pass-1 workflows/semantic objects supersede it.
- V3 old thread/browse validation discarded.
- V2 orientation/validation bridge discarded.

### Non-numbered ProgressiveRepositoryExplorer → ModelDirectedExplorerV2
Discarded completely:
- model-driven repository directory orientation
- source-file index browsing
- direct XML/config/text interpretation path
- `listDirectory` / `getFunction` / direct-file browse validation and execution
- raw repository-browse prompt contracts and coverage bookkeeping tied to that path

Reason:
- current learning starts from deterministic topology/call-path evidence and whole-flow interpretation; no focused module calls these browse-specific methods.
- generic model/run mechanics remain supplied by `ModelDirectedExplorerV2` and lower bases.

## Physical cleanup status

- All numbered `progressiveRepositoryExplorerV*.js` layers have been deleted.
- The non-numbered `progressiveRepositoryExplorer.js` has also been deleted.
- Repository search reports no remaining `progressiveRepositoryExplorer` references.
- `RepositoryExplorer` now composes directly over `ModelDirectedExplorerV2` plus focused modules.
- Duplicate `callPathLookup.js` was removed; `callPathAccess.js` is the single call-path lookup owner.

## Remaining cleanup opportunity

Inspect `ModelDirectedExplorerV2` / `ModelDirectedExplorer` next. They still contain the older generic semantic-neighborhood/thread-navigation implementation. Do not remove them wholesale until the focused modules' dependencies on generic run/model/accounting/state mechanics are separated from obsolete navigation behavior.