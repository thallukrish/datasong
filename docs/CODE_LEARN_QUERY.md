# Code Learn and Query

This document defines the code-semantic Learn / Query contract used by the code semantic profile and Query v5.

The governing split is:

> Learn builds reusable query-independent semantic understanding. Query follows that evidence until it explains the issue.

## Learn

Learn never receives the user issue, query hypothesis, relevance criteria or desired answer.

Learn is frontier-lazy. It builds only the semantics needed for the next search decision. Functions of 50 lines or fewer remain coherent semantic units; statement regions are used as a chunking mechanism only for functions longer than 50 lines.

```text
selected function
        ↓
learn function + direct semantic regions
        ↓
Query scores the region frontier
        ↓
selected region
        ↓
learn only that region's direct semantic children
        ↓
repeat

after relevant body space is exhausted
        ↓
learn only the immediate call frontier
```

Learn never expands a three-level call tree merely because a function was selected. Deeper regions and called functions are learned only when Query reaches that frontier.

The structural graph remains authoritative for symbol identity, source coordinates, calls, containment, branches and traversal.

For Python, the analyzer already emits statement-level regions inside each function. When a function becomes the current investigation root, Learn now materializes those existing AST regions into the semantic graph and annotates them with query-independent semantics. The semantic graph therefore mirrors the function's structural body instead of reducing it to only function-level summaries and call edges.

Each learned region keeps the same structural identity and source range as the analyzer region. Learn may use the region's raw code to create query-independent semantics, but Query normally receives only the learned purpose/effect plus structural identity. Source is fetched only for structural entry matching or an explicit source-inspection action requested by Query.

This expansion is lazy. Entry-candidate comparison does not learn every candidate's body regions. Regions are expanded only after a candidate becomes the current function, and called functions receive their regions when they later become the current root.

Once a function is selected for active investigation, Query searches its semantic region hierarchy before branching into called functions or abandoning that entry candidate. Direct regions are scored as semantic navigation candidates, the highest-scoring region is visited first, and nested semantic regions are scored in the same way. A region with score 0 can be pruned; the walk is relevance-driven rather than a sequential source-code scan. Only after the function's relevant semantic body space has been exhausted may call-graph traversal or entry backtracking continue.

Navigation score and goal-satisfaction score are separate. Navigation answers "where should the semantic search go next?" Goal satisfaction answers "is the accumulated evidence sufficient for this goal?" A goal closes only at 1.0. If semantics identify a material node but are insufficient to establish the needed fact, Query may explicitly request that node's exact source range and score again with that source as verification evidence.

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

LeMap maintains a learned semantic frontier around the current search position.

For a function of 50 lines or fewer, the function itself is the semantic unit and the next frontier is its immediate called functions. For a function longer than 50 lines, the frontier is its direct semantic body regions. For a selected region, the frontier is its direct nested semantic regions. After a large function's relevant body space has been exhausted, its frontier becomes its immediate called functions.

When Query moves to one of those nodes, Learn expands only that node's next frontier and reuses semantics already persisted.

## Evidence obligations

Query keeps the original request stable, but does not force the whole request into one reasoning mode.

A real engineering request may combine several interdependent tasks:

```text
locate existing code
+ understand current behavior
+ explain a reported failure
+ identify a requested change
+ verify a constraint or consequence
```

Before structural exploration, Query performs one lightweight decomposition into material evidence obligations. Each goal has:

```text
id
kind = locate | describe | causal | change | verify
text
dependsOn
hardConstraints
optionalConstraints
status = unresolved | resolved
```

The goal model derives hard and optional constraints once, at decomposition time, from the original request. Hard constraints are the minimum conditions that must be established for the goal to count as satisfied. Optional constraints strengthen confidence or context but are not mandatory. These constraints remain immutable during traversal; candidate code may change only their scores, never their wording or membership.

The decomposition is intentionally small, normally one to five goals and never more than six. It is not an execution plan. It says what must eventually be established from evidence, not which code path must be traversed.

A `locate` goal is created only when locating or identifying code is itself an explicit user-requested outcome. LeMap does not create a separate locate goal merely because a causal, descriptive, change, or verification goal must first find relevant code; faceted localization is already part of every goal's investigation thread.

Goal decomposition must also be lossless. If the request is split, the goals plus their dependency relationships must collectively preserve every material condition, discriminator, scope restriction, symptom, and requested outcome from the original issue. A condition needed to identify or reason about evidence for a goal remains in that goal even if a later dependent goal also mentions it.

