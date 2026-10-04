# Code Learn and Query

This document defines the code-semantic Learn / Query contract used by the code semantic profile and Query v5.

The governing split is:

> Learn builds reusable query-independent semantic understanding. Query follows that evidence until it explains the issue.

## Learn

Learn never receives the user issue, query hypothesis, relevance criteria or desired answer.

Learn is frontier-lazy. It builds only the semantics needed for the current search decision and bounded navigation lookahead. Functions of 50 lines or fewer remain coherent semantic units; statement regions are used as a chunking mechanism only for functions longer than 50 lines.

```text
current visited node
        ↓
learn / reuse its semantics
        ↓
materialize semantic frontier up to 3 levels
        ↓
Query estimates branch trajectory
        ↓
move only one level
        ↓
update the evidence-backed hypothesis
        ↓
repeat
```

The three-level window is a lookahead horizon, not three committed traversal steps. Query may inspect those unvisited semantics only to estimate navigation potential. They do not become evidence and may not change the hypothesis until LeMap actually moves to the node.

The structural graph remains authoritative for symbol identity, source coordinates, calls, containment, branches and traversal.

For Python, the analyzer already emits statement-level regions inside each function. When a function becomes the current investigation root, Learn now materializes those existing AST regions into the semantic graph and annotates them with query-independent semantics. The semantic graph therefore mirrors the function's structural body instead of reducing it to only function-level summaries and call edges.

Each learned region keeps the same structural identity and source range as the analyzer region. Learn may use the region's raw code to create query-independent semantics, but Query normally receives only the learned purpose/effect plus structural identity. Source is fetched only for structural entry matching or an explicit source-inspection action requested by Query.

This expansion is lazy. Entry-candidate comparison does not learn every candidate's body regions. Regions are expanded only after a candidate becomes the current function, and called functions receive their regions when they later become the current root.

Once a function is selected for active investigation, Query searches its semantic region hierarchy before branching into called functions or abandoning that entry candidate. Direct regions are immediate navigation candidates; nested regions and calls may appear in the bounded lookahead used to estimate whether a branch is strengthening, flattening, or weakening. Query still advances only one semantic hop at a time.

Navigation potential and hypothesis match are separate. Navigation asks "which immediate branch is most likely to improve the current hypothesis, especially on unresolved hard constraints?" Hypothesis match asks "how well does the accumulated evidence-backed explanation satisfy the active goal's fixed acceptance criteria?" If semantics are material but insufficient, Query may explicitly request the current node's exact source range as verification evidence.

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

For a function of 50 lines or fewer, the function itself is the semantic unit. For a function longer than 50 lines, regions are chunking units whose assessments feed one continuous function/thread hypothesis. Around the current visited node, Learn may expose up to three semantic levels of regions and/or calls for lookahead. When Query chooses a direction it advances only to the immediate child, then updates the hypothesis from that newly visited evidence.

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

For every active goal, Query receives the immutable hard and optional constraints that were created during goal decomposition. The thing scored against those constraints is the accumulated evidence-backed hypothesis, not the current function in isolation. A function, region, configuration node, or external boundary is evidence that may strengthen, leave unchanged, weaken, or revise that hypothesis.

The hard-constraint scores are the authoritative convergence state. When every hard constraint reaches the evidence threshold, the goal closes. Optional constraints improve confidence but never block completion.

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
goal + fixed acceptance constraints
  ↓
faceted entry search
  ↓
visited semantic evidence
  ↓
update accumulated hypothesis
  ↓
score hypothesis against constraints
  ↓
3-level semantic lookahead
  ↓
estimate branch trajectory / unresolved-constraint coverage
  ↓
move one level
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

## Convergence, progress and stop condition

After every visited node, Query updates the accumulated hypothesis and scores that hypothesis against the active goal's fixed hard and optional constraints.

```text
previous hypothesis score
        ↓
visit one semantic node
        ↓
update hypothesis from visited evidence
        ↓
rescore fixed constraints
        ↓
strengthening / flat / weakening
```

A score increase greater than the progress tolerance is strengthening. Little change is flat. A decrease is weakening. Flat exploration is tolerated only briefly, unless lookahead indicates that the branch can address an unresolved hard constraint.

The semantic lookahead gives each immediate branch an expected hypothesis score plus the unresolved constraints it appears capable of improving. LeMap compares that potential with the best hypothesis already reached on the goal thread. A branch is worth exploring when it can plausibly beat the best score or resolve an unmet hard constraint.

