# LeMap-Web Input Preprocessing

## Status

This document defines the deterministic preprocessing layer that sits between browser instrumentation and semantic learning in LeMap-Web.

The preprocessor does **not** decide what a page, input or workflow means to the business/user. Its job is to discover structural identity, hierarchy, input types, action space, execution evidence, state changes and page-to-page transitions in a normalized representation that can later be interpreted by the model.

The governing rule remains:

> **If the browser can observe or prove it, deterministic preprocessing owns it. The model interprets meaning only after the structural and behavioral evidence is assembled.**

---

## 1. Core terminology

LeMap-Web uses two different structural levels and they should not be conflated.

### Workflow

A **Workflow** is the higher-level graph that connects pages in order to accomplish something.

Example:

```text
ITR-3 Filing
  Filing Status
    ├─ branch A → Personal Information
    └─ branch B → Additional Filing Conditions

  Personal Information
    → Income Details
    → Tax Details
    → Verification
```

The pages traversed may differ depending on prior inputs. Therefore the workflow is not assumed to be a fixed sequence; it is a branch-and-merge graph, similar to executable call paths in LeMap.

### PageIO

A **PageIO** is the structured I/O object represented by one logical page or application screen.

It contains:

```text
PageIO
  identity
  input objects[]
  input groups[]
  output/action objects[]
  nested IO regions[]
  relationships[]
  state
  execution evidence[]
```

A PageIO is not itself called a workflow.

Its job is to expose what can be supplied to the page, what can be acted on, what state changes those actions cause, and what outputs/navigation can result.

The resulting architecture mirrors LeMap conceptually:

```text
Within a page:
  I/O objects ↔ relationships

Across pages:
  Workflow graph of PageIO nodes and transition edges
```

---

## 2. Architectural analogy with LeMap

LeMap already separates entity relationships from executable/business workflow structure.

LeMap-Web follows the same separation:

```text
LeMap
  Entity
    ↕ relationships
  Workflow
    → functions/services/entities

LeMap-Web
  PageIO
    ↕ input/output relationships
  Workflow
    → PageIO transitions
```

The browser preprocessor therefore learns two deterministic substrates:

1. **PageIO structure and behavior** within one page.
2. **Page transition graph** across pages.

The semantic model can later annotate both layers independently.

At the workflow level it can interpret:

```text
business intent
step purpose
branch meaning
completion condition
```

At the PageIO level it can interpret:

```text
what each input means
what each group represents
what dependencies mean
what business/legal rule appears to be enforced
```

---

## 3. Central structural primitive inside a PageIO

The central primitive of page preprocessing is:

```text
INPUT
+ ACTION
→ EXECUTION TRACE
→ RESULTING PAGE STATE DELTA
```

The input type determines which actions are meaningful to try. The observation/result format is shared across all input types.

The resulting comparison is **page-wide**, not limited to the input's local DOM group.

Example:

```text
Input: Filing reason / radio option B
Action: select

Execution trace:
  change event
  → component handler
  → validation/update functions

Result anywhere in the active PageIO:
  radio A unchecked
  radio B checked
  checkbox group becomes enabled
  Continue becomes unavailable
```

The fact that `Continue` is not in the same DOM group as the radio does not matter. It is still part of the same PageIO state delta.

The preprocessor records these changes without deciding their tax/business meaning.

---

## 4. PageIO identity

Every discovered input and observation belongs to a stable PageIO identity.

URL alone is insufficient because SPAs can reuse a route for materially different logical screens, and the same logical PageIO may experience many internal states.

`PageIdentity` contains:

```text
id
url
route
origin
title
mainLabel
stableRoot
structuralFingerprint
```

The identifier should be deterministic for the same logical page while avoiding volatile generated IDs, timestamps and cosmetic markup.

Important distinction:

```text
PageIO identity
  = stable logical screen

PageIO state
  = current values, visibility, enabled/disabled state,
    validations, dynamic regions and available actions
```

