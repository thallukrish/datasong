# LeMap-Web Architecture

## Status

This document captures the first architecture for **LeMap-Web**, a separate experimental subsystem that applies the core LeMap principles to interactive web applications.

LeMap-Web is intentionally kept separate from the working `demo_v2` implementation. The goal is to reuse proven architectural ideas without refactoring or risking regressions in the current LeMap learning/query path.

The current LeMap architecture remains documented in:

```text
docs/LEMAP_ARCHITECTURE.md
demo_v2/ARCHITECTURE.md
```

---

## 1. Objective

LeMap-Web should learn how a web application works from the user's point of view and persist that understanding as an evidence-backed semantic workflow map.

The long-term goal is to reduce the pain of operating complex web applications by allowing a user to navigate and execute workflows through natural-language interaction rather than repeatedly understanding the application's UI manually.

Example target:

```text
User: "Take me to the section where I enter long-term capital loss in ITR-3"

LeMap-Web:
→ identifies the relevant learned workflow
→ aligns the current browser state with the learned map
→ follows the appropriate known route
→ verifies each resulting state
```

The initial benchmark may be a complex hierarchical form workflow such as ITR-3 filing, where pages contain multiple sections, conditional branches, validations, server interactions and repeated form structures.

---

## 2. Governing LeMap principle

LeMap-Web preserves the core LeMap rule:

> **Use deterministic structure wherever the system can observe or prove what happened. Use the model to interpret the user/business meaning of that structure.**

Examples:

```text
DOM hierarchy exists                        → deterministic evidence
control X fired a click/change event        → deterministic evidence
handler A called B                          → deterministic evidence
network request returned response R         → deterministic evidence
DOM subtree Y changed                       → deterministic evidence

"This selection chooses the tax regime"    → semantic interpretation
"This branch requires Form 10-IEA details" → semantic interpretation
"This state completes filing status"       → semantic interpretation
```

The model should not be asked to rediscover browser mechanics that the instrumentation can capture directly.

---

## 3. Core architectural difference from ordinary LeMap

In the current LeMap code-oriented path, the deterministic constructor starts from executable entry points and builds function/call slices.

```text
entry function
→ function-call path
→ branch/cycle-safe executable slices
→ dedupe / containment / ranking
→ semantic learning
```

In LeMap-Web, the primary structural object is a **page workflow**.

A page contains a DOM hierarchy representing what the user can see and interact with. Inputs or events trigger execution logic that may include JavaScript handlers, function calls, network calls, server responses and DOM updates. The resulting rendered state is the observable output of that execution.

```text
initial page state
      ↓
user/system trigger
      ↓
execution chain
      ↓
network / server interaction if any
      ↓
DOM update
      ↓
resulting page state
```

That complete state-transition path is the web equivalent of an executable call slice.

---

## 4. The page as a workflow container

A page is not treated as a flat HTML document.

Its DOM hierarchy provides a structural representation of the workflow surface exposed to the user.

Example:

```text
General Information
├─ Personal Details
├─ Filing Status
│  ├─ Filing section
│  ├─ Tax regime choice
│  │  ├─ Yes
│  │  └─ No
│  └─ Other filing conditions
└─ Bank Details
```

At the structural level these may be `div`, `label`, `input`, `button`, `select`, component nodes or framework-specific UI elements.

LeMap-Web should retain structural identity and labels where available so later semantic learning can interpret the hierarchy from the user's perspective.

A useful structural hierarchy is:

```text
Application workflow
   ↓
Page workflow
   ↓
Section / labelled DOM region
   ↓
Input or trigger
   ↓
Execution path
   ↓
Observed output / state delta
```

---

## 5. Structural WebState

A **WebState** represents the observable state of a page at a meaningful point in the workflow.

It is not merely a raw HTML snapshot or URL.

Conceptually it may include:

```text
WebState
  page identity
  route / URL evidence
  DOM hierarchy
  labelled sections
  visible controls
  enabled / disabled controls
  meaningful selected/input values
  validation state
  modal/dialog state
  rendered output fields
  stable DOM fingerprints
  provenance
```

Two DOM snapshots should not automatically become different workflow states merely because irrelevant markup, generated IDs, timestamps or cosmetic details changed.

