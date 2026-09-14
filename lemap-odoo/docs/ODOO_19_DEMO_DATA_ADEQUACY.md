# Odoo 19 Data Adequacy for the ACME EMS Demo

## Purpose

This assessment answers milestone A for the Odoo demo: determine whether standard Odoo 19 already contains the operational facts needed to investigate the three target questions, which facts can be derived from standard Odoo data, and which facts genuinely require ACME EMS extensions.

Target questions:

1. Why can’t we scale production to 12,000 units/month?
2. Why did unit cost increase?
3. Which customer orders are at risk due to supplier/component issues?

The rule for the demo is deliberately strict:

- **Present** — standard Odoo already stores or computes the fact.
- **Derivable** — standard Odoo stores the evidence needed to derive the fact; do not add a convenience field.
- **Missing** — the business fact is not represented reliably in the standard Odoo source used by this demo; ACME may extend Odoo for it.

The demo should prefer deriving answers from operational evidence over storing fields that directly encode the answer.

---

## Executive conclusion

Standard Odoo 19 is already adequate for most of the structural and operational evidence needed by all three investigations:

- manufacturing orders and deadlines
- BOM/component requirements
- raw-material moves and component readiness
- current inventory, reservations and lots
- production capacity from currently available components
- work orders, work-center calendars, load, duration, OEE and cost/hour
- purchasing quantities, prices, supplier lead times and planned receipt dates
- actual receipt quantities and stock movement dates
- vendor on-time-delivery rate
- customer commitments and the sale-order-line to manufacturing-order link
- manufacturing scrap
- stock valuation/value of material movements

Therefore fields such as `ems_shortage_qty`, `ems_delay_reason`, and `ems_estimated_delay_days` should not be used as answer fields. Shortage and delay risk should be derived from the standard operational evidence.

The main genuine EMS additions are facts whose semantics are not represented in the public Odoo 19 source used by the demo, especially:

- approved manufacturer-part / supplier qualification semantics
- supplier-specific commercial attributes that Odoo does not distinguish, such as explicit expedite premium and possibly freight-at-offer level
- supplier/component quality acceptance or incoming inspection disposition/defect information
- explicit rework event classification and rework-specific labor/material/external cost if that distinction is required by the demo
- supplier maximum capacity / constrained allocation, if the 12,000-unit investigation needs to prove a supplier-volume ceiling rather than merely a lead-time or availability bottleneck

Some current ACME extensions duplicate facts already in Odoo and should be reconsidered in milestone B.

---

# 1. Why can’t we scale production to 12,000 units/month?

## Investigation evidence

