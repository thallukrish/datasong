# Odoo First-Class Entity and Persistence Evidence Implementation Plan

**Goal:** Enrich the existing Odoo structural topology with first-class model/method identity, cross-model versus same-model call classification, ORM/SQL persistence evidence, and explicit traversal termination reporting without changing CallPathIndexer or Pass 1 / Pass 2 semantics.

**Architecture:** Keep the Odoo adapter responsible only for structural typing. Extend parser output and topology reference metadata so existing generic call-path processing can distinguish high-yield Odoo model boundaries and durable persistence landmarks from lower-yield implementation helpers. Preserve every supported edge; classification is evidence and priority input, not semantic pruning.

**Tech Stack:** Node.js ES modules, existing Odoo adapter regex/pattern registry, existing canonical topology symbols/references, Node test runner.

**Spec:** `docs/specs/2026-09-16-odoo-first-class-entity-and-persistence-evidence.md`

## Global Constraints

- Do not create an Odoo-specific semantic workflow engine.
- Do not modify Pass 1 / Pass 2 semantics for Odoo.
- Do not hardcode ACME model names, methods, addons or outcomes.
- Preserve CallPathIndexer V3 and the existing canonical graph representation.
- Treat cross-model boundaries as strong structural signals, same-model calls as neutral, and helper/library calls as lower-yield but retained.
- Keep logical Odoo entities distinct from physical persisted entities.
- Treat persistence as a structural checkpoint, not an automatic semantic terminal.
- Runtime evidence is out of scope for this slice.
- When the implementation intent is already known, implement directly and use tests as regression verification rather than performing ceremonial fail/pass cycles.

---

## Files and responsibilities

### Existing files to modify

`demo_v2/server/adapters/odoo/pythonExecutionParser.js`
- Preserve richer call identity from parsed Odoo/Python expressions.
- Emit enough information to classify ORM CRUD and plain/helper calls.
- Add statically recognizable explicit SQL candidates.

`demo_v2/server/adapters/odoo/recordsetCallResolver.js`
- Centralize ORM method → CRUD classification.
- Preserve model identity through recordset-preserving chains.

`demo_v2/server/adapters/odoo/executionAdapter.js`
- Mark framework/project method symbols as first-class Odoo methods.
- Classify executable edges as cross-model/same-model/helper where resolvable.
- Attach ORM CRUD evidence to logical entities.
- Attach explicit SQL CRUD evidence to persisted entities where statically resolvable.
- Report truncation and termination statistics.

`demo_v2/scripts/acme-odoo-assessment.js`
- Print structural coverage metrics and truncation state.
- Keep current cross-repo path output.

### Existing tests to modify/add

`demo_v2/server/adapters/odoo/pythonExecutionParser.test.js`
- Regression coverage for ORM CRUD classification and SQL extraction.

`demo_v2/server/adapters/odoo/executionAdapter.test.js`
- Regression coverage for first-class method metadata, cross-model/same-model classification, persistence references, and truncation reporting.

`demo_v2/server/adapters/odoo/relationalFieldExecution.test.js`
- Verify relational field calls remain classified as cross-model once the related model is resolved.

### Optional focused helper file if executionAdapter becomes unwieldy

`demo_v2/server/adapters/odoo/structuralClassification.js`
- Pure helpers for boundary and CRUD classification.
- Create only if doing so keeps `executionAdapter.js` materially clearer; do not split for ceremony.

---

## Task 1: Add a small canonical structural classification vocabulary

**Files:**
- Modify: `demo_v2/server/adapters/odoo/recordsetCallResolver.js`
- Modify: `demo_v2/server/adapters/odoo/pythonExecutionParser.js`
- Test: `demo_v2/server/adapters/odoo/pythonExecutionParser.test.js`

**Produces:**

Parsed calls should preserve fields like:

```js
{
  kind: 'read' | 'write' | 'self' | 'model' | 'field' | 'super' | 'dynamic_model' | 'sql',
  modelName,
  methodName,
  crud: 'create' | 'read' | 'update' | 'delete' | '',
  persistenceKind: 'odoo_orm' | 'sql' | '',
  fieldName?,
  methodPrefix?,
  methodSuffix?,
  sqlOperation?,
  persistedEntity?
}
```

**Implementation steps:**

- [ ] Extend ORM method classification so current method sets map to canonical CRUD verbs rather than only `read`/`write`.

Expected baseline mapping:

```text
create                    → create
search/browse/read/
mapped/filtered/
search_read/search_count  → read
write                     → update
unlink                    → delete
```

- [ ] Preserve existing `kind` values for compatibility while adding `crud` and `persistenceKind: 'odoo_orm'`.

- [ ] Add static recognition for explicit cursor SQL forms commonly used in Odoo, beginning with direct literal SQL passed to forms such as:

```python
self.env.cr.execute("UPDATE stock_move SET ...")
env.cr.execute('SELECT ... FROM stock_quant')
```

Only emit concrete `persistedEntity` when a literal statement exposes one unambiguously. Otherwise retain a SQL operation with unresolved persisted target.

- [ ] Add regression tests covering all four ORM CRUD classes, recordset-preserving chains, and literal SQL SELECT/INSERT/UPDATE/DELETE extraction.

- [ ] Run the focused parser tests and existing Odoo parser tests.

---

## Task 2: Mark Odoo models and methods as first-class structural objects

**Files:**
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Test: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

**Produces:**

Project/framework executable symbols should carry:

```js
symbol.odooExecution = {
  ...existingFields,
  firstClassEntity: true,
  firstClassMethod: true,
  modelName,
  methodName
}
```

This does not create a new graph schema; it enriches existing symbol metadata.

**Implementation steps:**

- [ ] Add `firstClassEntity: true` and `firstClassMethod: true` to project methods backed by a resolved Odoo model.

- [ ] Add the same metadata to framework methods discovered from Odoo source.

- [ ] Keep manifest hooks distinct. A lifecycle hook is an executable entrypoint but is not itself an Odoo model method.

- [ ] Add regression assertions showing `sale.order.action_confirm`-style synthetic test methods are marked first-class while project hooks are not mislabeled.

- [ ] Run execution adapter tests.

---

## Task 3: Classify executable Odoo call boundaries

**Files:**
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Test: `demo_v2/server/adapters/odoo/executionAdapter.test.js`
- Test: `demo_v2/server/adapters/odoo/relationalFieldExecution.test.js`

**Produces:**

Executable references should retain current relation names, especially `calls`, while adding structural metadata such as:

```js
{
  name: 'odoo19:stock.rule.run',
  relation: 'calls',
  explicit: true,
  data: {
    framework: 'odoo',
    boundaryKind: 'cross_model',
    sourceModel: 'sale.order.line',
    targetModel: 'stock.rule'
  }
}
```

Supported `boundaryKind` values for this slice:

```text
cross_model
same_model
helper_or_library
```

**Implementation steps:**

- [ ] Extend the existing `addReference` helper so callers may attach optional metadata without changing reference resolution semantics.

- [ ] When source and target Odoo model identities are both known, classify `A != B` as `cross_model` and `A == B` as `same_model`.

- [ ] Ensure relational-field calls become `cross_model` after the field comodel is resolved.

- [ ] Ensure dynamic model dispatch retains source/target model identity and classifies the edge accordingly.

- [ ] Do not infer `helper_or_library` for unresolved Odoo model calls. Use it only where the target is structurally known not to be a first-class Odoo model method.

- [ ] Add focused tests for same-model, env-model cross-model, relational-field cross-model, and dynamic-dispatch cases.

- [ ] Run execution and relational-field regression tests.

---

## Task 4: Attach ORM persistence evidence to logical entities

**Files:**
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Test: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

**Produces:**

Keep existing generic `reads` / `writes` relations so current consumers remain compatible, but attach canonical persistence metadata:

```js
{
  name: 'mrp.production',
  relation: 'writes',
  explicit: true,
  data: {
    operationKind: 'persistence',
    persistenceKind: 'odoo_orm',
    crud: 'create',
    logicalEntity: 'mrp.production'
  }
}
```

Similarly:

```text
search/read  → relation reads  + crud read
create       → relation writes + crud create
write        → relation writes + crud update
unlink       → relation writes + crud delete
```

**Implementation steps:**

- [ ] Preserve `call.methodName`/`call.crud` from parser to adapter.

- [ ] Enrich project-hook and project/framework-method ORM references with logical entity and CRUD metadata.

- [ ] Do not turn `reads`/`writes` into executable `calls`; CallPathIndexer behavior remains unchanged in this task.

- [ ] Add tests proving CRUD subtype survives onto symbol references.

- [ ] Run focused Odoo execution tests.

---

## Task 5: Attach explicit SQL persistence evidence to persisted entities

**Files:**
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Test: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

**Produces:**

