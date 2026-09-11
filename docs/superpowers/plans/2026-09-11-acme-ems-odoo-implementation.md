# ACME EMS Odoo 19.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, runnable Odoo 19.0 Community deployment for a fictional Electronics Manufacturing Services company whose real Odoo models, workflows, and deterministic operational data can later be learned and queried by LeMap.

**Architecture:** Keep the EMS repository independent from DataSong/LeMap. Use standard Odoo 19.0 Community models for sales, purchasing, inventory, MRP, accounting, partners, products, lots/serials, and work centers; add small custom addons only for EMS-specific concepts such as manufacturer parts, approved alternates/suppliers, BOM revisions, incoming inspection, test/rework records, and explicit traceability links. Seed deterministic business scenarios that expose both production-scaling constraints and cost drivers.

**Tech Stack:** Odoo 19.0 Community, PostgreSQL 16, Docker Compose, Python 3, Odoo ORM, XML views/security/data, CSV/XML demo data, shell scripts, Odoo test framework.

**Spec:** `docs/superpowers/specs/2026-09-11-acme-ems-odoo-design.md`

## Global Constraints

- The EMS deployment lives in a separate Git repository named `acme-ems-odoo`.
- Odoo version is exactly 19.0 Community, not SaaS 19.x branches.
- PostgreSQL is the backing database; Docker Compose must start the deployment from a clean checkout.
- LeMap-specific semantic files, annotations, and hard-coded query answers are forbidden in the EMS repo.
- Prefer extension of standard Odoo models over parallel synthetic ERP models.
- Seed data must be deterministic so bottleneck, cost-driver, shortage, and traceability answers can be asserted.
- The first business scenario centers on an industrial-controller PCB assembly.
- The seeded company must expose at least two genuine production constraints: functional-test capacity and a single-source IC shortage.
- The seeded company must expose deliberate cost drivers including rework/scrap and supplier/freight price variance.
- V1 does not implement finite-capacity scheduling optimization, machine-program generation, EDI, full PLM/ECO, MES integration, predictive maintenance, or AI recommendations inside Odoo.

---

## Target Repository Structure

```text
acme-ems-odoo/
├── .env.example
├── .gitignore
├── README.md
├── docker-compose.yml
├── config/
│   └── odoo.conf
├── addons/
│   ├── acme_ems_core/
│   │   ├── __init__.py
│   │   ├── __manifest__.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── manufacturer_part.py
│   │   │   └── product_template.py
│   │   ├── security/ir.model.access.csv
│   │   └── views/manufacturer_part_views.xml
│   ├── acme_ems_procurement/
│   │   ├── __init__.py
│   │   ├── __manifest__.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── approved_supply.py
│   │   ├── security/ir.model.access.csv
│   │   └── views/approved_supply_views.xml
│   ├── acme_ems_manufacturing/
│   │   ├── __init__.py
│   │   ├── __manifest__.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── bom_revision.py
│   │   │   ├── mrp_bom.py
│   │   │   └── mrp_production.py
│   │   ├── security/ir.model.access.csv
│   │   └── views/bom_revision_views.xml
│   ├── acme_ems_quality/
│   │   ├── __init__.py
│   │   ├── __manifest__.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── incoming_inspection.py
│   │   │   ├── test_result.py
│   │   │   └── rework_event.py
│   │   ├── security/ir.model.access.csv
│   │   └── views/quality_views.xml
│   └── acme_ems_traceability/
│       ├── __init__.py
│       ├── __manifest__.py
│       ├── models/
│       │   ├── __init__.py
│       │   └── lot_trace.py
│       ├── security/ir.model.access.csv
│       └── views/lot_trace_views.xml
├── demo-data/
│   ├── README.md
│   └── expected_metrics.json
├── scripts/
│   ├── init-demo.sh
│   ├── reset-demo.sh
│   └── export-query-fixtures.py
└── tests/
    ├── test_smoke.sh
    └── expected/
        ├── scaling.json
        ├── cost.json
        └── traceability.json
```

`acme_ems_sales` is intentionally omitted in V1 unless implementation shows a clean, isolated sales-specific concept that cannot live as a small extension in `acme_ems_core` or `acme_ems_manufacturing`. This avoids artificial module splitting.

---

