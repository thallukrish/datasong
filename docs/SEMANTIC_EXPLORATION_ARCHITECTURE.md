# DataSong Semantic Exploration Architecture

## Status

This document captures the **foundational, source-agnostic semantic-exploration model** that led to the current LeMap implementation.

It remains valid as the conceptual model for heterogeneous evidence, topology, semantic continuity, information gain and vertical-slice closure.

The current concrete implementation has evolved beyond the original single-slice demo described by earlier versions of this document:

- `demo_v2` now learns multiple business workflows through Scout, deterministic call-path preprocessing, Pass 1 and Pass 2;
- persistent entities and schema relationships are reconciled into a reusable semantic map;
- map state is persisted and learning can resume over an existing map;
- `demo_v2/server/query_v4` is the current working query path over that persistent map.

The canonical current system architecture is therefore:

```text
docs/LEMAP_ARCHITECTURE.md
```

The concrete learning architecture is:

```text
demo_v2/ARCHITECTURE.md
```

This document should be read as the broader exploration principles underneath those implementations.

---

## 1. Objective: evidence-backed vertical slices

DataSong/LeMap does not assume that every artifact is itself a workflow, business concept, rule or persistent dataset.

The objective is:

> **Discover and close end-to-end vertical slices of enterprise use cases from heterogeneous evidence, then retain those slices and their persistent-data relationships in a reusable semantic map.**

A vertical slice is a coherent chain of behavior that starts from a meaningful trigger, intent, input, event, schedule or request; crosses relevant implementation, data, configuration and policy boundaries; and reaches a meaningful outcome or produced state.

The nature of the slice is allowed to emerge from evidence. It may ultimately represent a customer workflow, employee workflow, ETL/data pipeline, algorithmic process, service interaction, operational procedure, policy-driven process or something else.

---

## 2. The enterprise is an evidence world

An enterprise can contain many kinds of evidence:

- source code
- configuration
- internal libraries
- database schemas and tables
- sample rows and metadata
- logs and traces
- documents and policies
- conversations
- agreements and contracts
- tickets and operational notes

No single artifact type is assumed to contain the whole truth.

Code may implement behavior without explaining business intent. A policy document may explain intent that is only partially implemented. A table may reveal durable state that code refers to indirectly.

LeMap therefore distinguishes:

1. **Evidence world** — raw artifacts plus deterministic/source-specific topology.
2. **Semantic world** — evidence-backed workflows, entities, relationships and claims.

The evidence world is not discarded. Provenance is retained beneath the semantic world so claims can be grounded and later reconciled.

---

## 3. Topology layer

Artifacts should not be presented to the semantic explorer randomly.

The topology layer exposes the structure already present in each source or constructs a useful hierarchy when the source is weakly structured.

Its question is:

> **What artifacts or semantic objects are reasonably reachable from where I am now?**

It does not decide what those artifacts mean.

### Code and executable configuration

Code provides strong topology:

- repository → directory → file → symbol
- callers and callees
- imports
- service invocations
- routes and handlers
- entity/table references
- configuration references
- component dependencies

Framework-specific executable formats need deterministic adapters. The current implementation includes Moqui-specific execution/schema handling rather than assuming generic XML carries universal execution semantics.

### Tables and structured data

Data topology can include:

- database → schema → table/entity → column/field
- foreign keys
- cardinality
- lineage
- query/view dependencies
- source/derived relationships
- temporal relationships

In the current `demo_v2`, real entity relationships are materialized into the semantic graph and later used by Query-v4 as authoritative traversal/connectivity evidence.

### Documents and conversations

Documents and conversations can expose hierarchy, references, time relationships, links and semantic clusters. When native topology is weak, search/clustering can manufacture useful candidate neighborhoods before semantic exploration.

The common abstraction remains:

```text
RAW EVIDENCE
      ↓
SOURCE-SPECIFIC STRUCTURING / ADAPTERS
      ↓
HIERARCHIES + EDGES + CLUSTERS
      ↓
LOCAL CANDIDATE NEIGHBORHOODS
```

---

## 4. Deterministic structure versus semantic interpretation

The current implementation sharpened a principle implicit in the original design:

> **Use the model only where meaning must be inferred. Use deterministic structure wherever the graph can prove the relationship.**

Examples:

