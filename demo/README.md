# DataSong semantic discovery demo

This demo is designed to test one specific claim:

> Can a useful semantic model of an unfamiliar enterprise data estate be reconstructed automatically from the evidence already present in that estate?

The first version is intentionally synthetic so that we know the ground truth and can measure discovery quality objectively.

## Scope of v0

For the first version, all enterprise datasets are represented as CSV files. Connecting to SQL, NoSQL, warehouses, Delta Lake, object storage and other technologies is treated as a lower normalization/federation layer and is out of scope for this demo.

Conceptually:

```text
Enterprise technologies
        ↓
Normalization / federation layer
   (out of scope for v0)
        ↓
Normalized datasets (CSV)
        ↓
DataSong semantic discovery
```

The purpose of v0 is to prove semantic discovery, not connector technology.

## Demo estate

The synthetic company is a small industrial distributor with customer, order, product, inventory, shipment and machine/operational telemetry data.

Current generated datasets:

- `customer_master.csv`
- `material_master.csv`
- `sales_order.csv`
- `sales_order_line.csv`
- `warehouse_stock.csv`
- `shipment.csv`
- `machine_asset.csv`
- `telemetry.csv`
- `maintenance_event.csv`
- `cost_centre_reference.csv`

The last dataset deliberately creates a misleading identifier overlap so that value similarity alone is not enough to infer the correct semantic relationship.

System context is also generated separately:

- synthetic application source code
- SQL queries
- configuration / metadata files
- integration mappings

## Important design rule

Do not make the semantic relationships obvious from identical names.

Examples:

- `sales_order.buyer_ref` -> `customer_master.cust_no`
- `sales_order_line.material_code` -> `material_master.part_number`
- `warehouse_stock.sku` -> `material_master.part_number`
- `shipment.sales_ref` -> `sales_order.order_no`
- `machine_asset.material_ref` -> `material_master.part_number`

The data should contain realistic imperfections: missing values, stale identifiers, duplicates, partial overlap and misleading candidate matches.

# Staged discovery architecture

A central design rule is to keep deterministic/local evidence separate from LLM interpretation. This makes the resulting semantic graph explainable and auditable.

The demo is split into three inference stages.

## Stage 1 — Data evidence and data inference

### 1A. Local deterministic scan

An MCP tool such as:

```text
datasong.scan_data()
```

runs locally against the normalized datasets.

It should return a compact evidence package rather than raw datasets.

For every dataset and column it should calculate at least:

- row count
- inferred type
- null rate
- unique count / cardinality
- uniqueness ratio
- representative values
- candidate primary keys
- likely date/time fields
- likely measures
- cross-dataset value overlap
- likely relationship cardinality
- candidate physical relationships

A small number of representative records may also be returned because seeing fields together can help interpretation. Large raw samples should not be sent to the LLM.

Example deterministic evidence:

```text
Table: sales_order
Rows: 180

order_no
  type: string
  unique: 180 / 180
  candidate_key: true
  samples: SO-00001, SO-00002, SO-00003

buyer_ref
  type: string
  unique: 59
  samples: C0043, C0018, C0052

candidate relationships:
  customer_master.cust_no
    overlap: 98%
    cardinality: many -> one

  cost_centre_reference.code
    overlap: 49%
    cardinality: many -> one
```

This raw deterministic output is persisted as:

```text
physical_evidence.json
```

### 1B. LLM data interpretation

ChatGPT receives the compact physical evidence from the MCP tool and interprets what can reasonably be inferred from the data alone.

At this stage the model may infer structural meaning such as:

- transaction-like vs master-like datasets
- candidate business entities
- one-to-many / many-to-one relationships
- parent-child structures
- hub/reference datasets
- ambiguous candidate mappings

It should not pretend to know business verbs that are unsupported by the data.

Example interpretation:

```json
{
  "dataset": "sales_order",
  "inferred_role": "transaction-like dataset",
  "candidate_entity": "Order",
  "key": "order_no",
  "relationships": [
    {
      "field": "buyer_ref",
      "target": "customer_master.cust_no",
      "structural_interpretation": "likely many orders reference one customer-like master record",
      "confidence": 0.91,
      "status": "candidate"
    }
  ],
  "ambiguities": [
    {
      "field": "buyer_ref",
      "alternative": "cost_centre_reference.code",
      "reason": "partial identifier overlap; business meaning unresolved"
    }
  ]
}
```

This LLM-derived interpretation is persisted separately as:

```text
stage1_data_inference.json
```

This separation is important:

```text
physical_evidence.json
        !=
stage1_data_inference.json
```

The first is observed/calculated evidence. The second is interpretation.

## Stage 2 — System-context evidence and context inference

### 2A. Local source/configuration scan

A second MCP tool such as:

```text
datasong.scan_context()
```

runs locally against source code, SQL, configuration and mapping artifacts.

It should extract bounded structured contexts rather than handing an entire repository to the LLM.

Useful evidence includes:

- functions and callers/callees
- tables / datasets read and written
- SQL joins
- function parameters passed into repository/data-access calls
- configuration relationships
- integration field mappings
- workflow/process relationships
- business-operation hints

Example:

```text
File: fulfilment.sql

Observed joins:
sales_order.buyer_ref = customer_master.cust_no
sales_order_line.material_code = warehouse_stock.sku
```

And:

```text
File: order_service.py

Function:
create_order(buyer_ref, items)

Observed calls:
customer_repo.find_by_number(buyer_ref)
stock_repo.available_for(item.material_code)
order_repo.insert(buyer_ref, items)
```

This deterministic context evidence is persisted as:

```text
context_evidence.json
```

### 2B. LLM context interpretation

ChatGPT interprets these bounded contexts to infer higher-level meaning.

Example:

```json
{
  "operations": [
    {
      "name": "create_order",
      "inferred_business_operation": "customer order creation"
    }
  ],
  "relationship_evidence": [
    {
      "source": "sales_order.buyer_ref",
      "target": "customer_master.cust_no",
      "meaning_hint": "buyer/customer associated with order",
      "evidence": [
        "explicit SQL join",
        "buyer_ref passed to customer lookup"
      ]
    }
  ]
}
```

This is persisted as:

```text
stage2_context_inference.json
```

Again, deterministic context evidence and LLM interpretation remain separate.

## Stage 3 — Semantic fusion

The final semantic inference stage combines the two clean summaries:

```text
stage1_data_inference.json
            +
stage2_context_inference.json
            ↓
          ChatGPT
            ↓
semantic_graph.json
```

The model should reconcile independent evidence instead of treating any one signal as truth.

For example:

```text
Data evidence:
sales_order.buyer_ref strongly matches customer_master.cust_no

SQL evidence:
sales_order.buyer_ref joins customer_master.cust_no

Code evidence:
buyer_ref is passed to customer_repo.find_by_number()
```

This supports a semantic inference such as:

```text
Customer
   |
   | places
   v
Order
```

with the physical mapping retained underneath:

```text
customer_master.cust_no
  <-> sales_order.buyer_ref
```

A misleading candidate such as:

```text
sales_order.buyer_ref
  <-> cost_centre_reference.code
```

may have some value overlap in Stage 1, but should lose confidence if no system-context evidence supports it.

The final `semantic_graph.json` should contain:

- semantic entities
- semantic relationships / verbs
- physical source mappings
- evidence references
- confidence
- unresolved / ambiguous mappings
- provenance showing which stage contributed which evidence

## Why evidence and inference must remain separate

For any inferred semantic relationship, DataSong should be able to answer:

> Why do you believe this?

For example:

```text
Customer PLACES Order

Physical evidence
- 98% value overlap between sales_order.buyer_ref and customer_master.cust_no
- many-to-one cardinality

System-context evidence
- explicit SQL join
- buyer_ref passed to customer lookup

LLM interpretation
- buyer_ref represents the customer associated with the order

Final confidence
- 0.xx
```

This traceability is a core property of the design, not just a demo feature.

# Expected semantic ground truth

The synthetic estate has a hidden answer key so discovery can be measured objectively.

Expected high-level model:

```text
Customer
  -> places -> Order

Order
  -> contains -> Product
  -> fulfilled through -> Shipment

Product
  -> stocked in -> Inventory
  -> associated with -> Machine / Asset

Machine / Asset
  -> emits -> Telemetry
  -> has -> Maintenance Event
```

The DataSong inference stages must not read the hidden ground-truth graph.

# Human review

The UI should let a domain expert inspect each inferred relationship and mark it:

- correct
- incorrect
- partially correct / needs refinement

Corrections should be persisted as semantic knowledge rather than discarded.

# Demo experience

The demo should show discovery progressively rather than simply displaying a finished graph.

Suggested sequence:

1. Start with an unfamiliar normalized estate.
2. Run `scan_data` and show candidate physical relationships.
3. Show the Stage 1 data-only interpretation.
4. Run `scan_context` against source/configuration evidence.
5. Show what the additional evidence confirms, rejects or clarifies.
6. Fuse both stages into the semantic graph.
7. Click a relationship to answer: **Why does DataSong believe this?**
8. Ask a cross-system business question that requires traversing several semantic relationships.

Example final question:

> Which customers ordered products used by machines whose vibration exceeded the normal range shortly before a maintenance event?

This forces the semantic layer to connect transactional customer/order data with product/master data and operational time-series data.

# Measurement

Because the estate is synthetic, compare the discovered output against hidden ground truth.

Track at least:

- entity precision / recall
- relationship precision / recall
- correct physical field mappings
- confidence calibration
- discoveries attributable to data alone
- discoveries added by source/configuration context
- false candidates rejected after context analysis
- relationships requiring human correction

The goal is not to claim perfect autonomous understanding. The goal is to establish whether DataSong can generate a strong, explainable first semantic model that is materially faster to validate than building one manually.

# Initial implementation

Keep v0 simple:

- Python synthetic data generator
- CSV datasets only
- local deterministic profiling
- deterministic relationship scoring before any LLM step
- MCP tool for data evidence retrieval
- source/config parser producing bounded evidence snippets
- MCP tool for system-context evidence retrieval
- persisted JSON evidence and inference artifacts
- JSON semantic graph
- lightweight browser UI for graph + evidence review

Once this discovery loop works, the same architecture can be tested against an open-source CRM/ERP and eventually a friendly real enterprise pilot.