Dependencies represent information flow. When G2 depends on G1, G2 consumes the evidence established by G1. Solving all goals in dependency order must therefore be equivalent in coverage to handling the original request as a whole. Splitting must never make the combined investigation weaker or narrower than the original issue.

For example:

```text
G1 locate
identify the existing fixture-directory duplicate check

G2 causal
explain why the reported Path condition changes duplicate detection
dependsOn G1

G3 change
identify what existing implementation a requested modification applies to
dependsOn G1, G2

G4 verify
confirm a stated compatibility constraint
dependsOn G3
```

The original request and goal set remain stable while evidence grows. Goals are marked resolved only when repository evidence supports them.

### Per-goal investigation threads

Each goal owns an independent investigation thread.

A thread keeps its own:

```text
faceted-search state
entry candidates
visited symbols
DFS stack
preserved alternatives
rolling hypothesis
exhaustion state
```

The repository structural index, learned semantic map, and query-local evidence ledger are shared across threads.

This means two goals that are unrelated in code space do not have to share one traversal:

```text
G1
→ faceted search
→ entry A
→ Learn
→ Query

G2
→ separate faceted search
→ entry B
→ Learn
→ Query
```

If both goals touch the same code, Learn reuses the already persisted semantics even though their navigation threads are separate.

Goal dependencies control scheduling rather than forcing structural proximity. An independent unresolved goal can be searched immediately. A dependent goal becomes schedulable only after its prerequisite goals are resolved.

The scheduler therefore operates at two levels:

```text
issue
→ choose schedulable unresolved goal
→ run that goal's faceted search / traversal thread
→ resolve goal or exhaust its thread
→ choose next schedulable goal
→ stop when all material goals are resolved
```

Evidence established by one thread remains available to later threads through the shared evidence ledger, even when the later goal searches a completely different part of the repository.

### Goal-specific reasoning

For a **locate** goal, Query asks whether the current evidence identifies the existing implementation or source region.

For a **describe** goal, Query asks whether the current evidence directly establishes the requested behavior or flow.

For every active goal, Query receives the immutable hard and optional constraints that were created during goal decomposition. Query only scores those existing constraints against the current function or region. It cannot add, remove, rewrite, or substitute constraints based on whatever implementation mechanism it happens to encounter.

The fixed checklist produces a candidate-fit score separate from navigation and goal sufficiency. A clearly failed hard constraint forces candidate fit below 0.5. A candidate fit of 0.5 or greater keeps the current function as a live candidate: Query verifies it with source or a materially necessary semantic continuation before considering weaker sibling/frontier branches. After source verification, a candidate may not remain indefinitely ambiguous. If no further continuation is needed, it must either satisfy the goal or fall below the candidate-fit threshold.

For a **causal** goal, the derived hard constraints normally encode the conditions needed for the observed code to actually produce the reported behavior. When multiple mechanisms look superficially relevant, each is therefore tested against those request-derived constraints rather than a fixed causal template.

For a **change** goal, Query distinguishes current implementation from proposed implementation and establishes how the requested change applies to existing code. A proposed API or mechanism does not need to already exist in the selected revision.

For a **verify** goal, Query requires direct evidence for the stated constraint, compatibility condition, side effect or consequence.

Dependencies are respected. A dependent goal is not resolved merely because a plausible interpretation exists; its prerequisite goals must already be resolved or be resolved by the same evidence.

## Query is an evidence chase, not a fixed execution plan

The goal ledger defines evidence obligations, not a predetermined sequence of code steps.

The initial evidence is limited, so an upfront traversal plan would still be a guess beyond what LeMap has actually seen. Query therefore keeps the goals stable while choosing both the next schedulable goal and the next code branch incrementally from available evidence.

There is no requirement that different goals share an entry point, source file, call path, or traversal stack.

Query also maintains a rolling evidence-backed summary per goal thread, while the evidence ledger remains shared across the whole request.

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

The ledger contains facts that have been established from learned semantic evidence. Every fact records the goal that produced it and that goal's reasoning kind.

A goal sees its own facts plus facts from its prerequisite goals. Facts from unrelated goals are hidden from that thread. Prerequisite facts provide context but do not themselves resolve the active goal.

