# Nested Structural Choice Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve question, choice-group, option, and conditional subgroup hierarchy from rendered DOM/ARIA structure before semantic-model interpretation.

**Architecture:** Browser capture will preserve labelled structural containers and recurse through interactive wrappers that contain nested controls. Preprocessing will retain parent control ownership and region ancestry; generic group discovery will attach nested groups to their owning choice when structural evidence exists. The semantic model continues to interpret business meaning, not reconstruct basic DOM hierarchy.

**Tech Stack:** Node.js ESM, Playwright Core, node:test, DOM/ARIA structural capture.

**Spec:** Existing `docs/superpowers/specs/2026-09-10-generic-choice-groups-design.md`, extended by this plan's hierarchy constraints.

## Global Constraints
- Domain-neutral: no tax-portal or Angular-specific production rules.
- Hidden controls remain excluded.
- Prefer HTML/ARIA/DOM ancestry over model inference for hierarchy.
- Do not flatten conditional child groups into parent option labels.
- Preserve existing page/group/control graph compatibility.

---

### Task 1: Browser capture regression

**Files:**
- Modify: `lemap-web/test/fixtures/input-behavior.html`
- Modify: `lemap-web/test/browserEntity.e2e.test.js`

- [ ] Add an ARIA radiogroup fixture with three labelled radio options and a nested checkbox group under one option.
- [ ] Assert the captured radio labels are human-visible text, not shared technical names/ids.
- [ ] Assert the parent question labels the radio group.
- [ ] Assert nested checkboxes are still captured.

### Task 2: Structural hierarchy regression

**Files:**
- Modify: `lemap-web/test/groupDiscovery.test.js`
- Modify: `lemap-web/test/structuralEntityBuilder.test.js`

- [ ] Add a nested group fixture where checkbox controls have an owning radio control.
- [ ] Assert the child checkbox group records its owning control.
- [ ] Assert graph links form parent group -> radio option -> child group -> checkbox options.

### Task 3: Browser and preprocessing implementation

**Files:**
- Modify: `lemap-web/src/browserCapture.js`
- Modify: `lemap-web/src/preprocess/inputDiscovery.js`

- [ ] Resolve `aria-labelledby` for structural regions.
- [ ] Use visible wrapper text for role-based radio/checkbox controls before falling back to name/id.
- [ ] Recurse into visible interactive wrappers so nested controls are not dropped.
- [ ] Carry `ownerFieldId` for controls structurally nested beneath another control.

### Task 4: Group hierarchy implementation

**Files:**
- Modify: `lemap-web/src/preprocess/groupDiscovery.js`
- Modify: `lemap-web/src/graph/structuralEntityBuilder.js`

- [ ] Derive a group's common owner control from its members.
- [ ] Link a nested group beneath that owner control instead of only flattening it under the page.
- [ ] Keep existing top-level group behavior unchanged.

### Task 5: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run test:browser`.
- [ ] Re-run the ITR-3 workflow and verify the filing-reason question produces distinct radio choices and conditional checkbox hierarchy.
