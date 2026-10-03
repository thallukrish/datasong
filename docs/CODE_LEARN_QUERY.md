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

### Structural index lifecycle

The structural code index is prepared when a repository profile is saved or its revision is changed, before Learn or Query uses it.

Repository indexing is not a Learn operation. Saving the repository profile triggers repository preparation directly and is treated as an explicit refresh:

```text
Profiles
→ Save repository / revision
→ resolve branch or commit
→ checkout the requested revision
→ rebuild structural construct index from source
→ replace the cached snapshot for the resolved commit
→ mark repository revision index-ready
```

Profile Save always rebuilds the structural index, even when the same branch, commit, schema version and analyzer version already have a complete cached snapshot. This makes Save the explicit "refresh from source" operation.

Profile Save is deliberately index-only. It does not build call-path indexes, run framework topology adapters, synthesize the full traversal topology, or invoke semantic Learn.

Code Query does not require the repository-wide call-path index. When a structural index is available, Query hydrates the cached language AST symbols and deterministic direct-call edges only. Faceted structural search then chooses the entry functions, and Learn expands a bounded local call window from those entries. Repository-wide call-path construction remains available for workflows such as Enterprise Learn, where discovering global business flows is itself the objective.

The cached AST/index snapshot from Profile Save is therefore reused directly by Code Query, so the expensive language parse is not repeated and Query does not construct unrelated repository-wide paths.

Learn does not own this lifecycle. Learn consumes an already prepared repository revision and its structural index. Other internal preparation paths may reuse a complete compatible commit-level snapshot when no explicit Profile Save requested a refresh.

The cache identity is revision-based rather than branch-name-based:

```text
repository
+ commit SHA
+ index schema version
+ language adapter / analyzer version
```

A branch name is only a movable label. The commit SHA is authoritative.

Repository preparation therefore follows:

```text
clone / fetch requested revision
        ↓
resolve exact commit SHA
        ↓
complete compatible construct index already cached for this SHA?
        ↓ yes                         ↓ no
reuse snapshot                 run language adapter indexing
                                      ↓
                              persist complete snapshot
        ↓
repository is query-ready
```

Switching branches or revisions through Profile Save resolves the new commit first. The revision field may contain either a branch name or a commit SHA. Profile Save then rebuilds and replaces the structural index for that resolved commit. Outside an explicit Profile Save refresh, a complete compatible commit-level snapshot may be reused.

Indexes are stored as complete logical snapshots per commit. Query never needs to replay a chain of branch deltas.

An index snapshot is reusable only when all of the following match:

```text
status = complete
commit SHA
index schema version
adapter / analyzer version
```

If the schema or analyzer changes, the old snapshot is treated as stale and rebuilt.

The initial implementation builds a complete snapshot for a previously unseen commit. A later optimization may construct that snapshot incrementally from the nearest indexed ancestor:

```text
nearest indexed ancestor
+ git diff to new commit
+ re-index changed / added files
+ remove deleted-file records
+ reuse unchanged-file records
        ↓
persist a new complete snapshot for the new commit
```

Even with incremental construction, the persisted result remains a complete commit-level snapshot. Branches do not depend on chained delta indexes at query time.

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

Structured candidates are ranked by match quality before weaker heuristics:

```text
whole metadata value matches
→ match begins at character 0
→ match occurs later in the value
```

For example, a filter for `Field` ranks `Field` above `FieldFactory`, and `FieldFactory` above `initial_for_Field`.

Language adapters also expose canonical AST snippets alongside original source snippets. This removes formatting noise from structural search. For Python, these source forms are structurally equivalent:

```python
Field(initial="x")
Field ( initial = "x" )
```

Both index as a call named `Field` with keyword argument `initial`. Snippet filters are evaluated against both the original source snippet and its canonical AST form, while original source text is retained for evidence and display.

### Change-request interpretation before faceted search

Code Query treats the user's request as a change request against an existing repository rather than as a bag of search terms.

Before choosing a structural facet, the entry-selection model distinguishes:

```text
evidence identifying existing code
symptoms / current behavior
desired behavior
rationale
examples
proposed implementation changes
```

