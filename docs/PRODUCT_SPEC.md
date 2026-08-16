# DataSong Product Specification

## Purpose

DataSong builds a living, evidence-backed semantic model of an enterprise: what business concepts mean, how they relate, how workflows operate, which conditions alter those workflows, and where the durable data behind those concepts and processes lives.

The semantic model is the core technology. Discovery, dynamic data views, analytics, ML data preparation, operational explanation, and agent grounding are applications built on top of it.

The product should not be constrained to being only a semantic catalog or semantic SQL layer. Its advantage comes from connecting business meaning, workflow behaviour, conditions, persistent data, and evidence into one navigable model.

---

## Core model

DataSong should connect at least four layers:

```text
Business concepts
        ↓
Business workflows and conditions
        ↓
Application/services/code/configuration
        ↓
Persistent enterprise data
```

Examples of business concepts:

- Customer
- Order
- Product
- Inventory
- Shipment
- Invoice
- Payment
- Asset

Examples of workflow semantics:

```text
Customer
   ↓ places
Order
   ↓ contains
Order Item
   ↓ refers to
Product
   ↓ may reserve
Inventory
   ↓ may produce
Shipment
   ↓ may produce
Invoice
   ↓ may be settled by
Payment
```

The relationships should be backed by evidence rather than inferred only from naming conventions.

---

## Persistent data versus runtime state

A fundamental requirement is to distinguish data that exists only during workflow execution from data that is durable and therefore available to analytics, ML, reporting, and downstream applications.

### Runtime values

Examples:

- function parameters
- local variables
- maps and objects
- intermediate identifiers
- calculated values
- branch flags
- temporary service outputs

These values help explain how a workflow behaves but are not automatically useful as analytical datasets.

### Persistent data

Examples:

- database tables/entities
- durable records
- table/entity fields
- persisted events
- lake/warehouse records
- durable operational state

Persistent data is what DataSong should ultimately expose when an analyst or ML engineer asks for a data view.

### Derived/transient values

Some values are calculated during a workflow and influence durable data but are not themselves persisted. Examples include calculated prices, totals, eligibility flags, or intermediate scores.

The discovery trace should preserve all three classes, even if the user-facing semantic model normally emphasizes persistent business data.

Example:

```text
customerPartyId [runtime]
      ↓ persisted_as
OrderPart.customerPartyId [persistent]

OrderPart.orderId [persistent]
      ↓ loaded_as
orderId [runtime]
      ↓ passed_to
createOrderItem()

price [derived runtime]
      ↓ persisted_as
OrderItem.unitAmount [persistent]
```

This distinction is essential because DataSong is intended to help users construct usable data views, not merely understand application control flow.

---

## Evidence model

DataSong should accumulate evidence from multiple sources rather than relying on one discovery technique.

### 1. Schema and data evidence

Useful evidence includes:

- tables/datasets and fields
- inferred types
- keys and uniqueness
- cardinality
- null rates
- value overlap
- observed join compatibility
- population frequency
- temporal coverage
- representative values

This establishes the physical structure and tests whether relationships inferred elsewhere are reflected in real enterprise data.

### 2. Static code and workflow analysis

Static analysis should discover:

- business services/functions
- caller/callee relationships
- persistent entities read and written
- fields propagated into persistent records
- workflow stages
- branch predicates
- configuration conditions
- API and integration mappings
- explicit and indirect data dependencies

Static analysis should be the first choice where behaviour is sufficiently visible in source/configuration because it is cheaper and simpler than runtime execution.

### 3. Configuration evidence

Configuration can materially alter workflow semantics.

Examples:

```text
requireInventory = true/false
reservation mode
payment gateway
sales channel
regional rules
feature flags
store configuration
```

When a branch is driven by configuration, DataSong can often reason about both paths symbolically without creating a full runtime environment.

### 4. Observed data evidence

Persistent data can be correlated with statically inferred paths.

For example, static analysis may show that an OrderItem can create an AssetReservation under certain conditions. Database evidence may show that this path appears for roughly 80% of relevant orders and not for 20%.

This does not turn DataSong into a conventional analytics engine by itself. The observed distribution is evidence used to qualify the semantic relationship:

```text
OrderItem
   ↓ may create
AssetReservation

Evidence:
- static workflow path: present
- compatible keys: present
- observed population: ~80%
- runtime observation: optional
```

Confidence should be evidence-backed and should not be presented as an arbitrary probability when the underlying evidence does not justify one.

### 5. Runtime evidence — optional

Runtime execution is not required for every workflow.

Static analysis may already establish linear workflow and data-flow relationships with high confidence. Runtime simulation or tracing becomes useful mainly when it resolves uncertainty or adds stronger evidence.

Good reasons to use runtime execution include:

- dynamic dispatch
- reflection
- framework callbacks
- event buses
- database triggers
- plugins
- generated code
- external integrations
- hidden side effects
- ambiguous branch reachability
- behaviour that cannot be resolved confidently from source/configuration

Runtime observation can strengthen evidence by demonstrating that a possible path is actually reachable and used.

The guiding principle is:

> Execute only as much as needed to resolve uncertainty.

A preferred hierarchy is:

```text
Static analysis
    ↓
Symbolic/configuration path exploration
    ↓
Synthetic data reasoning/execution where useful
    ↓
Runtime simulation or tracing only for unresolved/high-value ambiguity
```

Simulation is therefore an evidence and ambiguity-resolution mechanism, not a mandatory central architecture requirement.

---

## Workflow discovery and semantic slices

DataSong can build the semantic model incrementally from business questions.

Example business question:

> What happens when a customer places an order?

The system should discover a bounded workflow/dataflow slice such as:

```text
Customer
   ↓
Order
   ↓
Order Item
   ↓
Product
```

and connect that business-level model to the persistent data underneath it:

```text
Customer      → Party / PartyRole
Order         → OrderHeader / OrderPart
Order Product → OrderItem
Product       → Product
```

The discovery should also capture conditions that change the workflow:

```text
inventory required?
stock available?
payment authorized?
order approved?
shipment completed?
regional/store/channel rules?
```

Many such slices can be merged into a broader enterprise semantic graph.

---

## From semantic map to dynamic data views

The semantic model should allow a user to ask for business data without first knowing the physical schema or pipeline topology.

Example:

> Give me the data needed to understand the fall in sales last quarter.

DataSong can use the semantic graph to identify the relevant durable data across the business paths that produce sales:

```text
Customer
Order
Order Item
Product
Inventory
Reservation
Payment
Shipment
Invoice
Return / Cancellation
Channel / Region
```

A federation/query engine such as Trino can then be used to create dynamic views across the underlying systems.

Conceptual generated view:

```text
sales_analysis_view

order_id
customer_id
product_id
order_date
quantity
unit_price
order_status
inventory_available_at_order
reservation_status
payment_status
shipment_status
invoice_amount
return_status
sales_channel
region
...
```

The key distinction is that the view is constructed from semantic and workflow understanding, not merely from schema matching.

---

## Analytics as an application of the semantic model

DataSong may optionally go beyond identifying the right data and analyze the generated view itself.

For example, for:

> Why did sales fall last quarter?

DataSong could first identify how sales are produced through the enterprise workflow, construct the relevant data view, and then analyze the records.

It could surface findings such as:

```text
Sales down 14% QoQ

Product X:
  sales down 31%
  accounts for 48% of total decline

Observed contributing paths:
  inventory-related path  62%
  payment-related path    21%
  cancellations           11%
  other                     6%
```

These percentages are analytical outputs derived from real data, not semantic confidence scores.

The result can then be projected back onto the semantic workflow map so the user sees where the business outcome is changing:

```text
Order
  ↓
Inventory check      ← major degradation
  ↓
Reservation
  ↓
Payment              ← smaller degradation
  ↓
Shipment
  ↓
Recognized sale
```

This makes the semantic graph an explainable analytical surface rather than only a catalog.

---

## Product applications

The same core semantic model can support several enterprise applications.

### DataSong Discovery

Automatically discover and maintain the enterprise semantic map from schemas, data, workflows, code, configuration, mappings, and optional runtime evidence.

### DataSong Data

Allow analysts, engineers, and agents to request business data in natural language and dynamically construct governed data views across systems.

### DataSong Analyst

Use the semantic graph to identify the business mechanisms behind a question, construct the relevant data view, and optionally perform analysis grounded in those workflows.

### DataSong ML

Help ML engineers discover relevant datasets and features from business concepts and process dependencies rather than manually searching schemas and building pipelines first.

### DataSong Operations

Explain operational outcomes using workflow paths, conditions, state transitions, and the persistent data produced by those paths.

### DataSong Agent Grounding

Provide enterprise agents with an evidence-backed model of what business concepts mean, which data represents them, which workflows affect them, and which actions/conditions are relevant.

These applications are choices that an enterprise can enable independently. The semantic model remains the shared foundation.

---

## Example: semantic reasoning for a sales question

A conventional semantic layer might answer:

```text
Sales → sales_order + sales_order_line
```

DataSong should be capable of going further:

```text
Sales outcome
   ↑
Invoice / recognized revenue
   ↑
Shipment / fulfilment
   ↑
Payment authorization / settlement
   ↑
Inventory reservation and availability
   ↑
Order approval
   ↑
Order / Order Item
   ↑
Customer + Product + Channel
```

For each edge, DataSong can retain:

- business meaning
- workflow/service evidence
- branch conditions
- persistent tables/entities and fields
- key propagation
- schema/data evidence
- observed prevalence where useful
- confidence and provenance

This enables a user or ML engineer to understand not only which tables contain sales data, but which business flows and conditions enable or prevent sales and which persistent data records those outcomes.

---

## Design principle

DataSong should not force every enterprise question into analytics, nor stop every question at a semantic graph.

The semantic model should make multiple levels of use possible:

```text
Understand
   ↓
Ask
   ↓
Build data views
   ↓
Analyze / model
   ↓
Act
```

An enterprise may choose to use DataSong only for discovery and navigation, for dynamic data access, for analytical reasoning, for ML preparation, or eventually for controlled operational action.

The core differentiator is the same in every case:

> DataSong connects business meaning, workflow behaviour, conditions, and persistent enterprise data into an evidence-backed model that can be used directly by people, analytics, ML systems, and agents.
