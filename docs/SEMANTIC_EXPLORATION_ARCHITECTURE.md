# DataSong Semantic Exploration Architecture

## Status

This document captures the current exploration architecture for DataSong.

The earlier workflow-first design is no longer the primary discovery model. DataSong does not begin by assuming that every artifact is a workflow, business concept, rule, or persistent dataset.

The current objective is:

> **Discover and close end-to-end vertical slices of enterprise use cases from heterogeneous evidence.**

A vertical slice is a coherent chain of behavior that starts from a meaningful trigger, intent, input, event, schedule, or request; crosses the relevant implementation, data, configuration, and policy boundaries; and reaches a meaningful outcome or produced state.

The nature of the slice is allowed to emerge from evidence. A slice may ultimately be understood as a customer workflow, employee workflow, ETL/data pipeline, algorithmic process, service interaction, operational procedure, policy-driven process, or something else.

---

## 1. The enterprise is an evidence world

An enterprise contains many kinds of artifacts:

- source code
- configuration
- internal libraries
- database schemas and tables
- sample rows and metadata
- logs and traces
- documents and policies
- Slack conversations
- email threads
- agreements and contracts
- tickets and operational notes

No single artifact type is assumed to contain the whole truth.

Code may implement behavior without explaining business intent. A policy document may explain intent that is only partially implemented. A Slack thread may explain a temporary exception. A table may reveal durable state that code refers to indirectly.

DataSong therefore operates over two fundamental layers:

1. **Evidence world** — raw artifacts plus the topology that makes them navigable.
2. **Emerging semantic world** — evidence-backed statements connected into end-to-end vertical slices.

---

## 2. Topology layer

Artifacts should not be presented to the semantic explorer randomly.

The topology layer exposes the structure already present in each source or constructs a useful hierarchy when the source is weakly structured.

Its question is:

> **What artifacts are reasonably reachable from where I am now?**

It does not decide what those artifacts mean.

### Code

Code already provides strong topology:

- repository → directory → file → symbol
- callers and callees
- imports
- service invocations
- routes and handlers
- entity/table references
- configuration references
- component dependencies
- tests

### Slack and email

Conversation sources provide:

- channel/thread/reply hierarchy
- participants
- attachments
- referenced links/documents
- time relationships
- semantic subclusters when a thread is large

### Documents

Documents can expose:

- corpus → cluster → document → section → paragraph
- headings
- references
- hyperlinks
- defined terms
- semantic similarity

Hierarchical clustering can make a large English-text corpus navigable much like a source repository.

### Tables and structured data

Data topology can include:

- database → schema → table → column
- foreign keys
- value relationships
- lineage
- query/view dependencies
- source/derived relationships
- timestamp relationships
- semantic clusters of datasets and columns

### Logs and traces

Runtime evidence can expose:

- trace → span
- request/session chains
- event correlation
- service transitions
- temporal neighborhoods

The common abstraction is:

```text
RAW ARTIFACTS
      ↓
SOURCE-SPECIFIC STRUCTURING
      ↓
HIERARCHIES + EDGES + CLUSTERS
      ↓
LOCAL CANDIDATE NEIGHBORHOODS
```

---

## 3. Orientation is not a vertical slice

Some artifacts are extremely useful for navigation without being part of an end-to-end use case.

Examples:

- repository root
- directory structure
- README
- build files
- component descriptors
- ignore files
- framework bootstrap/configuration

These should update **orientation context**, not create semantic stories such as "Repository overview" or "Configuration".

Likewise, a test artifact can reveal a real use case, but the slice is the behavior under test, not "JMeter tests" or "test suite".

Orientation helps the explorer find meaningful entry points. It is not itself the target semantic model.

---

## 4. The target object: an end-to-end vertical slice

A useful vertical slice normally has a semantic progression such as:

```text
trigger / intent / input
        ↓
action or processing
        ↓
decision / transformation / state change
        ↓
possible branches or handoffs
        ↓
meaningful outcome
```

Examples:

```text
Customer places an order
UI intent → validation → order placement → persistence → approval branch → order outcome
```

```text
Nightly sales aggregation
schedule → extract transactions → transform → aggregate → reporting dataset
```

```text
Refund approval
refund request → policy check → approval branch → refund execution → recorded result
```

The explorer is not required to know the slice identity at the beginning. It crystallizes as evidence accumulates.

---

## 5. Compact LLM semantic contract

The inner loop should not ask the LLM to regenerate the full world model on every turn.

For each newly observed artifact the LLM only needs to determine:

1. **Meaning** — what does this artifact represent semantically?
2. **Role** — orientation, story evidence, or unattached evidence?
3. **Path identity** — which existing vertical slice does it continue, or does it begin a new one?
4. **Continuity** — how strongly does it belong to that slice?
5. **Semantic bridge** — how exactly does it advance or relate to that slice?
6. **Relative placement** — where does it fit relative to already-known steps?
7. **Structural signal** — continuation, branch, or reusable sub-flow?
8. **Next evidence** — which available artifact is expected to produce the greatest information gain toward closing a vertical slice?

A compact response can look like:

```json
{
  "meaning": "Validates stock and totals before order submission.",
  "semanticRole": "story",
  "pathId": "customer-places-order",
  "continuity": 0.91,
  "bridge": "Adds the validation step between cart review and order placement.",
  "relation": "continue",
  "placement": {
    "type": "between",
    "afterStepId": "review-cart",
    "beforeStepId": "place-order",
    "confidence": 0.88
  },
  "coherenceGain": 0.86,
  "next": {
    "type": "artifact",
    "artifactId": "service:place-order",
    "expectedGain": 0.93,
    "reason": "Direct continuation toward the order outcome."
  }
}
```

DataSong owns the accumulated state. The model returns only the delta.

---

## 6. Discovery order is not story order

An artifact found later may belong earlier in the slice.

Therefore steps should be positioned relatively:

- before
- after
- between
- branch from
- parallel to
- unknown

Absolute step numbers should not be used as the primary representation because they become brittle as new evidence is inserted.

A vertical slice is therefore best represented as an ordered semantic DAG rather than a discovery transcript.

Three different signals are useful:

- **continuity** — does this evidence belong to the slice?
- **placement confidence** — do we know where it belongs?
- **coherence gain** — how much does inserting it improve the slice structure?

An artifact that fills a known gap between two existing steps can have especially high coherence gain.

---

## 7. Exploration policy and information gain

Given several reachable artifacts, DataSong chooses the artifact expected to most improve the semantic world model.

The core question is:

> **Which artifact should I inspect next to most advance or close an end-to-end vertical slice?**

Information gain is not token volume. Useful gain includes:

- extending the active slice toward its start or outcome
- filling an unexplained transition
- placing an existing step more precisely
- resolving an open question
- revealing or closing a material branch
- exposing a meaningful sub-flow
- connecting previously separate evidence
- discovering a credible new vertical slice when the current one has dampened

Code adjacency is useful but not sufficient. A direct function call can be mechanically close while semantically irrelevant. A service call that continues the use case is much more valuable.

---

## 8. Path momentum, dampening, and completion pressure

A high-signal slice should acquire momentum.

Example:

```text
checkout screen
→ place-order action
→ order service
→ durable order state
→ approval decision
```

When successive artifacts strongly continue the same use case, the explorer should prefer that local path over unrelated global novelty.

If the path begins producing generic helpers, logging, serialization, framework internals, or other low-semantic-gain artifacts, its marginal value dampens and other frontiers can compete again.

Nearly coherent slices should receive **completion pressure** so the explorer does not abandon a 90%-formed path for a shiny unrelated artifact.

This creates three intuitive modes:

```text
EXPLORE  → what use-case paths exist here?
BUILD    → how do these pieces connect?
CLOSE    → what minimum evidence remains to make this slice coherent end to end?
```

---

## 9. Branches, sub-flows, and dependencies

A vertical slice is not necessarily linear.

### Branches

