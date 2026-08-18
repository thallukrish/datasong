# DataSong v2 semantic exploration architecture

## Primary objective

DataSong reconstructs **end-to-end vertical slices of business use cases** from heterogeneous enterprise evidence.

The governing question is:

> What business actor, end user, operator, external business participant, scheduler or system is trying to accomplish, and how does the enterprise system support that intent end to end?

Technical artifacts are evidence. They are not automatically business flows.

Examples of useful but non-business evidence include framework setup, dependency registration, screen registration, test harnesses, authentication wiring, configuration and infrastructure. They may reveal where a business use case lives, but technical coherence alone must not become a schedulable business arc.

A flow is not a predefined structural type. It emerges when accumulated evidence sustains continuity and coherence around one business capability/use case.

---

# Three semantic states before scheduling

Before an exploration path becomes a Pass-1 arc, it must pass an explicit semantic admission boundary.

```text
ORIENTATION / TECHNICAL EVIDENCE
        ↓
BUSINESS-USE-CASE HYPOTHESIS
        ↓
MODEL QUALIFICATION
   admit | retain | reject
        ↓
ADMITTED BUSINESS ARC
        ↓
PASS 1 SCHEDULER
        ↓
PASS 2 PER-ARC DFS
```

## Orientation / technical evidence

Evidence may help the model understand and navigate the application without representing a business use case itself.

Examples:

```text
component dependencies
screen registration
framework configuration
test setup
routing infrastructure
authentication wiring
```

Such evidence remains orientation/supporting evidence unless it reveals a genuine business capability.

## Business-use-case hypothesis

When evidence suggests a possible business use case but is not yet sufficient to establish one, the model may create or retain a hypothesis.

A hypothesis is **not schedulable** and does not receive Pass-2 DFS state.

It exists so that promising business possibilities are not lost while preventing weak technical narratives from becoming self-reinforcing exploration threads.

## Model qualification

The model performs the semantic judgment of whether a hypothesis or newly visible concept qualifies as a business use case.

A qualifying arc should express, as supported by the evidence:

```text
business actor / participant
business intent or capability being accomplished
business behavior/stages beyond application assembly
```

This is deliberately not a closed ontology. DataSong does not hard-code specific acceptable actors, trigger types, UI patterns or outcomes.

The model returns one of three outcomes for an existing hypothesis:

```text
ADMIT   — evidence now supports a genuine business use case
RETAIN  — plausible business use case, but evidence is still insufficient
REJECT  — technical/orientation narrative rather than a business use case
```

For a newly proposed arc the model explicitly returns whether it qualifies as a business use case. Only an explicit positive qualification permits admission.

DataSong owns the deterministic state transition; the model owns the semantic qualification.

---

# Two-layer exploration model after admission

Once an arc is admitted, exploration is split into two independent responsibilities:

```text
MODEL
  ↓
PASS 1 — GLOBAL ADMITTED-ARC SCHEDULER
  ↓ arcId
PASS 2 — PER-ARC DFS EXPLORER
  ↓ current artifact + candidate signatures
MODEL
```

Every semantic model response flows through Pass 1 first.

## Pass 1 — business-use-case admission and global scheduling

Pass 1 owns:

```text
orientation state
hypothesis board
admitted business-arc board
arc opportunity scores
arc progress
arc scheduling
```

For every substantive artifact the model returns:

- evidence classification;
- semantic fit against every admitted arc;
- qualification judgments for existing hypotheses;
- zero or more newly visible arc candidates, each explicitly classified as business use case, hypothesis, orientation or technical;
- candidate-signature scores for admitted arcs;
- a compact evidence request.

Only admitted business-use-case arcs participate in scheduling.

Pass 1 then:

1. updates semantic fit/opportunity state for every admitted arc;
2. updates, admits or rejects hypotheses according to the model's qualification;
3. admits newly proposed arcs only when the model explicitly says they qualify as a business use case;
4. assigns current evidence to the strongest semantically admissible admitted arc, if any;
5. updates that arc's broad business-stage understanding;
6. chooses which admitted arc receives the next exploration turn;
7. hands the selected `arcId` to Pass 2.

If no business arc has yet been admitted, exploration remains in orientation/hypothesis discovery rather than inventing a technical arc merely so DFS can start.

### Pass-1 model contract

Conceptually:

```json
{
  "meaning": "brief semantic meaning",
  "evidenceClassification": "business_use_case|business_supporting|hypothesis|orientation|technical",
  "arcFits": [
    {
      "arcId": "arc-1",
      "continuity": 0.8,
      "coherence": 0.9,
      "expectedGain": 0.6
    }
  ],
  "hypothesisJudgments": [
    {
      "hypothesisId": "hyp-1",
      "decision": "admit|retain|reject",
      "qualifiesAsBusinessUseCase": true,
      "businessActor": "customer",
      "businessIntent": "update account profile",
      "confidence": 0.85,
      "reason": "..."
    }
  ],
  "newArcs": [
    {
      "title": "Customer updates profile",
      "qualification": "business_use_case|hypothesis|orientation|technical",
      "qualifiesAsBusinessUseCase": true,
      "businessActor": "customer",
      "businessIntent": "maintain profile details",
      "confidence": 0.9,
      "reason": "..."
    }
  ],
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

### Pass-1 arc state

Each admitted arc maintains stable identity and accumulated business-level state:

```text
arcId
title
business actor / trigger / intent
major stages
outcome
major entities
major relationships
status
progress
opportunity score
evidence
```

Arc progress is monotonic. Switching active exploration changes only the active pointer.

Hypotheses are stored separately and do not appear as active business slices until admitted.

---

# Pass 2 — per-admitted-arc DFS explorer

Pass 2 owns local semantic traversal **inside one admitted arc**.

Its input is:

```text
arcId
currentArtifactId
```

Every admitted arc has independent DFS state:

```text
dfsStateByArc = {
  arc-1: { stack, frontier, visited, score trail, pending branches, ... },
  arc-2: { stack, frontier, visited, score trail, pending branches, ... }
}
```

Hypotheses and orientation narratives do not receive DFS state.

When Pass 1 switches arcs:

```text
save current arc DFS
restore selected arc DFS
resume strongest admissible pending semantic branch
```

If the selected arc has no useful local branch, Pass 2 may perform semantic search anchored to that arc's accumulated business meaning.

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

---

# Progressive artifact exposure

## Repository orientation

Directory navigation is structural and lightweight. DataSong returns deterministic previews such as descendant counts, extension distributions, shallow subtrees and drill targets.

Orientation does not create a business arc by itself.

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

XML/JMX is exposed lazily:

```text
file
→ root/top-level nodes
→ immediate children
→ selected child
→ its immediate children
→ deeper only when requested
```

Each `xmlnode:*` is addressable. Immediate children appear once as candidate signatures.

## JSON/YAML/config

Structured configuration follows the same progressive principle: top-level objects/keys first, selected children later.

## Documents/text

Documents are interpreted as the artifact type they actually are rather than being forced into executable-code semantics.

---

# Semantic scoring

The common semantic score is:

```text
semanticFit = 0.45 * continuity
            + 0.45 * coherence
            + 0.10 * expectedGain
```

The hard admissibility floor is `0.25`.

- `continuity` — next-step fit for the same admitted business use case;
- `coherence` — overall fit with that business story;
- `expectedGain` — likelihood of revealing a missing business stage, branch, decision, entity relationship or outcome.

Structural reachability alone never creates semantic membership.

Crucially, high continuity/coherence with a **technical narrative** is not enough to admit that narrative as a business arc. Business-use-case qualification happens first.

---

# Pass-1 scheduling behavior

Pass 1 schedules only admitted business arcs.

It maintains an opportunity score for each admitted arc and includes a small fairness/age effect so viable arcs are not starved indefinitely.

Hypotheses can accumulate evidence over multiple observations, but they do not compete for scheduling until admitted.

This prevents the failure mode:

```text
technical setup
→ coherent technical arc
→ scheduler selects it
→ Pass 2 explores more setup
→ coherence rises
→ technical arc self-reinforces
```

Instead:

```text
technical setup
→ orientation/hypothesis evidence
→ continue looking for business capability
→ model establishes actor + intent + business behavior
→ admit business arc
→ schedule it
```

---

# Pass-2 DFS behavior

Within the selected admitted arc:

```text
current artifact
→ candidate signatures
→ semantic scores for current arc
→ preserve admissible alternatives
→ follow strongest candidate
→ branch signal flattens / no candidate
→ resume nearest admissible pending branch
→ local state exhausted
→ semantic search anchored to this arc
```

DFS state is per arc, never global.

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

---

# Responsibility split

```text
MODEL
- interpret current evidence
- classify it as business-use-case/supporting/hypothesis/orientation/technical evidence
- decide whether a proposed concept qualifies as a business use case
- admit/retain/reject hypotheses semantically
- score evidence against admitted arcs
- score candidate signatures for admitted arcs
- suggest semantic search terms

PASS 1 / DataSong
- maintain orientation state
- maintain hypothesis board
- enforce explicit business-use-case admission
- maintain admitted arc board
- preserve all admitted arc developments
- schedule only admitted arcs
- keep arc progress monotonic

PASS 2 / DataSong
- create DFS state only for admitted arcs
- maintain DFS separately for every admitted arc
- preserve pending branches
- restore paused arcs
- backtrack within one arc
- perform arc-anchored semantic search

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

The governing architecture is:

> **The model qualifies business use cases. Pass 1 admits and schedules them. Pass 2 explores inside admitted arcs.**
