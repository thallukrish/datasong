# Odoo Configurable Pattern Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move regex-recognizable Odoo conventions into a small JSON registry while preserving current Odoo execution behavior and ACME assessment output.

**Architecture:** Add one generic registry loader/matcher that filters rules by simple file selectors and returns named captures with provenance. Existing Odoo parsers remain responsible for context such as enclosing XML records, current model, variable binding and framework expansion, but use registry matches instead of embedding the same recognizer regexes in code.

**Tech Stack:** Node.js ESM, JavaScript RegExp, JSON configuration, node:test.

**Spec:** `docs/specs/2026-09-16-odoo-configurable-pattern-registry.md`

## Global Constraints

- Keep the mechanism simple; do not build a custom DSL or generic AST framework.
- Prefer tolerant matching and recall over brittle exact syntax.
- Keep CallPathIndexer, Pass 1 and Pass 2 unchanged.
- Preserve provenance including rule id, source path and line.
- Keep context-dependent resolution in code.

---

### Task 1: Generic registry matcher

**Files:**
- Create: `demo_v2/server/adapters/odoo/patterns.json`
- Create: `demo_v2/server/adapters/odoo/patternRegistry.js`
- Create: `demo_v2/server/adapters/odoo/patternRegistry.test.js`

**Interfaces:**
- Produces: `applyOdooPatterns(sourcePath, source, options)` returning matches `{ruleId, sourcePath, line, captures, emit, match}`.

- [ ] Add initial rules for manifest hooks, XML object buttons, server-action calls, direct env calls, `_name`, `_inherit`, and `super()`.
- [ ] Implement simple `**/*.ext` and exact-basename selector matching plus generic RegExp execution.
- [ ] Test quote, whitespace, attribute-order and multiline tolerance.

### Task 2: Replace manifest/UI recognizers with registry matches

**Files:**
- Modify: `demo_v2/server/adapters/odoo/manifestHooks.js`
- Modify: `demo_v2/server/adapters/odoo/uiEntrypoints.js`
- Test: existing manifest/UI tests plus registry tests.

**Interfaces:**
- Consumes: `applyOdooPatterns`.
- Preserves: `extractOdooManifestHooks`, `extractOdooHookExecution`, `extractOdooUiEntrypoints` public return shapes.

- [ ] Use the manifest lifecycle rule instead of a dedicated lifecycle-hook regex.
- [ ] Use registry matches to recognize object buttons and server-action method calls while retaining enclosing-record/model context logic.
- [ ] Preserve current dedupe and line reporting behavior.

### Task 3: Drive Python execution recognizers from registry

**Files:**
- Modify: `demo_v2/server/adapters/odoo/pythonExecutionParser.js`
- Test: `demo_v2/server/adapters/odoo/pythonExecutionParser.test.js`
- Test: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

**Interfaces:**
- Consumes: direct env-model-call and super-call registry matches.
- Preserves: `extractOdooExecution` result shape and framework seed behavior.

- [ ] Replace direct `self.env[...]` / `env[...]` recognition with registry matches.
- [ ] Replace `super().method()` recognition trigger with registry matches while keeping current-model resolution in code.
- [ ] Leave self-call and variable binding logic in code.

### Task 4: Verify ACME integration

**Files:**
- No production changes unless verification reveals a regression.

- [ ] Run focused Odoo tests.
- [ ] Run `npm run assess:acme` locally against the ACME repo.
- [ ] Confirm registry rules can be extended by editing JSON only and that ACME reaches equal or better structural evidence than before.
