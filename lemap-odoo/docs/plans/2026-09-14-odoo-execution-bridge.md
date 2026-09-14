# Odoo Execution Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed ACME → Odoo Python method execution into the existing LeMap call graph so CallPathIndexer and Pass 1 / Pass 2 can reconstruct end-to-end workflows across project and framework code.

**Architecture:** Add an Odoo-specific Python execution parser and adapter behind `demo_v2/server/adapters/odoo/`. The adapter materializes project methods, resolves `super()` into targeted official Odoo 19 methods, recursively follows bounded framework calls, emits generic `calls` / `reads` / `writes` references, and then lets the existing CallPathIndexerV3 do the workflow reconstruction.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing `simple-git` Odoo source cache, existing LeMap semantic topology and CallPathIndexerV3.

**Spec:** `lemap-odoo/docs/specs/2026-09-14-odoo-execution-bridge-design.md`

## Global Constraints

- Keep the existing Moqui path unchanged.
- Do not create an Odoo-specific workflow engine.
- Framework execution discovery must begin from project-triggered methods.
- Do not enumerate all Odoo methods or all Odoo workflows.
- Cross-layer method references must be qualified and deterministic.
- Default framework recursion is bounded to depth 6 and 250 framework methods.
- Entity relationships support execution evidence; they do not drive workflow traversal.

---

### Task 1: Parse Odoo Python methods and execution references

**Files:**
- Create: `demo_v2/server/adapters/odoo/pythonExecutionParser.js`
- Create: `demo_v2/server/adapters/odoo/pythonExecutionParser.test.js`

**Interfaces:**
- Produces: `extractOdooExecution(sourcePath, source, addon) -> { models, methods }`
- Each method includes `{ modelName, methodName, line, signature, body, calls }`.
- Calls include deterministic kinds: `super`, `self`, `model`, `read`, `write`.

- [ ] **Step 1: Write failing parser tests**

Use a fixture with `_inherit = 'mrp.production'`, `def action_confirm`, `super().action_confirm()`, `self._create_moves()`, `self.env['stock.move'].search(...)`, and `self.write(...)`. Assert model/method identity and call classifications.

- [ ] **Step 2: Run RED**

```bash
cd demo_v2
node --test server/adapters/odoo/pythonExecutionParser.test.js
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement deterministic indentation-aware extraction**

Parse Odoo model classes using the existing `extractOdooModels()` model identities, locate class ranges, locate `def` / `async def` methods inside those ranges, retain method bodies by indentation, and scan bodies for the supported call forms.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/adapters/odoo/pythonExecutionParser.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/adapters/odoo/pythonExecutionParser.js server/adapters/odoo/pythonExecutionParser.test.js
git commit -m "feat: parse Odoo method execution evidence"
```

---

### Task 2: Materialize project methods and bridge `super()` into targeted Odoo source

**Files:**
- Create: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Create: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

**Interfaces:**
- Produces: `new OdooExecutionAdapter(topology, options).augment()`.
- Returns `{ projectMethods, frameworkMethods, bridgedSuperCalls, unresolvedCalls, source }`.

- [ ] **Step 1: Write failing adapter test with tiny project + framework fixtures**

Project fixture:

```python
class MrpProduction(models.Model):
    _inherit = 'mrp.production'
    def action_confirm(self):
        result = super().action_confirm()
        self._acme_after_confirm()
        return result
```

Framework fixture:

```python
class MrpProduction(models.Model):
    _name = 'mrp.production'
    def action_confirm(self):
        self._create_moves()
    def _create_moves(self):
        self.env['stock.move'].create({})
```

Assert the topology contains a project symbol calling the qualified framework `action_confirm`, which calls qualified framework `_create_moves`, and `_create_moves` has a `writes` reference to `stock.move`.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/executionAdapter.test.js
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement project method materialization**

Scan only tracked project `models/*.py` files. Create semantic symbols named `odoo-project:<model>.<method>` with source provenance. Convert `self.foo()` to project-local qualified method references when the method exists in the same project model; unresolved `self.foo()` on an extension is eligible for framework resolution.

- [ ] **Step 4: Implement targeted framework method resolution**

Reuse `ensureOdooSource`, `resolveOdooModuleClosure`, and `findOdooModelFiles`. For each framework target `{modelName, methodName}`, parse only matching model files, materialize `odoo<version>:<model>.<method>`, then enqueue its supported `self` / explicit model calls up to `maxDepth=6`, `maxFrameworkMethods=250`.

`super().foo()` from a project extension must target `odoo<version>:<model>.foo`.

- [ ] **Step 5: Add generic execution references**

Emit only existing LeMap relation names:

```text
method call -> calls
ORM read/search/browse/read/mapped/filtered -> reads
ORM create/write/unlink -> writes
```

Reindex symbols and rebuild callers after materialization.

- [ ] **Step 6: Run GREEN**

```bash
node --test server/adapters/odoo/executionAdapter.test.js server/adapters/odoo/pythonExecutionParser.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/adapters/odoo/executionAdapter.js server/adapters/odoo/executionAdapter.test.js
git commit -m "feat: bridge ACME methods into Odoo execution"
```

---

### Task 3: Plug Odoo execution into the existing topology and call-path indexer

**Files:**
- Modify: `demo_v2/server/adapters/odoo/index.js`
- Modify: `demo_v2/server/progressiveRepositoryTopologyV9.js`
- Create: `demo_v2/server/adapters/odoo/executionIntegration.test.js`

**Interfaces:**
- `createOdooAdapters()` returns `{ entitySchema, frameworkEnricher, execution }`.
- Odoo `prepare()` returns `odooExecution` summary and builds CallPathIndexerV3 only after execution augmentation.

- [ ] **Step 1: Write failing integration test**

Construct a minimal topology fixture where an ACME project method bridges into two framework methods. Assert `callPathIndexer.build()` produces a path containing project and framework signatures in sequence.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/executionIntegration.test.js
```

Expected: FAIL because Odoo runtime does not expose execution augmentation.

- [ ] **Step 3: Wire adapter factory and V9 Odoo prepare path**

Run project schema augmentation, framework schema enrichment, then execution augmentation, then build the existing call-path index. Preserve the entire non-Odoo/Moqui branch unchanged.

- [ ] **Step 4: Run GREEN and focused regression**

```bash
node --test server/adapters/odoo/*.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/adapters/odoo/index.js server/progressiveRepositoryTopologyV9.js server/adapters/odoo/executionIntegration.test.js
git commit -m "feat: feed Odoo execution into LeMap call paths"
```

---

### Task 4: Verify full suite and ACME smoke behavior

**Files:**
- Modify: `lemap-odoo/README.md`

- [ ] **Step 1: Run full test suite**

```bash
cd demo_v2
npm test
```

Expected: all tests pass, including existing Moqui tests.

- [ ] **Step 2: Document smoke command**

Document a compact command that prints `odooExecution` and the top reconstructed call paths without dumping full schemas.

- [ ] **Step 3: Commit docs**

```bash
git add ../lemap-odoo/README.md
git commit -m "docs: verify Odoo execution bridge"
```

- [ ] **Step 4: Real ACME verification**

Run `ProgressiveRepositoryTopologyV9.prepare('https://github.com/thallukrish/acme-ems-odoo')` and inspect whether at least one top call path crosses from an `odoo-project:` ACME symbol to an `odoo19:` framework symbol. If ACME currently has no overriding method that calls `super()`, report that fact rather than fabricating a cross-layer path; the deterministic bridge remains verified by fixtures and will activate when such a path exists.