| Required fact | Odoo 19 evidence | Classification | Notes |
|---|---|---|---|
| Finished product and target quantity | `mrp.production.product_id`, `product_qty`, `product_uom_qty` | Present | MO already represents the product and quantity to manufacture. |
| BOM used by the MO | `mrp.production.bom_id` | Present | Direct link to the bill of materials. |
| Component requirements | `mrp.production.move_raw_ids` plus BOM lines | Present | Raw-material stock moves are explicit components for the MO. |
| Component readiness | `mrp.production.reservation_state`, `components_availability_state` | Present | Odoo explicitly distinguishes ready/waiting and available/expected/late/unavailable. |
| How many units current stock can support | `mrp.production.production_capacity` | Present/derived by Odoo | Odoo computes production capacity from component stock and raw-move unit factors. |
| On-hand/reserved/available stock | `stock.quant.quantity`, `reserved_quantity`, `available_quantity` | Present | `available_quantity = quantity - reserved_quantity`. |
| Component lots | `stock.quant.lot_id`, move lines, `stock.lot` | Present | Standard stock tracking. |
| Planned production dates/deadline | `mrp.production.date_start`, `date_finished`, `date_deadline` | Present | Deadline is explicitly intended to support on-time fulfillment. |
| Work-center routing/load | `mrp.workorder`, `mrp.workcenter`, routing lines | Present | Work orders connect production to work centers. |
| Available work-center hours | resource calendar attached to work center | Present | Work-center load code compares expected work-order hours with resource-calendar attendance. |
| Expected vs real process duration | MO/work-order duration fields and productivity records | Present | Suitable for capacity/yield investigation. |
| Work-center effectiveness/loss | `mrp.workcenter.oee`, `productive_time`, `blocked_time`, `performance` | Present/derived by Odoo | Historical execution evidence is available. |
| Product-specific parallel work-center capacity | `mrp.workcenter.capacity_ids` | Present | Standard Odoo supports product capacities at work centers. |
| Supplier/vendor for a purchased component | `product.supplierinfo.partner_id` | Present | Standard vendor pricelist mapping. |
| Vendor MOQ | `product.supplierinfo.min_qty` | Present | No ACME duplicate required for ordinary MOQ. |
| Vendor lead time | `product.supplierinfo.delay` | Present | Used by Odoo scheduler. |
| Vendor price | `product.supplierinfo.price`, discount/currency/date range | Present | Standard offer/pricelist fact. |
| Expected purchase arrival | `purchase.order.line.date_planned` and PO `date_planned` | Present | Can be compared with production requirement/deadline. |
| Actual received quantity | `purchase.order.line.qty_received` and stock moves | Present | Receipt progress is visible. |
| Vendor historical on-time rate | `res.partner.on_time_rate` from `purchase_stock` | Present/derived by Odoo | Odoo computes it from ordered quantities and stock moves received by planned date. |
| Manufacturing scrap | `stock.scrap.production_id`, `workorder_id`, quantity/moves | Present | Standard MRP connects scrap to MO/work order. |
| Incoming inspection acceptance/rejection | No equivalent model in the public Odoo 19 source used by this demo | Missing | ACME incoming inspection is justified if the demo needs supplier/component quality holds. |
| Rework event and rework-specific cost | No standard first-class rework event equivalent identified in the public Odoo 19 modules used here | Missing if needed | Standard execution/scrap data does not encode an EMS-specific rework event with labor/material/external-cost breakdown. |
| Supplier maximum monthly/weekly supply capacity | No standard supplier-capacity ceiling identified | Missing if needed | Lead time and MOQ are not the same as maximum supply capacity. Add only if query 1 requires this particular bottleneck. |

## What should be inferred instead of stored

Do not store a generic MO shortage quantity merely to answer this query. A shortage can be derived from the MO raw-material requirements together with reservations/available stock and incoming supply.

Likewise, a generic `delay_reason` should not be the primary evidence. The cause should be reconstructed from the path, for example:

- raw-material requirement > usable/reserved inventory
- outstanding purchase receipt arrives after the material-required date
- or material was received but an ACME inspection rejected/held enough of it
- or work-center load exceeds calendar capacity
- or scrap/rework increased effective material/capacity demand

## Odoo gap relevant to 12,000/month

The important possible extension is **supplier constrained capacity**. Odoo gives LeMap vendor, price, MOQ, lead time, scheduled receipts and historical OTD, but those do not prove that a supplier can supply at most N components/month. If the demo root cause needs to be “supplier X can only support 10,500 units/month”, ACME must model that as a genuine business fact. If the bottleneck can instead be demonstrated through existing/open supply, lead-time, inventory and work-center capacity, no supplier-capacity extension is needed.

---

# 2. Why did unit cost increase?

## Investigation evidence

| Required fact | Odoo 19 evidence | Classification | Notes |
|---|---|---|---|
| Actual purchased component price | `purchase.order.line.price_unit`, discount, quantity, subtotal | Present | Period-over-period purchase price change can be calculated directly. |
| Baseline/vendor pricelist price | `product.supplierinfo.price`, discount, currency, effective dates | Present | Useful for expected-vs-actual and supplier mix. |
| Supplier used | PO `partner_id`; line `partner_id` | Present | Supports supplier-mix variance. |
| Purchase quantity and received quantity | `product_qty`, `qty_received` | Present | Supports weighted costs and supply analysis. |
| Inventory/material movement value | Odoo 19 `stock.move.value`, `price_unit`, `standard_price`, remaining value | Present | Odoo 19 performs stock valuation on stock moves. |
| Accounting link for valued movement | `stock.move.account_move_id` | Present | Supports tracing value to accounting postings. |
| Work-center cost rate | `mrp.workcenter.costs_hour` | Present | Standard labor/machine processing rate. |
| Actual/expected operation duration | work-order/productivity duration fields | Present | Enables execution-cost variance. |
| Scrap associated with MO/work order | `stock.scrap.production_id`, `workorder_id` | Present | Scrap quantity can be associated with production and its stock movement/value. |
| Currency effect | PO currency/rate and company currency | Present | Standard Odoo stores currency and conversion rate. |
| Freight/landed cost | Standard Odoo can account for logistics/valuation through accounting/stock mechanisms, but the exact “freight component of supplier offer” is not represented in `product.supplierinfo` | Derivable/present for actual accounting; missing if offer-level attribution is required | ACME should add only if the demo needs a semantically distinct quoted freight-per-unit fact. |
| Explicit expedite premium | Not a distinct standard purchase/vendor-pricelist field | Missing if root-cause attribution requires it | An increased PO price is observable, but “this part of the increase was an expedite premium” is not reliably inferable without explicit semantics. |
| Explicit rework labor/material/external cost | Not represented as a standard rework event | Missing if needed | Current ACME `acme.rework.event` provides exactly this business fact. |

