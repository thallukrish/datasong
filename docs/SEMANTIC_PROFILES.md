# LeMap semantic profiles

## Why this exists

LeMap's deterministic repository layer and its semantic interpretation layer solve different problems.

The deterministic layer builds executable structure:

```text
repository
→ language/framework adapters
→ executable nodes and edges
→ call paths
→ branch/cycle compression
→ grouped unique flow families
```

That layer is domain-neutral. JavaScript and Python source are parsed before semantic interpretation. Framework adapters such as Moqui/Odoo may add deterministic framework execution evidence, but call-path indexing itself does not decide whether a path is business-important.

Historically the semantic layer was enterprise-specific. It admitted recognizable business workflows, ranked them by business importance, and interpreted each admitted compressed flow as a business process. This is still the default `enterprise` profile.

## Profiles

### enterprise

The existing behavior.

Grouped call paths are semantically classified as business, technical, or uncertain. Business flows are admitted as Pass-1 arcs. Business-priority scouting controls which additional flows are explored. The whole compressed flow is then interpreted with business workflow, entity, persistence, relationship, and outcome semantics.

### code

A domain-neutral profile intended initially for SWE-Explore experiments.

Every grouped executable flow is eligible for semantic interpretation. A technical flow is not discarded for lacking a business actor or outcome.

The flow is interpreted in terms of:

- purpose
- ordered code behavior
- control-flow branches
- calls and transformations
- mutations, return values and IO
- in-memory and persistent data structures
- relationships between steps and data
- observable code-level effects
- source provenance

The initial call-path model call only gives a compact behavior name/purpose to seed the existing flow scheduler. It is not a business-vs-technical admission pass.

Subsequent unseen path families discovered by the scout are admitted directly in code mode rather than business-ranked.

## Pass 1 / Pass 2 clarification

Older LeMap Pass 2 used per-arc DFS state. Current call-path learning no longer navigates functions one node at a time.

`pass1State.js` retains `pass2DfsByArc` only for compatibility with persisted state.

Current flow learning is:

```text
grouped compressed call-path family
→ admitted semantic flow
→ whole-flow semantic interpretation
→ optional separate interpretation of materially ambiguous supplied branches
→ semantic map
```

For enterprise semantics, admission is meaningful because LeMap deliberately filters for business workflows.

For generic code semantics, there is no equivalent business filter. Conceptually Pass 1 and Pass 2 collapse into one semantic-flow layer: every discovered flow is admitted and the whole-flow interpreter explains it.

The existing scheduler/arc state is retained as execution infrastructure so persistence, resume, UI, coverage, branch follow-up, and map materialization continue to work.

## Generic Pass 2 source evidence

The call-path index is the traversal authority, but a generic software flow cannot be understood reliably from function names alone.

For the `code` profile, LeMap therefore enriches each grouped flow family with bounded source evidence for every locally parsed symbol participating in the representative path and its grouped branch/alternate variants.

The evidence package contains:

```text
symbol id
function/method name
symbol kind
signature (including parsed parameter text)
source path
start/end lines
bounded function body
local references and relation types
```

The current parser already stores this information for JavaScript and Python symbols. Generic Pass 2 reuses that parser output; it does not perform another repository search or introduce another parser.

The resulting interpretation path is:

```text
deterministic grouped call path
→ collect source evidence for exactly the functions in that flow family
→ whole-flow semantic interpretation
→ optional semantic follow-up for materially ambiguous indexed branches
→ semantic map
```

The indexed flow order remains authoritative. Function bodies enrich the meaning of the known path; the model must not use them to invent or wander into a different traversal.

This is deliberately different from the older DFS-style Pass 2. The model does not decide which function to visit next. LeMap already knows the executable path and deterministically supplies the bounded vertical slice.

## SWE-Explore usage

Create an enterprise/profile in the LeMap UI.

Choose:

```text
Generic code semantics / SWE-Explore
```

Point the Git repository URL at a SWE-Explore repository whose source language is supported by the current LeMap parser/call-graph path. JavaScript and Python are the initial intended targets.

Press Learn.

Expected pipeline:

```text
SWE-Explore repository
→ JS/Python parsing
→ deterministic call graph
→ call-path indexing
→ branch/cycle merging
→ grouped flow families
→ collect bounded function signatures, parameters, bodies and references for the indexed flow
→ code-flow semantic interpretation
→ flow/data-structure semantic map
```

No SWE issue/query is required during learning. This keeps the first experiment clean: build the map first, then measure whether an issue can retrieve/localize the relevant learned flow better than raw repository search.

## Architectural rule

Semantic policy must not leak backward into call-path indexing.

The indexer should answer:

> What executable flow structures exist?

A semantic profile should answer:

> How should those structures be interpreted and which of them should be admitted?

Enterprise semantics may filter by business meaning.

