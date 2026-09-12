# LeMap Odoo Adapter and Layered Semantic Maps

## Status

This document records the agreed design direction for adding Odoo support to the current LeMap reference implementation before implementation begins.

The first target project is the fictional Odoo 19 EMS installation in `thallukrish/acme-ems-odoo`.

The goal is not to create a separate LeMap engine for Odoo. The existing LeMap learning, persistence, exploration, and query architecture remains the engine. Odoo support is added through framework-specific adapters and layered semantic-map persistence.

---

## 1. Core design decision

LeMap should learn an Odoo project in the same general way it learned PopCommerce/Moqui:

```text
project/custom application
        ↓
framework-aware evidence extraction
        ↓
follow only the relevant framework neighborhood
        ↓
semantic learning
        ↓
persistent map
```

LeMap should **not** stop at an Odoo reference such as `_inherit = "mrp.production"` and treat the framework as a permanent black box.

It should also **not** crawl all of Odoo up front.

Instead, learning begins from the customer/project code and follows only the standard Odoo models, relationships, methods, views, actions, and workflows that are materially referenced or extended by that project.

---

## 2. Difference from the current PopCommerce/Moqui persistence model

The existing PopCommerce learning effectively produced one project map containing both:

- PopCommerce-specific semantic knowledge; and
- referenced Moqui/Mantle framework/domain knowledge.

That worked, but framework knowledge and project-specific knowledge were not cleanly separated as reusable persisted layers.

For Odoo, the separation should be explicit from the start.

```text
Odoo 19 framework map
        +
ACME EMS project map
        =
ACME EMS effective map
```

This layered model should later be usable for Moqui and other frameworks as well.

---

## 3. Automatic and seamless layered learning

The user should run one learning operation against the project. They should not have to separately learn Odoo first or manually decide whether a fact belongs to the framework map or project map.

Example:

```text
Learn ACME EMS
      ↓
encounter _inherit = "mrp.production"
      ↓
resolve Odoo 19 framework knowledge
      ↓
if knowledge is missing, inspect the relevant Odoo source neighborhood
      ↓
enrich the Odoo 19 framework map
      ↓
continue learning ACME EMS
      ↓
persist ACME-specific semantics in the ACME EMS project map
```

Framework-map enrichment and project-map enrichment are therefore part of the same learning run.

---

## 4. Provenance determines ownership of learned knowledge

The framework/project distinction should be evidence-based rather than guessed by the model.

### Odoo framework evidence

Evidence originating from the official Odoo source tree belongs to the versioned Odoo framework map.

Example provenance:

```text
framework: odoo
version: 19
repo: odoo/odoo
file: addons/mrp/models/mrp_production.py
commit: <source commit>
```

### Project evidence

Evidence originating from ACME/custom addons belongs to the project map.

Example provenance:

```text
project: acme-ems
repo: thallukrish/acme-ems-odoo
file: addons/acme_ems_manufacturing/models/mrp_production.py
commit: <source commit>
```

Project objects should reference framework objects rather than copy them.

---

## 5. Stable cross-layer identities

Standard framework objects need stable version-aware identifiers so project maps can reference them directly.

Examples:

```text
odoo19:model:mrp.production
odoo19:model:mrp.bom
odoo19:model:purchase.order
odoo19:model:stock.move
```

An ACME extension can then be represented conceptually as:

```text
extension:
  extends → odoo19:model:mrp.production

adds fields:
  ems_blocking_component_id
  ems_shortage_qty
  ems_delay_reason
```

The standard `mrp.production` semantic entity remains owned by the Odoo 19 framework map.

---

## 6. Proposed storage model

Semantic-map persistence should be generic rather than Odoo-specific so the same architecture can later support Moqui, SAP, Salesforce, ServiceNow, and other frameworks.

Conceptually:

```text
data/
  semantic-maps/
    frameworks/
      odoo/
        19/
          map.json

      moqui/
        <version>/
          map.json

    projects/
      acme-ems/
        map.json

      popcommerce/
        map.json
```

The exact physical filenames may follow the current LeMap persistence conventions during implementation, but the ownership boundary must remain framework versus project.

---

## 7. Effective map composition

Learning and query should see a composed effective graph while persistence keeps layer ownership separate.

```text
           Odoo 19 framework map
                    │
                    ├──────┐
                    │      │
                    │      ↓
                    │  effective ACME map
                    │      ↑
                    └──────┤
                           │
                    ACME EMS project map
```

Higher-level LeMap components should not need to care whether a semantic object came from the framework layer or the project layer except when provenance, refresh, ownership, or write-back matters.

The existing Pass 1, Pass 2, entity reconciliation, exploration, and Query-v4 behavior should continue to operate over the effective graph.

---

## 8. Odoo adapter boundary

Odoo-specific syntax and framework semantics belong behind an Odoo adapter, parallel to the existing Moqui adapter boundary.

The generic LeMap engine should remain responsible for generic program/data relationships and semantic learning.

The Odoo adapter should translate Odoo constructs such as:

```text
__manifest__.py
models.Model
_name
_inherit
fields.Many2one
fields.One2many
fields.Many2many
Python model methods
XML views
XML actions
menus
module dependencies
```

