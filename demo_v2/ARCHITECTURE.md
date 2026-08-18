# DataSong v2 semantic exploration architecture

## Primary objective

DataSong reconstructs **end-to-end vertical slices of business use cases** from heterogeneous enterprise evidence.

The governing question is:

> What is a business actor, end user, operator, external business participant, scheduler or system trying to accomplish, and how does the enterprise support that intent end to end?

Technical artifacts are evidence. They are not automatically business flows.

A flow is not a predefined structural type. It emerges when accumulated evidence sustains continuity and coherence around one business capability or use case.

---

# Three-stage exploration model

The governing architecture is now:

```text
DISCOVERY
coarse-to-fine search for promising business-use-case entrances
        ↓ qualified starts
PASS 1
scheduler across qualified business arcs
        ↓ selected arcId
PASS 2
per-arc DFS reconstruction of the selected use case
```

Each stage has one question:

```text
Discovery: where are the promising entrances to business behavior?
Pass 1:   which qualified business arc should be explored now?
Pass 2:   how does this business use case work end to end?
```

This prevents technical orientation paths from becoming self-reinforcing business arcs and prevents pre-admission exploration from wandering deeply without a business objective.

---

# Discovery — coarse-to-fine business-use-case entrance discovery

Discovery happens **before** Pass 1 and Pass 2.

It does not attempt to reconstruct an end-to-end use case. Its job is to find promising entrances into business behavior.

## Initial evidence

Discovery begins from coarse repository evidence:

```text
repository / directory structure
child folders and files
source-file function signatures
XML/JMX top-level hierarchy and immediate children
JSON/YAML/config top-level objects or keys
document names and compact artifact descriptions
```

The model scores visible items primarily on:

> How promising is this path for revealing a genuine business use case?

Technical importance is not the objective.

For example, a framework configuration file may be highly connected but receive a low Discovery score, while `Checkout.xml`, `OrderHistory.xml` or a customer-facing service signature may receive a high score.

## Discovery starts

When a visible item looks promising, DataSong records it as a **discovery start**.

A discovery start is not yet a Pass-1 business arc. It contains only compact entrance-level state:

```text
discoveryStartId
starting artifact/path
suggested business-use-case title
model reason for why it may reveal a business use case
current business-use-case likelihood
business actor/intent if already evidenced
compact exploration trail
status: candidate | qualified | deprioritized
```

The board is intentionally compact. The model sees the prior reasoning for each start, not a regenerated detailed narrative.

## Progressive refinement

A promising start is expanded one level at a time.

Conceptually:

```text
Order/
  Checkout.xml
  OrderHistory.xml
  OrderDetail.xml
  OrderConfig.xml
```

The model receives:

```text
compact previous discovery-start reasoning
+
next-level folders/files/functions/XML children
```

and scores each next-level item.

The score means:

> Given the evidence accumulated along this discovery trail, how likely is this continuation to reveal a genuine business use case?

The model returns the **current confidence** after considering the prior compact trail plus the new evidence. Confidence may rise or fall as exploration becomes more specific.

DataSong stores the score history as the trail. Sibling candidates that are merely scored are not falsely recorded as explored; only the selected continuation advances a trail.

## Best-first behavior

Discovery is broad and shallow rather than a deep DFS.

At each step:

```text
visible next-level candidates
→ model business-use-case likelihood scores
→ DataSong chooses strongest promising continuation
→ expose one next level
→ rescore using compact trail context
```

Several discovery starts may coexist.

A candidate may either:

```text
continue an existing discovery start
or
seed a distinct discovery start
```

This allows a broad `Order/` area to split naturally into entrances such as:

```text
Customer checkout
View order history
View order detail
```

without first forcing them into one technical or semantic thread.

## Qualification

The model decides semantically when a discovery start qualifies as a business-use-case entrance.

A qualifying start should be supported by evidence of:

```text
business actor / participant
business intent or capability
business behavior beyond application assembly
```

This is deliberately not a closed ontology.

Technical setup, framework wiring, dependency registration, screen registration, test harness lifecycle, configuration and infrastructure may help locate business behavior but do not qualify merely because they form a coherent technical story.

Once a discovery start qualifies, Discovery **freezes it rather than drilling deeper**. Detailed reconstruction belongs to Pass 2.

Discovery continues looking for other promising entrances until the model judges that a useful first set of qualified starts has been found and remaining visible paths are materially less promising.

Only then does Discovery complete.

## Discovery model contract

Conceptually:

```json
{
  "currentPathAssessment": {
    "startId": "discover-1",
    "businessUseCaseLikelihood": 0.86,
    "qualifiesAsBusinessUseCase": false,
    "suggestedArcTitle": "Customer checkout",
    "businessActor": "customer",
    "businessIntent": "complete purchase",
    "reason": "..."
  },
  "candidateDiscoveryScores": [
    {
      "artifactId": "exact candidate id",
      "startId": "discover-1",
      "suggestedArcTitle": "Customer checkout",
      "businessUseCaseLikelihood": 0.93,
      "qualifiesAsBusinessUseCase": true,
      "businessActor": "customer",
      "businessIntent": "complete purchase",
      "pursue": true,
      "reason": "..."
    }
  ],
  "discoveryComplete": false,
  "completionReason": "..."
}
```

