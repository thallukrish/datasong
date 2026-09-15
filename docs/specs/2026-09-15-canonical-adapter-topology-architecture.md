# Canonical Adapter Topology Architecture

## Status

This document records the target architecture agreed for the next LeMap learning refactor.

It is a design specification only. It does not imply that the adapter-runtime refactor, PostgreSQL adapter, or full Odoo traversal described here is already implemented.

The design deliberately preserves the current LeMap semantic-learning and persistence model. The change is primarily below Pass 1 / Pass 2, where heterogeneous source, framework and persistence evidence is normalized into one structural topology before the existing call-path processing runs.

---

## 1. Core idea

LeMap starts from an evidence root such as a Git repository and progressively expands whatever technologies it encounters.

A repository may contain ordinary language code, framework-specific behavior, configuration, ORM entities, SQL, database access, or calls into systems whose implementation is not present locally.

LeMap should not have separate architecture for each of these cases.

Instead:

```text
repository / evidence root
        ↓
detect recognizable patterns
        ↓
select configured adapter
        ↓
adapter emits canonical structural nodes + links
        ↓
merge into one structural topology
        ↓
continue through newly exposed boundaries
        ↓
existing call-path sorting / compression / grouping
        ↓
Pass 1
        ↓
Pass 2
        ↓
persistent semantic LeMap
```

The key abstraction is the adapter boundary.

Language parsers, framework parsers and persistence parsers are all adapters. Their implementation differs, but their output joins the same topology.

---

## 2. One canonical adapter output

Every adapter emits a fragment using the same node/link representation:

```text
[
  {
    id,
    type,
    name,
    data,
    links: [
      {
        nodeId,
        relationship,
        cardinality?,
        data?,
        confidence?
      }
    ]
  }
]
```

This intentionally follows the existing LeMap graph representation instead of introducing a second incompatible graph schema.

Adapters may emit different node types, but not different graph formats.

Typical structural node types are:

```text
function
entity
field
persisted_entity
persisted_field
external_operation
```

Typical structural relationships are:

```text
calls
extends
reads
writes
touches
has field
relates to
persistedAs
foreign key
routes_to
triggers
returns_to
```

The vocabulary can grow, but the representation remains nodes plus typed links.

A function call is therefore only one kind of structural relationship. Adapters are not required to force declarative or persistence structure into a function-call metaphor.

---

## 3. Two kinds of structural facts

Adapters contribute two broad classes of structural evidence.

### 3.1 Executable structure

Examples:

```text
function A
    ↓ calls
function B
    ↓ calls
function C
```

or:

```text
function stock.rule._run_manufacture
    ↓ writes
entity mrp.production
```

Language and framework execution adapters mainly contribute this structure.

### 3.2 Declarative / data structure

Examples:

```text
entity mrp.production
    ↓ has field
field mrp.production.product_id
```

```text
field mrp.production.ems_revision_id
    ↓ relates to
entity acme.bom.revision
```

```text
entity mrp.production
    ↓ persistedAs
persisted_entity postgres.public.mrp_production
```

```text
persisted_field mrp_production.product_id
    ↓ foreign key
persisted_field product_product.id
```

Framework-schema and persistence adapters mainly contribute this structure.

Both are first-class structural evidence and are merged into the same topology.

---

## 4. Language adapters

A language adapter understands the execution semantics of its language well enough to expose functions/methods and statically resolvable relationships.

For example a Python adapter may emit:

```text
function post_init_hook
    ↓ calls
function _partner
```

A JavaScript adapter may emit:

```text
function checkout
    ↓ calls
function validateCart
```

The language adapter should not invent framework semantics it cannot prove.

If Python encounters:

```python
env['sale.order'].create(...)
```

or a framework-resolved receiver such as:

```python
so.action_confirm()
```

plain Python parsing may expose the expression but may not know the actual framework target. That expression becomes a boundary that another configured adapter can claim.

---

## 5. Framework adapters

A framework adapter understands semantics that ordinary language parsing cannot reliably resolve.

For Odoo this includes, among other things:

```text
_name / _inherit
Odoo model composition
self.env['model']
ORM create/search/write/unlink/etc.
super() across Odoo model extensions
framework dispatch and known dynamic operations
Odoo logical entities and fields
```

The Odoo adapter therefore extends the structural topology produced by Python rather than creating a separate Odoo map.

Example:

```text
ACME Python function
    ↓ calls
sale.order.action_confirm
    ↓ calls
sale.order._action_confirm
    ↓ calls
sale.order.line._action_launch_stock_rule
    ↓ calls
stock.rule.run
    ↓ calls
stock.rule._run_manufacture
    ↓ writes
mrp.production
```

The existing generic call-path machinery should see this as one executable topology even though different adapters contributed different parts of it.

---

## 6. Odoo extension without a function call

A framework extension is structural evidence even if it contributes no executable method call.

Example:

```python
class MrpProduction(models.Model):
    _inherit = 'mrp.production'

    ems_revision_id = fields.Many2one('acme.bom.revision')
```

The Odoo adapter should not fabricate a function edge.

Instead it enriches the existing logical entity:

```text
entity mrp.production
    ↓ has field
field mrp.production.ems_revision_id
    ↓ relates to
entity acme.bom.revision
```

The logical entity is one composed Odoo runtime model, so the preferred canonical representation is one `mrp.production` entity carrying provenance from both the Odoo base definition and the ACME extension.

Conceptually:

```text
entity mrp.production

provenance:
  - Odoo base definition
  - ACME extension definition
```

Do not create artificial duplicate entities such as:

```text
mrp.production_base
mrp.production_acme
```

unless a future use case specifically needs extension declarations as independent evidence objects.

---

## 7. Persistence adapters

Persistence is another adapter capability, not a special terminal architecture.

A PostgreSQL adapter can contribute physical structure such as:

```text
persisted_entity postgres.public.mrp_production
    ↓ has field
persisted_field postgres.public.mrp_production.product_id
```

plus physical relationships:

```text
persisted_field mrp_production.product_id
    ↓ foreign key
persisted_field product_product.id
```

When logical-to-physical mapping is evidenced, reconciliation can connect the logical model to the physical model:

```text
entity mrp.production
    ↓ persistedAs
persisted_entity postgres.public.mrp_production
```

and:

```text
field mrp.production.product_id
    ↓ persistedAs
persisted_field postgres.public.mrp_production.product_id
```

`persistedAs` must be evidence-backed. A framework naming convention may supply a candidate, but actual database metadata is the source of truth when available.

Likewise an ORM relationship and a physical database foreign key are not the same fact. They should only be represented as the same physical relationship when database evidence proves it.

SQL itself can also be represented as executable structural evidence when it is present explicitly:

```text
SQL SELECT
    ↓ reads
persisted_entity

SQL INSERT / UPDATE / DELETE
    ↓ writes
persisted_entity
```

The graph does not require every persistence operation to be represented as literal SQL. For an ORM flow it is sufficient to preserve:

```text
framework operation
    ↓ writes
logical entity
    ↓ persistedAs
physical entity
```

---

## 8. Adapter registry and boundary continuation

Repository preparation should identify the configured adapters that can participate in learning.

Examples:

```text
javascript
python
odoo19
postgres
moqui
```

Detection can use inexpensive evidence such as file extensions, imports, manifests, framework declarations, connection configuration and known call patterns.

During topology expansion:

```text
current structural node
        ↓
encounter unresolved expression / framework / datasource boundary
        ↓
ask configured adapters whether they recognize it
        ↓
claimed → adapter emits more canonical nodes/links
        ↓
continue
```

If no configured adapter can resolve a required boundary, LeMap must not fabricate the missing structure.

Instead it records an incomplete boundary and stops structural expansion through that edge:

```text
known function
    ↓
[unsupported framework / library / datasource boundary]
```

This should be reported clearly to the learner/user.

The already discovered prefix remains valid evidence.

---

## 9. Opaque systems

A future adapter may not have source code at all.

For an opaque system such as an external SAP deployment, an adapter could use API documentation, metadata or other contracts to emit canonical operations such as:

```text
external_operation
  name
  parameters
  outputs
  side effects
  provenance
```

and canonical relationships to logical entities where supported by evidence.

The source of evidence changes; the topology representation does not.

This is a future compatibility requirement, not part of the current Odoo implementation scope.

---

## 10. One structural topology before Pass 1

All configured adapters contribute to one temporary structural topology.

Example ACME / Odoo / PostgreSQL view:

```text
post_init_hook
    ↓ calls
sale.order.action_confirm
    ↓ calls
sale.order._action_confirm
    ↓ calls
sale.order.line._action_launch_stock_rule
    ↓ calls
stock.rule.run
    ↓ calls
stock.rule._run_manufacture
    ↓ writes
entity mrp.production
    ├─ has field → field product_id
    ├─ has field → field ems_revision_id
    │                  ↓ relates to
    │             entity acme.bom.revision
    │
    └─ persistedAs
          ↓
       persisted_entity postgres.public.mrp_production
          └─ has field → persisted_field product_id
```

Some parts came from Python parsing, some from Odoo framework parsing, some from ACME model declarations and some from PostgreSQL metadata.

There is still only one structural topology.

---

## 11. Existing call-path processing remains the center

The current LeMap call-path machinery should remain responsible for executable-flow preprocessing after adapters have expanded the topology.

It already performs the important generic work:

```text
root discovery
branch expansion
cycle termination
duplicate elimination
shared-subflow compression
suffix/subset handling
alternate-entrance grouping
longest / maximal path ranking
```

Adapters should not build competing workflow engines.

Their job is to make the structural topology sufficiently complete for the existing generic path processing to work across language/framework boundaries.

Only executable node/edge types participate in call-path walking. Declarative entity/field/persistence structure remains available to Pass 1 / Pass 2 and reconciliation without being forced into executable paths.

---

## 12. Pass 1 / Pass 2 remain semantic compression

The structural topology is evidence used to discover meaning.

Pass 1 and Pass 2 continue to turn executable structure and entity evidence into durable semantic knowledge such as:

```text
workflow
    ↓ contains step
semantic workflow step
    ↓ touches entity
entity
    ↓ has field
field
```

The persistent LeMap should remain the semantic enterprise map rather than becoming a dump of the entire source-level call graph.

This preserves the current architectural distinction:

```text
STRUCTURAL TOPOLOGY
functions / calls / framework dispatch / schemas / persistence evidence
        ↓
PASS 1 + PASS 2
semantic interpretation and workflow reconstruction
        ↓
PERSISTED LEMAP
workflows / semantic steps / entities / fields / relationships / persistence mappings
```

---

## 13. Structural provenance without persisting the whole call graph

The full structural call graph does not need to be duplicated in the persistent semantic map once its meaning has been reconstructed.

Instead, durable semantic claims should retain compact provenance back to the structural evidence that produced them.

For a workflow step this may include:

```text
adapter
functionId / operationId
sourcePath
startLine / endLine
callPathId
framework/version
```

A semantic step may reference more than one implementation function when several functions jointly implement the step.

Example:

```text
workflow: Sales Order to Manufacturing
    ↓ contains step
step: Launch Manufacturing
    ↓ provenance
stock.rule.run
stock.rule._run_manufacture
```

This gives Explore and debugging a direct path back to code without persisting thousands of structural function nodes as part of the semantic graph.

The current call-path provenance fields such as call-path ID, entry symbol and source paths are a useful base and can be strengthened where needed.

---

## 14. Persistent LeMap graph

The persisted graph continues to use the current canonical node/link shape:

```text
{
  id,
  type,
  name,
  data,
  links[]
}
```

Typical durable semantic nodes include:

```text
workflow
workflow step
entity
field
persisted_entity
persisted_field
```

Typical durable links include:

```text
contains step
uses entity
touches entity
has field
relates to
persistedAs
foreign key
```

The persistence map may therefore contain both semantic knowledge and deterministic data structure where the structure is itself useful durable enterprise knowledge.

The key distinction is that the full implementation call graph is learning evidence, while logical/persisted entity structure is part of the enterprise map and should remain durable.

