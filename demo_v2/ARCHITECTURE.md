# DataSong v2 semantic exploration architecture

## Status

This document describes the concrete `demo_v2` learning architecture.

The canonical whole-system LeMap architecture, including persistence and the current Query-v4 path, is now documented in `docs/LEMAP_ARCHITECTURE.md`.

## Objective

DataSong reconstructs end-to-end business use cases from heterogeneous enterprise evidence.

A business-use-case arc is one coherent actor goal with a recognizable completion condition and business/user outcome. Technical structure, UI hierarchy and broad functional areas are evidence, not automatically business flows.

---

# Two parallel routes into one Pass-1 arc board

```text
ROUTE A — semantic discovery

Scout
  ↓
Discovery
  ↓ qualified concrete actor goals
  ┐
  ├────────────→ Pass 1 → Pass 2
  ┘

ROUTE B — deterministic executable-path discovery

Repository
  ↓
Executable graph
  ↓
Branch/cycle-aware call paths
  ↓
Longest grouped paths
  ↓
LLM business/boundary classification
  ↓
Deterministic clipping + containment
  ↓ maximal coherent business-flow seeds
  ┘
```

The two routes are independent until Pass 1.

Call-path evidence is **not mixed into Discovery's next-level candidates**.

---

# Route A — Scout and Discovery

Scout asks whether DataSong is missing a materially different business-use-case direction.

Discovery then tests a promising entrance shallowly until it exposes one concrete actor goal.

A Discovery start qualifies when the returned evidence supports:

```text
isConcreteBusinessUseCase = true
businessActor
businessIntent
completionCondition
businessOutcome
```

DataSong derives qualification mechanically from these fields. The model does not need to set a second redundant qualification boolean.

Qualified starts are frozen in Discovery and promoted into Pass 1.

---

# Route B — deterministic executable-path preprocessing

The call-path preprocessor does not ask the model to roam through source files.

It first constructs executable topology deterministically:

```text
repository
→ executable nodes
→ executable edges
→ paths
→ compressed shared structure
→ grouped longest paths
```

## Executable nodes

The path indexer uses one abstraction regardless of source format:

```text
ExecutableNode {
  id
  signature
  provenance
  outgoingEdges[]
}
```

Ordinary code parsers produce function/method nodes.

Structured formats use dialect-specific deterministic adapters. XML itself has no universal execution semantics.

Current example:

```text
Moqui XML adapter
```

Future adapters may cover BPMN, Spring XML, packaged application workflow formats, etc.

---

# Moqui XML adapter

The current Moqui adapter recognizes executable elements such as:

```text
screen
transition
transition-include
actions
service-call
entity-find / entity-one / entity-find-count
entity-create / entity-update / entity-delete
if / condition / else / iterate
set / script
default-response / conditional-response / error-response
subscreens-item
```

These become executable graph nodes/edges alongside ordinary code functions.

Cross-screen navigation is followed only when the target is resolved deterministically inside the supplied repository.

External service/library implementations are never assumed.

```text
inside supplied repo  → follow
outside supplied repo → terminate as EXTERNAL
```

The same architectural rule applies to entity schemas: generic relationships should be parsed generically, while framework-specific entity semantics belong behind adapters such as the current Moqui entity-schema adapter.

---

# Path representation

Branches are separate executable paths mechanically, while repeated structure is compressed through references.

```text
P0: A → B → C
P1: REF(P0) → D → E
P2: REF(P0) → F → G
```

Cycles terminate through references rather than infinite expansion.

```text
P7: X → Y → Z → REF(P7)
```

The LLM never sees this compressed storage directly. Selected paths are reconstructed into signatures before classification.

---

# Longest-path heuristic

Initial ranking remains deliberately simple:

```text
effective executable node count
```

Long orchestration paths are surfaced first because they often correspond to business workflows, while helpers are usually short.

This is only a heuristic; the model may still classify a long path as technical or uncertain.

---

# Branch grouping

Raw traversal can produce many near-identical branch variants.

Before taking the top N, DataSong groups heavily overlapping variants and sends one representative path plus compact branch summaries.

```text
representative rendered path
branchVariantCount
small divergent tails
terminal kinds
```

This avoids wasting top-N slots and prompt tokens on repeated variants.

---