One PageIO may therefore have many states.

---

## 5. Input and output objects

A PageIO contains controllable I/O objects.

### InputObject

```text
InputObject
  id
  pageId
  domId
  name
  label
  type
  role
  tag
  parentRegionId
  parentGroupId
  required
  disabled
  visible
  readonly
  checked
  placeholder
  value
  valueDomain
  attributes
```

`type` is the normalized behavioral type, not merely the raw HTML tag/type.

Examples:

```text
radio
checkbox
text
number
date
select
autocomplete
file
composite
unknown
```

For radios and checkboxes, option identity and current state are distinct:

```text
value = "Y"      // identity of this option
checked = true    // current state
```

This avoids confusing the static HTML value with whether the option is actually selected.

### Output / ActionObject

Buttons and similar controls are modeled as output/action objects rather than ordinary value-bearing inputs.

Examples:

```text
Continue
Back
Save
Submit
Add
Cancel
Open
```

Their visible/enabled/disabled state is part of the PageIO state and may change as a consequence of actions elsewhere on the page.

---

## 6. Input groups

Grouping must be preserved instead of flattening controls.

Sources of deterministic grouping evidence include:

- same native radio `name`
- `fieldset` / `legend`
- ARIA radiogroup/listbox/group roles
- common labelled container
- repeated checkbox cluster under one label
- framework component wrapper

Normalized group:

```text
InputGroup
  id
  pageId
  label
  groupType
  memberInputIds[]
  parentRegionId
  initialState
  discoveredConstraints[]
```

Examples of constraints that may later be inferred from experiments:

```text
exactly_one
zero_or_one
one_or_more
zero_or_more
mutually_exclusive
required_when
active_when
```

These are behavioral discoveries, not assumptions from textual semantics.

---

## 7. Relationships within a PageIO

The PageIO preprocessor builds evidence for relationships among inputs, groups, regions and actions.

Examples:

```text
enables
disables
shows
hides
requires
excludes
changes
derives
gates
activates
```

For example:

```text
Reason B
  → enables Qualifying Conditions group

Qualifying Conditions empty
  → Continue unavailable

One or more conditions selected
  → Continue available
```

These relationships may connect objects in different DOM regions. The comparison scope is the entire active PageIO state.

Locality is retained as structural evidence through the objects' region paths, but locality does not limit consequence detection.

---

## 8. Nested I/O regions, inline additions and modals

Not every newly introduced UI surface becomes a workflow.

Dynamic structures inside a page are represented first as **nested I/O regions** under the current PageIO.

Examples:

```text
conditional inline section
modal
side drawer
popover
expanded editor
embedded form panel
```

Example:

```text
PageIO: Personal Information
  Add Bank Account action
    ↓
  Nested IO Region: Bank Account Modal
    account number
    IFSC
    validate
    Save / Cancel
```

The modal is still structurally part of the current PageIO unless its interaction causes a logical page/navigation transition that participates in the higher-level workflow graph.

Similarly:

```text
select Other
  → "Please specify" input appears
```

is merely a state expansion inside the same PageIO.

The preprocessor should therefore discover:

```text
regions
inputs
groups
actions
states
relationships
containment
```

without prematurely labeling every dynamic region as a workflow.

---

## 9. Type-specific scanners

Each normalized input type has a small scanner module responsible only for generating and executing safe, meaningful actions for that type.

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

The scanners must not own persistence, semantic interpretation or workflow construction.

Their contract is:

```text
InputObject + current PageIO state
→ candidate Action[]
```

and, when browser execution is enabled:

```text
Action
→ raw browser evidence
```

All raw evidence is normalized by the common observation layer.

### Radio

- select each option
- observe exclusivity
- observe downstream page-wide state changes

### Checkbox

- toggle individually
- for a group, test representative combinations
- observe whether multiple members remain selected

### Text

- empty input where safe
- representative text
- invalid/boundary input where safe
- inspect maxlength/pattern/placeholder evidence

