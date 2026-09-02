# LeMap-Web Architecture

## 1. Objective

LeMap-Web is a **goal-directed semantic navigator for interactive web applications**.

Its primary job is not to crawl an application and build a complete map before doing useful work. Its primary job is to satisfy a user goal as directly as possible, while learning only the portions of the application that are needed along the way.

The simplest description is:

> **Navigate semantically. Learn lazily. Persist what was proven.**

It follows the same governing rule as core LeMap:

> **If structure can prove it, deterministic code owns it. If meaning must be inferred, the model owns it.**

The semantic map is therefore not a prerequisite. It is **memoized operational knowledge accumulated as a side effect of navigation**.

---

## 2. The primary control loop

At every reachable application state LeMap-Web asks one question first:

> **Do I already know enough to safely choose the next action that advances the original user goal?**

The control loop is:

```text
ORIGINAL USER GOAL
        ↓
CURRENT APPLICATION STATE
        ↓
SEARCH KNOWN SEMANTIC MEMORY
        ↓
Can the next goal-directed action be chosen confidently?
        │
        ├─ YES
        │    ↓
        │  EXECUTE IT NOW
        │
        └─ NO
             ↓
          Can safe local exploration resolve the uncertainty?
             │
             ├─ YES
             │    ↓
             │  EXPLORE LOCALLY
             │    ↓
             │  UPDATE STRUCTURE + SEMANTICS
             │    ↓
             │  RETRY DECISION
             │
             └─ NO
                  ↓
               Is genuinely user-specific/business information missing?
                  │
                  ├─ YES
                  │    ↓
                  │  ASK THE USER
                  │    ↓
                  │  APPLY ANSWER TO APPLICATION STATE
                  │    ↓
                  │  RETRY DECISION
                  │
                  └─ NO
                       ↓
                    STOP / AMBIGUITY / UNSUPPORTED PATH
```

This is intentionally different from:

```text
crawl everything
→ understand everything
→ build complete map
→ later navigate
```

LeMap-Web uses **lazy semantic exploration**: application knowledge is materialized only where the active goal takes the navigator.

---

## 3. Agent and map have different roles

The active navigator and persistent semantic map are separate concepts:

```text
Agent = active learner + navigator + operator
Map   = accumulated reusable memory
```

The architecture is therefore:

```text
agent ↔ persistent semantic memory
```

not:

```text
crawler → map → agent
```

The map should make subsequent runs faster, but the agent must always be able to discover an unseen path just in time.

---

## 4. Core structural model

A browser page is **not** a semantic primitive.

A page is only a human-oriented rendering that flattens some portion of a shared entity graph.

```text
WEB APPLICATION
      ↓
SHARED ENTITY GRAPH

Entity
  fields[]
  relationships[]
  actions/methods[]
  states[]
  semantic annotations
  presentation evidence
```

Presentation evidence may include:

```text
pageId
route / URL
title
DOM/root identity
field DOM identity
region path
ARIA role / label
rendered hierarchy
```

Those values help the browser find and operate an entity. They do not define business semantics.

A single rendered state may expose:

```text
one business entity
multiple related entities
nested entities
repeated entity collections
one entity already seen on another route
```

The browser page boundary never limits semantic or relationship discovery.

---

## 5. Workflow graph

A workflow is an ordered or branching path of actions over entities that produces an end-to-end business state change.

```text
Workflow
  workflow family
  arcs / stages
  entities involved
  selected actions
  branches
  merges
  entry conditions
  completion conditions
  outcomes
```

The central execution primitive is:

```text
ENTITY / FIELD
+ ACTION
→ EXECUTION TRACE
→ SHARED ENTITY GRAPH STATE DELTA
```

Execution evidence may include:

```text
browser event
handler/callback behavior
network activity
DOM/state mutation
route change
newly reachable entity
changed action availability
validation state
```

The workflow graph should primarily contain **transitions actually pursued or otherwise deterministically proven**.

Unselected links may be retained as candidate/frontier evidence, but must not be represented as traversed workflow edges.

---

## 6. Persistent semantic memory

LeMap-Web remembers what it has already learned.

Persistent knowledge may include:

```text
application / domain
workflow family
workflow arc / stage
semantic entities
field/action meanings
relationships / constraints
observed states
known transitions
successful traversed paths
candidate/unexplored transitions
coverage / confidence
freshness / provenance
negative knowledge when strongly supported
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
            ├─ Filing Setup
            ├─ Filing Status
            ├─ Personal Details
            └─ Income Sources (partial)
```

The graph is expected to be incomplete.

A partial map is useful as long as the system knows which areas are:

```text
known
partial
unexplored
stale
known absent
```

The key rule is:

> **Reuse when knowledge is sufficient. Explore when knowledge is absent, stale or uncertain.**

