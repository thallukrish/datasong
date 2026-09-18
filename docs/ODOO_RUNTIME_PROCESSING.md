# Odoo runtime processing

## Status

This document defines the Odoo-specific runtime-evidence pipeline that complements the existing static Odoo adapter.

The goal is not to replace static analysis. Static analysis determines what Odoo can do from source, manifests, XML views, Python models and framework inheritance. Runtime processing records what one enterprise instance actually does for concrete user-visible scenarios.

The two evidence streams are correlated before call-path ranking.

---

## 1. Why runtime evidence is needed

Static Odoo traversal has to consider many valid alternatives:

- XML buttons and server actions
- inherited model implementations
- framework extension modules
- conditional branches
- dynamic recordset dispatch
- route-dependent procurement and manufacturing behavior

Static analysis therefore gives a superset of plausible execution.

Runtime evidence narrows that superset for a concrete enterprise configuration.

The intended model is:

```text
STATIC ANALYSIS
enterprise repository + installed Odoo closure
        ↓
possible executable topology

RUNTIME OBSERVATION
enterprise Odoo instance + enterprise scenarios
        ↓
observed executable events

possible topology + observed events
        ↓
correlation
        ↓
enterprise-specific annotated topology
        ↓
CallPathIndexer
```

Static evidence gives coverage. Runtime evidence gives confidence and branch selection.

---

## 2. Enterprise-specific evidence

Both static and runtime outputs are enterprise-scoped.

For example:

```text
ACME EMS source + manifests + configured modules
        ↓
ACME static topology

ACME EMS disposable/staging Odoo instance
+ ACME business scenarios
        ↓
ACME runtime trace

ACME static topology + ACME runtime trace
        ↓
ACME annotated executable topology
```

The adapter implementation remains reusable and generic.

The generated evidence must carry an enterprise identity so SaaS onboarding can keep maps, traces and correlations isolated per customer.

A future storage layout may use a key such as:

```text
enterpriseId
repository commit
Odoo version
installed module closure
scenario set version
runtime session id
```

---

## 3. Odoo adapter separation

Odoo support should remain split into distinct concerns.

```text
server/adapters/odoo/

static analysis
    model / schema parsing
    XML entrypoint discovery
    framework source enrichment
    inheritance-aware method discovery
    executable topology construction

runtime/
    scenario loading
    disposable/staging execution
    instrumentation
    event logging
    trace collection

correlation/
    match runtime events to static symbols/edges
    annotate topology with observed evidence
```

The runtime harness is Odoo-specific because it understands Odoo execution, models, views and dispatch.

CallPathIndexer remains framework-agnostic.

---

## 4. Processing order

The planned Odoo processing order is:

```text
1. static queue/traversal
2. runtime logging enablement
3. enterprise scenario execution
4. runtime trace collection
5. static/runtime correlation
6. CallPathIndexer
7. Pass 1 / Pass 2
```

### 4.1 Static traversal

The static adapter discovers:

```text
project models
framework models
XML object buttons
server actions
Python methods
inheritance / _inherit implementations
calls
recordset transitions
persistence evidence
```

Traversal should follow the descendants of an entrypoint before consuming the traversal budget on unrelated UI entrypoints.

This avoids spending the entire framework-method budget on broad XML-button coverage while leaving an important chain unresolved.

Example target:

```text
sale.order.action_confirm
→ sale.order._action_confirm
→ sale.order.line._action_launch_stock_rule
→ stock.rule.run
→ manufacturing path
```

---

## 5. Enterprise scenario specification

Runtime execution must be driven by enterprise business scenarios, not by hard-coded framework method names.

The scenario describes what a user of the enterprise application sees and does.

Example:

```json
{
  "enterprise": "acme-ems",
  "scenarios": [
    {
      "id": "sale-to-manufacturing",
      "actor": "sales_user",
      "start": {
        "model": "sale.order",
        "view": "form"
      },
      "data": {
        "customer": "Acme Hospital",
        "product": "EMS Monitor X1",
        "quantity": 5
      },
      "actions": [
        { "type": "create" },
        { "type": "click", "label": "Confirm" }
      ],
      "expectedBusinessOutcome": [
        "sale confirmed",
        "procurement launched",
        "manufacturing order created"
      ]
    }
  ]
}
```

The important rule is:

```text
bad scenario:
call sale.order.action_confirm()

good scenario:
open Sales Order
enter synthetic order data
click Confirm
```

The runtime harness resolves the user-visible action through Odoo UI metadata and framework execution.

---

## 6. Scenario ownership and location

Enterprise scenarios should not live as hard-coded logic inside the generic adapter.

A repository may keep them in an enterprise-owned location such as:

```text
<enterprise-repo>/
    lemap/
        odoo-scenarios.json
        fixtures/
            customers.json
            products.json
            orders.json
```

The generic runtime harness consumes this configuration.

For SaaS, the same scenario/config concept can be stored outside the customer repository while still being keyed by enterprise.

Synthetic fixtures should be preferred for disposable execution unless an explicitly approved staging snapshot is available.