---

# Transition from Discovery to Pass 1

When Discovery completes, only **qualified discovery starts** are promoted into the Pass-1 arc board.

Conceptually:

```text
DISCOVERY STARTS
candidate A
qualified B
qualified C
candidate D
        ↓
qualified B + qualified C
        ↓
PASS 1 ARC BOARD
```

The discovery-start artifact is preserved as the semantic entrance for later Pass-2 exploration.

Unqualified or deprioritized discovery starts remain discovery evidence; they do not receive Pass-2 DFS state.

---

# Pass 1 — scheduler across qualified business arcs

Pass 1 begins only after Discovery has produced qualified business-use-case starts.

Pass 1 owns the global board of qualified arcs and decides which arc gets the next exploration turn.

For every substantive artifact encountered during Pass 2, the model may score the evidence against all qualified arcs using:

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

Pass 1 is a scheduler **across arcs**, not a DFS walker.

Switching from one arc to another changes only the active pointer. Accumulated progress on paused arcs does not regress.

---

# Pass 2 — per-arc DFS explorer

Pass 2 reconstructs one selected business use case in detail.

Its input is:

```text
arcId
currentArtifactId
```

Every qualified arc gets independent DFS state:

```text
dfsStateByArc = {
  arc-1: { stack, frontier, visited, pending branches, score trail, ... },
  arc-2: { stack, frontier, visited, pending branches, score trail, ... }
}
```

When Pass 1 switches arcs:

```text
save current arc DFS
restore selected arc DFS
resume strongest admissible pending semantic branch
```

Pass 2 may backtrack within the selected arc or perform semantic search anchored to that arc when local topology is exhausted.

There is no single global DFS stack controlling all business arcs.

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

Discovery is even coarser: it prefers names, signatures, top-level hierarchy and compact descriptions until a promising entrance needs one more level of evidence.

---

# Progressive artifact exposure

## Directories

DataSong returns structural names and deterministic previews, such as descendant counts, extension distributions, shallow subtrees and drill targets.

## Source files

Selecting a source file initially returns function/method signatures only. A selected function returns identity/signature, body, provenance and lightweight called/referenced signatures.

## XML and JMX

XML/JMX is exposed lazily:

```text
file
→ root/top-level nodes
→ immediate children
→ selected child
→ its immediate children
→ deeper only when requested
```

Immediate children appear once as candidate signatures.

## JSON/YAML/config

Structured configuration follows the same progressive principle: top-level objects/keys first, selected children later.

## Documents/text

Documents are interpreted according to their real artifact type rather than being forced into executable-code semantics.

---

# Pass-2 semantic scoring

After admission, the common semantic score remains:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

The hard semantic admissibility floor remains `0.25`.

- `continuity` — next-step fit for the same business arc;
- `coherence` — overall fit with that business story;
- `expectedGain` — likelihood of revealing a missing stage, branch, decision, entity relationship or outcome.

Structural reachability alone never creates semantic membership.

Discovery likelihood is different from Pass-2 semantic fit: Discovery asks whether a path is a promising entrance to business behavior; Pass 2 asks whether a candidate continues an already qualified business use case.

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

Search retrieves candidate signatures. The model judges semantic usefulness; DataSong handles deterministic retrieval and ranking.

Discovery should normally prefer structural coarse-to-fine expansion over repeated semantic-search reformulations. Semantic search becomes more important in Pass 2 when an admitted arc's local topology is exhausted.

---

# Responsibility split

```text
MODEL — Discovery
- score visible coarse/fine artifacts for business-use-case likelihood
- refine confidence using compact prior discovery trails
- distinguish continuation of an existing discovery start from a new start
- decide when a start qualifies as a business-use-case entrance
- decide when the useful first discovery set is complete

DATASONG — Discovery
- expose repository/artifact hierarchy progressively
- maintain discovery-start board and compact trails
- choose strongest promising continuation
- keep qualified starts frozen for later Pass 2
- promote only qualified starts into Pass 1

MODEL — Pass 1 / Pass 2
- interpret detailed current evidence
- score it against qualified arcs
- score candidate signatures for semantic continuation

PASS 1 / DATASONG
- maintain qualified arc board
- preserve all arc developments
- schedule the next arc
- keep arc progress monotonic

PASS 2 / DATASONG
- maintain independent DFS state for every qualified arc
- preserve pending branches
- restore paused arcs
- backtrack within one arc
- perform arc-anchored semantic search

TOPOLOGY / DATASONG
- repository inventory
- canonical IDs
- parsing/canonicalization
- artifact-aware progressive exposure
- call/reference graph
- XML/config hierarchy
- deterministic semantic search
- coverage/caching/cycle safety
```

The governing architecture is:

> **Discovery finds the business-use-case entrances. Pass 1 schedules the qualified arcs. Pass 2 reconstructs each selected arc end to end.**
