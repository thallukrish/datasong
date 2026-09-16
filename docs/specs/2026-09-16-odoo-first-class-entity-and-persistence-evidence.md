# Odoo First-Class Entity and Persistence Evidence

## Status

This document refines the canonical adapter topology architecture for the Odoo implementation.

It does **not** introduce a second Odoo workflow engine, semantic ranker, or replacement for CallPathIndexer / Pass 1 / Pass 2.

The goal is narrower: make Odoo emit structural evidence with enough fidelity that the existing generic call-path and semantic-learning pipeline receives evidence comparable in usefulness to the existing Moqui path.

---

## 1. Why this refinement is needed

Moqui exposes workflow-relevant operations directly through its DSL:

```text
service-call
entity-find
entity-create
entity-update
entity-delete
condition / if / else
response / route
```

The Moqui adapter can therefore emit structurally typed execution nodes and edges without deciding business meaning.

Odoo expresses equivalent behavior through ordinary Python and framework conventions:

```text
model methods
self.env['model'] access
relational recordsets
ORM create/search/write/unlink
super()
dynamic dispatch
helper functions
plain Python/library calls
explicit SQL
```

A function-call graph alone is too coarse. It can spend large amounts of traversal effort inside utility/helper/framework plumbing while the business-important evidence is a cross-model call or a durable persistence mutation.

The Odoo adapter should therefore preserve stronger structural classifications before CallPathIndexer and Pass 1 / Pass 2 run.

---

## 2. Responsibility boundary

The architecture remains:

```text
Odoo/Python source
      ↓
Odoo adapter structural extraction
      ↓
canonical structural topology
      ↓
CallPathIndexer V3
      ↓
Pass 1
      ↓
Pass 2
      ↓
persistent semantic LeMap
```

Responsibilities are deliberately separated.

### Odoo adapter

Determines what can be proven structurally:

```text
which Odoo model owns a method
whether a call stays on the same Odoo model
whether a call crosses to another Odoo model
whether an ORM operation reads/writes a logical entity
whether explicit SQL reads/writes a persisted entity
whether a call target is only a plain helper/library target
source/provenance for all of the above
```

### CallPathIndexer

Remains generic and responsible for:

```text
root discovery
branch expansion
cycle safety
path compression
shared-subflow handling
alternate entrances
path grouping
```

### Pass 1 / Pass 2

Remain responsible for semantic questions:

```text
which branches are business-relevant
which functions together implement one workflow step
which helper paths are noise
where a semantic workflow begins/ends
how structural paths combine into enterprise workflows
```

The Odoo adapter must not try to answer those semantic questions.

---

## 3. Canonical Odoo classifications

The Odoo adapter should distinguish the following structural categories explicitly.

### 3.1 First-class Odoo entity

An Odoo model represented by `_name`, `_inherit`, composed model schema, or other adapter-supported framework evidence.

Examples:

```text
sale.order
sale.order.line
stock.rule
stock.move
mrp.production
```

Suggested metadata:

```text
framework: odoo
frameworkVersion: 19
firstClassEntity: true
modelName: mrp.production
```

The entity, not the method, is the first-class business/framework object.

### 3.2 First-class Odoo method

A method owned by a first-class Odoo model.

Examples:

```text
sale.order.action_confirm
stock.rule.run
mrp.production.action_confirm
```

Suggested metadata:

```text
framework: odoo
modelName: stock.rule
firstClassMethod: true
```

### 3.3 Cross-model call

A call from a method owned by model A to a method/operation on model B where `A != B`.

Examples:

```text
sale.order
  → sale.order.line._action_launch_stock_rule

sale.order.line
  → stock.rule.run

stock.rule
  → mrp.production.create
```

This is a strong structural signal because the execution path crosses a logical Odoo entity boundary.

Suggested edge metadata:

```text
boundaryKind: cross_model
sourceModel: sale.order.line
targetModel: stock.rule
```

This is a priority signal for exploration, not a semantic verdict.

### 3.4 Same-model call

A call where source and target methods belong to the same Odoo model.

Example:

```text
mrp.production.action_confirm
  → mrp.production._create_update_move_finished
```

Suggested edge metadata:

```text
boundaryKind: same_model
sourceModel: mrp.production
targetModel: mrp.production
```

Same-model calls are not unimportant. They are simply weaker structural signals than a newly exposed model boundary.

### 3.5 Plain helper/library call

A call that cannot be tied to a first-class Odoo model or known persistence/external operation.

Examples may include:

```text
formatting helpers
ordinary Python utility functions
logging helpers
cache helpers
third-party library calls with no modeled enterprise boundary
```

Suggested metadata:

```text
boundaryKind: helper_or_library
```

These calls remain available as evidence and may be followed, but they should not be confused with first-class Odoo model transitions.

---

## 4. Persistence is first-class structural evidence

Persistence operations are workflow-significant structural landmarks even though their business meaning is deferred to Pass 1 / Pass 2.

The adapter should preserve logical and physical persistence separately.

### 4.1 Odoo ORM operation

Examples:

```python
self.env['mrp.production'].create(vals)
orders.search(domain)
record.write(values)
record.unlink()
```

Normalize to structural operations such as:

```text
CREATE logical entity mrp.production
READ logical entity sale.order
UPDATE logical entity stock.move
DELETE logical entity some.model
```

Suggested operation metadata:

```text
operationKind: persistence
persistenceKind: odoo_orm
crud: create | read | update | delete
logicalEntity: mrp.production
```

The call site should retain provenance to the owning model method and source lines.

### 4.2 Persisted entity

Logical Odoo entities may map to physical persisted entities when evidenced.

Example:

```text
entity mrp.production
  ↓ persistedAs
persisted_entity postgres.public.mrp_production
```

