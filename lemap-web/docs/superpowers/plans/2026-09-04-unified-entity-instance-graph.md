# Unified Entity / Instance Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current interaction-plan/workflow-graph orchestration with one simple entity array plus one separate instance array while preserving reusable browser parsing and execution.

**Architecture:** LeMap-Web owns `structural`, the model owns `semantic`, and the user owns `instance` values. Pages, controls, groups, dynamic regions/modals and workflows are all entity nodes with bidirectional `links[]`. Runtime execution observes before/after structure and adds new/version nodes plus causal links; user values remain only in the instance array.

**Tech Stack:** Node.js ES modules, Playwright Core, OpenAI-compatible JSON model client, node:test.

**Spec:** `lemap-web/docs/superpowers/specs/2026-09-04-unified-entity-instance-graph-design.md`

## Global Constraints

- Entity graph is an array of nodes with `id`, `name`, `type`, `structural`, `semantic`, `links`.
- Instance graph is a separate array of nodes with `id`, `type: instance`, `value`, `links`.
- All entity relationships are bidirectional.
- Selectable option values are properties, not entities, unless the UI renders them as independent controls.
- UI groups are entity nodes; member controls link to the group with `partOf` and the group links back with `contains`.
- User values never become reusable entity semantics.
- Model responses add semantic fields only and refer to existing entity IDs.
- Dynamic UI/state changes create new/version nodes and causal links instead of erasing prior entity states.
- Preserve deterministic HTML/UI parsing, option discovery, browser filling/clicking and before/after capture where useful.
- Remove obsolete interaction-plan, behavior-class and standalone workflow-graph code after replacements are in place.

---

### Task 1: Core entity and instance graph primitives

**Files:**
- Create: `lemap-web/src/graph/entityGraph.js`
- Create: `lemap-web/src/graph/instanceGraph.js`
- Create: `lemap-web/test/unifiedGraph.test.js`

**Interfaces:**
- Produces: `upsertEntity`, `linkEntities`, `mergeSemanticPatch`, `findEntity`, `createInstance`, `upsertInstanceValue`.

- [ ] Write tests proving bidirectional links, semantic patch merge without structural mutation, and instance nodes referencing entity IDs through `instanceOf`.
- [ ] Implement the minimal graph helpers.
- [ ] Run `node --test test/unifiedGraph.test.js` and verify PASS.
- [ ] Commit.

### Task 2: Build structural entity arrays from browser capture

**Files:**
- Create: `lemap-web/src/graph/structuralEntityBuilder.js`
- Modify only as needed: `lemap-web/src/preprocess/inputDiscovery.js`, `lemap-web/src/preprocess/groupDiscovery.js`
- Test: `lemap-web/test/structuralEntityBuilder.test.js`

**Interfaces:**
- Consumes: browser snapshot from `snapshotPage()`.
- Produces: `buildStructuralEntities(snapshot) -> { entities, pageId }`.

- [ ] Write tests for page, standalone controls, radio/checkbox groups, buttons and reverse links.
- [ ] Implement structural entities using the existing stable control discovery/classification.
- [ ] Ensure dropdown values remain `structural.values` rather than child entities.
- [ ] Run the focused tests and commit.

### Task 3: Simplify semantic resolution to semantic patches

**Files:**
- Create: `lemap-web/src/semantic/entitySemanticResolver.js`
- Create: `lemap-web/test/entitySemanticResolver.test.js`

**Interfaces:**
- Consumes: user goal + unresolved/current page entities.
- Produces: `{ entities:[{id, semantic}], workflow?:{...} }` with no structural repetition.

- [ ] Write prompt/normalization tests asserting only known entity IDs can be patched.
- [ ] Support optional semantic fields: `meaning`, `scope` (`local|global`), `interaction` (`user_input|information|action|navigation|unknown`), `relevantToGoal`, `required`, `question`, `explanation`, `caveats`, `examples`, `workflowRole`.
- [ ] Implement model call and normalization.
- [ ] Run focused tests and commit.

