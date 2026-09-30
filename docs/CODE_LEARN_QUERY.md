# Code Learn and Query

This document defines the code-semantic Learn / Query contract used by the code semantic profile and Query v5.

The governing split is:

> Learn builds reusable query-independent semantic understanding. Query follows that evidence until it explains the issue.

## Learn

Learn never receives the user issue, query hypothesis, relevance criteria or desired answer.

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
persist semantic details
```

The structural graph remains authoritative for symbol identity, source coordinates, calls, containment, branches and traversal.

The model adds reusable semantic details such as:

```text
purpose
effect
```

Already learned predecessor semantics may be supplied only as execution context. Learn must not:

- see the user issue
- see or create a query plan
- score relevance
- rank query branches
- change meaning for the current investigation

A learned node is reusable by every later query.

## Rolling semantic window

Lazy learning does not mean learning one node at a time and it does not mean learning the whole repository.

LeMap maintains a learned semantic window around the current execution position.

```text
A → B → C → D
        └→ E → F
```

If A is the current position and the depth is 3, Learn ensures the reachable nodes inside that local window have semantic details.

When Query later moves to C or E, Learn expands three levels from that new position and learns only newly exposed nodes. Previously learned semantics are reused.

## Query is an evidence chase, not a fixed plan

Query does not create a fixed list of steps that must later be fulfilled.

The initial evidence is limited, so any multi-step plan created up front would be a guess beyond what LeMap has actually seen.

Instead Query maintains a rolling hypothesis from the evidence available so far.

```text
issue
  ↓
learned semantic evidence
  ↓
current hypothesis
  ↓
choose the most useful branch
  ↓
LeMap moves there
  ↓
Learn extends the 3-level semantic window
  ↓
more evidence
  ↓
update hypothesis
  ↓
repeat
```

The hypothesis follows the evidence while continually asking whether that evidence now explains the original issue.

The original issue is immutable. The hypothesis may change as evidence grows.


## Evidence ledger

Query keeps a cumulative evidence ledger separate from the current branch hypothesis.

The ledger contains facts that have been established from learned semantic evidence:

```text
issue
  ↓
established facts       ← cumulative across branches
  ↓
current hypothesis      ← branch-local and disposable
  ↓
current semantic window
```

Backtracking restores the earlier branch hypothesis, but it does not erase supported facts.

A fact may move through these states:

```text
supported
→ reinforced

or

supported
→ disputed
→ resolved by later evidence
```

Contradicting evidence must never silently delete an earlier fact. It marks that fact disputed until later evidence resolves the contradiction.

The ledger is query-local. It is not written into Learn semantics merely because one investigation established it.

This prevents repeated rediscovery while still allowing the investigation to change direction.

## Stop condition

At every meaningful position Query asks:

```text
Does the evidence seen so far explain the issue?
```

If yes, exploration stops immediately.

There is no requirement to complete an initial set of plan steps.

If the issue is not yet explained, Query chooses the strongest semantic continuation.

If no useful continuation exists at the current position, LeMap backtracks to a preserved alternative. If the current entry flow is exhausted, LeMap reseeds from another entry candidate.

## Responsibility split

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

The query model sees a semantic projection:

```text
original issue
current hypothesis
learned semantic path
learned local semantic window
candidate semantic branches
```

Source paths, line numbers and internal symbol IDs are not needed for branch selection.

They remain available inside LeMap for deterministic traversal and final localization.

## Query decision contract

The model makes one compact decision from the currently visible evidence.

```json
{
  "x": 0,
  "h": "current evidence-backed hypothesis",
  "a": [["new established fact", [evidenceSlot]]],
  "d": [factId],
  "p": [[candidateIndex, navigationConfidence]]
}
```

Where:

- `x = 1` means the accumulated supported facts plus current semantic evidence directly explain the issue and exploration must stop.
- `x = 0` means more evidence is required.
- `h` is the current branch hypothesis. When `x = 1`, it is the concise causal explanation.
- `a` adds newly established facts and cites the supplied evidence slots that support them.
- `d` marks previously established fact IDs as disputed when newly observed evidence contradicts them.
- `p` contains at most three branches worth exploring next.

The model receives the current ledger on every decision. A disputed fact cannot be used as support for `x = 1` until later evidence resolves or replaces it.

Candidates omitted from `p` are not selected.

There is no absolute navigation-score cutoff. If the model returns ranked candidates, LeMap follows the strongest one and preserves the remaining returned candidates as alternatives. If the model returns no candidate, LeMap backtracks or advances to the next entry batch.

The model must not claim `x = 1` merely because a branch is plausible. The evidence must establish the causal mechanism described by the issue.

## Entry exploration

Entry candidates are ordered deterministically by LeMap.

For each bounded entry batch, Learn first ensures each candidate has its three-level semantic window. Query then evaluates those semantic windows against the issue.

If one window already explains the issue, Query stops.

Otherwise Query chooses the strongest entry branch. Later entry batches are considered only when earlier evidence is inadequate or exhausted.

## Branch exploration

After Query selects a branch:

```text
selected function
        ↓
Learn ensures next 3 levels
        ↓
Query sees refreshed semantic window
        ↓
update hypothesis
        ↓
stop if explained
        ↓
otherwise select next branch
```

Only the selected position causes the semantic window to extend farther. Query does not need to eagerly learn three additional levels from every sibling before choosing among them.

## Backtracking, memory and hypothesis state

LeMap owns backtracking.

A hypothesis derived on a dead branch must not leak into an alternative branch. LeMap therefore restores the hypothesis associated with the earlier structural position when it backtracks.

The cumulative evidence ledger is different. Supported facts remain available after backtracking because they were established from observed evidence, not from the branch hypothesis.

```text
backtrack
→ restore earlier hypothesis
→ preserve supported facts
→ preserve disputed facts as disputed
→ explore alternative branch with accumulated evidence
```

This is the anti-wandering memory of Query.

## Localization

Once semantic evidence explains the issue, LeMap uses its retained structural coordinates and raw code to localize the exact supporting source ranges.

This is a separate task from semantic navigation:

```text
Learn      raw code + local structure → reusable semantics
Query      issue + semantics → hypothesis / next branch / stop
LeMap      structural state → traversal and backtracking
Localize   final supporting evidence → exact source ranges
```

## Invariants

1. Learn is query-independent.
2. Query reasons over learned semantics rather than repository coordinates.
3. Query has no fixed plan that must be completed.
4. The original issue remains fixed while the hypothesis follows evidence.
5. Query stops as soon as the evidence explains the issue.
6. LeMap keeps structural path, alternatives and source coordinates internally.
7. The semantic window extends lazily by three call levels from the selected position.
8. Learned semantics are persisted and reused across queries.
9. Wrong or exhausted paths cause backtracking, not goal rewriting.
10. Evidence-backed facts survive backtracking; only branch hypotheses roll back.
11. Contradictions dispute facts rather than silently deleting them.
12. Deterministic graph relationships are never delegated to the model.