---

## 15. Adapter output versus persisted-map output

These must not be confused.

Adapters emit canonical structural graph fragments for the learning topology.

Pass 1 / Pass 2 and reconciliation use those fragments to produce the persistent semantic map.

Therefore:

```text
adapter canonical graph format
        = nodes + links

persisted LeMap graph format
        = nodes + links
```

but their contents are not identical.

The shared representation avoids conversion into incompatible graph models, while semantic learning is still free to compress implementation detail.

A language adapter may emit hundreds of function nodes that never become persistent semantic objects. A framework adapter may emit an entity/field fact that does become durable because the logical schema is valuable enterprise knowledge. A persistence adapter may emit a table/column fact that becomes durable through `persistedAs` reconciliation.

---

## 16. Adapter responsibilities by initial implementation

### JavaScript adapter

Primarily:

```text
functions / methods
calls
callbacks / triggers where deterministically resolvable
source provenance
```

### Python adapter

Primarily:

```text
functions / methods
calls
imports / inheritance where deterministically resolvable
source provenance
unresolved framework-aware call expressions
```

### Odoo 19 adapter

Primarily:

```text
Odoo model composition
framework method resolution
super / model dispatch
ORM reads/writes
logical entities
logical fields
entity relationships
extension provenance
```

### PostgreSQL adapter

Primarily:

```text
schemas / tables
columns
PKs
FKs
SQL CRUD when explicit
logical ↔ physical mappings when evidenced
```

All four emit the same canonical node/link representation.

---

## 17. Target Odoo-first architecture

The first complete proof should remain Odoo-focused:

```text
ACME Git repository
        ↓
repository scanner
        ↓
Python adapter
        ↓
Odoo 19 adapter
        ↓
PostgreSQL adapter
        ↓
one structural topology
        ↓
existing CallPathIndexer / path grouping
        ↓
Pass 1
        ↓
Pass 2
        ↓
semantic workflow + entity map
        ↓
logical entities + fields
        ↓ persistedAs
PostgreSQL tables + columns
        ↓
Explore
```

Future SAP, MongoDB, other languages and other frameworks should fit by adding adapters rather than changing the layers above the adapter/topology boundary.

---

## 18. Architectural invariants

1. **One graph representation.** Adapters emit nodes with typed links.
2. **One structural topology.** Language, framework and persistence evidence join the same temporary topology.
3. **No fabricated boundaries.** If an adapter cannot resolve a required boundary, mark it incomplete and stop expansion there.
4. **Framework extensions can be declarative.** An Odoo `_inherit` that only adds fields is still meaningful structural evidence even with no function call.
5. **One logical runtime entity.** Framework extensions enrich the composed entity instead of creating fake duplicates.
6. **Persistence is evidence-backed.** Logical ORM relationships and physical DB constraints remain distinct unless evidence proves the mapping.
7. **Existing call-path machinery stays generic.** Adapters expand topology; they do not implement separate workflow discovery engines.
8. **Pass 1 / Pass 2 own semantics.** Structural evidence is interpreted into business workflows and steps by the existing semantic learning path.
9. **Persist semantics, not the whole call graph.** Keep compact provenance back to functions/call paths instead of copying the entire implementation topology into LeMap.
10. **Entities and persistence remain durable when useful.** Logical entities, fields, physical tables/columns and evidenced mappings are enterprise knowledge, not disposable call-trace detail.
11. **One reconciliation boundary.** Adapter-derived durable facts and Pass-1/Pass-2 semantic facts enter the persistent LeMap through common reconciliation rather than by direct map mutation.

---

## 19. Implementation boundary

This specification intentionally does not prescribe a rewrite of Pass 1, Pass 2, Query-v4 or the persistent-map format.

The main implementation work should be below those layers:

```text
adapter registry / detection
canonical adapter fragment contract
language adapters
Odoo adapter normalization
PostgreSQL adapter
boundary continuation
merge into current topology
```

The existing path-processing and semantic-learning pipeline should be reused unless a concrete incompatibility is discovered during the Odoo proof.