---

## 7. Coverage and the meaning of “not found”

A missing semantic entity does not automatically mean the application lacks it.

LeMap-Web distinguishes:

```text
KNOWN ABSENCE
  sufficiently explored evidence supports that the capability/branch is absent

PARTIAL / UNEXPLORED
  relevant workflow exists but coverage is incomplete

UNKNOWN WORKFLOW
  workflow family/root has not yet been learned
```

Example:

```text
ITR-1
  capital gains = known absent
  confidence = high

ITR-3
  capital gains = unknown
  income coverage = partial

ITR-2
  workflow = unknown
```

Negative knowledge should only be persisted when the evidence and coverage are strong enough to justify it.

---

## 8. Semantic routing hierarchy

Navigation operates at multiple semantic levels:

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
Filing Setup / Filing Status / Personal Details / Income / Tax / Verification
  ↓
Capital Gains / Business Income / etc.
```

This lets the query planner reason before touching the browser.

Given a query, the planner may determine:

```text
known path exists
→ use it immediately

known workflow but missing branch
→ navigate through known portion, discover only missing branch

several workflow scopes plausible
→ ask user to disambiguate if application state cannot resolve it

unknown workflow
→ begin lazy discovery from the appropriate root

known absence
→ avoid pointless exploration
```

---

## 9. Local structural discovery

When the current application state is unknown or insufficiently understood, LeMap-Web discovers its local structure deterministically.

```text
rendered state
   ↓
discover candidate entities
   ↓
discover fields / groups / actions
   ↓
discover local relationships
   ↓
classify safe executable probes
```

The goal is not “find every HTML input.”

The goal is:

> **Discover the local entity graph and enough behavior to support semantic navigation.**

---

## 10. Local behavior exploration

The explorer is type-aware and evidence-driven.

Input type determines how to probe; observed effects determine what the control means structurally.

### Radio groups

```text
select alternatives
observe whether peers are cleared
observe dependent entities/actions
learn mutually-exclusive / exactly-one behavior
restore original state
```

### Checkbox groups

```text
probe each member independently
restore after each isolated probe
probe representative combinations
learn multi-select / exclusivity / conditional behavior
avoid 2^n combinatorial exploration
```

### Dropdowns / comboboxes

```text
open control
inspect available options
record option labels/values where safe
probe representative alternatives when useful
observe dependent state/entity changes
restore where possible
```

A dropdown is part of local discovery, not merely something the executor knows how to click.

Framework-specific rendering such as Angular Material `mat-select` may be handled by a browser adapter, but the semantic graph should expose the generic concept:

```text
selectable field
options[]
selected value/state
dependencies
```

### Text / number / date / autocomplete

These are handled conservatively because arbitrary values may be sensitive or destructive.

Safe synthetic probes may be used where appropriate to discover validation or format behavior, but user-specific values must not be invented merely for coverage.

### Actions

Actions are classified for:

```text
local state change
inline expansion
overlay/modal expansion
navigation
persistent mutation
irreversible/destructive effect
```

Unsafe or consequential actions are never executed merely to increase knowledge.

---

## 11. Local structural transition kinds

A local action can reveal more structure without creating a new workflow step.

```text
state_change
  current entity state changed

inline_expand
  additional fields/entity became reachable inline

overlay_open
  modal/drawer/popover entity became reachable

navigation
  broader rendered application context changed
```

Inline and overlay changes may represent:

```text
same entity expansion
related entity
reusable sub-entity/subflow
```

Presentation boundaries do not decide whether something is a workflow step.

---

## 12. Local semantic resolution

After sufficient deterministic evidence is available, the model receives a compressed description of the **whole relevant local entity graph**, not a random list of empty controls.

Input may include:

```text
current user goal
presentation context
candidate entities
fields/groups/options
actions
observed state transitions
structural relationships
local related entities
validation/action availability evidence
known semantic memory for matching entities
```

The model annotates rather than replaces deterministic evidence.

Example:

```text
Structural evidence
  radio group N/Y/NA is mutually exclusive
  choosing Y enables four checkboxes
  multiple checkboxes may coexist
  Continue becomes available under valid combinations

Semantic interpretation
  Entity: Filing Reason
  Entity: Seventh Proviso Conditions
  Relationship: qualifying conditions apply only on the Y branch
  Action: Continue completes filing-status determination