Locate goals are deliberately narrow: they publish only a deterministic location/context fact identifying the existing implementation. Free-form behavioral or causal claims produced while resolving a locate goal are not admitted to the shared ledger.

Model fact additions are accepted only as plain strings. Arrays, objects, or model-returned ledger-shaped tuples are rejected rather than stringified into evidence.

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

At every meaningful code position, Query asks which unresolved evidence obligations the current evidence can resolve.

```text
current goals
+ cumulative supported facts
+ traversed path
+ current semantic node
+ semantic navigation candidates
+ exact source only when explicitly requested
        ↓
score active-goal evidence sufficiency
        ↓
all material goals resolved?
```

If all material goals are resolved, exploration stops immediately.

If some goals remain unresolved, Query ranks only continuations likely to resolve those remaining obligations. It does not continue merely because child calls exist.

If no useful continuation exists at the current position, LeMap backtracks to a preserved alternative. If the current entry flow is exhausted, LeMap reseeds from another entry candidate.

The model may suggest completion, but LeMap's authoritative stop condition is the goal ledger: every material goal must have evidence-bound resolution.

## Responsibility split

LeMap internally keeps:

```text
goal scheduler
per-goal entry-selection state
per-goal active structural node / region
per-goal DFS path
per-goal visited nodes
per-goal alternative branches
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
  "h": "current evidence-backed summary",
  "z": ["G1"],
  "a": ["new established fact"],
  "d": ["F1"],
  "r": ["F2"],
  "p": [[0, 0.9]]
}
```

Where:

- `z` contains goal IDs directly resolved by the current evidence.
- `h` summarizes resolved goals and the unresolved remainder without inventing evidence.
- `a` adds newly established facts as plain sentences. LeMap binds them deterministically to the current semantic window.
- `d` marks previously established fact IDs as disputed.
- `r` re-supports disputed facts when later evidence establishes them again.
- `p` contains at most three continuations worth exploring next.
- `x` is a model-side completion signal, but LeMap does not trust it by itself. LeMap stops only when the evidence-bound goal ledger shows that all material goals are resolved.

Goal resolution is also evidence-bound. A model-returned goal ID is accepted only while inspecting an actual current function/window with supporting states.

Candidates omitted from `p` are not selected. There is no absolute navigation-score cutoff. If the model returns ranked candidates, LeMap follows the strongest one and preserves the remaining returned candidates as alternatives. If the model returns no candidate, LeMap backtracks or advances to the next entry batch.

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

## Entry comparison is navigation only

Entry comparison has a deliberately narrower responsibility than Query reasoning.

```text
faceted structural search
→ candidate entry functions
→ compare learned entry windows
→ choose which code to inspect
```

At this stage there is no current raw function body. The model may rank candidates, but it must not:

- resolve evidence goals
- add facts
- form a causal mechanism
- conclude how a requested change works
- verify a constraint
- carry an answer hypothesis into traversal

This prevents a speculative interpretation formed while merely comparing candidate entries from becoming the starting assumption for later reasoning.

Once LeMap enters the selected function, the model receives the current raw body and learned semantic window. Only then may goals be resolved and facts enter the evidence ledger.

