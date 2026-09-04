# LeMap-Web Architecture

## 1. Objective

LeMap-Web is a **goal-directed semantic navigator for interactive web applications**.

It does not crawl an application up front. It incrementally learns the parts of the application that are encountered while satisfying a user goal.

The governing rules are:

> **Navigate semantically. Learn lazily. Persist what was proven.**

> **If structure can prove it, deterministic code owns it. If meaning must be inferred, the model owns it.**

> **The model proposes meaning, priority and generalization. LeMap-Web proves state, structure and behavior through execution.**

A browser page is presentation evidence, not the semantic primitive. The durable model is a shared entity/relationship graph plus a workflow graph accumulated across real executions.

---

## 2. Core algorithm

For every newly encountered rendered context:

```text
ORIGINAL USER GOAL
        ↓
CAPTURE CURRENT BROWSER STATE
        ↓
DETERMINISTIC STRUCTURAL SUMMARY
  fields / groups / actions
  labels / types / options
  visible / enabled / current state
  hierarchy / regions / overlays
        ↓
LOCAL SEMANTIC RESOLUTION
  entity meaning
  sub-entities / relationships
  relevant user interactions
  question / explanation / examples
  local vs application scope
  interaction priority / dependencies
  action workflow roles
  behavior-generalization hypotheses
        ↓
RECONCILE INTERACTION STATE
  prefilled
  remembered + executable
  remembered + blocked
  missing
  optional / irrelevant to current goal
        ↓
RESOLVE NEXT GOAL-RELEVANT INTERACTION
        ↓
REAL EXECUTION
        ↓
CAPTURE BEFORE / AFTER
        ↓
DETERMINISTIC STRUCTURAL DELTA
        ↓
┌─────────────────────────────────────────────┐
│ no meaningful external delta                │
│   → continue with next planned interaction  │
│                                             │
│ known behavior-class delta                  │
│   → reuse semantics and continue locally    │
│                                             │
│ new structural behavior                    │
│   → semantic reinterpretation once          │
│   → extend entities / relationships         │
│                                             │
│ route/root workflow transition              │
│   → persist workflow edge                    │
│   → repeat on new rendered context          │
└─────────────────────────────────────────────┘
        ↓
INFORMATION / NAVIGATION PLANNER
        ↓
GOAL COMPLETE?
```

The browser never mutates controls merely to gain coverage. **Real goal-directed execution is the behavioral probe.**

---

## 3. Structural capture

LeMap-Web first summarizes the current rendered context mechanically.

Relevant evidence includes:

```text
fields
  text / number / date
  select / combobox
  radio / checkbox
  autocomplete

groups
  radio groups
  checkbox groups
  composite controls

actions
  buttons
  links

state
  visible / hidden
  enabled / disabled
  checked / selected
  current value presence
  available option/value domain

presentation
  route
  entity root
  region path
  hierarchy
  active overlay/modal
```

The structural summary is compact. Raw DOM is not sent to the model when the same evidence can be represented as typed fields/groups/actions.

---

## 4. Global/application controls versus local workflow controls

Controls recurring across distinct local entities are application-scope candidates.

Example:

```text
Rendered context A
  Language
  Profile
  Local field X

Rendered context B
  Language
  Profile
  Local field Y
```

Repeated stable controls can be classified structurally as application/global scope.

This does **not** mean they are ignored. Their semantic meaning remains reusable and queryable. It means they do not create local workflow pressure unless the current user goal actually concerns them.

```text
application scope
  language
  profile
  global navigation

local workflow entity
  current business inputs
  local actions
  conditional sub-entities
```

---

## 5. Local semantic resolution: deciding where to begin

A newly encountered context is not processed in DOM order.

LeMap-Web sends the semantic resolver a compact structural summary plus the original goal. The model decides which structural elements represent meaningful user-facing concepts and which are relevant to the goal.

For each semantic interaction the model may return:

```text
semanticKey
semanticName
structuralFieldIds[]
explanation
question
examples[]
valueScope
reusePolicy
goalRelevance
priority
requiredForGoal
dependsOnSemanticKeys[]
behaviorHypothesis
```

Value scopes are generic:

```text
application
actor
workflow
workflow_instance
```

The model therefore answers the semantic question:

> **Among the visible controls, where should user interaction begin for this goal?**

Deterministic code then applies the model's plan using actual current state and executability.

### Interaction ordering

The live interaction layer orders goal-relevant interactions by:

```text
1. dependency readiness
2. model priority
3. goal relevance
```

An interaction marked `requiredForGoal=false` is not presented merely because the UI exposes it.

A dependent interaction remains blocked until its semantic prerequisites have state.

---

