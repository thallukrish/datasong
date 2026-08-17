# DataSong Semantic Exploration Architecture

## Status

Exploratory architecture note. This document captures a newer direction for DataSong and intentionally does not assume that workflows, business concepts, rules, or persistent data are the primitive objects of discovery.

The previous workflow-centric design is useful as one application of the semantic model, but it is too restrictive as the general discovery architecture.

---

## 1. Core idea

An enterprise contains many kinds of artifacts:

- source code
- configuration
- libraries and dependencies
- database schemas and tables
- sample rows and metadata
- logs and traces
- documents and policies
- Slack conversations
- email threads
- agreements and contracts
- tickets and operational notes

Some of these artifacts may describe business workflows. Others may describe ETL pipelines, algorithms, microservices, policies, utilities, analytics, data products, operational procedures, or something else entirely.

DataSong should therefore not begin by forcing every artifact into a small ontology such as workflow, rule, concept, or persistent data.

Instead, discovery has two fundamental layers:

1. **The evidence world** — raw artifacts and the topology that connects them.
2. **The meaning that emerges** — semantic interpretations and increasingly coherent enterprise stories built from those artifacts.

The explorer moves through the evidence world and continuously updates its understanding of the enterprise.

---

## 2. The jigsaw-puzzle model

Think of every observed artifact as a piece of a large enterprise jigsaw puzzle.

A piece may strongly continue a story already under construction, weakly relate to one, or begin a completely new story.

For example:

```text
Story A
Customer
→ cart
→ place order
→ order created
```

A newly inspected service may continue this story directly.

A newly inspected nightly aggregation job may instead seed another path:

```text
Story B
Transactions
→ nightly aggregation
→ sales analytics dataset
```

Story B should not be treated as irrelevant merely because Story A currently has more momentum.

The semantic board therefore contains:

- mature semantic paths
- early semantic paths
- partially connected fragments
- unresolved gaps
- unexplored frontiers

The objective is to keep placing pieces until coherent end-to-end stories emerge across the enterprise.

---

## 3. Topology layer

Raw artifacts should not be presented to the semantic explorer randomly.

Most sources already contain useful structure, or can be transformed into useful hierarchical structure.

The **Topology Layer** exposes that structure.

### Code

Code is naturally hierarchical and connected through:

- repository / directory / file / symbol hierarchy
- function and method calls
- imports
- service invocations
- routes and handlers
- entity references
- module and component dependencies
- configuration references
- tests

A code explorer can therefore be shown the immediate reachable neighborhood from the current point instead of an arbitrary collection of files.

### Slack

Slack can expose:

- workspace / channel / thread hierarchy
- replies
- participants
- timestamps
- referenced files and links
- semantic subclusters within large threads

Even a thread containing a thousand messages may remain a locally coherent evidence neighborhood.

### Email

Email topology can include:

- conversation threads
- reply/forward chains
- participants
- attachments
- referenced documents
- related-message clusters

### Documents

Documents may expose:

- document / section / paragraph hierarchy
- headings
- references
- hyperlinks
- defined terms
- semantic clusters across documents

Hierarchical clustering can make a large collection of otherwise unrelated documents behave more like a navigable repository.

### Tables and data

Data topology can include:

- database / schema / table / column hierarchy
- foreign keys
- value relationships
- query/view dependencies
- lineage
- timestamp relationships
- source/derived datasets
- semantic clustering of columns and datasets

### Logs and traces

Runtime evidence can expose:

- trace / span hierarchy
- request chains
- sessions
- event correlation
- service transitions
- temporal neighborhoods

### General principle

```text
RAW ARTIFACTS
      ↓
SOURCE-SPECIFIC STRUCTURING
      ↓
HIERARCHIES + EDGES + CLUSTERS
      ↓
LOCAL CANDIDATE NEIGHBORHOODS
```

The topology layer answers:

> What can I reasonably inspect next from where I currently am?

It does not decide what those artifacts mean.

---

## 4. Semantic exploration policy

Given a current semantic state and several candidate artifacts exposed by the topology layer, the explorer chooses the artifact whose inspection is expected to maximize information gain.

The central policy question is:

> **Which artifact should I inspect next to most improve my understanding of the enterprise?**

Information gain is not the amount of new text. It is the expected reduction of uncertainty or increase in semantic coherence.

A candidate may be valuable because it is likely to:

- continue an existing semantic path
- resolve an unexplained transition
- connect two previously disconnected findings
- reveal the meaning of an observed artifact
- explain why a behavior exists
- establish a beginning or outcome
- reveal a new important path
- disambiguate conflicting interpretations
- connect evidence from different source types

The explorer should estimate expected gain before observing the artifact, inspect the chosen artifact, then evaluate the actual semantic gain afterwards.

This creates the basis for a learned exploration policy.

---

## 5. Evidence continuity vs semantic continuity