Code semantics admits all executable flow families and interprets them neutrally.

Future profiles can reuse the same boundary, for example framework-specific Java semantics, Python package semantics, or other domain policies, without forking the deterministic call-path engine.


## Experiment logging

Learning interactions are written as JSON Lines under:

```text
demo_v2/data/runs/*.jsonl
```

For reproducible generic-code/SWE-Explore experiments the log records:

- repository URL and exact commit
- model
- semantic profile
- each model prompt
- each raw model response
- parsed semantic response
- retries and parse failures
- token usage and cumulative usage
- semantic state before and after applied calls
- exact compressed executable-flow/source-evidence package supplied to generic Pass 2

Generic Pass 2 emits a `code_flow_semantic_input` event immediately before the corresponding model attempt. Its `executableFlow.codeEvidence` contains the bounded signatures, parameters as represented in signatures, function bodies, source locations and references used for semantic interpretation.

This log is the primary artifact for diagnosing whether a SWE-Explore miss came from call-path construction, missing source evidence, semantic interpretation, or later issue-to-flow retrieval.


## Python deterministic call graph

Generic code semantics now has a Python-specific deterministic language adapter under:

```text
demo_v2/server/languages/python/
  analyzer.py
  adapter.js
```

The Python analyzer uses the standard-library `ast` parser. Python semantics stay in this adapter; CallPathIndexer and semantic Pass 2 remain language-neutral.

Current deterministic Python support includes:

- `def` and `async def`
- classes and methods
- `import module`
- `from module import symbol`
- direct local function calls
- `self.method()` and `cls.method()`
- local/imported class construction
- simple assignment type inference such as `worker = Worker()`
- calls such as `worker.run()`
- local inheritance and inherited-method lookup
- explicit `if __name__ == "__main__"` entry-point detection
- recursion/cycles through the existing call-path machinery

Resolved calls carry an exact `targetSymbolId`. The generic topology honors this target before any legacy name-based resolution. This prevents an AST-resolved Python call from degrading into repository-wide same-name guessing.

The normalized boundary remains:

```text
Python source
  -> Python AST adapter
  -> normalized symbols + exact call edges
  -> generic executable topology
  -> CallPathIndexerV3
  -> grouped flow families
  -> generic whole-flow semantic Pass 2
  -> persistent semantic map
```

Dynamic Python is intentionally outside the first implementation. Reflection, runtime monkey-patching, dynamic imports, arbitrary `getattr`, runtime-generated methods and dependency-injection behavior that cannot be proven statically remain unresolved boundaries rather than guessed edges.

The learning run log records `pythonAst` statistics at `run_start`, including symbol count, resolved call count and unresolved call count. These statistics make it possible to distinguish a language-analysis failure from a later call-path, semantic-interpretation or retrieval failure.


## Deterministic entity and workflow indexes for code

The code profile extends deterministic indexing beyond symbols and calls with two additional, query-independent graph views:

```text
function graph
  A -> calls -> B

entity graph
  A -> create -> X
  B -> read   -> X
  C -> update -> X

workflow graph
  W -> contains -> A
  W -> contains -> B
  W -> contains -> C
```

These views do not replace the existing Python AST symbol/call index and do not change query navigation policy. They add reusable structural evidence that can strengthen semantic hierarchy construction, candidate scoring and causal confidence.

### Entity discovery

While the Python AST adapter indexes each function body, it also records observations about non-trivial values and data structures, including:

- constructed objects
- annotated complex parameters
- mappings/dictionaries and observed keys
- lists, sets and sequence-like structures
- array-like values inferred from indexing or members such as `shape`, `dtype`, `ndim` or `size`
- object members and method usage
- assignments and mutations
- values passed to calls
- returned values
- constructor/import/origin evidence

Primitive temporaries and imported module aliases are not promoted merely because they appear in a function.

Observations are reconciled across functions into deterministic entity candidates. Stronger identity evidence includes a common annotation/type, constructor/origin, stable mapping keys and stable member/method shape. Variable names are only supporting evidence.

The objective is not to prove runtime object identity. It is to identify recurring structural entities that are useful for repository understanding.

An entity seen in many distinct functions and call-flow edges is treated as increasingly core to the codebase. An entity seen only in one or a few functions remains local/helper evidence unless later observations connect it more broadly.

### Entity relations

Entity relations are deliberately direct. There is no separate action field.

Typical relations are:

```text
create
read
update
delete
```

Additional relations should be introduced only when they add concrete causal value.

Examples:

```text
function A -> create -> entity X
function B -> read   -> entity X
function C -> update -> entity X
```

The same entity may have multiple observations in one function or region. Each observation retains source provenance.

### Region and source-line anchoring

Entity transformations must remain localizable to source.

Every entity observation records:

```text
functionId
regionId
startLine
endLine
entityId
relationship
```

If the observation lies inside one or more AST regions, it is attached to the smallest/innermost containing region using the region's existing `startLine` and `endLine`.

If no region contains the observation, `regionId` is empty and the function is the containing structural unit.

The exact line range is retained even when a region id is available. The region provides control-flow context; the line range provides exact evidence retrieval.

This permits Query/HL to distinguish:

```text
function F updates entity X somewhere
```

from the stronger statement:

```text
region R inside function F updates entity X at lines 120-122
```

### Workflow discovery

A workflow is a reusable vertical slice over the existing deterministic call graph. Workflow discovery does not invent a second execution topology.

A workflow groups a coherent ordered set of existing function nodes:

```text
workflow W
  -> contains -> function A
  -> contains -> function B
  -> contains -> function C
```

The function-to-function `calls` edges remain authoritative for execution order.

Entity evidence enriches the same slice:

```text
A -> create -> X
B -> read   -> X
C -> update -> X
```

so the workflow can be interpreted as an execution path that acts on specific entities without encoding those transformations into the call graph itself.

The initial workflow builder should therefore consume:

```text
existing resolved call paths
+
entity observations on the functions/regions in those paths
```

and materialize workflow nodes that reference the participating functions.

### Canonical in-memory graph shape

Functions, regions, entities and workflows use one flat node array.

Each node has:

```text
id
type
details
links[]
```

Each link contains only:

```text
id
relationship
```

For example:

```json
{
  "id": "symbol:pkg/a.py#A@10",
  "type": "function",
  "details": {
    "name": "A",
    "sourcePath": "pkg/a.py",
    "startLine": 10,
    "endLine": 25
  },
  "links": [
    { "id": "symbol:pkg/b.py#B@30", "relationship": "calls" },
    { "id": "entity:abc123", "relationship": "create" }
  ]
}
```

and:

```json
{
  "id": "workflow:w1",
  "type": "workflow",
  "details": {
    "name": "w1"
  },
  "links": [
    { "id": "symbol:pkg/a.py#A@10", "relationship": "contains" },
    { "id": "symbol:pkg/b.py#B@30", "relationship": "contains" }
  ]
}
```

Source provenance for an entity transformation belongs in the entity observation details/CSV row, not as semantic payload on the graph link.

### Structural CSV persistence

The existing function structural CSV remains authoritative for symbols, regions and call topology and continues to be stored under the repository/commit-specific structural cache, for example:

```text
demo_v2/data/repo-cache/code-structural-csv/<repo-key>/<commit>/
```

Entity and workflow indexes should be persisted alongside the existing function graph so all three views share the same repository revision and symbol ids.

The recommended CSVs are:

```text
entity-nodes.csv
entity-links.csv
workflow-nodes.csv
workflow-links.csv
```

They are PAL-style flattened views of the canonical node graph.

#### entity-nodes.csv

Columns:

```text
id
type
name
kind
aliases
annotations
origins
members
methods
keys
functionCount
flowEdgeCount
coreScore
```

Notes:

- `id` is the canonical entity node id.
- `type` is normally `entity`.
- `kind` is a structural kind such as object, mapping, sequence, set or array-like.
- list-valued columns use the repository's standard CSV list encoding.
- `functionCount` is the number of distinct functions that observe the entity.
- `flowEdgeCount` is the number of resolved call edges between functions that observe the entity.
- `coreScore` is a structural ranking signal, initially based on breadth across functions/flows.

#### entity-links.csv

Each row is one source-backed function/region-to-entity relation.

Columns:

```text
sourceId
sourceType
relationship
targetId
targetType
functionId
regionId
sourcePath
startLine
endLine
variable
origin
```

Typical rows are:

```text
function A, create, entity X
function B, read,   entity X
function C, update, entity X
```

Rules:

- `sourceId` is the function id when the observation is function-level, otherwise the innermost region id.
- `sourceType` is `function` or `function-region`.
- `relationship` directly records `create`, `read`, `update` or `delete`; there is no separate action column.
- `targetId` is the canonical entity id.
- `functionId` is always retained, even when `sourceId` is a region id.
- `regionId` is empty when no AST region contains the observation.
- `sourcePath`, `startLine` and `endLine` provide exact provenance.
- `variable` records the local alias at that observation.
- `origin` records known constructor/type/call provenance when available.

#### workflow-nodes.csv

Columns:

```text
id
type
name
entryFunctionId
exitFunctionId
functionCount
entityCount
```

The first version should keep workflow node details structural and compact. Semantic labels can be added later by the learned semantic layer.

#### workflow-links.csv

Each row relates a workflow node to a participating function.

Columns:

```text
sourceId
sourceType
relationship
targetId
targetType
ordinal
sourcePath
startLine
endLine
```