### Task 1: Bootstrap the runnable Odoo 19.0 deployment

**Files:**
- Create: `.env.example`
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `config/odoo.conf`
- Create: `README.md`
- Create: `scripts/init-demo.sh`
- Create: `scripts/reset-demo.sh`
- Create: `tests/test_smoke.sh`

**Interfaces:**
- Produces: Docker services `db` and `odoo`, addon mount `/mnt/extra-addons`, database name from `ODOO_DB`, and reproducible init/reset commands used by every later task.

- [ ] **Step 1: Write the smoke test first**

Create `tests/test_smoke.sh` to fail unless Docker Compose validates and both declared services exist:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose config >/tmp/acme-ems-compose.yml
grep -q '^  db:' /tmp/acme-ems-compose.yml
grep -q '^  odoo:' /tmp/acme-ems-compose.yml
```

- [ ] **Step 2: Run the smoke test and verify failure**

Run:

```bash
bash tests/test_smoke.sh
```

Expected: FAIL because `docker-compose.yml` does not yet exist.

- [ ] **Step 3: Add Docker Compose and Odoo config**

Use `odoo:19.0` and `postgres:16` images. Mount `./addons:/mnt/extra-addons`, `./config/odoo.conf:/etc/odoo/odoo.conf`, and named volumes for Odoo/PostgreSQL data. Expose Odoo on `${ODOO_PORT:-8069}`. Configure PostgreSQL credentials only through environment variables.

Create `config/odoo.conf` with:

```ini
[options]
addons_path = /usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons
data_dir = /var/lib/odoo
proxy_mode = False
list_db = True
```

Create `.env.example` with deterministic local defaults:

```dotenv
POSTGRES_DB=postgres
POSTGRES_USER=odoo
POSTGRES_PASSWORD=odoo
ODOO_DB=acme_ems
ODOO_PORT=8069
```

- [ ] **Step 4: Add init/reset scripts**

`init-demo.sh` must start PostgreSQL, create/install the V1 addon set with `odoo --stop-after-init`, then start Odoo normally. `reset-demo.sh` must stop services, remove named volumes, and invoke `init-demo.sh`.

- [ ] **Step 5: Run deployment validation**

Run:

```bash
bash tests/test_smoke.sh
docker compose config
docker compose up -d db
```

Expected: smoke test PASS; PostgreSQL container healthy.

- [ ] **Step 6: Commit**

```bash
git add .env.example .gitignore docker-compose.yml config README.md scripts tests/test_smoke.sh
git commit -m "chore: bootstrap Odoo 19 EMS deployment"
```

---

### Task 2: Implement the EMS part master and product extensions

**Files:**
- Create: `addons/acme_ems_core/__init__.py`
- Create: `addons/acme_ems_core/__manifest__.py`
- Create: `addons/acme_ems_core/models/__init__.py`
- Create: `addons/acme_ems_core/models/manufacturer_part.py`
- Create: `addons/acme_ems_core/models/product_template.py`
- Create: `addons/acme_ems_core/security/ir.model.access.csv`
- Create: `addons/acme_ems_core/views/manufacturer_part_views.xml`
- Create: `addons/acme_ems_core/tests/__init__.py`
- Create: `addons/acme_ems_core/tests/test_part_master.py`

**Interfaces:**
- Produces model: `acme.manufacturer.part`
- Produces product fields: `ems_customer_part_number`, `ems_material_source`, `ems_manufacturer_part_ids`
- Produces relationships consumed by procurement and manufacturing addons.

- [ ] **Step 1: Write failing Odoo model tests**

Test creation of a manufacturer part with manufacturer, MPN, lifecycle, package, and linkage to `product.template`; test purchased/consigned material selection.

Representative assertion:

```python
part = self.env['acme.manufacturer.part'].create({
    'name': 'STM32H743VIT6',
    'manufacturer_name': 'STMicroelectronics',
    'mpn': 'STM32H743VIT6',
    'package': 'LQFP100',
    'lifecycle_state': 'active',
})
self.assertEqual(part.mpn, 'STM32H743VIT6')
```

- [ ] **Step 2: Run the addon test and verify failure**

Run Odoo test installation with `--test-enable --stop-after-init -i acme_ems_core`.

Expected: FAIL because models do not exist.

- [ ] **Step 3: Implement minimal models**

`acme.manufacturer.part` fields:

```text
name
manufacturer_name
mpn
package
lifecycle_state: active / nrnd / obsolete
product_tmpl_id -> product.template
is_preferred
notes
```

Extend `product.template` with:

```text
ems_customer_part_number
ems_material_source: purchased / consigned / mixed
ems_manufacturer_part_ids -> acme.manufacturer.part
```

- [ ] **Step 4: Add access rights and basic list/form views**

Views exist to make the deployment genuinely usable but contain no LeMap-specific metadata.

- [ ] **Step 5: Run addon tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add addons/acme_ems_core
git commit -m "feat: add EMS part master"
```

