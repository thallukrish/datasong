# DataSong Semantic Exploration Architecture

## Status

This document captures the current exploration architecture for DataSong.

It replaces the earlier workflow-first design as the primary discovery model. Workflows remain one important kind of enterprise story, but they are not assumed in advance and are not the primitive objects of exploration.

The central idea is:

> DataSong explores a structured world of enterprise artifacts, chooses what to inspect next based on expected semantic information gain, and incrementally assembles observed evidence into coherent, evidence-backed enterprise stories.

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

A source repository may contain a customer workflow, an ETL pipeline, a numerical algorithm, a microservice, a utility, infrastructure code, or some mixture of these.

A policy document may describe intent that is not visible in code.

A Slack conversation may explain why a production rule differs from an older written policy.

A table may reveal durable state that code only refers to indirectly.

Therefore DataSong must not begin by forcing every artifact into a fixed ontology such as concept, rule, workflow, or persistent data.

There are two fundamental things:

1. **Evidence** — the raw source material and the topology that makes it navigable.
2. **Emerging meaning** — semantic statements that increasingly connect into coherent stories.

---

## 2. The jigsaw-puzzle model

Each observed artifact is a piece of a large enterprise jigsaw puzzle.

A newly observed piece may:

- continue an existing story strongly;
- continue an existing story weakly;
- fill a gap between two already-known steps;
- reveal a branch;
- reveal a reusable sub-flow;
- connect two previously separate stories;
- begin a new story;
- remain unattached for now.

Example:

```text
Story A
Customer reviews cart
→ ?
→ placed order
```

A newly observed service may reveal:

```text
Validate stock and totals
```

and fit between the two known steps:

```text
Customer reviews cart
→ validate stock and totals
→ placed order
```

A different artifact may reveal a nightly sales aggregation job. That does not continue Story A, but it can seed Story B rather than being discarded as irrelevant.

The exploration board therefore contains several evolving stories at once, each with its own momentum, open branches, unresolved gaps, and confidence.

---

## 3. Topology layer

Artifacts should not be presented to the semantic explorer randomly.

The first layer of DataSong is a **topology layer** that exposes local structure and plausible next observations.

The topology layer answers:

> What artifacts are reasonably reachable from where I am now?

It does not decide what those artifacts mean.

### Code topology

Code already has strong structure:

- repository → directory → file → symbol hierarchy
- function and method calls
- callers and callees
- imports
- service invocations
- routes and handlers
- entity/table references
- configuration references
- module/component dependencies
- tests

The explorer should normally see the immediate neighboring artifacts rather than arbitrary files from the repository.

### Slack topology

Slack can expose:

- workspace → channel → thread hierarchy
- replies
- participants
- timestamps
- linked files and URLs
- semantic subclusters inside long threads

A thread with 1,000 messages can still be a locally coherent exploration neighborhood.

### Email topology

Email can expose:

- thread chains
- replies and forwards
- participants
- attachments
- referenced documents
- related-message clusters

### Document topology

Documents can expose:

- corpus → cluster → document → section → paragraph hierarchy
- headings
- references
- hyperlinks
- defined terms
- semantic similarity

Hierarchical clustering can turn a large, weakly organized English-text corpus into something navigable much like a code repository.

### Data topology

Tables and structured data can expose:

- database → schema → table → column hierarchy
- keys and foreign keys
- value relationships
- lineage
- query/view dependencies
- source/derived relationships
- timestamp relationships
- semantic clusters of tables and columns

### Logs and traces

Runtime evidence can expose:

- trace → span hierarchy
- request chains
- sessions
- service transitions
- event correlations
- temporal neighborhoods

### General topology abstraction

```text
RAW ARTIFACTS
      ↓
SOURCE-SPECIFIC STRUCTURING
      ↓
HIERARCHIES + EDGES + CLUSTERS
      ↓
LOCAL CANDIDATE NEIGHBORHOODS
```

This is the common interface presented to the semantic explorer.

---

## 4. Exploration policy

Given several reachable artifacts, DataSong chooses the artifact whose inspection is expected to maximize semantic information gain.

The core question is:

> **Which artifact should I inspect next to most improve my current understanding?**

Information gain is not the amount of text returned. It is the expected improvement in the semantic world model.

An artifact can have high expected gain because it may:

- continue the currently strongest story;
- fill an unresolved transition;
- explain why a known behavior happens;
- place an already-known step more precisely;
- close an open branch;
- reveal an important branch;
- establish the beginning or outcome of a story;
- connect two separate stories;
- reveal a meaningful new story;
- disambiguate conflicting evidence.

The policy is therefore a balance between:

- **continuation value** — does this likely advance something already understood?
- **coherence gain** — does this likely make the story structure clearer?
- **novelty value** — could this reveal an important new path?
- **completion pressure** — is a nearly coherent story worth finishing now?
- **exploration cost** — how much source material must be inspected?

The first implementation can use LLM-estimated scores. Later, the scoring policy itself can learn from historical exploration outcomes.

---

## 5. Evidence continuity vs semantic continuity

A mechanically connected artifact is not necessarily semantically useful.

### Evidence continuity

Evidence continuity is structural adjacency in the evidence world.

Examples:

- caller → callee
- route → handler
- import → dependency
- table → foreign key
- message → reply
- document section → referenced section
- trace span → child span

The topology layer can often determine this cheaply and deterministically.

### Semantic continuity

Semantic continuity asks:

> Does the meaning of this new artifact actually continue one of the stories we are building?

For example:

```text
OrderService → GenericDateFormatter
```

has strong code adjacency but probably weak semantic continuity.

Whereas:

```text
OrderService → PaymentService
```

may have both strong evidence continuity and strong semantic continuity.

The semantic score must therefore not reward code proximity by itself.

---

## 6. The minimal LLM observation contract

The LLM should not rewrite the entire semantic board on every observation.

DataSong owns durable state. The model only interprets the newly observed artifact relative to that state.

For each artifact, the model should answer a compact set of questions:

1. **What does this artifact mean?**
2. **Which existing story/path does it continue, if any?**
3. **How strong is that continuity?**
4. **How exactly does it connect semantically?**
5. **What structural role does it appear to play?**
6. **Where does it fit relative to already-known steps?**
7. **Which available next artifact is expected to add the most information?**

A compact response can look like:

```json
{
  "meaning": "Validates cart totals and stock before order submission.",
  "pathId": "customer-places-order",
  "continuity": 0.88,
  "bridge": "This occurs after cart review and before the order-placement action.",
  "relation": "continue",
  "placement": {
    "after": "review-cart",
    "before": "place-order",
    "confidence": 0.84
  },
  "nextArtifactId": "service:place-order",
  "expectedGain": 0.92
}
```

Possible `relation` values are intentionally small and semantic:

- `continue`
- `branch`
- `subflow`
- `new_story`
- `connect_paths`
- `unattached`

This contract should remain compact. Existing stories, branches, dependencies, progress, visited evidence, and token accounting are maintained by DataSong rather than regenerated by the model.

---

## 7. Story order is not discovery order

Artifacts will often be discovered out of sequence.

The explorer must not assume:

```text
artifact 1 discovered
→ artifact 2 discovered
→ artifact 3 discovered
```

means that this is their semantic order.

A newly observed artifact may belong before, after, between, parallel to, or on a branch from already-known steps.

Therefore the model should express **relative placement**, not brittle absolute step numbers.

Useful placement forms include:

```text
after X
before Y
between X and Y
parallel to X
branch from X
unknown position
```

Example:

```text
Known:
Review cart → Place order

New artifact:
Validate availability

Model:
after Review cart
before Place order
```

DataSong can then insert the step:

```text
Review cart
→ Validate availability
→ Place order
```

Relative ordering allows the story to improve incrementally without renumbering or rewriting the entire narrative.

---

## 8. Three distinct semantic scores

One generic score is not sufficient.

For an observed artifact, DataSong should distinguish at least:

### Continuity

> Does this artifact belong to this story?

### Placement confidence

> How confidently do we know where this artifact belongs relative to known steps?

### Coherence gain

> How much does adding this artifact improve the structural coherence of the story?