# Edge semantics and semantic boundaries

Rendered paths retain structural edge type:

```text
CALL
NEXT
TRIGGER
NAVIGATE
EXTERNAL CALL
```

`CALL`, `NEXT` and `TRIGGER` normally preserve execution continuity.

`NAVIGATE` is weaker semantic continuity. It may continue the same business flow:

```text
Checkout → Review → Place Order
```

or cross into another actor goal:

```text
Change Password → Login → Cart Recovery
```

The model has only one boundary job:

> identify the coherent business segment and the last signature belonging to it.

For example:

```text
Change Password
→ update Password
→ NAVIGATE Login
```

may return:

```text
flowTitle = Change Password
coherentThroughSignature = update Password
```

The model does **not** decide parent/subflow relationships between paths.

---

# Deterministic containment after clipping

After model classification, DataSong clips each business path at `coherentThroughSignature`.

Then containment is calculated mechanically on the clipped signature sequences.

Example:

```text
A: Search
B: Search → Add to Cart
C: Search → Add to Cart → Update Cart
```

DataSong can prove:

```text
A ⊂ B ⊂ C
```

No LLM judgment is needed for this.

Only maximal coherent business segments seed Pass 1.

Contained paths remain attached as supporting evidence:

```text
C seeds Pass 1
B attached to C
A attached to C/B as contained evidence
```

If two clipped paths are not structurally contained, they remain independent even when navigation connects them.

This prevents mistakes such as treating:

```text
Place Order
→ NAVIGATE
View Order Detail
```

as a parent/subflow relationship merely because the paths are adjacent.

---

# Call-path LLM contract

For each grouped top path the model returns only:

```text
classification: business_flow | technical | uncertain
confidence
flowTitle
businessActor
businessIntent
completionCondition
businessOutcome
semanticBoundaryAt
coherentThroughSignature
reason
```

The model does **not** compare paths and does **not** return broader/subflow/alternate relationships.

DataSong owns structural containment deterministically.

---

# Transition into Pass 1

Qualified arcs may come from either route:

```text
Discovery-qualified actor goal
        ↓
Pass-1 arc

Maximal coherent call-path flow
        ↓
Pass-1 arc
```

Each arc preserves its discovery provenance.

From Pass 1 onward, both routes use the same detailed exploration machinery.

---

# Pass 1

Pass 1 is the scheduler across qualified business arcs.

It maintains stable arc identity, actor/intent, progress, evidence and outcome, and decides which qualified arc receives the next exploration turn.

Pass 1 should favor semantic progress and completion pressure rather than simply selecting the least-explored arc. A nearly closed high-signal business flow may be completed before the system opens another weak direction.

---

# Pass 2

Pass 2 reconstructs one selected business use case in detail using independent DFS state per arc.

```text
dfsStateByArc = {
  arc-1: { stack, frontier, visited, branches, ... },
  arc-2: { stack, frontier, visited, branches, ... }
}
```

Pass 2 follows the strongest semantic continuation, preserves alternatives, backtracks within the arc, and uses arc-anchored semantic search when local topology is exhausted.

Pass 2 does not attempt to exhaust every structurally reachable helper. When business continuity / semantic gain dampens, that path should stop competing strongly and the explorer should backtrack, bound the dependency, or explore another relevant branch.

Reusable independently meaningful business subflows should become separate semantic workflows rather than being duplicated recursively into each parent.

---

# Entity and schema reconciliation

Workflow reconstruction is only one side of the semantic map.

The current `demo_v2` learning path also materializes and reconciles persistent entities and schema relationships.

This creates evidence-backed links such as:

```text
Place Order
   ├─ writes → OrderHeader
   └─ writes → OrderItem

OrderItem.orderId
   └─ schema FK → OrderHeader.orderId
```

Shared persistent entities are stronger evidence of business relationship than reuse of generic implementation helpers.

Schema relationships that can be proven mechanically remain deterministic graph facts.

The current implementation includes entity reconciliation, schema catalog materialization and schema-relationship materialization under `server/explorer/*`.

---

# Persistence and resume

The output of learning is a persistent semantic map, not merely a transient exploration result.

New evidence is reconciled into the existing map:

```text
existing LeMap
   +
new workflow/entity evidence
   ↓
reconciliation
   ↓
refined LeMap
```