```

Semantic resolution may produce:

```text
entity names/descriptions
field meanings
relationship meanings
constraints
action meanings
local completion meaning
confidence
```

Once sufficiently stable, those annotations are persisted and reused on later runs.

---

## 13. Navigation does not require user input

A crucial rule is:

> **The user is not required for navigation whenever the application state plus semantic memory are sufficient to choose the next action.**

For example, if the current entity is understood and `Continue` clearly advances the active ITR-3 workflow, LeMap-Web should continue immediately.

It should not stop simply because the page contains form controls.

The system first tries to navigate using:

```text
original user goal
known workflow context
current semantic entity graph
current application state
known successful transitions
candidate outgoing actions
coverage/confidence
safety
```

Only unresolved information that genuinely blocks progress should cause further exploration or a user question.

---

## 14. User interaction is an information source, not the workflow

The conversation with the user is **not** the workflow.

It is one mechanism for acquiring missing state required to continue the workflow.

The agent should never implement:

```text
for every visible empty field:
  ask user
```

Instead:

```text
current semantic entity graph
+ original user goal
+ known workflow context
+ current state
        ↓
INFORMATION-NEED PLANNER
        ↓
Which missing facts actually block useful progress?
```

The planner may conclude:

```text
no user information required
→ navigate now

application can reveal the answer safely
→ explore first

business/user fact genuinely required
→ ask user
```

Example:

```text
Entity: Filing Setup
  Assessment Year
  Filing Mode
  Continue
```

The model should determine whether Assessment Year or Filing Mode must actually be supplied by the user, whether either is already known/prefilled, and whether the active goal/context implies a choice.

It should not ask merely because a parser detected two empty controls.

---

## 15. User question planning

When user input is genuinely necessary, the question should be generated from semantic entity context rather than directly from DOM labels.

For example, deterministic discovery may provide:

```text
label: Select Assessment year
control: combobox
options: 2026-27, 2025-26, ...
```

Semantic question planning may turn that into:

```text
Which assessment year do you want to file the return for?
```

The model receives only the structurally valid choices and must map the user's natural-language response back to those known structural field/action IDs.

It must never invent an option.

---

## 16. Dynamic follow-up questions

User answers change application state and may expose additional entities.

Example:

```text
Filing Reason
  N
  Y
  NA
```

If the user answer maps to `N`:

```text
apply N
→ no qualifying-condition entity becomes active
→ do not ask those questions
→ continue workflow if possible
```

If the answer maps to `Y`:

```text
apply Y
→ Seventh Proviso Conditions becomes active
→ re-observe local entity graph
→ resolve new information need
→ ask only required follow-up question(s)
```

Therefore questioning is itself lazy and state-dependent.

---

## 17. Goal-directed navigation scout

When broader navigation is needed, LeMap-Web gathers outgoing actions/links and ranks them against the **original user goal**.

Inputs include:

```text
original user goal
current semantic entity graph
workflow family / arc context
semantic path so far
user-supplied branch facts where safe to retain
known outgoing transitions
candidate actions/links
safety/reversibility
coverage/confidence
```

The model answers:

> **Which safe outgoing transition most likely advances the original goal from the current semantic state?**

Useful roles include:

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
UNKNOWN
```

Useful scoring dimensions include:

```text
goal relevance
workflow continuity
forward progress
context preservation
confidence
```

The highest-ranked safe candidate may be executed immediately.

---

## 18. Lazy frontier

Unselected outgoing candidates are not automatically explored.

They may be retained as a query/session frontier:

```text
ExplorationFrame
  queryId
  entityId
  entityStateId
  workflowArcId
  outgoingCandidates[]
    actionId
    role
    goalScore
    continuityScore
    safety
    reversible
    explored
```

The frontier is query-prioritized, not coverage-prioritized.

A low-relevance branch may remain unexplored indefinitely unless a later query makes it useful.

This avoids combinatorial explosion on large enterprise applications.

---

## 19. The entity/workflow graph grows underneath navigation

As the agent moves toward the user's goal, two things are learned continuously.

### Entity graph

```text
entities
fields
relationships
actions
states
constraints
semantic annotations
```

### Workflow graph

```text
selected transitions actually traversed
workflow stages
branches encountered
entry/completion evidence
business outcomes as semantics mature
```

Example:

```text
Assessment Year
   ↓
Filing Mode
   ↓
Continue
   ↓
Filing Status
   ↓
N
   ↓
Continue
   ↓
Return Type
```

That traversed path becomes reusable evidence.

Other links may remain recorded as candidates, but they are not falsely promoted to workflow edges merely because they existed in the DOM.

---

## 20. Memoization and instant navigation

The payoff of lazy learning appears on later runs.

First run:

```text
unknown state
→ discover entities
→ probe behavior
→ resolve semantics
→ rank transition
→ navigate
```

Later run over a structurally compatible known state:

```text
recognize entity/state
→ reuse semantic annotation
→ reuse known transition priors
→ rank/validate against current goal
→ navigate almost immediately
```

If a known entity has changed:

```text
structural signature mismatch
→ treat prior knowledge as stale/partial
→ rediscover changed area
→ refine existing semantic memory
```

Thus the application becomes progressively cheaper to navigate without ever requiring a complete up-front crawl.