A piece that fills a known gap between two strong steps should receive particularly high coherence gain.

Example:

```text
A → ? → C
```

New artifact B:

```text
A → B → C
```

Even if B is not itself a dramatic business event, closing that semantic gap can be very high-value exploration.

These signals can also influence frontier ranking. A candidate likely to resolve a poorly placed or missing transition may deserve more attention than a candidate that merely extends an already well-understood chain.

---

## 9. The semantic world model is an ordered graph of stories

The semantic board should not be a bag of facts and should not be a single linear narrative.

A useful internal representation is an ordered semantic DAG.

Example:

```text
Review cart
    ↓
Validate availability
    ↓
Place order
    ↓
Approval required?
    ├─ no  → confirmed
    └─ yes → approval
```

Each node is an evidence-backed semantic step.

Each edge expresses a semantic relationship such as:

- follows
- precedes
- branches from
- rejoins
- depends on
- invokes sub-flow
- explains
- derived from

Each step retains provenance back to one or more raw artifacts.

The world model can contain many stories simultaneously:

```text
Customer places order
Nightly sales aggregation
Refund approval
Customer registration
Inventory synchronization
...
```

Their nature is allowed to emerge rather than being predetermined.

---

## 10. Path momentum and dampening

A high-signal path often gains momentum:

```text
Order screen
→ Place Order action
→ Order service
→ durable order state
→ approval decision
```

Each strong continuation makes nearby unresolved evidence more attractive.

But a path can dampen:

```text
→ logger
→ serializer
→ framework plumbing
```

When marginal semantic gain falls, the explorer should park that frontier and rerank the board.

```text
high gain
→ continue exploiting path
→ gain falls
→ park path frontier
→ choose another high-value frontier
```

A parked path is not abandoned. Later evidence may increase its expected value and cause the explorer to return.

---

## 11. Exploration vs completion pressure

Pure global information-gain maximization can cause wandering.

A story may become 90% coherent and then lose attention to several novel but less important artifacts.

To prevent this, mature stories acquire **completion pressure**.

Conceptually:

```text
Early story
EXPLORE
What is this?

Maturing story
BUILD
How do these pieces connect?

Nearly closed story
CLOSE
What minimum unresolved evidence is still needed?
```

The policy should therefore favor closing mature stories when useful local evidence remains, while still allowing a switch if the current frontier has very low semantic value.

The goal is to finish the semantic story, not exhaust every artifact around it.

---

## 12. Branches and hierarchical completion

A story is not necessarily a line.

Suppose exploration discovers:

```text
Customer places order
        ↓
Validate order
        ├─ valid → place order → success
        ├─ invalid → reject
        └─ approval required → approval
```

The explorer may first follow the happy path because it has the strongest continuity or highest expected runtime frequency.

Completing that branch does not close the parent story.

The board may show:

```text
Customer places order            67%

  Standard path                 100% ✓
  Approval branch                35%
  Invalid-order branch            0%
```

When the happy path closes, its frontier value falls and unresolved branches gain priority.

Progress is therefore hierarchical:

- branch closure
- parent-story closure
- optional overall world coverage

Progress need not be monotonic. If new evidence reveals a previously unknown material branch, parent-story progress can decrease because the story is now understood to be richer than previously believed.

A story reaches 100% only when all semantically material discovered branches are closed or explicitly bounded.

---

## 13. Branches are different from sub-flows

A branch changes the behavior of the current story and normally remains inside it.

A **sub-flow** is a reusable or independently meaningful semantic path that the current story invokes.

Example:

```text
Order placement
→ Payment processing
→ Order confirmed
```

Payment processing might itself contain authorization, retries, fraud review, settlement, and provider-specific behavior.

Inlining all of that recursively into the order story would make exploration unbounded.

Instead, the parent story records a semantic contract:

```text
Payment processing

input:
amount + payment instruction

output:
authorized / declined / pending

relevant effect:
order progression depends on an acceptable payment result
```

The payment path can then appear independently on the semantic board and be explored later.

Rule:

> **Branches expand the current story; reusable sub-flows become referenced stories.**

