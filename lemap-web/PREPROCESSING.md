# LeMap-Web Input Preprocessing

## Status

This document defines the deterministic preprocessing layer that sits between browser instrumentation and semantic learning in LeMap-Web.

The preprocessor does **not** decide what a page or input means to the business/user. Its job is to discover the structural identity, hierarchy, input types, action space, execution evidence and resulting state changes of a page in a normalized representation that can later be interpreted by the model.

The governing rule remains:

> **If the browser can observe or prove it, deterministic preprocessing owns it. The model interprets meaning only after the behavioral evidence is assembled.**

---

## 1. Page is the workflow boundary

LeMap-Web does not treat each radio button, checkbox or text field as a separate workflow.

The **page is the workflow container**. Inputs and input groups are the controllable elements whose behavior determines the page's state graph.

```text
Page Workflow
  ├─ labelled region / section
  │   ├─ input group
  │   │   ├─ input
  │   │   └─ input
  │   └─ input
  ├─ labelled region / section
  └─ completion actions
```

A page workflow is learned by observing how actions on its inputs transform the page state.

---

## 2. Central structural primitive

The central primitive of preprocessing is:

```text
INPUT
+ ACTION
→ EXECUTION TRACE
→ RESULTING STATE DELTA
```

The input type determines which actions are meaningful to try. The observation/result format is shared across all input types.

Example:

```text
Input: Filing reason / radio option B
Action: select

Execution trace:
  change event
  → component handler
  → validation/update functions

Result:
  checkbox group becomes enabled
  Continue becomes unavailable
```

The preprocessor records this without deciding the tax/business meaning of the rule.

---

## 3. Page identity

Every discovered input and observation belongs to a stable page identity.

URL alone is insufficient because SPAs can reuse a route for materially different states.

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

The identifier should be deterministic for the same structural page while avoiding volatile generated IDs, timestamps and cosmetic markup.

Inputs are namespaced under the page identity.

---

## 4. Input identity

An input is represented by structural identity plus observable attributes.

```text
Input
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
  placeholder
  value
  valueDomain
  attributes
```

`type` is the normalized behavioral type, not merely the raw HTML tag/type. Examples:

```text
radio
checkbox
text
number
date
select
autocomplete
file
button
composite
unknown
```

The classifier may use tag/type/role/ARIA metadata, associated labels and DOM structure, but should not require semantic interpretation.

---

## 5. Input groups

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

These are behavioral discoveries, not assumptions from the text label.

---

## 6. Type-specific scanners

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

The scanners must not own persistence, semantic interpretation or page-level graph construction.

Their contract is:

```text
Input + current state
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
- observe downstream state changes

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

### Button

Buttons are actions rather than value-bearing inputs. The scanner records enabled/disabled/visible state and only invokes buttons when the exploration policy marks the action safe.

### File

File controls are discovered structurally. Automatic upload probing is disabled by default and requires an explicit safe fixture.

---

## 7. Action representation

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

Actions should describe user-equivalent interaction rather than framework-specific implementation.

---

## 8. Execution trace

For each attempted action, instrumentation should collect structural execution evidence.

```text
ExecutionTrace
  browserEvents[]
  functions[]
  network[]
  callbacks[]
  consoleSignals[]
```

Function-call reconstruction may later reuse/copied concepts from the current LeMap executable/call-path machinery. The preprocessing contract is defined now so that richer tracing can be plugged in without changing the normalized observation model.

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

The preprocessor stores raw/proven structural evidence. The model later decides which calls constitute meaningful steps.

---

## 9. Result/state delta

A result is not limited to the acted-on input's value.

After every action, LeMap-Web compares page state before and after and records changes including:

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

This covers in-place page transitions as well as navigation.

Example autocomplete:

```text
City input
+ type "ban"
→ input event
→ debounce/search function
→ GET /cities?q=ban
→ response
→ suggestion list appears
```

The suggestion list is a state change and becomes part of the observation.

---

## 10. Normalized observation

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

This is the durable output of preprocessing.

The model is deliberately downstream of this representation.

---

## 11. Behavioral rule discovery

Rules are inferred from repeated structural observations.

Example observations:

```text
A selected
→ Continue enabled

B selected
→ checkbox group enabled
→ Continue disabled

B + b1 selected
→ Continue enabled
```

The deterministic behavioral layer can propose:

```text
B activates group G
G gates Continue while empty
```

A later semantic model can interpret that as a user-facing rule such as:

```text
Selecting filing reason B requires at least one qualifying condition.
```

The semantic phrasing is not part of preprocessing.

---

## 12. Page state graph

The preprocessor accumulates normalized observations into a page-local state graph.

```text
PageState S0
  -- Input A / Action X -->
PageState S1
  -- Input B / Action Y -->
PageState S2
```

State identity is structural and should ignore irrelevant cosmetic changes while preserving meaningful input/group/validation/visibility/completion differences.

The page state graph is the deterministic substrate later given to Scout/Pass 1/Pass 2 or an equivalent LeMap-Web semantic learner.

---

## 13. Generic module boundary

Initial implementation layout:

```text
lemap-web/src/preprocess/
  pageIdentity.js
  inputDiscovery.js
  inputClassifier.js
  groupDiscovery.js
  action.js
  observation.js
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

Semantic interpretation remains separate again.

---

## 14. Generic testing strategy

The preprocessor must be testable independently of any specific production website.

LeMap-Web therefore maintains a synthetic benchmark page containing known behavior:

```text
radio group
  B reveals/requires checkbox group

checkbox group
  one-or-more gates Continue

date field
  DD/MM/YYYY validation

number field
  min/max validation

autocomplete
  fake async city suggestions

select
  changes dependent select options

text
  maxlength/pattern validation

completion button
  enabled only in valid state
```

Because the ground truth is known, tests can assert whether preprocessing discovered:

- page identity
- input type
- group membership
- candidate action space
- state delta
- validation output
- async suggestion/output changes
- network evidence shape
- normalized observation schema

The Income Tax ITR-3 site is a real-world stress test, not the primitive unit-test environment.

---

## 15. Non-goals of this stage

This preprocessing stage does not yet:

- infer business meaning
- decide which function calls are meaningful business steps
- generate natural-language questions to the user
- autonomously complete a production workflow
- persist final semantic WebMap workflows
- refactor or share implementation with `demo_v2`

Those layers come after the preprocessor representation is proven.

---

## 16. Architecture summary

```text
WEB PAGE
   ↓
PAGE IDENTITY
   ↓
INPUT + GROUP HIERARCHY
   ↓
INPUT TYPE CLASSIFICATION
   ↓
TYPE-SPECIFIC SCANNER
   ↓
ACTION
   ↓
EVENT / FUNCTION / NETWORK TRACE
   ↓
NORMALIZED BEFORE/AFTER STATE DELTA
   ↓
INPUT OBSERVATION
   ↓
BEHAVIORAL CONSTRAINT DISCOVERY
   ↓
PAGE STATE GRAPH
   ↓
SEMANTIC LEARNING (later)
```

The invariant to preserve is:

> **Type-specific exploration, normalized behavioral evidence, page-level composition.**
