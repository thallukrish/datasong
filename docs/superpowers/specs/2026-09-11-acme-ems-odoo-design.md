# ACME EMS Odoo 19.0 Demo Design

## Goal

Build a separate, runnable fictional Electronics Manufacturing Services (EMS) company deployment on Odoo 19.0 Community that LeMap can learn exactly like an external customer system. The deployment must expose realistic workflows, entities, fields, relationships, inheritance, and operational data paths so LeMap can later answer both process questions and live business-data questions.

The demo is explicitly designed around three executive questions:

1. What is preventing us from scaling production?
2. What is driving manufacturing cost?
3. Where can we reduce cost without hurting delivery or quality?

## Repository boundary

The EMS deployment must live in a separate Git repository from DataSong/LeMap. LeMap must not contain EMS-specific logic.

Proposed repository name:

`acme-ems-odoo`

LeMap should consume the repository as an external source tree, just as it would for a real customer deployment.

## Platform

- Odoo 19.0 Community
- PostgreSQL
- Docker Compose for local reproducibility
- Python/XML Odoo addons
- Standard Odoo modules where possible
- Custom EMS addons only where domain-specific behavior is needed
- Demo operational data seeded through Odoo-compatible data files or scripts
- CSV snapshots may be added later for LeMap V1 live-query experiments, but the authoritative domain model remains Odoo

## Design principle

Do not build a synthetic ERP beside Odoo. Extend standard Odoo models and flows so the deployment resembles a real customized customer installation.

The demo must force LeMap to understand both standard framework behavior and customer-specific extensions.

Examples of standard Odoo backbone models include sales, purchase, inventory, MRP, accounting, products, partners, lots/serials, and work centers. Custom EMS models should exist only where the business concept is not cleanly represented by standard Odoo.

## Company

Fictional company name: ACME EMS Pvt Ltd.

ACME EMS manufactures electronics assemblies for industrial customers. It performs customer-specific production using BOMs, procures and receives electronic components, performs incoming inspection, runs SMT/assembly/test operations, tracks lots/serials, performs rework and scrap handling, ships finished goods, and invoices customers.

The company operates a mix of purchased and customer-consigned material.

## V1 business flows

### 1. Customer order to production

Customer quotation
→ sales order
→ customer product / assembly
→ active BOM revision
→ manufacturing demand
→ component requirements
→ stock availability check
→ reservation or shortage
→ procurement where required
→ manufacturing order
→ work operations
→ test / quality
→ shipment
→ invoice

### 2. Component supply

Part requirement
→ approved manufacturer part
→ approved supplier
→ supplier part number
→ price / MOQ / lead time
→ purchase order
→ supplier delivery
→ incoming lot
→ incoming quality check
→ accepted stock or rejection

### 3. Manufacturing

Manufacturing order
→ material availability
→ SMT
→ assembly / THT where applicable
→ inspection / AOI
→ functional test
→ pass / rework / scrap
→ finished lot or serial
→ shipment readiness

### 4. Traceability

Customer order
→ finished product
→ manufacturing order
→ consumed component lots
→ supplier deliveries
→ suppliers / manufacturer parts

The inverse path must also be possible so a defective supplier lot can be traced to affected finished goods and customer shipments.

## EMS concepts

The deployment must include first-class representations for the following concepts where standard Odoo is insufficient:

- customer part number
- manufacturer part number
- approved manufacturer part
- supplier part number
- approved supplier / approved vendor relationship
- BOM revision
- approved alternate component
- purchased material vs customer-consigned material
- incoming inspection disposition
- test result
- rework event and reason
- scrap event and reason
- component shortage
- finished-product and component lot / serial traceability

## Parts and supply model

A BOM line must not assume that one logical requirement always maps to one purchasable part.

The model should support:

Logical component requirement
→ preferred manufacturer part
→ approved alternate manufacturer parts
→ supplier-specific purchasable offers

Supply-side attributes should include, where appropriate:

- internal part number
- manufacturer part number
- manufacturer
- supplier
- supplier part number
- customer part number
- package / form factor
- MOQ
- lead time
- unit price
- approved / blocked status
- preferred supplier flag
- lifecycle / availability status
- consigned vs purchased source

## Capacity and scaling model

The V1 dataset must make production scale constraints discoverable rather than merely modelled.

Include capacity-relevant data for:

- SMT work center
- assembly work center
- inspection / AOI
- functional test
- rework
- machine availability / downtime
- planned capacity
- actual throughput
- queue / backlog
- component availability
- supplier lead time

The seeded data should intentionally create at least two meaningful constraints, for example:

- functional test capacity is the primary bottleneck
- a single-source IC is the secondary material bottleneck

LeMap should later be able to explain why demand cannot be fulfilled at the requested rate by traversing the learned business/data relationships.

## Cost model

The deployment and seed data must support a credible product-cost breakdown covering:

- component purchase cost
- procurement premium / price variance
- freight or expedite cost
- manufacturing labor
- work-center / machine time
- subcontracting where used
- testing
- rework
- scrap
- overtime where applicable
- inventory carrying exposure / excess stock indicator

The demo dataset must contain deliberately imperfect economics so cost-driver queries return meaningful answers.

Examples:

- one supplier is cheap but unreliable
- one alternate supplier is more expensive but materially faster
- one component is single-sourced
- one product has high rework cost
- one product has healthy margin
- one customer frequently changes engineering requirements
- one component has excess inventory

## Suggested custom addons

Keep addons small and responsibility-focused.

### `acme_ems_core`

Owns shared EMS master-data extensions and common concepts.

Potential responsibilities:

- customer part numbers
- manufacturer part master
- approved alternates
- material ownership/source classification

### `acme_ems_sales`

Extends customer-order behavior with customer-specific product/part references and manufacturing-demand context.

### `acme_ems_procurement`

Owns approved supplier relationships, supplier part numbers, sourcing attributes, and shortage-related procurement context.

### `acme_ems_manufacturing`

Owns BOM revision semantics and EMS-specific manufacturing extensions.

### `acme_ems_quality`

Owns incoming inspection, test results, rework, and quality dispositions where standard modules are insufficient.

### `acme_ems_traceability`

Adds explicit links needed for end-to-end component-lot to finished-goods/customer-shipment traceability where standard Odoo links are not sufficient or not easy to expose semantically.

The implementation may collapse addons if Odoo 19.0 dependencies show that a smaller number gives cleaner boundaries. Avoid artificial module splitting.

## Repository shape

Expected top-level structure:

```text
acme-ems-odoo/
  README.md
  docker-compose.yml
  .env.example
  config/
    odoo.conf
  addons/
    acme_ems_core/
    acme_ems_sales/
    acme_ems_procurement/
    acme_ems_manufacturing/
    acme_ems_quality/
    acme_ems_traceability/
  demo-data/
    base/
    scenarios/
  scripts/
    init-demo.sh
    reset-demo.sh
  tests/
```

Exact layout can be adjusted to normal Odoo 19.0 addon conventions during implementation.

## Seed scenario

The first demo scenario should revolve around an industrial-controller PCB assembly.

The data must include:

- at least two customers
- several sellable finished assemblies
- a non-trivial multi-level or sufficiently rich BOM
- electronic components with multiple approved alternates
- at least one single-source component
- multiple suppliers
- different supplier lead times / prices / reliability characteristics
- one customer-consigned component
- open sales orders
- manufacturing orders in different states
- purchase orders and delayed deliveries
- incoming lots
- at least one incoming quality failure
- at least one rework event
- at least one scrap event
- finished goods / shipment records
- invoices or invoice-ready order data

The data should be deterministic so expected query answers can be asserted in tests.

## LeMap integration boundary

This repository must contain no LeMap-specific semantic map files, annotations, or hard-coded answers.

LeMap should learn the deployment from normal Odoo source artifacts:

- Python model classes
- `_inherit` / `_name`
- Odoo fields
- Many2one / One2many / Many2many relationships
- methods
- actions
- XML views
- security/access definitions
- module manifests and dependencies

