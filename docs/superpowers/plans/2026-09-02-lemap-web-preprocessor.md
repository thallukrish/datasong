# LeMap-Web Preprocessor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic deterministic page/input preprocessor that identifies page identity, input/group hierarchy, behavioral input types, type-specific action plans, normalized execution traces and normalized state deltas before semantic learning.

**Architecture:** Browser capture produces a structural snapshot. `src/preprocess` converts that snapshot into stable page/input/group objects and dispatches each input to a small scanner module that emits safe user-equivalent candidate actions. All action results use one shared `InputObservation` and `StateDelta` schema so later function tracing and semantic learning can plug in without changing scanner contracts.

**Tech Stack:** Node.js ES modules, node:test, Playwright-core only at browser boundary.

**Spec:** `lemap-web/PREPROCESSING.md`

## Global Constraints

- Do not modify or refactor `demo_v2`.
- Page is the workflow boundary; inputs are behavioral elements, not independent workflows.
- Type-specific scanners emit normalized actions; they do not perform semantic interpretation.
- Execution traces preserve raw events/functions/network/callback evidence.
- File/button actions default to policy-required or disabled automatic execution.
- Tests use synthetic ground truth before production sites.

---

### Task 1: Page and input structural model

**Files:**
- Create: `lemap-web/src/preprocess/pageIdentity.js`
- Create: `lemap-web/src/preprocess/inputClassifier.js`
- Create: `lemap-web/src/preprocess/inputDiscovery.js`
- Create: `lemap-web/src/preprocess/groupDiscovery.js`
- Test: `lemap-web/test/preprocess.test.js`

**Interfaces:**
- `buildPageIdentity(snapshot) -> PageIdentity`
- `classifyInput(node) -> normalizedType`
- `discoverInputs(dom, pageId) -> Input[]`
- `discoverGroups(inputs, pageId) -> InputGroup[]`

- [ ] Write failing tests for stable page identity, parent-region preservation, behavioral type classification and radio/checkbox grouping.
- [ ] Run `npm test` and verify module-not-found/behavior failures.
- [ ] Implement the four structural modules with deterministic IDs and no model calls.
- [ ] Run tests and verify they pass.

### Task 2: Type-specific scanner registry

**Files:**
- Create: `lemap-web/src/preprocess/action.js`
- Create: `lemap-web/src/preprocess/scanners/*.js`
- Create: `lemap-web/src/preprocess/scanners/registry.js`
- Test: `lemap-web/test/preprocess.test.js`

**Interfaces:**
- `actionFor(input, kind, value, purpose, safety) -> Action`
- `scannerFor(input).actions(input) -> Action[]`

- [ ] Write failing tests showing radio/date/autocomplete produce different action spaces.
- [ ] Implement one focused scanner per normalized type.
- [ ] Keep buttons policy-required and files non-probed by default.
- [ ] Run tests and verify scanner behavior.

### Task 3: Normalized observations and state deltas

**Files:**
- Create: `lemap-web/src/preprocess/stateDelta.js`
- Create: `lemap-web/src/preprocess/observation.js`
- Test: `lemap-web/test/preprocess.test.js`

**Interfaces:**
- `computeStateDelta(before, after) -> StateDelta`
- `normalizeObservation(input) -> InputObservation`

- [ ] Write failing tests for value changes, enabled/disabled, shown/hidden, added/removed inputs, validation messages, options and action availability.
- [ ] Implement normalized delta calculation.
- [ ] Implement execution trace preservation with `browserEvents/functions/network/callbacks/consoleSignals`.
- [ ] Run tests and verify all pass.

### Task 4: Page preprocessor composition

**Files:**
- Create: `lemap-web/src/preprocess/pagePreprocessor.js`
- Modify: `lemap-web/src/browserCapture.js`
- Modify: `lemap-web/src/capture.js`
- Test: `lemap-web/test/preprocess.test.js`

**Interfaces:**
- `preprocessPage(snapshot) -> { page, inputs, groups, actionPlans }`

- [ ] Write failing composition test against a synthetic page snapshot.
- [ ] Implement orchestration and scanner dispatch.
- [ ] Enrich browser snapshot controls with role/placeholder/required/readonly/autocomplete/min/max/step/maxlength/pattern/options.
- [ ] Include preprocessor output in live capture JSON.
- [ ] Run the complete test suite.

### Task 5: Generic benchmark fixture

**Files:**
- Create: `lemap-web/test/fixtures/input-behavior.html`

- [ ] Add radio/conditional checkbox, date, number, autocomplete, dependent select, text validation and completion-button behavior with known ground truth.
- [ ] Keep the fixture local and deterministic so later automatic scanners can be tested without relying on ITR or any external website.
- [ ] Run `npm test` once more before completion.
