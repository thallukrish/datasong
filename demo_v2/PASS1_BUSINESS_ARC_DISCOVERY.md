# DataSong — progressive semantic resolution

## Pass 1: broad business-arc discovery

Pass 1 discovers the broad end-to-end business use cases implemented by an enterprise system. It is deliberately **not** a code-inspection pass and does not attempt exhaustive repository coverage.

The point of view is the end user or business actor: what are they trying to accomplish, what broad stages does the system perform, what important decisions/data effects occur, and what business/persistent/external outcome results?

A broad business arc is represented at roughly this resolution:

```text
trigger / actor / business intent
→ major business stage
→ major business stage
→ important decision or branch
→ major persistence/data/external effect
→ outcome
```

Pass 1 also accumulates the major business/persistent entities and relationships needed to explain the vertical slice.

Example:

```text
Customer purchases merchandise

trigger:
customer begins shopping / checkout

major stages:
product discovery
→ cart construction/update
→ checkout
→ payment/order creation
→ order persistence
→ confirmation / downstream handoff

major entities:
Customer, Product, Cart, CartItem, Order, OrderItem, Payment

major relationships:
Customer -> owns -> Cart
Cart -> contains -> CartItem
CartItem -> references -> Product
Customer -> places -> Order
Order -> contains -> OrderItem
Order -> associated with -> Payment
```

The objective is broad semantic understanding of the use case, not reconstruction of every implementation hop.

## Multiple arcs are first-class Pass-1 work

When evidence exposes several distinct business use cases, Pass 1 records all promising arc seeds instead of deepening only the first one.

For example, a commerce test suite may reveal:

```text
Product Search
Shopping Cart
Checkout / Purchase
Order History
Profile Maintenance
Admin Order Management
```

The test suite is orientation evidence. Each underlying user/business use case may become a separate broad arc.

Continuity and coherence still dominate path selection. A nearly coherent arc may receive some preference so DataSong can establish a useful end-to-end slice, but once its trigger, major stages and outcome are broadly understood, Pass 1 should move to another promising arc rather than descend into implementation detail.

## What “trivial” means in Pass 1

Triviality is **relative to the semantic objective of the current pass**, not code size or implementation complexity.

Evidence is trivial for Pass 1 when omitting its internal details does not materially change the explanation of any of the following:

- business intent or trigger
- business actor
- major business stage
- important decision or branch
- major data transformation/effect
- persistent/business entity
- relationship between important entities
- external handoff
- user-visible/business outcome

Such evidence may be skipped or collapsed into one business-level statement.

Examples:

```text
normalizePhoneNumber()
formatPhone()
trimWhitespace()
```

may collapse into:

```text
validate/normalize customer contact data
```

Likewise, a chain of mappers, logging calls, framework hooks or helper functions may be omitted if it does not alter the broad business narrative.

The following are generally **not** trivial when they materially alter the use case:

- payment accepted/rejected
- inventory availability/failure
- approval/rejection decision
- order or claim persistence
- creation of a major business entity
- meaningful relationship between persistent entities
- authorization that changes the allowed business path
- external business-system handoff
- user-visible success/failure outcome

## Pass-1 evidence roles

Semantic evidence is classified at Pass-1 resolution as:

- `major` — materially adds or changes a broad business stage, trigger, decision, entity relationship or outcome;
- `supporting` — useful evidence that can be compressed into a broader stage;
- `trivial` — internal detail whose omission does not change Pass-1 understanding.

Supporting and trivial evidence should be collapsed rather than allowed to make the durable semantic board resemble a call trace.

## Pass-1 business-arc state

For each discovered arc DataSong keeps:

```text
title
trigger
majorStages[]
outcome
entities[]
relationships[]
status = forming | broadly_complete
supporting evidence/provenance
```

It also keeps `arcSeeds[]` for distinct business use cases visible in evidence but not yet pursued.

`broadly_complete` means that Pass 1 has enough evidence to explain the broad vertical slice. It does **not** mean implementation completeness.

Once a broad arc is complete and another arc seed is pending, DataSong can switch to that arc using goal-directed semantic search rather than continuing to spend model calls on lower-level implementation detail.

## Relation to DFS / semantic scoring

The existing continuity/coherence/information-gain machinery remains underneath Pass 1, but the scoring objective is now business-stage resolution.

A candidate should receive high Pass-1 value when it is likely to reveal or strengthen a missing broad stage, important branch, major entity relationship, trigger or outcome.

A candidate should receive low Pass-1 value when it merely explains implementation mechanics already summarized by the broad arc.

The DFS frontier continues to keep semantically admissible alternatives, not every mechanically reachable node.

## Later passes

Pass 1 intentionally leaves semantic gaps that do not block broad understanding. Later passes can reopen a selected business arc and increase resolution.

A possible progression is:

```text
PASS 1 — BUSINESS ARC DISCOVERY
trigger → broad stages → entities/relationships → outcome

PASS 2 — FLOW COMPLETION
resolve gaps between broad stages
identify business rules, services, persistence and important branches

PASS 3 — DEEP SEMANTIC DETAIL
field/data lineage
transformations
validation and authorization
edge cases
failure behavior
event propagation
operational/runtime detail
```

The exact number of later passes is not fixed. The principle is progressive semantic resolution: first establish the enterprise's broad business-use-case map, then deepen only the flows and questions that need more detail.

## Why this matters

Without pass separation, semantic exploration can degrade into expensive code traversal: each helper or adjacent function becomes another model call even though the enterprise-level story has stopped changing.

Pass 1 instead asks a stricter question:

> Does inspecting this evidence materially improve our broad understanding of one of the business arcs we are reconstructing?

If not, collapse it, skip it, or move to another promising arc.