## What Odoo can already explain

Without any ACME convenience field, LeMap/PAL can decompose a large portion of unit-cost change from standard data:

1. compare quantities produced by period
2. compare purchase prices and supplier mix for consumed components
3. compare stock-move/material valuation
4. compare actual versus expected work-center time multiplied by work-center cost/hour
5. compare manufacturing scrap quantities/value
6. separate currency effects where relevant

## What requires ACME semantics

If the intended explanation distinguishes **expedite premium**, **supplier-offer freight**, or **rework-specific cost** from general purchase/material/labor cost, those categories must exist as business facts somewhere. They should not be reconstructed by guessing from a higher price.

The current ACME approved-supply model contains explicit `freight_cost_per_unit` and `expedite_premium_per_unit`; those are plausible domain extensions. The current rework-event model contains explicit rework quantity, labor hours, labor cost, material cost and external cost; those are also plausible if that level of explanation is part of query 2.

---

# 3. Which customer orders are at risk due to supplier/component issues?

## Investigation evidence

| Required fact | Odoo 19 evidence | Classification | Notes |
|---|---|---|---|
| Customer order and customer | `sale.order`, `partner_id` | Present | Standard sales object. |
| Promised customer delivery date | `sale.order.commitment_date` | Present | Explicit customer commitment. |
| Expected deliverable date | `sale.order.expected_date` | Present/derived by Odoo | Additional planning evidence. |
| Customer order lines/products | `sale.order.line` | Present | Standard line-level demand. |
| Link from MO to originating sales line | `sale_mrp`: `mrp.production.sale_line_id` | Present | Direct standard link from MO to source sale order line. |
| MO deadline for fulfillment | `mrp.production.date_deadline` | Present | Designed as latest processing time to fulfill delivery. |
| Components needed by MO | `move_raw_ids` / BOM | Present | Standard MRP component demand. |
| Whether components are ready/late/unavailable | MO reservation/component availability fields | Present | Standard computed readiness evidence. |
| Current usable inventory/reservations | `stock.quant` | Present | Standard stock evidence. |
| Purchase orders covering shortages | purchase/stock procurement chain and stock moves | Present | Can be followed through component/product and procurement references. |
| Expected vendor arrival | PO/POL `date_planned` | Present | Compare against MO requirement/deadline. |
| Actual receipt progress/date | POL `qty_received`; stock move `date` | Present | Supports late-supply diagnosis. |
| Vendor on-time performance | `res.partner.on_time_rate` | Present/derived by Odoo | Historical risk signal. |
| Supplier quality rejection/hold | No equivalent incoming inspection model in public Odoo 19 source used here | Missing | ACME inspection model is justified if quality is part of the risk query. |
| Customer-order risk flag | Not required | Derivable | Risk should be the result of the investigation, not a stored ACME answer field. |
| Estimated delay days | Not required | Derivable | Compare material-ready/production completion evidence against MO/customer dates. |
| Delay reason | Not required | Derivable when evidence is sufficient | Keep explicit human classification only if the business really records one independently. |

## Standard Odoo path already available

The important business path exists in standard Odoo:

`sale.order -> sale.order.line -> mrp.production -> raw stock moves/BOM -> inventory/reservation -> purchase/receipt/supplier`

Odoo `sale_mrp` explicitly puts `sale_line_id` on `mrp.production`, so ACME does not need `ems_customer_order_ref` merely to connect manufacturing back to the customer order.

Quality-related risk is the major domain gap for the public Odoo source used in this demo. ACME incoming inspection is therefore useful because it associates supplier, component, lot and receipt with inspected/rejected quantity and disposition.

---