A material branch belongs to the current slice.

```text
validate order
   ├─ valid → place order
   ├─ invalid → reject
   └─ approval required → approval path
```

Completing the happy path does not make the parent slice complete while material branches remain unexplored.

### Sub-flows

A reusable independently meaningful process should not be recursively inlined into the parent slice.

Example:

```text
Order placement
   ↓
Payment processing
   ↓
Order confirmed
```

The parent slice only needs a semantic contract for payment processing sufficient to understand its effect. Payment processing can exist as another separately explorable vertical slice.

### External dependencies

If implementation is outside the supplied enterprise evidence boundary, treat it as a black box.

Record only what is needed to continue the local slice:

```text
input → external dependency → observable output/effect
```

Do not recursively descend through SDKs, HTTP stacks, libraries, or infrastructure that are outside the evidence boundary.

---

## 10. Closure and progress

Progress belongs to the semantic slice, not to source-code coverage.

A slice is complete when:

- its identity/use case is coherent
- it has a meaningful beginning
- its main progression is connected
- it reaches a meaningful outcome
- every material discovered branch is closed or bounded
- local sub-flows have enough contract information for the parent
- external dependencies have adequate black-box contracts
- no remaining frontier is likely to materially change the slice's meaning

Progress may decrease if newly observed evidence reveals an important previously unknown branch or missing transition.

A branch can be 100% while its parent slice is still incomplete.

The explorer should finish the **semantic use case**, not exhaust every nearby source artifact.

---

## 11. Source-agnostic architecture

The same explorer should work over many evidence types because topology is source-specific while semantic reasoning is shared.

```text
ENTERPRISE ARTIFACTS
        ↓
1. TOPOLOGY
   what can be inspected next?
        ↓
2. EXPLORATION POLICY
   which candidate maximizes expected semantic information gain?
        ↓
3. SEMANTIC WORLD MODEL
   which vertical slice does this evidence advance, and where does it fit?
```

For weakly structured sources, hierarchical clustering, search, embeddings, thread reconstruction, or temporal grouping can manufacture useful topology before the semantic explorer operates.

When native topology is strong, follow it. When topology is weak, unresolved semantic questions can drive search and clustering.

---

## 12. RL-like interpretation

The architecture resembles reinforcement learning/world exploration even if the initial implementation uses an LLM-scored policy rather than a trained RL model.

- **Environment:** enterprise evidence world plus topology
- **State:** current vertical slices, unresolved gaps, branches, orientation, visited artifacts, and frontier
- **Action:** inspect one candidate artifact/search neighborhood
- **Observation:** bounded artifact content
- **Evaluator/simulator:** LLM semantic interpretation
- **Reward intuition:** semantic continuity, coherence gain, uncertainty reduction, branch closure, use-case closure, and useful new-slice discovery

The policy can eventually learn patterns such as:

> Given this kind of semantic state and source topology, following this kind of edge tends to increase vertical-slice coherence.

The learned parameters should be about exploration effectiveness, not fixed business categories.

---

## 13. Logging and token efficiency

The live console should remain terse:

```text
[LLM #12] slices: Customer places an order 64% | tokens +840 | cumulative 11230
```

Detailed debugging belongs in the persistent run trace:

```text
data/runs/<run-id>.jsonl
```

The trace should record:

- observed artifact
- candidate artifacts
- prompt/system instruction
- raw model response
- parsed semantic delta
- before/after state
- branch/sub-flow decisions
- per-call token usage
- cumulative token usage

The compact delta contract is specifically intended to avoid repeatedly sending and regenerating a large narrative/checklist structure.

---

## 14. Current demo objective

`demo_v2` currently tests one narrow but important hypothesis:

> Starting from an unknown code repository, can DataSong use code topology plus compact LLM semantic decisions to autonomously discover and close at least one coherent end-to-end vertical slice of a use case without wandering through the repository exhaustively?

Once this works reliably for code, the same topology/exploration abstraction can be extended to documents, Slack/email, tables, logs, and mixed enterprise evidence.
