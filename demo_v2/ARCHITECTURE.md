# DataSong v2 semantic exploration architecture

## Primary objective

DataSong reconstructs **end-to-end vertical slices of business use cases** from heterogeneous enterprise evidence.

The governing question is not “what code exists?” but “what business actor is trying to accomplish, and how does the enterprise system support that intent end to end?”

Evidence may come from source, XML/JMX, configuration, schemas, documents, tests, workflows, logs, tickets, agreements or other enterprise artifacts. Technical artifacts are evidence; they are not automatically business flows.

A flow is not a predefined structural type. It emerges when accumulated evidence sustains continuity and coherence around one business concept.

---

# Two-layer exploration model

The exploration algorithm is deliberately split into two independent responsibilities:

```text
MODEL
  ↓
PASS 1 — GLOBAL ARC SCHEDULER
  ↓ arcId
PASS 2 — PER-ARC DFS EXPLORER
  ↓ current artifact + candidate signatures
MODEL
```

The model never directly owns DFS mechanics or global scheduling. Every semantic response is consumed by Pass 1 first.

## Pass 1 — global arc scheduler

Pass 1 owns the global board of discovered business-use-case arcs.

For every substantive artifact, the model returns semantic fit against the known arcs:

```text
continuity
coherence
expectedGain
```

The model may also surface one or more genuinely distinct new business arcs supported by the current evidence.

Pass 1 then:

1. updates semantic fit/opportunity state for every known arc;
2. creates newly supported arcs;
3. assigns the current evidence to the strongest semantically admissible arc;
4. updates that arc's broad business-stage understanding;
5. chooses which arc receives the next exploration turn;
6. hands only the selected `arcId` to Pass 2.

Pass 1 therefore acts as a scheduler **across arcs**, not as a DFS walker within one arc.

Several arcs may develop simultaneously. A newly discovered arc is not discarded merely because another arc is currently active.

### Pass-1 arc state

Each arc maintains stable identity and accumulated business-level state, for example:

```text
arcId
title
trigger / actor / intent
major stages
outcome
major entities
major relationships
status
progress
opportunity score
evidence
```

Arc progress is monotonic. Switching exploration from one arc to another changes only the active pointer; it does not reduce accumulated progress on the paused arc.

The UI/story mirror should therefore look conceptually like:

```text
ACTIVE NOW
Order review and submission      41%

OTHER DISCOVERED ARCS
Customer profile management      33%
Order history                    27%
Fulfillment tracking             18%
Product search                   12%
```

## Pass 2 — per-arc DFS explorer

Pass 2 owns local semantic traversal **inside one arc**.

Its input is:

```text
arcId
currentArtifactId
```

For every arc, Pass 2 preserves an independent DFS state containing the local execution stack and semantically admissible pending alternatives.

Conceptually:

```text
dfsStateByArc = {
  arc-1: { stack, frontier, visited, score trail, pending branches, ... },
  arc-2: { stack, frontier, visited, score trail, pending branches, ... },
  arc-3: { stack, frontier, visited, score trail, pending branches, ... }
}
```

When Pass 1 switches from one arc to another:

```text
save DFS state of current arc
restore DFS state of selected arc
resume that arc from its strongest pending semantic branch
```

Nothing is thrown away merely because another arc gets the next turn.

If the selected arc has no useful local pending branch, Pass 2 may perform a semantic search anchored to that arc's accumulated business meaning.

---

# Model response contract

For substantive evidence, the model sees:

```text
ACTIVE ARC
ARC BOARD
CURRENT DETAILED ARTIFACT
CANDIDATE SIGNATURES ONLY
```

It returns a compact semantic delta containing:

```json
{
  "meaning": "business meaning of current evidence",
  "arcFits": [
    {
      "arcId": "arc-1",
      "continuity": 0.8,
      "coherence": 0.9,
      "expectedGain": 0.6
    }
  ],
  "bestArc": "arc-1 | NEW | UNATTACHED",
  "newArcs": [],
  "arcUpdate": {
    "trigger": "...",
    "majorStages": [],
    "outcome": "...",
    "entities": [],
    "relationships": [],
    "status": "forming|broadly_complete|unresolved"
  },
  "candidateScores": [
    {
      "artifactId": "exact candidate id",
      "arcId": "arc-1",
      "continuity": 0.8,
      "coherence": 0.9,
      "expectedGain": 0.7
    }
  ],
  "evidenceRequest": {
    "type": "advance|getArtifact|getFunction|getNeighbors|searchSemantic|backtrack|stop"
  }
}
```

