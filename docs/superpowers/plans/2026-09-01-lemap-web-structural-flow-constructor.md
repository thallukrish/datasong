# LeMap-Web Structural Flow Constructor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deterministic LeMap-Web core that converts labelled page structure plus trigger/execution/result observations into structural WebFlows and reduces them into ranked unique representatives.

**Architecture:** Keep `lemap-web` isolated from `demo_v2`. Represent page structure and state deltas deterministically, then adapt the proven LeMap call-path ideas for duplicate removal, prefix containment, branch grouping, and effective-length ranking. Chromium acquisition, semantic Scout/Pass1/Pass2, persistence, and query are deliberately outside this slice.

**Tech Stack:** Node.js ES modules, built-in `node:test`, no external dependencies.

**Spec:** `lemap-web/ARCHITECTURE.md`

## Global Constraints

- Do not refactor or import from `demo_v2` merely to share abstractions.
- The constructor remains structural/deterministic; no model calls in this slice.
- Preserve labelled DOM hierarchy, trigger evidence, function/network evidence, and observable state deltas.
- Ranking is effective structural length, not raw function-call or click count.

---

### Task 1: Structural page and WebFlow model

**Files:**
- Create: `lemap-web/src/structuralFlow.js`
- Test: `lemap-web/test/structuralFlow.test.js`

**Interfaces:**
- `buildPageStructure(root)` -> labelled page/section/region/control hierarchy.
- `diffState(before, after)` -> meaningful value/region changes.
- `buildWebFlow(observation)` -> structural flow evidence with normalized tokens.

- [x] Write failing tests for labelled hierarchy, state delta, and execution evidence.
- [x] Verify failure before implementation.
- [x] Implement minimal deterministic constructor.
- [x] Verify tests pass.

### Task 2: WebFlow reduction and ranking

**Files:**
- Create: `lemap-web/src/webFlowIndexer.js`
- Test: `lemap-web/test/structuralFlow.test.js`

**Interfaces:**
- `new WebFlowIndexer()`
- `addPath({id, tokens|normalizedFlowTokens})`
- `rank()` -> maximal unique ranked representatives with duplicate, containment, and branch metadata.

- [x] Write failing tests for duplicate/containment and branch-aware ranking.
- [x] Verify failure before implementation.
- [x] Implement deterministic reduction/ranking.
- [x] Verify tests pass.

### Task 3: Standalone package boundary

**Files:**
- Create: `lemap-web/package.json`

- [x] Use ES modules and built-in `node:test` only.
- [x] Run `npm test` / `node --test` and require a clean pass before completion.
