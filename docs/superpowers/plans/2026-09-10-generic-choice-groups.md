# Generic Choice Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LeMap-Web represent user-facing choices as one generic group independent of concrete widget type, while preserving local deterministic execution and avoiding redundant model calls.

**Architecture:** Browser capture preserves visible controls plus shared question/container context. Preprocessing turns peer choice controls into generic groups with structural cardinality and member links. Semantic resolution suppresses member controls, prompting uses group choices, and browser execution maps the selected value back to the concrete member control.

**Tech Stack:** Node.js ESM, Playwright Core, node:test.

**Spec:** `docs/superpowers/specs/2026-09-10-generic-choice-groups-design.md`

## Global Constraints
- Invisible controls are never captured or sent to the model.
- Existing radio/checkbox behavior stays compatible.
- Group detection and answer mapping are deterministic; no extra model call.
- No site-specific rules.

---

### Task 1: Generic group discovery
**Files:** Modify `lemap-web/src/preprocess/groupDiscovery.js`; create/update `lemap-web/test/groupDiscovery.test.js`.
**Interfaces:** `discoverGroups(fields, entityId)` returns groups with `groupType`, `cardinality`, `memberFieldIds`, and stable question/context label.
- [ ] Write tests for radio, checkbox and answer-button peers sharing context, plus navigation buttons excluded.
- [ ] Run focused test and confirm failure.
- [ ] Implement context-first grouping with cardinality inference.
- [ ] Run focused test and confirm pass.
- [ ] Commit.

### Task 2: Structural group representation
**Files:** Modify `lemap-web/src/graph/structuralEntityBuilder.js`; update `lemap-web/test/structuralEntityBuilder.test.js`.
**Interfaces:** group metadata from Task 1 is copied into `entity.structural`; member links stay `contains/partOf`.
- [ ] Add tests asserting generic group cardinality and choices.
- [ ] Run focused test and confirm failure.
- [ ] Implement builder changes.
- [ ] Run focused test and confirm pass.
- [ ] Commit.

### Task 3: Semantic suppression and prompting
**Files:** Modify `lemap-web/src/semantic/entitySemanticResolver.js`, `lemap-web/src/agent/entityFlow.js`; update their tests.
**Interfaces:** any member linked `partOf` a group is excluded from semantic candidates; groups alone become user-input prompts.
- [ ] Add tests that button/radio/checkbox members do not reach semantic enrichment and prompts expose group choices.
- [ ] Run focused tests and confirm failure.
- [ ] Implement generic grouped-member predicate.
- [ ] Run focused tests and confirm pass.
- [ ] Commit.

### Task 4: Generic group execution
**Files:** Modify `lemap-web/src/agent/entityBrowserActions.js`; update `lemap-web/test/entityBrowserActions.test.js` and browser E2E coverage.
**Interfaces:** `applyEntityValue(page, entities, group, value)` resolves the member locally then dispatches via its concrete control adapter.
- [ ] Add tests for radio and button-member selection.
- [ ] Run focused tests and confirm failure.
- [ ] Implement cardinality/member-type driven execution.
- [ ] Run focused tests and confirm pass.
- [ ] Commit.

### Task 5: End-to-end verification
**Files:** Update browser E2E fixture/tests and `lemap-web/package.json` only if necessary.
- [ ] Add a rendered Yes/No button question and a multi-option choice question.
- [ ] Verify capture → one group → one prompt → selected concrete control clicked.
- [ ] Run `npm test` and `npm run test:browser`.
- [ ] Record any environment-only verification still required on the real portal.
