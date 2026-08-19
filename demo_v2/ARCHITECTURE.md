# DataSong v2 semantic exploration architecture

## Objective

DataSong reconstructs end-to-end business use cases from heterogeneous enterprise evidence.

A business-use-case arc is one coherent actor goal with a recognizable completion condition and business/user outcome. Technical structure, UI hierarchy and broad functional areas are evidence, not automatically business flows.

---

# Two parallel routes into one Pass-1 arc board

```text
ROUTE A — semantic discovery

Scout
  ↓
Discovery
  ↓ qualified concrete actor goals
  ┐
  ├────────────→ Pass 1 → Pass 2
  ┘

ROUTE B — deterministic executable-path discovery

Repository
  ↓
Executable graph
  ↓
Branch/cycle-aware call paths
  ↓
Longest grouped paths
  ↓
LLM business/boundary classification
  ↓
Deterministic clipping + containment
  ↓ maximal coherent business-flow seeds
  ┘
```

The two routes are independent until Pass 1.

Call-path evidence is **not mixed into Discovery's next-level candidates**.

---

# Route A — Scout and Discovery

Scout asks whether DataSong is missing a materially different business-use-case direction.

Discovery then tests a promising entrance shallowly until it exposes one concrete actor goal.

A Discovery start qualifies when the returned evidence supports:

```text
isConcreteBusinessUseCase = true
businessActor
businessIntent
completionCondition
businessOutcome
```

DataSong derives qualification mechanically from these fields. The model does not need to set a second redundant qualification boolean.

Qualified starts are frozen in Discovery and promoted into Pass 1.

---

# Route B — deterministic executable-path preprocessing

The call-path preprocessor does not ask the model to roam through source files.

It first constructs executable topology deterministically:

```text
repository
→ executable nodes
→ executable edges
→ paths
→ compressed shared structure
→ grouped longest paths
```

## Executable nodes

The path indexer uses one abstraction regardless of source format:

```text
ExecutableNode {
  id
  signature
  provenance
  outgoingEdges[]
}
```

Ordinary code parsers produce function/method nodes.

Structured formats use dialect-specific deterministic adapters. XML itself has no universal execution semantics.

Current example:

```text
Moqui XML adapter
```

Future adapters may cover BPMN, Spring XML, packaged application workflow formats, etc.

---

# Moqui XML adapter

The current Moqui adapter recognizes executable elements such as:

```text
screen
transition
transition-include
actions
service-call
entity-find / entity-one / entity-find-count
entity-create / entity-update / entity-delete
if / condition / else / iterate
set / script
default-response / conditional-response / error-response
subscreens-item
```

These become executable graph nodes/edges alongside ordinary code functions.

Cross-screen navigation is followed only when the target is resolved deterministically inside the supplied repository.

External service/library implementations are never assumed.

```text
inside supplied repo  → follow
outside supplied repo → terminate as EXTERNAL
```

---

# Path representation

Branches are separate executable paths mechanically, while repeated structure is compressed through references.

```text
P0: A → B → C
P1: REF(P0) → D → E
P2: REF(P0) → F → G
```

Cycles terminate through references rather than infinite expansion.

```text
P7: X → Y → Z → REF(P7)
```

The LLM never sees this compressed storage directly. Selected paths are reconstructed into signatures before classification.

---

# Longest-path heuristic

Initial ranking remains deliberately simple:

```text
effective executable node count
```

Long orchestration paths are surfaced first because they often correspond to business workflows, while helpers are usually short.

This is only a heuristic; the model may still classify a long path as technical or uncertain.

---

# Branch grouping

Raw traversal can produce many near-identical branch variants.

Before taking the top N, DataSong groups heavily overlapping variants and sends one representative path plus compact branch summaries.

```text
representative rendered path
branchVariantCount
small divergent tails
terminal kinds
```

This avoids wasting top-N slots and prompt tokens on repeated variants.

---

# Edge semantics and semantic boundaries

Rendered paths retain structural edge type:

```text
CALL
NEXT
TRIGGER
NAVIGATE
EXTERNAL CALL
```

`CALL`, `NEXT` and `TRIGGER` normally preserve execution continuity.

`NAVIGATE` is weaker semantic continuity. It may continue the same business flow:

```text
Checkout → Review → Place Order
```

or cross into another actor goal:

```text
Change Password → Login → Cart Recovery
```

The model has only one boundary job:

> identify the coherent business segment and the last signature belonging to it.

For example:

```text
Change Password
→ update Password
→ NAVIGATE Login
```

may return:

```text
flowTitle = Change Password
coherentThroughSignature = update Password
```

The model does **not** decide parent/subflow relationships between paths.

---

# Deterministic containment after clipping

After model classification, DataSong clips each business path at `coherentThroughSignature`.

Then containment is calculated mechanically on the clipped signature sequences.

Example:

```text
A: Search
B: Search → Add to Cart
C: Search → Add to Cart → Update Cart
```

DataSong can prove:

```text
A ⊂ B ⊂ C
```

No LLM judgment is needed for this.

Only maximal coherent business segments seed Pass 1.

Contained paths remain attached as supporting evidence:

```text
C seeds Pass 1
B attached to C
A attached to C/B as contained evidence
```

If two clipped paths are not structurally contained, they remain independent even when navigation connects them.

This prevents mistakes such as treating:

```text
Place Order
→ NAVIGATE
View Order Detail
```

as a parent/subflow relationship merely because the paths are adjacent.

---

# Call-path LLM contract

For each grouped top path the model returns only:

```text
classification: business_flow | technical | uncertain
confidence
flowTitle
businessActor
businessIntent
completionCondition
businessOutcome
semanticBoundaryAt
coherentThroughSignature
reason
```

The model does **not** compare paths and does **not** return broader/subflow/alternate relationships.

DataSong owns structural containment deterministically.

---

# Transition into Pass 1

Qualified arcs may come from either route:

```text
Discovery-qualified actor goal
        ↓
Pass-1 arc

Maximal coherent call-path flow
        ↓
Pass-1 arc
```

Each arc preserves its discovery provenance.

From Pass 1 onward, both routes use the same detailed exploration machinery.

---

# Pass 1

Pass 1 is the scheduler across qualified business arcs.

It maintains stable arc identity, actor/intent, progress, evidence and outcome, and decides which qualified arc receives the next exploration turn.

---

# Pass 2

Pass 2 reconstructs one selected business use case in detail using independent DFS state per arc.

```text
dfsStateByArc = {
  arc-1: { stack, frontier, visited, branches, ... },
  arc-2: { stack, frontier, visited, branches, ... }
}
```

Pass 2 follows the strongest semantic continuation, preserves alternatives, backtracks within the arc, and uses arc-anchored semantic search when local topology is exhausted.

---

# Responsibility split

```text
MODEL — Scout
find globally novel business-use-case directions

MODEL — Discovery
identify concrete actor goal, intent, completion and outcome

DATASONG — Discovery
enforce qualification, isolate starts, freeze qualified starts

DATASONG — Call-path preprocessing
build executable graph
apply code/XML dialect adapters
compress cycles/shared paths
rank longest paths
group branch variants

MODEL — Call-path classifier
business vs technical vs uncertain
identify semantic boundary
name/describe coherent business segment

DATASONG — after classifier
clip at coherent boundary
calculate path containment exactly
seed only maximal coherent business paths
attach contained paths as evidence

PASS 1
schedule qualified arcs

PASS 2
reconstruct selected arc end to end
```

The governing rule is:

> **Use the model only for semantics. Use deterministic structure wherever the graph can prove the relationship.**
