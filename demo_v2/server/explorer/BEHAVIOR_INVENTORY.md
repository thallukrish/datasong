# RepositoryExplorer behavior inventory

This file is the regression contract and peel ledger for dismantling the historical `ProgressiveRepositoryExplorerV*` inheritance chain.

Rule: **before removing any historical layer, the canonical `RepositoryExplorer` plus focused modules must preserve every intentional behavior listed here.**

## Current live composition

Checkpoint 2026-08-21:

`ProgressiveRepositoryExplorerV23`
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

Only `RepositoryExplorer` is public/live for new server code. The remaining numbered base is temporary and will continue to be peeled in small committed batches.

## Checkpoint discipline

- Inspect only a small coherent historical batch (normally 2–4 layers).
- Classify behavior as required / superseded / ambiguous.
- Extract only required behavior; discard superseded behavior.
- Wire the canonical explorer to the new boundary.
- Update this ledger.
- Commit the checkpoint before continuing.
- Verify there are no imports to deleted numbered layers and no missing live base.
- Prefer a runnable/recoverable repository after every checkpoint rather than a long half-completed archaeology chain.
- If behavior is ambiguous, stop and ask before preserving or deleting it.

## Continuity / coherence rules

For every peel verify:

- **Continuity:** no intended current behavior disappears.
- **Coherence:** one responsibility has one owning module.
- **No accidental duplication:** superseded older policies are discarded rather than re-extracted.
- **No resurrection:** an intentionally retired traversal/policy must not remain reachable underneath newer overrides.
- **Ambiguity:** if it is unclear whether older behavior is still intended, ask before preserving or deleting it.

## Peel ledger

### Current RepositoryExplorer → V48
Preserved in `explorer/entityReconciliation.js`:
- Batch/cross-workflow unresolved-entity reconciliation.
- Bounded field-description enrichment.
- Final bounded reconciliation pass.

### V48 → V47
Preserved in `explorer/semanticModel.js` and `explorer/businessPriorityScout.js`:
- Canonical semantic entity identity.
- Schema/entity enrichment and authoritative field provenance.
- Business↔physical representation evidence.
- First-class semantic evidence with strengths/provenance.
- Business-priority reranking across legacy workflows and unseen path families.
- Priority-based path promotion and scheduling.

### V47 → V46
Preserved in `explorer/persistedMap.js` and `explorer/structuredWorkflow.js`:
- Startup/latest-map and repo-specific restore lifecycle.
- Structured Pass-2 workflow reconstruction with ordered steps.
- Schema-constrained entity/field descriptions.
- Structured relationship details.
- Evidence-depth based closure semantics.

### V46 → V45
Preserved in `explorer/mapPersistence.js`:
- Semantic-map persistence keyed by repository revision.
- Traceability fingerprint/source-path enrichment.
- Stop request persistence and stop-after-current-step behavior.
- Persistence hooks on emit/apply-delta.

### V45 → V44
Discarded as fully superseded:
- Old Scout `runScout()` policy.
- Old direct Pass-1 promotion/ranking logic in `promoteScoutDirections()`.

Reason: `explorer/businessPriorityScout.js` owns the current ranking, legacy-workflow reranking, path promotion and scheduling policy.

### V44 → V43
Preserved in `explorer/scoutLifecycle.js`:
- `ScoutLayerV2` ownership/state accessor.
- Batch-by-batch unseen-call-path exhaustion.
- Fallback from drained admitted workflows into Scout before termination.
- Deterministic retirement of unchanged Scout batches to prevent spinning.

Not preserved: separate old ranking/admission policy; current policy is owned by `businessPriorityScout.js`.

### V43 → V42
Preserved in `explorer/wholeFlowScheduler.js`:
- Completion handoff from one admitted whole-flow workflow to the next.
- `_wholeFlowNextArcId` scheduling/resume behavior.
- Immediate Pass-2 resume before falling back to Scout/outer loop.
- Retirement/rescheduling when an admitted workflow cannot produce a deterministic flow package.

Discarded: V43 ordering by started/opportunity score.
Reason: `businessPriorityScout.js` owns current priority-aware ordering.