Typical rows are:

```text
workflow W -> contains -> function A
workflow W -> contains -> function B
```

Rules:

- `sourceId` is the workflow id.
- `sourceType` is `workflow`.
- `relationship` is `contains`.
- `targetId` is the existing function symbol id.
- `targetType` is `function`.
- `ordinal` records the function's position in the representative call path.
- source location is copied from the referenced function for direct evidence lookup.

Workflow execution order is still determined by the existing function `calls` graph. The workflow CSV records membership and representative order; it does not create an independent execution semantics.

### Use as query evidence

The three deterministic views remain independent but join on stable node ids:

```text
function graph
  where execution can travel

entity graph
  what structures are created/read/updated/deleted at each function or region

workflow graph
  which functions form a coherent vertical slice
```

HL construction and query scoring may use entity/workflow evidence as additional support for causality.

For example, a candidate region is stronger when:

```text
the query refers to entity X
+
the region reads/updates X
+
the containing function lies on the strongest call path
+
the function belongs to the same workflow slice
```

This evidence strengthens confidence. It does not replace the existing deterministic call topology or query-driven navigation policy.


## Query-driven semantic map construction

Generic code learning is now intended to grow from query demand rather than require exhaustive semantic interpretation of every indexed vertical call path.

The deterministic call-path index remains the topology authority. Its vertical slices are reorganized into an entry-rooted flow forest for semantic routing. Entry is plural and framework/language dependent: CLI commands, HTTP/API handlers, UI events, message/event consumers, scheduled jobs, public library APIs, tests, and other deterministically evidenced invocation roots may all seed a flow family.

The semantic layer adds local routing knowledge to deterministic edges:

```text
caller A
  -> B : semantic purpose of taking B from A
  -> C : semantic purpose of taking C from A
  -> D : semantic purpose of taking D from A
```

These annotations describe what the call achieves in its caller. They do not assign global importance or query relevance. Query-time scoring owns relevance because it changes with the issue.

Generic Pass 2 therefore persists `branchSemantics` keyed by exact deterministic `fromSymbolId -> toSymbolId`, including source path and line provenance when evidenced.

The code semantic frontier can expose bounded lookahead, normally two or three call levels:

```text
query / issue
-> deterministic entry candidates
-> semantic preview of outgoing branches + 2-3 level lookahead
-> query scores branches against its ordered answer/issue plan
-> expand the strongest branch
-> add/persist semantic annotations for the newly exposed region
-> return to query
-> continue best-first; backtrack when signal weakens
```

This creates three knowledge resolutions:

```text
deterministic topology
-> cheap/local semantic routing annotations
-> deep semantic interpretation where query evidence demands it
```

CallPathIndexer is therefore not the semantic-learning unit. It supplies deterministic end-to-end vertical slices and shared topology. Semantic knowledge is persisted against reusable nodes/edges/regions so converging flows can reuse already learned downstream meaning instead of paying to reinterpret the same subflow.

When the semantic map is empty, Query should request an initial bounded semantic frontier from deterministic entry candidates rather than fail because no learned workflow exists. Learn returns that frontier to Query. Query then chooses which branches deserve deeper semantic expansion. This clean-map query loop is the next integration point for `query_v4`.

Implementation:
- `server/semantics/code/queryDrivenSemanticFrontier.js` reconstructs entry-rooted flow families from grouped indexed paths, provides bounded lookahead, and attaches persisted edge semantics.
- `structuredWorkflow.js` asks code Pass 2 for exact caller-to-callee branch semantics and persists them in `state.codeBranchSemantics`.
- `codeSemanticEntryCandidates()` and `codeSemanticLookahead(entrySymbolId, depth)` expose the deterministic/semantic frontier to Query without forcing whole-repository semantic learning.


### Resetting learned semantics

The Profiles enterprise list exposes a reset control for the selected, loaded repository. Reset removes semantic workflows, semantic objects, branch annotations, scheduler/scout semantic progress, and other learned state for the loaded commit. It intentionally keeps the repository cache, language-analysis output held by the runtime topology, and deterministic call-path index available.

The reset endpoint is `POST /api/reset-semantic-map`. It is blocked while learning is running and requires the requested repository to match the currently loaded runtime. The UI asks for confirmation before invoking it.

This reset is the starting condition for cold query-driven learning experiments: deterministic topology exists, semantic knowledge is empty, and Query must request semantic expansion instead of depending on a pre-learned map.


### Inert server startup

Constructing the repository explorer must not select, restore, hydrate, repair, cluster, or semantically enrich any persisted map. Server startup is repository-neutral and performs no model calls. Persisted maps remain discoverable on disk but become active only after an explicit repository action. This prevents the most recently saved enterprise map from doing semantic work merely because DataSong was started, and makes cold query-driven experiments reproducible.