---

### Task 3: Implement approved supply, alternates, sourcing economics, and shortage context

**Files:**
- Create: `addons/acme_ems_procurement/__init__.py`
- Create: `addons/acme_ems_procurement/__manifest__.py`
- Create: `addons/acme_ems_procurement/models/__init__.py`
- Create: `addons/acme_ems_procurement/models/approved_supply.py`
- Create: `addons/acme_ems_procurement/security/ir.model.access.csv`
- Create: `addons/acme_ems_procurement/views/approved_supply_views.xml`
- Create: `addons/acme_ems_procurement/tests/__init__.py`
- Create: `addons/acme_ems_procurement/tests/test_approved_supply.py`

**Interfaces:**
- Consumes: `acme.manufacturer.part`, `product.template`, `res.partner`
- Produces model: `acme.approved.supply`
- Produces queryable sourcing fields consumed by demo data and LeMap: supplier, supplier part number, MOQ, lead time, unit price, freight/expedite premium, reliability, approval status, preferred flag.

- [ ] **Step 1: Write failing approved-supply tests**

Assert one manufacturer part can have multiple approved supplier offers with distinct economics and that blocked offers cannot be selected as preferred.

- [ ] **Step 2: Verify failure**

Install/test `acme_ems_procurement`; expected model-not-found failure.

- [ ] **Step 3: Implement `acme.approved.supply`**

Fields:

```text
manufacturer_part_id -> acme.manufacturer.part
supplier_id -> res.partner
supplier_part_number
approval_state: approved / blocked / conditional
is_preferred
moq
lead_time_days
unit_price
currency_id
freight_cost_per_unit
expedite_premium_per_unit
on_time_delivery_pct
quality_acceptance_pct
valid_from
valid_to
```

Add a constraint preventing `is_preferred=True` unless `approval_state='approved'`.

- [ ] **Step 4: Add views/access and run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add addons/acme_ems_procurement
git commit -m "feat: add approved EMS supply sources"
```

---

### Task 4: Implement BOM revision semantics and manufacturing capacity context

**Files:**
- Create: `addons/acme_ems_manufacturing/__init__.py`
- Create: `addons/acme_ems_manufacturing/__manifest__.py`
- Create: `addons/acme_ems_manufacturing/models/__init__.py`
- Create: `addons/acme_ems_manufacturing/models/bom_revision.py`
- Create: `addons/acme_ems_manufacturing/models/mrp_bom.py`
- Create: `addons/acme_ems_manufacturing/models/mrp_production.py`
- Create: `addons/acme_ems_manufacturing/security/ir.model.access.csv`
- Create: `addons/acme_ems_manufacturing/views/bom_revision_views.xml`
- Create: `addons/acme_ems_manufacturing/tests/__init__.py`
- Create: `addons/acme_ems_manufacturing/tests/test_bom_revision.py`

**Interfaces:**
- Consumes: Odoo MRP models plus EMS core/procurement models.
- Produces model: `acme.bom.revision`
- Extends: `mrp.bom`, `mrp.production`, and `mrp.workcenter`
- Produces capacity and shortage fields used in deterministic scaling queries.

- [ ] **Step 1: Write failing BOM revision tests**

Tests must verify:

```text
one product may have multiple revisions
only one revision is active at a time for a given production context
mrp.bom points to a revision
mrp.production captures the revision used
```

- [ ] **Step 2: Write failing capacity-field tests**

Extend `mrp.workcenter` with:

```text
ems_planned_units_per_day
ems_actual_units_per_day
ems_downtime_hours_month
ems_queue_units
```

Extend `mrp.production` with:

```text
ems_blocking_component_id -> product.product
ems_shortage_qty
ems_delay_reason
ems_customer_order_ref
```

- [ ] **Step 3: Implement minimum models/constraints**

Use standard `mrp.bom`, `mrp.production`, work orders, work centers, stock moves, and sale/purchase references as the backbone.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add addons/acme_ems_manufacturing
git commit -m "feat: model EMS BOM revisions and capacity"
```

