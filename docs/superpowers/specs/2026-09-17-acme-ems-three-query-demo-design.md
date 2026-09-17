# ACME EMS Three-Query Demo Design

## Goal

Prove that LeMap can learn enough of a realistic Odoo EMS implementation to answer three cross-functional business questions from an evidence-backed semantic map, while keeping LeMap generic and keeping Odoo-specific behavior behind the Odoo adapter/evidence layer.

## Demo questions

1. Why can ACME EMS not scale the Industrial Controller PCB Assembly to 12,000 units per month?
2. Why did the controller's unit cost increase?
3. What would happen if ACME switched MCU suppliers?

## Design principles

- Do not hard-code answers or query-specific traversal into LeMap.
- Keep CallPathIndexer generic and unchanged.
- Pass 1 decides semantic coherence from compact structural evidence.
- Pass 2 receives implementation bodies only from the selected concrete path and only through the Pass-1 coherent boundary.
- Odoo-specific entity/framework semantics remain in the Odoo adapter and canonical topology.
- Demo data should create real Odoo objects and relationships whenever practical, not detached answer tables.
- Query-v4 should answer by following learned workflows, entity schemas, deterministic relationships, and runtime/demo data rather than bespoke demo logic.

## Part A: Pass-2 boundary clipping

Current behavior selects one concrete path correctly but dereferences every function body on that concrete path. This leaks technical tail functions beyond Pass 1's `coherentThroughSignature` into Pass 2.

Required behavior:

```text
selected grouped family
  -> choose one concrete path
  -> locate coherentThroughSignature in that concrete path's normalizedFlowTokens
  -> clip concrete path symbolIds/tokens to the matching position
  -> dereference bodies only from the clipped symbolIds
  -> send the same clipped executable sequence to Pass 2
```

If no coherent boundary exists or it cannot be found on the selected path, retain the selected concrete path unchanged rather than guessing.

Pass-2 logging must expose the selected concrete path and clipping boundary so a run can prove what evidence was sent.

## Lifecycle setup evidence

`post_init_hook` is installation/demo setup. It may be useful context/provenance because it explains configuration and seeded records, but it must not become a runtime business workflow step such as "Demo master data and route setup".

The implementation should mark lifecycle/setup functions as contextual evidence where that metadata is available, and the structured-workflow prompt should tell the model not to turn setup-only evidence into an operational workflow step.

## Part B: Query 1 — 12,000-unit production constraint

The answer must be discoverable by connecting manufacturing demand to routing/work centers, BOM/component supply, and quality/rework loss.

### Capacity evidence

Existing seeded work centers already provide:

- SMT Line 1: planned 650/day, actual 590/day, queue 280
- Assembly/THT: planned 560/day, actual 525/day, queue 240
- AOI: planned 540/day, actual 500/day, queue 310
- Functional Test: planned 390/day, actual 342/day, queue 1180, 21 downtime hours/month, 46 overtime hours/month
- Rework Cell: planned 80/day, actual 67/day, queue 190

With a 22-working-day planning month, the observed monthly capacities are approximately 12,980, 11,550, 11,000, and 7,524 units for the four main operations. Functional Test is the strongest internal bottleneck, while Assembly and AOI are also below 12,000.

The demo must preserve real `mrp.bom` operations (`mrp.routing.workcenter`) and work-center links so Query-v4 can traverse from the manufactured product/MO/BOM to operation and work-center capacity evidence.

### Material evidence

The BOM consumes one High Performance MCU per controller. The current preferred MCU source is deliberately constrained: single source, 45-day lead time, 91% OTD, MOQ 90, with an explicit shortage on one MO. Query-v4 must be able to connect the MO/BOM component to manufacturer part and approved supply data.

### Quality/effective-throughput evidence

The demo already contains functional-test failure, AOI-related rework and scrap. Those records should remain linked to the production order/work center so they can explain effective throughput loss rather than only nominal capacity.

## Part C: Query 2 — controller cost increase

A meaningful "increase" requires a comparison basis. Add evidence that distinguishes a baseline/quoted or prior cost from the current realized/expected cost drivers without hard-coding the answer.

Use normal EMS cost contributors already represented in the model where possible:

- material unit price
- supplier freight
- expedite premium
- rework labor/material/external cost
- scrap material/labor cost
- overtime or capacity-expedite exposure

The demo should include a small explicit cost-snapshot/history entity only if Odoo's existing records do not provide a stable historical comparison. If added, it must be a general ACME EMS business entity, not a query-specific answer table.

## Part D: Query 3 — MCU supplier switch

The current MCU is intentionally single-source. Add a second plausible manufacturer/approved supply option for the same logical MCU requirement, with materially different trade-offs in price, lead time, OTD, quality, MOQ, freight/expedite and approval/preference state.

Query-v4 should be able to compare the two options through:

```text
controller BOM
 -> MCU product
 -> manufacturer part(s)
 -> approved supply offers
 -> supplier
 -> cost / lead-time / quality / reliability / MOQ
```

No special "supplier switch" calculation belongs in LeMap. The answer should derive from the mapped fields and values.

## Learning/query coverage needed

The learned semantic map must expose at least these connected domains:

```text
sale.order
 -> sale.order.line
 -> stock.rule
 -> mrp.production
 -> mrp.bom
 -> mrp.routing.workcenter
 -> mrp.workcenter

mrp.bom
 -> bom_line_ids / component product
 -> acme.manufacturer.part
 -> acme.approved.supply
 -> res.partner supplier

mrp.production
 -> acme.rework.event
 -> acme.test.result
 -> acme.lot.trace
```

Static learning should establish entity/schema relationships and relevant workflows. The later data-query execution may use the configured Odoo data source once that connector is enabled; until then deterministic demo assessment can prove that the data required by the three questions exists and is structurally connectable.

## Acceptance criteria

1. A fresh ACME learn run shows Pass 2 no longer receives function bodies after Pass 1's coherent boundary.
2. Installation/demo hooks are not emitted as operational workflow stages.
3. The ACME seed contains internally consistent work-center, routing, material, supplier, quality and cost evidence for all three questions.
4. A deterministic assessment reports the evidence paths and expected numerical capacity constraints for the 12,000-unit question.
5. LeMap's persistent map exposes the entities/relationships required for Query-v4 to plan each of the three questions without query-specific code.
6. Existing Moqui behavior remains compatible.