### V42 → V41
Preserved in `explorer/wholeFlowPass2.js`:
- Per-workflow whole-flow state.
- Compact call-path family packaging.
- Whole-flow and bounded branch observations.
- Whole-flow model routing, retry/logging/accounting.
- Start/resume behavior for selected Pass-1 workflows.
- Prevention of fallback into node-by-node traversal after whole-flow interpretation starts.

Discarded as superseded:
- V42 shallow semantic output contract and prompt semantics.
Reason: `structuredWorkflow.js` owns the richer ordered-step/entity/field/relationship contract.

### V41 → V40
Discarded completely as obsolete:
- Node-by-node Pass-2 call-graph interpreter.
- Per-node graph prompt and branch scoring.
- Advance/backtrack graph navigation model calls.
- Node-level retry/logging path.

Reason: whole compressed-flow Pass 2 supersedes this traversal model and current behavior explicitly forbids fallback to node-by-node graph rediscovery.

## Audited historical bridge: V40 → V23

This section closes the earlier documentation gap. The historical layers were already removed while their surviving behavior was extracted. They are archaeological evidence only; they are not to be recreated.

### V40 → V39
Preserved:
- Deterministic `rankedPathById()` / `groupedPathForArc()` lookup in `explorer/callPathAccess.js`.

Discarded:
- V40 graph-navigation machinery, already superseded by whole-flow Pass 2.

Cleanup:
- A second accidentally-created `callPathLookup.js` implementation duplicated this responsibility and has been deleted. `callPathAccess.js` is the single owner.

### V39 → V38
Discarded:
- Moqui XML same-file compression/navigation behavior used by the old node walker.

Reason:
- Current topology/call-path preprocessing provides deterministic compact flow evidence before Pass 2; the old traversal optimization must not be resurrected.

### V38 → V37
Preserved in `explorer/initialCallPathSeeds.js`:
- Deterministic seed artifact/source-path attachment for admitted call-path workflows.
- Initial seed projection and Pass-2 handoff.

Discarded:
- Seed-local DFS state/navigation.

Reason:
- Whole-flow Pass 2 starts from the complete selected call-path family, not local DFS.

### V37 → V36
Preserved in `explorer/businessMapAccumulation.js`:
- Discovery remains disabled in the modern runtime.
- `persistentObjects` and `externalEffects` are normalized and accumulated as durable workflow evidence.

Discarded:
- V37 Scout/discovery policy superseded by current call-path Scout architecture.

### V36 → V35
Preserved:
- Corrected initial deterministic seed projection/scheduling is absorbed by `explorer/initialCallPathSeeds.js`.

Discarded:
- Superseded runtime/stop/UI bookkeeping; stop/persistence is owned by `mapPersistence.js` and semantic scheduling by current modules.

### V35 → V34
Discarded:
- Obsolete UI/topology projection duplication.

Reason:
- It did not own semantic learning behavior required by the current explorer.

### V34 → V33
Preserved in `explorer/initialCallPathClassifier.js`:
- Bounded initial top-call-path business-flow classification.
- Initial business priority/seed admission without an extra Scout rediscovery cycle.

### V33 → V32
Discarded:
- Older classifier prompt/schema layer.

Reason:
- Superseded by the extracted current initial classifier contract.

### V32 → V31
Discarded:
- Older call-path shape/packing policy.

Reason:
- Superseded by the current deterministic seed preprocessor and compact whole-flow package.

### V31 → V30
Preserved in `explorer/callPathSeedPreprocessor.js`:
- Deterministic preparation of ranked call-path candidates for business seed classification.
- Conversion of accepted classifications into Pass-1 workflow seeds with call-path traceability.

### V30 → V29
Discarded:
- Older model-containment/prompt routing layer that is superseded by current classifier and whole-flow model routing.

### V29 → V28
Preserved in `explorer/callPathPreprocessLifecycle.js`:
- `callPathPreprocess` state ownership.
- Detection of pending initial call-path preprocessing.
- Routing the initial preprocessing prompt before normal semantic work.

### V28 → V27
No separate current responsibility survives as an owning module.
- Any useful call-path preprocessing behavior is already owned by V29/V31-derived focused modules.
- Older traversal/discovery policy is not retained.

### V27 → V26
Discarded:
- Discovery qualification loop.

Reason:
- Discovery is intentionally disabled; business flows originate from deterministic call paths and Scout.

