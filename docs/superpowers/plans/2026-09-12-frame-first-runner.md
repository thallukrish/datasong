# Frame-First Application Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LeMap Web complete each active page/frame before workflow navigation, while treating newly revealed inline UI and popups as nested runtime frames that run through the same structure → semantics → input-resolution flow.

**Architecture:** The entity graph remains the persistent domain-neutral map of nodes and relationships. The context stack becomes the runtime traversal mechanism: a page frame is the root; newly revealed UI creates a dynamic child frame; a completed child frame is popped and control returns to its parent. The application runner owns the frame-first loop and only performs workflow navigation from the root page frame after all required relevant inputs are satisfied.

**Tech Stack:** Node.js ES modules, node:test, existing LeMap Web v2 entity graph/orchestrator/semantic/agent layers.

**Spec:** `lemap-web/docs/superpowers/specs/2026-09-11-lemap-web-architecture-requirements.md`

## Global Constraints

- All application/domain structure remains generic canonical entities; no ITR-specific core types or logic.
- Newly revealed controls and popups use the same structural and semantic pipeline as the base page.
- The persistent entity graph may keep parent/child and dynamic causal links; runtime stack frames do not duplicate graph structure.
- User/stored/browser values remain local to the instance graph and never enter model or diagnostic payloads.
- `maxSteps` limits workflow/page progression, not individual input fills.

---

### Task 1: Frame lifecycle helpers

**Files:**
- Modify: `lemap_web_v2/src/orchestrator/runCoordinator.js`
- Test: `lemap_web_v2/test/runCoordinator.test.js`

**Interfaces:**
- Consumes: `reconcileVisibleState`, context stack helpers, entity `contains`/`partOf` links.
- Produces: refresh behavior that updates the root page frame, pushes newly revealed dynamic frames with subtree-visible entity IDs, and preserves/pops runtime frame state without duplicating graph nodes.

- [ ] Write tests for dynamic-frame push, subtree scope, parent preservation, and return to parent.
- [ ] Implement minimal coordinator helpers.
- [ ] Keep entity-graph parent/child and `dynamicChild`/`revealedBy` relationships unchanged.

### Task 2: Frame-first application loop

**Files:**
- Modify: `lemap_web_v2/src/app/applicationRunner.js`
- Test: `lemap_web_v2/test/applicationRunner.test.js`

**Interfaces:**
- Consumes: active context frame, semantic resolver, input selectors, decision execution, coordinator refresh/ingest.
- Produces: inner active-frame resolution loop and outer workflow progression loop.

- [ ] Test that multiple required inputs on one page do not consume `maxSteps` individually.
- [ ] Test that a revealed child frame is enriched/resolved before the parent resumes.
- [ ] Test that a completed child frame pops to its parent.
- [ ] Test that navigation is only considered from the root page frame after required inputs are exhausted.
- [ ] Test that a genuine page transition consumes one workflow progression step.
- [ ] Implement minimal nested-loop logic.

### Task 3: Navigation filtering boundary

**Files:**
- Modify: `lemap_web_v2/src/app/applicationRunner.js`
- Potentially modify: `lemap_web_v2/src/agent/agentDecision.js` only if existing candidate selection cannot express root-only navigation.
- Test: `lemap_web_v2/test/applicationRunner.test.js`

**Interfaces:**
- Consumes: existing navigation candidates and workflow history.
- Produces: navigation selection only after frame completion; deterministic known/filtered candidates precede model choice.

- [ ] Preserve existing candidate filtering behavior.
- [ ] Ensure child-frame local action/continuation can execute before pop when present.
- [ ] Ensure global/back/irrelevant links are not promoted merely because the page inputs are complete.

### Task 4: Documentation

**Files:**
- Modify: `lemap-web/docs/superpowers/specs/2026-09-11-lemap-web-architecture-requirements.md`

- [ ] Document page/frame-first execution explicitly.
- [ ] Clarify that dynamic/popup contexts run the same learning pipeline and return via stack pop.
- [ ] Clarify that `maxSteps` protects workflow/page progression rather than counting individual field fills.