---

### Task 5: Implement incoming quality, functional test, rework, and scrap economics

**Files:**
- Create: `addons/acme_ems_quality/__init__.py`
- Create: `addons/acme_ems_quality/__manifest__.py`
- Create: `addons/acme_ems_quality/models/__init__.py`
- Create: `addons/acme_ems_quality/models/incoming_inspection.py`
- Create: `addons/acme_ems_quality/models/test_result.py`
- Create: `addons/acme_ems_quality/models/rework_event.py`
- Create: `addons/acme_ems_quality/security/ir.model.access.csv`
- Create: `addons/acme_ems_quality/views/quality_views.xml`
- Create: `addons/acme_ems_quality/tests/__init__.py`
- Create: `addons/acme_ems_quality/tests/test_quality_cost.py`

**Interfaces:**
- Consumes: stock lots/pickings, products, partners, manufacturing orders.
- Produces models: `acme.incoming.inspection`, `acme.test.result`, `acme.rework.event`
- Extends standard `stock.scrap` only with EMS reason/cost context rather than replacing it.

- [ ] **Step 1: Write failing quality-flow tests**

Verify an incoming supplier lot can be inspected and marked `accepted`, `rejected`, or `conditional`; a manufacturing order can receive functional-test results; a rework event records labor/material cost.

- [ ] **Step 2: Write failing cost assertions**

`acme.rework.event` fields:

```text
production_id
reason
labor_hours
labor_rate
material_cost
external_cost
total_cost (computed)
```

`acme.test.result` fields:

```text
production_id
serial_or_lot_id
test_station
started_at
completed_at
result: pass / fail / retest
failure_code
```

`acme.incoming.inspection` fields:

```text
lot_id
supplier_id
product_id
sample_qty
failed_qty
disposition
failure_reason
```

- [ ] **Step 3: Implement models/views/access**

Keep explicit relationships so LeMap can traverse supplier → lot → quality → manufacturing/rework.

- [ ] **Step 4: Run tests and commit**

```bash
git add addons/acme_ems_quality
git commit -m "feat: add EMS quality and rework economics"
```

---

### Task 6: Implement explicit lot-to-finished-good traceability

**Files:**
- Create: `addons/acme_ems_traceability/__init__.py`
- Create: `addons/acme_ems_traceability/__manifest__.py`
- Create: `addons/acme_ems_traceability/models/__init__.py`
- Create: `addons/acme_ems_traceability/models/lot_trace.py`
- Create: `addons/acme_ems_traceability/security/ir.model.access.csv`
- Create: `addons/acme_ems_traceability/views/lot_trace_views.xml`
- Create: `addons/acme_ems_traceability/tests/__init__.py`
- Create: `addons/acme_ems_traceability/tests/test_traceability.py`

**Interfaces:**
- Consumes: standard `stock.lot`, stock moves, `mrp.production`, delivery picking, sale order.
- Produces model: `acme.lot.trace`
- Produces deterministic two-way path: component lot → production → finished lot → customer shipment, and inverse.

- [ ] **Step 1: Write failing traceability test**

Construct one consumed component lot and one produced finished lot linked by a manufacturing order; assert the trace record resolves both directions and links to the delivery/customer order.

- [ ] **Step 2: Implement `acme.lot.trace`**

Fields:

```text
component_lot_id
component_product_id
production_id
finished_lot_id
finished_product_id
sale_order_id
delivery_id
consumed_qty
```

The model supplements standard Odoo stock-move traceability with an explicit semantically obvious edge for the demo; it must be derived from real manufacturing/stock records, not manually disconnected facts.

- [ ] **Step 3: Run tests and commit**

```bash
git add addons/acme_ems_traceability
git commit -m "feat: expose EMS lot traceability"
```

---

### Task 7: Seed a deterministic EMS business with real problems

