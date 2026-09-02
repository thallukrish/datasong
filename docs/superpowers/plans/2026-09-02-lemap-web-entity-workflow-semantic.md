# LeMap-Web Entity/Workflow Semantic Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace page-centric LeMap-Web structures with entity/workflow structural graphs and add Web-specific Pass 1 / Pass 2 semantic interpretation adapted from core LeMap.

**Architecture:** Browser capture remains deterministic acquisition. A structural entity builder converts the active rendered surface into an entity with fields/actions/groups/relationships plus presentation provenance; workflow construction records transitions among entity states/contexts. Semantic Pass 1 and Pass 2 operate only after those graphs exist, with a lightweight path selector instead of core Scout.

**Tech Stack:** Node.js ES modules, node:test, Playwright Core for browser E2E.

**Spec:** `docs/superpowers/specs/2026-09-02-lemap-web-entity-workflow-semantic-design.md`

## Global Constraints

- Do not modify `demo_v2`.
- Remove obsolete page-centric semantic code/tests instead of preserving compatibility aliases.
- Preserve deterministic browser evidence and synthetic benchmark coverage.
- Pass 1 / Pass 2 must not assume source files, functions, call paths, DB schemas or repository traversal.
- Model invocation must accept an injected client; do not add a new SDK dependency.

---

### Task 1: Entity structural graph

**Files:**
- Create: `lemap-web/src/graph/entityIdentity.js`
- Create: `lemap-web/src/graph/entityRoot.js`
- Create: `lemap-web/src/graph/entityHierarchy.js`
- Create: `lemap-web/src/graph/entityPreprocessor.js`
- Create: `lemap-web/src/graph/entityState.js`
- Test: `lemap-web/test/entityGraph.test.js`

- [ ] Write tests proving page/route are presentation metadata, controls become entity fields/actions, groups remain relationships, and checked state projects correctly.
- [ ] Implement minimal graph modules using existing input/group/scanner utilities.
- [ ] Run unit tests and verify entity graph behavior.

### Task 2: Structural workflow graph

**Files:**
- Create: `lemap-web/src/graph/workflowGraph.js`
- Test: `lemap-web/test/workflowGraph.test.js`

- [ ] Write tests for `state_change`, `inline_expand`, `overlay_open`, and `navigation` transitions.
- [ ] Record source/target entity IDs, action/evidence IDs, state delta, branch condition and presentation evidence.
- [ ] Verify repeated entity identity with different state remains one entity with multiple observed states.

### Task 3: Web semantic Pass 1 / Pass 2

**Files:**
- Create: `lemap-web/src/semantic/pathSelector.js`
- Create: `lemap-web/src/semantic/pass1.js`
- Create: `lemap-web/src/semantic/pass2.js`
- Create: `lemap-web/src/semantic/semanticGraph.js`
- Create: `lemap-web/src/semantic/modelCall.js`
- Test: `lemap-web/test/semantic.test.js`

- [ ] Write tests for lightweight path selection and prompt/response normalization.
- [ ] Adapt core LeMap whole-flow semantic contracts to workflow/entity evidence.
- [ ] Preserve provenance IDs in semantic graph materialization.
- [ ] Keep model client injected and JSON-only.

### Task 4: Wire browser capture to entity/workflow output

**Files:**
- Modify: `lemap-web/src/capture.js`
- Modify: `lemap-web/test/browserPreprocessor.e2e.test.js`

- [ ] Replace page preprocessing output with entity snapshots/state delta.
- [ ] Emit a normalized structural transition suitable for workflow graph accumulation.
- [ ] Preserve browser event/network evidence.
- [ ] Verify synthetic browser benchmark still captures dependent input/action changes.

### Task 5: Remove obsolete page-centric code and docs

**Files:**
- Delete obsolete: `lemap-web/src/preprocess/activeWorkflow.js`, `pageIdentity.js`, `hierarchy.js`, `pagePreprocessor.js`, `stateProjection.js`, `lemap-web/src/structuralFlow.js`, `lemap-web/src/webFlowIndexer.js`
- Delete obsolete tests: `activeWorkflow.test.js`, `preprocess.test.js`, `structuralFlow.test.js`
- Modify: `lemap-web/package.json`
- Modify: `lemap-web/ARCHITECTURE.md`
- Modify: `lemap-web/PREPROCESSING.md`

- [ ] Remove imports/references before deleting files.
- [ ] Update docs to entity/workflow terminology only.
- [ ] Update test scripts to new unit/E2E suites.
- [ ] Run `npm run test:all` on an environment with Chrome/Playwright available.
