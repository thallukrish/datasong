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

## Investigation mode

Query first classifies the request once for the whole investigation:

```text
reported bug / failure / regression / wrong behavior
→ causal mode

descriptive code question
→ query mode
```

The mode remains stable across traversal, backtracking and reseeding.

### Causal mode

For a reported issue, branch scoring is causal rather than topical.

The model asks:

```text
Could the behavior represented by the traversed path
actually produce the reported issue?
```

A candidate score means:

```text
How likely is following this branch to complete
a causal explanation of the reported behavior?
```

Code that is merely related to configuration, validation, testing or surrounding infrastructure should not be preferred unless execution through that code could itself participate in the failure mechanism.

At each frontier, the model reasons over:

```text
original issue
+ cumulative supported facts
+ complete traversed semantic path
+ current learned semantic window
+ candidate continuations
```

The issue closes only when that combined evidence forms a coherent causal mechanism capable of producing the reported behavior.

### Query mode

For descriptive code questions, no root cause is required.

The model instead asks:

```text
Does this traversed path help answer the question?
```

Candidate scores mean how likely a continuation is to complete the answer.

The traversal, semantic window, evidence ledger and backtracking machinery are otherwise shared between both modes.

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

At every meaningful position Query asks according to its fixed reasoning mode:

```text
causal mode
Does the complete traversed evidence establish a mechanism that could cause the reported issue?

query mode
Does the complete traversed evidence answer the code question?
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
  "a": ["new established fact"],
  "d": [factId],
  "p": [[candidateIndex, navigationConfidence]]
}
```

Where:

- `x = 1` means the accumulated supported facts plus current semantic evidence directly explain the issue and exploration must stop.
- `x = 0` means more evidence is required.
- `h` is the current branch hypothesis. When `x = 1`, it is the concise causal explanation.
- `a` adds newly established facts as plain sentences. LeMap automatically binds those facts to the current semantic window.
- `d` marks previously established fact IDs as disputed when newly observed evidence contradicts them.
- `p` contains at most three branches worth exploring next.

The model receives the current ledger on every decision. A disputed fact cannot be used as support for `x = 1` until later evidence resolves or replaces it.

The model never returns evidence-slot IDs for facts. During traversal there is one current semantic window, so LeMap deterministically attaches every accepted fact to that window. During entry selection, where multiple independent windows are being compared, no facts are added to the ledger.


Candidates omitted from `p` are not selected.

There is no absolute navigation-score cutoff. If the model returns ranked candidates, LeMap follows the strongest one and preserves the remaining returned candidates as alternatives. If the model returns no candidate, LeMap backtracks or advances to the next entry batch.

In causal mode, the model must not claim `x = 1` merely because a branch is plausible or topically related. The traversed path and supported facts must establish a causal mechanism that could produce the reported behavior. In query mode, `x = 1` means the accumulated evidence directly answers the question.

## Entry selection before exploration

Code-flow Query does not always begin from repository root entry points.

Before exploration, the model chooses one of two entry-selection strategies:

```text
question / issue
        ↓
entry selection
        ↓
pattern_search OR root_entries
        ↓
rank candidate source regions
        ↓
Learn current region + next 3 call levels
        ↓
normal Query exploration
```

### Structural code search

For supported languages, entry selection uses an adapter-built structural code index before falling back to raw regex search.

The language adapter parses the repository once during preparation and emits searchable code-construct records. Each record keeps source coordinates and the exact code snippet, together with structural metadata derived from the language parser.

For Python, the initial construct vocabulary includes:

```text
class
function
loop
condition
call
import
assignment
return
exception
decorator
```

A construct record may contain metadata such as:

```text
constructType
name
module
qualifiedName
parentFunction
parentClass
keywordArgs
sourcePath
startLine
endLine
snippet
```

The model never receives hundreds or thousands of raw construct rows.

Instead LeMap first supplies a compact index summary:

```text
construct counts
+ searchable fields
+ compact facets for useful metadata values
```

For example, a repository may contain thousands of calls. The model can select the `call` slice and narrow it using regex over metadata fields such as call name, module, keyword arguments or snippet text.

```text
issue / question
        ↓
LeMap exposes structural index summary
        ↓
model chooses construct type + regex metadata filters
        ↓
LeMap filters the index deterministically
        ↓
few matching code snippets remain
        ↓
model selects candidate function / region
```

