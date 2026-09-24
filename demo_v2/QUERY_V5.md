# Query V5: Causal investigation and evidence graphs

Status: design proposal, September 24, 2026. V4 remains intact as the comparison baseline. V5 does **not** execute SQL in this phase.

## Goal and query modes

A debugging question asks for an explanation of an observation: for example, “Given that the plant can produce 12,000 units per month, why are these orders resulting in less production?” V5 proposes one or more candidate **causal chains**. Those chains may split, converge, and share events, producing a causal graph. A proposed causal edge is a hypothesis, **not** a proven cause.

A retrieval question instead receives an ordered retrieval plan oriented around relevant entities, relationships, grain, filters, measures and eventually data access. It need not construct a causal graph. A mixed query can attach retrieval subtasks to nodes of a causal investigation. Query classification can be reviewed or revised by the user.

The immediate V5 objective is to construct and persist a well-supported causal graph and a derived entity-relationship graph, identify precisely unresolved areas and support iterative learning. Table querying and numerical root-cause attribution are separate later phases.

## Graph layers and provenance

1. **Causal graph (the query's primary artifact).** Nodes are business events/states/observations; directed edges express candidate dependencies with explicit scope, affected orders, period and units. Each graph includes the observation to be explained, originating hypotheses, branch/convergence structure and evidence required per edge. Share common nodes rather than duplicating a causal event across chains. An initial path can be replaced if new evidence points elsewhere.
2. **Workflow evidence graph.** Match each causal edge or chain segment to the most closely associated learned workflows and their specific stages, transitions, triggers and outcomes. A workflow may support multiple chains and a causal edge may require more than one workflow. Distinguish a workflow's code-path evidence from evidence that a particular event occurred for the affected orders.
3. **Derived entity graph.** Only after choosing the relevant workflow stages, identify the entities and fields representing each stage. Follow explicit workflow/entity links and schema PK/FK or ORM relationships; record join direction, keys, cardinality, grain and provenance. A schema relationship without confirmed join keys remains provisional, not an executable join. Entity connectivity does not itself demonstrate causation. Avoid substituting a merely similar table for an evidenced workflow stage.

Each causal edge records candidate workflow IDs and stage IDs, entity/field IDs, provenance, confidence assessment, contradictions, missing evidence, explored alternatives, version and status. Keep separate confidence for causal alignment, workflow support, stage continuity and entity linkage, rather than hiding a missing transition behind one aggregate score.

## Exploration loop

1. Create candidate causal graph from the user's question and enterprise context. Preserve the original observation and its success criteria. Present the hypotheses for user review before exploration.
2. Maintain a frontier of unresolved causal **edges/branches**, not a flat collection of unrelated entity matches. Rank candidate known workflows by semantic fit to the edge, relevance to its predecessor/successor stages and continuity of the overall causal chain. Reuse a known workflow when it supports several branches.
3. For each plausible match, trace actual workflow stages and transitions. Accept, reject or retain provisional support with evidence and per-edge scores. If a branch is contradicted, revisit its path rather than forcing the original chain.
4. Derive stage-specific entities and record-level joins from the accepted workflow evidence. Prefer verifiable PK/FK and ORM mappings, with explicit treatment of many-to-many, temporal conditions and grain. Track missing or unresolved joins separately from missing workflows.
5. Where confidence is inadequate, issue a **specific Learn request**: a named missing workflow transition, an entity for a particular stage, or a relationship/key connecting specified entities. Learn explores that bounded construct, returns evidence or a documented exhaustion result, and updates the semantic map. Query re-evaluates only impacted branches, then may accept a new route, pursue an alternative or revise the causal hypothesis.
6. The saved result is one or more causal graphs annotated with matched workflow evidence and their derived entity graphs; supported, provisional, contradicted and unresolved sections remain visible.

## Termination and protection against Query–Learn loops

**Success is defined by the original question's causal-graph completion contract, not by exhausting every possible branch.** Once all required original causal hypotheses/paths have been fulfilled to the accepted evidence threshold, their workflow transitions are coherent, and necessary entity links have been established, Query stops. Do not trigger further Learn merely because more possible explanations or entities exist. The user may explicitly request broader exploration later.

A graph is *structurally fulfilled* when the original observation is connected through at least one coherent, evidence-backed path for every required hypothesis or investigation obligation, with the required workflow stages and entity links resolved. A coherent schema/workflow path establishes **where to investigate**, not that the named orders actually experienced that cause. Record-level causal confirmation requires later data retrieval and must not be claimed in this phase.

Guard against cycling with:
- A stable fingerprint per (query, causal edge/branch, missing construct, map version, learning strategy); deduplicate identical Learn requests and memoize both successful and exhausted attempts.
- An evidence-progress test after every Learn result: a new supported edge, stronger evidence, a resolved transition/join or an explicit graph revision counts as progress. A score oscillation alone does not.
- A finite configurable budget for attempts per missing construct, alternate branches, graph revisions and total query work. These are **exploration budgets**, not arbitrary model-response token truncations. Save the reason when the budget is exhausted.
- No immediate retry of an exhausted branch against unchanged evidence; reconsider it only when the map version, user guidance or relevant new evidence changes.
- Cycle detection on repeated graph/frontier fingerprints, with a clear stop reason. A learned alternative can replace an initial branch if it improves evidentiary support and continuity without creating an endless hypothesis-rewriting loop.

Stop with one of: `completed` (structural fulfillment contract met); `needs_user_input` (specific unresolved constructs with concrete questions); `exhausted` (no novel supported paths); `budget_reached` (partial result retained); or `paused` (resumable). If a hypothesis is contradicted or cannot be fulfilled, show the completed and pending portions and offer a graph revision for review rather than reporting artificial success. Users can change the hypothesis, scope or supply new evidence and retry only affected branches.

## Reusable causal fragments

Persist completed workflow-backed **causal-chain fragments** independently of a single query. A fragment contains canonical business concepts and causal direction, workflow and stage references, transition evidence, relevant entity-link template, provenance, confidence, scope/context and source map version. Store reusable subgraphs, not merely whole answers.

For a future query, match all or part of its candidate causal graph against existing fragments; align synonyms, scope, entity grain and causal direction. Reuse verified stages and links, but explicitly revalidate assumptions affected by changed enterprise version, order/product context, time period or source code. Reuse a structural workflow template without reusing a historical *actual* causal finding as proof for new orders. Merge overlapping fragments through shared event nodes; keep incompatible alternatives separate with their supporting evidence.

A possible future local model could learn query-to-causal-fragment or chain-to-workflow matching from accumulated validated investigations (a sequence-to-sequence model is one candidate). Do not make model training a V5 prerequisite. Start with persistence, deterministic matching and current model-assisted ranking; collect reviewed examples and explicit negative/contradictory matches before choosing a training architecture.

## Persistence and UI

Persist each investigation's question, mode, enterprise/map version, original causal hypotheses and fulfillment contract, causal/workflow/entity graphs and revisions, per-edge evidence and scores, frontier, learning requests and outcomes, rejected branches, visited fingerprints, budgets, user instructions, completion state and timestamps. Checkpoint after each meaningful change. Resume from the exact saved frontier; rerun may reuse verified evidence and selectively revisit unresolved or invalidated branches.

Show saved queries in a left panel with graph-construction progress, current branch, status, pause/resume and rerun controls, as in the Learn UI. Main view shows causal branches and their workflow-stage evidence; selecting a stage reveals the derived entity relationships, join support and provenance. Display completed, tentative, contradicted and missing portions distinctly and expose the precise reason for user intervention. Progress measures required graph obligations fulfilled, rather than number of model calls or visited entities.

## ACME acceptance scenario

Given the stated 12,000 units/month plant capability and specified orders, establish the scoped order/period and *planned versus actual* production obligation. Investigate as candidate, not predetermined, causal branches: component demand → availability/reservation → manufacturing readiness; work-centre scheduling/queues/downtime → execution; inspection/test → hold/rework/scrap → usable output; and links between those branches and MO completion. Trace actual corresponding workflows first; then derive the order/MO/workorder/workcentre, raw moves/procurement, and production/test/rework entity paths. Show what is structurally supported, which joins or workflow transitions need Learn, and which hypotheses cannot be completed. Do not confuse the plant's stated capacity with the affected orders' plan, or claim a measured cause before actual order-level data is queried.

## Implementation boundary

Build V5 as a separate query mode/module, retaining V4's confidence, frontier exploration, workflow coherence and cross-entity relationship machinery where applicable, but replacing V4's flat dimension-coverage completion logic with graph-edge evidence and the explicit fulfillment contract. Implement in stages: persisted causal graph and review → workflow match/stage evidence → derived entity graph → bounded Learn interaction and graph revision → left-panel resume/rerun. No SQL execution in this phase.
