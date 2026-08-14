# DataSong semantic discovery demo

This demo is designed to test one specific claim:

> Can a useful semantic model of an unfamiliar enterprise data estate be reconstructed automatically from the evidence already present in that estate?

The first version is intentionally synthetic so that we know the ground truth and can measure discovery quality objectively.

## Demo estate

The synthetic company is a small industrial distributor with customer, order, product, inventory, shipment and machine/operational telemetry data spread across different kinds of systems.

### Logical sources

1. **CRM-like customer data**
   - Accounts / customers
   - Contacts
   - Service cases

2. **Transactional SQL data**
   - Sales orders
   - Sales order lines
   - Shipments

3. **Inventory / ERP-like data**
   - Material master
   - Warehouse stock
   - Reorder levels

4. **Operational time-series data**
   - Machine sensor readings
   - Temperature
   - Vibration
   - Power consumption
   - Maintenance events

5. **System context**
   - Synthetic application source code
   - SQL queries
   - Configuration / metadata files
   - Integration mappings

The physical technologies are represented as if the estate spans SQL, NoSQL/document data, a warehouse, Delta Lake/object storage and time-series datasets. The first implementation can still use local files/SQLite/Parquet so the demo remains easy to run.

## Important design rule

Do not make the semantic relationships obvious from identical names.

Examples:

- `sales_order.buyer_ref` -> `customer_master.cust_no`
- `sales_order_line.material_code` -> `material_master.part_number`
- `warehouse_stock.sku` -> `material_master.part_number`
- `shipment.sales_ref` -> `sales_order.order_no`
- `machine_asset.material_ref` -> `material_master.part_number`

The data should contain realistic imperfections: missing values, stale identifiers, duplicates, partial overlap and at least a few misleading candidate matches.

## Discovery stages

### 1. Physical discovery

Inspect datasets locally and produce:

- tables / datasets
- columns and inferred types
- cardinality and uniqueness
- null rates
- representative values
- candidate primary keys
- candidate cross-dataset relationships based on value overlap and other structural evidence

### 2. System-context discovery

Inspect source/configuration artifacts and extract small structured contexts:

- functions and call relationships
- tables / datasets read and written
- SQL joins
- configuration relationships
- integration field mappings
- business operation hints

An LLM may then interpret these bounded contexts to propose business meaning. Raw enterprise datasets should not need to be sent to the LLM.

### 3. Evidence fusion

Combine independent evidence for each proposed semantic relationship.

Example:

```text
Relationship: Customer PLACES Order

Physical mapping:
customer_master.cust_no
  <-> sales_order.buyer_ref

Evidence:
- strong identifier overlap
- matching key/cardinality behaviour
- SQL join observed
- OrderService passes buyer_ref to customer lookup
- configuration metadata labels buyer_ref as account reference

Confidence: 0.xx
```

### 4. Semantic graph

Produce a machine-readable graph containing:

- semantic entities
- relationships
- physical source mappings
- evidence
- confidence
- unresolved / ambiguous mappings

Expected high-level ground truth for the first estate:

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

### 5. Human review

The UI should let an expert inspect each inferred relationship and answer:

- correct
- incorrect
- partially correct / needs refinement

Corrections should be retained as semantic knowledge rather than discarded.

## Demo experience

The demo should show discovery progressively rather than simply displaying a finished graph.

Suggested sequence:

1. Connect an unfamiliar estate.
2. Show detected datasets and technologies.
3. Show candidate relationships emerging from data.
4. Add context discovered from source/configuration.
5. Show the semantic graph and confidence/evidence.
6. Click a relationship to answer: **Why does DataSong believe this?**
7. Ask a cross-system business question that requires traversing several semantic relationships.

Example final question:

> Which customers ordered products used by machines whose vibration exceeded the normal range shortly before a maintenance event?

This forces the semantic layer to connect transactional customer/order data with product/master data and operational time-series data.

## Measurement

Because the estate is synthetic, maintain a hidden ground-truth graph and compare discovery output against it.

Track at least:

- entity precision / recall
- relationship precision / recall
- correct physical field mappings
- confidence calibration
- discoveries attributable to data alone
- additional discoveries attributable to configuration/source context
- relationships requiring human correction

The goal of the demo is not to claim perfect autonomous understanding. It is to establish whether DataSong can generate a strong, explainable first semantic model that is materially faster to validate than building one manually.

## Initial implementation

Keep v0 simple:

- Python
- CSV / JSON / SQLite / Parquet synthetic sources
- local profiling
- deterministic relationship scoring before any LLM step
- source/config parser producing bounded evidence snippets
- JSON semantic graph
- lightweight browser UI for graph + evidence review

Once the discovery loop works, the same approach can be tested against an open-source CRM/ERP and eventually a friendly real enterprise pilot.