Do not infer this mapping solely from naming convention when stronger metadata/database evidence is available.

Odoo `_table`, transient/abstract model behavior, SQL views, inheritance and other framework mechanisms can invalidate naive name conversion.

### 4.3 Explicit SQL CRUD

Explicit SQL should also be structural evidence.

Examples:

```text
SQL SELECT  → reads  → persisted_entity
SQL INSERT  → writes → persisted_entity
SQL UPDATE  → writes → persisted_entity
SQL DELETE  → writes → persisted_entity
```

Suggested metadata:

```text
operationKind: persistence
persistenceKind: sql
crud: create | read | update | delete
persistedEntity: stock_move
```

If SQL text cannot be safely resolved to a concrete table, retain an unresolved persistence boundary rather than fabricating one.

---

## 5. Structural exploration priority

The generic topology must retain all supported evidence, but Odoo may expose priority hints so exploration can spend effort where structural yield is higher.

The priority hints are not semantic relevance scores.

Suggested ordering:

```text
very strong signal
  cross-model first-class Odoo call
  ORM create/update/delete
  explicit SQL insert/update/delete
  newly exposed first-class Odoo entity

strong signal
  ORM read/search on a first-class entity
  external durable mutation/event/queue operation when structurally recognized

neutral signal
  same-model Odoo method call

weaker signal
  plain helper/library call
  repeated framework utility subtree
```

Important invariant:

```text
cross-model = explore earlier
same-model  = continue normally
helper      = lower priority, not discarded
```

A same-model call may contain the heart of a workflow and must not be pruned simply because it stays within one model.

---

## 6. Persistence is a checkpoint, not automatically a semantic terminal

A durable mutation is a strong structural landmark but does not itself prove that the business workflow has ended.

Example:

```text
CREATE mrp.production
  → action_confirm
  → create stock moves
```

Stopping immediately at `CREATE mrp.production` would lose downstream workflow structure.

Therefore distinguish:

```text
technical leaf
  no supported executable continuation

persistence checkpoint
  durable state mutation occurred

semantic workflow terminal
  Pass 1 / Pass 2 conclusion about business meaning
```

Only the last one is semantic.

---

## 7. Expected Odoo structural shape

The target static evidence for the current ACME path is conceptually:

```text
sale.order.action_confirm
  ↓ same-model / framework dispatch
sale.order._action_confirm
  ↓ cross-model
sale.order.line._action_launch_stock_rule
  ↓ cross-model
stock.rule.run
  ↓ dynamic branch family
{
  stock.rule._run_pull
  stock.rule._run_manufacture
  ...
}

stock.rule._run_manufacture
  ↓ ORM CREATE
entity mrp.production
  ↓ persistedAs (when evidenced)
persisted_entity postgres.public.mrp_production
  ↓ executable continuation if present
mrp.production.action_confirm
```

The structural topology may also contain lower-yield helper branches, but first-class model boundaries and persistence checkpoints remain clearly identifiable to the generic pipeline.

---

## 8. Coverage and termination reporting

Static traversal must report why expansion stopped.

At minimum distinguish:

```text
end
  no supported executable continuation

cycle
  already active in current path

unresolved
  target recognized but not resolved

unsupported_boundary
  another technology/library/framework is required

safety_cap
  configured structural expansion limit reached
```

If a safety cap is reached, it must be visible in assessment output together with remaining queued work. A capped walk must never be presented as complete static coverage.

For Odoo assessment, report at least:

```text
first-class methods discovered
cross-model executable edges
same-model executable edges
ORM reads
ORM creates
ORM updates
ORM deletes
explicit SQL CRUD
unresolved executable boundaries
unresolved persistence boundaries
truncated: true/false
remaining queued methods if truncated
```

---

## 9. Relationship to Moqui

This refinement does not require Odoo to imitate Moqui syntax.

It requires comparable structural usefulness.

Moqui receives framework typing directly from its DSL:

```text
service-call
entity-create
entity-update
entity-delete
condition
response
```

Odoo should derive equivalent structural landmarks from framework-aware Python evidence:

```text
first-class model method
cross-model call
same-model call
ORM CRUD
explicit SQL CRUD
dynamic framework dispatch
```

Both then feed the same CallPathIndexer and Pass 1 / Pass 2 layers.

---

## 10. Implementation constraints

1. Do not create an Odoo-specific semantic workflow engine.
2. Do not modify Pass 1 / Pass 2 semantics merely to accommodate Odoo.
3. Do not hardcode ACME model names, methods, modules or workflow outcomes.
4. Recognizers must describe common Odoo/Python patterns reusable across repositories.
5. Preserve the current canonical graph representation and CallPathIndexer V3.
6. Preserve all supported structural evidence; priority hints influence traversal order, not truth.
7. Keep logical Odoo entities distinct from physical persisted entities.
8. Keep ORM relationships distinct from physical database foreign keys unless evidence proves the physical relationship.
9. Persistence operations are checkpoints, not automatic semantic terminals.
10. Runtime evidence is a later phase; finish static structural fidelity first.

---

## 11. Immediate implementation target

The next implementation slice should make the existing Odoo execution topology explicitly carry:

```text
firstClassEntity / firstClassMethod identity
cross_model vs same_model vs helper/library classification
ORM CRUD operation evidence
persisted-entity / explicit SQL CRUD evidence where statically available
termination/truncation reason reporting
```

Then run the existing ACME assessment and verify that the current path remains discoverable while the output gains structural landmarks such as:

```text
sale.order → sale.order.line → stock.rule → mrp.production
```

and persistence checkpoints such as:

```text
stock.rule._run_manufacture
  → CREATE mrp.production
```

Only after this contract is solid should we evaluate whether Pass 1 / Pass 2 need any additional generic evidence fields. The default assumption is that they should not require Odoo-specific behavior.