Conversely, the same URL may represent multiple meaningful states when conditions, visible sections, required fields or workflow branches differ.

---

## 6. Inputs and triggers

A page workflow can be driven by both user actions and system-generated events.

Examples:

```text
CLICK
SELECT
INPUT
SUBMIT
KEYPRESS
EXPAND
COLLAPSE
NEXT
BACK
OPEN_MODAL
CLOSE_MODAL
PAGE_LOAD
XHR/FETCH_RESPONSE
SERVER_RESPONSE
BACKGROUND_REFRESH
VALIDATION_RESULT
```

The source of the trigger does not determine whether it is semantically important.

A field may be changed directly by a user action or populated automatically after an HTTP response. Both can cause a meaningful state transition.

The structural constructor should capture the trigger and resulting effect without requiring the model to decide the semantic meaning at this stage.

---

## 7. Execution path between states

For each meaningful trigger, LeMap-Web should collect the execution path that produces the next observable state.

Example:

```text
User selects "Yes"
    ↓
change event
    ↓
handler A
    ↓
function B
    ↓
fetch / filing-status
    ↓
server response
    ↓
callback C
    ↓
application state update
    ↓
DOM subtree mutation
    ↓
additional form fields appear
```

The exact instrumentation may evolve, but the conceptual evidence package should preserve:

```text
source state
source DOM region / control
trigger
event / handler chain
relevant function calls
network request / response evidence
DOM mutations
affected labelled regions
result state
```

The function/network chain is evidence explaining **how** the page transitioned.

The page-state delta records **what changed for the user**.

---

## 8. Structural WebFlow

A **WebFlow** is a deterministic state-transition path associated with a page workflow.

Example:

```text
Page: General Information

Initial state
  Filing Status.taxRegime = unanswered

Trigger
  select New Tax Regime

Execution
  event → handler → API request → response → callback

Effect
  Form 10-IEA section hidden → visible

Result state
  Filing Status.taxRegime = new
  Form 10-IEA details = required/available
```

At this stage LeMap-Web does not need to know what the legal/tax meaning of Form 10-IEA is.

It only knows that a labelled input in a labelled region triggered an evidenced execution path that changed another labelled region.

---

## 9. Broader page flow and subflows

A page can expose multiple related flows and branch variants.

Example:

```text
General Information
│
├─ Filing-status flow
│   ├─ old-regime branch
│   └─ new-regime branch
│       ├─ declaration already available
│       └─ declaration details required
│
├─ Personal-details flow
│
├─ Bank-details flow
│
└─ Save / Continue flow
    ├─ valid page
    └─ validation-error branches
```

LeMap-Web should first discover the broader end-to-end page flow and then preserve structurally distinct subflows/branches rather than flattening all observed interactions into independent unrelated paths.

The same distinction used in LeMap applies:

```text
material branch of current flow
reusable subflow
independent workflow
technical/internal execution
```

The semantic classifier will eventually decide which structural flows represent which user-facing meanings.

---

## 10. Path construction and reduction

Once structural input-triggered execution paths have been collected, LeMap-Web should reuse the proven path-processing concepts from LeMap wherever they fit.

The intended deterministic pipeline is:

```text
raw WebFlow paths
      ↓
branch-safe path construction
      ↓
cycle handling
      ↓
repeated-interaction compression
      ↓
exact duplicate removal
      ↓
common-path grouping
      ↓
containment / subset detection
      ↓
maximal unique representative flows
      ↓
ranking
```

### Repetition

Repeated form-entry structures should not dominate path length.

Example:

```text
Add row
→ fill fields
→ save
→ Add row
→ fill fields
→ save
... N times
```

should be representable as a repeated structure such as:

```text
Repeat: Add capital-gain entry [1..N]
```

### Ranking

Raw click count is not sufficient.

Ranking should favor effective structural/workflow information such as:

- meaningful state transitions
- branching decisions
- section changes
- validation outcomes
- network-backed transitions
- completion progress

The exact ranking formula is an implementation decision to be validated experimentally.

---

## 11. Semantic learning after structural construction

The structural flow constructor should remain primarily syntactic and deterministic.

Only after a page's broader flow and structural subflows have been collected should the model interpret their meaning.

