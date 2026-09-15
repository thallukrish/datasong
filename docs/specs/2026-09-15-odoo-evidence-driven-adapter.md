# Odoo Evidence-Driven Adapter

## Status

Approved target design for the first Odoo-focused implementation slice of the canonical adapter architecture.

This design preserves the current LeMap learning pipeline. Odoo-specific evidence resolution happens below the generic call-path indexer. Pass 1, Pass 2 and persisted semantic-map behavior remain unchanged.

## Goal

Build an Odoo adapter that can determine how much of an enterprise workflow is provable from static repository/framework evidence, identify concrete UI/framework entrypoints, and explicitly request runtime evidence when enterprise-specific branch selection cannot be established statically.

## Evidence model

The adapter evaluates Odoo evidence in increasing strength:

```text
custom repository
    ↓
manifest / installed-module scope
    ↓
XML/UI/action entrypoints
    ↓
Python/Odoo framework source
    ↓
configuration/data-dependent branch points
    ↓
runtime trace when static evidence is insufficient
```

Static source says what can happen. UI/action metadata says what can be triggered. Enterprise configuration/data constrains which branches are applicable. Runtime traces say what actually happened.

Production database access is not a requirement and must not be assumed. When runtime evidence is needed, the intended deployment path is an isolated synthetic Odoo instance loaded with representative configuration/data.

## Adapter outputs

All structural facts use the canonical node/link representation already defined in `2026-09-15-canonical-adapter-topology-architecture.md`.

The Odoo adapter contributes:

```text
function / framework operation
entity
field

calls
reads
writes
has field
relates to
```

It may also return assessment metadata that is not itself inserted as executable topology:

```text
entrypoints[]
ambiguousBoundaries[]
runtimeEvidenceRequired
runtimeEvidenceReasons[]
evidenceLevel
```

## UI and action entrypoints

The Odoo adapter should statically recognize framework-specific execution entrances where the repository/XML proves them, including at minimum:

```text
<button type="object" name="method_name">
ir.actions.server code that invokes a model method
post_init_hook from __manifest__.py
```

For an object button, the enclosing `ir.ui.view` model supplies the logical Odoo model where available:

```text
view model = sale.order
button name = action_confirm

=> sale.order.action_confirm
```

A menu or `ir.actions.act_window` that merely opens a model/view is not by itself a business-method call. It contributes UI/entity evidence but not a fabricated function edge.

## Static framework expansion

Once an entrypoint or explicit project call resolves to an Odoo method, the existing Odoo framework-source expansion remains responsible for tracing framework methods through Odoo source and emitting ordinary `calls`, `reads`, and `writes` relationships.

Example:

```text
sale.order.action_confirm
    ↓ calls
sale.order._action_confirm
    ↓ calls
sale.order.line._action_launch_stock_rule
    ↓ calls
stock.rule.run
```

If static source exposes multiple data/configuration-selected continuations, the adapter must not choose one simply because it exists in the framework.

## Runtime-evidence boundary

When the adapter reaches a framework decision whose enterprise branch depends on runtime/configuration/data that is not available as trustworthy static evidence, it records an unresolved runtime boundary.

Example:

```text
stock.rule.run
    ├─ possible → _run_pull
    ├─ possible → _run_buy
    └─ possible → _run_manufacture
```

Without evidence proving which enterprise branch is applicable, the adapter reports:

```text
runtimeEvidenceRequired = true
ambiguousBoundary = stock.rule.run
```

It does not promote all possible branches into the enterprise workflow.

## Runtime-augmented mode

A later runtime collector may supply observed Odoo method/event traces from a synthetic instance.

The adapter uses observed methods as anchors into the framework repository:

```text
runtime trace
    ↓
observed Odoo methods
    ↓
map to Odoo framework source
    ↓
validate/fill static call-chain gaps
    ↓
canonical topology
    ↓
existing CallPathIndexer
```

Runtime evidence chooses the enterprise-relevant route; framework source explains and validates how that route is connected.

The runtime trace itself is not the final semantic workflow. Pass 1 and Pass 2 still perform semantic reconstruction.

## Field-only extensions

An addon may extend Odoo models without introducing executable methods:

```python
class MrpProduction(models.Model):
    _inherit = 'mrp.production'
    ems_revision_id = fields.Many2one('acme.bom.revision')
```

This emits valid entity/field structure but no call edge.

If no usable UI/action entrypoint or project/framework execution anchor exists for the relevant business behavior, workflow discovery remains incomplete and the adapter reports the need for runtime evidence rather than fabricating a workflow from fields.

## Evidence levels

The adapter should distinguish:

```text
static      source/XML proves a possible structural path
configured  trustworthy configuration/data proves branch applicability
observed    runtime trace proves the path executed
```

The first implementation only needs to expose these labels and mark static/runtime-required states. Full configuration-data reasoning and runtime trace ingestion can be added incrementally.

## ACME acceptance case

For `acme-ems-odoo` the first assessment should establish:

1. ACME manifests identify the Odoo modules in scope.
2. ACME custom XML mostly exposes custom list/form actions and menus rather than the standard Sale/MRP/Purchase business method entrypoints.
3. Standard Odoo module XML/source may expose candidate business entrypoints such as confirmation methods.
4. Framework source can statically expand from those methods until data/configuration-selected branches become ambiguous.
5. At an unresolved branch such as procurement rule selection, the adapter reports runtime evidence required.
6. A future synthetic Odoo runtime can execute representative scenarios, provide observed method anchors, and let the adapter validate the enterprise-specific call path before it reaches the generic CallPathIndexer.

## Non-goals for the first slice

- no production DB access
- no synthetic Odoo runner yet
- no runtime instrumentation yet
- no PostgreSQL adapter yet
- no changes to Pass 1 / Pass 2
- no replacement of current call-path indexing
- no eager parsing of the whole Odoo framework

## Architectural invariant

> The Odoo adapter must return only what the available evidence can support. Static source defines possibilities; UI/action metadata defines triggerable entrances; configuration/data may narrow branches; runtime evidence is required when enterprise-specific execution cannot otherwise be established. The generic CallPathIndexer sees only the resolved canonical topology, never Odoo-specific ambiguity logic.
