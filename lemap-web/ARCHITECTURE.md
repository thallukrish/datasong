# LeMap-Web Architecture

## 1. Objective

LeMap-Web learns the structural and semantic model of an interactive web application separately from operating it, so later agents can act on known entities/workflows instead of rediscovering the UI during every task.

It follows the same governing rule as LeMap:

> **If structure can prove it, deterministic code owns it. If meaning must be inferred, the model owns it.**

---

## 2. Core structural model

A browser page is **not** a semantic primitive. It is a human-friendly presentation/flattening of part of a shared entity graph.

```text
WEB APPLICATION
      ↓
SHARED ENTITY GRAPH
  Entity
    fields
    relationships
    actions/methods
    observed states
    presentation evidence

      ↓ actions mutate

WORKFLOW GRAPH
  steps
  branches
  merges
  entity/action paths
  entry/completion conditions
```

Presentation evidence may contain:

```text
pageId
route / URL
title
DOM/root identity
field DOM identity
region path
```

Those values help the browser find and operate the entity; they do not define business semantics.

---

## 3. Entity graph

An entity is a structurally coherent object whose state can be observed and changed.

```text
Entity
  id
  fields[]
  relationships[]
  methods/actions[]
  states[]
  presentation
```

A rendered screen may expose one entity, several related entities, a repeated entity collection, or an entity also exposed elsewhere.

Fields include labelled form inputs/content and meaningful observable state. Relationships may be contained in one rendered surface or cross rendered surfaces.

The browser's page boundary never limits relationship/state-effect discovery.

---

## 4. Central deterministic primitive

```text
ENTITY / FIELD
+ ACTION
→ EXECUTION TRACE
→ SHARED ENTITY STATE DELTA
```

Execution evidence can include:

```text
browser event
function/handler calls
network request/response
callbacks
DOM/state mutation
```

The resulting delta is compared globally across the observed entity space. An action on one radio group may therefore affect a completion action elsewhere, another entity in a modal, or state that becomes visible only after later navigation/backtracking.

---

## 5. Structural transition kinds

Explorer actions always expand or mutate the entity graph. Their observed transition scope informs workflow construction.

```text
state_change
  existing entity fields/state changed

inline_expand
  additional fields/entity structure became reachable inline

overlay_open
  modal/drawer/popover entity structure became reachable

navigation
  browser presentation moved to a different entity context/route
```

Inline/overlay transitions usually enrich the current workflow step or branch. Navigation is a strong structural signal for a broader workflow-step transition. The semantic model may later compress or reinterpret those provisional boundaries.

---

## 6. Workflow graph

A workflow is an ordered/branching sequence of actions over the shared entity graph that accomplishes an end-to-end state change.

```text
Workflow: File ITR-3

FilingStatus.selectReason(...)
    ↓
PersonalDetails.update(...)
    ↓
Income.capture(...)
    ├─ branch A → CapitalGains.update(...)
    └─ branch B → BusinessIncome.update(...)
    ↓
TaxComputation.calculate(...)
    ↓
Verification.submit(...)
```

Workflow edges retain deterministic provenance:

```text
sourceEntityId
targetEntityId
sourceStateId
targetStateId
actionId
transitionKind
branchCondition
stateDelta
evidenceIds
presentation evidence
```

The same entity may be revisited in a different observed state. Revisit does not create a new semantic entity automatically.

---

## 7. Cross-entity and cross-visit state

An action taken later in a workflow may change state exposed by an entity visited earlier.

LeMap-Web therefore does not model this as "page 3 changed page 1". It records:

```text
Action on Entity C
  → state mutation
  → Entity A later projects a different observed state
```

This is analogous to different functions/services reading and writing shared entities in core LeMap.

---

## 8. Deterministic browser acquisition

Browser acquisition remains modular and type-aware.

```text
browser snapshot
  ↓
active structural entity root
  ↓
field/control discovery
  ↓
group/relationship discovery
  ↓
type-specific candidate actions
  ↓
action execution
  ↓
execution trace
  ↓
entity-state delta
  ↓
workflow transition
```

Input scanners remain small generic modules for radio, checkbox, text, number, date, select, autocomplete, file, button and composite controls.

Manual interaction, autonomous exploration, production-agent execution and replayed traces are acquisition modes feeding the same structural graphs.

---

## 9. Semantic learning

After deterministic construction, the semantic problem is intentionally smaller than core code discovery.

```text
Entity Graph
+
Workflow Graph
      ↓
lightweight path selector
      ↓
Pass 1
      ↓
Pass 2 whole-flow interpretation
      ↓
Semantic Graph
```

### Path selector

This is Scout-lite. It ranks bounded unannotated workflow branches for diversity/coverage. It does not rediscover browser structure.

### Pass 1

Consumes one bounded structural workflow path and annotates:

```text
business actor
business intent
major stages
branch meaning
completion condition
business outcome
```

### Pass 2

Consumes Pass-1 context plus the whole selected structural flow and touched entity subgraph. It annotates:

```text
business entity meanings
field meanings
entity relationships
business rules/constraints
step semantics
cross-entity effects
```

Pass 2 should request follow-up only for materially ambiguous supplied branches, not arbitrary browser/repository traversal.

---

## 10. Reuse from core LeMap

LeMap-Web copies/adapts proven semantic patterns from `demo_v2` while remaining isolated.

Reuse:

```text
bounded-flow semantic interpretation
Pass-1 business-arc schema concepts
whole-flow Pass-2 prompt/normalization concepts
JSON-only model-call behavior
evidence-backed semantic graph materialization
```

Do not copy:

```text
repository search
source-file/function assumptions
call-path indexes
schema/DB assumptions
core Scout breadth exploration
resume/persistence machinery tied to demo_v2
```

Do not refactor `demo_v2` merely for code sharing yet. Once both implementations prove a common intermediate semantic-learning contract, shared libraries can be considered.

---

## 11. Current module boundary

```text
lemap-web/src/graph/
  entityIdentity.js
  entityRoot.js
  entityHierarchy.js
  entityPreprocessor.js
  entityState.js
  entityDelta.js
  workflowGraph.js

lemap-web/src/preprocess/
  inputClassifier.js
  inputDiscovery.js
  groupDiscovery.js
  action.js
  observation.js
  scanners/*

lemap-web/src/semantic/
  pathSelector.js
  pass1.js
  pass2.js
  semanticGraph.js
  modelCall.js

browserCapture.js
capture.js
```

---

## 12. End-to-end architecture

```text
WEB APPLICATION
      ↓
Browser instrumentation
      ↓
Deterministic entity discovery
      ↓
Type-aware actions + execution evidence
      ↓
Shared entity-state deltas
      ↓
Entity graph + structural workflow graph
      ↓
Lightweight semantic path selection
      ↓
Pass 1
      ↓
Pass 2 whole-flow interpretation
      ↓
Evidence-backed semantic graph
      ↓
Query / navigation / autonomous execution (later)
```

The invariant is:

> **The browser discovers structure and behavior. The model annotates meaning. Workflows operate over a shared entity space.**