### Number

- representative value
- boundary values inferred from HTML attributes
- invalid type/range where safe

### Date

- inspect input type, placeholder and format hint
- valid representative date
- invalid format where safe
- invalid calendar date where safe

### Select

- enumerate available options
- select representative alternatives
- observe dependent controls/options

### Autocomplete

- type a safe prefix
- observe suggestion region creation/update
- capture network request/response evidence
- select a suggestion
- observe resulting value/state

### Button / action

Buttons are actions rather than value-bearing inputs. Their enabled/disabled/visible state is recorded and they are invoked only when the exploration policy marks the action safe.

### File

File controls are discovered structurally. Automatic upload probing is disabled by default and requires an explicit safe fixture.

---

## 10. Action representation

Every scanner emits normalized actions.

```text
Action
  id
  inputId
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
```

Actions describe user-equivalent interaction rather than framework-specific implementation.

---

## 11. Execution trace

For each attempted action, instrumentation should collect structural execution evidence.

```text
ExecutionTrace
  browserEvents[]
  functions[]
  network[]
  callbacks[]
  consoleSignals[]
```

Function-call reconstruction may later copy/adapt concepts from the current LeMap executable/call-path machinery. The preprocessing contract is defined now so richer tracing can be plugged in without changing the normalized observation model.

The trace can include:

```text
DOM event
→ handler
→ function calls
→ request
→ response
→ callback
→ framework/application state update
```

The preprocessor stores raw/proven structural evidence. The model later decides which calls constitute meaningful semantic steps.

---

## 12. PageIO state delta

A result is not limited to the acted-on object's local region.

After every action, LeMap-Web compares the complete active PageIO state before and after and records changes including:

```text
inputValuesChanged[]
inputsEnabled[]
inputsDisabled[]
inputsShown[]
inputsHidden[]
inputsAdded[]
inputsRemoved[]
groupsChanged[]
regionsShown[]
regionsHidden[]
actionsEnabled[]
actionsDisabled[]
actionsShown[]
actionsHidden[]
validationMessagesAdded[]
validationMessagesRemoved[]
optionsAdded[]
optionsRemoved[]
routeChanged
pageChanged
```

This is how an action on one region can deterministically establish a relationship with an object elsewhere on the page.

Example:

```text
radio Y selected
  ↓
radio N checked true → false
radio Y checked false → true
checkbox group disabled true → false
Continue visible true → false
```

The whole result belongs to one observation.

---

## 13. Normalized observation

All scanners return the same normalized evidence object:

```text
InputObservation
  id
  pageId
  inputId
  groupId
  beforeStateId
  action
  executionTrace
  result
  afterStateId
```

This is the durable output of deterministic PageIO preprocessing.

The model is deliberately downstream of this representation.

---

## 14. PageIO state graph

The preprocessor accumulates normalized observations into a page-local state graph.

```text
PageIO State S0
  -- Input A / Action X -->
PageIO State S1
  -- Input B / Action Y -->
PageIO State S2
```

State identity is structural and should ignore irrelevant cosmetic changes while preserving meaningful input/group/validation/visibility/action differences.

This state graph describes **how one PageIO behaves**.

It is not the business workflow graph.

---

## 15. Cross-page workflow graph

The higher-level workflow is constructed from observed transitions among PageIO nodes.

```text
Workflow
  nodes = PageIO objects
  edges = page transitions
  branch conditions = observed source PageIO state/input conditions
```

Example:

```text
PageIO A: Filing Status
  -- condition X --> PageIO B
  -- condition Y --> PageIO C

PageIO B
  --> PageIO D

PageIO C
  --> PageIO D
```

This is analogous to the branch-and-merge executable path graph already used in LeMap.

A transition edge should retain evidence such as:

```text
source PageIO
source state
trigger action
execution trace
navigation/route evidence
result PageIO
```

The same destination page may therefore be reached through multiple branches, and some pages may be skipped entirely depending on prior inputs.

