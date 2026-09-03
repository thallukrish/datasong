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
interaction semantics
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
inline_expand
overlay_open
navigation
```

A visible blocking overlay becomes the dominant current entity projection until it is resolved. Underlying entities are not explored or navigated while the overlay blocks interaction.

Presentation boundaries do not decide whether something is a workflow step.

---

## 12. Local semantic resolution

After sufficient deterministic evidence is available, the model receives a compressed description of the **whole relevant local entity graph**, not a random list of empty controls.

Input may include:

```text
current user goal
compact prior workflow-arc semantics
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

Semantic resolution may produce:

```text
entity names/descriptions
field meanings
relationship meanings
constraints
action meanings
local completion meaning
interaction semantics
confidence
```

### Interaction semantics are learned with the entity

When an entity or field represents information that may need to come from a human, the semantic resolver should also generate a reusable interaction description while it already has the richest local context.

```text
InteractionSemantics
  requiresUserInformation
  information
  friendlyQuestion
  examples[]
  optionExplanations[]
  clarification
  dependencies / relevant relationships
  confidence
```

For example, deterministic evidence may expose:

```text
label: section 139
control: selectable field
options: 139(1), 139(4), 139(5), ...
relationship: selection changes downstream filing basis/path
```

The semantic model may learn:

```text
Entity: Return Filing Basis

information:
  identifies the legal/timing basis under which the return is being filed

friendlyQuestion:
  Which situation describes how you are filing this return?

examples:
  within the normal filing period
  filing after the due date
  revising an earlier return
```

The interaction semantics are persisted with the semantic template and reused. LeMap-Web should not spend another model call merely to rephrase the same field every time it is encountered.

The semantic resolver should use only a compact workflow arc: the current goal, the immediately relevant prior stage descriptions, the current entity, local relationships and structurally valid options. It should not receive an unbounded transcript.

Once sufficiently stable, these annotations are persisted and reused on later runs.

---

## 13. Navigation does not require user input

A crucial rule is:

> **The user is not required for navigation whenever the application state plus semantic memory are sufficient to choose the next action.**

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

The planner chooses **which learned interaction semantic is required now**. It should not regenerate the wording if the entity already has a stable friendly question/explanation.

---

## 15. Three value classes on a rendered step

Before leaving a rendered workflow step, LeMap-Web classifies relevant inputs into three categories:

```text
1. PREFILLED
   browser/application already contains a value

2. REMEMBERED
   a prior user/workflow instance contains a potentially reusable value

3. MISSING
   no usable value exists and the workflow requires user input
```

The interaction order is:

```text
resolve semantic entities + relationships + interaction semantics
        ↓
identify prefilled / remembered / missing values
        ↓
collect only missing information
        ↓
apply new user answers
        ↓
reconcile remembered values when their scope permits reuse
        ↓
before leaving the step, summarize prefilled/reused information
        ↓
allow user to confirm or modify
        ↓
navigate
```

### Missing values

Missing values are collected using the persisted friendly explanation/question for the relevant semantic entity.

### Prefilled values

Prefilled values are treated as current browser/application state. The agent should not interrupt the user once per field merely because a value exists.

Before leaving an important step, it should present a concise grouped summary and allow correction, for example:

```text
I found your personal details already filled in.
Name, PAN, date of birth and address are populated.
I will continue with them as shown unless you want to change something.
```

If the user asks to modify one item, LeMap maps the request to the corresponding semantic entity/field, changes it through the proven UI mechanics, observes the resulting state, and only then leaves the step.

### Remembered values

Remembered values are candidates, not automatically authoritative. Reuse depends on semantic scope and validity.

```text
scope:
  taxpayer
  workflow
  assessment_year
  filing_instance
  global

validity:
  persistent
  until_changed
  instance_only
```

A preferred filing mode might be reusable. Assessment year or audit status may not be reusable across filings without appropriate scope/confirmation.

---

## 16. Semantic templates and user/workflow instances

LeMap-Web separates reusable application knowledge from user-specific facts.

### Semantic template

Describes how the application/business concept works:

```text
EntityTemplate
  semantic name
  description
  structural bindings
  options
  relationships
  constraints
  actions
  workflow role
  interaction semantics
```

### Entity/workflow instance

Describes what is true for one user or one execution:

```text
EntityInstance
  instanceOf
  value / selected option
  source
  scope
  validity
  confirmation state
  workflowInstanceId
  observed/confirmed timestamps
```

Sources may include:

```text
user
browser_prefill
remembered_instance
derived
```

Conceptually:

```text
SEMANTIC TEMPLATE
      +
USER / WORKFLOW INSTANCE
      ↓
PERSONALIZED EXECUTABLE WORKFLOW
```

This is how a later request such as:

```text
File ITR-3
```

can reuse already-known applicable information, execute known portions of the workflow immediately, and stop only when a genuinely new or non-reusable fact is required.

---

## 17. Dynamic follow-up questions

User answers change application state and may expose additional entities.

```text
answer
→ apply through proven UI mechanics
→ re-observe state
→ discover newly active entities/relationships
→ reuse or generate interaction semantics for those entities
→ resolve next information need
```

Questioning is lazy and state-dependent.

---

## 18. Goal-directed navigation scout

When broader navigation is needed, LeMap-Web gathers outgoing actions/links and ranks them against the **original user goal**.

Inputs include:

```text
original user goal
current semantic entity graph
workflow family / arc context
semantic path so far
known user/workflow instance facts where appropriate
known outgoing transitions
candidate actions/links
safety/reversibility
coverage/confidence
```

The highest-ranked safe candidate may be executed immediately.

---

## 19. Lazy frontier

Unselected outgoing candidates are not automatically explored.

The frontier is query-prioritized, not coverage-prioritized.

A low-relevance branch may remain unexplored indefinitely unless a later query makes it useful.

---

## 20. The entity/workflow graph grows underneath navigation

As the agent moves toward the user's goal, two reusable template graphs are learned continuously.

### Entity graph

```text
entities
fields
relationships
actions
states
constraints
semantic annotations
interaction semantics
```

### Workflow graph

```text
selected transitions actually traversed
workflow stages
branches encountered
entry/completion evidence
business outcomes as semantics mature
```

User/workflow instances are stored separately from these reusable templates.

---

## 21. Memoization and instant personalized navigation

The payoff of lazy learning appears on later runs.

First run:

```text
unknown state
→ discover entities
→ probe behavior
→ resolve semantics + interaction semantics
→ collect required user facts
→ persist applicable workflow instances
→ navigate
```

Later run:

```text
recognize known workflow/entity
→ reuse semantic template
→ load applicable user/workflow instances
→ apply reusable known values
→ confirm prefilled/reused values when needed
→ navigate known path
→ stop only at first genuinely unknown/non-reusable fact
```

Thus the application becomes progressively cheaper and more personalized to navigate without ever requiring a complete up-front crawl.

---

## 22. Safety and restoration

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

Query relevance never justifies unsafe exploration.

Where local probes temporarily change state, the explorer should restore the original state before handing control back to the navigator or asking the user.

---

## 23. Privacy and storage separation

LeMap-Web must keep reusable semantic knowledge separate from sensitive user/workflow instance data.

### Semantic map

The semantic map should persist application knowledge:

```text
structural field IDs
semantic meanings
interaction semantics
branch structure
option semantics where non-sensitive
relationships
workflow transitions
coverage / confidence
```

### User/workflow instance store

Actual user values belong in a separate instance store with appropriate protection and lifecycle rules.

```text
data/
  semantic-memory/
    web-map.json

  instances/
    <workflow-instance>.json
```

Long-term instance storage containing PAN, addresses, income, bank or other sensitive information should ultimately use an encrypted/secure store rather than plain semantic memory.

### Run logs

Run logs should continue to record structural interaction such as:

```text
field selected
value provided
prefilled value confirmed
remembered value reused
value changed
```

without writing raw sensitive free-text/financial values.

The rule is:

> **Semantic memory remembers how the application works. Instance memory remembers what is true for this user/workflow. Logs remember what the agent did, not sensitive values.**

---