Example structural evidence:

```text
Control A
→ handler
→ HTTP request
→ response
→ Section X becomes visible
```

Semantic interpretation:

```text
"Choosing this filing option requires the taxpayer to provide declaration details."
```

The input to semantic learning therefore becomes a compact package containing:

```text
page hierarchy
labelled sections
controls/triggers
structural WebFlows
branch variants
state deltas
network/function evidence
ranked representative paths
```

The model's task is to infer user/business meaning, not browser mechanics.

---

## 12. Reuse of LeMap learning concepts

After structural WebFlow discovery, LeMap-Web should reuse the learning concepts already proven in LeMap.

```text
Structural WebFlow mining
        ↓
Scout
        ↓
Pass 1
        ↓
Pass 2
        ↓
Persistent semantic WebMap
```

### Scout

Looks for materially different user/business workflow directions that may still be missing.

### Pass 1

Schedules and prioritizes qualified web workflows, favoring semantic progress and completion pressure.

### Pass 2

Reconstructs a selected workflow in depth, preserving branches, reusable subflows, meaningful conditions and completion outcomes while damping technical/internal execution detail.

The exact implementation should be adapted rather than shared prematurely with `demo_v2`.

---

## 13. Query and execution

Once the semantic WebMap exists, natural-language query can operate over it similarly to LeMap query.

The intended long-term flow is:

```text
user request
    ↓
query plan / intent
    ↓
relevant learned web workflow
    ↓
current browser-state alignment
    ↓
known path / subflow selection
    ↓
execute transition
    ↓
verify resulting state
    ↓
continue until query/task complete
```

Example:

```text
"Take me to Schedule 112A"

→ identify ITR-3 filing workflow
→ identify Capital Gains subflow
→ identify Schedule 112A state
→ route from current known state
→ execute and verify transitions
```

The learned map should reduce repeated screen-by-screen rediscovery by the model.

---

## 14. Manual versus autonomous acquisition

Manual and automatic exploration are evidence-acquisition modes, not different architectures.

Potential sources include:

```text
observed human interaction
headless Chromium exploration
production agent execution
replayed sessions / traces
```

All should eventually produce evidence for the same structural WebFlow and semantic WebMap representation.

The first implementation may choose whichever acquisition mode best validates the structural model without constraining the long-term architecture.

---

## 15. Isolation from current LeMap

LeMap-Web should be developed independently from the current working LeMap implementation.

Initial rule:

> **Do not refactor `demo_v2` merely to share abstractions with LeMap-Web.**

Where algorithms or concepts are useful, copy/adapt them into `lemap-web` first.

Examples likely worth adapting:

```text
path enumeration
cycle handling
branch grouping
containment
maximal-path selection
ranking concepts
Scout
Pass 1
Pass 2
semantic persistence/query patterns
```

Only after LeMap-Web has proven which abstractions are genuinely shared should common libraries be considered.

This protects the current LeMap path from regression while allowing the new experiment to evolve quickly.

---

## 16. Initial implementation boundary

The first engineering problem is not autonomous navigation or chat execution.

It is the **structural page-flow constructor**:

```text
DOM page hierarchy
     +
inputs/triggers
     +
execution chains
     +
network evidence
     +
DOM/output deltas
     ↓
branch/cycle-safe structural WebFlows
     ↓
deduped / contained / ranked representative flows
```

Once that representation is reliable, semantic learning and query/execution can be layered on top using the established LeMap principles.

---

## 17. Current architecture summary

```text
WEB APPLICATION
      ↓
Browser instrumentation
      ↓
DOM hierarchy / initial page state
      ↓
Inputs + system triggers
      ↓
Function / event / network execution evidence
      ↓
DOM and rendered-output changes
      ↓
Structural WebFlow constructor
      ↓
Branch / cycle / repetition handling
      ↓
Dedupe / containment / ranking
      ↓
Representative page flows + subflows
      ↓
Scout / Pass 1 / Pass 2
      ↓
Persistent semantic WebMap
      ↓
Query / navigation / execution
```

The central hypothesis is:

> **Learn the structure and semantics of a web application separately from operating it, so future agents can navigate known workflows instead of rediscovering the application during every task.**