For safely parsed literal SQL:

```js
{
  name: 'stock_move',
  relation: 'writes',
  data: {
    operationKind: 'persistence',
    persistenceKind: 'sql',
    crud: 'update',
    persistedEntity: 'stock_move'
  }
}
```

Unresolved table targets should be recorded in persistence coverage rather than fabricated.

**Implementation steps:**

- [ ] Convert parser SQL candidates to `reads`/`writes` references on persisted entity names when concrete.

- [ ] Keep physical SQL targets separate from logical Odoo entity names. Do not auto-create `persistedAs` from simple underscore/dot name conversion.

- [ ] Record unresolved SQL persistence targets separately from unresolved executable calls.

- [ ] Add tests for literal SELECT and UPDATE/INSERT/DELETE plus one dynamic/unresolved SQL statement.

- [ ] Run focused tests.

---

## Task 6: Make static traversal completeness explicit

**Files:**
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Modify: `demo_v2/scripts/acme-odoo-assessment.js`
- Test: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

**Produces:**

Execution result additions:

```js
{
  truncated: boolean,
  remainingFrameworkQueue: number,
  maxFrameworkMethods: number,
  structuralStats: {
    firstClassMethods,
    crossModelCalls,
    sameModelCalls,
    helperCalls,
    ormReads,
    ormCreates,
    ormUpdates,
    ormDeletes,
    sqlReads,
    sqlCreates,
    sqlUpdates,
    sqlDeletes
  },
  unresolvedPersistence: []
}
```

**Implementation steps:**

- [ ] Detect the case where `visited.size >= maxFrameworkMethods` while `pendingFramework.length > 0` and set `truncated: true`.

- [ ] Return remaining queue length and configured cap.

- [ ] Count structural categories from the evidence actually emitted rather than from parser candidates that may never enter the topology.

- [ ] Keep existing `unresolvedCalls` and add `unresolvedPersistence` instead of mixing the two.

- [ ] Extend `acme-odoo-assessment.js` with a compact structural coverage section showing these metrics.

- [ ] Make assessment output explicitly warn when static traversal is truncated; a boundary PASS must not be read as full static coverage.

- [ ] Add a synthetic low-cap test proving truncation/remaining queue reporting.

- [ ] Run the assessment after focused tests.

---

## Task 7: Verify parity with the existing Moqui handoff contract

**Files:**
- No required production changes unless verification exposes a missing generic field.
- Potential test/document update only.

**Verification target:**

The Odoo topology should expose the same classes of structural evidence that make the Moqui path useful, even though the source syntax differs:

```text
Moqui DSL                     Odoo structural equivalent
-----------                   --------------------------
service-call                  first-class model/method call
entity-find                   ORM read
entity-create                 ORM create
entity-update                 ORM update
entity-delete                 ORM delete
explicit data mutation        SQL CRUD / persisted entity
condition/alternate action    dynamic/call branch topology
```

**Implementation steps:**

- [ ] Run the existing Odoo unit/integration suite.

- [ ] Run `npm run assess:acme` on the ACME repository.

- [ ] Confirm the previously discovered path still includes:

```text
sale.order
→ sale.order.line
→ stock.rule
→ stock.rule._run_manufacture
→ mrp.production
```

- [ ] Confirm output now identifies cross-model handoffs and ORM persistence checkpoints rather than only printing a flat method count.

- [ ] Confirm the current CallPathIndexer V3 remains unchanged unless a generic bug, reproducible for both frameworks, is discovered.

- [ ] Confirm no production recognizer contains ACME-specific model, method or addon names.

---

## Definition of done

This implementation slice is complete when:

```text
1. Odoo model-owned methods are explicitly marked as first-class framework methods.
2. Executable Odoo edges distinguish cross-model from same-model calls.
3. ORM CRUD carries canonical CRUD subtype and logical entity identity.
4. Explicit SQL CRUD carries persisted-entity identity when statically provable.
5. Logical and persisted entity identities remain distinct.
6. Static traversal reports truncation instead of silently stopping at the safety cap.
7. Existing ACME cross-repo manufacturing path remains discoverable.
8. Existing CallPathIndexer V3 and Pass 1 / Pass 2 remain framework-neutral.
```

The next decision after this slice is evidence-driven: inspect what Pass 1 / Pass 2 receive from the enriched Odoo topology and compare it directly with Moqui. Do not add Odoo-specific semantic logic unless that comparison demonstrates a concrete generic contract gap.
