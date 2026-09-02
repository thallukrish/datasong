# LeMap-Web Architecture

## 1. Objective

LeMap-Web learns the structural and semantic model of an interactive web application separately from operating it, so later agents can act on known entities/workflows instead of rediscovering the UI during every task.

It follows the same governing rule as LeMap:

> **If structure can prove it, deterministic code owns it. If meaning must be inferred, the model owns it.**

LeMap-Web differs from core LeMap in one important way: the executable universe is not completely available up front. The browser must progressively discover it by interacting with the application. Semantic understanding therefore participates in guiding further structural exploration.

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

The resulting delta is compared across the observable entity context. An action on one radio group may therefore affect a completion action elsewhere, another entity exposed inline or in a modal, or state that becomes visible only after later navigation/backtracking.

---

## 5. Local entity-behaviour exploration

When LeMap-Web reaches a rendered entity context, it first resolves that context locally before choosing a broader workflow transition.

The local explorer is type-aware and deterministic.

```text
current entity context
      ↓
discover fields / groups / actions
      ↓
choose safe probes from input type
      ↓
execute probe
      ↓
observe whole local entity-state delta
      ↓
infer structural constraints / relationships
      ↓
repeat until local behavioural closure
```

Input type determines the **probe strategy**, not the semantic conclusion.

Examples:

```text
radio group
  select each option
  observe whether selection clears peers
  learn exactly-one / mutually-exclusive behaviour empirically

checkbox group
  toggle members independently and in representative combinations
  observe whether multiple selections coexist
  learn multi-select / mutually-exclusive / conditional behaviour empirically

select
  enumerate representative options
  observe dependent fields / option sets / validations

text / number / date
  probe safe valid / invalid / boundary values
  observe format, requiredness, ranges and validation behaviour

autocomplete
  enter safe prefix
  observe network/options
  select representative result
```

The rule is:

> **UI control type tells LeMap-Web how to experiment. Observed state change tells LeMap-Web what the control actually does.**

Unsafe, destructive or externally consequential actions are not exploratory probes.

---

## 6. Local entities, related entities and structural transition kinds

Explorer actions may expose additional structure without advancing the broader workflow.

```text
state_change
  existing entity fields/state changed

inline_expand
  additional fields or a related entity became reachable inline

overlay_open
  modal/drawer/popover structure became reachable

navigation
  browser presentation moved to a different entity context/route
```

Inline and overlay changes are not automatically workflow steps. They may represent:

```text
same entity expansion
related entity inside the same local operation
reusable sub-entity/subflow
```

LeMap-Web continues local exploration until the current entity context is sufficiently understood.

A useful notion is **local behavioural closure**:

```text
input behaviour sufficiently explored
local constraints discovered
local related entities explored
local validations understood
local actions classified
local semantic interpretation available
```

Only after local behavioural closure does LeMap-Web choose among broader outgoing transitions.

---

## 7. Local semantic resolution

Unlike core LeMap, LeMap-Web needs a small amount of semantics while exploration is still in progress.

After deterministic local behaviour has been collected, the model receives the local structural entity package:

```text
entity label / presentation context
fields and groups
observed state transitions
structural relationships
local related entities
candidate actions
execution evidence where useful
```

The model annotates rather than replaces the structural graph.

Example:

```text
Structural evidence
  selecting radio Y enables four checkboxes
  selecting >=1 checkbox makes Continue available

Semantic annotation
  Entity: Filing Status / Filing Reason
  Relationship: Seventh Proviso branch activates qualifying conditions
  Constraint: one or more qualifying conditions required on that branch
  Action: Continue completes filing-reason determination
```

Local semantic resolution can provide:

```text
entity name
description
field meanings
relationship meanings
constraint descriptions
action/step meanings
local completion meaning
```

These annotations become part of the growing semantic entity graph and are also used to guide navigation.

---

## 8. Outgoing navigation discovery

After local behavioural closure, LeMap-Web returns to the broader rendered context and gathers outgoing interactions that were not consumed as local exploration.

Typical candidates include:

```text
Continue
Next
Back
Save and Continue
Dashboard
Home
Help
Profile
AIS
section links
modal-launch actions
other navigational buttons/anchors
```

Blind DOM-order DFS is not acceptable because many outgoing links may leave the active business context.

The navigation decision therefore receives:

```text
current semantically resolved entity
local completion meaning
current forming workflow arc
candidate outgoing actions / links
presentation evidence
known safety / reversibility information
```

The model's task is narrowly defined:

> **Score how strongly each outgoing transition continues the current workflow context.**

Useful classifications include:

```text
LOCAL_EXPANSION
RELATED_ENTITY
WORKFLOW_CONTINUATION
WORKFLOW_BRANCH
WORKFLOW_REVERSE
WORKFLOW_EXIT
SIDE_CONTEXT
```

Useful scoring dimensions include:

```text
workflow continuity
forward progress
context preservation
semantic fit
novelty / unexplored coverage
```

For example, after resolving a Filing Status entity:

```text
Continue   → very high continuity
Back       → reverse/low forward progress
Dashboard  → workflow exit
Home       → workflow exit
AIS        → side context / weak continuity
```

Deterministic priors may cheaply identify obvious cases such as `Continue`, `Next`, `Back`, `Home`, `Dashboard`, `Logout`, but the model resolves ambiguous candidate sets.

---

## 9. Frontier and DFS-style workflow exploration

Outgoing candidates that are not chosen are retained rather than discarded.

Each explored entity context may keep a traversal frame such as:

```text
ExplorationFrame
  entityId
  entityStateId
  workflowArcId
  outgoingCandidates[]
    actionId
    transitionRole
    continuityScore
    safety
    reversible
    explored
```

LeMap-Web follows the best admissible candidate while retaining siblings in a frontier/stack.

```text
Entity E1
  Continue   score .98  → chosen
  Back       score .30  → retained
  Dashboard  score .04  → retained
  AIS        score .12  → retained

E1 → Continue → E2 → ...
```

When an arc reaches completion, a dead end, a low-continuity state, a cycle or a blocked transition, traversal can return to the nearest useful unresolved frontier candidate.

This is conceptually similar to bounded graph traversal in LeMap query answering, but Web traversal is active: following an edge changes application state.

Therefore frontier exploration must also reason about restoration:

```text
safe to execute?
reversible?
known Back transition?
can prior state be restored?
does action mutate persistent/user data?
```

Irreversible, destructive or consequential actions are not explored merely to gain coverage.

---

## 10. Global workflow graph grows during exploration

LeMap-Web learns local entity relationships and global workflow arcs at the same time.

```text
Workflow Arc
  Step 1
    local entity graph
    local branches
       ↓
  Step 2
    local entity graph
       ├─ workflow branch A → Step 3
       └─ workflow branch B → Step 4
```

An action may contribute at different structural levels.

Example local branch:

```text
select filing reason Y
  → qualifying-condition entity becomes active
```

This may remain inside the same semantic workflow step.

Example workflow branch:

```text
select taxpayer category
  → one downstream route for resident
  → another downstream route for non-resident
```

This changes the broader workflow arc.

The distinction is learned from observed downstream structure plus semantic context, not from presentation boundaries alone.

---

## 11. How LeMap-Web differs from core LeMap

Core LeMap usually begins with a largely available executable universe:

```text
repository
  ↓
call graph / service graph / entity graph
  ↓
Scout
  ↓
Pass 1
  ↓
Pass 2
```

The structural execution graph exists before semantic exploration begins.

LeMap-Web is different:

```text
observe local structure
  ↓
probe local behaviour
  ↓
resolve local semantics
  ↓
use semantics to choose next structural transition
  ↓
discover next entity
  ↓
extend workflow graph
  ↓
repeat
```

Therefore:

> **LeMap discovers semantics over an already-existing execution graph. LeMap-Web uses semantics to help discover the execution graph itself.**

The orchestration is interleaved and online:

```text
STRUCTURE
  → LOCAL SEMANTICS
  → GUIDED STRUCTURAL EXPLORATION
  → MORE STRUCTURE
  → MORE SEMANTICS
```

The deterministic/semantic ownership boundary is still preserved. The model does not invent browser behaviour; it interprets proven local evidence and helps prioritize what structure to discover next.

---

## 12. Three semantic levels

LeMap-Web currently needs three distinct semantic tasks.

### Level 1 — Local Entity Semantic Resolver

Input:

```text
local structural entity graph
fields / groups
actions
observed behaviour
local relationships / constraints
```

Output:

```text
semantic entity names/descriptions
field meanings
relationship meanings
constraint meanings
local action/step meanings
```

### Level 2 — Navigation Continuity Scout

Input:

```text
resolved current entity
forming workflow context
unexplored outgoing actions
safety/reversibility evidence
```

Output:

```text
transition classification
continuity score
forward-progress assessment
reason / evidence reference
```

This drives frontier selection and DFS-style traversal.

### Level 3 — Global Workflow Semantic Consolidation

As enough structural workflow evidence accumulates, Pass-1/Pass-2-style reasoning consolidates the growing graph into business-level workflow semantics.

This includes:

```text
business actor
business intent
major stages
workflow branches
joins / reusable subflows
completion conditions
business outcomes
entity participation
cross-step business rules
```

Pass 1 / Pass 2 are therefore no longer the first appearance of semantics in LeMap-Web. They become broader consolidation/refinement over a workflow graph whose entities already carry local semantic annotations.

---

## 13. Reuse from core LeMap

LeMap-Web should reuse proven concepts without forcing the same lifecycle.

Useful concepts to adapt:

```text
bounded semantic interpretation
arc continuity / coherence reasoning
frontier retention
branch exploration
completion pressure
whole-flow interpretation
semantic evidence materialization
JSON-only model contracts
```

Do not blindly copy:

```text
repository search
source-file/function assumptions
call-path indexes
schema/DB assumptions
core Scout breadth machinery
resume/persistence code tied to demo_v2
```

Do not refactor `demo_v2` merely for code sharing yet. Copy/adapt into `lemap-web` first. Common abstractions should only be extracted after both implementations prove the same contract.

---

## 14. Safety and restoration

Web exploration is active and can mutate user/application state. Safety is therefore part of traversal semantics.

Candidate actions should carry classifications such as:

```text
safe_local_probe
safe_navigation
policy_required
persistent_mutation
irreversible
destructive
unknown
```

Examples:

```text
select radio option      → usually safe local probe
open informational modal → usually safe
Continue                 → often safe navigation, but context-dependent
Save Draft               → persistent mutation
Submit Return             → irreversible/high impact
Delete                    → destructive
Logout                    → workflow exit
```

The explorer only executes actions compatible with the active safety policy. Coverage never justifies unsafe mutation.

---

## 15. Current implementation direction

The next engineering loop is:

```text
ENTITY DISCOVERY
      ↓
TYPE-AWARE SAFE ACTION EXECUTOR
      ↓
LOCAL STATE DELTA / RELATIONSHIP LEARNING
      ↓
LOCAL BEHAVIOURAL CLOSURE
      ↓
LOCAL SEMANTIC RESOLUTION
      ↓
OUTGOING LINK/ACTION COLLECTION
      ↓
NAVIGATION CONTINUITY SCORING
      ↓
FRONTIER / DFS WORKFLOW EXPLORATION
      ↓
GROWING ENTITY + WORKFLOW GRAPHS
      ↓
GLOBAL SEMANTIC CONSOLIDATION
```

Stable deterministic IDs are required for entities, fields, actions, states and transitions. Empty/no-effect observations must not create workflow edges.

---

## 16. End-to-end architecture

```text
WEB APPLICATION
      ↓
Browser instrumentation
      ↓
Discover current structural entity context
      ↓
Type-aware safe local behaviour exploration
      ↓
Entity-state deltas + local relationships
      ↓
Explore inline/modal related entities
      ↓
Local behavioural closure
      ↓
LOCAL ENTITY SEMANTIC RESOLVER
      ↓
Semantically annotated local entity graph
      ↓
Collect unresolved outgoing navigation actions
      ↓
NAVIGATION CONTINUITY SCOUT
      ↓
Retain candidates in frontier
      ↓
Follow best safe continuation
      ↓
Discover next entity / extend workflow arc
      ↓
DFS / branch / backtrack / merge
      ↓
repeat local discovery + semantics
      ↓
GLOBAL PASS-1 / PASS-2-STYLE CONSOLIDATION
      ↓
Evidence-backed semantic entity + workflow graph
      ↓
Query / navigation / autonomous execution
```

The invariant is:

> **LeMap-Web deterministically learns what the application does locally, semantically resolves that evidence, and uses the resolved context to guide discovery of the broader workflow graph.**
