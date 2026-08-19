# DataSong v2 semantic exploration architecture

## Primary objective

DataSong reconstructs **end-to-end vertical slices of business use cases** from heterogeneous enterprise evidence.

The governing question is:

> What is a business actor, end user, operator, external business participant, scheduler or system trying to accomplish, and how does the enterprise support that intent end to end?

Technical artifacts are evidence. UI structure is evidence. Broad functional areas are evidence. None of those are automatically business flows.

A business-use-case arc is one coherent actor goal with a recognizable completion condition and business/user effect. It is not merely a screen, menu, widget set, navigation hierarchy, application area, or generic management domain.

---

# Two parallel discovery routes into one arc board

DataSong v2 now has two independent ways to propose qualified business-flow seeds. They converge only at Pass 1.

```text
ROUTE A — semantic entrance discovery

SCOUT
challenge the current board and look for missing business-use-case directions
        ↓ novel starts
DISCOVERY
coarse-to-fine qualification of promising business-use-case entrances
        ↓ qualified starts
        ┐
        │
        ├──→ PASS 1 → PASS 2
        │
        ┘

ROUTE B — deterministic executable-path preprocessing

REPOSITORY
        ↓
code/XML executable topology
        ↓
compressed branch-aware call paths
        ↓
longest grouped paths
        ↓
LLM boundary/containment/business-flow classifier
        ↓ qualified coherent flow seeds
        ┘
```

The two routes answer different questions.

```text
Scout/Discovery:
Where in the repository are there promising entrances into business behavior?

Call-path preprocessor:
What long executable structures already exist mechanically, and which coherent business flows do they appear to represent?

Pass 1:
Which qualified business arc should be explored now?

Pass 2:
How does this selected business use case work end to end?
```

Call-path evidence is **not mixed into Discovery's next-level candidate list**. It has its own deterministic preprocessing and lightweight classifier, then seeds Pass 1 directly when a coherent business flow is supported.

---

# Scout — global business-use-case novelty search

Scout is independent of Pass 1 and Pass 2. It does not continue the active arc and does not reconstruct a use case. Its purpose is to challenge the current semantic board.

Scout sees a compact global picture:

```text
known qualified arcs
known discovery starts and their reasons
compact list of already explored evidence regions
broad unexplored repository evidence
```

It asks:

> Is there a materially different business-use-case direction here that is not already represented?

The model scores:

```text
novelty
businessUseCaseLikelihood
```

Framework/configuration novelty and UI-area novelty are not by themselves business-use-case novelty.

Scout never directly creates a qualified Pass-1 arc. A novel direction becomes a candidate Discovery start.

## When Scout runs

Scout is event-driven, for example when:

```text
active arc reaches a broad completion milestone
semantic fit falls below admissibility
recent semantic scores decline materially
no admissible local Pass-2 continuation remains
current evidence becomes technical/orientation with weak business fit
```

If Scout finds nothing new, DataSong resumes the existing Pass-1/Pass-2 path.

If Scout finds new directions:

```text
Scout
→ seed candidate Discovery starts
→ reopen Discovery shallowly
→ resolve each Scout seed as qualified or deprioritized
→ automatically close Scout Discovery
→ return to Pass 1 / Pass 2
```

Scout-reopened Discovery does **not** remain active waiting for arbitrary repository browsing once all Scout seeds are resolved.

---

# Discovery — coarse-to-fine concrete business-use-case qualification

Discovery does not reconstruct an end-to-end use case. Its job is to decide whether a promising entrance really exposes a concrete business actor goal.

Discovery begins from coarse evidence:

```text
repository/directory structure
child folders/files
source-file function signatures
XML/JMX top-level hierarchy and immediate children
JSON/YAML/config top-level objects or keys
document names and compact descriptions
```

The model scores visible items on:

> Given the compact trail so far, how likely is this continuation to reveal a genuine business use case?

A discovery start stores:

```text
discoveryStartId
starting artifact/path
suggested business-use-case title
model reason
current business-use-case likelihood
business actor
business intent
completion condition
business outcome/effect
compact selected exploration trail
status: candidate | qualified | deprioritized
```

## Concrete qualification gate

