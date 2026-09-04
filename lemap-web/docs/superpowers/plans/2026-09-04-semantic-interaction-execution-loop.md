# Semantic Interaction Execution Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each newly encountered browser context produce a semantic interaction plan that drives goal-relevant user input, validates model behavior hypotheses through real execution, and turns structural novelty into entity/workflow graph growth.

**Architecture:** Deterministic capture summarizes visible controls, groups, actions, state and hierarchy. The local semantic resolver returns entity meaning plus ordered relevant interactions, action roles and behavior hypotheses. Query execution consumes that plan, observes every real before/after delta, reuses known behavior classes, and calls semantic resolution only for structural novelty or context transitions.

**Tech Stack:** Node.js ESM, Playwright Core, existing LeMap-Web semantic model client, node:test.

**Spec:** `lemap-web/docs/superpowers/specs/2026-09-04-semantic-interaction-execution-loop-design.md`

## Global Constraints

- Browser structure/state remains deterministic evidence.
- The model proposes meaning, priority and generalization; execution proves behavior.
- No domain-specific workflow vocabulary in core code.
- Private user values stay out of semantic memory/model behavior evidence.
- Automatic navigation executes only reversible consequences.

---

### Task 1: Semantic page-interaction contract

**Files:**
- Modify: `lemap-web/src/semantic/localEntityResolver.js`
- Test: `lemap-web/test/interactionSemantics.test.js`

**Produces:** normalized interaction metadata (`goalRelevance`, `priority`, `requiredForGoal`, dependencies, behavior hypothesis) and semantic action roles.

- [ ] Write failing normalization/prompt tests.
- [ ] Extend compact prompt with hierarchy and page-level planning instructions.
- [ ] Normalize the new contract with safe defaults.
- [ ] Run semantic/interaction tests.

### Task 2: Deterministic interaction-plan ordering

**Files:**
- Create: `lemap-web/src/agent/interactionPlan.js`
- Create: `lemap-web/test/interactionPlan.test.js`

**Produces:** `orderedInteractionItems()` that filters goal-irrelevant interactions, respects structural executability/dependencies, and orders by requiredness/relevance/priority without inventing values.

- [ ] Write failing tests for ordering, blocked dependencies and optional/global interactions.
- [ ] Implement the pure helper.
- [ ] Run tests.

### Task 3: Behavior-hypothesis reconciliation

**Files:**
- Modify: `lemap-web/src/agent/executionBehavior.js`
- Test: `lemap-web/test/executionBehavior.test.js`

**Produces:** evidence that records whether an observed structural effect matches or falsifies the semantic behavior hypothesis, without storing actual user values.

- [ ] Write failing tests for same-effect and divergent-effect observations.
- [ ] Extend classifier metadata minimally.
- [ ] Run tests.

### Task 4: Query orchestration integration

**Files:**
- Modify: `lemap-web/src/queryAgent.js`
- Test: `lemap-web/test/queryAgent.test.js`

**Consumes:** semantic page plan + deterministic ordering + behavior classifier.

- [ ] Add regression tests for selecting the first relevant interaction rather than DOM order.
- [ ] Use ordered semantic interactions as candidate questions.
- [ ] Continue locally after no/known structural delta.
- [ ] Trigger semantic refresh only for novel structural effects; preserve source semantic key and behavior-class relationship evidence.
- [ ] Keep workflow transition accumulation at root/route change.
- [ ] Run unit tests.

### Task 5: Architecture documentation and verification

**Files:**
- Modify: `lemap-web/ARCHITECTURE.md`
- Modify: `lemap-web/package.json` only if new tests need explicit inclusion.

- [ ] Replace obsolete speculative-probing description with the real-execution learning loop.
- [ ] Document page interaction planning, behavior hypotheses, structural novelty, local/global scope and completion.
- [ ] Run `npm test`.
- [ ] Run `npm run test:browser` in the user's attached Chrome environment.