## 6. Reusable question semantics

The semantic resolver learns the user-facing explanation at the same time it understands the entity.

```text
InteractionSemantics
  semanticName
  explanation
  friendly question
  examples
  structural binding
  value scope
  reuse policy
```

These are persisted with application semantics and reused on later executions.

The model may explain domain terminology from the evidence and supplied workflow context. Optional external enrichment can be layered separately, but browser mechanics must never depend on web research.

---

## 7. User/instance data is separate from semantic knowledge

The reusable semantic map describes how the application works.

The instance store describes what is true for one actor/workflow execution.

```text
SEMANTIC MEMORY
  entity meanings
  field/action meanings
  relationships
  interaction semantics
  behavior classes
  workflow transitions

INSTANCE MEMORY
  user-entered values
  browser-prefilled values
  remembered applicable values
  scope / confirmation state
```

Private user values are not required for semantic behavior learning.

Run logs should record that a value was supplied/reused/confirmed without logging sensitive raw values.

---

## 8. Interaction-state reconciliation

For every semantic interaction, LeMap-Web derives one current status:

```text
PREFILLED
  the browser already contains a value

REMEMBERED
  an applicable stored value exists and the control is executable

BLOCKED
  the interaction is relevant but not executable yet,
  or a semantic dependency has not been resolved

MISSING
  required user/business information is not available

OPTIONAL
  visible semantic interaction is not required for the current goal
```

This naturally handles UI dependencies.

```text
Interaction A = missing
Interaction B = remembered but disabled

resolve A
→ browser enables B
→ next reconciliation makes B executable
→ reuse B
```

No domain-specific dependency code is required.

---

## 9. Real execution is the behavior probe

Every actual interaction produces an execution trace.

```text
BEFORE STATE
   ↓
apply user / remembered / confirmed-prefill interaction
   ↓
AFTER STATE
   ↓
compute external structural delta
```

The important delta excludes the trivial fact that the source control's own value changed.

External effects may include:

```text
fields enabled / disabled
fields shown / hidden
fields added / removed
actions enabled / disabled / shown / hidden
regions shown / hidden
overlay/modal appearance
validation changes
route change
entity-root change
option-domain changes
```

This is authoritative behavioral evidence.

---

## 10. Behavior classes

Different literal values often produce the same external structural behavior.

Example:

```text
choice A → enables Next
choice B → enables Next
choice C → enables Next
```

They belong to one behavior class if their normalized external effect is identical.

```text
Behavior Class B1
  external effect: Next enabled
```

A value producing different structure creates another class.

```text
choice D
→ reveals additional region
→ Behavior Class B2
```

The key invariant is:

> **A new value is not novelty. A new structural effect is novelty.**

Thus:

```text
new value + known effect
→ no semantic reinterpretation

new value + new effect
→ semantic reinterpretation once
```

---

## 11. Model-proposed behavior generalization

The semantic resolver may propose a finite-choice behavior hypothesis:

```text
behaviorHypothesis
  mode:
    same_effect_across_domain
    value_specific
    unknown
  confidence
  description
```

Example:

```text
"These option values are likely to produce the same external behavior"
confidence = 0.93
```

This is a prior, not proof.

LeMap-Web continues to observe every real execution.

```text
expected class == observed class
→ hypothesis remains consistent

new external effect observed
→ hypothesis is falsified
→ new behavior class
→ semantic resolver receives structural novelty
```

So model confidence can reduce unnecessary semantic calls, but never overrides observed browser behavior.

---

## 12. Structural novelty and conditional entities

A real interaction can reveal new nested structure.

Examples:

```text
select option
→ inline section expands

choose branch
→ modal appears

set value
→ new group becomes visible
```

Deterministic code first proves the change.

The semantic resolver is then called with:

```text
source semantic interaction
behavior-class identity
external structural delta
new hierarchy / fields / actions
```

The model may interpret the result as a new entity/sub-entity and relationship.

Conceptually:

```text
Entity A
   |
   | source interaction / behavior class
   ↓
Conditional Entity B
```

The persisted relationship carries the triggering semantic interaction and behavior-class evidence rather than requiring private user values in semantic memory.

Hierarchy is evidence. A new region appearing under the source control's local container can become a child/conditional sub-entity rather than an unrelated flat page entity.

---

## 13. Overlays and modals

A visible blocking overlay becomes the dominant active entity projection.

```text
underlying context
   ↓ interaction
blocking modal appears
   ↓
modal = active local entity
```

The relationship to the parent context is learned from the real triggering execution trace.

The underlying page is not navigated while the modal blocks interaction.

---

## 14. Semantic action roles

The local semantic resolver also interprets actions visible in the current context.