---

## 21. Safety and restoration

Web exploration actively changes application state, so safety is part of traversal semantics.

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

Typical examples:

```text
select radio option      → often safe local probe
open informational modal → usually safe
Continue                 → often safe navigation, context-dependent
Save Draft               → persistent mutation
Submit Return             → irreversible/high impact
Delete                    → destructive
Logout                    → workflow exit
```

Query relevance never justifies unsafe exploration.

Where local probes temporarily change state, the explorer should restore the original state before handing control back to the navigator or asking the user.

---

## 22. Privacy

LeMap-Web's semantic memory should describe the application, not become a store of sensitive user data.

Persist:

```text
structural field IDs
semantic meanings
branch structure
option semantics where non-sensitive
relationships
selected workflow edge
"value supplied" markers when useful
```

Avoid persisting:

```text
passwords
auth/session tokens
PAN/account identifiers
email/phone where not required for structural learning
raw taxpayer free-text values
raw financial values
sensitive response bodies
```

User-supplied values may exist transiently in the active browser/session context without becoming long-lived semantic memory.

---

## 23. Semantic tasks

LeMap-Web has several distinct semantic responsibilities.

### Level 0 — Query Planner / Semantic Router

```text
original user goal
known workflow/entity memory
coverage/confidence
current application location
→ choose known scope/path or identify knowledge gap
```

### Level 1 — Local Entity Semantic Resolver

```text
proven local structural evidence
→ business/user meaning of entities, fields, relationships and actions
```

### Level 2 — Information-Need Planner

```text
original goal
current semantic entity graph
current state
known context
→ no question / explore first / ask specific user fact
```

### Level 3 — Goal-Directed Navigation Scout

```text
original goal
current semantic state
workflow context
candidate outgoing actions
→ rank safe next transitions
```

### Level 4 — Global Semantic Consolidation

Optional broader Pass-1/Pass-2-style reasoning may periodically clean up accumulated workflow semantics:

```text
business actor
business intent
major stages
branches / joins
completion conditions
outcomes
cross-step rules
```

Global consolidation is refinement, not a prerequisite for navigation.

---

## 24. Difference from core LeMap

Core LeMap usually begins with a largely available executable universe:

```text
repository
  ↓
call/service/entity graph
  ↓
semantic search / Scout / Pass 1 / Pass 2
```

LeMap-Web sees only what the browser currently exposes.

Therefore:

> **Core LeMap discovers semantics over an execution graph that largely already exists. LeMap-Web navigates while lazily materializing missing parts of the execution graph.**

The common principle remains the same:

```text
structure/evidence = deterministic
meaning/prioritization = model
```

---

## 25. End-to-end architecture

```text
USER GOAL
   ↓
QUERY PLANNER / SEMANTIC ROUTER
   ↓
SEARCH PERSISTENT SEMANTIC MEMORY
   ↓
RECOGNIZE CURRENT APPLICATION STATE
   ↓
Can we choose a safe goal-directed next action now?
   │
   ├─ YES
   │    ↓
   │  GOAL-DIRECTED NAVIGATION SCOUT
   │    ↓
   │  EXECUTE BEST SAFE TRANSITION
   │
   └─ NO
        ↓
     Is local structure/behavior insufficiently understood?
        │
        ├─ YES
        │    ↓
        │  DISCOVER LOCAL ENTITY GRAPH
        │    ↓
        │  SAFE TYPE-AWARE BEHAVIOR PROBES
        │    ↓
        │  ENTITY STATE DELTAS + RELATIONSHIPS
        │    ↓
        │  LOCAL SEMANTIC RESOLUTION
        │    ↓
        │  PERSIST / REFINE SEMANTIC ENTITY MEMORY
        │    ↓
        │  RETRY NEXT-ACTION DECISION
        │
        └─ NO
             ↓
          INFORMATION-NEED PLANNER
             ↓
          Is a user-specific business fact required?
             │
             ├─ NO → retry navigation / stop on unresolved ambiguity
             │
             └─ YES
                  ↓
               ASK ONLY THE REQUIRED QUESTION
                  ↓
               MAP ANSWER TO PROVEN STRUCTURAL OPTION/FIELD
                  ↓
               APPLY ANSWER
                  ↓
               RE-OBSERVE ENTITY STATE
                  ↓
               RETRY NEXT-ACTION DECISION

Every executed transition / discovered entity
        ↓
PERSIST EVIDENCE + COVERAGE + SELECTED WORKFLOW EDGE
        ↓
Future runs reuse compatible knowledge
```

The final invariant is:

> **LeMap-Web does not build a semantic map in order to navigate. It navigates semantically toward the user's goal and memoizes what it learns, asking the user only when genuinely missing business information prevents further safe progress.**