### V26 → V25
Discarded:
- Scout/discovery bridging from the retired Discovery architecture.

Reason:
- Current `scoutLifecycle.js` + `businessPriorityScout.js` own unseen-path exhaustion, ranking and admission.

### V25 → V24
Discarded:
- Retired Discovery infrastructure.

Reason:
- Discovery must remain unreachable in the current product architecture.

### V24 → V23
Discarded:
- Pre-admission traversal layer from the old frontier-based architecture.

Reason:
- Initial call-path preprocessing/classification and later Scout batches now provide business-flow candidates deterministically. We do not preserve a hidden fallback into broad frontier exploration.

### Bridge continuity conclusion
The V40→V23 bridge is now accounted for without recreating historical classes. Current ownership is coherent:
- call-path lookup → `callPathAccess.js`
- initial preprocessing lifecycle → `callPathPreprocessLifecycle.js`
- seed preparation/admission → `callPathSeedPreprocessor.js`
- initial business classification → `initialCallPathClassifier.js`
- initial Pass-2 handoff → `initialCallPathSeeds.js`
- persistent/external business evidence → `businessMapAccumulation.js`
- whole-flow interpretation → `wholeFlowPass2.js` + `structuredWorkflow.js`
- ongoing unseen-path learning → `scoutLifecycle.js` + `businessPriorityScout.js`

No historical V24–V40 traversal/discovery class is required by the live runtime.

### V23 → V22 (next checkpoint target)
V23 is pre-admission frontier/semantic-search traversal from the older architecture. Before preserving any of it, verify whether deterministic initial call-path classification/seeding now guarantees admitted business arcs and therefore supersedes V23 pre-admission exploration. Do not preserve the old frontier walker by default.

### V22 → V21 (next checkpoint target)
V22 contains the business-use-case admission normalization contract. Parts may still be required because modern whole-flow results ultimately update the Pass-1 arc board. Preserve only normalization/admission semantics still consumed by current modules; discard old candidate DFS/navigation policy.

### V21 → V20 (next checkpoint target)
V21 owns `Pass1ArcScheduler` / `Pass2ArcExplorerState` accessors and the old Pass1/Pass2 semantic handoff. Preserve Pass-1 arc-state ownership and any current delta-application contract still required. The per-arc DFS candidate navigation is obsolete under whole-flow Pass 2 and must not survive.

## Runtime contract

- `server/index.js` imports and instantiates only `RepositoryExplorer`.
- `RepositoryExplorer` is the only public explorer class for new code.
- No new `ProgressiveRepositoryExplorerV*` classes are added.
- Existing persisted semantic maps remain loadable unless a deliberate migration is introduced.

## Repository learning lifecycle

- Load the selected repository and build deterministic repository topology/call-path indexes.
- Scout works from compressed/maximal call paths rather than rediscovering executable frontiers in Pass 2.
- Call paths are structurally ranked first and business-priority-ranked in bounded model batches.
- Scout continues through unseen path batches until the population is exhausted.
- Legacy/unranked workflows can be ranked without rebuilding the map.
- User can stop and later continue from persisted state.
- User can target a workflow/path from search while automatic learning is stopped.

## Pass 1 behavior

- Classifies a candidate path as business flow / technical / uncertain.
- Creates or updates a business workflow only when evidence supports a business use case.
- Maintains actor, intent, outcome/completion condition, priority and traceability.
- Technical flows are not displayed as business workflow threads.
- Admitted business workflows are scheduled for Pass 2.

## Pass 2 behavior

- Uses the already-built compressed call graph/path evidence to reconstruct the selected end-to-end workflow.
- Produces ordered workflow steps, not merely labels/stages.
- Steps retain compact traceability to source/call-path evidence.
- Produces entities, persistent objects, relationships and external effects when evidenced.
- Supports business↔physical entity representation evidence.
- Does not invent physical schemas or fields.
- Completion of one admitted workflow schedules the next before falling back to Scout/outer loop.
- Once deterministic whole-flow Pass 2 starts, it **never** regresses to node-by-node frontier/call-graph exploration; only explicitly unresolved supplied branches may receive bounded follow-up passes.

## Canonical semantic identity

