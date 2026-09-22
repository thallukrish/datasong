# Query-driven targeted learning: Query V4 ↔ adapter evidence ↔ semantic map

## Status and relationship to existing docs

**Agreed target design; not a claim of current end-to-end implementation.** This document adds query-initiated targeted learning to the architecture in [LEMAP_ARCHITECTURE.md](LEMAP_ARCHITECTURE.md) and reuses Odoo evidence collection described in [ODOO_RUNTIME_PROCESSING.md](ODOO_RUNTIME_PROCESSING.md). Existing UI Learn remains a diagnostic/explicit entry point during migration; the intended user entry point is a conversational query. The current Query V4 and static/runtime learning components exist, but the query-to-learning orchestration, step-level learning handoff, and automatic targeted retry described below require implementation. Live enterprise data execution is outside this phase.

## 1. Governing flow

1. A user asks a question in a persistent conversation; a follow-up can refine the same investigation.
2. Query V4 derives an ordered **semantic answer plan** independent of the current map. It explores and ranks relevant *existing* workflows and entities first.
3. Candidate exploration is bounded by relevance to unresolved plan steps, a configurable cutoff, and a search budget. Retain eligible structural connector paths even when they have low direct-answer relevance. A low-scoring individual workflow does **not** itself trigger learning. Distinguish rejected from unscored/dormant candidates.
4. Query combines evidence across useful workflows, inspects fields and PK/FK relationships, checks requested grain and structural connectivity, and assesses **each plan step** against the combined evidenced map. If complete, continue the existing answer-generation path. If incomplete after relevant exploration, produce a compact, structured learning request identifying precisely what is missing.
5. The selected adapter (Odoo first; other frameworks later) resolves the request into the smallest relevant *installed* model/module, XML-view/action, inheritance, method, schema and fixture context. The model proposes targeted scenario/fixture JSON from grounded adapter evidence; the adapter validates actual model names, fields, methods, UI actions, record references, permissions and inputs. Do not invent operations based on generic public documentation. Reuse suitable approved test records; create synthetic data only where required and only in an isolated/authorized instance.
6. Invoke the adapter's runtime evidence collector. Correlate observed runtime paths with static executable and inherited framework topology **and** with entity/data relationships. A valid structural connection may be an executed call, a schema PK→FK link or an evidenced record association; do not demand a fictitious Python call between independent business activities.
7. Assess unresolved structural requirements *against the same plan steps*. Request additional narrowly scoped scenarios only when they could establish a specific missing link. Avoid repeated scenarios if evidence does not improve.
8. Feed the evidenced, question-relevant structural slice to the existing CallPathIndexer, Pass 1 and Pass 2; reconcile/persist new semantic map knowledge without losing existing workflows. Preserve evidence provenance.
9. Resume Query V4 using the **same question and ordered plan**, refreshed relevant map and conversation context. Stop if answerable, if no meaningful evidence was added, or if a bounded learning budget is exhausted. On failure report the precise remaining gaps, not a fabricated answer.

Query and learning are two parts of *one question-driven task*. Do not exhaustively learn the entire repository merely because a question was asked. If existing map evidence suffices, do not invoke learning.

## 2. Current code anchors and the minimal change

