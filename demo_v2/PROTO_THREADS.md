# Proto threads and semantic crystallization

DataSong does not require the first inspected artifact to define a complete flow. Promising evidence that is not yet sufficient for a durable semantic thread is held as a **proto thread**.

```text
promising evidence
      ↓
proto thread
      ↓
more evidence scored for continuity + coherence
      ↓
promotion when the accumulated narrative becomes coherent
      ↓
durable semantic thread / emergent flow
```

For every new semantic artifact, the model evaluates both durable threads and current proto threads. For each proto thread it returns continuity, coherence and a semantic bridge.

The model also chooses one proto action:

- `new` — retain the current promising evidence as a new proto thread;
- `extend` — add the current evidence to an existing proto thread;
- `promote` — accumulated evidence now sustains a coherent concept, so begin a durable thread;
- `none` — do not change proto-thread state.

Promotion is a semantic judgement, not a structural definition. DataSong does not require a particular start type, end type, number of functions, or workflow shape. A proto thread should not remain provisional merely to collect implementation detail once continuity and coherence already make the concept clear.

## XML source-order edges

`next_in_source` is useful as weak structural orientation, but it is not equivalent to an explicit call, service invocation, read, write, event, route, or dependency edge. DataSong therefore discounts it during branch selection. It may still be followed when it is the only useful continuation.

## Neighborhood safety

A bounded `getNeighbors` rollout is outbound from the selected anchor, excludes the anchor itself from candidates, and avoids ambiguous repository-wide simple-name matches unless a same-file or uniquely resolvable target exists. Cycles remain represented as graph edges without re-offering the anchor as a next artifact.