An Odoo adapter in LeMap may later normalize those artifacts into LeMap's existing canonical semantic representation, but the EMS repository must remain a normal Odoo deployment.

## UI reuse requirement

LeMap's existing Learn → Explore → Query experience must remain framework-independent.

The Odoo adapter may add framework-specific extraction behavior, but Learn, Explore, semantic graph traversal, and Query should not contain EMS-specific branching.

If implementing Odoo support requires repeated UI or query-engine conditions such as `if framework === "odoo"`, treat that as an architectural failure and move the behavior behind the adapter/canonical graph boundary.

## Future data-query path

V1 may expose operational data through deterministic CSV exports or snapshots for rapid query demonstrations.

The eventual production path is live PostgreSQL/Odoo data.

The semantic map should let Query move from business concepts to the relevant data entities/fields/relationships and then execute a data query.

Example:

```text
Question:
Which open customer orders are blocked by component shortages?

Business concepts:
Customer Order
Manufacturing Order
BOM Requirement
Inventory
Purchase Order
Supplier

Map traversal:
Customer Order
→ Manufacturing Order
→ Component Requirement
→ Stock / Reservation
→ Purchase Order
→ Supplier

Data execution:
Identify the relevant tables/models/fields and query current operational records.

Answer:
Return affected orders, blocking components, suppliers, and business impact.
```

## Executive query acceptance criteria

The eventual LeMap demo should be able to answer, from the learned map plus operational data, questions in these categories.

### Scaling

- What is preventing us from scaling production?
- Why can we not meet current demand?
- Which work center is the bottleneck?
- Which component shortages constrain output?
- Which suppliers create the greatest production risk?

### Cost

- What is driving manufacturing cost for Product X?
- Why did unit cost increase?
- How much cost comes from rework and scrap?
- Which components contribute most to cost variance?
- Which expedite or supplier premiums are material?

### Cost reduction

- Where can we reduce cost without hurting delivery or quality?
- Which approved alternate components could lower cost?
- Which supplier changes would improve cost or lead time?
- Which recurring defects create avoidable rework cost?
- Which inventory appears excessive relative to demand?

### Traceability and operations

- Which finished products used component lot X?
- Which customer shipments are affected by supplier lot Y?
- Which manufacturing orders required rework?
- Which customer orders are delayed due to missing components?

## Testing requirements

The repository must have automated checks for:

- Odoo addon manifests and module loadability
- model and relationship creation
- BOM revision behavior
- approved alternate / supplier relationships
- seed-data integrity
- deterministic bottleneck scenario
- deterministic cost-driver scenario
- traceability path from incoming component lot to finished output

Docker startup plus module installation should be reproducible from a clean checkout.

## Non-goals for V1

Do not attempt to model every EMS operation.

Specifically defer unless required by the chosen Odoo modules:

- full finite-capacity scheduling optimizer
- detailed SMT machine-program generation
- IPC compliance workflow
- MES device integration
- real supplier EDI
- full PLM/ECO implementation
- advanced costing engine
- predictive maintenance
- AI recommendations inside Odoo

The purpose of V1 is a credible enterprise application graph and business dataset, not a production-complete EMS ERP.

## Success criteria

The deployment is successful when all of the following are true:

1. A clean checkout can start Odoo 19.0 Community with PostgreSQL.
2. The ACME EMS addons install without manual code changes.
3. The seeded company contains a believable customer-order → supply → manufacturing → quality → shipment flow.
4. Parts, alternates, suppliers, shortages, capacity, quality, rework, scrap, and traceability are represented through real Odoo models and relationships.
5. The seed scenario contains discoverable scale blockers and cost drivers.
6. LeMap can be pointed at the repository as an external codebase without EMS-specific hints.
7. The same Learn → Explore → Query semantic layer can consume the Odoo adapter output without framework-specific UI redesign.
8. Later live/CSV data queries can use the learned map to answer the executive scaling/cost questions rather than merely explain source code.