For a scheduled locate goal, the thread closes as soon as the current function body directly identifies the requested implementation. It does not descend further merely because later causal or change goals remain unresolved.

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
13. Query decomposes the stable original request into a small set of typed evidence obligations rather than forcing the whole request into one mode.
14. Evidence goals may be locate, describe, causal, change or verify and may declare dependencies on other goals.
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
40. Entry comparison is navigation-only: it ranks candidate code but cannot resolve goals, add facts or seed a causal/change/verification hypothesis.
41. Goal resolution occurs only while inspecting evidence-bound current code, never from entry comparison alone.
42. LeMap stops only when every material evidence goal is resolved; the model's completion bit alone is not authoritative.
43. Causal goals must explain the distinguishing reported condition rather than merely match issue terminology.
44. Change goals do not require a proposed replacement API, configuration value or mechanism to already exist in the selected repository revision.
45. Goal dependencies are preserved so a later obligation cannot be treated as established before its prerequisite evidence is established.
46. The goal ledger is query-local and stable; traversal remains evidence-driven and may backtrack or reseed without rewriting the original obligations.
47. Every goal has its own faceted-search and traversal state, so structurally unrelated goals can investigate different parts of the repository independently.
48. Learned semantics and the evidence ledger are shared across goal threads, so repeated code is not relearned and established evidence can inform later goals.
49. Goal dependencies constrain scheduling, not code-space locality; dependent goals may start a new faceted search after their prerequisites resolve.
50. Exhausting one goal thread does not force unrelated goals to share its fallback roots or traversal path.
51. Zero-confidence continuations are never traversed.
52. When structured search returns concrete entries for a goal, that goal thread stays bounded to those entries instead of falling through to generic repository roots.
53. Locate goals stop at the first current function whose evidence directly identifies the requested implementation.
54. Every query-local fact carries source-goal provenance and goal kind.
55. A goal sees only its own facts and facts produced by its prerequisite goals; unrelated goal facts cannot bias its reasoning.
56. Locate goals export deterministic location context only, not free-form behavioral or causal interpretations.
57. Model fact additions must be plain strings; ledger-shaped arrays or objects are rejected.
58. Causal goals compare competing mechanisms visible in the current function against the reported distinguishing condition before leaving that function.
59. A locate goal exists only when code location is itself an explicit requested outcome, never merely as an internal prerequisite of another investigation.
60. Goal decomposition is lossless: all material conditions and requested outcomes from the original issue must remain represented across the goal dependency graph.
61. A dependent goal consumes prerequisite evidence, and the complete dependency chain must collectively cover the original request without dropping discriminating conditions.
62. When a function is actively inspected, its existing AST statement regions are materialized into the semantic graph and learned with their exact source ranges and code.
63. Query receives region code and region semantics together so structural and semantic evidence stay aligned.
64. Region learning is lazy: entry-candidate comparison stays cheap, and function-body regions are expanded only for the selected current function.
65. A selected function's direct AST statement regions are traversed before Query may descend into callees or backtrack to another entry.
66. Region traversal evaluates evidence against the active goal in source order and stops immediately when the accumulated function-body evidence resolves that goal.
67. Call-graph branching is permitted only after the selected function's relevant semantic body space has been exhausted without resolving the active goal.
68. Query traversal is semantic-first: functions, regions and branches are navigation candidates scored from learned semantics, not from raw source.
69. Navigation relevance and goal satisfaction are separate scores. A navigation score chooses the next semantic node. An active-goal score of 1.0 means the current function/region/body is sufficient to answer the goal; the controller closes at 0.9 or above to prevent a well-supported answer from wandering merely because the model is slightly conservative.
70. Raw source is exposed to Query only during structural entry matching or after Query explicitly requests source inspection for the current semantic node.
71. Learn may read source to construct missing query-independent semantics; this is semantic expansion, not Query source traversal.
72. Final evidence localization reuses structural ranges already attached to semantic evidence and does not reopen source merely to produce locations.
73. Learn is frontier-lazy: selecting a function learns only that function and its direct semantic body frontier.
74. Selecting a region learns only that region's direct semantic children.
75. Called-function semantics are learned only after the current function's relevant body frontier has been exhausted, and only for the immediate call frontier needed for the next decision.
76. Query never pays upfront to semantically expand an entire multi-level call tree or all nested regions.
77. A semantic decision may return only the highest-scoring continuations, but the parent retains the complete exposed frontier.
78. After returned continuations are exhausted, Query revisits the parent and rescans only the still-unvisited semantic frontier before leaving that parent.
79. A frontier is abandoned only when it has no unvisited candidates or Query scores every supplied continuation as non-useful; unreturned candidates are never silently discarded.
80. If the current function, region, or inspected source body is already sufficient for the active goal, that goal closes immediately and no sibling region, callee, or alternate entry is explored for that goal.
81. Functions of 50 lines or fewer are learned and queried as one coherent semantic unit; Query does not fragment them into statement regions.
82. Functions longer than 50 lines may be traversed by regions, but the rolling hypothesis and supported facts from earlier chunks are carried into later chunks so the function's logic remains coherent across the walk.
83. Query uses three independent signals for every goal kind: navigation score chooses where to search, candidate-fit score determines whether the current function remains a plausible match for the active goal's hard constraints, and goal-sufficiency score determines whether enough evidence exists to answer.
84. A candidate with fit at least 0.5 is verified before lower-ranked sibling/frontier alternatives are explored. If verification still leaves it unresolved without a useful continuation, the thread stops explicitly rather than wandering away from a plausible candidate.
85. Hard and optional constraints are derived once during goal decomposition from the original request and then frozen for the life of the goal. Query may update only their scores, never their content.