Filters inside one structural search are ANDed. Multiple structural searches are ORed.

The model should use vocabulary already present in the issue when it provides a strong anchor. Facets exist only to discover repository-specific vocabulary when the issue itself is insufficient.

This lets the model reason in terms of code structure without requiring a language-specific query DSL. The parser remains language-specific, while the search contract stays generic:

```text
construct = call
name regex = ...
snippet regex = ...
```

The regular expressions apply only to indexed metadata fields. They are not expected to parse the source language.

### Faceted refinement

If a construct category contains hundreds or thousands of entries, LeMap does not send those entries to the model. It sends counts and compact facets instead.

Conceptually:

```text
calls = 4872

searchable fields
name
module
qualifiedName
parentFunction
parentClass
keywordArgs
snippet

facets
name: ...
module: ...
```

The model can then request a narrow deterministic search. Only the resulting small candidate set is exposed for selection.

The first implementation performs this in one model decision by providing the summary and facets together. The contract also allows iterative refinement later if one-shot filtering is insufficient.

### Regex source fallback

If no structural index is available for the repository language, LeMap may fall back to syntax-aware regex search over raw source.

Raw regex search is therefore a compatibility fallback rather than the preferred entry-selection mechanism.

### From structural match to Learn

Every structural-index match already carries an exact source snippet and line range.

LeMap maps each match to the enclosing function and creates a small contained function-region around the matched source. Multiple distant matches in the same function remain separate highlighted regions.

Learn then runs exactly as it does for a normal Query-selected function:

```text
selected enclosing function
+ highlighted matched region(s)
+ normal next-three-call-level window
        ↓
Learn
```

The highlighted region preserves the exact matched construct and its surrounding source so Query can see why the function was selected.

After Learn, structural discovery is finished. The enclosing function is passed to Query as the current seed with:

- enclosing-function semantics
- highlighted matched-region semantics
- exact matched source
- normal three-level lookahead semantics
- current function body when Query evaluates the seed

Query may close the cause immediately if the highlighted code and current body are sufficient. Otherwise it continues normal causal or relevance exploration.

The invariant is:

> Structural search changes how the starting function is discovered. It does not change Learn or Query semantics.

### Root-entry fallback

When the model determines that the request is primarily an end-to-end flow question, or when pattern search yields no usable executable region, Query uses the existing deterministic repository entry candidates.

Root entry ranking remains unchanged.

### Entry tiers

Pattern-selected entries form the first entry tier. Query learns and evaluates their three-level semantic windows before considering ordinary root entries.

Only when the pattern-selected tier is inadequate or exhausted does Query fall back to the existing root/external-entry tier.

This keeps Learn and the normal query traversal unchanged:

```text
pattern match
→ enclosing function + highlighted matched region
→ Learn function + highlighted region + three-level semantic window
→ pass enclosing function to Query as current seed
→ Query checks matched evidence/body for immediate closure
→ otherwise descend / backtrack using existing machinery
```

If one window already explains the issue, Query stops. Otherwise Query chooses the strongest continuation and preserves alternatives exactly as before.

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
11. Fact-to-evidence binding is deterministic in LeMap; the model returns fact sentences, not evidence-slot IDs.
12. Contradictions dispute facts rather than silently deleting them.
13. Query classifies the request once as causal or query mode and keeps that objective stable.
14. Causal-mode branch scores measure causal continuation, not generic relevance.
15. Deterministic graph relationships are never delegated to the model.
16. Entry selection may localize likely source regions before traversal, but causality/relevance is still established only by the normal semantic exploration.
17. Adapter-built structural indexes are the preferred localization mechanism for supported languages; raw-source regex is a fallback.
18. The model sees construct counts, searchable fields and compact facets rather than bulk construct rows.
19. Structural-search regexes filter indexed metadata fields; they are not responsible for parsing source syntax.
20. Selected structural regions are temporary query entry points; they do not redefine repository roots or Learn semantics.
21. Structural discovery changes only how the starting function is found. Once selected, the enclosing function follows the same Learn and Query lifecycle as any normal Query-selected function.
22. The matched source span remains attached as highlighted semantic evidence while the enclosing function drives the normal three-level call lookahead.