- `demo_v2/server/query_v4/queryApi.js` implements the current `/api/query-map` → V4 route. Today it rejects an empty semantic graph or missing entity directory with HTTP 409; the new orchestrator must treat those states as a targeted-learning entry point.
- `demo_v2/server/query_v4/scorer.js:deriveDimensions()` currently passes the model only `{question}` with a system instruction to produce ordered `steps`, `requires`, `relations`, `derived`, `dimensions` and `grain`. Keep this business plan independent of Odoo implementation and give its steps stable IDs.
- `scoreNextStates()` already receives the ordered plan embedded in scoring intent, unresolved dimensions, accumulated path and compact candidate summaries. It currently outputs dimension score vectors plus explicitly rejected/omitted candidates; extend the compact scoring contract with **step-level contributions and evidence references** for relevant unresolved steps. Preserve dimensional ranking, existing frontier behavior and the distinction between explicit rejection and unscored/dormant candidates. Reject subthreshold candidates only after accounting for necessary evidenced connectors. Model scores indicate exploration usefulness, *not proof* of a completed step.
- `demo_v2/server/query_v4/queryEngine.js` already tracks accepted entities, dimension coverage and deterministic connectivity; `complete = !coverage.missing.length && connected`. It currently invokes the final-answer model even when incomplete. Insert the compact post-exploration plan-step assessment and `needs_learning` handoff **before** that final answer call when existing evidence remains insufficient.
- The learning orchestrator should call existing adapter/runtime and indexing/Pass 1/2 services with a targeted scope, not reimplement them. These targeted entry points and the orchestrator are proposed functionality, not verified existing APIs.

## 3. Query assessment before learning (avoid ping-pong)

The frontier first explores retained workflows/entities and useful connectors, reevaluating dormant candidates as needed within a bounded search. Do not hand off because a first candidate looks incomplete. Combine accepted evidence at the plan's observation grain. For every step classify `supported | partial | unsupported | blocked` with: supporting workflow/entity IDs, verified field and relationship refs, missing attributes/joins/operation evidence, and dependencies on earlier steps. The final assessment consumes a **compact accepted-evidence subgraph + plan + deterministic coverage/connectivity result**, not the entire graph or search log. The model identifies semantic insufficiency; deterministic graph facts and provenance constrain which claims can be called verified.

A relevant workflow can be explored even if it supports only one part of a plan; the answer can depend on several workflows connected through manufacturing order/product or another PK/FK bridge. A plan step is *supported* only if all required semantic and structural relationships hold at the requested grain. Do not confuse relevance confidence with answer sufficiency.

### Illustrative Query 1 assessment (not an actual model/run result)

Question: “Why is capacity below 12,000 units per month for these orders?”

| ID | Ordered business step | Combined map evidence | Outcome |
|---|---|---|---|
| S1 | Identify orders, products, demand and period | Order/manufacturing-order workflow | Supported |
| S2 | Link relevant products/BOMs to operations, work orders and centres | Production-routing workflow + evidenced joins | Supported |
| S3 | Establish available capacity for *those orders in that period* from rates, queue and downtime | Centre entities known but period-specific availability not evidenced | Partial |
| S4 | Associate shortages of required components with selected orders | Inventory evidence exists but order-specific association unproven | Partial |
| S5 | Identify actual shortfall constraints | Depends on S3 and S4 | Blocked |

The query should first exhaust *relevant* unexplored alternatives that could supply S3/S4 or connect them. Only then hand off the residual gaps. The example does not assert that ACME currently lacks these fields or links; a real Query 1 run must establish its actual gaps.

## 4. Compact query → learning contract

The query supplies business semantics and observed structural gaps; adapter resolution supplies technical execution facts. **Do not ship complete workflow bodies, the whole semantic graph, raw trace or all Odoo module metadata into a single model prompt.** Preserve IDs and fetch small evidence/source slices on demand.

Illustrative contract (field names subject to implementation):

```json
{
  "requestId": "q1-gap-1",
  "question": "Why is capacity below 12000 units for these orders?",
  "conversationRef": "conversation-reference",
  "planRef": "ordered-plan-reference",
  "grain": "selected manufacturing orders, product, period",
  "supported": [{"stepId":"S1","workflowRefs":["workflow:mo"]},{"stepId":"S2","workflowRefs":["workflow:routing"]}],
  "targets": [{
    "stepId": "S3",
    "objective": "Establish actual available work-centre capacity for selected orders and period",
    "knownEntityRefs": ["mrp.production","mrp.workorder","mrp.workcenter"],
    "knownRelationshipRefs": ["mrp.production.workorder_ids","mrp.workorder.workcenter_id"],
    "requiredEvidence": ["actual rate","queue","downtime","applicable time period"],
    "missing": ["verified effective-capacity inputs at requested grain"],
    "operationHints": [{"kind":"read","businessAction":"inspect work-order assignment and centre availability"}],
    "acceptance": "evidenced fields and joins relate capacity inputs to the selected order and period"
  }],
  "previousAttemptRefs": [],
  "evidenceRefs": ["small-source-reference"]
}
```

