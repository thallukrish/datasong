# Semantic Navigation and Transactional Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page navigation model-semantic and make graph/instance learning transactional so failed exploratory runs do not contaminate durable state.

**Architecture:** Extend semantic navigation entities with workflow-relative role and priority, use those fields as the primary continuation ranking, and treat observed transitions as verification/cycle evidence. Query runs operate on deep-cloned working graphs and persist them to canonical files only at clean terminal states.

**Tech Stack:** Node.js ESM, Playwright Core, node:test, JSON graph persistence.

**Spec:** `docs/superpowers/specs/2026-09-10-semantic-navigation-run-transactions-design.md`

## Global Constraints
- Keep production logic domain-neutral.
- Hidden/non-visible controls never enter semantic model payloads.
- Group member controls remain structural-only semantic choices.
- No extra model calls for navigation verification or persistence.
- Commit/consequential browser actions remain protected.
- Failed/incomplete runs must not mutate canonical entity or instance files.

---

### Task 1: Navigation semantic contract

**Files:**
- Modify: `lemap-web/src/semantic/entitySemanticResolver.js`
- Modify: `lemap-web/test/entitySemanticResolver.test.js`

**Interfaces:**
- Produces semantic `workflowRole` values including `branch` and `exit`.
- Produces normalized integer `navigationPriority` in range 0-100.

- [ ] Add failing normalization/prompt tests for page-relative navigation roles and priority.
- [ ] Run `node --test test/entitySemanticResolver.test.js` and confirm failure.
- [ ] Extend prompt contract, enum normalization, and priority clamping.
- [ ] Re-run focused test and confirm pass.
- [ ] Commit semantic contract change.

### Task 2: Semantic-first continuation ranking

**Files:**
- Modify: `lemap-web/src/agent/entityFlow.js`
- Modify: `lemap-web/test/queryAgentGraphFlow.test.js`

**Interfaces:**
- Consumes `semantic.navigationPriority`, `workflowRole`, `required`, `consequence`.
- Produces `selectWorkflowContinuation(entities, context)` where only `continue` is auto-forward and priority is the dominant ordering signal.

- [ ] Add failing tests showing high-priority semantic continuation beats DOM/widget heuristics and back/global/branch/exit are excluded.
- [ ] Run `node --test test/queryAgentGraphFlow.test.js` and confirm failure.
- [ ] Replace heuristic-dominant scoring with navigationPriority-first scoring, retaining known-cycle rejection as a safety guard.
- [ ] Re-run focused test and confirm pass.
- [ ] Commit continuation ranking change.

### Task 3: Transactional working state

**Files:**
- Create: `lemap-web/src/graph/runTransaction.js`
- Create: `lemap-web/test/runTransaction.test.js`
- Modify: `lemap-web/package.json`

**Interfaces:**
- `createRunTransaction(entityGraph, instanceGraph)` returns deep-cloned `entityGraph`, `instanceGraph` working copies and promotion helpers.
- `shouldPromoteRun(reason)` returns true only for `workflow_complete` and `consequential_action`.

- [ ] Add failing tests proving clones do not mutate canonical inputs and promotion policy is conservative.
- [ ] Run focused test and confirm failure.
- [ ] Implement pure transaction helpers.
- [ ] Wire test into `npm test` and confirm focused pass.
- [ ] Commit transactional state helper.

### Task 4: Query-agent promotion/discard lifecycle

**Files:**
- Modify: `lemap-web/src/queryAgent.js`
- Modify: `lemap-web/test/queryAgentGraphFlow.test.js` or add a focused lifecycle test if extraction is required.

**Interfaces:**
- Query agent loads canonical graphs once, then mutates transaction working copies only.
- Canonical `saveEntityGraph`/`saveInstanceGraph` occur only when `shouldPromoteRun(stopReason)` is true.
- JSONL records `run_state` with `promoted` or `discarded` and reason.

- [ ] Add/extract a testable lifecycle decision proving `no_executable_entity` and loop stops discard while consequential/workflow completion promote.
- [ ] Run focused tests and confirm failure before production wiring.
- [ ] Replace mid-run canonical saves with in-memory work-state mutation.
- [ ] Track explicit stop reason including `max_steps`.
- [ ] Promote both graphs on clean terminal state; otherwise leave canonical files untouched and log discard.
- [ ] Run `npm test`.
- [ ] Commit query lifecycle change.

### Task 5: Verification

**Files:**
- No production changes expected.

**Interfaces:**
- Existing browser tests verify capture/execution compatibility.

- [ ] Run `npm run test:all` locally in an environment with Chrome.
- [ ] For portal validation, delete the pre-transaction canonical map and instances once because they may already contain contaminated navigation edges.
- [ ] Run the ITR-3 workflow and verify model semantics classify navigation direction/priority, stored instances replay, and an aborted/failed run leaves canonical files unchanged.