Candidate scores are local Pass-2 possibilities. Pass 1 still decides which arc gets the next turn.

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

This avoids transporting several candidate bodies when only one will be inspected.

---

# Progressive artifact exposure

## Repository orientation

Directory navigation is structural and lightweight. DataSong returns deterministic previews such as descendant counts, extension distributions, shallow subtrees and drill targets.

Orientation is not semantic-thread construction.

## Source files

Selecting a source file initially returns function/method signatures only.

Selecting one function returns:

```text
identity/signature
body
provenance
called/referenced function signatures
```

Referenced function bodies are not recursively transported.

## XML and JMX

XML/JMX is exposed lazily as a hierarchy rather than as the complete document.

```text
file
→ root/top-level nodes
→ immediate children
→ selected child
→ its immediate children
→ deeper only when requested
```

Each `xmlnode:*` is an addressable artifact. Immediate children are represented once as candidate signatures, not duplicated inside the current artifact and candidate list.

## JSON/YAML/config

Structured configuration should follow the same progressive principle: top-level objects/keys first, then selected children when needed.

## Documents/text

Documents are interpreted as the artifact type they actually are rather than being forced into an executable-code ontology.

---

# Semantic scoring

The common semantic score remains:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

The hard admissibility floor is `0.25`.

Meanings:

- `continuity` — how naturally evidence continues the local frontier of the business arc;
- `coherence` — how well it belongs to the overall business story;
- `expectedGain` — how likely inspection is to reveal a missing stage, branch, decision, entity relationship or outcome.

Structural reachability alone never creates semantic membership.

---

# Pass-1 scheduling behavior

Pass 1 maintains an opportunity score for each arc instead of replacing an older promising opportunity with every weak later observation.

New evidence may strengthen several arcs at once. Old opportunities decay gently rather than disappearing immediately.

Scheduling also includes a small fairness/age effect so a viable arc is not starved indefinitely simply because another arc remains marginally stronger on every local step.

The scheduler therefore behaves more like best-first multi-arc exploration than a globally locked single-thread DFS.

---

# Pass-2 DFS behavior

Within the currently selected arc, Pass 2 maintains the normal DFS semantics:

```text
current artifact
→ candidate signatures
→ semantic scores
→ preserve admissible alternatives
→ follow strongest candidate
→ branch signal flattens / no candidate
→ resume nearest admissible pending branch
→ local state exhausted
→ semantic search anchored to this arc
```

The important difference from the older architecture is that this DFS state is **per arc**, not global.

Switching arcs does not walk an old global stack and does not destroy the paused arc's pending alternatives.

---

# Ordered semantic search

Semantic search remains deterministic ordered word-level retrieval over canonical evidence.

Queries are camelCase/word-token aware. Matching priority is:

```text
5  exact phrase
4  contiguous from beginning
3  contiguous later
2  all words present in order
1  partial words present in order
```

Search retrieves candidate signatures. The model judges semantic usefulness; DataSong handles deterministic retrieval and ranking.

If local DFS state for an arc is exhausted, semantic search is anchored to that arc's accumulated business meaning rather than a generic global frontier.

---

# Responsibility split

```text
MODEL
- interpret current evidence
- score evidence against arcs
- surface new business arcs
- score candidate signatures
- suggest semantic search terms when needed

PASS 1 / DataSong
- maintain global arc board
- assign evidence to arcs
- preserve all arc developments
- schedule the next arc
- keep arc progress monotonic

PASS 2 / DataSong
- maintain DFS state separately for every arc
- preserve pending branches
- restore paused arcs
- choose/resume local candidates
- backtrack within one arc
- perform arc-anchored semantic escape/search

TOPOLOGY / DataSong
- repository inventory
- canonical IDs
- parsing/canonicalization
- artifact-aware exposure
- call/reference graph
- XML/config hierarchy
- deterministic semantic search
- coverage/caching/cycle safety
```

This separation is the governing architecture going forward:

> **Pass 1 schedules across business arcs. Pass 2 explores within one arc.**