- Case/spacing/punctuation variants converge to one identity (`order`, `Order`, `ORDER`).
- Preferred display names are preserved.
- Distinct concepts such as `Order` and `OrderHeader` stay distinct.
- Canonicalization covers arc entities, persistent objects and step-level mentions.

## Schema/entity enrichment

- Directly resolvable schema entities receive authoritative metadata and fields from the framework adapter.
- Business entities without direct schemas remain separate from concrete persistence representations.
- Representation links preserve physical source and provenance.
- Business entities may expose fields from multiple evidenced representations without becoming a fake flattened physical schema.

## Cross-workflow entity reconciliation

- Unresolved entities accumulate context across workflows rather than being forced to resolve immediately.
- Reconciliation runs at Scout batch boundaries and final path exhaustion.
- Only unresolved entities with changed evidence fingerprints are reconsidered.
- Deterministic schema candidates are generated before model reasoning; the model may choose only supplied candidates.
- Insufficient evidence leaves an entity pending for a later batch.
- Mapping and missing field-description enrichment are combined into one bounded call when possible.
- Final reconciliation is bounded and stops when nothing changes.
- Failed reconciliation does not mark an evidence fingerprint complete.

## Token/cost controls

- Do not dump the whole semantic map into model calls when compact evidence is sufficient.
- Scout ranking uses bounded candidate batches.
- Pass 2 sends a compact precomputed flow family once, with follow-up only for explicitly unresolved supplied branches.
- Entity reconciliation sends only changed unresolved entities, compact workflow contexts and a small deterministic candidate set.
- Field-description enrichment sends exact fields/types only and cannot add/rename fields.
- Unchanged unresolved entities cost zero model tokens until new evidence arrives.
- Final reconciliation has no open-ended retry loop.

## Semantic evidence

- Workflows, entities, fields and relationships are first-class semantic objects.
- Evidence sources retain provenance and differing strengths.
- Authoritative schema evidence is distinguished from model interpretation/inference.
- Business-to-physical representation is evidence-backed rather than hardcoded framework knowledge.

## Persistence

- Learned state is persisted per repository revision / enterprise context.
- Previously learned flows are restored instead of automatically relearned.
- Workflow priority, semantic identity, entity representations and reconciliation state survive restart.
- Traceability survives restore.

## Learning UI-facing behavior

- Workflow list reflects business-priority order.
- Center learning panel receives rich workflow detail and scrolls independently.
- Map explorer navigates workflows, entities and relations without exposing implementation/token details.
- Workflow detail contains meaningful steps, entities/relations and traceability.
- Entity detail exposes descriptions, fields and physical representation/provenance when available.
- Overall completion derives from explored/reviewed path coverage.

## Targeted learning search

- Search is disabled while automatic learning runs.
- Search spans learned workflows and compressed unlearned call paths.
- Results show compact matched path fragments with gaps rather than raw path dumps.
- Selecting a known workflow prioritizes it.
- Selecting an unlearned path performs bounded business-flow classification and, if valid, creates/targets a Pass-1 seed.
- User explicitly starts/continues learning after targeting.

## Query-facing semantic map

- Rich workflow detail includes steps, entity details/fields, representation links and structured relationships.
- Query may use explored workflows as grounded evidence and unexplored areas only as clearly labelled leads.
- Missing workflows/entities/fields are reported rather than invented.
- Analytical queries may infer useful fact/dimension views even without a literal entity matching the business term when map evidence supports the derivation.

## Refactor procedure

For each historical layer, working backwards:

1. Compare the current canonical explorer/module set against the next inherited `ProgressiveRepositoryExplorerVn` class.
2. Identify only the behavior/method overrides contributed relative to `V(n-1)`.
3. Classify each contribution as **still required**, **fully superseded**, or **ambiguous**.
4. Preserve only still-required behavior in focused modules.
5. Discard fully superseded behavior rather than reproducing it underneath newer overrides.
6. Ask before acting on ambiguous behavior.
7. Keep `RepositoryExplorer` thin.
8. Update this ledger and current composition.
9. Check continuity, coherence and duplicate/forbidden fallbacks.
10. Commit a runnable/recoverable checkpoint.
11. Only then change the inheritance boundary/remove that historical version.
12. Repeat.

Update this inventory whenever intentional product behavior changes.