**Files:**
- Modify: each addon `__manifest__.py` to load demo XML/CSV
- Create: addon-specific `demo/*.xml` and/or `demo/*.csv`
- Create: `demo-data/README.md`
- Create: `demo-data/expected_metrics.json`
- Create: `tests/expected/scaling.json`
- Create: `tests/expected/cost.json`
- Create: `tests/expected/traceability.json`
- Create: `addons/acme_ems_manufacturing/tests/test_demo_scenario.py`

**Interfaces:**
- Produces a stable `ACME EMS Pvt Ltd` dataset consumed by later CSV export and LeMap live-query demos.

- [ ] **Step 1: Define deterministic master data**

Seed at minimum:

```text
Customers:
- Axion Industrial Controls
- Nova Energy Systems

Finished assemblies:
- ACME Industrial Controller X1
- ACME Sensor Gateway S2
- ACME Power Interface P4

Critical parts:
- MCU-STM32H743: single-source primary constraint
- ADC-ADS8688: two approved suppliers
- RES-10K-0603: multiple alternates, excess stock
- CONN-M12-8P: purchased
- PCB-X1-REV-C: customer-specific bare board
- FPGA-XC7A35T: customer-consigned for Nova order

Suppliers:
- PrimeSilicon: lower price, poor on-time delivery
- FastChip: higher price, shorter lead time
- ElectroPassives: reliable passive supplier
- BoardWorks: PCB supplier
```

- [ ] **Step 2: Seed process/capacity data with intentional constraints**

Use work centers:

```text
SMT Line 1: planned 550/day, actual 520/day
AOI: planned 500/day, actual 470/day
Assembly: planned 480/day, actual 455/day
Functional Test: planned 300/day, actual 285/day, queue 1,150 units
Rework: planned 100/day, actual 70/day
```

Functional Test must be the primary capacity constraint.

Create open manufacturing demand whose single-source MCU availability supports less output than upstream SMT capacity, making the MCU the secondary material constraint.

- [ ] **Step 3: Seed cost problems**

Create deterministic economics so expected cost answers include:

```text
Controller X1 has meaningful rework cost.
FastChip costs more than PrimeSilicon but improves lead time.
At least one purchase incurs an expedite premium.
At least one scrap event contributes to unit-cost variance.
RES-10K-0603 has excess stock relative to open demand.
```

- [ ] **Step 4: Seed quality and traceability problems**

Include one incoming lot that fails inspection, one production batch requiring rework, one scrap event, and one component lot consumed into finished goods that are then delivered to a customer.

- [ ] **Step 5: Assert expected metrics**

Create deterministic tests checking at least:

```text
primary capacity bottleneck == Functional Test
secondary material bottleneck == MCU-STM32H743
at least one customer order is blocked by MCU shortage
rework total cost > 0
scrap total cost > 0
FastChip lead time < PrimeSilicon lead time
FastChip landed unit cost > PrimeSilicon landed unit cost
component lot trace resolves to finished lot + delivery + customer
```

Record exact expected values in `demo-data/expected_metrics.json` after the seed values are fixed; tests must read/assert those values so future edits cannot silently change the demo story.

- [ ] **Step 6: Reset and install from scratch**

Run:

```bash
./scripts/reset-demo.sh
```

Expected: all addons install and demo data loads with no manual intervention.

- [ ] **Step 7: Commit**

```bash
git add addons demo-data tests/expected
git commit -m "feat: seed deterministic EMS business scenario"
```

---

### Task 8: Add CSV export for LeMap V1 data-query demonstrations

**Files:**
- Create: `scripts/export-query-fixtures.py`
- Create generated directory contract: `exports/` (ignored by Git by default)
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `tests/test_export_contract.py`

**Interfaces:**
- Consumes live Odoo/PostgreSQL data through Odoo ORM or read-only PostgreSQL connection.
- Produces deterministic CSV snapshots without changing the authoritative Odoo domain model.
- Output tables provide a temporary V1 query connector for LeMap.

- [ ] **Step 1: Write export-contract test**

Require these files after export:

```text
customers.csv
products.csv
manufacturer_parts.csv
approved_supply.csv
bom_revisions.csv
bom_lines.csv
sales_orders.csv
sales_order_lines.csv
manufacturing_orders.csv
work_centers.csv
purchase_orders.csv
purchase_order_lines.csv
stock_lots.csv
stock_balance.csv
incoming_inspections.csv
test_results.csv
rework_events.csv
scrap_events.csv
shipments.csv
lot_trace.csv
```

