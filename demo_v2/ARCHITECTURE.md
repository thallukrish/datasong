# DataSong v2 semantic exploration architecture

## Primary objective: discover business-use-case vertical slices

DataSong explores enterprise evidence to discover **end-to-end vertical slices of business use cases implemented by the application**.

The primary point of view is the application's end user or business actor: what are they trying to accomplish, and how does the system support that intent end to end?

Illustrative examples include customer product search, cart update, checkout, order placement, profile update, employee approval, shipment scheduling, invoice creation, or an external business system submitting an order. These examples are not a closed ontology.

A business actor does not have to be a human using a UI. It may be an external system, scheduler, operator, batch process or other participant when the vertical slice represents a genuine enterprise/business capability.

Repository artifacts are **evidence, not the objective**. Tests, test suites, setup/cleanup code, configuration, framework wiring, utilities, shared services, logs and infrastructure may be extremely useful because they reveal, exercise or connect pieces of business use cases. They should be followed when they help reconstruct a business vertical slice, but technical coherence alone must not crystallize into a durable business thread.

For example, a screen test suite may reveal scenarios such as Search, Cart, Checkout and Order History. The suite is useful orientation evidence; the discovered business threads are the underlying user/business use cases, not the test harness lifecycle itself.

## Core principle

DataSong does not hard-code a closed structural definition of a flow.

A flow emerges when evidence sustains a coherent end-to-end business-use-case story. Structural type does not make something a flow; sustained semantic continuity and coherence around a business intent/capability do.

## Pass 1: broad business-arc discovery

Pass 1 deliberately operates at business-stage resolution rather than implementation resolution.

For each visible business use case it tries to identify:

- trigger / actor / business intent;
- broad major stages;
- important decisions or branches;
- major data effects;
- major persistent/business entities and their relationships;
- end state, persistence effect, external handoff, or user-visible outcome.

Implementation detail is trivial for Pass 1 when omitting it does not materially change that business explanation. Such detail may be collapsed into a short business-level statement or skipped and revisited in a later pass.

Several business-use-case arcs may coexist. Pass 1 may pursue multiple promising arcs, favoring completion of a nearly coherent broad arc without locking exploration onto one implementation path indefinitely.

## Progressive repository browsing first, semantic traversal second

DataSong should not force every repository artifact into a semantic-function abstraction before the model has decided that the artifact matters.

The model begins by browsing the repository at its natural structure:

1. DataSong lists the current directory.
2. The model chooses a directory or file likely to reveal business-use-case evidence.
3. DataSong exposes that artifact at the appropriate granularity for its type.
4. Once the model selects a meaningful function/config/XML unit, DataSong switches to semantic graph traversal around that unit.
5. Continuity/coherence scoring, neighborhood rollouts, DFS/backtracking and flow construction operate from there.

Repository orientation and semantic execution traversal are separate concerns, although the model may move between them when needed.

Repository orientation uses a deliberately small LLM prompt. Semantic-thread, proto-thread and DFS instructions are not sent while the model is merely choosing folders/files.

## Model is navigator; DataSong is the evidence environment

The model decides what evidence it wants to inspect and supplies semantic interpretation and continuity/coherence/information-gain scores aligned to the business-use-case objective.

DataSong owns deterministic mechanics:

- repository directory/file inventory
- artifact-type-aware exposure
- source parsing and function signatures
- function bodies on demand
- call/reference graph
- visited state
- file/function coverage
- cycle detection
- semantic and proto threads
- DFS pending alternatives
- signal-history tracking
- branch flattening and backtracking
- cached interpretations
- bounded neighborhoods
- score-driven DFS pruning
- goal-directed semantic escape when local topology is exhausted
- deterministic ordered word-level semantic search
- alternate-keyword search-plan state

The browsing/evidence operations are:

- `listDirectory(path)` — list one repository directory;
- `getArtifact(id)` — inspect one file or already-known artifact;
- `getFunction(id)` — inspect one selected function/XML/config semantic unit;
- `getNeighbors(id, depth=1..4)` — inspect a lightweight bounded call/reference neighborhood;
- `searchSemantic(query)` — find canonical evidence using deterministic ordered word-level matching;
- `advance` — score a neighborhood and let DataSong choose the strongest admissible path;
- `backtrack` — leave the current trajectory and resume a preserved semantically admissible alternative;
- `stop` — no useful evidence request remains.

## Artifact-specific exposure

### Directories

DataSong returns the directory listing plus deterministic structural previews for child directories. A preview may contain descendant counts, extension distribution, sample paths, a shallow subtree and a `drillTarget` for single-child directory chains.

These previews contain no file contents and no semantic ranking. They reduce mechanical `cd`-style model calls while leaving semantic choice to the model. During orientation, the model prefers locations likely to reveal end-user/business-actor behavior; tests may be selected as maps of such behavior, but not because test lifecycle itself is the target flow.

### Source files

When the model asks for a source file, DataSong initially returns function/method signatures only. It does not send the whole source file merely because the file was selected.

When the model asks for one function with `getFunction`, DataSong returns function identity/signature, body, provenance, and lightweight signatures/relations of called or referenced functions. Called function bodies are not recursively dumped.

### XML and XML-derived test plans

XML may be returned directly when selected, provided transport remains reasonable. XML-like structured test plans such as `.jmx` are treated as readable structured evidence rather than opaque files, because they may reveal broad end-to-end business scenarios.

### Configuration

JSON/YAML/env/properties/config artifacts are exposed as keys/items/values or addressable objects. Configuration is not treated as executable code merely for uniformity.

