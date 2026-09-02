# LeMap-Web Architecture

## 1. Objective

LeMap-Web answers user queries and executes user goals by navigating an interactive web application semantically, learning missing parts of the application only when the current query requires them, and persisting what it learns for future queries.

It follows the same governing rule as LeMap:

> **If structure can prove it, deterministic code owns it. If meaning must be inferred, the model owns it.**

The semantic map is therefore **not a prerequisite that must be exhaustively built before useful navigation can begin**. It is persistent operational knowledge accumulated and refined through query-driven exploration.

The primary loop is:

```text
USER QUERY
   ↓
search existing semantic memory
   ↓
known path sufficient?
   ├─ yes → use it
   └─ no  → identify the knowledge gap
               ↓
          explore only the missing workflow/entity branch
               ↓
          persist newly learned structure + semantics
               ↓
          continue answering the same query
```

This avoids one-time exhaustive exploration of all possible browser paths and makes application learning demand-driven.

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
  workflow families
  workflow arcs / steps
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

Those values help the browser locate and operate the entity; they do not define business semantics.

---

## 3. Persistent semantic memory

LeMap-Web retains what has already been learned so that future queries do not rediscover the same application behavior.

Persistent knowledge may include:

```text
application / domain
workflow family
workflow arc / step
semantic entity
field/action meanings
relationships / constraints
known branches
known transitions
successful paths
negative knowledge
coverage / confidence
freshness / evidence
```

Example:

```text
Income Tax Portal
  └─ File Income Tax Return
       ├─ ITR-1
       │    ├─ Filing Status
       │    └─ Income Summary
       │
       └─ ITR-3
            ├─ Filing Status
            ├─ Personal Details
            └─ Income Sources (partial)
```

The map may be incomplete by design. A partially learned workflow is still useful as long as LeMap-Web knows which parts are known, partial, unexplored or stale.

The rule is:

> **Explore when knowledge is absent or uncertain. Reuse when existing knowledge is sufficient.**

---

## 4. Query-driven semantic routing

Every user query first attempts to route through persistent semantic memory before new browser exploration is started.

```text
USER QUERY
   ↓
semantic search over known entities / workflow scopes
   ↓
coverage + confidence analysis
```

Possible outcomes:

```text
A. exact or strong known path
   → navigate using known graph

B. relevant workflow is known but target branch/entity is missing
   → selectively explore within that workflow

C. several workflow scopes are plausible
   → ask the user to disambiguate

D. user identifies a workflow not represented in memory
   → begin discovery from that workflow root

E. high-confidence negative knowledge exists
   → avoid pointless exploration
```

Example:

```text
Known top-level flows:
  ITR-1
  ITR-3

User query:
  "Where do I enter capital gains?"

Semantic search:
  no matching entity found
```

If current knowledge cannot determine which return the user means, LeMap-Web may ask:

```text
Which return are you working with — ITR-1, ITR-3, or another ITR?
```

If the user replies:

```text
ITR-2
```

and ITR-2 is not present in semantic memory, that becomes an explicit knowledge gap:

```text
known graph cannot answer
→ new workflow root required
→ begin ITR-2 exploration
```

This prevents expensive exploration of the wrong workflow family.

---

## 5. Absence, uncertainty and coverage

A missing entity in the semantic map does **not** always mean that the application lacks that capability.

LeMap-Web distinguishes:

```text
KNOWN ABSENCE
  sufficiently explored workflow provides evidence that capability/branch is not present

UNEXPLORED / PARTIAL
  relevant workflow exists but coverage is incomplete

UNKNOWN WORKFLOW
  workflow family/root has not yet been learned
```

Example:

```text
ITR-1
  capital gains = known absent
  coverage confidence = high

ITR-3
  capital gains = unknown
  income branch coverage = partial

ITR-2
  workflow = unknown
```

Negative knowledge should only be persisted when exploration coverage and evidence are strong enough to support it.