## 24. Semantic tasks

LeMap-Web has several distinct semantic responsibilities.

### Level 0 — Query Planner / Semantic Router

```text
original user goal
known workflow/entity memory
known applicable workflow instances
coverage/confidence
current application location
→ choose known scope/path or identify knowledge gap
```

### Level 1 — Local Entity Semantic Resolver

```text
proven local structural evidence
+ compact prior workflow-arc semantics
→ business/user meaning of entities, fields, relationships and actions
→ reusable interaction semantics for user-input entities
```

### Level 2 — Information-Need Planner

```text
original goal
current semantic entity graph
current state
prefilled / remembered / missing classification
known context
→ no question / explore first / use remembered value / ask specific user fact
```

### Level 3 — Step Completion / Reconciliation

```text
new user answers
prefilled browser values
remembered applicable values
→ summarize
→ confirm or modify when required
→ produce completed step state
```

### Level 4 — Goal-Directed Navigation Scout

```text
original goal
current semantic state
workflow context
candidate outgoing actions
→ rank safe next transitions
```

### Level 5 — Global Semantic Consolidation

Optional broader Pass-1/Pass-2-style reasoning may periodically clean up accumulated workflow semantics.

Global consolidation is refinement, not a prerequisite for navigation.

---

## 25. Token and model-call discipline

Friendly interaction should not cause a second model call every time a question is shown.

The preferred pattern is:

```text
local exploration
→ one semantic-resolution call
→ entity/relationship/workflow meaning
  + reusable interaction semantics
→ persist
```

Later runs reuse the persisted explanation/question/examples.

Model context should remain compact:

```text
original goal
small relevant workflow arc
few recent semantic selections/facts
current entity
current local relationships
valid options
```

Do not send an unbounded transcript or whole-page dump when a compact semantic slice is sufficient.

Run logs should track model usage by purpose:

```text
local_entity
information_need
user_answer
navigation
```

including latency and prompt/completion/total/cache-hit tokens, plus aggregate totals per run.

---

## 26. Difference from core LeMap

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

## 27. End-to-end architecture

```text
USER GOAL
   ↓
QUERY PLANNER / SEMANTIC ROUTER
   ↓
SEARCH SEMANTIC MEMORY + APPLICABLE WORKFLOW INSTANCES
   ↓
RECOGNIZE CURRENT APPLICATION STATE
   ↓
Can we choose a safe goal-directed next action now?
   │
   ├─ YES
   │    ↓
   │  GOAL-DIRECTED NAVIGATION
   │
   └─ NO
        ↓
     DISCOVER LOCAL ENTITY GRAPH AS NEEDED
        ↓
     SAFE TYPE-AWARE BEHAVIOR PROBES AS NEEDED
        ↓
     LOCAL SEMANTIC RESOLUTION
       entity meaning
       relationships
       workflow role
       reusable interaction semantics
        ↓
     CLASSIFY REQUIRED VALUES
       prefilled
       remembered/applicable
       missing
        ↓
     COLLECT ONLY MISSING USER INFORMATION
        ↓
     APPLY ANSWERS + RE-OBSERVE
        ↓
     BEFORE LEAVING STEP
       summarize prefilled/reused values
       confirm or allow modification when needed
        ↓
     PERSIST/UPDATE USER-WORKFLOW INSTANCE
        ↓
     GOAL-DIRECTED NAVIGATION SCOUT
        ↓
     EXECUTE BEST SAFE TRANSITION

Every learned semantic template / executed transition
        ↓
PERSIST SEMANTIC EVIDENCE + WORKFLOW EDGE

Every applicable user fact
        ↓
PERSIST SEPARATE SCOPED WORKFLOW INSTANCE

Future runs
        ↓
REUSE TEMPLATE + INSTANCE
        ↓
NAVIGATE UNTIL NEW INFORMATION IS ACTUALLY REQUIRED
```

The final invariant is:

> **LeMap-Web navigates semantically, learns reusable interaction semantics with the entity, and maintains separate scoped user/workflow instances so future runs can reuse known information, confirm current application state, and ask the user only for genuinely new facts.**