The faceted search is driven first by evidence that identifies the existing code under discussion. A concrete API, method, configuration value, or mechanism mentioned as part of a proposed fix must not automatically be treated as something that already exists in the selected repository revision.

For example, a request may say that an existing backend client should be changed to use a different process API and environment variable. The backend/client identity is strong localization evidence for the existing code. The proposed API and environment variable become useful after candidate code is found, when Query relates the current implementation to the requested change.

This distinction happens inside the normal entry-selection reasoning. It does not require a separate classification model call.

### Faceted refinement

Structural entry selection is a bounded model-to-LeMap tree walk rather than one large one-shot search.

The first step exposes only the top-level LeMap construct vocabulary and counts:

```text
CALL         4872
ASSIGNMENT   1830
CONDITION     914
LOOP          402
FUNCTION       986
...
```

The model selects one branch. LeMap then returns only the remaining row count and compact facets for that branch. The model may refine one facet at a time.

```text
issue
  ↓
CALL 4872
  ↓
model selects CALL
  ↓
LeMap returns CALL facets + counts
  ↓
model selects name = Field
  ↓
LeMap returns remaining CALL facets
  ↓
model selects keywordArgs = initial
  ↓
small row set
  ↓
materialize exact source locations
```

The tree walk is capped at three model decisions. LeMap stops earlier when an exact or prefix lexical anchor has already reduced the branch to a small candidate set. Once that happens, LeMap materializes the rows instead of asking the model to invent another facet distinction.

A refinement supports:

```text
exact
prefix
regex
```

Exact matching is preferred when the issue supplies a concrete identifier or keyword. Prefix matching is preferred over a broader regex when it is sufficient. A further facet value must be grounded in the issue/question or be clearly structural. Facet frequency alone is never evidence that a value is relevant or causal.

Facet values can be presented by frequency or alphabetically. This lets the model browse a large branch without receiving raw source rows.

Each facet value also carries up to two short representative canonical code samples. The samples are selected to prefer structurally different rows when possible, for example different keyword-argument shapes for the same call name.

```text
name
  Field 19
    samples
      Field(default=None)
      Field(initial=lambda: True)

  validator 12
    samples
      validator("name")
      validator("email")
```

Samples are navigation hints only. They help the model understand what a facet bucket contains without materializing all rows. They are not semantic conclusions and are never sufficient by themselves to establish causality.

Samples are deliberately bounded:

```text
maximum 2 per facet value
canonical snippet preferred
maximum 120 characters each
no file path unless rows are materialized
```

For example:

```text
CALL 4872
→ browse name alphabetically
→ exact Field
→ 19 rows
→ materialize rows

Only if that exact anchor still leaves a large set should LeMap continue with another grounded facet, for example a keyword explicitly named in the issue.
```

Only the final small row set is materialized into source snippets and enclosing functions for Learn.

Before Learn expands any candidate by three call levels, LeMap performs one cheap source-only triage over the matched rows. This prevents a 10-20 row structural match set from triggering semantic Learn across every candidate.

```text
structural matches
→ compact matched source lines only
→ model ranks at most 4 direct candidates
→ Learn only those candidates
→ Query
```

The triage model receives no expanded semantic windows. It sees only compact source matches, names and resolved target metadata. It must prefer concrete source evidence and must not invent wrappers or forwarding layers that are absent from the matched code.

A direct call site can itself be causal. For example, if indexed evidence resolves a call to an external API and the matched source passes the deprecated argument directly, Query does not need to discover a local wrapper merely because the warning is emitted by the external library.

The LeMap construct vocabulary is intentionally small and language-neutral. Language adapters add low-cardinality structural facets beneath those constructs. These facets compress syntax differences rather than preserve incidental variable names.

The Python adapter currently emits:

```text
LOOP
  loopKind = counted | collection | conditional
  startKind = zero | one | literal | variable | expression
  endKind = collection_length | literal | variable | expression
  incrementKind = one | literal | variable | expression

CALL
  callKind = function | method
  argumentStyle = none | positional | keyword | mixed
  positionalCountBand = 0 | 1 | 2_3 | many
```

For example, all of these:

```python
for i in range(len(a)):
for j in range(0, len(items)):
for k in range(len(records)):
```