into the common deterministic evidence/topology that LeMap already consumes.

The semantic graph should ultimately reason in common concepts such as:

```text
Entity
Field
Relationship
Extension
Operation
Workflow
UI interaction
Dependency
```

rather than making higher layers Odoo-specific.

---

## 9. Targeted Odoo framework discovery

The Odoo adapter should recursively follow only the framework neighborhood needed to understand the project.

For example, ACME EMS may reference or extend:

```text
mrp.production
mrp.bom
product.template
purchase.order
stock.move
stock.lot
```

LeMap should learn the relevant relationships and workflow context around these objects, rather than scanning unrelated Odoo modules.

The traversal principle is:

```text
project reference
    ↓
resolve framework object
    ↓
collect enough surrounding framework evidence to preserve business continuity
    ↓
stop when the semantic signal is no longer material to the project workflow
```

This is consistent with LeMap's existing boundary-aware learning philosophy: technical adjacency alone is not a reason to traverse the entire framework.

---

## 10. Incremental framework enrichment

The Odoo framework map is reusable and cumulative.

If ACME EMS causes LeMap to learn additional standard Odoo semantics, those framework facts are persisted to the Odoo 19 map with provenance.

When a later Odoo 19 project references the same framework entities, LeMap reuses existing knowledge immediately and only explores missing or changed framework evidence.

Conceptually:

```text
Project A learns mrp.production
        ↓
enrich Odoo 19 map
        ↓
Project B references mrp.production
        ↓
reuse existing Odoo knowledge
        ↓
learn only missing relevant context
```

Framework versions remain separate because semantics and implementation may change between Odoo releases.

---

## 11. ACME EMS as the first Odoo project map

The first project map will represent the fictional ACME EMS Odoo 19 implementation.

It should capture ACME-specific concepts such as:

- EMS manufacturer/component identity;
- approved supply sources and supplier economics;
- BOM revision semantics;
- manufacturing blocking component, shortage quantity, and delay reason;
- incoming inspection and functional test events;
- rework labor/material economics;
- component-lot to finished-lot to shipment traceability.

These project-specific concepts should connect to standard Odoo entities through stable framework references rather than becoming duplicated framework entities.

Example:

```text
ACME Approved Supply
        ↓
Product / Component
        ↓
Odoo BOM
        ↓
Odoo Manufacturing Order
        ↓
ACME shortage / delay semantics
```

---

## 12. `lemap-odoo` folder

A top-level `lemap-odoo/` folder may be used as the runnable Odoo profile/demo, but it should not contain a fork of the LeMap engine.

Conceptually:

```text
demo_v2/
  server/
    adapters/
      moqui/
      odoo/

lemap-odoo/
  README.md
  config/
  scripts/
```

`demo_v2` remains the common LeMap engine/reference implementation. `lemap-odoo` provides the Odoo-specific runner/configuration experience and uses ACME EMS as the first end-to-end target.

Persistent semantic maps remain in the generic semantic-map storage structure, not embedded as hard-coded knowledge inside the Odoo runner.

---

## 13. First implementation success criteria

The first implementation is successful when one normal LeMap learning run against ACME EMS can:

1. detect Odoo 19 and its custom addon/module structure;
2. identify ACME model definitions and `_inherit` extensions;
3. resolve referenced standard Odoo models through the Odoo adapter;
4. learn relevant standard Odoo framework context without scanning all of Odoo;
5. automatically persist reusable standard knowledge into the Odoo 19 framework map;
6. persist ACME-specific knowledge into the ACME EMS project map;
7. compose both layers into one effective map for the existing LeMap explorer/query path;
8. retain source and commit provenance for both layers; and
9. reuse already learned Odoo framework semantics on a subsequent learning run instead of rediscovering them from scratch.

No business answers should be hard-coded for ACME EMS.

---

## 14. Out of scope for the first adapter implementation

The first adapter does not need to automate Odoo code changes, deployment, or business-user-driven self-modification yet.

Those are downstream capabilities enabled by the semantic map.

The immediate goal is to make Odoo learning structurally equivalent to the current Moqui learning path while improving persistence through explicit reusable framework and project layers.

Likewise, splitting the existing PopCommerce semantic map into a reusable Moqui framework map and a PopCommerce delta is a later migration. The Odoo implementation should establish the generic layered-map mechanism so that migration becomes possible without introducing a Moqui-specific redesign.

---

## 15. Architectural summary

```text
                    LeMap Learn
                        │
                 framework adapter
                        │
          ┌─────────────┴─────────────┐
          │                           │
 official Odoo evidence       ACME/custom evidence
          │                           │
          ↓                           ↓
 Odoo 19 framework map       ACME EMS project map
          │                           │
          └─────────────┬─────────────┘
                        ↓
                 effective map
                        ↓
             Pass 1 / Pass 2 / Query
```

The important product behavior is simple from the user's perspective:

> Point LeMap at an Odoo project. LeMap automatically learns the customer application and, as needed, the relevant standard Odoo framework behind it. Reusable Odoo knowledge accumulates separately from customer-specific knowledge, while the rest of LeMap sees one coherent enterprise map.