Production databases are not required for this process.

---

## 7. Disposable or staging runtime

The expected enterprise workflow is:

```text
enterprise source/config
        ↓
create disposable Odoo environment
        ↓
install the enterprise addon/module closure
        ↓
load synthetic fixtures
        ↓
enable LeMap runtime instrumentation
        ↓
execute configured scenarios
        ↓
collect structured traces
        ↓
destroy or reset environment
```

Docker is a natural implementation for this because the static adapter already knows the enterprise repository and Odoo version/module closure.

The runtime system should also support an authorized staging instance where spinning up a disposable copy is not practical.

---

## 8. Runtime instrumentation

Instrumentation should be generic Odoo instrumentation, not logging manually inserted into ACME business code.

The first version should capture enough information to correlate Odoo execution to the static topology.

Minimum event shape:

```json
{
  "enterpriseId": "acme-ems",
  "scenarioId": "sale-to-manufacturing",
  "sessionId": "run-...",
  "seq": 18,
  "model": "sale.order",
  "method": "_action_confirm",
  "addon": "sale_stock",
  "source": "addons/sale_stock/models/sale_order.py"
}
```

Useful later fields include:

```text
timestamp
caller model.method
callee model.method
record model
record IDs
create/read/write operation
request or transaction id
user / role
duration
exception
view/action id
XML entrypoint id
```

Runtime logging must remain enterprise-scoped.

---

## 9. UI/XML to framework execution

One purpose of the runtime scenario harness is to connect user-visible behavior to framework execution.

For an Odoo button:

```text
user scenario action
→ resolved Odoo view
→ XML button / server action
→ object method
→ Python model method
→ inherited Odoo implementations
→ downstream framework calls
→ persistence
```

Example:

```text
Sales Order form
→ Confirm button
→ sale.order.action_confirm
→ sale_stock extension(s)
→ stock/procurement
→ mrp
```

Static XML discovery tells LeMap that the entrypoint exists.

Runtime execution confirms that this enterprise scenario actually exercised it.

---

## 10. Correlation

Runtime events do not bypass the static topology.

They are correlated back onto static symbols and executable edges.

Example:

```text
static:
sale.order.action_confirm
→ sale.order._action_confirm

runtime:
sale.order.action_confirm observed
sale.order._action_confirm observed from sale_stock

correlated topology:
edge observed = true
scenarioIds = ["sale-to-manufacturing"]
observationCount = N
```

Useful generic annotations may include:

```text
runtimeObserved
runtimeObservationCount
runtimeScenarioIds
runtimeSessionIds
lastObserved
observedCallerCount
observedEdgeCount
```

Correlation should preserve provenance to both static source and runtime trace.

---

## 11. CallPathIndexer handoff

CallPathIndexer should receive one executable topology enriched with runtime evidence.

It should not contain Odoo-specific runtime logic.

The Odoo adapter/correlation layer converts Odoo runtime evidence into generic path evidence.

The current structural ranking invariant remains:

```text
distinct first-class entity count is primary
```

Runtime evidence is used to discriminate plausible branches, especially among structurally comparable paths.

Conceptually:

```text
excluded lifecycle/setup paths last

then
distinct first-class entity count

then, for comparable paths
runtime-observed path
observed executable-edge coverage
structural score
stable fallback order
```

Runtime evidence must not erase unobserved static paths. A scenario run proves observation, not impossibility of alternatives.

---

## 12. Lifecycle/setup evidence

Odoo setup hooks such as `post_init_hook` remain separate from runtime business execution.

They may provide structural or persistence evidence but must not become business-flow entrypoints merely because they call business methods while loading demo/setup data.

This distinction remains:

```text
setup/lifecycle execution
    ≠
user/runtime business workflow
```

---

## 13. SaaS model

The same design supports enterprise onboarding.

A future flow can be:

```text
connect enterprise Odoo repository/configuration
        ↓
static scan
        ↓
derive/install relevant Odoo module closure
        ↓
load enterprise scenario specification
        ↓
spin disposable/staging runtime
        ↓
execute scenarios with synthetic/approved data
        ↓
collect enterprise-scoped traces
        ↓
correlate static + runtime evidence
        ↓
build/refine enterprise LeMap
```

Each customer's map and runtime logs remain separately identified and persisted.

The reusable product is the adapter/runtime/correlation machinery. The source, configuration, scenarios, traces and resulting map are enterprise-specific.

---

## 14. Current implementation boundary

Already implemented in the current branch:

- static Odoo model/schema extraction
- framework source enrichment
- XML object-button discovery
- framework method traversal
- inheritance-aware implementation lookup
- first-class path-priority profile
- static diagnostic logging

Still to implement from this document:

- descendant-first / queue-priority traversal fix
- dedicated Odoo runtime harness folder
- scenario schema + loader
- disposable/staging execution runner
- Odoo runtime instrumentation
- enterprise-scoped structured trace format/store
- static/runtime correlator
- generic runtime evidence annotations for CallPathIndexer
- runtime-aware path ranking tie-breakers

This document is the contract for those additions.