Entry-level branches are also scored independently. Each selected entry keeps its own current and best hypothesis score. After an entry has consumed the current node semantics and any source inspection it explicitly requested, LeMap compares that branch's current score with the best score already established by other entry branches. If it falls below an existing entry score, LeMap abandons that entry branch instead of spending more traversal on its regions or callees. This comparison is independent of whether the incumbent entry has fully resolved the goal.

Backtracking preserves the best hypothesis, its constraint scores and evidence. Trying a sibling restores the hypothesis state from the branch point; evidence from the abandoned sibling is not silently carried into the new branch.

Entry-level causal branches are isolated more strictly. Each entry owns its causal hypothesis and any causal-goal ledger facts produced while exploring that entry. Those facts are visible only while that same entry branch is active. Direct observations from non-causal goals may remain global, but a causal interpretation from Entry A must never become starting evidence for Entry B. If Entry A fails counterfactual validation, its causal branch facts are marked disputed before LeMap moves on.

A goal closes when all of its hard constraints are sufficiently established by the accumulated evidence-backed hypothesis. When exact source was needed to settle the goal, closure additionally requires an evidence-grounding pass over the selected source ranges. The grounding pass may only judge the supplied hypothesis and evidence; it cannot repair the hypothesis or search for a better mechanism. Controller scores are capped by those groundedness scores, so unsupported high model scores cannot close the goal.

Best-so-far and resolved are deliberately different states. A hypothesis may remain the strongest explanation found even when one hard criterion is below threshold. If all useful branches are exhausted in that state, Query stops as `best_so_far_exhausted`, preserves that hypothesis, its fixed-constraint scores and supporting evidence, and reports the goal as unresolved. It must never promote the best available hypothesis into a solved goal merely because every alternative scored worse.

Once every material goal is genuinely resolved, exploration stops immediately.

## Query progress UI

The Query UI exposes the convergence state directly instead of showing only raw exploration events. During a code query it shows the active goal, current accumulated hypothesis, hypothesis match, each hard and optional constraint with its score, current semantic path, semantic-lookahead branch potentials, strengthening/flat/weakening trend, best score reached, and cumulative prompt/completion/total tokens.

This makes search quality observable. A healthy exploration should visibly move the hypothesis toward unresolved hard constraints; flattening or weakening should correspond to pruning/backtracking rather than continued token consumption.

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

Before traversal starts, the model may receive candidate entry semantics and returns entry navigation scores only. After an entry is visited, the model receives the current evidence-backed hypothesis, fixed goal constraints, the visited semantic node, immediate candidates and bounded semantic lookahead. Lookahead is navigation-only and must never be promoted into evidence before traversal.

Entry selection returns only candidate entry navigation rows:

```json
{"h":"","gs":[],"ck":[],"hs":0.0,"a":[],"d":[],"r":[],"i":0,"p":[[0,0.85]]}
```

After LeMap enters the chosen entry, a semantic decision returns the updated hypothesis, fixed-constraint scores, an overall hypothesis-match diagnostic, optional source-inspection request, and at most three immediate branches:

```json
{
  "h": "updated evidence-backed hypothesis",
  "gs": [["G1", 0.8]],
  "ck": [[0, 1.0], [1, 0.6]],
  "hs": 0.8,
  "a": ["new established fact"],
  "d": [],
  "r": [],
  "i": 0,
  "p": [[0, 0.9, [1]]]
}
```

The ck field scores immutable goal constraints by index. The hs field is the model's overall hypothesis-match diagnostic; LeMap also derives progress from hard-constraint scores. Each p row means "move to this immediate candidate; semantic lookahead suggests the hypothesis may reach this expected score, and these unresolved constraints may improve." LeMap moves only one hop even though the model can see deeper semantics.


When exact source is supplied, Query switches from hypothesis extension to source diagnosis. The previous hypothesis is treated only as a candidate explanation, not as something to confirm. Query must classify the source result as `confirm`, `revise`, or `reject`, re-derive the best explanation from the supplied source plus established facts, and only then select supporting evidence and score the fixed constraints.

For causal goals, source diagnosis must account for the issue's distinguishing behavior: the operation involved, what differs in the failing case, why that difference changes behavior, and how the changed behavior produces the symptom. Related code is not sufficient by itself.

