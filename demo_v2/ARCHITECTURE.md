# DataSong v2 semantic exploration architecture

## Primary objective

DataSong reconstructs **end-to-end vertical slices of business use cases** from heterogeneous enterprise evidence.

The governing question is:

> What is a business actor, end user, operator, external business participant, scheduler or system trying to accomplish, and how does the enterprise support that intent end to end?

Technical artifacts are evidence. They are not automatically business flows.

A flow is not a predefined structural type. It emerges when accumulated evidence sustains continuity and coherence around one business capability or use case.

---

# Four-layer exploration model

The governing architecture is now:

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
Discovery: does this promising direction really qualify as a business-use-case entrance?
Pass 1:    which qualified business arc should be explored now?
Pass 2:    how does this selected business use case work end to end?
```

This separation exists to prevent two opposite failure modes:

```text
premature exploitation:
find one early arc → keep deepening it → fail to notice other business use cases

unfocused exploration:
keep browsing/searching globally → never build a coherent end-to-end use case
```

Scout protects against the first. Pass 1 and Pass 2 protect against the second.

---

# Scout — global business-use-case novelty search

Scout is independent of Pass 1 and Pass 2.

It does **not** continue the active arc and does **not** reconstruct a use case. Its purpose is to challenge the current semantic board.

Scout sees a compact global picture:

```text
known qualified arcs
known discovery starts and their reasons
compact list of already explored evidence regions
broad unexplored repository evidence
```

Broad evidence should remain lightweight:

```text
directories
file names
source signatures when already exposed
XML/JMX top-level hierarchy
config/document identity
```

Scout asks the model:

> Is there a materially different business-use-case direction here that is not already represented by the known arcs or discovery starts?

The model scores two separate things:

```text
novelty
businessUseCaseLikelihood
```

A repository region is useful to Scout only when it is both reasonably likely to expose business behavior **and** meaningfully different from what DataSong already knows.

Framework/configuration novelty is not business-use-case novelty.

## Scout output

Conceptually:

```json
{
  "summary": "global novelty assessment",
  "newDirections": [
    {
      "artifactId": "exact broad candidate id",
      "novel": true,
      "novelty": 0.9,
      "businessUseCaseLikelihood": 0.82,
      "suggestedArcTitle": "Customer manages profile",
      "businessActor": "customer",
      "businessIntent": "maintain account/profile information",
      "pursue": true,
      "reason": "distinct from checkout/order-history arcs"
    }
  ]
}
```

Scout never directly creates a qualified Pass-1 arc. A novel direction reopens Discovery and becomes a candidate discovery start.

## When Scout runs

Scout is event-driven rather than an arbitrary fixed-call budget.

It is triggered when the current exploitation path provides evidence that the global board should be challenged, for example:

```text
active arc reaches a broad completion milestone
semantic fit falls below admissibility
recent semantic scores decline materially
no admissible local Pass-2 continuation remains
current evidence becomes technical/orientation with weak business fit
```

Scout uses a compact fingerprint of the current arc board, discovery starts and broad frontier so the same unchanged global state is not repeatedly rescanned.

If Scout finds nothing genuinely new, DataSong resumes the existing Pass-1/Pass-2 path.

If Scout finds a new direction:

```text
Scout
→ seed candidate Discovery start
→ reopen Discovery shallowly
→ qualify/deprioritize it
→ return qualified starts to Pass 1
```

---

# Discovery — coarse-to-fine business-use-case entrance qualification

Discovery does not reconstruct an end-to-end use case. Its job is to determine whether a promising entrance is genuinely business-oriented.

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

A discovery start stores only entrance-level state:

```text
discoveryStartId
starting artifact/path
suggested business-use-case title
model reason
current business-use-case likelihood
actor/intent if known
compact selected exploration trail
status: candidate | qualified | deprioritized
```

Several starts may coexist.

A next-level candidate may either:

```text
continue an existing discovery start
or
seed a distinct discovery start
```

Confidence may rise or fall as evidence deepens.

Once a start clearly qualifies, Discovery freezes it. Detailed reconstruction belongs to Pass 2.

When Scout reopens Discovery, already-qualified starts are treated as known. Discovery focuses on the newly Scout-seeded candidate directions before declaring the discovery exercise complete again.

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

The discovery-start artifact is preserved as the entrance for later Pass-2 exploration.

Unqualified starts do not receive DFS state.

---

# Pass 1 — scheduler across qualified business arcs

Pass 1 owns the global board of qualified business arcs and decides which arc receives the next exploration turn.

For substantive Pass-2 evidence, the model scores fit against qualified arcs using:

```text
continuity
coherence
expectedGain
```

Pass 1 maintains:

```text
arcId
title
business actor / intent
major stages
outcome
major entities and relationships
status
monotonic progress
opportunity score
evidence
```

Pass 1 is a scheduler across arcs, not a DFS walker.

Switching arcs changes only the active pointer. A paused arc keeps its accumulated progress and its independent Pass-2 state.

---

# Pass 2 — per-arc DFS reconstruction

Pass 2 explores one selected business use case in detail.

Its input is:

```text
arcId
currentArtifactId
```

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

A core invariant is:

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

The same principle applies to XML hierarchy nodes, config objects and semantic-search results.

Scout and Discovery are even coarser: they prefer names, signatures, top-level hierarchy and compact reasoning trails.

---

# Progressive artifact exposure

## Directories

DataSong exposes structural names and deterministic previews rather than file contents.

## Source files

A selected source file initially exposes function/method signatures. A selected function exposes identity/signature, body, provenance and lightweight called/referenced signatures.

## XML and JMX

XML/JMX is lazy and hierarchical:

```text
file
→ root/top-level nodes
→ immediate children
→ selected child
→ its immediate children
→ deeper only when requested
```

## JSON/YAML/config

Structured configuration follows the same progressive principle: top-level objects/keys first, selected children later.

## Documents/text

Documents are interpreted according to their real artifact type rather than forced into executable-code semantics.

---

# Semantic scoring after qualification

Pass-2 semantic fit remains:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

The hard semantic admissibility floor remains `0.25`.

Discovery likelihood and Scout novelty are different quantities:

```text
Scout novelty:
Is this a materially different global business-use-case direction?