```text
function A calls function B        → deterministic
OrderItem FK → OrderHeader         → deterministic
path A is contained inside path B  → deterministic

"this path is Place Order"         → semantic
"this step validates the order"    → semantic
"business continuity ends here"    → semantic
```

This reduces wandering, token use and avoidable model error.

---

## 5. Orientation is not a vertical slice

Some artifacts are useful for navigation without being part of an end-to-end use case.

Examples:

- repository root
- directory structure
- README
- build files
- framework bootstrap/configuration

These should update orientation context rather than become artificial business stories.

Likewise, a test artifact may reveal a use case, but the target slice is the behavior under test, not the test suite itself.

---

## 6. The target object: an end-to-end vertical slice

A useful vertical slice normally has a semantic progression such as:

```text
trigger / intent / input
        ↓
action or processing
        ↓
decision / transformation / state change
        ↓
possible branches or handoffs
        ↓
meaningful outcome
```

Examples:

```text
Customer places an order
UI intent → validation → order placement → persistence → payment/approval branch → outcome
```

```text
Nightly sales aggregation
schedule → extract → transform → aggregate → reporting dataset
```

The explorer does not need to know the complete slice identity at the beginning. It crystallizes as evidence accumulates.

In the current implementation, deterministic executable-path discovery can provide strong candidate slices before semantic exploration begins, while Scout remains useful for discovering materially different missing directions.

---

## 7. Semantic deltas, not regenerated world models

The inner loop should not ask the model to regenerate the entire semantic world on every turn.

For newly observed evidence the model should return only the semantic decisions required at that point, for example:

- meaning
- role in a workflow
- continuity
- boundary
- relative placement
- branch/subflow signal
- expected value of next evidence

LeMap owns accumulated state.

This principle now also appears on the query side: Query-v4 asks the model to evaluate one selected state/entity against unresolved query requirements while LeMap owns the frontier, graph, coverage and connectivity.

---

## 8. Discovery order is not story order

Evidence found later may belong earlier in the workflow.

Semantic structure should therefore be represented by relationships rather than merely by discovery sequence.

Useful signals include:

- continuity — does the evidence belong to the workflow?
- placement confidence — do we know where it belongs?
- coherence gain — how much does it improve the workflow structure?

The current deterministic call-path route reduces some placement ambiguity because executable order is already known, while the model still determines where business continuity begins/ends.

---

## 9. Exploration policy and information gain

Given several reachable candidates, LeMap should prefer the evidence expected to most improve the semantic world model.

Useful gain includes:

- extending the active workflow toward its start or outcome
- filling an unexplained transition
- resolving an open question
- revealing/closing a material branch
- exposing a reusable subflow
- connecting workflow semantics to persistent data
- discovering a credible new workflow when current directions dampen

Code adjacency is useful but not sufficient. A directly called generic helper may be structurally close but semantically weak.

---

## 10. Momentum, dampening and completion pressure

A high-signal business path should acquire momentum.

```text
checkout
→ place-order action
→ order service
→ durable order state
→ payment / approval
```

If successive evidence strongly continues the same business use case, the explorer should prefer that path.

If the path begins producing generic helpers, logging, serialization, framework internals or unrelated infrastructure, marginal semantic value dampens and the explorer should backtrack/bound that direction.

Nearly coherent workflows should receive completion pressure so LeMap does not accumulate many half-built flows while closing none.

The original three intuitive modes remain useful:

```text
EXPLORE  → what important use-case directions exist?
BUILD    → how do these pieces connect?
CLOSE    → what minimum evidence remains to close this workflow?
```

In the current architecture Scout emphasizes breadth/novelty, Pass 1 schedules across known arcs, and Pass 2 performs detailed reconstruction/closure.

---

## 11. Branches, reusable workflows and external dependencies

A vertical slice is not necessarily linear.

### Branches

Material branches remain part of the current workflow until explored or explicitly bounded.

### Reusable workflows

An independently meaningful reusable process should not be recursively duplicated into every parent.

```text
Place Order ──────┐
                  ├──→ Payment Processing
Pay Invoice ──────┘
```

The parent needs enough of the reusable workflow contract to understand its effect; the reusable workflow can be explored independently.

### External dependencies