When exact source is supplied for the current visited node, LeMap first assigns stable evidence indexes to the non-empty source lines and sends those indexed source candidates to Query:

```json
"src": {
  "lines": [
    [2, "fixture_dirs = settings.FIXTURE_DIRS"],
    [13, "app_dir = os.path.join(app_config.path, \"fixtures\")"],
    [14, "if app_dir in fixture_dirs:"]
  ]
}
```

Query selects evidence by those indexes rather than inventing source coordinates:

```json
"ev": [
  [2, [0], "Reads the configured fixture directories."],
  [13, [1, 2], "Builds the app fixture directory."],
  [14, [1, 2], "Tests that directory against the configured entries."]
]
```

LeMap deterministically maps each selected evidence index back to the exact repository line number. The model therefore decides semantic relevance while LeMap owns structural identity and source coordinates.

The evidence set is not a ranking of individual lines. Several selected candidates may jointly establish one hypothesis, and one candidate may support several fixed constraints. Query selects the smallest combined set that materially supports the updated hypothesis and advances unresolved acceptance criteria.

If the selected evidence still covers 80% or more of an inspected function of at least 8 lines, LeMap treats that selection as suspiciously broad and performs one dedicated evidence-reselection pass over the same indexed candidates. That pass receives the same hypothesis, fixed criteria and rejected selection. It may only tighten the selected evidence indexes; it cannot change the hypothesis or search elsewhere.

After source inspection, LeMap performs a separate evidence-grounding decision. It receives only the goal, immutable acceptance criteria, proposed final hypothesis, and selected exact source ranges. It scores whether those ranges actually establish each criterion. These groundedness scores cap the search model's constraint scores. If source was inspected but no supporting ranges are selected, the source-grounded constraint scores are zero and the goal cannot close from that inspection.

For causal goals, source grounding is still not the final stop condition. LeMap runs a counterfactual intervention check in either of two cases: when all hard constraints would otherwise close, or when a source-grounded causal hypothesis is the current best candidate and no supplied continuation appears capable of improving it before that branch is abandoned or exhausted.

Counterfactual validation first derives one immutable `failingCase` from only the original request plus the fixed goal text and acceptance criteria. That testcase may not be weakened, broadened, substituted, normalized, or changed to make the proposed diagnosis succeed. The validator must compare the same case before and after the hypothetical patch. A separate prompt derives the smallest code change implied by the diagnosis and predicts whether that intervention would fix the exact reported failing condition. The intervention must change the operation claimed to be causal rather than an unrelated workaround.

A successful counterfactual may strengthen only the fixed acceptance criteria that the independent intervention validator says the repair itself establishes. If those strengthened hard scores all reach the close threshold, the causal goal may resolve. If validation fails, that hypothesis is marked causally rejected, is removed from best-so-far eligibility, the branch is abandoned, and the failure reason is preserved and surfaced explicitly. Search then continues to another branch when available.

The local-source rule is:

```text
visited function semantics
        ↓
request exact source only if needed
        ↓
treat previous hypothesis as provisional
        ↓
inspect the whole supplied body
        ↓
confirm / revise / reject the hypothesis
        ↓
select materially useful indexed source candidates
        ↓
LeMap maps selected candidates to exact source lines
        ↓
link selected evidence to the constraints it supports
        ↓
update / revise accumulated hypothesis
        ↓
independent evidence-grounding check
        ↓
cap constraint scores by groundedness
        ↓
all hard constraints met?
    no  → navigate only if remaining local source cannot materially help
    yes
      ↓
causal goal?
    no  → stop
    yes → derive minimal counterfactual repair
          ↓
        does the repair fix the exact reported condition for the claimed reason?
          yes → stop
          no  → record validation failure and continue search
```

This prevents Query from forcing a single "winning line" when several operations together explain the goal. It also prevents leaving a coherent function before the already supplied source has been used as fully as necessary.

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
Learn current region + next 3 semantic levels
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

Before Learn expands any candidate by three semantic levels, LeMap performs one cheap source-only triage over the matched rows. This prevents a 10-20 row structural match set from triggering semantic Learn across every candidate.

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
- exact matched source from structural matching
- normal three-level semantic lookahead

The current function body is not automatically exposed as Query evidence. Query requests exact source explicitly when semantics are insufficient to settle an unresolved hard constraint.

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