`operationHints` are **semantic** suggestions, not validated Odoo RPC calls, XML IDs, methods or forced CRUD sequences. Distinguish data requirements (fields and PK/FK associations) from executable business-action requirements (such as confirming an MO). The Odoo adapter resolves real modules, models, XML views/actions and inherited Python implementations from the installed application, supplies only relevant grounded excerpts, validates proposed fixture JSON against its runner schema and environment, and chooses whether UI simulation, a supported ORM call or a read-only data observation is appropriate. Runtime observations and static relationships must retain provenance. Do not create synthetic activity to imply that testing calls rework when they are independent operations joined by `production_id`.

## 5. Example of targeted expansion and retry

For Query 1, suppose S3 is inadequately evidenced after bounded exploration. The learning model receives S3's missing requirement, *referenced* existing production/work-centre evidence and focused Odoo model/view/action context. It proposes a minimal validated capacity scenario. The Odoo runtime collector observes the scenario; static/inheritance correlation and schema relations establish the relevant structural slice; targeted indexing, Pass 1/2 and persistence enrich the map. Query V4 retries the same plan and checks S3's acceptance condition and overall coverage/connectivity. If it remains unsupported with no new evidence, stop and report S3 rather than regenerate similar fixtures.

Conversation follow-up: “Did you consider functional-test failures and rework?” Preserve order/period context and earlier plan results. Extend the plan with S6 (associate test results with orders), S7 (associate rework with orders and establish a supported capacity effect), S8 (reassess shortfall). Explore the **existing** map first. In ACME, `acme.test.result.production_id → mrp.production` and `acme.rework.event.production_id → mrp.production` are established schema relationships, but they alone do not quantify lost capacity. Learn only evidence actually missing for S6–S8; never demand an invented direct call test → rework.

## 6. Bounded execution and visible UI

- Configurable frontier step-contribution cutoff, maximum scored/explored candidates, query search budget, scenario attempts and learning cycles. Log threshold rejections, explicitly rejected vs omitted/dormant candidates, uncovered plan steps and gap resolution. Do not hard-code the example scores or presume they are calibrated probabilities.
- Persist a compact ledger per query: ordered plan/IDs, relevant workflow refs, step support, accepted data/evidence refs, missing structural connections, previous learning attempts and map delta. Carry it across retries and conversational follow-ups. Full source/trace stays backend-side, retrieved selectively.
- One conversational Query UI initiates existing-map search and targeted learning when needed. A **separate visible evidence workspace/page** exposes grounded scenario proposals, authorization/fixture changes, collector progress, observed traces, structural-gap assessment, targeted indexing, Pass 1/2 and persisted map deltas. Do not claim automatic runtime execution or live enterprise SQL is implemented until it is tested.
- Production data-changing actions require appropriate authorization and should run in a disposable/approved staging instance; fixture generation must not mutate an unapproved customer system.

## 7. Acceptance criteria for this implementation phase

1. A question answerable from the existing map invokes no learning.
2. A partial map causes V4 to explore and combine relevant workflows/connectors before issuing a compact **step-specific** handoff.
3. A missing/empty map triggers targeted learning rather than HTTP 409.
4. The Odoo adapter grounds and validates any generated scenario against installed modules/models/XML/actions and collects relevant runtime evidence.
5. Static/runtime **and PK/FK/data** relationships establish the needed slice; missing executable calls do not block a valid data-linked answer.
6. Only relevant call paths and evidence enter targeted indexing/Pass 1/2, and map updates preserve earlier learning.
7. The original plan is retried; unchanged evidence or exhausted budgets terminates with explicit gaps rather than looping.
8. The evidence workspace and logs reveal every stage and the reason for learning. Live data execution is a later milestone.
