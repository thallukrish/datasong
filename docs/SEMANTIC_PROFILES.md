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