Coverage metadata may be maintained at several levels:

```text
WorkflowFamily
  coverage
  confidence
  lastObservedAt

WorkflowArc / Entity
  exploredStates
  unexploredBranches
  evidenceIds
  freshness
```

This lets the query planner decide whether "not found" means "not applicable" or "not learned yet."

---

## 6. Entity graph

An entity is a structurally coherent object whose state can be observed and changed.

```text
Entity
  id
  fields[]
  relationships[]
  methods/actions[]
  states[]
  semantic annotation
  presentation evidence
```

A rendered screen may expose one entity, several related entities, a repeated entity collection, or an entity also exposed elsewhere.

Fields include labelled form inputs/content and meaningful observable state. Relationships may be contained in one rendered surface or cross rendered surfaces.

The browser's page boundary never limits relationship/state-effect discovery.

---

## 7. Central deterministic primitive

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

## 8. Local entity-behaviour exploration

When LeMap-Web reaches an unknown or insufficiently understood entity context, it resolves that context locally before choosing a broader transition.

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
repeat until sufficient local behavioural closure
```

Input type determines the **probe strategy**, not the semantic conclusion.

Examples:

```text
radio group
  select alternatives
  observe whether selection clears peers
  learn mutually-exclusive / exactly-one behaviour empirically

checkbox group
  probe every member individually
  restore after each isolated probe
  probe representative combinations rather than all combinations
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

> **Probe every action individually where practical, but probe combinations strategically.**

and:

> **UI control type tells LeMap-Web how to experiment. Observed state change tells LeMap-Web what the control actually does.**

Unsafe, destructive or externally consequential actions are not exploratory probes.

---

## 9. Local entities, related entities and structural transition kinds

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

A useful notion is **local behavioural closure**:

```text
relevant input behaviour sufficiently explored
local constraints discovered
local related entities explored
local validations understood
local actions classified
local semantic interpretation available
```

"Closure" is query-sensitive. LeMap-Web does not need to exhaust every possible local state if the current query can already be answered or safely routed onward.

---

## 10. Local semantic resolution

LeMap-Web needs local semantics while exploration is in progress.

After deterministic local behavior has been collected, the model receives a compressed structural package:

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

These annotations are persisted and immediately become usable by the query planner and navigator.

---

## 11. Goal-directed outgoing navigation

After sufficient local understanding, LeMap-Web gathers outgoing interactions that were not consumed as local exploration.

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
breadcrumbs
section links
modal-launch actions
other navigational buttons/anchors
```

Blind DOM-order DFS is not acceptable because many outgoing links may leave the active business context.

The navigation decision receives:

```text
original user query
current semantically resolved entity
local completion meaning
known workflow context / path so far
candidate outgoing actions / links
known semantic map around this point
coverage / confidence
safety / reversibility information
```

The task is not merely:

```text
"Which link continues this page?"
```

It is:

> **Which safe outgoing transition most likely advances the original user goal, given the current workflow context and what is already known?**

Useful classifications include:

```text
LOCAL_EXPANSION
RELATED_ENTITY
FORWARD_WORKFLOW
WORKFLOW_BRANCH
REVERSE_WORKFLOW
ANCESTOR_WORKFLOW
WORKFLOW_EXIT
SIDE_CONTEXT
SITE_CHROME
```

Useful scoring dimensions include:

```text
goal relevance
workflow continuity
forward progress
context preservation
known vs unknown coverage
confidence
```

Example:

```text
User query:
  "Where do I declare foreign capital gains?"

Current entity:
  Filing Status

Continue
  goal relevance: moderate
  workflow continuity: very high

Dashboard
  goal relevance: very low
  workflow continuity: very low
```

Later, on an Income Sources entity:

```text
Capital Gains
  goal relevance: very high

Business Income
  goal relevance: low
