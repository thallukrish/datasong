# LeMap-Web Input Preprocessing

## Status

This document defines the deterministic preprocessing layer that sits between browser instrumentation and semantic learning in LeMap-Web.

The preprocessor does **not** decide what an entity, relationship, action or workflow means to the business/user. Its job is to discover structural identity, fields, relationships, action space, execution evidence, state changes and transitions in a normalized representation that can later be interpreted by the model.

The governing rule remains:

> **If the browser can observe or prove it, deterministic preprocessing owns it. The model interprets meaning only after the structural and behavioral evidence is assembled.**

---

## 1. Core model: shared entity graph + workflow graph

LeMap-Web models the web application as a **shared entity graph**.

A rendered page is not a semantic primitive. It is only a human-friendly flattening/projection of part of that entity graph.

The structural model is therefore:

```text
Web Application
  ↓
Shared Entity Graph
  Entity
    fields[]
    relationships[]
    actions/methods[]
    states[]
    presentation evidence

  Entity
    ...

  ↓ traversed/mutated by

Workflow Graph
  steps
  branches
  merges
  action paths
  completion conditions
```

A workflow is an ordered/branching sequence of actions over the shared entity graph that produces an end-to-end change in entity state.

Example:

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

The browser pages crossed while this happens are presentation/navigation evidence, not the semantic workflow itself.

---

## 2. Architectural analogy with LeMap

This intentionally mirrors the existing LeMap architecture.

```text
LeMap code side

Entity graph
  fields
  relationships

Functions/services/actions
  operate on entities

Workflow
  branch-and-merge path of operations
  producing business state changes

Source files/classes
  implementation containers
```

```text
LeMap-Web

Entity graph
  fields derived from forms/content
  relationships within/across rendered surfaces

Clicks/events/methods
  operate on entities

Workflow
  branch-and-merge path of actions
  producing business state changes

Pages/DOM
  presentation containers
```

The acquisition mechanism differs, but after preprocessing the semantic-learning problem should look very similar to normal LeMap.

---

## 3. Entity representation

Every structurally coherent object discovered by the explorer can be represented as an entity.

```text
Entity
  id
  fields[]
  relationships[]
  actions[]
  state
  presentationEvidence[]
```

A page-level entity is simply an entity whose presentation evidence includes the current logical page/screen identity.

Example:

```text
Entity: FilingStatus

fields
  filingReason
  condition1
  condition2
  condition3
  condition4

actions
  selectFilingReason()
  toggleCondition()
  continue()

presentationEvidence
  pageId
  route
  title
  root DOM identity
```

The semantic graph should not depend on the page boundary.

A rendered page may expose:

```text
one entity
multiple related entities
a repeated entity collection
an entity also exposed elsewhere in the application
```

The page merely flattens these entities into one visual surface for human use.

---

## 4. Fields

Fields are observable state-bearing attributes of an entity.

Examples include:

```text
labelled form inputs
radio/checkbox selections
select values
text/number/date values
visible content values
validation/completion state
availability flags where structurally meaningful
```

A field retains presentation evidence so the browser can locate and operate on it.

```text
Field
  id
  entityId
  label
  normalizedType
  currentValue
  valueDomain
  required
  disabled
  visible
  readonly
  checked
  presentationEvidence
    pageId
    domId
    name
    role
    tag
    regionPath
    attributes
```

For radios and checkboxes, option identity and state remain separate:

```text
value = "Y"      // identity of the option
checked = true    // current state
```

---

## 5. Entity relationships

Relationships are not constrained by DOM containment or page boundaries.

They may connect:

```text
entities within the same rendered page
entities introduced by inline expansion
entities opened in a modal/drawer
entities exposed on another page
entities that share or influence state
```

Deterministically observed relationship types may include:

```text
contains
references
enables
disables
shows
hides
requires
excludes
gates
activates
changes
derives
influences
navigates_to
```

Examples:

```text
FilingStatus
  → contains QualifyingConditions

Reason B
  → enables QualifyingConditions

QualifyingConditions empty
  → gates Continue

Income
  → influences TaxComputation
```

The browser structure supplies evidence; the model later gives the relationship semantic meaning.

