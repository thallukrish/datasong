# Code Learn and Query

This document defines the code-semantic Learn / Query contract used by the code semantic profile and Query v5.

The governing split is simple:

> Learn builds query-independent semantic understanding. Query consumes that semantic map and decides where to explore.

## Learn

Learn never receives the user question, query plan, relevance criteria, or desired answer.

Given a function or function-region, Learn expands a local execution window through the next three call levels.

```text
supplied function / region
        ↓
deterministic call expansion
        ↓
current node + next 3 call levels
        ↓
learn semantics only for nodes not already learned
        ↓
persist semantic details on those nodes
```

The structural graph remains authoritative for symbol identity, source coordinates, calls, containment, branches and traversal.

The model is used only to add query-independent semantic details such as:

```text
purpose
effect
```

Already learned predecessor semantics may be supplied as execution context. They explain how execution arrived at the local window. They must not turn Learn into query-relative interpretation.

Learn must not:

- answer the user's query
- see the query plan
- score relevance
- rank branches
- change meaning according to the current investigation

A learned node is reusable by every later query.

## Rolling semantic window

Lazy learning means LeMap does not semantically learn the whole repository up front.

Instead it maintains a learned semantic window around the area being explored.

```text
A → B → C → D
        └→ E → F
```

If the active function is A and the window depth is 3, Learn ensures the reachable nodes inside that local window have semantic details.

When exploration later moves to C or E, Learn again expands three levels from that function and learns only the newly exposed nodes.

Previously learned semantics are reused rather than regenerated.

## Query

Query owns the investigation state, not Learn.

LeMap internally keeps:

```text
active structural node / region
DFS path
visited nodes
alternative branches
symbol IDs
source paths
line ranges
call edges
AST containment
```

The query model does not need those coordinates for branch selection.

The query model receives a semantic projection:

```text
active ordered plan step
learned semantic path
learned semantic lookahead for candidate branches
```

A candidate semantic view contains the function name plus its learned purpose/effect and the learned semantic lookahead rooted at that candidate.

Source path, line numbers and internal symbol IDs remain inside LeMap.

## Query loop

```text
semantic entry windows
        ↓
Query scores the active plan step
        ↓
choose strongest semantic branch
        ↓
LeMap moves structural position
        ↓
Learn ensures next 3 levels are semantically learned
        ↓
Query sees refreshed semantic lookahead
        ↓
repeat / backtrack / reseed
```

Query can therefore reason over meaning while LeMap performs deterministic navigation.

## Initial map

When relevant entry nodes have not yet been learned, LeMap first asks Learn to populate their three-level semantic windows.

For planning and entry scoring, Query then sees those learned semantic windows rather than raw source coordinates.

Entry candidates are still ordered deterministically by LeMap. Query evaluates them in bounded batches and can request later batches when earlier ones have inadequate semantic signal.

## Scoring contract

Scoring is intentionally compact.

Input is limited to:

```text
active step
semantic path
candidate semantic windows
```

The model returns only the strongest few candidates:

```json
{"p":[[candidateIndex,navigationConfidence,fulfillment]]}
```

Candidates omitted from the response are not selected.

Navigation means the semantic branch is useful to continue exploring.

Fulfillment is a hard signal and applies only when the candidate root node's own learned purpose/effect already establishes the active plan step. Lookahead semantics help navigation but do not by themselves mark the root fulfilled.

## Localization

Source coordinates and raw code are still retained by LeMap.

They are used when exact evidence must be localized after a plan step is semantically fulfilled.

This preserves the separation:

```text
Learn      raw code + deterministic local structure → reusable semantics
Query      semantic map → exploration decision
LeMap      structural state → traversal and backtracking
Localize   selected evidence → exact source ranges
```

## Invariants

1. Learn is query-independent.
2. Query should not score an unlearned frontier node.
3. Query reasons primarily over learned semantics, not repository coordinates.
4. LeMap keeps the structural path and branch state internally.
5. The semantic window extends lazily by three call levels from the supplied function or region.
6. Learned semantics are persisted and reused across queries.
7. Deterministic graph relationships are never delegated to the model.