## Entry selection starts the evidence path

Faceted structural search proposes candidate entry functions or boundaries. The model uses their reusable semantics only to choose where the evidence path should begin.

```text
faceted structural search
→ candidate entry functions
→ entry navigation score
→ choose one entry
→ enter it
→ its semantics become the first visited evidence
→ form / update hypothesis
```

Before an entry is visited, the model may rank candidates but must not form a hypothesis, score acceptance criteria, add facts, request source, or conclude the issue. Entry scores answer only:

> Which candidate is the most promising place to begin investigating this goal?

The moment LeMap enters the selected function or boundary, it is no longer merely an entry candidate. It is the first node on the chosen semantic path. Its visited semantics may create or revise the hypothesis, contribute evidence, and be scored against the fixed goal constraints. Exact source is added only through explicit source inspection.

This means the hypothesis traces the path actually taken. Entry selection chooses the first step; hypothesis reasoning begins with the first visited entry.

For a scheduled locate goal, the thread closes as soon as the visited evidence identifies the requested implementation. It does not descend further merely because later causal or change goals remain unresolved.

## Branch exploration

At each visited semantic position LeMap prepares a bounded lookahead horizon, but commits to only one immediate step:

```text
current visited node
        ↓
update hypothesis from current evidence
        ↓
score hypothesis against fixed constraints
        ↓
Learn / reuse up to 3 semantic levels for navigation lookahead
        ↓
estimate each immediate branch's expected hypothesis match
and which unresolved constraints it can improve
        ↓
move one level
        ↓
repeat
```

Lookahead semantics are not evidence. They may influence branch choice, but they cannot update the hypothesis until the corresponding node is actually visited. This creates receding-horizon semantic search rather than a three-step commitment.

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

## Current implementation status

The current Query v5 implementation now follows the hypothesis-driven semantic-search architecture below.

