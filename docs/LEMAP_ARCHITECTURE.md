# LeMap Architecture

## Status

This document is the canonical architecture overview for LeMap as implemented by the current `demo_v2` learning path and `demo_v2/server/query_v4` query path.

The older documents remain useful design history and deeper notes:

- `docs/SEMANTIC_EXPLORATION_ARCHITECTURE.md` describes the source-agnostic evidence-world and semantic-exploration principles.
- `demo_v2/ARCHITECTURE.md` describes the concrete Scout / deterministic call-path / Pass-1 / Pass-2 learning architecture.
- `demo_v2/PASS1_BUSINESS_ARC_DISCOVERY.md` contains additional detail on Pass-1 arc discovery.

This document connects those ideas into one system-level view and records the current implementation boundaries.

---

## 1. What LeMap is

LeMap is a persistent, evidence-backed semantic map of an enterprise.

It connects business intent and workflows to the application behavior and persistent data that implement them.

The important distinction is:

```text
raw evidence / topology
        ↓
semantic interpretation
        ↓
persistent LeMap
```

Source files, methods, XML actions, foreign keys and call edges are not the final product by themselves. They are evidence used to construct semantic objects and relationships such as:

```text
Place Order
   ├─ invokes → Payment Processing
   ├─ writes  → OrderHeader
   ├─ writes  → OrderItem
   └─ produces → Order placed
```

LeMap retains concrete services, entities and source provenance when they are useful for grounding the semantic graph.

---

## 2. Governing principle

The implementation follows one core rule:

> **Use deterministic structure wherever the evidence can prove a relationship. Use the model for semantic interpretation where structure alone cannot determine meaning.**

Examples:

```text
A calls B                    → deterministic
OrderItem FK → OrderHeader   → deterministic
one path contains another    → deterministic

"A validates the order"      → semantic interpretation
"this path is Place Order"   → semantic interpretation
"the business flow ends here"→ semantic interpretation
```

The model should not be asked to rediscover graph facts that the parser or topology layer already knows.

---

## 3. System view

```text
                         LeMap
                           │
              ┌────────────┴────────────┐
              │                         │
        LEARNING SIDE               QUERY SIDE
              │                         │
     Evidence acquisition         Natural-language query
              │                         │
       Source adapters           Query planning / intent
              │                         │
   Deterministic topology       Workflow-first navigation
              │                         │
 Call-path + Scout discovery     Entity / FK traversal
              │                         │
           Pass 1              Coverage + connectivity
              │                         │
           Pass 2                  Verification
              │                         │
 Semantic reconciliation             Answer
              │
       Persistent LeMap
              │
     workflows + entities
     relationships + evidence
```

Learning constructs and refines the persistent semantic map.

Query consumes that map to answer natural-language questions without rediscovering the repository from scratch.

---

## 4. Evidence and source adapters

LeMap treats the enterprise as an evidence world.

The current working implementation is repository-centric, but the architecture is source-agnostic.

Potential evidence sources include:

- source code
- framework configuration
- executable XML / workflow definitions
- entity schemas
- databases and tables
- APIs
- documents
- runtime traces and logs
- conversations and operational artifacts
- future browser/application observations

The source-specific layer converts raw evidence into useful deterministic topology.

### Generic structure

Generic parsing should capture relationships that are not framework-specific, for example:

- functions / methods
- calls
- inheritance and composition
- references
- entity/table relationships
- one-to-one and one-to-many relationships
- source provenance

### Framework adapters

Framework-specific semantics belong behind adapters.

The current example is Moqui, where executable XML and entity definitions contain semantics that a generic XML parser cannot infer.

The current implementation includes Moqui-specific execution and entity-schema adapters.

Future adapters can add support for other frameworks without changing the higher-level semantic model.

---

## 5. Deterministic topology

The topology layer answers:

> **What is structurally reachable from the current evidence?**

It does not decide what that structure means to the business.

For repositories this includes:

```text
repository
→ executable symbols/actions
→ calls / triggers / navigation
→ entity reads and writes
→ schema relationships
→ branch/cycle-aware executable paths
```

The path indexer uses a common executable-node abstraction while adapters provide dialect-specific executable semantics.

Branches and cycles are handled mechanically rather than delegated to the model.

---

## 6. Learning: two routes into Pass 1

Current `demo_v2` learning has two complementary routes.

### Route A — Scout / semantic discovery

```text
Scout
  ↓
Discovery
  ↓
qualified business-use-case direction
```

Scout looks for materially different business-use-case directions that may still be missing.

Semantic discovery is useful for novelty and coverage, but pure model-led repository navigation can wander and consume tokens without closing a coherent flow.

### Route B — deterministic executable-path discovery

```text
Repository
  ↓
Executable graph
  ↓
branch/cycle-aware call paths
  ↓
grouped / ranked path candidates
  ↓
LLM business-flow classification
  ↓
semantic boundary clipping
  ↓
deterministic containment
  ↓
maximal coherent business-flow seeds
```

This route removes most of the mechanical navigation burden from the model.

The model is asked to decide semantic questions such as:

- is the path a business flow, technical flow, or uncertain?
- what actor and intent does it represent?
- what is the completion condition / outcome?
- where does the coherent business segment end?

After semantic clipping, containment and duplicate/subset handling are deterministic.

Only maximal coherent business paths need to seed Pass 1; contained paths remain evidence.

---

## 7. Scout, Pass 1 and Pass 2

These layers operate at different levels of attention.

### Scout — breadth and novelty

Scout asks:

> **What important business-flow direction might still be missing?**

It prevents learning from staying indefinitely inside one already-known area.

### Pass 1 — scheduler across business arcs

Pass 1 owns the board of qualified business arcs.

It tracks stable arc identity, actor, intent, progress, evidence and outcome and decides which arc should receive the next exploration turn.

It should prefer semantic progress rather than simple breadth. A nearly complete high-signal arc may receive completion pressure rather than being abandoned for a new low-signal direction.

### Pass 2 — depth within one arc

Pass 2 reconstructs one selected business workflow end to end.

It keeps independent traversal state for the arc and follows the strongest semantic continuation while preserving alternatives and backtracking when necessary.

Pass 2 stops pursuing a path when business continuity / semantic gain dampens.

Technical helpers, framework plumbing, logging, serializers and unrelated libraries should not be followed merely because they are structurally reachable.

---

## 8. Workflow boundaries, branches and reusable workflows

A workflow is not necessarily a linear call path.

Material branches remain part of the current workflow:

```text
Validate Order
   ├─ valid → Place Order
   ├─ invalid → Reject
   └─ approval required → Approval branch
```

A reusable independently meaningful business process should instead become its own semantic workflow.

Example:

```text
Place Order ──────┐
                  ├──→ Payment Processing
Pay Invoice ──────┘
```

The parent only needs enough of the reusable workflow contract to understand its effect.

External implementation that falls outside the evidence boundary is treated as a black box.

---

## 9. Entity and persistent-data layer

The semantic map connects workflows to the persistent entities they read, create, update or otherwise depend on.

This relationship is stronger business evidence than generic function reuse.

Example:

```text
Place Order
   └─ writes → OrderHeader

View Order Detail
   └─ reads  → OrderHeader
```

The shared persistent state is meaningful evidence that the workflows belong to the same business domain and that one may consume state produced by the other.

Entity relationships from the schema are deterministic evidence where available:

```text
OrderItem.orderId
      ↓ FK
OrderHeader.orderId
```

The current learning implementation materializes schema entities/relationships and reconciles them with workflow knowledge in the persistent semantic map.

---

## 10. Persistence and reconciliation

LeMap is an accumulating knowledge graph, not a report regenerated from scratch for every use.

New evidence should be reconciled into the existing map:

```text
existing map
   +
new evidence
   ↓
reconciliation
   ↓
refined persistent map
```

A new observation may be:

- a new semantic object
- a new relationship
- additional evidence for an existing relationship
- a refinement of an existing object
- conflicting evidence that must remain traceable

Conflicting evidence should not be silently destroyed. Competing claims/evidence can coexist until later evidence supports reconciliation.

Every semantic relationship should retain provenance sufficient to trace it back to the evidence that supports it.

---

## 11. Query-v4: purpose

`demo_v2/server/query_v4` is the current working query path.

Its job is not to crawl the repository again.

It starts from the persistent semantic map, interprets the natural-language question as an ordered analytical plan, and navigates the evidence-backed semantic graph to satisfy that plan.

The current major query components are:

```text
queryEngine.js    orchestration / best-first query loop
stateExpander.js  workflow/entity/FK expansion
scorer.js         semantic scoring of candidate states
coverage.js       entity-level evidence evaluation
connectivity.js   deterministic connection of accepted evidence
verifier.js       ordered-plan answerability verification
queryApi.js       API boundary
```

---

## 12. Query planning and workflow-first roots

The query model first derives the intent and the analytical dimensions/steps required to answer the question.

Query-v4 then seeds traversal from learned workflows when workflows are available.

`stateExpander.rootStates()` returns workflow roots first; directory/hierarchy roots are only the fallback when no usable workflow roots exist.

This is deliberate.

A question such as:

```text
Which entities are involved when an order is placed?
```

should begin from the semantically relevant workflow rather than from an arbitrary entity or repository location:

```text
question
   ↓
relevant workflow(s)
   ↓
workflow entities
   ↓
real schema FK relationships
   ↓
evidence-backed answer
```

The model supplies semantic intent and prioritization; LeMap supplies the graph facts and traversal machinery.

---

## 13. Entity inspection and FK traversal

When Query-v4 reaches an entity it receives the entity's complete known schema plus real FK edges that LeMap can traverse.

The model may do two things:

1. accept real fields/expressions on the current entity as direct evidence for unresolved query requirements;
2. select supplied FK edges worth following because their target entity is promising for unresolved requirements.

FK/ID fields are treated primarily as navigation handles, not as substitutes for business attributes on the referenced entity.

The model is not allowed to invent fields, joins or business logic.

---

## 14. Query coverage

Query coverage is semantic coverage of the answer plan, not percentage of the entire graph visited.

For example:

```text
Plan requirements
A. identify product
B. identify sales observation
C. identify transaction time
D. identify region
```

The query loop tracks which requirements already have evidence and prioritizes states that can satisfy the unresolved requirements.

The relevant stopping condition is that the query-relevant frontier has been exhausted or all answer requirements have been grounded and connected.

LeMap should not wander through unrelated graph regions merely because the entire graph has not been visited.

The implementation also maintains dormant candidates so lower-priority paths can be reconsidered when stronger frontiers are exhausted.

---

## 15. Connectivity is structural

Finding evidence for each requested concept separately is not sufficient.

The selected evidence must describe one executable/coherent analytical view.

After evidence coverage is satisfied, Query-v4 runs deterministic connectivity over accepted entities using evidenced schema joins.

Multi-hop paths are valid when LeMap can prove them through the graph.

If accepted evidence is structurally disconnected, Query-v4 reopens the affected requirements rather than pretending the fields belong together.

This is another application of the governing principle:

> connectivity belongs to graph structure, not model opinion.

---

## 16. Ordered-plan verification

Coverage and connectivity still do not guarantee that the selected evidence implements the user's intended analytical question correctly.

`verifier.js` therefore checks the evidence against the **ordered answer plan**.

The verifier evaluates questions such as:

- do the fields implement the requested steps in the correct semantic order?
- do they preserve the required grain?
- does the selected time field represent the right business event?
- are the required business relationships realized through the evidenced graph?

If only one later requirement is wrong, the verifier reopens only the affected query dimension and preserves already-valid evidence.

This creates a repair loop rather than forcing the whole query to restart.

---

## 17. Final grounded answer

The final answer is generated only from the accepted evidence-backed entities and evidenced joins supplied by LeMap.

The query path distinguishes explicit evidence from the strongest coherent but inferred semantic interpretation.

Query-local interpretations can be qualified as probable without being promoted automatically into permanent map facts.

Unsupported requirements remain explicitly missing rather than being invented.

---

## 18. Current query write-back boundary

Current Query-v4 reads the supplied persistent semantic graph and maintains query-local traversal/coverage/connectivity state.

It does **not currently feed newly discovered query-time facts back through the learning-side semantic reconciliation / map-persistence path**.

The desired future architecture is:

```text
               ┌──────────────────┐
               │                  ↓
Learning → Persistent LeMap → Query
               ↑                  │
               └── evidenced facts┘
```

Any future query-time write-back should use the same reconciliation boundary as learning rather than mutating the map directly.

Only evidence-backed structural or semantic knowledge should be eligible for persistence; query-specific interpretation should remain local unless separately validated.

---

## 19. Current implementation mapping

### Learning / semantic-map construction

```text
demo_v2/server/explorer/*
```

Important current responsibilities include:

- `businessPriorityScout.js` — Scout prioritization
- `scoutLifecycle.js` — Scout lifecycle
- `callPathSeedPreprocessor.js` — deterministic call-path seed preprocessing
- `initialCallPathClassifier.js` — semantic classification / boundary interpretation
- `pass1State.js` — Pass-1 state
- `wholeFlowScheduler.js` — workflow scheduling
- `wholeFlowPass2.js` — detailed workflow reconstruction
- `semanticModel.js` — semantic model accumulation
- `entityReconciliation.js` — entity reconciliation
- `schemaCatalogMaterialization.js` — schema catalog materialization
- `schemaEntityRelationships.js` — schema entity relationships
- `mapPersistence.js` / `persistedMap.js` — map persistence and loading
- `resumeLearning.js` — continuation over persisted learning

### Repository and framework topology

```text
demo_v2/server/*
demo_v2/server/adapters/*
```

Important current components include:

- call-path indexers
- canonical semantic topology
- repository topology
- Moqui XML execution adapter
- Moqui entity-schema adapter
- adapter composition under `server/adapters`

### Query

```text
demo_v2/server/query_v4/*
```

### Application/API and UI

```text
demo_v2/server/index.js
demo_v2/public/*
```

---

## 20. Stable architectural boundaries

The implementation should continue moving toward these boundaries:

```text
SOURCE ADAPTERS
source-specific structure and executable semantics
        ↓
DETERMINISTIC TOPOLOGY
nodes, edges, call paths, FKs, provenance
        ↓
SEMANTIC LEARNING
Scout, workflow discovery, Pass 1, Pass 2
        ↓
RECONCILIATION / PERSISTENCE
one authoritative way to evolve LeMap
        ↓
PERSISTENT SEMANTIC MAP
workflows, entities, relationships, evidence
        ↓
CONSUMERS
query, explore UI, future data-view generation, agents, browser execution
```

New evidence sources should plug in below the semantic model rather than create separate incompatible maps.

New consumers should read the same persistent map and submit durable new knowledge through the common reconciliation boundary.

---

## 21. Current architectural invariant

The current design can be summarized as:

> **LeMap is the persistent semantic model. Learning and querying are separate processes operating around that model. Source adapters expose evidence and deterministic topology; the model supplies business meaning where structure cannot prove it; persistence retains the resulting evidence-backed knowledge for reuse.**
