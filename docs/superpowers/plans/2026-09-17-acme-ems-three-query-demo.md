# ACME EMS Three-Query Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LeMap respect Pass-1 semantic boundaries in Pass 2 and configure the ACME/Odoo EMS demo so the map can support three cross-functional demo queries about 12k-unit capacity, controller cost increase, and MCU supplier switching.

**Architecture:** Keep CallPathIndexer and Pass 1 unchanged. Clip Pass-2 evidence generically at `coherentThroughSignature`, treat lifecycle setup as context rather than runtime workflow, then extend the ACME Odoo seed with general business data and a deterministic demo assessment that proves the relevant entity/data paths exist. Query-v4 remains generic.

**Tech Stack:** Node.js ESM, Node test runner, Odoo 19 Python addons, PostgreSQL-backed Odoo demo, DeepSeek model calls.

**Spec:** `docs/superpowers/specs/2026-09-17-acme-ems-three-query-demo-design.md`

## Global Constraints

- Do not modify CallPathIndexer grouping/ranking for this work.
- Do not add Odoo-specific semantics above the adapter/canonical structural layer.
- Do not hard-code any of the three demo answers into LeMap or Query-v4.
- Pass 1 continues to receive compact structural evidence without source bodies.
- Pass 2 source bodies remain optional and generic.
- Preserve Moqui compatibility.
- Demo seed data must represent general EMS business facts, not query-specific answer rows.
- Verify before claiming success.

---

### Task 1: Clip Pass-2 concrete-path evidence at Pass-1 coherence boundary

**Files:**
- Modify: `demo_v2/server/explorer/wholeFlowPass2.js`
- Modify/Test: `demo_v2/server/explorer/structuralEvidenceHandoff.test.js`

**Interfaces:**
- Consumes: grouped call path, selected concrete path, `arc.coherentThroughSignature`.
- Produces: `selectedConcretePathForArc(grouped, arc)` or equivalent helper returning one concrete path whose `symbolIds` and `normalizedFlowTokens` are clipped through the boundary when found.
- Pass-2 package continues exposing `selectedConcretePathId`, plus a compact boundary marker for logging/debugging.

- [ ] **Step 1: Add regression cases to the existing structural handoff test**

Add a test fixture whose concrete path tokens/symbols are:

```js
[
  'code:sale.order.action_confirm',
  'code:stock.rule.run',
  'code:mrp.production._post_run_manufacture',
  'code:ir.model.data._xmlid_to_res_id'
]
```

with `coherentThroughSignature: 'code:mrp.production._post_run_manufacture'` and source bodies on all four symbols. Assert that the Pass-2 package includes exactly the first three function-evidence entries and omits the `ir.model.data` body.

Also assert that when the boundary token is absent, the selected concrete path remains unchanged rather than guessing a clip point.

- [ ] **Step 2: Implement generic clipping in `wholeFlowPass2.js`**

After selecting one concrete candidate, find the boundary index in that candidate's `normalizedFlowTokens`. If found at index `i`, return a shallow selected-path view with:

```js
{
  ...selected,
  normalizedFlowTokens: selected.normalizedFlowTokens.slice(0, i + 1),
  symbolIds: selected.symbolIds.slice(0, i + 1),
  coherentBoundaryIndex: i
}
```

If the token is absent, return the selected candidate unchanged.

Use this clipped selected path for `functionEvidenceForGroupedPath` and for any Pass-2 flow sequence representing the concrete selected path.

- [ ] **Step 3: Add clipping metadata to compact logging**