| Area | Target architecture | Current implementation | Status |
|---|---|---|---|
| Issue to goals | Break the issue into the smallest useful set of dependent goals. | Goal decomposition supports locate, describe, causal, change and verify goals with dependencies. | Implemented |
| Acceptance criteria | Each goal gets fixed hard and optional constraints before code exploration. | hardConstraints and optionalConstraints are created during decomposition and remain immutable. | Implemented |
| Localization | Every substantive goal locates relevant implementation evidence as part of solving itself. | Faceted structural search runs per goal. A separate locate goal is used only when location itself is requested. | Implemented |
| Entry search | Structural search should find plausible starting code without solving the issue. | Faceted search and source-only entry triage select candidate functions. Entry comparison cannot resolve goals or seed a hypothesis. | Implemented |
| Learn and Query split | Learn remains reusable and query-independent. Query performs issue-specific reasoning. | Learn stores purpose/effect semantics without seeing the issue. Query consumes those semantics. | Implemented |
| Function granularity | Normal functions stay coherent; only large functions are chunked. | Functions up to 50 lines are one semantic unit; larger functions may expose AST regions. | Implemented |
| Large-function coherence | Region chunks contribute to one continuous explanation. | Rolling hypothesis and score are carried across region traversal. | Implemented |
| Hypothesis | Maintain one evolving evidence-backed explanation per active goal. | Each goal thread stores and updates a rolling hypothesis from visited evidence. | Implemented |
| Hypothesis scoring | Score the accumulated hypothesis, not the current function, against fixed constraints. | Constraint scores are now produced for the updated accumulated hypothesis. | Implemented |
| Hard-constraint convergence | Goal completion is determined by hard acceptance criteria. | A goal closes when every hard constraint reaches the convergence threshold. | Implemented |
| Optional constraints | Optional criteria strengthen confidence but do not block completion. | Optional constraint scores are displayed and retained but are not part of the hard stop condition. | Implemented |
| Navigation | Choose the next hop by expected improvement to the current hypothesis. | Navigation candidates return an expected hypothesis match plus unresolved constraints they may improve. | Implemented |
| Three-level lookahead | Peek several semantic levels ahead, but move only one hop at a time. | Query may see up to three semantic levels of bounded lookahead while traversal advances one immediate node. | Implemented |
| Lookahead grounding | Unvisited lookahead may guide navigation but must not become evidence. | Prompt contract explicitly prevents lookahead nodes from updating the hypothesis before traversal. | Implemented |
| Lookahead breadth | Prevent bounded-depth lookahead from exploding in cost. | Semantic lookahead is capped at 48 nodes. | Implemented |
| Progress classification | Detect strengthening, flat and weakening search trajectories. | Hypothesis score deltas are classified after each visited node. | Implemented |
| Strengthening | Continue when visited evidence improves acceptance-criteria coverage. | Improving branches remain eligible for descent. | Implemented |
| Flattening | Tolerate little or no gain briefly only when a branch can still address an unresolved hard constraint. | Flat progress is bounded to two steps. | Implemented |
| Weakening | Backtrack earlier when evidence moves the hypothesis away from the goal. | Weakening prevents the flat-progress exception and drives backtracking. | Implemented |
| Best-so-far memory | Preserve the strongest explanation reached during the goal search without confusing it with proof. | Threads keep bestHypothesis, bestScore, best constraint checklist and supporting evidence. If search exhausts before all hard constraints pass, the result is explicitly best-so-far/unresolved. | Implemented |
| Backtracking state | A sibling branch must start from the branch-point hypothesis, not from the abandoned sibling's interpretation. | Frames store baseHypothesis/baseScore and restore them on sibling traversal. | Implemented |
| Evidence memory | Preserve reusable observations without leaking one entry's causal interpretation into another. | Non-causal evidence may remain cumulative. Facts produced by causal goals are tagged with the active entry branch and are visible only to that branch; failed counterfactual validation disputes those branch-local causal facts before search continues. | Implemented |
| Alternate-branch pruning | Do not explore semantic branches that cannot improve the best explanation or resolve an unmet hard constraint. | Semantic branch filtering compares expected score with bestScore and targeted unresolved constraints. | Implemented |
| Entry-branch competition | Avoid wandering through weaker entry candidates once a stronger entry branch is already established. | Every entry keeps current and best hypothesis scores. After its current node and requested source inspection, an entry whose score falls below another entry's established best is abandoned before deeper traversal. | Implemented |
| Source inspection | Raw source is verification evidence, not the normal traversal substrate. | Query requests source explicitly only when semantics are insufficient to settle an unresolved hard constraint. | Implemented |
| Combined local evidence | Several lines or regions in one function may jointly support the hypothesis; no single-line ranking is required. | When source is inspected, Query selects a bounded evidence set of exact ranges, links them to fixed constraints, updates the hypothesis from the combined set, and only navigates away if unresolved constraints cannot be materially improved from the remaining supplied source. | Implemented |
| Source diagnosis | Exact source should challenge an earlier hypothesis rather than merely confirm it. | When source is present, Query explicitly confirms, revises or rejects the previous hypothesis and re-derives the mechanism before selecting evidence or scoring constraints. Causal goals must explain the distinguishing behavior. | Implemented |
| Evidence grounding | High constraint scores must be supported by the selected exact source rather than by related-code proximity. | A separate verifier scores each fixed criterion from only the proposed hypothesis and selected ranges; controller scores are capped by verifier groundedness before closure. | Implemented |
| Evidence tightness | Whole-function source remains available for reasoning, but supporting evidence should exclude lines that do not materially support the hypothesis. | LeMap indexes source lines, Query selects only evidence indexes, and LeMap deterministically assigns exact repository coordinates. Evidence covering at least 80% of a function of 8+ lines triggers one evidence-only re-selection pass. | Implemented |
| Counterfactual causal validation | A causal explanation should predict a successful intervention on the exact reported failing condition before it is accepted or retained as the best exhausted explanation. | Validation first derives an immutable failingCase from only the request and fixed criteria, then compares that same case before and after the smallest patch implied by the diagnosis. It cannot substitute a nearby scenario. A passing intervention may strengthen only criteria it independently establishes; failure causally rejects the hypothesis. | Implemented |
| Final answer synthesis | Search truth and user-facing prose should be separate responsibilities. | After all goals resolve, a dedicated synthesis prompt receives only the original request, fixed criteria, final hypotheses/scores, and exact supporting source ranges. It may explain but not invent or change the established mechanism. | Implemented |
| Final localization | Reuse retained structural coordinates for the final supporting ranges. | Final evidence ranges come from already traversed structural states. | Implemented |
| Query UI | Make convergence visible rather than showing only an event stream. | UI shows active goal, hypothesis, acceptance-criteria scores, current path, branch potentials, trend, best score and token use. | Implemented |
| Token visibility | Show cost while the search is progressing. | Cumulative prompt, completion and total tokens are emitted with Query progress. | Implemented |
| Token efficiency metric | Relate token spend directly to convergence gain. | Tokens and score deltas are visible, but there is no explicit gain-per-1K-tokens metric yet. | Optional improvement |
| Branch history UI | Make abandoned branch quality easy to compare visually. | Backend preserves best state, but the UI does not yet present a branch-history timeline. | Optional improvement |
| Hypothesis version history | Make explicit revisions and contradictions visible over time. | Current controller tracks the latest hypothesis and score trend, not a full hypothesis-version history. | Optional improvement |
| Final multi-goal synthesis | Produce one coherent final explanation across resolved goals. | Goal summaries are currently concatenated. | Optional improvement |
| Benchmark validation | Demonstrate that lookahead reduces wandering, steps and tokens while improving correctness. | The architecture is implemented, but it still needs rerunning on benchmark cases to validate calibration. | Next validation step |