---

## 6. Central structural primitive

The central deterministic primitive is:

```text
ENTITY / FIELD
+ ACTION
→ EXECUTION TRACE
→ SHARED ENTITY STATE DELTA
```

The consequence comparison is not limited to the acted-on field, its group or its DOM region.

After an action, LeMap-Web compares all relevant known entity state that is observable from the current application context.

Example:

```text
FilingStatus.selectReason(Y)

Execution trace:
  change event
  → component handler
  → validation/update functions

Observed entity-state delta:
  FilingStatus.filingReason: N → Y
  QualifyingConditions.enabled: false → true
  Continue.available: true → false
```

The affected objects can live anywhere in the rendered DOM.

---

## 7. Actions and methods

Every interactable entity/field may expose user-equivalent actions.

```text
Action
  id
  sourceEntityId
  sourceFieldId
  kind
  value
  safety
  purpose
```

Example kinds:

```text
select
toggle
type
clear
choose_option
open_picker
choose_date
select_suggestion
click
submit
```

Actions describe user-equivalent interaction rather than framework-specific implementation.

The eventual semantic layer may interpret repeated structural actions as entity methods such as:

```text
selectFilingReason()
addBankAccount()
validateAddress()
submitReturn()
```

but the preprocessor first records the observed action and evidence without inventing business semantics.

---

## 8. Type-specific scanners

Each normalized field/input type has a small scanner responsible for generating and executing safe, meaningful actions for that type.

```text
inputScanners/
  radioScanner.js
  checkboxScanner.js
  textScanner.js
  numberScanner.js
  dateScanner.js
  selectScanner.js
  autocompleteScanner.js
  buttonScanner.js
  fileScanner.js
  compositeScanner.js
```

The scanner contract is:

```text
Field + current entity/application state
→ candidate Action[]
```

and, when execution is enabled:

```text
Action
→ raw browser evidence
```

The scanners must not own persistence, semantic interpretation or workflow construction.

### Radio

- select each option
- observe exclusivity
- observe graph-wide downstream state changes

### Checkbox

- toggle individually
- test representative group combinations
- observe whether multiple values remain selected

### Text / Number / Date

- inspect structural constraints
- use safe representative values
- use boundary/invalid probes where safe
- observe validations and downstream changes

### Select / Autocomplete

- enumerate/select representative options
- observe dependent fields/entities/options
- capture network evidence for dynamic suggestions

### Button / action

- record visible/enabled/disabled state
- invoke only when exploration policy marks the action safe

### File

- discover structurally
- do not automatically upload unless an explicit safe fixture/policy allows it

---

## 9. Execution trace

For every attempted action, instrumentation should collect structural execution evidence.

```text
ExecutionTrace
  browserEvents[]
  functions[]
  network[]
  callbacks[]
  consoleSignals[]
```

The trace can include:

```text
DOM event
→ handler
→ function calls
→ request
→ response
→ callback
→ application-state update
→ render/state change
```

This is the HOW evidence.

The entity state delta is the WHAT evidence.

Function-call reconstruction may later adapt the current LeMap executable/call-path machinery so the model can interpret web actions and code execution using a common structure.

---

## 10. Entity-state delta

After every action, LeMap-Web compares relevant known state before and after.

The normalized delta can include:

```text
fieldValuesChanged[]
fieldsEnabled[]
fieldsDisabled[]
fieldsShown[]
fieldsHidden[]
fieldsAdded[]
fieldsRemoved[]
entitiesAdded[]
entitiesRemoved[]
entitiesShown[]
entitiesHidden[]
actionsEnabled[]
actionsDisabled[]
actionsShown[]
actionsHidden[]
validationMessagesAdded[]
validationMessagesRemoved[]
optionsAdded[]
optionsRemoved[]
relationshipsAdded[]
relationshipsRemoved[]
presentationChanged
navigationChanged
```

A single source action may affect many entities.

Example:

```text
Income.update(...)
  ↓
Income.total changes
TaxComputation.taxableIncome changes
Summary.totalIncome changes
```

The preprocessor should preserve all observable effects as one causally connected observation where possible.

---

## 11. Normalized observation

All scanners/executors produce the same normalized evidence object:

```text
ActionObservation
  id
  sourceEntityId
  sourceFieldId
  beforeStateId
  action
  executionTrace
  affectedEntities[]
  result
  afterStateId
```

This is the durable deterministic substrate consumed by later relationship and workflow construction.

---

## 12. Explorer-driven graph expansion

The explorer expands the shared entity graph by acting on reachable controls/links/actions.

An action can produce several structural outcomes:

```text
state_change
inline_expand
overlay_open
navigation
```

All of them may introduce new entities, fields or relationships.

### Inline expansion

Example:

```text
select "Other"
  ↓
"Please specify" field appears
```

This normally enriches the current entity/action branch.

### Modal / drawer / overlay

Example:

```text
Add Bank Account
  ↓
Bank Account editor opens in modal
```

The modal can expose a related entity:

```text
PersonalDetails
  → contains/references BankAccount
```

It is not automatically promoted to a separate workflow merely because it renders as an overlay.

### Navigation

Example:

```text
FilingStatus.continue()
  ↓
PersonalDetails entity becomes the primary rendered context
```

Navigation is strong structural evidence of a broader workflow-step transition.

---

## 13. Entity transitions

Every explorer action can be normalized as an entity transition:

```text
EntityTransition
  sourceEntity
  action
  affectedEntities[]
  targetEntity / newlyReachableEntities[]
  transitionKind
    state_change
    inline_expand
    overlay_open
    navigation
  executionTrace
  resultingStateDelta
```

This representation separates **what changed in the entity graph** from **how the workflow graph should be expanded**.

---

## 14. Workflow construction

The workflow graph is built from entity/action transitions.

A workflow does not own the data. It operates over the shared entity graph.

```text
Workflow
  entry condition
  steps[]
  branches[]
  merges[]
  action/entity path
  completion condition
  resulting entity-state changes
```

A useful provisional construction rule is:

```text
state_change / inline_expand / overlay_open
  → usually enrich the current workflow step/branch

navigation
  → usually introduces or advances to a new workflow step
```

These are structural defaults, not final semantic judgments.

The model can later merge/split steps based on business meaning.

Example:

```text
Workflow: File ITR-3

Step 1
  FilingStatus
    ├─ branch A: reason N
    └─ branch B: reason Y
         └─ QualifyingConditions interaction

Step 2
  PersonalDetails

Step 3
  Income
    ├─ branch: Capital Gains
    └─ branch: Business Income

Step 4
  Tax Computation

Step 5
  Verification
```

This is analogous to broad executable arcs in LeMap, with lower-level action/entity branches nested within them.

---

## 15. Re-visiting previously rendered entities

A previously seen entity must never be assumed to have the same state when it is encountered again.

An action later in the workflow can mutate shared application/business state that changes an earlier entity when it is rendered again.

Example:

```text
Entity A rendered with state S0
  ↓
workflow continues
  ↓
Action on Entity C mutates shared state
  ↓
Entity A is rendered again
  ↓
Entity A now has state S1
```

This should be represented as:

```text
Action on Entity C
  → influences Entity A
```

rather than as a special concept such as "Page 3 changed Page 1".

Navigation and state influence are separate relationships:

```text
navigation edge
  C → A

state influence edge
  C.someAction → A.someField
```

Execution/network evidence can help prove shared underlying state, for example:

```text
Entity C
  POST /return/update-status

Entity A on revisit
  GET /return/status
```

---

## 16. Presentation evidence

Although page is removed from the semantic model, browser presentation metadata remains necessary for acquisition and provenance.

Each entity/field may retain:

```text
pageId
url/route
title
root DOM fingerprint
DOM id/name/role/tag
region path
visibility
framework-specific locators where stable
```

This metadata answers:

```text
Where/how did the browser observe this entity or field?
```

It does not answer:

```text
What does this entity mean to the business?
```

That distinction is important.

---

## 17. Semantic annotation strategy

Once deterministic preprocessing has produced the entity graph and workflow graph, the model builds the semantic graph.

The model is not asked to rediscover structure from raw DOM.

It receives grounded evidence such as:

```text
entities
fields
relationships
actions
state transitions
execution traces
workflow branches
merges
entry/completion evidence
```

