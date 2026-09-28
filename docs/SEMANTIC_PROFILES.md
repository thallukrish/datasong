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