### Documents and other text artifacts

Markdown/text/SQL/other meaningful text is exposed as the document/artifact it actually is. It may contribute to a business flow when semantic continuity/coherence supports that interpretation.

## Hierarchical coverage

Coverage is bookkeeping, not exploration policy. A coherent flow may close while many unrelated files/functions remain uncovered.

## Transition into semantic traversal

Once a source function or meaningful structured unit is selected, it becomes a semantic exploration unit.

A `getFunction` response contains the body plus lightweight called-function signatures. The model can then inspect a clearly promising callee directly, request a depth-2..4 neighborhood when several trajectories are plausible, search semantically when the needed continuation is absent locally, or backtrack when signal flattens.

Technical evidence is followed when it helps answer the business-use-case question: what business intent/capability is being implemented, what stages carry it through the system, what decisions/data effects occur, and what outcome or branch results?

## Emergent semantic threads and proto threads

A durable semantic thread represents a business capability or end-user/business-actor use case whose accumulated evidence sustains one coherent vertical slice.

The model evaluates evidence against every viable semantic thread using continuity, coherence and bridge. Supporting technical evidence may remain proto/orientation evidence until a business-use-case narrative crystallizes.

Completion pressure must never override poor semantic fit or the business-use-case objective.

## Neighborhood rollouts and scoring

Immediate neighbors are often insufficient to tell which trajectory carries the main business story. The model may request `getNeighbors(functionId, depth=2..4)`.

The scoring meanings are objective-aligned:

- `continuity`: next-step fit for the same business use case;
- `coherence`: overall fit with that same end-to-end business use case;
- `expectedGain`: likelihood of revealing a missing business stage, decision, data effect, outcome, branch or actor interaction.

The base semantic score is:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

`next_in_source` is weak structural adjacency, not causal/business continuity, so it is discounted before path selection.

## DFS frontier and drift control

The DFS stack stores admissible unexplored semantic alternatives, not a history of all structurally reachable nodes.

Neighborhood scoring prunes the frame on both `advance` and `backtrack`. A candidate below the hard semantic-fit floor of `0.25` is rejected.

A branch is also considered flattening when its last three selected semantic scores strictly decline while staying above the floor and the total decline is at least `0.10`:

```text
s1 > s2 > s3
s3 >= 0.25
s1 - s3 >= 0.10
```

When flattening occurs, DataSong backtracks to the nearest preserved admissible alternative.

## Ordered word-level semantic search

Semantic search is deterministic lexical search over canonical semantic evidence, not embedding similarity.

Queries are tokenized at word level, including camelCase splitting. For example:

```text
OrderDetail -> order detail
```

For a multi-word query such as `order detail`, candidate evidence is ranked by the best matching target field using these tiers:

```text
5  exact target phrase
4  all query words contiguous from the beginning of the target
3  all query words contiguous later in the target
2  all query words present in order with intervening target words
1  only part of the query words present in order
```

Within the partial-match tier, candidates matching the greater number of query words rank higher. Earlier contiguous matches break ties before stable name ordering.

The search is applied to canonical names/signatures/source paths and compact semantic packet fields such as operations, conditions, inputs and outputs. It does not award independent substring points merely because query terms occur somewhere in a large serialized artifact.

This means `order detail` strongly favors evidence that actually expresses `order` followed by `detail`, rather than unrelated evidence that happens to contain either word.

## Alternate-keyword recovery

A semantic-search request may include alternate keyword phrases with the first request:

```json
{
  "type": "searchSemantic",
  "query": "order detail",
  "alternateQueries": [
    "view order",
    "order display",
    "customer order detail"
  ]
}
```

DataSong always tries the primary query first. The model then scores the returned candidates using the normal continuity/coherence/expected-gain rubric.

If the strongest returned candidate is below the semantic floor, the results are considered weak for the active business arc. DataSong then tries the next supplied alternate query **without switching arcs**.

Conceptually:

```text
primary query
-> ranked lexical candidates
-> model semantic scoring
-> admissible result? continue current arc
-> all weak? next alternate query
-> all alternates weak? suspend/mark current arc unresolved
-> switch to another promising business-use-case thread
```

The model may also issue a new `searchSemantic` request with improved keywords after seeing weak results. That new request replaces the current search plan.

This keeps responsibilities separated:

```text
DataSong = deterministic word-level retrieval + ranking + retry state
Model    = semantic usefulness judgment + optional alternate keywords
```

Search plans and their outcomes are retained in `pass1SearchPlans` for auditability.

## Business-thread semantic escape

Topology depth and semantic search solve different problems.

`getNeighbors(depth=1..4)` explores farther along known graph edges. Increasing depth cannot discover a continuation absent from the current canonical topology.

When the current scored neighborhood has no admissible continuation, DataSong first prunes the frame, then resumes a semantically admissible pending DFS branch. If none exists, it performs goal-directed search anchored to the active business-use-case thread rather than falling back to generic mechanically-unvisited nodes.

## Semantic path selection

Path selection is ordered conceptually as:

1. alignment with the end-user/business-use-case objective
2. semantic admissibility
3. continuity/coherence/information-gain score
4. trajectory trend across the current branch
5. closure pressure only as a secondary preference among already plausible alternatives

An almost-complete thread must never absorb unrelated evidence merely because completion is attractive.

## Cycle safety and reuse

Semantic functions and traversed edges are tracked separately. A previously interpreted semantic function can be reused from cache instead of being semantically reinterpreted. Recursive/back edges are preserved as graph relationships without causing infinite traversal.