The model owns semantic interpretation, while DataSong derives qualification mechanically from the returned evidence fields.

A start qualifies when:

```text
isConcreteBusinessUseCase = true
businessActor exists
businessIntent exists
completionCondition exists
businessOutcome exists
```

The model does not also have to remember to flip a redundant qualification boolean.

The completion condition is what observable event/state means the actor goal has completed. The business outcome is the user/business effect produced by that completion.

Examples that do **not** qualify by themselves:

```text
Storefront subscreens navigation
Storefront main widgets
Admin back-office management
Order screen hierarchy
Accounting menu
```

Examples that may qualify when evidenced:

```text
Customer searches for a product and sees matching results
Customer submits checkout and an order is created
Back-office operator releases an order for fulfillment
Accounting clerk applies a payment to an invoice
Customer reviews a completed order's details
```

A broad functional area such as `Order Management` remains a Discovery entrance until deeper evidence reveals one or more concrete actor goals.

## Discovery state isolation

Only an explicitly named `startId` may update a Discovery start. DataSong never falls back to “whichever start is active” when the model is assessing unrelated evidence.

Once a start is qualified, it is frozen in Discovery. Unrelated later evidence cannot reduce its confidence or rewrite its trail. Detailed evolution happens in Pass 2.

---

# Deterministic executable-path preprocessing

The call-path preprocessor is a parallel structural discovery mechanism. It does not ask the LLM to wander through source code looking for business flows.

Its job is:

```text
repository
→ executable nodes
→ deterministic executable edges
→ branch/cycle-aware path compression
→ reconstruct longest grouped paths
→ give only compact path structure to the classifier
```

## Executable node abstraction

The path indexer does not fundamentally care whether an executable node came from ordinary source code or a structured workflow artifact.

Conceptually:

```text
ExecutableNode {
  id
  signature
  provenance
  outgoingEdges[]
}
```

Code parsers produce ordinary function/method/service nodes.

Structured formats require **dialect-specific deterministic adapters** because XML itself has no universal execution semantics.

Examples:

```text
Moqui screen XML adapter
future BPMN adapter
future Spring XML adapter
future package-specific workflow adapter
```

A generic XML hierarchy parser may expose structure, but only a dialect adapter may assert executable semantics such as navigation, calls, branches or writes.

## Moqui XML execution adapter

The current Moqui adapter recognizes executable screen elements such as:

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

These become the same executable graph consumed by the call-path indexer.

Cross-screen navigation is followed only when the target can be resolved deterministically inside the supplied repository. External service implementations remain black boxes.

## Repository boundary

The path preprocessor never assumes source for imported libraries or dependencies.

```text
implementation inside supplied repo
    → follow deterministically

implementation outside supplied repo
    → terminate as EXTERNAL
```

A short path ending in an external business service may still be semantically useful, but its unknown implementation is never invented.

---

# Branches, shared paths, recursion and compression

Each branch is a distinct executable path mechanically, but repeated structure is compressed through references.

Conceptually:

```text
P0: A → B → C
P1: REF(P0) → D → E
P2: REF(P0) → F → G
```

Shared tails are represented once and referenced. Recursion/cycles terminate by referring back to an existing path fragment rather than expanding forever.

```text
P7: X → Y → Z → REF(P7)
```

The LLM never sees the compressed storage representation directly. Selected paths are reconstructed into function/XML signatures before classification.

---

# Longest-path heuristic

The first deterministic ranking heuristic remains intentionally simple:

```text
effective executable function/node count
```

Longer paths are surfaced first because orchestration/business workflows often span more executable nodes than helpers or local utilities.

This is a heuristic, not proof. The classifier may mark a long path technical, uncertain or a subflow.

The experiment is deliberately keeping this ranking simple before introducing richer deterministic scoring.

---

# Grouping branch variants before LLM classification

Raw graph traversal can produce many near-identical paths that differ only in a branch tail.

DataSong groups heavily overlapping paths before choosing the top N. The classifier therefore sees one representative flow plus compact branch information rather than dozens of repeated paths.

Instead of sending every full branch:

```text
common prefix → branch A
common prefix → branch B
common prefix → branch C
```