### Entity-level semantic annotation

The model annotates:

```text
business entity meaning
field meaning
relationship meaning
business/legal constraints
semantic method/action meaning
```

Example deterministic evidence:

```text
Reason B selected
  → QualifyingConditions enabled
  → Continue unavailable

Condition 1 selected
  → Continue available
```

Possible semantic annotation:

```text
Selecting the Seventh Proviso filing reason requires at least one qualifying condition.
```

### Workflow-level semantic annotation

The model walks bounded workflow branches and annotates:

```text
workflow/business intent
step purpose
branch meaning
completion condition
business outcome
```

This should resemble LeMap Scout / Pass 1 / Pass 2 operating over executable paths.

---

## 18. Generic module boundary

Current code is still partly page-named because implementation preceded this conceptual cleanup. The semantic architecture should move toward entity terminology without forcing a large refactor before behavior is proven.

Current/target preprocessing areas:

```text
lemap-web/src/preprocess/
  pageIdentity.js            # presentation identity evidence
  activeWorkflow.js          # active rendered acquisition scope
  inputDiscovery.js          # field discovery
  inputClassifier.js
  groupDiscovery.js
  hierarchy.js
  action.js
  observation.js
  stateProjection.js
  stateDelta.js
  pagePreprocessor.js        # candidate for later entity-oriented rename
  scanners/*
```

Future logical layers:

```text
entity/
  entityDiscovery
  fieldDiscovery
  relationshipDiscovery
  entityState
  entityTransition

workflow/
  workflowGraph
  branchDiscovery
  stepCompression

trace/
  eventTracer
  functionTracer
  networkTracer
  domMutationTracer
```

Browser instrumentation remains separate from semantic interpretation.

---

## 19. Generic testing strategy

The deterministic preprocessor must be testable independently of any specific production website.

The synthetic benchmark should contain known behaviors such as:

```text
radio group
  B enables checkbox entity/group

checkbox group
  one-or-more gates Continue

date field
  format validation

number field
  min/max validation

autocomplete
  fake async suggestions/network evidence

select
  changes dependent options/entities

inline expansion
  reveals additional field/entity

modal
  exposes related entity

navigation
  exposes another entity/workflow step

revisit
  previously seen entity renders different state after downstream action
```

Tests can assert discovery of:

- entity/field identity
- field type
- grouping
- action space
- graph-wide state delta
- checked-state transitions
- validation changes
- inline/modal expansion
- navigation transitions
- cross-entity state influence
- workflow branching/merging evidence
- network/trace evidence shape
- normalized observation schema

The Income Tax ITR-3 site remains the real-world stress test, not the primitive unit-test environment.

---

## 20. Non-goals of preprocessing

The deterministic preprocessing stage does not itself:

- infer business meaning
- decide final business-entity boundaries
- decide final workflow-step semantics
- decide which function calls are meaningful business steps
- generate final natural-language workflow descriptions
- autonomously submit/complete sensitive production workflows without explicit policy
- persist the final semantic WebMap

Those belong to later semantic/workflow layers.

---

## 21. Architecture summary

```text
BROWSER / APPLICATION
   ↓
PRESENTATION EVIDENCE
   ↓
FIELD / ENTITY DISCOVERY
   ↓
TYPE-SPECIFIC EXPLORATION
   ↓
ENTITY + ACTION
   ↓
EVENT / FUNCTION / NETWORK TRACE
   ↓
SHARED ENTITY STATE DELTA
   ↓
ENTITY RELATIONSHIPS / TRANSITIONS
   ↓
SHARED ENTITY GRAPH
   ↓
WORKFLOW GRAPH
   branches / merges / steps / completion
   ↓
SEMANTIC LEARNING
   entity semantics
   relationship semantics
   workflow semantics
```

The key invariants are:

> **The page is presentation evidence, not a semantic primitive.**

> **Explorer actions expand the entity graph; transition scope determines how they provisionally expand the workflow graph.**

> **Workflows operate over shared entity state to accomplish end-to-end business change.**

> **Deterministic code proves structure and behavior; the model builds the semantic graph from that grounded evidence.**