# Current ACME fields/models: preliminary keep/reconsider decision

This is not milestone B implementation; it is the output of the adequacy audit that B should use.

## Reconsider/remove as convenience duplicates

### `mrp.production` ACME fields

- `ems_shortage_qty` — **reconsider/remove**. Shortage is derivable from raw-material requirements, reservations, stock and incoming supply.
- `ems_delay_reason` — **reconsider/remove as machine answer field**. Root cause should be inferred from workflow/data evidence. Keep only if the fictional business explicitly records an independent human classification.
- `ems_estimated_delay_days` — **reconsider/remove**. Delay should be calculated against standard MO/customer commitment dates from material and capacity evidence.
- `ems_customer_order_ref` — **reconsider/remove**. Standard `sale_mrp` already gives `mrp.production.sale_line_id -> sale.order`.
- `ems_planned_ship_date` — **reconsider/remove unless it represents a distinct EMS/customer contractual date**. Standard sale commitment and MO deadline/planning dates already exist.
- `ems_blocking_component_id` — **reconsider/remove as answer field**. Blocking component should normally be derived from component requirements/availability. Keep only if it is an explicitly recorded planner override/classification.

## Likely genuine ACME additions

### `acme.approved.supply`

Odoo already has supplier, product, MOQ, price, currency, effective dates and lead time in `product.supplierinfo`, and OTD in `res.partner.on_time_rate`. Therefore ACME should not duplicate these merely for convenience.

Potentially genuine EMS semantics are:

- manufacturer-part qualification / approved-source relationship
- approval state and preferred-source policy where these semantics exceed standard vendor sequence
- explicit freight component if the business needs offer-level cost decomposition
- explicit expedite premium
- supplier/component quality acceptance metric if this is a maintained business metric rather than derived from inspections
- supplier maximum supply capacity/allocation if required by query 1

### `acme.incoming.inspection`

**Keep** for this demo if supplier/component quality must participate in queries 1 or 3. The public Odoo 19 source used here does not provide an equivalent standard incoming-inspection entity.

### `acme.rework.event`

**Keep or simplify depending on query 2.** Standard Odoo has work-order time and manufacturing scrap, so do not duplicate those. Keep the model if the business needs a separately classified rework event and rework-specific labor/material/external cost that cannot be identified reliably from standard execution records.

### `acme.lot.trace`

**Needs a separate redundancy check before B.** Odoo already has lot/serial tracking, component/finished stock moves, MO links, and sale/shipment links. The current ACME table may denormalize a trace path that standard stock move/move-line data can already reconstruct. It should be retained only if it captures a business trace fact that the standard movement graph does not preserve reliably.

---

# Required Odoo source paths for LeMap learning

For the three demo queries, the useful Odoo framework neighborhood is driven by these execution/entity paths rather than by arbitrary one-hop entity expansion:

- `addons/mrp/models/mrp_production.py`
- `addons/mrp/models/mrp_bom.py`
- `addons/mrp/models/mrp_workcenter.py`
- MRP work-order/productivity models
- `addons/mrp/models/stock_scrap.py`
- `addons/stock/models/stock_move.py`
- `addons/stock/models/stock_move_line.py`
- `addons/stock/models/stock_quant.py`
- `addons/stock/models/stock_lot.py`
- `addons/purchase/models/purchase_order.py`
- `addons/purchase/models/purchase_order_line.py`
- `addons/product/models/product_supplierinfo.py`
- `addons/purchase_stock/models/res_partner.py`
- purchase-stock procurement/move extensions
- `addons/sale/models/sale_order.py`
- `addons/sale_mrp/models/mrp_production.py`
- `addons/stock_account/models/stock_move.py`

LeMap should only pull these framework paths when they are reached from the ACME/project flow or needed to resolve the relevant standard workflow.

---

# Milestone A decision

**Odoo 19 base is adequate for the core mechanics of all three demo investigations.** ACME does not need to store shortage, generic delay reason, generic delay days, customer-order reference, or blocking component simply to make the questions answerable.

ACME extensions should be narrowed to genuine EMS facts, principally qualification/approved-source semantics, incoming quality evidence, explicit premium/cost classifications where required, rework-specific facts where standard execution/scrap is insufficient, and possibly supplier-capacity limits if query 1 is meant to prove that constraint.

Milestone B should now revise the ACME demo model using this classification before further LeMap workflow learning is validated against it.