Discovery likelihood:
Does this trail look increasingly like a genuine business-use-case entrance?

Pass-2 semantic fit:
Does this candidate continue the already-qualified business use case coherently?
```

---

# Ordered semantic search

Semantic search remains deterministic ordered word-level retrieval over canonical evidence.

Matching priority:

```text
5 exact phrase
4 contiguous from beginning
3 contiguous later
2 all words present in order
1 partial words present in order
```

Scout and Discovery normally prefer coarse structural evidence over repeated semantic-search reformulations. Semantic search is primarily a Pass-2 escape mechanism when an admitted arc's local topology is exhausted.

---

# Responsibility split

```text
MODEL — Scout
- identify globally novel business-use-case directions
- distinguish business novelty from technical novelty

DATASONG — Scout
- decide when global novelty should be rechecked
- provide compact known-arcs/explored-regions/broad-frontier context
- reopen Discovery when Scout finds something new

MODEL — Discovery
- score coarse-to-fine paths for business-use-case likelihood
- refine confidence using compact prior trail reasoning
- decide when a discovery start qualifies

DATASONG — Discovery
- maintain discovery starts and selected trails
- expose one next level at a time
- freeze qualified starts
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

TOPOLOGY / DATASONG
- repository inventory
- canonical IDs
- parsing/canonicalization
- progressive artifact exposure
- call/reference graph
- XML/config hierarchy
- deterministic semantic search
- coverage/caching/cycle safety
```

The governing architecture is:

> **Scout looks for what DataSong may be missing. Discovery qualifies promising entrances. Pass 1 schedules the qualified arcs. Pass 2 reconstructs each selected arc end to end.**