- [ ] **Step 2: Verify failure before exporter exists**

Run export-contract test; expected FAIL.

- [ ] **Step 3: Implement exporter**

Export stable business keys as well as Odoo numeric IDs. Every foreign-key relationship needed for graph-backed querying must be explicit in CSV output. Do not precompute or embed answers such as `is_scaling_bottleneck=true`; export operational facts only.

- [ ] **Step 4: Validate exported data against expected metrics**

Use a Python test that reconstructs the core facts from CSVs and asserts the same scaling/cost/traceability metrics as the Odoo-side tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/export-query-fixtures.py .gitignore README.md tests/test_export_contract.py
git commit -m "feat: export EMS operational query fixtures"
```

---

### Task 9: Final reproducibility and LeMap-readiness verification

**Files:**
- Modify: `README.md`
- Create: `docs/business-scenario.md`
- Create: `tests/test_no_lemap_hints.py`

**Interfaces:**
- Produces a clean external repository that can be pointed at by LeMap without special EMS metadata.

- [ ] **Step 1: Add anti-cheating test**

Scan the repository source/demo data for forbidden LeMap answer hints such as:

```text
semantic-map.json
expected-answer
is_scaling_bottleneck
lemap_hint
```

Allow `demo-data/expected_metrics.json` only as a test oracle; it must not be loaded by Odoo business models or exported to LeMap query fixtures.

- [ ] **Step 2: Document the business scenario, not the answers**

`docs/business-scenario.md` should describe ACME EMS, its products, supply chain, and manufacturing operations. Do not list which exact work center is the bottleneck or provide the final executive query answers; those must remain discoverable from the operational data.

- [ ] **Step 3: Perform a clean checkout-equivalent test**

Run:

```bash
docker compose down -v --remove-orphans
./scripts/init-demo.sh
python scripts/export-query-fixtures.py
bash tests/test_smoke.sh
```

Then run all Odoo addon tests and CSV contract tests.

Expected: everything passes without manually editing code or data.

- [ ] **Step 4: Inspect the source tree from LeMap's point of view**

Verify that business meaning is discoverable through normal Odoo artifacts only:

```text
__manifest__.py dependencies
Python _name / _inherit
fields.Many2one / One2many / Many2many
computed fields and constraints
business methods
XML views/actions
security access files
demo records
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs tests
git commit -m "docs: finalize EMS demo and reproducibility checks"
```

---

## End-to-End Acceptance Checks

After all tasks, verify these manually against live Odoo and/or exported CSV facts:

1. **Scale:** Functional Test has lower demonstrated throughput than upstream work centers and carries the largest meaningful queue.
2. **Supply:** the single-source MCU shortage constrains at least one open production/customer order.
3. **Cost:** Controller X1 has measurable cost contribution from rework, scrap, and/or expedite premiums.
4. **Optimization tradeoff:** at least one approved supplier/alternate offers a clear price-versus-lead-time tradeoff rather than an obviously dominant choice.
5. **Inventory:** at least one passive component is overstocked relative to open demand.
6. **Quality:** an incoming failed lot and a production rework event are both present.
7. **Traceability:** a supplier/component lot can be traced to a manufacturing order, finished lot, shipment, and customer; inverse traversal is also possible.
8. **Framework purity:** no LeMap-specific code or semantic annotations exist inside the EMS application.
9. **Reusability:** Odoo-specific extraction can later be implemented entirely in a LeMap adapter while the existing Learn → Explore → Query UI consumes canonical map output unchanged.

## Recommended Next Project After This Repo Passes

Do **not** implement the LeMap Odoo adapter concurrently with this repository. First make the EMS deployment reproducible and independently testable. Then create a separate LeMap plan for:

```text
Odoo parser/adapter
→ canonical entity/relationship/workflow representation
→ existing Learn
→ existing Explore
→ existing Query
→ CSV/live PostgreSQL data connector
→ visible map traversal → data query → business answer trace
```

That separation makes it possible to tell whether failures belong to the sample ERP or to LeMap's Odoo understanding.