If implementation lies outside the supplied evidence boundary, treat it as a black box and preserve only the input/output/effect necessary for the local workflow.

---

## 12. Persistent entities strengthen the semantic model

A workflow graph alone is insufficient for LeMap's intended use cases.

Workflows are connected to persistent business entities and schema relationships:

```text
Place Order
   └─ writes → OrderHeader

View Order Detail
   └─ reads → OrderHeader
```

Shared durable state provides strong evidence that workflows are related in the business/data model.

Schema FKs provide deterministic relationship evidence and make later query traversal possible.

The current `demo_v2` explicitly materializes/reconciles these relationships rather than treating them as incidental source-code observations.

---

## 13. Closure and progress

Progress belongs to semantic workflow understanding, not source-code coverage.

A workflow is sufficiently closed when:

- its identity/use case is coherent
- it has a meaningful beginning
- its main progression is connected
- it reaches a meaningful outcome
- material discovered branches are closed or bounded
- local subflows have enough contract information
- external dependencies have adequate black-box contracts
- remaining reachable evidence is unlikely to materially change the workflow meaning

Progress may decrease if new evidence reveals a previously unknown important branch or gap.

---

## 14. Persistence and reconciliation

The original exploration model has evolved into a persistent-map architecture.

LeMap should accumulate new evidence into existing knowledge:

```text
existing semantic map
        +
new workflow/entity evidence
        ↓
reconciliation
        ↓
refined persistent map
```

New evidence may add a node/edge, strengthen an existing claim, refine it or conflict with it.

Conflicting evidence should retain provenance rather than being silently overwritten.

The current implementation includes map persistence, persisted-map loading, schema/entity reconciliation and resume-learning support.

---

## 15. Source-agnostic architecture

The same high-level explorer can work over many evidence sources because topology is source-specific while semantic reasoning is shared.

```text
ENTERPRISE EVIDENCE
        ↓
1. SOURCE ADAPTER / TOPOLOGY
   what can be inspected next?
        ↓
2. EXPLORATION POLICY
   which candidate best advances semantic understanding?
        ↓
3. SEMANTIC MODEL
   which workflow/entity/relationship does this evidence establish?
        ↓
4. RECONCILIATION / PERSISTENCE
   how does this change the existing LeMap?
```

This is the boundary future evidence sources should preserve.

---

## 16. Query is a consumer of the learned map

The current implementation adds an important layer not present in the original single-slice experiment: Query-v4.

Query-v4 starts from the persistent semantic graph rather than re-running discovery.

Its current flow is documented fully in `docs/LEMAP_ARCHITECTURE.md`, but conceptually:

```text
question
  ↓
ordered analytical plan
  ↓
workflow-first semantic roots
  ↓
entity / FK evidence traversal
  ↓
semantic requirement coverage
  ↓
deterministic connectivity
  ↓
ordered-plan verification
  ↓
grounded answer
```

Query coverage is not graph coverage. It tracks whether the evidence earmarked for the user's analytical requirements has been resolved/exhausted.

Query-v4 currently reads the persistent map; query-time discoveries are not yet reconciled back into persistence automatically.

---

## 17. RL-like interpretation

The architecture still resembles reinforcement learning/world exploration even when implemented through model-scored policy rather than a trained RL agent.

- **Environment:** enterprise evidence + topology
- **State:** current workflows, entities, unresolved gaps, visited evidence and frontier
- **Action:** inspect/expand one candidate
- **Observation:** bounded evidence
- **Evaluator:** semantic model calls
- **Reward intuition:** continuity, coherence gain, uncertainty reduction, branch closure, workflow closure and useful novelty

The learned policy should eventually optimize exploration effectiveness rather than memorize fixed business categories.

---

## 18. Current implementation references

The original narrow demo objective has been superseded by the current implementation.

Current references are:

```text
Canonical architecture:
  docs/LEMAP_ARCHITECTURE.md

Learning architecture:
  demo_v2/ARCHITECTURE.md

Learning / persistence implementation:
  demo_v2/server/explorer/*

Framework / repository topology:
  demo_v2/server/*
  demo_v2/server/adapters/*

Current query implementation:
  demo_v2/server/query_v4/*
```

The continuing architectural goal remains source-agnostic: extend evidence acquisition/topology while keeping the semantic model and reconciliation boundary stable.