```

The same query therefore drives branch selection differently at different points in the workflow.

---

## 12. Frontier and query-driven branch exploration

Outgoing candidates that are not chosen are retained rather than discarded when they may still be useful for the active query or future exploration.

A traversal frame may contain:

```text
ExplorationFrame
  queryId
  entityId
  entityStateId
  workflowArcId
  outgoingCandidates[]
    actionId
    transitionRole
    goalScore
    continuityScore
    safety
    reversible
    explored
```

LeMap-Web follows the best admissible candidate while retaining useful siblings in a frontier/stack.

Unlike exhaustive site crawling, the frontier is **query-prioritized**. Low-relevance branches may remain persisted as unexplored rather than being visited immediately.

When a path reaches completion, a dead end, a low-relevance state, a cycle or a blocked transition, traversal can return to the nearest useful unresolved frontier candidate.

This resembles bounded graph traversal in LeMap query answering, but Web traversal is active: following an edge changes application state.

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

## 13. Workflow graph grows as a by-product of query execution

LeMap-Web learns local entity relationships and global workflow arcs while trying to satisfy user goals.

```text
User Query A
   ↓
learn Filing Status
   ↓
learn Personal Details

User Query B
   ↓
reuse known path
   ↓
encounter unknown Income branch
   ↓
learn Capital Gains
```

Over time the persistent graph grows:

```text
Workflow Arc
  Step 1
    local entity graph
       ↓
  Step 2
    local entity graph
       ├─ known branch A
       ├─ newly learned branch B
       └─ unexplored branch C
```

The semantic map is therefore the **memory accumulated by the agent**, not a separately required crawl product.

A later query can refine existing knowledge:

```text
known entity revisited
  ↓
new field / changed behavior detected
  ↓
existing semantic entity updated with new evidence/state
```

The system should preserve provenance and freshness so changes in the application can refine rather than blindly overwrite prior knowledge.

---

## 14. Top-level semantic scopes

LeMap-Web navigates at more than the field/entity level.

Useful semantic scopes include:

```text
Application
  ↓
Domain / capability
  ↓
Workflow family
  ↓
Workflow arc / stage
  ↓
Entity
  ↓
Field / action
```

Example:

```text
Income Tax Portal
  ↓
File Income Tax Return
  ↓
ITR-1 / ITR-2 / ITR-3
  ↓
Filing Status / Personal Details / Income / Tax / Verification
  ↓
Capital Gains / Business Income / etc.
```

This hierarchy lets LeMap-Web determine whether a query should:

```text
reuse a known entity path
explore a missing branch inside a known workflow
ask the user which workflow family applies
or start an entirely new workflow discovery
```

---

## 15. How LeMap-Web differs from core LeMap

Core LeMap usually begins with a largely available executable universe:

```text
repository
  ↓
call graph / service graph / entity graph
  ↓
semantic search / Scout / Pass 1 / Pass 2
```

LeMap-Web is different because the browser exposes only the currently reachable portion of the application.

Its normal lifecycle is:

```text
USER QUERY
  ↓
SEARCH KNOWN GRAPH
  ↓
KNOWLEDGE GAP?
  ├─ no  → use known graph
  └─ yes
       ↓
     observe local structure
       ↓
     probe local behaviour
       ↓
     resolve local semantics
       ↓
     choose next transition using query + context
       ↓
     discover next entity
       ↓
     extend persistent graph
       ↓
     continue same query