---

## 14. Local dependencies vs external black boxes

Dependencies must respect the evidence boundary.

If a dependency has implementation evidence inside the supplied enterprise world, it remains explorable.

Example:

```text
OrderService → InventoryService
```

If `InventoryService` exists in the supplied repo or another supplied internal repo, DataSong should track it as a local semantic dependency.

If the source is outside the available enterprise boundary, DataSong should stop traversal and treat the dependency as a black box.

Example:

```text
OrderService → external payment SDK/API
```

Record only what is needed to continue the local story:

```text
input: amount + payment reference
output: payment status + transaction id
effect: requests external payment authorization
boundary: external source not explored
```

Do not descend through external SDK internals, HTTP stacks, framework libraries, or infrastructure merely because they are technically reachable.

This prevents semantic exploration from becoming dependency archaeology.

---

## 15. Closure rule

A story can be considered semantically closed when:

1. its main progression is coherent;
2. the ordering of its important steps is sufficiently known;
3. all semantically material discovered branches are closed or bounded;
4. local sub-flows have enough contract information for the parent and are separately tracked when deeper exploration remains;
5. external dependencies have adequate black-box contracts;
6. no unresolved frontier remains that could materially change the story's meaning.

This does not mean every supporting source branch was explored.

It means the story itself is coherent enough to stand as an evidence-backed representation of enterprise behavior.

---

## 16. Weak topology and semantic search

Code has strong native topology. Other enterprise sources can be much weaker.

When source topology is weak, unresolved semantic questions can create navigation structure.

Example:

```text
Customer requests refund
→ support review
→ threshold approval
→ ?
→ refund issued
```

The gap creates the query:

> What authorizes or executes the refund after threshold approval?

Search, clustering, and retrieval utilities can then surface candidate artifacts from Slack, email, policy documents, code, and data.

So the general rule is:

> When the artifact world has strong topology, follow topology.
>
> When topology is weak, use clustering and unresolved semantic gaps to construct it.

---

## 17. Hierarchical clustering as generalized topology

Hierarchical clustering can make heterogeneous sources behave more like navigable repositories.

Example:

```text
Enterprise text corpus
  ├─ Customer service
  │   ├─ Refunds
  │   │   ├─ Approval policy
  │   │   └─ Exceptions
  │   └─ Returns
  ├─ Finance
  │   ├─ Settlement
  │   └─ Invoice disputes
  └─ Operations
      ├─ Inventory
      └─ Fulfillment
```

The explorer can then work with the same abstraction used for code:

```text
current node
→ immediate children / neighbors
→ compact descriptors
→ select next observation
```

The topology implementation differs by source, but the exploration interface remains similar.

---

## 18. Three-layer architecture

The current architecture is:

```text
                ENTERPRISE ARTIFACTS
                        ↓

1. TOPOLOGY LAYER
   What is connected/reachable?

   code hierarchy and call graph
   schema/data relationships
   message/document clusters
   threads and traces
   search neighborhoods

                        ↓

2. SEMANTIC EXPLORATION POLICY
   Which artifact should be inspected next?

   expected information gain
   continuity
   placement uncertainty
   coherence gain
   path momentum
   novelty
   completion pressure
   exploration cost

                        ↓

3. SEMANTIC WORLD MODEL
   What does the observed evidence mean together?

   ordered evidence-backed steps
   branches
   sub-flow references
   black-box dependencies
   unresolved gaps
   cross-story connections
```

The topology layer should be deterministic and inexpensive wherever possible.

The LLM should concentrate on semantic interpretation and frontier choice, not repository mechanics or repeated state regeneration.

---

## 19. RL-like interpretation

This architecture resembles reinforcement learning / world exploration even if the first implementation uses an LLM directly rather than a separately trained RL policy.

### Environment

The enterprise artifact world and its topology.

### State

The current semantic board:

- stories
- ordered steps
- branches
- dependencies
- unresolved gaps
- open frontiers
- visited evidence

### Action

Choose one artifact to inspect next.

### Observation

A bounded representation of that artifact.

### LLM role

The LLM acts as semantic evaluator and policy estimator:

- describe artifact meaning;
- identify story continuity;
- provide semantic bridge;
- identify branch/sub-flow/new-story signals;
- place the new step relative to known steps;
- estimate expected value of the next candidate.

### Reward intuition

Positive semantic gain comes from:

- strong continuity;
- filling a gap;
- improving ordering confidence;
- connecting previously separate evidence;
- resolving uncertainty;
- discovering a meaningful new path;
- closing a branch;
- closing a story.

Low or negative value comes from:

- revisiting understood evidence;
- high code adjacency with low semantic relevance;
- repeatedly entering generic helpers/framework internals;
- consuming evidence without improving story coherence.

Over time, historical runs can teach the policy patterns such as:

> Following relation X from semantic state Y tends to produce useful enterprise meaning.

These learned exploration tendencies are more general than hand-defining rewards for concepts, rules, tables, or workflows.

---

## 20. Token-efficient LLM loop

The inner loop should remain deliberately small.

DataSong provides:

```text
CURRENT OBSERVED ARTIFACT
+ compact relevant story/path state
+ immediate topology candidates
```

The model returns only a semantic delta such as:

```json
{
  "meaning": "...",
  "pathId": "...",
  "continuity": 0.91,
  "bridge": "...",
  "relation": "continue",
  "placement": {
    "after": "...",
    "before": "...",
    "confidence": 0.86
  },
  "nextArtifactId": "...",
  "expectedGain": 0.93
}
```

DataSong then:

1. updates the semantic DAG;
2. updates branch/sub-flow state;
3. recomputes progress and path momentum;
4. applies the topology action;
5. retrieves only the selected artifact;
6. repeats.

The model should not regenerate full story descriptions, full branch lists, full dependency lists, or the complete semantic board every round.

That state belongs to DataSong.

This is both more token-efficient and less fragile than asking the LLM to repeatedly serialize the entire world model.

---

## 21. Logging and observability

Every exploration run should maintain a detailed machine-readable trace separate from the console.

The detailed run log should contain, for each LLM call:

- observed artifact ID and provenance;
- bounded artifact content/excerpt;
- candidate next artifacts;
- compact semantic context sent to the model;
- exact prompt;
- raw model response;
- parsed semantic delta;
- selected next artifact/action;
- token usage for the call;
- cumulative token usage;
- parse/retry information when applicable.

The console should remain terse and operational:

```text
[LLM #7] Customer places order 78% | Refund flow 22% | tokens +1542 | cumulative 9184
```

The full semantic reasoning trace belongs in the run log, not in console noise.

---

## 22. Current code-demo objective

For the code-topology demo, the goal is not to enumerate all workflows in advance.

The experiment is:

> Start at an unknown repository root and use local code topology plus compact semantic LLM decisions to discover, order, branch, and close one or more coherent semantic stories.

The demo should visibly show:

- current observed artifact;
- emerging stories;
- story progress;
- branch progress;
- current semantic placement/bridge;
- next selected artifact;
- per-call tokens;
- cumulative tokens.

Detailed prompts and responses remain in the JSONL run log.

---

## 23. Open questions

The following remain research/design questions rather than fixed assumptions:

1. How should continuity, placement confidence, and coherence gain be calibrated against one another?
2. How should DataSong derive parent-story progress from ordered steps and discovered branches without returning to a rigid checklist?
3. When should two emerging stories merge?
4. When should one story split into two?
5. How should contradictory evidence be represented?
6. How should temporal validity be represented when behavior or policy changes?
7. What evidence is sufficient to mark a branch as bounded rather than explored?
8. What evidence is sufficient for a stable sub-flow contract?
9. How should the frontier policy learn from historical exploration runs?
10. How should exploration resume when new enterprise artifacts appear later?
11. What common topology API should cover code, tables, documents, messages, and traces?
12. How should hierarchical clustering be updated incrementally as enterprise evidence changes?
13. What global stopping condition indicates that the enterprise world has been explored sufficiently?

These are now the central design questions. The earlier fixed workflow checklist and repeated full-story LLM regeneration are no longer part of the core architecture.