DataSong sends approximately:

```text
representative rendered path
branchVariantCount
compact divergent tails
terminal kinds
```

This preserves the structural signal while substantially reducing prompt size.

---

# Executable edge semantics and semantic boundaries

Call-path rendering preserves edge type.

```text
CALL
NEXT
TRIGGER
NAVIGATE
EXTERNAL CALL
```

These labels are structural evidence.

```text
CALL / NEXT / TRIGGER
normally preserve execution continuity

NAVIGATE
crosses a screen/navigation boundary and is weaker semantic continuity
```

A navigation edge may still belong to the same business flow, for example:

```text
Checkout
→ Review
→ Place Order
```

But navigation may also land in a different concern:

```text
Change Password
→ Login
→ cart recovery
```

The classifier must explicitly identify a semantic boundary when behavior after a NAVIGATE serves a different actor goal.

When such a boundary exists, the classifier must describe and seed **only the coherent flow segment up to that boundary**. It must not create a combined flow title spanning two different concerns.

Example:

```text
Change Password
→ update password
→ NAVIGATE Login
```

may seed:

```text
Change Password
```

while a separate path may seed:

```text
Login with Cart Merge
```

---

# Flow containment across top paths

Different longest paths can represent different granularities of the same customer journey.

Example:

```text
Product Search
Product Search → Add to Cart
Product Search → Add to Cart → Update Cart
```

These should not necessarily become three competing Pass-1 arcs.

The call-path classifier compares supplied top paths and returns one of:

```text
broader_flow
subflow
alternate_entrance
independent
```

Rules:

```text
broader_flow
contains a larger coherent business journey

subflow
meaningful business behavior contained inside a supplied broader flow

alternate_entrance
a different prefix/entry point reaching essentially the same flow

independent
materially distinct business flow
```

Pass-1 seeding then prefers the broadest coherent business flow.

Contained subflows remain evidence but do not compete as independent top-level arcs when their broader flow is already supplied and qualified.

Alternate entrances are attached to the existing arc as supporting call-path evidence.

This preserves useful granularity for later Pass 2 without polluting the global arc board with overlapping fragments.

---

# Call-path classifier contract

The classifier sees only deterministic reconstructed structural evidence and compact branch summaries.

For each grouped top path it returns roughly:

```text
classification: business_flow | technical | subflow | uncertain
confidence
flowTitle
businessActor
businessIntent
completionCondition
businessOutcome
semanticBoundaryAt
coherentThroughSignature
relationToOtherPaths
relatedPathId
reason
```

A path seeds Pass 1 directly only when it represents a coherent qualified business flow with sufficient confidence and actor/intent/completion/outcome evidence.

Subflows and alternate entrances are attached rather than promoted into competing arcs when a broader/parent flow already exists.

---

# Transition into the common Pass-1 arc board

There are now two valid sources of qualified arcs:

```text
Discovery-qualified start
        ↓
Pass-1 arc

Call-path coherent business-flow seed
        ↓
Pass-1 arc
```

Both preserve provenance describing how the arc was discovered.

```text
qualification = business_use_case
or
qualification = call_path_preprocessor
```

From Pass 1 onward, the detailed exploration machinery is shared.

---

# Pass 1 — scheduler across qualified business arcs

Pass 1 owns the global board of qualified business arcs and decides which arc receives the next exploration turn.

For substantive Pass-2 evidence, the model scores fit against qualified arcs using:

```text
continuity
coherence
expectedGain
```

Pass 1 maintains stable arc identity, actor/intent, major stages, outcome, entities/relationships, status, monotonic progress, opportunity score and evidence.

Pass 1 is a scheduler across arcs, not a DFS walker. Switching arcs changes only the active pointer; paused arcs retain accumulated progress and independent Pass-2 state.

---

# Pass 2 — per-arc DFS reconstruction

Pass 2 explores one selected business use case in detail.

Every qualified arc has independent DFS state:

```text
dfsStateByArc = {
  arc-1: { stack, frontier, visited, pending branches, score trail, ... },
  arc-2: { stack, frontier, visited, pending branches, score trail, ... }
}
```