A crucial distinction is between **evidence continuity** and **semantic continuity**.

### Evidence continuity

Evidence continuity asks whether two artifacts are structurally adjacent in the source world.

Examples:

- caller → callee
- import → dependency
- route → handler
- table → foreign key
- message → reply
- document section → referenced section
- trace span → child span

This can often be determined deterministically by the topology layer.

### Semantic continuity

Semantic continuity asks whether the meaning of the newly observed artifact actually continues the same enterprise story.

For example:

```text
OrderService
→ GenericDateFormatter
```

may have high code-level continuity but very low semantic continuity.

Whereas:

```text
OrderService
→ PaymentService
```

may have both high code-level and high semantic continuity.

The semantic explorer should therefore use both.

A path should not receive a high score merely because the code is mechanically connected.

---

## 6. Emerging paths, not predefined workflows

The explorer should not begin with a fixed list of workflows or fixed artifact classes.

Instead it maintains evolving semantic paths.

A new artifact can:

1. strongly extend an existing path
2. weakly extend an existing path
3. connect two paths
4. begin a new path
5. remain an unattached fragment for now

The nature of a path is itself allowed to emerge.

After enough evidence, one path may be understood as:

- a customer workflow
- an ETL pipeline
- a pricing algorithm
- an approval policy
- a microservice interaction
- a reporting pipeline
- an operational procedure
- a data product

Classification should be an outcome of evidence accumulation, not a constraint imposed at the first observation.

---

## 7. Semantic world model

The explorer maintains a compact, durable world model containing at least:

```text
SEMANTIC BOARD

Known semantic paths
- Path A
- Path B
- Path C

For each path
- current narrative / meaning
- evidence supporting it
- confidence / coherence
- unresolved gaps
- open frontiers
- recent information gain
- path maturity

Unattached fragments
- evidence that does not yet fit confidently

Cross-path connections
- possible relationships between stories

Visited evidence
- artifacts or regions already inspected
```

The primary persistent object is not necessarily a workflow or concept.

A useful primitive is:

> **an evidence-backed semantic assertion connected into one or more evolving narratives.**

From mature narratives DataSong can later project more structured objects such as workflows, concepts, datasets, rules, systems, services, ownership, lineage, and policies.

---

## 8. Path momentum and dampening

A high-signal path often becomes progressively more attractive as evidence accumulates.

Example:

```text
Order screen
→ Place Order action
→ order service
→ durable order state
→ approval decision
```

Each useful observation increases semantic momentum.

But eventually the path may enter low-value technical detail:

```text
→ logging helper
→ serializer
→ framework utility
```

The marginal semantic information gain then dampens.

The explorer should not keep following the path merely because it is structurally continuous.

Instead:

```text
high gain
→ exploit path
→ gain falls
→ park frontier
→ rerank all frontiers
→ explore another promising path
```

A parked path remains on the semantic board and may become attractive again when later evidence increases its expected information gain.

---

## 9. Exploration vs completion

Pure global information-gain maximization has a failure mode: a nearly complete story can be abandoned for novel but unrelated evidence.

DataSong therefore needs **completion pressure**.

As an emerging path becomes coherent, the policy should increasingly favor closing its remaining semantic gaps.

Conceptually:

```text
Early path
EXPLORE
"What is this?"

Maturing path
BUILD
"How do these pieces connect?"

Nearly coherent path
CLOSE
"What minimum evidence is needed to complete this story?"
```

Completion pressure should rise with path maturity, but should not force the explorer down obviously low-value technical branches.

The explorer finishes the **semantic story**, not every possible source branch.

A path is sufficiently complete when it has a coherent identity and no major unexplained transition remains, even if low-value implementation details remain unexplored.

---

## 10. When source topology is weak

Code naturally provides strong topology. Some enterprise sources do not.

For weakly structured sources, unresolved semantic questions themselves can create navigation structure.

Example:

```text
Known refund story
customer requests refund
→ support review
→ threshold approval
→ ?
→ refund issued
```

The unresolved question becomes:

> What authorizes or executes the refund after threshold approval?

Search and clustering utilities can then surface candidate evidence from email, Slack, policy documents, code, and data specifically around this semantic gap.

Therefore:

> When the artifact world has strong topology, follow topology.
>
> When it does not, let unresolved semantic questions create the topology.

---

## 11. Hierarchical clustering as universal topology construction

A major opportunity is to make heterogeneous enterprise sources look structurally similar to the explorer.

Hierarchical clustering can turn large English-text corpora, tables, logs, and other collections into navigable neighborhoods.

For example:

```text
Enterprise text corpus
  ├─ Customer service
  │   ├─ Refunds
  │   │   ├─ Refund approval policy
  │   │   └─ Refund exceptions
  │   └─ Returns
  ├─ Finance
  │   ├─ Settlement
  │   └─ Invoice disputes
  └─ Operations
      ├─ Inventory
      └─ Fulfillment
```