### Task 4: Represent observed dynamic changes as entity/version nodes

**Files:**
- Create: `lemap-web/src/graph/structuralChange.js`
- Create: `lemap-web/test/structuralChange.test.js`

**Interfaces:**
- Consumes: before entity array, after entity array, triggering entity ID.
- Produces: graph additions/links for newly appeared entities and changed copies.

- [ ] Test new entity appearance: trigger `causesAppearanceOf`, new entity `appearsOnModificationOf`.
- [ ] Test changed existing state: create copy/version node, `copyOf`/`hasCopy`, and trigger causal links.
- [ ] Ignore only the source control's literal user-entered value change when deciding reusable structural change.
- [ ] Implement and commit.

### Task 5: Replace persistence with two simple arrays

**Files:**
- Create: `lemap-web/src/graph/graphStore.js`
- Replace/remove old semantic and instance memory usage in runtime.
- Create: `lemap-web/test/graphStore.test.js`

**Interfaces:**
- Persist entity file as `{version, entities:[]}`.
- Persist instance file as `{version, instances:[]}`.

- [ ] Test independent load/save/upsert behavior.
- [ ] Implement minimal JSON persistence.
- [ ] Commit.

### Task 6: Rewrite query-agent around the simple graph

**Files:**
- Rewrite: `lemap-web/src/queryAgent.js`
- Reuse: `lemap-web/src/browserCapture.js`, `lemap-web/src/agent/browserActions.js`, `lemap-web/src/agent/modelClient.js`, `lemap-web/src/semantic/modelCall.js`, `lemap-web/src/agent/env.js`, `lemap-web/src/agent/runLogger.js` where still useful.
- Create: `lemap-web/test/queryAgentGraphFlow.test.js`

**Interfaces:**
- Flow: capture -> structural entities -> semantic patch -> choose relevant unresolved user-input entity/group -> ask -> create instance -> execute -> capture -> record structural change -> choose semantic workflow continuation -> navigate -> repeat.

- [ ] Test a synthetic page flow with dropdown then radio group then continue.
- [ ] Ensure the user question uses structural option values directly for finite choices.
- [ ] Ensure actual user values are written only to the instance graph.
- [ ] Ensure navigation creates page/action/workflow links in the entity array.
- [ ] Implement the smallest loop that satisfies the spec and commit.

### Task 7: Remove obsolete architecture code and tests

**Files to remove when no longer imported:**
- `lemap-web/src/agent/controlScope.js`
- `lemap-web/src/agent/executionBehavior.js`
- `lemap-web/src/agent/interactionCoverage.js`
- `lemap-web/src/agent/interactionPlan.js`
- `lemap-web/src/agent/interactionTransition.js`
- `lemap-web/src/agent/memory.js`
- `lemap-web/src/agent/userInteraction.js`
- `lemap-web/src/agent/workflowIdentity.js`
- `lemap-web/src/graph/workflowGraph.js`
- `lemap-web/src/semantic/informationNeedPlanner.js`
- `lemap-web/src/semantic/localEntityResolver.js`
- `lemap-web/src/semantic/navigationScout.js`
- old Pass1/Pass2/path semantic workflow files if no remaining command imports them.

**Tests:** remove tests whose only purpose is the superseded architecture; retain browser parsing/execution tests and replace coverage with unified graph tests.

- [ ] Search imports before each deletion.
- [ ] Delete only files with no remaining runtime dependency.
- [ ] Simplify `package.json` test scripts to the new focused suite plus retained browser tests.
- [ ] Run `npm test`, then `npm run test:browser`, then `npm run test:all`.
- [ ] Commit.

### Task 8: Documentation consistency check

**Files:**
- Review: `lemap-web/ARCHITECTURE.md`
- Review/trim: `lemap-web/PREPROCESSING.md`

- [ ] Remove language that still implies a separate semantic interaction plan or standalone workflow graph.
- [ ] Confirm examples use entity nodes + instance nodes consistently.
- [ ] Commit.