Within one arc:

```text
current detailed artifact
→ candidate signatures
→ semantic scores
→ preserve admissible alternatives
→ follow strongest continuation
→ flatten / exhaust
→ resume nearest admissible branch
→ if local state is exhausted, arc-anchored semantic search
```

There is no single global DFS stack controlling all arcs.

---

# Current artifact vs candidate evidence

> **Current artifact = detailed evidence. Candidate artifacts = identity + signature only.**

For source traversal:

```text
f1 body
→ model interprets f1
→ f2/f3/f4 signatures only
→ model scores candidates
→ DataSong chooses one
→ only then send that candidate's body
```

Scout and Discovery are coarser and prefer names, signatures, top-level hierarchy and compact reasoning trails.

Call-path preprocessing is different again: it sends reconstructed executable signatures/edge labels but no source bodies.

---

# Progressive artifact exposure

Directories expose structural names and deterministic previews. Source files first expose signatures. Selected functions expose bodies plus lightweight referenced signatures. XML/JMX is lazy and hierarchical for semantic exploration, while supported XML dialect adapters may separately contribute deterministic executable topology to the call-path preprocessor. Config is progressively exposed by keys/objects. Documents are interpreted according to their real artifact type.

---

# Semantic scoring after qualification

Pass-2 semantic fit remains:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

The hard semantic admissibility floor remains `0.25`.

```text
Scout novelty:
Is this a materially different global business-use-case direction?

Discovery likelihood:
Does this trail increasingly expose one concrete actor goal with a completion condition?

Call-path classification:
Does this long executable structure contain one coherent business goal, where are its semantic boundaries, and how does it relate to other top paths?

Pass-2 semantic fit:
Does this candidate continue the already-qualified business use case coherently?
```

---

# Ordered semantic search

Semantic search remains deterministic ordered word-level retrieval over canonical evidence. Scout and Discovery normally prefer coarse structural evidence over repeated search reformulations. Semantic search is primarily a Pass-2 escape mechanism when a qualified arc's local topology is exhausted.

---

# Responsibility split

```text
MODEL — Scout
- identify globally novel business-use-case directions
- distinguish business novelty from technical/UI novelty

DATASONG — Scout
- decide when global novelty should be rechecked
- provide compact board/explored/frontier context
- reopen Discovery when Scout finds something new

MODEL — Discovery
- score coarse-to-fine paths for business-use-case likelihood
- identify one concrete actor goal
- provide actor, intent, completion condition and business outcome

DATASONG — Discovery
- maintain isolated discovery starts and selected trails
- expose one next level at a time
- derive/enforce the concrete qualification contract
- freeze qualified starts
- auto-close Scout-reopened Discovery when its seeds resolve
- promote qualified starts to Pass 1

DATASONG — Call-path preprocessing
- construct executable topology deterministically
- apply code and dialect-specific structured adapters
- preserve repository boundaries
- compress shared paths/cycles
- group branch variants
- rank by effective executable length
- reconstruct compact path evidence for the classifier

MODEL — Call-path classifier
- classify business flow / technical / subflow / uncertain
- identify semantic boundaries across weak navigation edges
- compare path containment and alternate entrances
- describe only coherent actor goals

DATASONG — Call-path admission
- seed only coherent qualified business flows
- attach contained subflows and alternate entrances instead of creating competing arcs
- preserve call-path provenance for Pass 2

MODEL — Pass 1 / Pass 2
- interpret detailed current evidence
- score fit against qualified arcs
- score candidate signatures for semantic continuation

PASS 1 / DATASONG
- maintain one common qualified arc board fed by both discovery routes
- schedule among arcs
- keep progress monotonic

PASS 2 / DATASONG
- maintain independent DFS state for every qualified arc
- preserve and restore pending branches
- backtrack within one arc
- perform arc-anchored semantic search
```

The governing architecture is:

> **Scout/Discovery searches semantically for concrete actor-goal entrances. In parallel, deterministic executable-path preprocessing finds long structural flows and asks a lightweight classifier to identify coherent business seeds, boundaries and containment. Both routes converge at Pass 1; Pass 2 reconstructs each selected arc end to end.**
