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

Repository orientation and semantic execution traversal are therefore separate concerns, although the model may move between them when needed.

## Model is navigator; DataSong is the evidence environment

The model decides what evidence it wants to inspect and what semantic question it is pursuing.

DataSong owns deterministic mechanics:

- repository directory/file inventory
- artifact-type-aware exposure
- source parsing and function signatures
- function bodies on demand
- call/reference graph
- visited state
- file/function coverage
- cycle detection
- semantic threads
- DFS stacks and pending branches
- cached interpretations
- bounded neighborhoods
- backtracking

The browsing/evidence operations are:

- `listDirectory(path)` — list one repository directory;
- `getArtifact(id)` — inspect one file or already-known artifact;
- `getFunction(id)` — inspect one selected function/XML/config semantic unit;
- `getNeighbors(id, depth=1..4)` — inspect a lightweight bounded call/reference neighborhood;
- `searchSemantic(query)` — find semantic functions relevant to a semantic question;
- `advance` — after neighborhood scoring, let DataSong choose the strongest admissible path;
- `backtrack` — local semantic signal has flattened or drifted;
- `stop` — no useful evidence request remains.

## Artifact-specific exposure

The browsing boundary is deliberately not universal.

### Directories

DataSong returns the directory listing plus deterministic structural previews for child directories.

A directory preview may contain:

- descendant file count
- direct file/directory counts
- file-extension distribution
- a small sample of file paths
- a shallow subtree, typically a few levels deep
- a `drillTarget` when a directory collapses through a single-child chain before files appear

These previews contain no file contents and no semantic ranking. They exist only to avoid wasting model calls on mechanically descending paths such as `src/ -> test/ -> groovy/` and to give the model enough structural evidence to choose where information gain is likely to be higher.

The model may jump directly to any deeper directory path exposed in a preview. DataSong still does not decide which directory is semantically important.

### Source files

When the model asks for a source file (`.js`, `.ts`, `.py`, `.java`, etc.), DataSong initially returns function/method signatures only:

```text
placeOrder(cart, user)
validateCart(cart)
calculateTotal(cart)
persistOrder(order)
```

It does not send the whole source file merely because the file was selected.

When the model asks for one function with `getFunction`, DataSong returns:

- function identity/signature
- function body
- provenance
- lightweight signatures/relations of called or referenced functions

Called function bodies are not recursively dumped. The model chooses which one to inspect next.

### XML

For now XML may be returned directly when the file is selected, provided the transport remains reasonable. DataSong may additionally expose addressable structured XML units so the model can subsequently select a specific transition/service call/action/etc.

This is intentionally simpler than inventing parser-facing identities such as `$xml.screen.screen-1@15` as repository entrypoints before the model has chosen the file.

### Configuration

JSON/YAML/env/properties/config artifacts are exposed as keys/items/values or addressable objects. Repeated array objects may become addressable items when they carry distinct meaning.

Configuration is not treated as executable code merely for uniformity.

### Documents and other text artifacts

Markdown/text/SQL/other meaningful text is exposed as the document/artifact it actually is. It may contribute to a flow when semantic continuity/coherence supports that interpretation.

## Hierarchical coverage

Coverage is bookkeeping, not exploration policy.

DataSong tracks:

```text
repository
  directory opened / unopened
  file opened / unopened
  source file
    function inspected / uninspected
  XML/config file
    semantic unit inspected / uninspected
```

A coherent flow may close while many unrelated files/functions remain uncovered. Coverage remains available for later exploration and for answering whether the evidence world has been comprehensively inspected.

## Transition into semantic traversal

Once a source function or meaningful structured unit is selected, it becomes a semantic exploration unit.

A `getFunction` response contains the body plus lightweight called-function signatures, for example:

```text
placeOrder(cart, user)

body: ...

calls:
- validateCart(cart) -> ValidationResult
- calculateTotal(cart) -> Money
- persistOrder(order) -> orderId
```

The model can then:

- inspect a clearly promising callee directly;
- request `getNeighbors(..., depth=2..4)` when several trajectories are plausible;
- ask `searchSemantic(...)` if the required continuation is not represented locally;
- backtrack when continuity/coherence flatten.

## Emergent semantic threads

The explorer may maintain multiple semantic threads.

For evidence that is semantically interpreted, the model evaluates fit against every viable thread:

- `continuity` — how naturally this evidence continues the current frontier of the thread;
- `coherence` — how well the evidence fits the overall story represented by the thread;
- `bridge` — why it belongs or does not belong.

If no existing thread fits, the evidence may remain unattached or seed a new thread.

Completion/closure pressure must never override poor semantic fit.

## Flows are emergent, not declared

There is no hard structural definition of a flow.

A flow is the durable narrative that crystallizes when accumulated evidence keeps supporting one coherent concept.

A flow may begin from a UI action, service, calculation, event, batch process, configuration-driven action, data operation, document rule or anything else. It sustains only if continuity and coherence remain strong as evidence is explored.

Flows may naturally nest, overlap or branch.

## Neighborhood rollouts

Immediate callees are often insufficient to tell which trajectory carries the main semantic story.

The model may request:

```text
getNeighbors(functionId, depth=2..4)
```

DataSong returns lightweight topology only:

- candidate IDs
- relation types
- function/config identities
- signatures / canonical essence
- depth and edges

It does not recursively send all bodies.

The model scores promising candidates with:

- thread ID (or NEW/UNATTACHED)
- continuity
- coherence
- expected information gain
- short reason

On `advance`, DataSong calculates the strongest admissible candidate and traverses it.

If all local candidate signals are weak, DataSong should not force adjacency; it backtracks.

## DFS and signal flattening

DataSong maintains DFS-like traversal state beneath the model:

- execution stack
- pending sibling branches
- visited functions/edges
- cycles/back-edges
- per-thread trajectory evidence

As long as semantic signal remains strong, the current trajectory continues.

When continuity/coherence/information gain flatten, DataSong returns to another pending branch. The model need not manually maintain stack mechanics.

## Semantic path selection

Path selection is conceptually ordered as:

1. semantic admissibility (continuity/coherence)
2. trajectory evidence and expected information gain
3. closure pressure only as a secondary preference among already plausible alternatives

An almost-complete thread must never absorb unrelated evidence merely because completion is attractive.

## Normal interaction sequence

A typical source-code exploration becomes:

```text
DataSong: listDirectory("/")
             screen/  36 XML files, samples..., shallow preview...
             src/      3 Groovy files under src/test/groovy, drillTarget=src/test/groovy
model: listDirectory("src/test/groovy")
DataSong: files under src/test/groovy/
model: getArtifact("src/test/groovy/PopCommerceScreenTests.groovy")
DataSong: function signatures only
model: getFunction(testOrderDetail)
DataSong: body + called function signatures
model: getNeighbors(testOrderDetail, 3)
DataSong: bounded lightweight call graph
model: continuity/coherence/gain scores + advance
DataSong: chooses strongest admissible path
```

The same model may instead choose `screen/` from the root preview if that appears more promising. The preview supplies evidence; it does not prescribe the choice.

This preserves model agency while keeping payloads focused and repository mechanics deterministic.

## Cycle safety and reuse

Semantic functions and traversed edges are tracked separately. A previously interpreted semantic function can be reused from cache instead of being semantically reinterpreted. Recursive/back edges are preserved as graph relationships without causing infinite traversal.