The important operational distinction is:

```text
goal + immutable constraints
        ↓
faceted structural localization
        ↓
visited semantic evidence
        ↓
accumulated hypothesis
        ↓
hypothesis-to-constraint scores
        ↓
bounded semantic lookahead
        ↓
expected improvement / unresolved-constraint coverage
        ↓
move one hop
        ↓
strengthening / flat / weakening
        ↓
continue, prune or backtrack
```

The remaining work is therefore mostly calibration and observability rather than a change in the core search model. The benchmark suite should now be used to verify that lookahead quality, flat-step tolerance, branch pruning and token cost behave as intended.

## Invariants

1. Learn is query-independent.
2. Query reasons over learned semantics rather than repository coordinates.
3. Query has no fixed plan that must be completed.
4. The original issue remains fixed while the hypothesis follows evidence.
5. Query stops as soon as the evidence explains the issue.
6. LeMap keeps structural path, alternatives and source coordinates internally.
7. The semantic window extends lazily by three semantic levels from the selected position.
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
22. The matched source span remains attached as highlighted entry evidence while the enclosing function drives the normal three-level semantic lookahead.
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
34. Structural matches are source-triaged before bounded semantic lookahead expansion, and no more than four structural candidates are expanded initially.
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
62. Functions of 50 lines or fewer are learned and queried as one coherent semantic unit; larger functions may use AST regions as chunking units.
63. Region chunking must preserve one continuous accumulated hypothesis across the function; sibling chunks are not independent explanations.
64. Query traversal is semantic-first: source is used for structural entry matching or explicit verification, not as the default navigation substrate.
65. The current visited node may update the hypothesis; unvisited lookahead nodes may not.
66. Around the current visited node, LeMap may learn or reuse up to three semantic levels of regions and/or calls for navigation lookahead, with a bounded frontier to control token cost.
67. The three-level window is a lookahead horizon only. Query moves one immediate semantic hop, then recomputes the hypothesis and scores.
68. Every substantive repository-grounded goal performs code/evidence localization as part of solving that goal; a separate locate goal is created only when location itself is an explicit requested outcome.
69. Hard and optional acceptance constraints are derived once during goal decomposition from the original request and remain immutable for the life of the goal.
70. The accumulated evidence-backed hypothesis, not the current candidate in isolation, is scored against the fixed goal constraints.
71. Hard-constraint scores are the authoritative convergence state. Optional constraints strengthen confidence but do not block resolution.
72. A goal closes when all of its hard constraints meet the evidence threshold.
73. Navigation scores estimate expected future hypothesis match, not current goal completion.
74. Each navigation candidate may identify unresolved hard constraints that its lookahead appears capable of improving.
75. A branch is worth exploring when its expected trajectory can plausibly improve on the best hypothesis reached so far or resolve an unmet hard constraint.
76. After every visited node, LeMap classifies hypothesis progress as strengthening, flat, or weakening from the score delta.
77. Flat exploration is tolerated only briefly unless the branch still targets an unresolved hard constraint.
78. Weakening evidence should cause hypothesis revision or earlier backtracking rather than continued blind descent.
79. Backtracking preserves the best hypothesis and scores reached on the goal thread.
80. Trying an alternative sibling restores the hypothesis and score from the branch point; evidence from the abandoned sibling must not leak into the new branch hypothesis.
81. Supported evidence facts remain query-local and cumulative even when branch-local hypotheses are rolled back.
82. Source inspection is explicit verification for the current semantic node when semantics are insufficient to settle an unresolved hard constraint.
83. The complete immediate frontier may be preserved, but branches whose expected trajectory cannot beat the best-known hypothesis and cannot resolve an unmet hard constraint may be pruned.
84. Query progress events expose the active goal, hypothesis, constraint scores, current path, branch potentials, strengthening/flat/weakening trend, best score and cumulative token usage.
85. Structural entry search, Learn semantics and Query reasoning remain separate: structure finds plausible code, Learn provides reusable query-independent meaning, and Query searches for an evidence-backed hypothesis that satisfies the goal constraints.
86. Exact source evidence may be a set of multiple disjoint ranges whose combined behavior supports one hypothesis; Query does not need to rank one line above another.
87. When exact source for a coherent visited function is supplied, Query examines the whole supplied body and selects the materially useful evidence set before navigating elsewhere.
88. If that combined evidence makes every hard constraint sufficient, the goal closes immediately and those selected ranges become the supporting source evidence for the hypothesis.
89. When exact source participates in convergence, selected source ranges are independently checked against the fixed criteria; source-grounded scores cap the model's proposed constraint scores.
90. A source-inspected decision with no selected supporting ranges cannot close a goal.
91. Final answer generation is a separate synthesis step over resolved goals, final hypotheses, scores and exact supporting source only; synthesis may improve presentation but cannot introduce a new repository explanation.
92. Best-so-far is not resolution. Search exhaustion with any hard constraint below the close threshold returns an explicit unresolved best-so-far state even when every alternative branch is weaker.
93. An unresolved best-so-far result retains its hypothesis, constraint scores and supporting source evidence so model weakness can fail visibly rather than being converted into a confident answer.
94. Each entry-level branch has an independent current and best hypothesis score.
95. Once an entry has evaluated its current semantic node and any source inspection it requested, a score below another entry branch's established best causes that entry branch to be abandoned before further descent.
96. Entry-branch dominance only prunes search effort; it never converts the stronger entry into a resolved goal unless all hard constraints independently meet the close threshold.
97. Query may reason over the whole inspected function, but the retained evidence set should contain only lines that materially support the hypothesis.
98. An evidence selection covering at least 80% of a function of 8 or more lines triggers one evidence-only re-selection pass; that pass cannot revise the hypothesis or navigate elsewhere.
99. Query selects source evidence by LeMap-assigned evidence indexes, never by invented line numbers.
100. LeMap deterministically maps selected evidence indexes back to repository line coordinates; semantic relevance belongs to the model, structural location belongs to LeMap.
101. A previous rolling hypothesis is provisional whenever exact source is supplied. Source diagnosis must explicitly confirm, revise, or reject it rather than treating it as the default truth.
102. For causal goals, exact-source convergence requires an explanation of the distinguishing behavior in the issue, not merely nearby code related to the symptom.
103. A causal goal cannot resolve merely because every hard criterion reaches the close threshold; it must also pass a counterfactual intervention validation.
104. Counterfactual validation derives the smallest code change implied by the diagnosed mechanism and checks whether that intervention fixes the exact reported failing condition for the claimed reason.
105. If counterfactual validation fails, LeMap preserves and surfaces the failure reason, marks that causal hypothesis rejected, removes it from best-so-far eligibility, abandons its branch, and continues search when alternatives remain.
106. Counterfactual validation also runs for a source-grounded best causal hypothesis when no supplied continuation appears capable of improving it, even if one or more hard constraints remain just below the normal close threshold.
107. A passing counterfactual may strengthen only the immutable criteria that the independent intervention validator explicitly scores as established by the intervention; it cannot rewrite the goal or acceptance criteria.
108. Every entry-level causal branch owns its own hypothesis state and causal-goal ledger facts; those facts are not exposed to sibling entry branches.
109. For causal goals, the model may add only direct observations to the ledger. Causal interpretations and inferred mechanisms remain in the branch hypothesis until validated.
110. When a causal branch fails counterfactual validation, its branch-local causal facts are marked disputed before exploration moves to another entry.
111. Counterfactual validation derives its failingCase only from the original request and immutable goal criteria; it may not alter that testcase to fit the hypothesis or patch.
112. A counterfactual pass is structurally invalid unless one explicit failingCase has both before and after predictions for the same case.
