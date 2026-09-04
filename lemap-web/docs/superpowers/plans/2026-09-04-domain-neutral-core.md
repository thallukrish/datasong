# Domain-Neutral Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove income-tax-specific assumptions from LeMap-Web core while preserving generic scope reuse, execution-trace learning, confirmation, and safe navigation.

**Architecture:** Replace domain-specific goal parsing and value scopes with generic workflow/actor/application/workflow-instance semantics. Replace label blacklists with model-produced generic consequence classes, enforced deterministically by the executor.

**Tech Stack:** Node.js ESM, Playwright, node:test.

**Spec:** `docs/superpowers/specs/2026-09-04-domain-neutral-core.md`

## Global Constraints

- No domain-specific business vocabulary in `src/` core logic.
- Personal/user values remain outside semantic model prompts.
- Only reversible navigation candidates may be auto-executed.
- Preserve execution-trace novelty learning and application-vs-local control scope.

---

### Task 1: Generic interaction scopes

**Files:**
- Modify: `src/semantic/localEntityResolver.js`
- Modify: `src/agent/instanceMemory.js`
- Modify: `src/agent/userInteraction.js`
- Test: `test/instanceMemory.test.js`
- Test: `test/userInteraction.test.js`

- [ ] Add failing tests for application/actor/workflow/workflow_instance scopes.
- [ ] Remove domain-specific scope vocabulary and special-case value logic.
- [ ] Verify focused tests.

### Task 2: Generic workflow identity

**Files:**
- Modify: `src/queryAgent.js`
- Test: `test/queryAgent.test.js`

- [ ] Add failing test for domain-neutral goal normalization.
- [ ] Derive workflow key from normalized goal only.
- [ ] Remove domain-specific scope-key initialization.
- [ ] Verify focused tests.

### Task 3: Generic navigation consequence safety

**Files:**
- Modify: `src/semantic/navigationScout.js`
- Modify: `src/agent/browserActions.js`
- Test: `test/semantic.test.js`
- Test: `test/queryAgent.test.js`

- [ ] Add failing tests for consequence normalization and deterministic blocking.
- [ ] Extend navigation scout output with generic consequence class.
- [ ] Remove domain-specific label blacklist.
- [ ] Permit auto-execution only for consequence=`reversible` plus allowed workflow role.
- [ ] Verify focused tests.

### Task 4: Audit and documentation

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] Search `src/` for tax/domain vocabulary introduced by core logic.
- [ ] Document domain-neutral invariant and generic scopes/consequence classes.
- [ ] Run `npm test` and `npm run test:browser` in the user's environment before declaring runtime success.