The semantic explorer can then traverse this hierarchy similarly to a repository tree.

The exact clustering method may differ by source, but the abstraction presented to the explorer remains similar:

```text
current node
→ immediate children / connected neighbors
→ summaries / metadata
→ choose next observation
```

This creates a common exploration interface across code, documents, tables, messages, and runtime data.

---

## 12. Three-layer architecture

The emerging architecture is:

```text
                ENTERPRISE ARTIFACTS
                        ↓

1. TOPOLOGY LAYER
   What is connected to what?

   - deterministic source structure
   - dependency/call graphs
   - schema relationships
   - threads
   - traces
   - hierarchical clustering
   - semantic search neighborhoods

                        ↓

2. EXPLORATION POLICY
   Which candidate should I inspect next?

   - expected semantic information gain
   - evidence continuity
   - semantic continuity
   - path momentum
   - novelty / new-path potential
   - uncertainty reduction
   - completion pressure
   - exploration cost

                        ↓

3. SEMANTIC WORLD MODEL
   What does the observed evidence mean together?

   - evidence-backed assertions
   - evolving narratives
   - unresolved gaps
   - cross-source connections
   - mature enterprise stories
```

The topology layer should be as deterministic and inexpensive as possible.

The LLM is most valuable in layers 2 and 3.

---

## 13. RL-like interpretation

This architecture resembles reinforcement learning / world exploration, even if the first implementation does not train an RL model.

### Environment

The enterprise artifact landscape plus its topology.

### State

The current semantic world model and unexplored frontier board.

### Actions

Inspect one candidate artifact or neighborhood.

### Observation

The artifact content exposed in a bounded representation.

### Simulator / evaluator

The LLM determines:

1. what the artifact means
2. how it connects to existing semantic paths
3. whether it starts a new path
4. how much semantic information was gained
5. what uncertainties remain

### Reward intuition

Reward should emerge from semantic progress rather than predefined business categories.

Useful signals include:

- increased coherence
- resolved uncertainty
- strengthened connection
- meaningful new path discovery
- closed semantic gap
- completed narrative

Negative signals include:

- revisiting understood evidence
- mechanically adjacent but semantically irrelevant exploration
- broad low-yield traversal
- repeated uncertainty without new evidence

Over time the policy can learn patterns such as:

> In this kind of environment, following relation X from state Y tends to produce high semantic gain.

That learned exploration behavior is more general than rewarding specific notions such as workflow, rule, or database write.

---

## 14. Example exploration across sources

Suppose the current world model contains:

```text
Customer requests a refund
→ support validates request
→ amount over threshold needs approval
→ ?
→ refund is issued
```

Candidate artifacts might include:

```text
A. RefundService.executeRefund()
B. Slack thread: refund threshold rollout
C. PDF: Customer Refund Policy
D. Customer table
E. generic timestamp utility
```

The topology layer exposes these as reachable candidates through code references, semantic search, thread clustering, or document relationships.

The policy estimates which observation is most likely to close the unresolved gap.

After inspecting one candidate, the world model is updated and all frontiers are reranked.

The resulting story may ultimately combine evidence from all of these sources:

```text
Policy PDF
   ↓ explains business intent
Refund threshold rule
   ↓ implemented by
RefundService
   ↓ reads/writes
Refund records
   ↓ operational exception clarified by
Slack conversation
```

No single source is assumed to contain the truth by itself.

---

## 15. Implications for DataSong

This direction changes the role of the current workflow checklist architecture.

The checklist can still be useful once a workflow-like path has clearly emerged, but it should not drive initial exploration.

Likewise, source-code traversal is only one topology implementation, not the product architecture itself.

The larger goal becomes:

> **Build an explorer that traverses a structured enterprise evidence world, chooses observations by expected semantic information gain, and continuously assembles those observations into coherent, evidence-backed enterprise stories.**

Those stories are the substrate from which workflows, policies, datasets, systems, rules, concepts, lineage, analytics views, and agent grounding can later be derived.

---

## 16. Open questions

This note intentionally leaves several questions unresolved:

1. What is the minimal representation of an evidence-backed semantic assertion?
2. How should path coherence and path maturity be measured?
3. How should expected information gain be estimated before inspecting an artifact?
4. How should actual information gain be measured after inspection?
5. How should completion pressure be balanced against novelty and exploration?
6. When should two semantic paths merge or split?
7. How should contradictory evidence be represented?
8. How should temporal validity be represented when policies or behavior change over time?
9. How should the policy learn from historical exploration runs?
10. What stopping criterion indicates that the enterprise has been explored sufficiently?
11. What common topology API can cover code, tables, documents, messages, and traces?
12. How should source-specific clustering and indexing remain inexpensive enough for continuous enterprise operation?

These are now more central research/design questions than the previous fixed workflow traversal mechanics.