```

Therefore:

> **LeMap searches a largely existing execution graph. LeMap-Web can actively create missing portions of the execution graph while answering the query.**

The deterministic/semantic ownership boundary is still preserved. The model does not invent browser behaviour; it interprets proven evidence and helps prioritize what structure to discover next.

---

## 16. Semantic tasks

LeMap-Web now has several semantic tasks with different scopes.

### Level 0 — Query Planner / Semantic Router

Input:

```text
original user query
known workflow families / entities
semantic search matches
coverage / confidence / negative knowledge
```

Output:

```text
known path sufficient
select workflow scope
explore knowledge gap
ask user to disambiguate
start new workflow discovery
```

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

### Level 2 — Goal-Directed Navigation Scout

Input:

```text
original user query
resolved current entity
known path so far
candidate outgoing actions
known semantic memory
coverage/safety evidence
```

Output:

```text
transition classification
goal relevance
continuity score
forward-progress assessment
reason / evidence reference
```

### Level 3 — Global Semantic Consolidation

Broader Pass-1/Pass-2-style reasoning may periodically consolidate accumulated evidence into cleaner business-level workflow semantics.

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

Global consolidation is refinement over accumulated knowledge, not a prerequisite before query execution.

---

## 17. Reuse from core LeMap

LeMap-Web should reuse proven concepts without forcing the same lifecycle.

Useful concepts to adapt:

```text
semantic query planning
bounded graph search
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

## 18. Safety and restoration

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

The explorer only executes actions compatible with the active safety policy. Query relevance never justifies unsafe mutation.

---

## 19. Current implementation direction

The engineering target is no longer an exhaustive crawler. It is a query-driven explorer backed by persistent semantic memory.

```text
USER QUERY
      ↓
SEARCH / ROUTE THROUGH PERSISTENT SEMANTIC MEMORY
      ↓
KNOWN PATH SUFFICIENT?
      ├─ YES → EXECUTE / ANSWER
      └─ NO
           ↓
       IDENTIFY KNOWLEDGE GAP / AMBIGUITY
           ↓
       ASK USER IF WORKFLOW SCOPE IS AMBIGUOUS
           ↓
       DISCOVER CURRENT ENTITY
           ↓
       TYPE-AWARE SAFE LOCAL ACTION EXECUTOR
           ↓
       LOCAL STATE DELTA / RELATIONSHIP LEARNING
           ↓
       LOCAL SEMANTIC RESOLUTION
           ↓
       GOAL-DIRECTED OUTGOING SCORING
           ↓
       FOLLOW BEST SAFE TRANSITION
           ↓
       EXTEND PERSISTENT ENTITY + WORKFLOW GRAPH
           ↓
       CONTINUE SAME USER QUERY
```

Stable deterministic IDs are required for entities, fields, actions, states and transitions. Empty/no-effect observations must not create workflow edges.

Coverage, confidence and freshness must be persisted so absence can be distinguished from incomplete exploration.

---

## 20. End-to-end architecture

```text
USER QUERY
      ↓
QUERY PLANNER / SEMANTIC ROUTER
      ↓
SEARCH PERSISTENT SEMANTIC MEMORY
      ↓
┌───────────────────────────────────────────────┐
│ known route sufficient → execute / answer    │
└───────────────────────────────────────────────┘
      │ otherwise
      ↓
DETECT KNOWLEDGE GAP / AMBIGUITY
      ↓
(optional) USER DISAMBIGUATION
      ↓
Browser instrumentation
      ↓
Discover current structural entity context
      ↓
Type-aware safe local behaviour exploration
      ↓
Entity-state deltas + local relationships
      ↓
Explore relevant inline/modal related entities
      ↓
Sufficient local behavioural closure
      ↓
LOCAL ENTITY SEMANTIC RESOLVER
      ↓
Persist semantic entity annotations
      ↓
Collect unresolved outgoing navigation actions
      ↓
GOAL-DIRECTED NAVIGATION SCOUT
      ↓
Retain useful alternatives in query frontier
      ↓
Follow best safe transition
      ↓
Discover next entity / extend workflow arc
      ↓
Persist structure + semantics + coverage + evidence
      ↓
continue until original user query is answered
      ↓
(optional) GLOBAL SEMANTIC CONSOLIDATION
```

The invariant is:

> **LeMap-Web searches what it already knows, actively learns only what the current query needs, persists that knowledge, and uses the growing semantic memory to make future queries progressively cheaper and more reliable.**