Action roles include:

```text
local_entity_action
branch_action
workflow_continuation
workflow_reverse
global_navigation
unknown
```

This lets the first semantic interpretation distinguish, for example:

```text
Add Item
→ local entity action

Open Details
→ branch action

Continue
→ workflow continuation
```

These roles are supplied to the navigation scout as semantic evidence.

---

## 15. Navigation consequence and safety

Action role and action consequence are separate.

The goal-directed navigation scout scores outgoing candidates using:

```text
original user goal
goal relevance
workflow continuity
forward progress
learned action role
semantic context
```

It also classifies consequence generically:

```text
reversible
commit
financial
destructive
security
unknown
```

Only `reversible` candidates may be automatically executed.

Button text alone never determines safety.

```text
"Submit" may be reversible intermediate workflow progress
"Continue" may theoretically cause a consequential transition
```

Semantics and consequence classification decide.

---

## 16. Workflow graph accumulation

A rendered page may contain multiple semantic entities, and local interactions may create relationships without leaving the page.

When a reversible action changes the structural root/route/context, LeMap-Web records a workflow transition:

```text
Entity / Context A
   -- action -->
Entity / Context B
```

Across executions this accumulates into workflow stages and branches.

```text
Workflow
├─ Step 1
│  ├─ Entity A
│  └─ Conditional Entity B
├─ Step 2
│  ├─ Entity C
│  └─ Entity D
└─ Step 3
```

The result is simultaneously:

```text
shared entity/relationship graph
+
workflow graph across execution stages
```

Only transitions actually traversed or otherwise deterministically proven become workflow edges.

---

## 17. Information-need planner

After semantic interpretation and interaction reconciliation, the information planner receives only unresolved **goal-relevant** interaction questions.

It chooses:

```text
ask_user
navigate
stop
```

It does not ask for every empty field and does not request speculative browser probing.

`ask_user` means a genuinely required business/user fact is missing.

`navigate` means current state is sufficient to score outgoing workflow actions.

`stop` explicitly carries:

```text
goalComplete = true
```

only when the model concludes that the original user goal has been completed.

A blocked/unsafe stop has `goalComplete = false`.

---

## 18. Completion

Completion is not inferred solely from a lack of buttons.

LeMap-Web uses both structural and semantic evidence.

```text
structural evidence
  no unresolved executable required interaction
  no safe forward transition needed/available

semantic evidence
  information planner says stop
  goalComplete = true
```

The loop continues through real interactions and workflow transitions until the model semantically identifies completion or the system cannot safely advance.

---

## 19. Persistent memory

Persistent semantic memory may contain:

```text
application/global controls
semantic entities / sub-entities
field meanings
relationships
interaction semantics
action roles
behavior hypotheses
observed behavior classes
structural novelty evidence
workflow nodes / edges
coverage / confidence / provenance
```

The map is expected to remain partial.

```text
known
partial
unexplored
stale
known absent
```

The governing rule is:

> **Reuse when knowledge is sufficient. Learn when execution reveals missing structure or meaning.**

---

## 20. Token discipline

The expensive semantic call is made at meaningful structural boundaries, not after every value change.

Preferred pattern:

```text
new structural context
→ one semantic page/entity interpretation
→ persist interaction plan + action roles + hypotheses

real user execution
→ deterministic delta

known/no external behavior
→ local continuation, no semantic call

novel external structure
→ one semantic refresh
```

Prompts contain compact typed evidence rather than raw DOM or full conversation history.

---

## 21. Core versus instance memory

Semantic templates and user/workflow instances remain separate.

```text
EntityTemplate
  semantic meaning
  structural bindings
  relationships
  interactions
  action roles
  behavior classes

Entity/Workflow Instance
  actual value
  source
  scope
  confirmation state
  workflow instance
```

This enables later runs to reuse both application understanding and applicable user state without contaminating reusable semantics with personal values.

---

## 22. End-to-end invariant

The complete LeMap-Web loop is:

```text
Observe structure
→ ask the model what the structure means and where goal-relevant interaction begins
→ resolve the next required interaction
→ execute it for real
→ observe the external structural effect
→ reuse a known behavior class or learn structural novelty
→ build/extend entity relationships
→ classify workflow actions
→ navigate a reversible goal-directed transition
→ record the workflow step
→ repeat on the next context
→ stop when semantic evidence says the original goal is complete
```

The final invariant is:

> **LeMap-Web incrementally builds an application semantic graph and workflow graph by reading UI structure deterministically, using the model to assign meaning and interaction priority, learning behavior only from real goal-directed execution traces, and invoking semantic interpretation again only when execution reveals new structural behavior.**
