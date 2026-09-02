# LeMap-Web Lazy Query Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lemap-web` navigate toward a user goal immediately when possible, learn only missing local semantics lazily, and ask the user only for business facts that are actually required to continue.

**Architecture:** Reuse the current deterministic local explorer, semantic resolver, navigation scout, browser action executor, and persistent memory. Add an Information-Need Planner between local semantic resolution and user questioning; enrich local semantics with semantic sub-entities; and extend local discovery for dropdown/combobox controls so their option domains and effects can be evidence before the planner decides whether the user must be asked.

**Tech Stack:** Node.js ESM, Playwright Core, existing JSON-only model adapter, node:test.

**Spec:** `lemap-web/ARCHITECTURE.md`

## Global Constraints

- A page is presentation evidence, not a semantic primitive.
- Deterministic code owns observable structure/behavior; the model owns semantic interpretation and prioritization.
- Do not ask the user for every empty field.
- If the next safe transition can be chosen confidently without user input, navigate immediately.
- Ask the user only when a genuinely user-specific/business fact blocks safe progress.
- Persist only proven entity evidence and actually traversed workflow edges; retain alternatives as frontier evidence.
- Do not persist raw sensitive free-text values.
- Unsafe/destructive/consequential actions are never exploratory.

---

### Task 1: Information-Need Planner

**Files:**
- Create: `lemap-web/src/semantic/informationNeedPlanner.js`
- Modify: `lemap-web/test/queryAgent.test.js`

**Interfaces:**
- Consumes: `{ client, model, userGoal, semanticContext, workflowContext, candidateQuestions, navigationCandidates }`
- Produces: `{ decision, questionIds, reason, confidence }` where `decision` is `navigate|ask_user|explore_more|stop`.

- [ ] Write failing tests proving the planner can choose navigation without asking despite empty fields, and can select only one required question when user-specific information is missing.
- [ ] Implement prompt/normalization/model-call wrapper.
- [ ] Verify focused tests.

### Task 2: Rich Local Semantic Context

**Files:**
- Modify: `lemap-web/src/semantic/localEntityResolver.js`
- Modify: `lemap-web/test/semantic.test.js`

**Interfaces:**
- Extend resolver output with `subEntities:[{semanticName,description,structuralFieldIds,relationshipToParent}]` while preserving all current fields.

- [ ] Write failing tests for semantic sub-entities.
- [ ] Extend resolver prompt/normalizer without breaking old callers.
- [ ] Verify focused tests.

### Task 3: Dropdown/Combobox Discovery Evidence

**Files:**
- Modify: `lemap-web/src/explore/localExplorer.js`
- Modify: `lemap-web/test/browserEntity.e2e.test.js`

**Interfaces:**
- Local exploration records option-domain evidence for native select and ARIA/material combobox controls without committing user data.
- Representative safe option probes may record deltas and restore the initial selection when restoration is possible.

- [ ] Write failing browser fixture test for combobox/select option discovery.
- [ ] Implement generic option enumeration and safe representative probing/restoration.
- [ ] Verify browser tests locally when execution environment permits.

### Task 4: Query-Agent Decision Loop

**Files:**
- Modify: `lemap-web/src/queryAgent.js`
- Modify: `lemap-web/test/queryAgent.test.js`

**Interfaces:**
- Current local state -> semantic context -> candidate questions/navigation -> Information-Need Planner.
- `navigate`: skip questioning and rank/execute navigation.
- `ask_user`: ask only planner-selected question IDs, apply answers, then re-plan because new entities/fields may become reachable.
- `explore_more`: refresh local exploration/semantics once, then re-plan.
- `stop`: persist current knowledge and stop cleanly.

- [ ] Write failing orchestration-level contract tests for skipping irrelevant empty fields and re-planning after a user answer.
- [ ] Replace unconditional `buildUserQuestions(...)[0]` loop with planner-driven loop.
- [ ] Preserve existing memory privacy rules and transition persistence.
- [ ] Run `npm run test:all` locally; validate the live ITR flow from the filing entry page.