collapse into the same useful structural neighborhood:

```text
LOOP
  loopKind = counted
  startKind = zero
  endKind = collection_length
  incrementKind = one
```

The original variable names and source remain available only when the final rows are materialized.

The index therefore acts as a coarse funnel:

```text
language AST
→ LeMap construct
→ low-cardinality facets
→ bounded tree walk
→ exact/prefix/regex refinement
→ small source row set
→ entry functions
→ bounded local direct-call topology
→ Learn
→ Query
```

For Code Query, the faceted search is also the boundary that controls graph construction. LeMap does not first build every call path in the repository and then search those paths. It first narrows the repository structurally, maps the resulting rows to enclosing entry functions, and expands deterministic direct-call relationships only from those entries as Learn and Query need them.

```text
Code Query
  issue / question
        ↓
  faceted structural search
        ↓
  source-only triage
        ↓
  entry functions
        ↓
  local direct calls, bounded to the Learn window
        ↓
  Learn
        ↓
  Query chooses the next branch
        ↓
  expand locally again only when needed
```

Repository-wide call-path indexing is intentionally outside this Code Query path.

This avoids both extremes: sending thousands of raw rows to the model and over-fragmenting code into excessively specific structural fingerprints.

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

## Investigation modes

Code Query classifies the engineering task once and keeps that objective stable during traversal.

```text
causal
→ explain why an existing failure or incorrect behavior occurs

query
→ answer how, where or what the existing code does

change
→ identify the existing implementation targeted by a requested modification
→ establish how the current implementation relates to the requested change
```

Change mode is intentionally different from causal mode. A change request may describe a replacement API, configuration value or mechanism that does not yet exist in the selected repository revision. Query must not keep traversing merely to find that proposed implementation.

For change mode, semantic exploration is complete when supported evidence establishes both:

```text
the existing implementation being changed
+
how that implementation relates to the requested modification
```

At that point Query stops and localizes the supporting source ranges. It does not require a causal failure explanation and does not require the proposed replacement to already appear in source.

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
23. Structural indexes are cached by exact commit SHA, not by mutable branch name.
24. A cached index is reusable only when commit, schema version, analyzer version and completion status match.
25. Incremental indexing may optimize construction later, but Query always consumes a complete logical snapshot for the selected commit.
26. Saving a repository profile performs only checkout plus a fresh structural index rebuild for the resolved commit; semantic Learn is never part of Profile Save.
27. Structured search ranks whole-value matches above prefix matches and prefix matches above later substring matches.
28. Canonical AST snippets make structural matching insensitive to harmless source formatting such as spaces around calls and keyword assignment.
29. Structural entry selection is a bounded faceted tree walk, normally two or three model-to-LeMap refinements before source rows are materialized.
30. Facets should remain low-cardinality and compress incidental syntax differences rather than reproduce source-level variable names.
31. The model may refine a facet with exact, prefix or regex matching and may browse facet values by count or alphabetically.
32. Once a grounded exact or prefix anchor yields a small candidate set, LeMap materializes it rather than refining further from frequency alone.
33. Each facet value may expose at most two short representative canonical snippets chosen for structural diversity; these samples guide navigation but do not establish causality.
34. Structural matches are source-triaged before three-level Learn expansion, and no more than four structural candidates are expanded initially.
35. A matched call site that directly passes the deprecated or invalid argument to a resolved external API is a valid causal location; Query must not invent an absent local wrapper to explain it.
36. Code Query must not require a repository-wide call-path index when a structural language index is available.
37. Faceted structural search supplies Code Query entry functions before local call expansion begins.
38. Code Query expands deterministic direct-call topology only from selected entries and only to the bounded Learn window needed for the current decision.
39. Repository-wide call-path discovery remains a separate capability for workflows whose purpose is global flow discovery, such as Enterprise Learn.
40. Code Query distinguishes causal investigations, descriptive queries and requested code changes; the investigation mode remains stable once classified.
41. Change mode stops when evidence identifies the existing implementation targeted by the request and establishes its relationship to the requested modification.
42. Change mode must not require a proposed replacement API, configuration value or mechanism to already exist in the selected repository revision.
