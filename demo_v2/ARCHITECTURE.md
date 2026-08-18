# DataSong v2 semantic exploration architecture

## Core principle

DataSong does not hard-code a closed definition of a flow.

A flow emerges when evidence sustains a coherent story around one concept. The concept may be small or large and may begin anywhere. Structural type does not make something a flow; sustained semantic continuity and coherence do.

## Progressive repository browsing first, semantic traversal second

DataSong should not force every repository artifact into a semantic-function abstraction before the model has decided that the artifact matters.

The model begins by browsing the repository at its natural structure:

1. DataSong lists the current directory.
2. The model chooses a directory or file to inspect.
3. DataSong exposes that artifact at the appropriate granularity for its type.
4. Once the model selects a meaningful function/config/XML unit, DataSong switches to semantic graph traversal around that unit.
5. Continuity/coherence scoring, neighborhood rollouts, DFS/backtracking and flow construction operate from there.

Repository orientation and semantic execution traversal are separate concerns, although the model may move between them when needed.

Repository orientation uses a deliberately small LLM prompt. Semantic-thread, proto-thread and DFS instructions are not sent while the model is merely choosing folders/files.

## Model is navigator; DataSong is the evidence environment

The model decides what evidence it wants to inspect and supplies semantic interpretation and continuity/coherence/information-gain scores.

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

The browsing/evidence operations are:

- `listDirectory(path)` — list one repository directory;
- `getArtifact(id)` — inspect one file or already-known artifact;
- `getFunction(id)` — inspect one selected function/XML/config semantic unit;
- `getNeighbors(id, depth=1..4)` — inspect a lightweight bounded call/reference neighborhood;
- `searchSemantic(query)` — find semantic functions relevant to a semantic question;
- `advance` — score a neighborhood and let DataSong choose the strongest admissible path;
- `backtrack` — leave the current trajectory and resume a preserved pending alternative;
- `stop` — no useful evidence request remains.

## Artifact-specific exposure

### Directories

DataSong returns the directory listing plus deterministic structural previews for child directories. A preview may contain descendant counts, extension distribution, sample paths, a shallow subtree and a `drillTarget` for single-child directory chains.

These previews contain no file contents and no semantic ranking. They reduce mechanical `cd`-style model calls while leaving semantic choice to the model.

### Source files

When the model asks for a source file, DataSong initially returns function/method signatures only. It does not send the whole source file merely because the file was selected.

When the model asks for one function with `getFunction`, DataSong returns:

- function identity/signature
- function body
- provenance
- lightweight signatures/relations of called or referenced functions

Called function bodies are not recursively dumped. The model chooses which one to inspect next.

### XML

For now XML may be returned directly when selected, provided transport remains reasonable. DataSong may additionally expose addressable structured XML units so the model can subsequently select a specific transition/service call/action/etc.

This avoids inventing parser-facing semantic nodes as repository entrypoints before the model has chosen the file.

### Configuration

JSON/YAML/env/properties/config artifacts are exposed as keys/items/values or addressable objects. Configuration is not treated as executable code merely for uniformity.

### Documents and other text artifacts

Markdown/text/SQL/other meaningful text is exposed as the document/artifact it actually is. It may contribute to a flow when semantic continuity/coherence supports that interpretation.

## Hierarchical coverage

Coverage is bookkeeping, not exploration policy.

```text
repository
  directory opened / unopened
  file opened / unopened
  source file
    function inspected / uninspected
  XML/config file
    semantic unit inspected / uninspected
```

A coherent flow may close while many unrelated files/functions remain uncovered.

## Transition into semantic traversal

Once a source function or meaningful structured unit is selected, it becomes a semantic exploration unit.

A `getFunction` response contains the body plus lightweight called-function signatures. The model can then inspect a clearly promising callee directly, request a depth-2..4 neighborhood when several trajectories are plausible, search semantically when the needed continuation is absent locally, or backtrack when signal flattens.

## Emergent semantic threads and proto threads

A semantic thread is a durable narrative whose accumulated evidence sustains one coherent concept.

The model evaluates evidence against every viable semantic thread using:

- `continuity` — how naturally this evidence continues the current frontier;
- `coherence` — how well the evidence fits the overall story;
- `bridge` — why it belongs or does not belong.

The first useful artifact does not have to define an entire workflow by itself. DataSong therefore also keeps **proto threads**: candidate narratives supported by promising evidence but not yet coherent enough to become durable threads.

A proto thread can be created, extended and then promoted when accumulated evidence sustains a coherent concept. This allows a sequence such as `Cart.xml -> updateCartItems -> totals` to crystallize into a shopping-cart thread even when `Cart.xml` alone was initially insufficient.

Completion pressure must never override poor semantic fit.

## Neighborhood rollouts

Immediate neighbors are often insufficient to tell which trajectory carries the main semantic story. The model may request:

```text
getNeighbors(functionId, depth=2..4)
```

DataSong returns lightweight outbound topology only. The model scores promising candidates with continuity, coherence and expected information gain.

The base semantic score is:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

`next_in_source` is only weak structural adjacency, not causal/business continuity, so it is discounted before path selection.

## DFS frontier: pending alternatives, not traversal history

The DFS stack is not a history of everything DataSong has explored.

For a scored neighborhood, DataSong chooses the strongest admissible candidate and preserves the other **admissible, unvisited** candidates as pending alternatives on that frame. Candidates already below the admissibility floor are not retained simply because they are mechanically reachable.

Conceptually:

```text
A
|- branch 1  0.90  <- chosen
|- branch 2  0.76  <- pending
`- branch 3  0.58  <- pending
```

If branch 1 later flattens, DataSong marks that trajectory exhausted and resumes the nearest pending alternative, normally branch 2. A flattened/traversed branch is not put back on the pending stack.

## Deterministic signal weakening / flattening

DataSong uses two deterministic controls.

### Hard admissibility floor

If the strongest effective semantic score is below `0.25`, the branch is rejected immediately and DataSong backtracks.

```text
semanticFit < 0.25 -> reject/backtrack
```

### Declining three-roll window

A branch may still be above `0.25` while clearly losing semantic signal. DataSong tracks the selected semantic score across the current branch's last three rollout decisions.

The branch is considered **flattening** when all of the following hold:

```text
s1 > s2 > s3
s3 >= 0.25
s1 - s3 >= 0.10
```

Examples:

```text
0.91 -> 0.78 -> 0.64   flatten
0.55 -> 0.54 -> 0.53   continue; decline is too small
0.91 -> 0.78 -> 0.82   continue; signal recovered
```

When flattening is detected, DataSong does not traverse the newly selected weak continuation. It marks the current branch flattened, discards that continuation from the current frame, and backtracks to the nearest preserved pending alternative.

When DataSong resumes a pending branch, that branch starts a new signal trajectory seeded by the score it had when it was originally preserved.

This keeps semantic scoring with the model while keeping branch-history interpretation and DFS mechanics deterministic inside DataSong.

## Semantic path selection

Path selection is ordered conceptually as:

1. semantic admissibility
2. continuity/coherence/information-gain score
3. trajectory trend across the current branch
4. closure pressure only as a secondary preference among already plausible alternatives

An almost-complete thread must never absorb unrelated evidence merely because completion is attractive.

## Cycle safety and reuse

Semantic functions and traversed edges are tracked separately. A previously interpreted semantic function can be reused from cache instead of being semantically reinterpreted. Recursive/back edges are preserved as graph relationships without causing infinite traversal.