Evidence/provenance should be retained so semantic claims can be traced back to their supporting source structure.

Conflicting evidence should not be silently overwritten; it may remain attached to competing/refined claims until reconciliation can resolve it.

The current learning implementation includes persisted-map loading, map persistence and resume-learning lifecycle support.

---

# Query-v4 — current query path

The current working query implementation is:

```text
demo_v2/server/query_v4/*
```

Query-v4 operates over the persistent semantic map. It does not rediscover the repository from scratch for every question.

Its high-level flow is:

```text
Natural-language question
        ↓
Derive ordered analytical intent / requirements
        ↓
Seed from learned workflows when available
        ↓
Best-first semantic traversal
        ↓
Workflow → entity expansion
        ↓
Entity schema inspection
        ↓
Real FK traversal
        ↓
Semantic coverage of unresolved requirements
        ↓
Deterministic connectivity
        ↓
Ordered-plan verification
        ↓
Grounded answer
```

## Workflow-first roots

When persisted workflows contain entities, Query-v4 uses those workflows as its root candidates.

Directory/semantic-hierarchy roots are a fallback when no usable workflow roots exist.

This anchors query traversal in business meaning before expanding into persistent data.

## Entity inspection

For a selected entity, Query-v4 presents the model with the entity's complete known schema and only real FK edges that LeMap can traverse.

The model may identify direct evidence on the entity and nominate promising real FK relationships for unresolved requirements.

FK/ID fields are treated primarily as navigation handles rather than substitutes for attributes of the referenced entity.

## Coverage

Coverage means coverage of the query's semantic/analytical requirements, not percentage of the entire graph visited.

The frontier is prioritized toward unresolved requirements. Dormant candidates can be reactivated when stronger candidates are exhausted.

## Connectivity

Once the required evidence has been found, Query-v4 deterministically checks whether the accepted entities can be connected through evidenced schema joins.

Multi-hop connectivity is valid when LeMap can prove the path.

Disconnected accepted evidence causes affected requirements to be reopened rather than accepted as one coherent analytical view.

## Ordered-plan verification

`verifier.js` checks whether the selected evidence can actually execute the ordered answer plan at the required grain.

If a later requirement fails, only the semantically insufficient requirement is reopened; already-valid earlier evidence remains locked.

## Final answer

The final answer is generated from evidence-backed entities and evidenced joins supplied by LeMap.

The model may qualify a strongest coherent interpretation as probable, but it must not invent fields, joins, constants or unsupported business logic.

---

# Current query write-back boundary

Query-v4 currently reads the persistent map and maintains query-local accepted evidence, frontier, coverage and connectivity state.

It does **not currently persist newly discovered query-time knowledge back through the learning-side reconciliation path**.

A future write-back path should submit only evidence-backed new knowledge through the same reconciliation boundary used by learning; Query-v4 should not mutate the persistent map directly.

---

# Responsibility split

```text
MODEL — Scout
find globally novel business-use-case directions

MODEL — Discovery
identify concrete actor goal, intent, completion and outcome

DATASONG — Discovery
enforce qualification, isolate starts, freeze qualified starts

DATASONG — Call-path preprocessing
build executable graph
apply code/XML dialect adapters
compress cycles/shared paths
rank longest paths
group branch variants

MODEL — Call-path classifier
business vs technical vs uncertain
identify semantic boundary
name/describe coherent business segment

DATASONG — after classifier
clip at coherent boundary
calculate path containment exactly
seed only maximal coherent business paths
attach contained paths as evidence

PASS 1
schedule qualified arcs

PASS 2
reconstruct selected arc end to end

DATASONG — schema/entity layer
materialize persistent entities and real relationships
reconcile workflow and entity evidence
persist/resume the semantic map

MODEL — Query-v4
turn a question into semantic requirements
score semantic promise
interpret entity fields against unresolved requirements
verify ordered answer-plan semantics

DATASONG — Query-v4
seed workflow roots
expand graph states
follow only evidenced FK relationships
track frontier and coverage
prove connectivity
reopen structurally disconnected evidence
provide grounded graph to final answer
```

The governing rule remains:

> **Use the model only for semantics. Use deterministic structure wherever the graph can prove the relationship.**
