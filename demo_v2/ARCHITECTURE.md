# DataSong v2 semantic exploration architecture

## Primary objective

DataSong reconstructs **end-to-end vertical slices of business use cases** from heterogeneous enterprise evidence.

The governing question is:

> What is a business actor, end user, operator, external business participant, scheduler or system trying to accomplish, and how does the enterprise support that intent end to end?

Technical artifacts are evidence. UI structure is evidence. Broad functional areas are evidence. None of those are automatically business flows.

A business-use-case arc is one coherent actor goal with a recognizable completion condition and business/user effect. It is not merely a screen, menu, widget set, navigation hierarchy, application area, or generic management domain.

---

# Four-layer exploration model

```text
SCOUT
challenge the current board and look for missing business-use-case directions
        ↓ novel starts
DISCOVERY
coarse-to-fine qualification of promising business-use-case entrances
        ↓ qualified starts
PASS 1
scheduler across qualified business arcs
        ↓ selected arcId
PASS 2
per-arc DFS reconstruction of the selected use case
        ↓ semantic milestone / flattening / exhaustion
SCOUT
```

Each layer has one question:

```text
Scout:     are we missing an entirely different business-use-case direction?
Discovery: does this direction expose one concrete actor goal that really qualifies?
Pass 1:    which qualified business arc should be explored now?
Pass 2:    how does this selected business use case work end to end?
```

Scout protects against premature exploitation. Discovery protects against promoting UI/technical structure into flows. Pass 1 and Pass 2 protect against unfocused global wandering.

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

The model still owns semantic qualification, but DataSong enforces the contract mechanically.

A start may qualify only when the model explicitly says the evidence supports:

```text
isConcreteBusinessUseCase = true
businessActor
businessIntent
completionCondition
businessOutcome
qualifiesAsBusinessUseCase = true
```

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

This prevents the failure mode:

```text
Order flow qualifies at 85%
→ Discovery later inspects .gitignore / CI / README
→ unrelated 0-confidence assessment accidentally updates Order flow
→ UI shows Order flow at 0%
```

---

# Transition from Discovery to Pass 1

Only qualified discovery starts are promoted into the Pass-1 arc board.

```text
DISCOVERY STARTS
candidate A
qualified B
qualified C
deprioritized D
        ↓
qualified B + qualified C
        ↓
PASS 1 ARC BOARD
```

The discovery-start artifact is preserved as the entrance for later Pass-2 exploration. Unqualified starts do not receive DFS state.

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

---

# Progressive artifact exposure

Directories expose structural names and deterministic previews. Source files first expose signatures. Selected functions expose bodies plus lightweight referenced signatures. XML/JMX is lazy and hierarchical. Config is progressively exposed by keys/objects. Documents are interpreted according to their real artifact type.

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
- decide semantic qualification

DATASONG — Discovery
- maintain isolated discovery starts and selected trails
- expose one next level at a time
- enforce the concrete qualification contract
- freeze qualified starts
- auto-close Scout-reopened Discovery when its seeds resolve
- promote qualified starts to Pass 1

MODEL — Pass 1 / Pass 2
- interpret detailed current evidence
- score fit against qualified arcs
- score candidate signatures for semantic continuation

PASS 1 / DATASONG
- maintain qualified arc board
- schedule among arcs
- keep progress monotonic

PASS 2 / DATASONG
- maintain independent DFS state for every qualified arc
- preserve and restore pending branches
- backtrack within one arc
- perform arc-anchored semantic search
```

The governing architecture is:

> **Scout looks for what DataSong may be missing. Discovery qualifies concrete actor goals, not UI areas. Pass 1 schedules the qualified arcs. Pass 2 reconstructs each selected arc end to end.**