Include the Pass-1 `coherentThroughSignature` and effective selected symbol/body count in the existing `pass2_whole_flow_applied` evidence log. Do not log source-body text.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test server/explorer/structuralEvidenceHandoff.test.js
```

Expected: all tests pass and the boundary-clipping assertion proves technical tail bodies are omitted.

- [ ] **Step 5: Commit**

```bash
git add demo_v2/server/explorer/wholeFlowPass2.js demo_v2/server/explorer/structuralEvidenceHandoff.test.js
git commit -m "fix: clip Pass 2 evidence at semantic boundary"
```

---

### Task 2: Keep lifecycle/setup evidence out of operational workflow stages

**Files:**
- Modify: `demo_v2/server/explorer/structuredWorkflow.js`
- Modify/Test: `demo_v2/server/explorer/structuralEvidenceHandoff.test.js`
- If canonical symbol metadata already exposes lifecycle kind, reuse it. Otherwise minimally expose adapter-produced lifecycle metadata through the generic function-evidence item without Odoo-specific branching in `structuredWorkflow.js`.

**Interfaces:**
- Consumes: optional generic `functionEvidence[].evidenceRole` or equivalent lifecycle/setup marker.
- Produces: Pass-2/structured-workflow prompt instruction that setup/context evidence can explain configuration but must not become a runtime business step.

- [ ] **Step 1: Add a regression fixture for setup context**

Create a function-evidence fixture with one setup function (`post_init_hook`) marked as contextual/setup and two runtime business methods. Assert the generated structured-workflow prompt distinguishes the setup item as context and does not instruct the model to sequence it as a runtime stage.

- [ ] **Step 2: Preserve a generic lifecycle/context marker in function evidence**

Where the topology symbol/reference already knows entrypoint kind or manifest-hook provenance, surface a generic value such as:

```js
evidenceRole: 'setup_context'
```

Do not check for `post_init_hook`, Odoo, or addon names in the semantic layer.

- [ ] **Step 3: Tighten the structured-workflow prompt**

Add an instruction equivalent to:

```text
Function evidence marked setup_context explains configuration/seed state.
Use it as provenance/context only; do not emit it as an operational workflow step unless the admitted business flow itself is an installation/setup workflow.
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test server/explorer/structuralEvidenceHandoff.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add demo_v2/server/explorer/structuredWorkflow.js demo_v2/server/explorer/structuralEvidenceHandoff.test.js
git commit -m "fix: treat setup hooks as workflow context"
```

---

### Task 3: Strengthen ACME supplier-switch evidence without query-specific logic

**Repository:** `thallukrish/acme-ems-odoo`

**Files:**
- Modify: `addons/acme_ems_demo/hooks.py`
- Test/verify with existing Odoo module install/init path.

**Interfaces:**
- Consumes: `acme.manufacturer.part`, `acme.approved.supply`, controller BOM MCU component.
- Produces: at least two plausible MCU sourcing alternatives with materially different commercial/risk characteristics.

- [ ] **Step 1: Extend MCU sourcing data**

Keep the current STMicroelectronics preferred/approved offer. Add a second MCU manufacturer part compatible with the same logical MCU product requirement and an approved or conditional supplier offer with deliberate trade-offs, for example:

```text
preferred source: higher price, 45-day lead, 91% OTD, 99.4% quality
alternate source: lower unit price, 28-day lead, 82% OTD, 98.5% quality, larger MOQ, meaningful expedite premium
```

Use realistic demo values but do not encode an answer or recommendation.

- [ ] **Step 2: Ensure the alternate is connected through normal model relations**

The alternate must connect through `product.template <- acme.manufacturer.part <- acme.approved.supply -> res.partner` exactly like the existing source.

- [ ] **Step 3: Reinstall/update the demo module in the isolated Odoo environment**

Use the repo's existing init/update mechanism so the hook executes against a fresh demo DB rather than production data.

- [ ] **Step 4: Verify rows exist through Odoo shell or SQL**

Check that the MCU logical product has at least two manufacturer parts/offers and that lead time, price, OTD, quality, MOQ, freight/expedite values differ.

- [ ] **Step 5: Commit in ACME repo**

Commit message:

```text
feat: add alternate MCU sourcing scenario
```

---

### Task 4: Add stable historical cost comparison evidence

**Repository:** `thallukrish/acme-ems-odoo`

**Files:**
- Prefer existing model/data if a stable historical comparison is already available after inspection.
- Otherwise create: `addons/acme_ems_core/models/cost_snapshot.py`
- Modify: `addons/acme_ems_core/models/__init__.py`
- Modify: `addons/acme_ems_core/security/ir.model.access.csv`
- Modify: `addons/acme_ems_demo/hooks.py`

**Interfaces:**
- Produces a general business entity such as `acme.product.cost.snapshot` with product, effective date/period, material cost, conversion cost, rework/scrap cost, freight/expedite cost, and total unit cost.
- The entity must support arbitrary products/periods; it must not mention Query 2.

- [ ] **Step 1: Inspect whether existing Odoo valuation/cost history is stable enough for the demo**

If standard records reliably provide two comparable controller cost points in the seeded DB, use them and do not create a custom entity.

- [ ] **Step 2: If needed, add the minimal generic cost-snapshot model**

Use fields similar to:

```python
product_id = fields.Many2one('product.product', required=True, index=True)
period_date = fields.Date(required=True, index=True)
material_unit_cost = fields.Monetary(...)
conversion_unit_cost = fields.Monetary(...)
rework_scrap_unit_cost = fields.Monetary(...)
freight_expedite_unit_cost = fields.Monetary(...)
total_unit_cost = fields.Monetary(...)
currency_id = fields.Many2one('res.currency', required=True, ...)
```

Keep arithmetic transparent in seed data; do not pre-store a textual explanation.

- [ ] **Step 3: Seed two controller periods**

Seed a baseline period and a current period whose components make the increase traceable to genuine data such as MCU/material price, expedite/freight, rework/scrap and capacity/overtime exposure.

- [ ] **Step 4: Verify comparison data**

Query the two periods and verify total unit cost equals the numeric components supplied for each period.

- [ ] **Step 5: Commit in ACME repo**

Commit message:

```text
feat: seed controller cost history for analysis
```

---

### Task 5: Prove the 12k capacity/material/quality evidence path

**Repositories:** DataSong + ACME EMS Odoo

**Files:**
- Create in DataSong: `demo_v2/scripts/acme-three-query-assessment.js`
- Modify: `demo_v2/package.json`
- Reuse ACME seeded `mrp.workcenter`, `mrp.routing.workcenter`, BOM, supply, rework and test records.

**Interfaces:**
- Produces a deterministic report, not an LLM answer.
- Report must identify the structural/data evidence required for each query and flag missing evidence.

- [ ] **Step 1: Add an assessment script**

The script should reuse the ACME/Odoo adapter/topology construction already used by `assess:acme` and report whether the static map includes schema/entity relationships needed for:

```text
mrp.production -> mrp.bom / operations -> mrp.workcenter
mrp.bom -> component product -> manufacturer part -> approved supply
mrp.production -> rework/test/trace entities
cost snapshot/history -> product
```

- [ ] **Step 2: Include deterministic expected capacity math as fixture validation**

Validate the seeded work-center numbers for a 22-working-day month:

```text
SMT: 590 * 22 = 12,980
Assembly: 525 * 22 = 11,550
AOI: 500 * 22 = 11,000
Functional Test: 342 * 22 = 7,524
```

This is a demo-data consistency check, not Query-v4 answer logic.

- [ ] **Step 3: Add npm script**

Expose:

```json
"assess:acme:queries": "node scripts/acme-three-query-assessment.js"
```

- [ ] **Step 4: Run assessment**

Run:

```powershell
npm run assess:acme:queries
```

Expected: report confirms all required evidence domains and numeric fixture consistency. If an entity relationship is missing from the static adapter, stop and add only the generic adapter/schema support needed to expose the real Odoo relationship.

- [ ] **Step 5: Commit**

```bash
git add demo_v2/scripts/acme-three-query-assessment.js demo_v2/package.json
git commit -m "test: assess ACME three-query evidence"
```

---

### Task 6: Fresh learn and inspect semantic-map coverage

**Files:**
- No code change unless the run proves a generic learning gap.

**Interfaces:**
- Consumes fresh ACME repo commit and updated DataSong branch.
- Produces a persisted LeMap whose workflows/entities can seed Query-v4 for the three questions.

- [ ] **Step 1: Start LeMap with model configured**

```powershell
$env:DEEPSEEK_API_KEY="..."
$env:SINGLE_STEP="0"
npm start
```

- [ ] **Step 2: Run a fresh Learn for the ACME EMS enterprise**

Do not resume the previous map when validating changed topology/data semantics.

- [ ] **Step 3: Inspect Pass-1 and Pass-2 logs**

Confirm:

```text
Pass 1 coherent boundary
== effective Pass 2 body/flow boundary
```

and confirm setup context is not emitted as an operational stage.

- [ ] **Step 4: Inspect persistent map coverage**

Verify that the map exposes manufacturing order/BOM/work-center, component/supply, quality/rework, and cost-history entities/relationships required by the spec.

- [ ] **Step 5: Record any generic gap before changing code**

If Query-v4 lacks a required relationship that physically exists in Odoo, identify whether it is an adapter/schema extraction gap or a map/query traversal gap. Do not add query-specific shortcuts.

---

### Task 7: Run the three demo queries through Query-v4

**Files:**
- Modify Query-v4 only if a generic evidence-planning/traversal defect is demonstrated by the run.

**Interfaces:**
- Questions:
  1. `Why can't we produce 12,000 Industrial Controller PCB Assemblies per month?`
  2. `Why did the Industrial Controller PCB Assembly unit cost increase?`
  3. `What changes if we switch the MCU source?`

- [ ] **Step 1: Run Query 1**

Expected evidence plan spans production/BOM operations/work centers, component supply, and quality/rework. The response should derive constraints from data rather than from seeded prose.

- [ ] **Step 2: Run Query 2**

Expected evidence plan spans controller cost periods plus material/supply and rework/scrap/capacity contributors.

- [ ] **Step 3: Run Query 3**

Expected evidence plan spans MCU manufacturer parts and approved supply offers, comparing price, lead time, OTD, quality, MOQ and freight/expedite characteristics.

- [ ] **Step 4: Diagnose failures by evidence frontier**

For each unresolved query dimension, record the missing relationship/entity/data and fix only the generic layer responsible.

- [ ] **Step 5: Final verification**

Run focused Node tests, `npm run assess:acme`, `npm run assess:acme:pass2`, `npm run assess:acme:queries`, and a fresh three-query UI/API demo. Claim completion only after these outputs are observed.