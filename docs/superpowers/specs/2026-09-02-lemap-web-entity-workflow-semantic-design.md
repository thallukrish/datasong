# LeMap-Web Entity/Workflow Semantic Design

## Goal

Replace page-centric semantic concepts in LeMap-Web with a shared structural entity graph and a structural workflow graph, then adapt the proven LeMap Pass 1 / Pass 2 semantic-learning pattern to those graphs.

## Core model

LeMap-Web has two deterministic structural substrates:

```text
Shared Entity Graph
  entities
  fields
  relationships
  actions/methods
  state variants
  presentation evidence (pageId, route, DOM location)

Workflow Graph
  steps
  entity/action transitions
  branches
  merges
  entry/completion conditions
```

A browser page is not a semantic object. It is presentation evidence attached to one or more structural entities. Inline expansion, modal/drawer opening and navigation all expand the entity graph. Their transition scope informs the provisional workflow graph: local/overlay expansion usually enriches a current step or branch; navigation usually introduces a new broader step.

## Deterministic primitive

```text
ENTITY / FIELD
+ ACTION
→ EXECUTION TRACE
→ SHARED ENTITY STATE DELTA
```

The delta is global across the currently observed entity space, not limited to the action's DOM group.

## Semantic layer

Once the entity graph and workflow graph exist, the model does not rediscover browser mechanics. It receives bounded deterministic graph evidence and annotates meaning.

Pass 1 interprets workflow branches/arcs:

```text
business intent
actor
major stages
branch meaning
completion condition
business outcome
```

Pass 2 interprets the whole selected structural flow plus touched entity subgraph:

```text
business entity meanings
field meanings
relationship meanings
business rules/constraints
step semantics
cross-entity state effects
```

Scout is intentionally reduced to a lightweight structural-path selector. The browser explorer already performs the expensive structural discovery that core LeMap Scout performs over code/call paths.

## Reuse policy

Copy/adapt proven code from `demo_v2` into `lemap-web`; do not refactor `demo_v2` to share abstractions yet. Reuse semantic contracts, whole-flow prompt/normalization patterns and lightweight model-call behavior. Do not copy call-path/repository/schema assumptions, persistence/resume machinery, or code-specific Scout scheduling.

## Cleanup policy

Remove obsolete page-centric semantic artifacts rather than maintaining aliases. Keep route/page/DOM identifiers only as presentation/provenance metadata. Generic browser acquisition utilities such as input classification, grouping, scanners and state-delta calculation remain because they still generate structural evidence.

## Target modules

```text
lemap-web/src/graph/
  entityIdentity.js
  entityRoot.js
  entityHierarchy.js
  entityPreprocessor.js
  entityState.js
  workflowGraph.js

lemap-web/src/semantic/
  pathSelector.js
  pass1.js
  pass2.js
  semanticGraph.js
  modelCall.js
```

Existing `preprocess/input*`, `groupDiscovery`, scanners, `stateDelta`, and generic observation utilities may stay but must use entity terminology at their public boundary.

## Success criteria

- No conceptual `PageIO`, `Page Workflow`, or page-local semantic graph remains in active code/docs.
- One structural entity stores presentation metadata including page/route identity.
- Input/action observations can produce state deltas affecting any field/action in the observed entity space.
- Structural workflow transitions distinguish local state change, inline expansion, overlay opening and navigation.
- Pass 1 consumes a bounded workflow branch without code/call-path assumptions.
- Pass 2 consumes Pass-1 context plus the selected structural flow/entity evidence without repository traversal assumptions.
- Semantic graph output retains deterministic evidence IDs for provenance.
- Existing browser acquisition behavior remains testable through the synthetic fixture.