---

## 16. Semantic annotation strategy

Once deterministic preprocessing has produced enough evidence, semantic interpretation can occur at two levels.

### Workflow-level annotation

Provide the model with bounded page-flow branches such as:

```text
Filing Status
→ Personal Information
→ Income Details
→ Taxes Paid
→ Verification
```

along with branch conditions and execution evidence.

The model annotates:

```text
workflow/business intent
step purpose
branch meaning
completion condition
business outcome
```

This is similar to LeMap interpreting bounded executable call paths.

### PageIO-level annotation

For one PageIO, provide:

```text
inputs
groups
relationships
behavior observations
validation evidence
execution traces
```

The model annotates:

```text
semantic meaning of each I/O object
semantic meaning of groups
meaning of dependencies
business/legal rules represented by observed behavior
```

The deterministic graph remains provenance for those interpretations.

---

## 17. Generic module boundary

Current/target implementation layout:

```text
lemap-web/src/preprocess/
  pageIdentity.js
  activeWorkflow.js
  inputDiscovery.js
  inputClassifier.js
  groupDiscovery.js
  hierarchy.js
  action.js
  observation.js
  stateProjection.js
  stateDelta.js
  pagePreprocessor.js
  scanners/
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
    registry.js
```

Browser instrumentation remains separate:

```text
browserCapture.js
trace/*
```

Higher-level page transition indexing/workflow construction should also remain separate from PageIO preprocessing.

Semantic interpretation remains separate again.

---

## 18. Generic testing strategy

The PageIO preprocessor must be testable independently of any specific production website.

LeMap-Web therefore maintains a synthetic benchmark page containing known behavior:

```text
radio group
  B enables checkbox group

checkbox group
  one-or-more gates Continue

date field
  format validation

number field
  min/max validation

autocomplete
  fake async city suggestions

select
  changes dependent select options

text
  maxlength/pattern validation

completion action
  changes with page validity
```

Because the ground truth is known, tests can assert whether preprocessing discovered:

- PageIO identity
- input type
- group membership
- candidate action space
- page-wide state delta
- checked-state transitions
- validation output
- async suggestion/output changes
- network evidence shape
- normalized observation schema
- application-shell exclusion from the active PageIO

A multi-page synthetic benchmark should later test:

- page transitions
- branch conditions
- skipped pages
- branch merges
- nested modal/inline IO regions

The Income Tax ITR-3 site is a real-world stress test, not the primitive unit-test environment.

---

## 19. Non-goals of this stage

This preprocessing stage does not yet:

- infer business meaning
- decide which function calls are meaningful business steps
- label every page transition semantically
- autonomously complete a production workflow
- persist final semantic WebMap workflows
- refactor or share implementation with `demo_v2`

Those layers come after the deterministic PageIO and page-transition representations are proven.

---

## 20. Architecture summary

```text
WEB APPLICATION
   ↓
DISCOVER PageIO
   ↓
PAGE IDENTITY + ACTIVE IO REGION
   ↓
INPUT / OUTPUT / GROUP HIERARCHY
   ↓
INPUT TYPE CLASSIFICATION
   ↓
TYPE-SPECIFIC SCANNER
   ↓
ACTION
   ↓
EVENT / FUNCTION / NETWORK TRACE
   ↓
GLOBAL PageIO BEFORE/AFTER STATE DELTA
   ↓
INPUT OBSERVATION
   ↓
RELATIONSHIP / BEHAVIORAL CONSTRAINT DISCOVERY
   ↓
PageIO STATE GRAPH
   ↓
OBSERVED PAGE TRANSITION
   ↓
CROSS-PAGE WORKFLOW GRAPH
   ↓
SEMANTIC ANNOTATION (later)
```

The invariant to preserve is:

> **Within a page, learn I/O objects and their relationships. Across pages, learn the branching workflow graph that stitches PageIO nodes together to accomplish a goal.**
